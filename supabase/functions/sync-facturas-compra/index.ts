import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Recibe del robot de la hoja "Control de Facturación" (Google Apps Script,
// FacturasCompra.gs) todas las filas de las pestañas de mes y las reemplaza
// en facturas_compra. No usa JWT de usuario: se autentica con el header
// x-sync-key, que debe coincidir con integraciones_claves('facturas_compra').
// Esa clave la ve un admin en Administración → Facturación.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-sync-key",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const recibida = req.headers.get("x-sync-key") ?? "";
  const { data: fila, error: errClave } = await admin
    .from("integraciones_claves")
    .select("clave")
    .eq("nombre", "facturas_compra")
    .single();
  if (errClave || !fila) return json({ error: "No hay clave configurada en el ERP" }, 500);
  if (!recibida || recibida !== fila.clave) return json({ error: "Clave del ERP incorrecta" }, 401);

  let body: { pestanas?: string[]; filas?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }
  const pestanas = Array.isArray(body.pestanas) ? body.pestanas.filter((p) => typeof p === "string") : [];
  const filas = Array.isArray(body.filas) ? body.filas : [];
  if (!pestanas.length) return json({ error: "Faltan las pestañas" }, 400);

  const { data, error } = await admin.rpc("fn_facturas_compra_reemplazar", { p_pestanas: pestanas, p_filas: filas });
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true, filas: data, pestanas: pestanas.length });
});
