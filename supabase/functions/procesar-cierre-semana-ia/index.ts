// Supabase Edge Function: procesar-cierre-semana-ia
//
// Procesa un período de cierre de caja (cierres_caja_semanas) — rehecho tras
// la auditoría de nov-2026. Antes, la IA leía los extractos completos (y los
// cortaba a 60.000 caracteres), devolvía UN total por día y lo comparaba
// contra una "foto" de totales que se quedaba vieja. Ahora:
//
//   1. Cada documento del período se lee con reglas fijas (parsers.ts): cada
//      línea del extracto Bancolombia, cada cobro de Bold y cada recibo del
//      sistema de facturación queda como un registro propio, sin duplicarse
//      aunque se suba dos veces o dos períodos se crucen. Un archivo vacío o
//      con formato desconocido se reporta, no se ignora en silencio.
//   2. La tarjeta de Las Américas: la IA SOLO lee la tirilla Redeban de cada
//      día (una imagen → un número), y solo si esa tirilla no se ha leído.
//   3. fn_conciliar_cierre() cruza en la base de datos, sin IA, pago por
//      pago: transferencias ↔ abonos, tarjeta Fabricato ↔ cobros Bold,
//      efectivo consignado ↔ consignaciones, pagos ↔ recibos.
//   4. fn_actualizar_cierres_caja() deja el resultado por día×sede con el
//      facturado calculado EN VIVO desde los pagos del ERP. "Cuadra" nunca
//      se marca solo: lo confirma una persona (ver 0098).
//
// Secrets: ANTHROPIC_API_KEY (solo para leer tirillas), ANTHROPIC_MODEL
// opcional, CIERRE_CAJA_CRON_SECRET para el cron diario.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import * as XLSX from "npm:xlsx@0.18.5";
import { leerDocumento, type ResultadoLectura } from "./parsers.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const ANTHROPIC_MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

function sumarDias(fechaYMD: string, dias: number): string {
  const [y, m, d] = fechaYMD.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + dias);
  return dt.toISOString().slice(0, 10);
}

const fmt = (n: number) => `$${Math.round(n).toLocaleString("es-CO")}`;

type Admin = SupabaseClient;

const DOCUMENTOS: { campo: string; etiqueta: string }[] = [
  { campo: "url_bancolombia", etiqueta: "Bancolombia Las Américas" },
  { campo: "url_bancolombia_fabricato", etiqueta: "Bancolombia Fabricato" },
  { campo: "url_bold_fabricato", etiqueta: "Bold Fabricato" },
  { campo: "url_recibos_caja", etiqueta: "Recibos de caja (facturación)" },
];

/** Descarga un archivo del período, lo lee y guarda sus líneas. Devuelve avisos para mostrar. */
async function cargarDocumento(admin: Admin, semanaId: string, etiqueta: string, path: string): Promise<string[]> {
  const { data: file, error } = await admin.storage.from("comprobantes").download(path);
  if (error || !file) return [`${etiqueta}: no se pudo descargar (${error?.message ?? "desconocido"}).`];
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf.byteLength === 0) return [`${etiqueta}: el archivo está VACÍO (0 bytes). Descárgalo de nuevo del banco y súbelo otra vez.`];

  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (!["xlsx", "xls", "csv"].includes(ext)) {
    return [`${etiqueta}: formato .${ext} no soportado — sube el Excel que descarga el banco / Bold / el sistema de facturación.`];
  }
  let lectura: ResultadoLectura;
  try {
    // En CSV se leen los valores como texto: si no, SheetJS interpreta
    // "01/11/2026" como 11 de enero (formato de EE. UU.).
    const wb = XLSX.read(buf, ext === "csv" ? { type: "array", raw: true } : { type: "array", cellDates: true });
    const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null }) as unknown[][];
    lectura = leerDocumento(filas, path.split("/").pop() ?? path);
  } catch (e) {
    return [`${etiqueta}: ${e instanceof Error ? e.message : String(e)}`];
  }

  const archivo = path;
  if (lectura.movimientos.length > 0) {
    const filas = lectura.movimientos.map((m) => ({ ...m, archivo, semana_id: semanaId }));
    for (let i = 0; i < filas.length; i += 500) {
      const { error: errIns } = await admin
        .from("banco_movimientos")
        .upsert(filas.slice(i, i + 500), { onConflict: "huella", ignoreDuplicates: true });
      if (errIns) throw new Error(`No se pudieron guardar los movimientos de ${etiqueta}: ${errIns.message}`);
    }
  }
  if (lectura.recibos.length > 0) {
    const filas = lectura.recibos.map((r) => ({ ...r, archivo, semana_id: semanaId }));
    for (let i = 0; i < filas.length; i += 500) {
      const { error: errIns } = await admin
        .from("recibos_sistema")
        .upsert(filas.slice(i, i + 500), { onConflict: "huella", ignoreDuplicates: true });
      if (errIns) throw new Error(`No se pudieron guardar los recibos: ${errIns.message}`);
    }
  }
  const { error: errFuente } = await admin.from("cierre_fuentes_cargadas").upsert(
    {
      fuente: lectura.fuente,
      desde: lectura.desde,
      hasta: lectura.hasta,
      archivo,
      filas: lectura.movimientos.length + lectura.recibos.length,
      semana_id: semanaId,
    },
    { onConflict: "fuente,archivo" },
  );
  if (errFuente) throw new Error(`No se pudo registrar la cobertura de ${etiqueta}: ${errFuente.message}`);
  return lectura.avisos.map((a) => `${etiqueta}: ${a}`);
}

