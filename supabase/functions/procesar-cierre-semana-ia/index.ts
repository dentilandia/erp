// Supabase Edge Function: procesar-cierre-semana-ia
//
// El cierre de caja real no se hace día por día — cada semana se sube UN
// lote de 5 documentos (que cada uno cubre varios días, y salvo Bancolombia,
// una sola sede) y hay que compararlo contra lo que ya cerró cada día en
// cierres_diarios (Cierre diario de Operación, fuente oficial desde que se
// integró con Cierre de Caja). Esta función:
//   1. Lee los 5 documentos de la semana (cierres_caja_semanas).
//   2. Junta el facturado real de los 7 días × 2 sedes desde cierres_diarios.
//   3. Le pide a Claude que lea los documentos y devuelva, día por día y sede
//      por sede, lo que encuentra y si cuadra contra lo facturado.
//   4. Crea/actualiza las 14 filas de cierres_caja correspondientes — con el
//      facturado ya resuelto (sin que nadie tenga que digitarlo) y el
//      análisis de la IA. "Cuadra" NO se marca sola, la sigue confirmando un
//      admin a mano por día en la pantalla de Días.
//
// Deploy:
//   supabase functions deploy procesar-cierre-semana-ia
// Secrets requeridos: los mismos que procesar-cierre-ia (ANTHROPIC_API_KEY,
// ANTHROPIC_MODEL opcional).

import { createClient } from "npm:@supabase/supabase-js@2";
import * as XLSX from "npm:xlsx@0.18.5";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const ANTHROPIC_MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function sumarDias(fechaYMD: string, dias: number): string {
  const [y, m, d] = fechaYMD.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + dias);
  return dt.toISOString().slice(0, 10);
}

