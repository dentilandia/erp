// Supabase Edge Function: procesar-cierre-semana-ia
//
// El cierre de caja real no se hace día por día — cada período (normalmente
// una semana, pero semana_fin permite cualquier rango) se sube UN lote de 3
// documentos (que cada uno cubre varios días, y salvo Bancolombia, una sola
// sede) y hay que compararlo contra lo que ya cerró cada día en
// cierres_diarios (Cierre diario de Operación, fuente oficial desde que se
// integró con Cierre de Caja). La tarjeta de las 2 sedes NO depende de que
// nadie suba nada: Las Américas siempre adjunta su tirilla Redeban en Cierre
// diario de Operación, y Fabricato recibe por correo (Bold, "cierre de
// ventas") el valor exacto de cada turno — ambas se leen directo, sin IA de
// por medio para ese número. Esta función:
//   1. Lee los 3 documentos del período que sí requieren lectura por IA
//      (cierres_caja_semanas) + la tirilla de Las Américas y los turnos Bold
//      de Fabricato de cada día del rango (cierres_diarios).
//   2. Junta el facturado real de cada día × 2 sedes desde cierres_diarios.
//   3. Le pide a Claude que lea los documentos y devuelva, día por día y sede
//      por sede, lo que encuentra (efectivo/transferencia) y si cuadra contra
//      lo facturado — la tarjeta ya viene resuelta de forma determinística.
//   4. Crea/actualiza las filas de cierres_caja correspondientes (un día ×
//      2 sedes cada una) — con el facturado ya resuelto (sin que nadie tenga
//      que digitarlo) y el análisis de la IA. "Cuadra" NO se marca sola, la
//      sigue confirmando un admin a mano por día en la pantalla de Días.
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

/** Descarga un soporte del storage y lo convierte en los bloques de contenido
 *  que entiende la API de Claude (texto para xlsx/csv, documento para pdf,
 *  imagen para jpg/png/webp) — usado tanto para los documentos semanales
 *  como para cada tirilla diaria de datáfono de Las Américas. */