/** Lee con IA el "Gran Total" de una tirilla Redeban (imagen o PDF). */
async function leerTirilla(admin: Admin, path: string): Promise<number | null> {
  if (!ANTHROPIC_API_KEY) return null;
  const { data: file } = await admin.storage.from("comprobantes").download(path);
  if (!file) return null;
  const buf = new Uint8Array(await file.arrayBuffer());
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const bloque =
    ext === "pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Encode(buf) } }
      : {
          type: "image",
          source: {
            type: "base64",
            media_type: ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg",
            data: base64Encode(buf),
          },
        };
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 300,
      thinking: { type: "disabled" },
      system:
        "Lees tirillas de cierre de datáfono Redeban de una clínica en Colombia. Devuelve la suma de todos los 'GRAN TOTAL' de ventas aprobadas de la tirilla (si hay varias secciones o varios lotes, súmalos). Si no se puede leer con certeza, devuelve null.",
      messages: [{ role: "user", content: [bloque] }],
      tools: [
        {
          name: "reportar_total",
          description: "Total de ventas con tarjeta de la tirilla.",
          input_schema: { type: "object", properties: { gran_total: { type: ["number", "null"] } }, required: ["gran_total"] },
        },
      ],
      tool_choice: { type: "tool", name: "reportar_total" },
    }),
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  const uso = (data.content ?? []).find((b: { type: string }) => b.type === "tool_use") as { input?: { gran_total?: number | null } } | undefined;
  const v = uso?.input?.gran_total;
  return typeof v === "number" && isFinite(v) ? v : null;
}