// Mismo criterio que el front (claveSedeDe en CierreCaja.tsx): dos sedes hoy,
// se identifican por si el nombre contiene "Fabricato" o no.
function claveSedeDe(nombreSede: string): "Las Americas" | "Fabricato" {
  return nombreSede.includes("Fabricato") ? "Fabricato" : "Las Americas";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  let semanaId: string | undefined;

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await callerClient.auth.getUser();
    if (!userData?.user) return json({ ok: false, error: "No autenticado." }, 401);

    const { data: perfil } = await admin.from("perfiles").select("rol").eq("id", userData.user.id).single();
    if (perfil?.rol !== "admin") {
      return json({ ok: false, error: "Solo un administrador puede procesar el cierre con IA." }, 403);
    }

    const body = await req.json();
    semanaId = body?.semana_id;
    if (!semanaId) return json({ ok: false, error: "Falta semana_id." }, 400);

    const { data: semana, error: errSemana } = await admin
      .from("cierres_caja_semanas")
      .select("*")
      .eq("id", semanaId)
      .single();
    if (errSemana || !semana) return json({ ok: false, error: "No se encontró la semana." }, 404);

    const documentosSemana: { label: string; path: string | null; sedes: ("Las Americas" | "Fabricato")[] }[] = [
      { label: "Tirilla datáfono Redeban — Las Américas", path: semana.url_datafono_americas, sedes: ["Las Americas"] },
      { label: "Cierre ventas datáfono — Fabricato", path: semana.url_datafono_fabricato, sedes: ["Fabricato"] },
      { label: "Movimientos Bancolombia — ambas sedes", path: semana.url_bancolombia, sedes: ["Las Americas", "Fabricato"] },
      { label: "Movimientos Bold — Fabricato", path: semana.url_bold_fabricato, sedes: ["Fabricato"] },
      { label: "Excel recibos de caja del sistema — ambas sedes", path: semana.url_recibos_caja, sedes: ["Las Americas", "Fabricato"] },
    ].filter((d) => d.path);

    if (documentosSemana.length === 0) {
      return json({ ok: false, error: "Esta semana no tiene ningún documento adjunto todavía." }, 400);
    }

    await admin.from("cierres_caja_semanas").update({ procesando: true, error_ia: null }).eq("id", semanaId);

    const fechas = Array.from({ length: 7 }, (_, i) => sumarDias(semana.semana_inicio, i));

    const { data: sedesData } = await admin.from("sedes").select("id, nombre");
    const sedesPorClave = new Map<"Las Americas" | "Fabricato", string>();
    for (const s of sedesData ?? []) sedesPorClave.set(claveSedeDe(s.nombre), s.id);

    const { data: cierresDiariosData } = await admin
      .from("cierres_diarios")
      .select("sede_id, fecha, totales_por_medio, gasto")
      .in("fecha", fechas);
    const facturadoPorDiaSede = new Map<
      string,
      { efvo_fact: number; tarjeta_fact: number; transf_fact: number; addi: number; total: number; gasto: number }
    >();
    for (const c of (cierresDiariosData as { sede_id: string; fecha: string; totales_por_medio: Record<string, number>; gasto: number }[]) ?? []) {
      let claveSede: "Las Americas" | "Fabricato" | null = null;
      for (const [k, v] of sedesPorClave) if (v === c.sede_id) claveSede = k;
      if (!claveSede) continue;
      const t = c.totales_por_medio ?? {};
      const gasto = Number(c.gasto ?? 0);
      const efvo_fact = (t["efectivo"] ?? 0) - gasto;
      const tarjeta_fact = (t["tarjeta_debito"] ?? 0) + (t["tarjeta_credito"] ?? 0);
      const transf_fact = t["transferencia_debito"] ?? 0;
      const addi = (t["addi"] ?? 0) + (t["sistecredito"] ?? 0);
      facturadoPorDiaSede.set(`${c.fecha}|${claveSede}`, {
        efvo_fact,
        tarjeta_fact,
        transf_fact,
        addi,
        total: efvo_fact + tarjeta_fact + transf_fact + addi,
        gasto,
      });
    }

    // --- Descargar y preparar cada documento como bloque de contenido para Claude ---
    const contentBlocks: Record<string, unknown>[] = [];
    for (const doc of documentosSemana) {
      const { data: file, error: errFile } = await admin.storage.from("comprobantes").download(doc.path!);
      if (errFile || !file) {
        contentBlocks.push({ type: "text", text: `[No se pudo descargar "${doc.label}": ${errFile?.message ?? "desconocido"}]` });
        continue;
      }
      const ext = doc.path!.split(".").pop()?.toLowerCase() ?? "";
      contentBlocks.push({ type: "text", text: `--- ${doc.label} (aplica a: ${doc.sedes.join(", ")}) ---` });

      if (ext === "xlsx" || ext === "xls" || ext === "csv") {
        const buf = new Uint8Array(await file.arrayBuffer());
        const wb = XLSX.read(buf, { type: "array" });
        let texto = "";
        for (const nombreHoja of wb.SheetNames) {
          const hoja = wb.Sheets[nombreHoja];
          texto += `\n[Hoja: ${nombreHoja}]\n${XLSX.utils.sheet_to_csv(hoja)}`;
        }
        contentBlocks.push({ type: "text", text: texto.slice(0, 60000) });
      } else if (ext === "pdf") {
        const buf = new Uint8Array(await file.arrayBuffer());
        contentBlocks.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: base64Encode(buf) },
        });
      } else if (["jpg", "jpeg", "png", "webp"].includes(ext)) {
        const buf = new Uint8Array(await file.arrayBuffer());
        const media = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
        contentBlocks.push({ type: "image", source: { type: "base64", media_type: media, data: base64Encode(buf) } });
      } else {
        contentBlocks.push({ type: "text", text: `[Formato ".${ext}" no soportado para lectura automática — súbelo como xlsx, pdf, jpg o png.]` });
      }
    }

    const facturadoLineas = fechas.flatMap((fecha) =>
      (["Las Americas", "Fabricato"] as const).map((sede) => {
        const f = facturadoPorDiaSede.get(`${fecha}|${sede}`);
        if (!f) return `- ${fecha} · ${sede}: sin cierre diario registrado en el ERP.`;
        return `- ${fecha} · ${sede}: efectivo ${f.efvo_fact} (ya con el gasto de ${f.gasto} restado), tarjeta ${f.tarjeta_fact}, transferencia ${f.transf_fact}, addi/sistecrédito ${f.addi}, total ${f.total}.`;
      }),
    );
    const facturadoTexto = `Semana del ${semana.semana_inicio} — facturado según el ERP (Cierre diario de Operación) por día y sede:\n${facturadoLineas.join("\n")}`;

    const systemPrompt = `Eres un asistente contable de una clínica dental en Colombia (Dentilandia), con 2 sedes:
"Las Americas" y "Fabricato". Te doy el facturado según el ERP de los 7 días de una semana, para cada sede, y 5
documentos de soporte que cubren esa misma semana (algunos aplican a una sola sede, otros a ambas — se indica en
cada uno):
- Tirilla datáfono Redeban: solo Las Américas, tarjeta.
- Cierre de ventas datáfono: solo Fabricato, tarjeta.
- Movimientos Bancolombia: ambas sedes, transferencia/banco.
- Movimientos Bold: solo Fabricato, transferencia/banco (aparte de Bancolombia).
- Excel de recibos de caja del sistema: ambas sedes, efectivo (y puede traer una columna de sede).

Lee esos documentos y, para CADA UNA de las 14 combinaciones día×sede de esa semana, extrae lo que encuentres
y compáralo contra el facturado del ERP de ese día y esa sede. Si un documento no trae desglose por día, repartelo
por día tal como aparece, o usa null si no puedes separar un día de otro.

Responde ÚNICAMENTE con un JSON válido, sin texto adicional antes ni después, ni bloques de markdown, con esta forma
exacta:
{
  "dias": [
    {
      "fecha": "YYYY-MM-DD",
      "sede": "Las Americas" | "Fabricato",
      "efectivo_real": number|null,
      "tarjeta_real": number|null,
      "transferencia_real": number|null,
      "diferencia_efectivo": number|null,
      "diferencia_tarjeta": number|null,
      "diferencia_transferencia": number|null,
      "cuadra_sugerido": boolean,
      "nota": string
    },
    ... (una entrada por cada una de las 14 combinaciones día×sede, en el mismo orden que te las di)
  ],
  "resumen": "3-6 líneas en español: qué días/sedes tienen diferencias o les falta algo, y cualquier cosa rara que encontraste."
}`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: "user", content: [{ type: "text", text: facturadoTexto }, ...contentBlocks] }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Error de la API de Claude (${resp.status}): ${errText.slice(0, 500)}`);
    }
    const data = await resp.json();
    const textoRespuesta = (data.content ?? []).map((b: { type: string; text?: string }) => b.text ?? "").join("").trim();

    let resultado: { dias: Record<string, unknown>[]; resumen: string };
    try {
      const limpio = textoRespuesta.replace(/^```(json)?\s*/i, "").replace(/```\s*$/, "").trim();
      resultado = JSON.parse(limpio);
    } catch {
      throw new Error(`Claude no devolvió un JSON válido: ${textoRespuesta.slice(0, 500)}`);
    }

    const generadoEn = new Date().toISOString();
    const analisisPorDiaSede = new Map<string, Record<string, unknown>>();
    for (const d of resultado.dias ?? []) {
      analisisPorDiaSede.set(`${d.fecha}|${d.sede}`, d);
    }

    // --- Crear/actualizar las 14 filas de cierres_caja de esta semana ---
    for (const fecha of fechas) {
      for (const sede of ["Las Americas", "Fabricato"] as const) {
        const facturado = facturadoPorDiaSede.get(`${fecha}|${sede}`) ?? {
          efvo_fact: 0,
          tarjeta_fact: 0,
          transf_fact: 0,
          addi: 0,
          total: 0,
          gasto: 0,
        };
        const analisis = analisisPorDiaSede.get(`${fecha}|${sede}`);
        const urlDatafono1 = sede === "Las Americas" ? semana.url_datafono_americas : null;
        const urlDatafono2 = sede === "Fabricato" ? semana.url_datafono_fabricato : null;
        const urlBanco2 = sede === "Fabricato" ? semana.url_bold_fabricato : null;

        await admin.from("cierres_caja").upsert(
          {
            fecha,
            sede,
            efvo_fact: facturado.efvo_fact,
            tarjeta_fact: facturado.tarjeta_fact,
            transf_fact: facturado.transf_fact,
            addi: facturado.addi,
            total: facturado.total,
            gasto: facturado.gasto,
            url_recibos_caja: semana.url_recibos_caja,
            url_movimientos_banco: semana.url_bancolombia,
            url_movimientos_banco_2: urlBanco2,
            url_tirilla_datafono: urlDatafono1,
            url_reporte_datafono: urlDatafono2,
            dataf_sin_docs: !urlDatafono1 && !urlDatafono2,
            ...(analisis
              ? {
                  analisis_ia: {
                    efectivo_real: analisis.efectivo_real ?? null,
                    tarjeta_real: analisis.tarjeta_real ?? null,
                    transferencia_real: analisis.transferencia_real ?? null,
                    diferencia_efectivo: analisis.diferencia_efectivo ?? null,
                    diferencia_tarjeta: analisis.diferencia_tarjeta ?? null,
                    diferencia_transferencia: analisis.diferencia_transferencia ?? null,
                    cuadra_sugerido: analisis.cuadra_sugerido ?? false,
                    resumen: analisis.nota ?? "",
                    generado_en: generadoEn,
                  },
                }
              : {}),
          },
          { onConflict: "fecha,sede" },
        );
      }
    }

    await admin
      .from("cierres_caja_semanas")
      .update({ procesando: false, procesado_en: generadoEn, resumen_ia: resultado.resumen ?? null, error_ia: null })
      .eq("id", semanaId);

    return json({ ok: true, resumen: resultado.resumen });
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e);
    if (semanaId) {
      await admin.from("cierres_caja_semanas").update({ procesando: false, error_ia: mensaje }).eq("id", semanaId);
    }
    return json({ ok: false, error: mensaje }, 500);
  }
});