async function bloqueDocumento(admin: ReturnType<typeof createClient>, label: string, path: string): Promise<Record<string, unknown>[]> {
  const bloques: Record<string, unknown>[] = [];
  const { data: file, error: errFile } = await admin.storage.from("comprobantes").download(path);
  if (errFile || !file) {
    bloques.push({ type: "text", text: `[No se pudo descargar "${label}": ${errFile?.message ?? "desconocido"}]` });
    return bloques;
  }
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  bloques.push({ type: "text", text: `--- ${label} ---` });
  if (ext === "xlsx" || ext === "xls" || ext === "csv") {
    const buf = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "array" });
    let texto = "";
    for (const nombreHoja of wb.SheetNames) {
      const hoja = wb.Sheets[nombreHoja];
      texto += `\n[Hoja: ${nombreHoja}]\n${XLSX.utils.sheet_to_csv(hoja)}`;
    }
    bloques.push({ type: "text", text: texto.slice(0, 60000) });
  } else if (ext === "pdf") {
    const buf = new Uint8Array(await file.arrayBuffer());
    bloques.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Encode(buf) } });
  } else if (["jpg", "jpeg", "png", "webp"].includes(ext)) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const media = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    bloques.push({ type: "image", source: { type: "base64", media_type: media, data: base64Encode(buf) } });
  } else {
    bloques.push({ type: "text", text: `[Formato ".${ext}" no soportado para lectura automática — súbelo como xlsx, pdf, jpg o png.]` });
  }
  return bloques;
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
    // Dos formas de llamar: un admin autenticado desde la pantalla (botón
    // "Procesar con IA"), o el cron diario (sin usuario — manda un secreto
    // compartido en vez de un JWT, guardado en Vault y en los secrets del
    // edge function, nunca en el código).
    const cronSecret = req.headers.get("x-cron-secret");
    const cronSecretEsperado = Deno.env.get("CIERRE_CAJA_CRON_SECRET");
    const esLlamadaCron = !!cronSecret && !!cronSecretEsperado && cronSecret === cronSecretEsperado;

    if (!esLlamadaCron) {
      const authHeader = req.headers.get("Authorization") ?? "";
      const callerClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
      const { data: userData } = await callerClient.auth.getUser();
      if (!userData?.user) return json({ ok: false, error: "No autenticado." }, 401);

      const { data: perfil } = await admin.from("perfiles").select("rol").eq("id", userData.user.id).single();
      if (perfil?.rol !== "admin") {
        return json({ ok: false, error: "Solo un administrador puede procesar el cierre con IA." }, 403);
      }
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
      {
        label: "Movimientos Bancolombia — Las Américas (transferencias de pacientes + consignación de efectivo)",
        path: semana.url_bancolombia,
        sedes: ["Las Americas"],
      },
      {
        label:
          "Movimientos Bancolombia — Fabricato (SOLO para confirmar consignación de efectivo — las transferencias y la tarjeta de Fabricato van por Bold, no por esta cuenta)",
        path: semana.url_bancolombia_fabricato,
        sedes: ["Fabricato"],
      },
      { label: "Movimientos Bold — Fabricato", path: semana.url_bold_fabricato, sedes: ["Fabricato"] },
      { label: "Excel recibos de caja del sistema — ambas sedes", path: semana.url_recibos_caja, sedes: ["Las Americas", "Fabricato"] },
    ].filter((d) => d.path);

    // El período normalmente es una semana completa (7 días), pero
    // semana_fin puede extenderlo o acortarlo a cualquier rango — algunos
    // lotes de documentos no llegan alineados a semanas de lunes a lunes.
    const finPeriodo = semana.semana_fin ?? sumarDias(semana.semana_inicio, 6);
    const fechas: string[] = [];
    for (let f = semana.semana_inicio; f <= finPeriodo && fechas.length < 60; f = sumarDias(f, 1)) {
      fechas.push(f);
    }

    const { data: sedesData } = await admin.from("sedes").select("id, nombre");
    const sedesPorClave = new Map<"Las Americas" | "Fabricato", string>();
    for (const s of sedesData ?? []) sedesPorClave.set(claveSedeDe(s.nombre), s.id);

    const { data: cierresDiariosData } = await admin
      .from("cierres_diarios")
      .select("sede_id, fecha, totales_por_medio, gasto, tirilla_datafono_url, bold_cierre_turnos, consignado, fecha_consignacion")
      .in("fecha", fechas);
    const facturadoPorDiaSede = new Map<
      string,
      { efvo_fact: number; tarjeta_fact: number; transf_fact: number; addi: number; total: number; gasto: number }
    >();
    // La tirilla Redeban de Las Américas ya no se sube una vez por semana:
    // siempre está adjunta día por día en Cierre diario de Operación, así
    // que se toma de ahí directo — una imagen/PDF por fecha, sin ambigüedad
    // de a qué día pertenece (a diferencia de un solo documento semanal).
    const tirillaLasAmericasPorFecha = new Map<string, string>();
    // La tarjeta de Fabricato tampoco depende de un documento: Bold manda un
    // correo por cada turno cerrado ("cierre de ventas") con el valor exacto
    // en texto plano — un bot lee Gmail y los va guardando acá, uno o varios
    // por día. Se suman para tener el total determinístico del día.
    const boldFabricatoPorFecha = new Map<string, number>();
    // En Fabricato las transferencias/tarjeta van por Bold, pero el efectivo
    // se sigue consignando en Bancolombia — esto le dice a la IA qué días
    // buscar esa consignación en el extracto de esa cuenta.
    const consignacionPorDiaSede = new Map<string, { consignado: boolean; fecha_consignacion: string | null }>();
    for (const c of (cierresDiariosData as {
      sede_id: string;
      fecha: string;
      totales_por_medio: Record<string, number>;
      gasto: number;
      tirilla_datafono_url: string | null;
      bold_cierre_turnos: { valor: number }[] | null;
      consignado: boolean;
      fecha_consignacion: string | null;
    }[]) ?? []) {
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
      if (claveSede === "Las Americas" && c.tirilla_datafono_url) {
        tirillaLasAmericasPorFecha.set(c.fecha, c.tirilla_datafono_url);
      }
      if (claveSede === "Fabricato" && c.bold_cierre_turnos && c.bold_cierre_turnos.length > 0) {
        const suma = c.bold_cierre_turnos.reduce((a, turno) => a + Number(turno.valor ?? 0), 0);
        boldFabricatoPorFecha.set(c.fecha, suma);
      }
      consignacionPorDiaSede.set(`${c.fecha}|${claveSede}`, { consignado: c.consignado, fecha_consignacion: c.fecha_consignacion });
    }

    if (documentosSemana.length === 0 && tirillaLasAmericasPorFecha.size === 0 && boldFabricatoPorFecha.size === 0) {
      return json({ ok: false, error: "Esta semana no tiene ningún documento adjunto todavía." }, 400);
    }

    await admin.from("cierres_caja_semanas").update({ procesando: true, error_ia: null }).eq("id", semanaId);

    // --- Descargar y preparar cada documento como bloque de contenido para Claude ---
    const contentBlocks: Record<string, unknown>[] = [];
    for (const doc of documentosSemana) {
      contentBlocks.push(...(await bloqueDocumento(admin, `${doc.label} (aplica a: ${doc.sedes.join(", ")})`, doc.path!)));
    }
    for (const fecha of fechas) {
      const path = tirillaLasAmericasPorFecha.get(fecha);
      if (!path) continue;
      contentBlocks.push(...(await bloqueDocumento(admin, `Tirilla datáfono Redeban — Las Américas — ${fecha} (aplica a: Las Americas)`, path)));
    }

    const facturadoLineas = fechas.flatMap((fecha) =>
      (["Las Americas", "Fabricato"] as const).map((sede) => {
        const f = facturadoPorDiaSede.get(`${fecha}|${sede}`);
        if (!f) return `- ${fecha} · ${sede}: sin cierre diario registrado en el ERP.`;
        const notaTarjeta =
          sede === "Fabricato" && boldFabricatoPorFecha.has(fecha)
            ? ` [tarjeta ya verificada contra Bold: $${boldFabricatoPorFecha.get(fecha)}, no hace falta que la verifiques tú]`
            : "";
        const consig = consignacionPorDiaSede.get(`${fecha}|${sede}`);
        const notaConsig = consig?.consignado
          ? ` [efectivo marcado como CONSIGNADO en el ERP (fecha de consignación: ${consig.fecha_consignacion ?? "sin especificar"}) — búscalo en el extracto de Bancolombia de esta sede, puede venir repartido en varias consignaciones que sumen el total; dilo en tu nota: encontrado o no]`
          : "";
        return `- ${fecha} · ${sede}: efectivo ${f.efvo_fact} (ya con el gasto de ${f.gasto} restado), tarjeta ${f.tarjeta_fact}, transferencia ${f.transf_fact}, addi/sistecrédito ${f.addi}, total ${f.total}.${notaTarjeta}${notaConsig}`;
      }),
    );
    const facturadoTexto = `Período del ${semana.semana_inicio} al ${finPeriodo} (${fechas.length} días) — facturado según el ERP (Cierre diario de Operación) por día y sede:\n${facturadoLineas.join("\n")}`;
    const totalCombinaciones = fechas.length * 2;

    const systemPrompt = `Eres un asistente contable de una clínica dental en Colombia (Dentilandia), con 2 sedes:
"Las Americas" y "Fabricato". Te doy el facturado según el ERP de los ${fechas.length} días de un período, para cada
sede, y los documentos de soporte que cubren ese mismo período (algunos aplican a una sola sede, otros a ambas — se
indica en cada uno). La tarjeta de las 2 sedes YA viene resuelta de forma determinística (no depende de que tú la
leas de ningún documento): para Las Américas te llega una imagen/PDF de la tirilla Redeban por cada día que la
tenga (la etiqueta ya trae su fecha exacta), y para Fabricato el valor ya viene anotado junto al facturado de cada
día cuando aplica — en ambos casos, para "tarjeta_real" de esos día×sede usa ese mismo valor (o el de la tirilla
que leas) tal cual, sin necesidad de más verificación.
- Movimientos Bancolombia — Las Américas: transferencias de pacientes (compáralas contra "transferencia_real") y
  también la consignación diaria del efectivo (ambas cosas pasan por esta cuenta).
- Movimientos Bancolombia — Fabricato: en Fabricato las transferencias y la tarjeta van por Bold, NO por esta
  cuenta — este extracto SOLO sirve para confirmar que el efectivo que un día quedó marcado como "CONSIGNADO" en
  el ERP (ver la anotación junto a cada día de Fabricato abajo) realmente aparece como una consignación en este
  banco. No uses este documento para "transferencia_real" de Fabricato — esa sale del documento de Bold.
- Movimientos Bold: solo Fabricato, transferencia/banco (aparte de Bancolombia).
- Excel de recibos de caja del sistema: ambas sedes, efectivo (y puede traer una columna de sede).

Lee esos documentos y, para CADA UNA de las ${totalCombinaciones} combinaciones día×sede de ese período, extrae lo
que encuentres (sobre todo efectivo y transferencia) y compáralo contra el facturado del ERP de ese día y esa
sede. Si un documento no trae desglose por día, repartelo por día tal como aparece, o usa null si no puedes
separar un día de otro. Cuando un día traiga la anotación de efectivo consignado, dedica una frase de tu "nota" a
decir si encontraste o no esa consignación en el extracto de Bancolombia correspondiente a esa sede.

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
    ... (una entrada por cada una de las ${totalCombinaciones} combinaciones día×sede, en el mismo orden que te las di)
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

    // --- Crear/actualizar las filas de cierres_caja de este período ---
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
        const urlDatafono1 = sede === "Las Americas" ? tirillaLasAmericasPorFecha.get(fecha) ?? null : null;
        const urlBanco1 = sede === "Las Americas" ? semana.url_bancolombia : semana.url_bancolombia_fabricato;
        const urlBanco2 = sede === "Fabricato" ? semana.url_bold_fabricato : null;

        // Tarjeta determinística: Las Américas la trae la IA (leyó la tirilla
        // Redeban); Fabricato ya la tenemos exacta de los correos de Bold, sin
        // IA de por medio. Si por algún motivo falta la fuente determinística
        // de ese día, se deja sin resolver en vez de inventar un valor.
        const boldFabricato = sede === "Fabricato" ? boldFabricatoPorFecha.get(fecha) ?? null : null;
        const dataf_spro =
          sede === "Fabricato" ? boldFabricato : typeof analisis?.tarjeta_real === "number" ? analisis.tarjeta_real : null;
        const dif_dataf_bruta = dataf_spro === null ? null : facturado.tarjeta_fact - dataf_spro;
        const dataf_explicado = dif_dataf_bruta !== null && Math.abs(dif_dataf_bruta) < 1;
        const fuente_dataf =
          sede === "Fabricato" && boldFabricato !== null ? "SPRO Bold" : sede === "Las Americas" && urlDatafono1 ? "Redeban" : undefined;
        const tieneFuenteTarjeta = sede === "Las Americas" ? !!urlDatafono1 : boldFabricato !== null;

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
            url_movimientos_banco: urlBanco1,
            url_movimientos_banco_2: urlBanco2,
            url_tirilla_datafono: urlDatafono1,
            dataf_sin_docs: !tieneFuenteTarjeta,
            dataf_spro,
            dif_dataf_bruta,
            dataf_explicado,
            ...(fuente_dataf ? { fuente_dataf } : {}),
            ...(analisis
              ? {
                  analisis_ia: {
                    efectivo_real: analisis.efectivo_real ?? null,
                    tarjeta_real: dataf_spro ?? analisis.tarjeta_real ?? null,
                    transferencia_real: analisis.transferencia_real ?? null,
                    diferencia_efectivo: analisis.diferencia_efectivo ?? null,
                    diferencia_tarjeta: dif_dataf_bruta ?? analisis.diferencia_tarjeta ?? null,
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
