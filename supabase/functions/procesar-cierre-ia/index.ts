// Supabase Edge Function: procesar-cierre-ia
//
// Lee los documentos adjuntos de un día de Cierre de Caja (recibos de caja,
// movimientos de banco, datáfono) y le pide a Claude que extraiga los totales
// y los compare contra lo facturado por el ERP ese día. Guarda el resultado
// en cierres_caja.analisis_ia — NO marca "Cuadra" automáticamente, eso lo
// sigue confirmando una persona a mano en "Hacer cierre".
//
// Deploy:
//   supabase functions deploy procesar-cierre-ia
// Secrets requeridos (Dashboard → Edge Functions → Secrets, o `supabase secrets set`):
//   ANTHROPIC_API_KEY   (obligatorio — API key de https://console.anthropic.com)
//   ANTHROPIC_MODEL     (opcional, por defecto "claude-sonnet-5")
//
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya existen automáticamente en todo
// Edge Function de Supabase, no hay que configurarlos a mano.

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    // --- Verificar que quien llama es un admin autenticado (mismo criterio que la RLS de cierres_caja) ---
    const authHeader = req.headers.get("Authorization") ?? "";
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await callerClient.auth.getUser();
    if (!userData?.user) return json({ ok: false, error: "No autenticado." }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: perfil } = await admin.from("perfiles").select("rol").eq("id", userData.user.id).single();
    if (perfil?.rol !== "admin") {
      return json({ ok: false, error: "Solo un administrador puede procesar el cierre con IA." }, 403);
    }

    const { cierre_id } = await req.json();
    if (!cierre_id) return json({ ok: false, error: "Falta cierre_id." }, 400);

    const { data: cierre, error: errCierre } = await admin
      .from("cierres_caja")
      .select(
        "id, fecha, sede, efvo_fact, tarjeta_fact, transf_fact, addi, total, url_recibos_caja, url_movimientos_banco, url_tirilla_datafono, url_reporte_datafono",
      )
      .eq("id", cierre_id)
      .single();
    if (errCierre || !cierre) return json({ ok: false, error: "No se encontró el cierre." }, 404);

    const documentos: { label: string; path: string | null }[] = [
      { label: "Reporte de recibos de caja (Oral Drive)", path: cierre.url_recibos_caja },
      { label: "Movimientos de cuentas bancarias", path: cierre.url_movimientos_banco },
      { label: "Tirilla de datáfono", path: cierre.url_tirilla_datafono },
      { label: "Reporte de datáfono", path: cierre.url_reporte_datafono },
    ].filter((d) => d.path);

    if (documentos.length === 0) {
      return json({ ok: false, error: "Este día no tiene ningún documento adjunto todavía." }, 400);
    }

    // --- Descargar y preparar cada documento como bloque de contenido para Claude ---
    const contentBlocks: Record<string, unknown>[] = [];
    for (const doc of documentos) {
      const { data: file, error: errFile } = await admin.storage.from("comprobantes").download(doc.path!);
      if (errFile || !file) {
        contentBlocks.push({ type: "text", text: `[No se pudo descargar "${doc.label}": ${errFile?.message ?? "desconocido"}]` });
        continue;
      }
      const ext = doc.path!.split(".").pop()?.toLowerCase() ?? "";
      contentBlocks.push({ type: "text", text: `--- ${doc.label} ---` });

      if (ext === "xlsx" || ext === "xls" || ext === "csv") {
        const buf = new Uint8Array(await file.arrayBuffer());
        const wb = XLSX.read(buf, { type: "array" });
        let texto = "";
        for (const nombreHoja of wb.SheetNames) {
          const hoja = wb.Sheets[nombreHoja];
          texto += `\n[Hoja: ${nombreHoja}]\n${XLSX.utils.sheet_to_csv(hoja)}`;
        }
        contentBlocks.push({ type: "text", text: texto.slice(0, 40000) });
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

    const facturadoTexto =
      `Sede: ${cierre.sede}\nFecha: ${cierre.fecha}\n\n` +
      `Facturado según el ERP (Operación Diaria) ese día:\n` +
      `- Efectivo: ${cierre.efvo_fact}\n` +
      `- Tarjeta: ${cierre.tarjeta_fact}\n` +
      `- Transferencia: ${cierre.transf_fact}\n` +
      `- Addi/Sistecrédito: ${cierre.addi}\n` +
      `- Total: ${cierre.total}\n`;

    const systemPrompt = `Eres un asistente contable de una clínica dental en Colombia (Dentilandia). Te doy el total
facturado por el sistema (ERP) de un día, y los documentos de soporte de ese mismo día (recibos de caja,
movimientos bancarios, cierre de datáfono). Lee esos documentos y extrae:
- efectivo_real: total de efectivo según el reporte de recibos de caja, si aparece.
- datafono_real: total según la tirilla/reporte de datáfono (tarjeta).
- banco_consignado: total consignado/depositado según los movimientos bancarios que corresponda a este cierre, si lo identificas.
- diferencia_efectivo: efectivo_real menos el efectivo facturado por el ERP (null si no pudiste leer efectivo_real).
- diferencia_datafono: datafono_real menos la tarjeta facturada por el ERP (null si no pudiste leer datafono_real).
- cuadra_sugerido: true si las diferencias son cercanas a 0, false si hay una diferencia relevante o no pudiste leer algo importante.
- resumen: 2-4 líneas en español explicando lo que encontraste, y cualquier cosa que no pudiste leer con certeza o que te pareció rara.

Responde ÚNICAMENTE con un JSON válido, sin texto adicional antes ni después, ni bloques de markdown, con
exactamente estas claves: {"efectivo_real": number|null, "datafono_real": number|null, "banco_consignado": number|null,
"diferencia_efectivo": number|null, "diferencia_datafono": number|null, "cuadra_sugerido": boolean, "resumen": string}`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: "user", content: [{ type: "text", text: facturadoTexto }, ...contentBlocks] }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return json({ ok: false, error: `Error de la API de Claude (${resp.status}): ${errText.slice(0, 500)}` }, 502);
    }
    const data = await resp.json();
    const textoRespuesta = (data.content ?? []).map((b: { type: string; text?: string }) => b.text ?? "").join("").trim();

    let resultado: Record<string, unknown>;
    try {
      const limpio = textoRespuesta.replace(/^```(json)?\s*/i, "").replace(/```\s*$/, "").trim();
      resultado = JSON.parse(limpio);
    } catch {
      return json({ ok: false, error: `Claude no devolvió un JSON válido: ${textoRespuesta.slice(0, 500)}` }, 502);
    }
    resultado.generado_en = new Date().toISOString();

    await admin.from("cierres_caja").update({ analisis_ia: resultado }).eq("id", cierre_id);

    return json({ ok: true, resultado });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