/** Resumen del período por sede, escrito a partir del resultado determinístico (sin IA). */
async function resumenPorSede(admin: Admin, desde: string, hasta: string, sede: string): Promise<string> {
  const { data } = await admin
    .from("cierres_caja")
    .select("fecha, resultado_ok, resultado_detalle, cuadra")
    .eq("sede", sede)
    .gte("fecha", desde)
    .lte("fecha", hasta)
    .order("fecha");
  const dias = (data ?? []) as { fecha: string; resultado_ok: boolean | null; resultado_detalle: { alertas?: { tipo: string; valor: number }[] } | null }[];
  if (dias.length === 0) return "Sin días con movimiento en el período.";
  const limpios = dias.filter((d) => d.resultado_ok).length;
  const porTipo = new Map<string, { n: number; valor: number }>();
  for (const d of dias) {
    for (const a of d.resultado_detalle?.alertas ?? []) {
      const act = porTipo.get(a.tipo) ?? { n: 0, valor: 0 };
      act.n += 1;
      act.valor += Math.abs(Number(a.valor ?? 0));
      porTipo.set(a.tipo, act);
    }
  }
  const lineas = [...porTipo.entries()]
    .sort((a, b) => b[1].valor - a[1].valor)
    .map(([tipo, v]) => `${tipo}: ${v.n} día(s), ${fmt(v.valor)}`);
  return `${limpios} de ${dias.length} días sin novedades.` + (lineas.length ? ` Pendientes — ${lineas.join("; ")}.` : "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  let semanaId: string | undefined;

  try {
    const cronSecret = req.headers.get("x-cron-secret");
    const cronSecretEsperado = Deno.env.get("CIERRE_CAJA_CRON_SECRET");
    const esLlamadaCron = !!cronSecret && !!cronSecretEsperado && cronSecret === cronSecretEsperado;
    if (!esLlamadaCron) {
      const authHeader = req.headers.get("Authorization") ?? "";
      const callerClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
      const { data: userData } = await callerClient.auth.getUser();
      if (!userData?.user) return json({ ok: false, error: "No autenticado." }, 401);
      const { data: perfil } = await admin.from("perfiles").select("rol").eq("id", userData.user.id).single();
      if (perfil?.rol !== "admin") return json({ ok: false, error: "Solo un administrador puede procesar el cierre." }, 403);
    }

    const body = await req.json();
    semanaId = body?.semana_id;
    if (!semanaId) return json({ ok: false, error: "Falta semana_id." }, 400);

    const { data: semana, error: errSemana } = await admin.from("cierres_caja_semanas").select("*").eq("id", semanaId).single();
    if (errSemana || !semana) return json({ ok: false, error: "No se encontró el período." }, 404);
    const desde: string = semana.semana_inicio;
    const hasta: string = semana.semana_fin ?? sumarDias(desde, 6);

    await admin
      .from("cierres_caja_semanas")
      .update({ procesando: true, procesando_desde: new Date().toISOString(), error_ia: null })
      .eq("id", semanaId);

    // 1. Documentos del período → líneas
    const avisos: string[] = [];
    for (const d of DOCUMENTOS) {
      const path = semana[d.campo] as string | null;
      if (!path) continue;
      avisos.push(...(await cargarDocumento(admin, semanaId, d.etiqueta, path)));
    }

    // 2. Tirillas Redeban de Las Américas que aún no se han leído
    const { data: sedes } = await admin.from("sedes").select("id, nombre");
    const sedeAmericas = (sedes ?? []).find((s: { nombre: string }) => !s.nombre.includes("Fabricato")) as { id: string } | undefined;
    if (sedeAmericas) {
      const { data: tirillas } = await admin
        .from("cierres_diarios")
        .select("fecha, tirilla_datafono_url")
        .eq("sede_id", sedeAmericas.id)
        .gte("fecha", desde)
        .lte("fecha", hasta)
        .not("tirilla_datafono_url", "is", null);
      const { data: yaLeidas } = await admin
        .from("cierres_caja")
        .select("fecha, url_tirilla_datafono, dataf_spro")
        .eq("sede", "Las Americas")
        .gte("fecha", desde)
        .lte("fecha", hasta);
      const leidaPorFecha = new Map(
        ((yaLeidas ?? []) as { fecha: string; url_tirilla_datafono: string | null; dataf_spro: number | null }[]).map((r) => [r.fecha, r]),
      );
      for (const t of (tirillas ?? []) as { fecha: string; tirilla_datafono_url: string }[]) {
        const previa = leidaPorFecha.get(t.fecha);
        if (previa && previa.url_tirilla_datafono === t.tirilla_datafono_url && previa.dataf_spro !== null) continue;
        const total = await leerTirilla(admin, t.tirilla_datafono_url);
        if (total === null) {
          avisos.push(`Tirilla Redeban del ${t.fecha}: no se pudo leer el total, revísala a mano.`);
          continue;
        }
        const { error: errT } = await admin
          .from("cierres_caja")
          .upsert(
            { fecha: t.fecha, sede: "Las Americas", dataf_spro: total, url_tirilla_datafono: t.tirilla_datafono_url, fuente_dataf: "Redeban" },
            { onConflict: "fecha,sede" },
          );
        if (errT) avisos.push(`Tirilla del ${t.fecha}: ${errT.message}`);
      }
    }

    // 3 y 4. Conciliación determinística y resultado por día×sede
    const { data: conc, error: errConc } = await admin.rpc("fn_conciliar_cierre", { p_desde: desde, p_hasta: hasta });
    if (errConc) throw new Error(`Conciliación: ${errConc.message}`);
    const { error: errAct } = await admin.rpc("fn_actualizar_cierres_caja", { p_desde: desde, p_hasta: hasta });
    if (errAct) throw new Error(`Resultado por día: ${errAct.message}`);

    const resumenAmericas = await resumenPorSede(admin, desde, hasta, "Las Americas");
    const resumenFabricato = await resumenPorSede(admin, desde, hasta, "Fabricato");

    await admin
      .from("cierres_caja_semanas")
      .update({
        procesando: false,
        procesando_desde: null,
        procesado_en: new Date().toISOString(),
        resumen_ia_las_americas: resumenAmericas,
        resumen_ia_fabricato: resumenFabricato,
        error_ia: avisos.length ? avisos.join("\n") : null,
      })
      .eq("id", semanaId);

    return json({ ok: true, conciliacion: conc, avisos, resumen_las_americas: resumenAmericas, resumen_fabricato: resumenFabricato });
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e);
    if (semanaId) {
      await admin.from("cierres_caja_semanas").update({ procesando: false, procesando_desde: null, error_ia: mensaje }).eq("id", semanaId);
    }
    return json({ ok: false, error: mensaje }, 500);
  }
});
