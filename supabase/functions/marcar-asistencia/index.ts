import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Registra una marca de llegada/salida. Se ejecuta con el rol de servicio a
// propósito: la tabla asistencia_registros no tiene policy de insert para
// usuarios normales, así que este es el único camino para escribir ahí. Eso
// permite comprobar la IP pública del que llama (tomada de la conexión real,
// no de un dato que mande el cliente) antes de aceptar el registro.
Deno.serve(async (req: Request) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "No autorizado." }), { status: 401, headers: cors });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return new Response(JSON.stringify({ error: "Sesión inválida." }), { status: 401, headers: cors });
  }

  let body: { tipo?: string; foto_path?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Solicitud inválida." }), { status: 400, headers: cors });
  }
  if (body.tipo !== "llegada" && body.tipo !== "salida") {
    return new Response(JSON.stringify({ error: "Tipo inválido." }), { status: 400, headers: cors });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: perfil, error: perfilError } = await admin
    .from("perfiles")
    .select("id, sede_id, nombre")
    .eq("id", userData.user.id)
    .single();
  if (perfilError || !perfil) {
    return new Response(JSON.stringify({ error: "No se encontró el perfil." }), { status: 404, headers: cors });
  }

  const ipCliente = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  if (perfil.sede_id) {
    const { data: sede } = await admin.from("sedes").select("ip_permitida").eq("id", perfil.sede_id).single();
    const permitidas = (sede?.ip_permitida ?? "")
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean);
    if (permitidas.length > 0 && (!ipCliente || !permitidas.includes(ipCliente))) {
      return new Response(
        JSON.stringify({ error: "Debes estar conectado a la red de la sede para marcar asistencia." }),
        { status: 403, headers: cors },
      );
    }
  }

  const { error: insertError } = await admin.from("asistencia_registros").insert({
    perfil_id: perfil.id,
    sede_id: perfil.sede_id,
    tipo: body.tipo,
    foto_path: body.foto_path ?? null,
    ip: ipCliente,
  });
  if (insertError) {
    return new Response(JSON.stringify({ error: insertError.message }), { status: 500, headers: cors });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
