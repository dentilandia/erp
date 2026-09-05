import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const TIPOS_VALIDOS = ["llegada", "salida_almuerzo", "entrada_almuerzo", "salida"];

// Registra una marca de la jornada (llegada, salida/entrada de almuerzo,
// salida final). Se ejecuta con el rol de servicio a propósito: la tabla
// asistencia_registros no tiene policy de insert para usuarios normales, así
// que este es el único camino para escribir ahí. Eso permite comprobar la IP
// pública del que llama (tomada de la conexión real, no de un dato que mande
// el cliente) antes de aceptar el registro.
//
// Al marcar "llegada" o "salida" (fin de jornada) devuelve además una frase
// motivadora/de agradecimiento del día — rotan por índice de día del año,
// así que no hay que asignarle fecha a cada una a mano.
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

  let body: { tipo?: string; fecha?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Solicitud inválida." }), { status: 400, headers: cors });
  }
  if (!body.tipo || !TIPOS_VALIDOS.includes(body.tipo)) {
    return new Response(JSON.stringify({ error: "Tipo inválido." }), { status: 400, headers: cors });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: perfil, error: perfilError } = await admin
    .from("perfiles")
    .select("id, sede_id, rol, nombre")
    .eq("id", userData.user.id)
    .single();
  if (perfilError || !perfil) {
    return new Response(JSON.stringify({ error: "No se encontró el perfil." }), { status: 404, headers: cors });
  }

  const ipCliente = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  // Los administrativos nunca quedan restringidos por IP, sin importar si
  // tienen sede_id asignado — la restricción es solo para el personal
  // asistencial/de operación.
  if (perfil.rol !== "admin" && perfil.sede_id) {
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

  // Solo un admin puede simular el día de una marca (para probar el conteo
  // de horas sin esperar días reales) — a cualquier otro rol se le ignora
  // por completo el campo "fecha" y siempre queda la hora real del server,
  // aunque el rol se abra a todo el personal más adelante.
  let marcadoEn: string | undefined;
  if (perfil.rol === "admin" && body.fecha && /^\d{4}-\d{2}-\d{2}$/.test(body.fecha)) {
    const ahora = new Date();
    const [y, m, d] = body.fecha.split("-").map(Number);
    marcadoEn = new Date(
      Date.UTC(y, m - 1, d, ahora.getUTCHours(), ahora.getUTCMinutes(), ahora.getUTCSeconds(), ahora.getUTCMilliseconds()),
    ).toISOString();
  }

  const { error: insertError } = await admin.from("asistencia_registros").insert({
    perfil_id: perfil.id,
    sede_id: perfil.sede_id,
    tipo: body.tipo,
    ip: ipCliente,
    ...(marcadoEn ? { marcado_en: marcadoEn } : {}),
  });
  if (insertError) {
    return new Response(JSON.stringify({ error: insertError.message }), { status: 500, headers: cors });
  }

  let frase: string | null = null;
  if (body.tipo === "llegada" || body.tipo === "salida") {
    const { data: frases } = await admin
      .from("frases_motivacionales")
      .select("texto")
      .eq("tipo", body.tipo)
      .eq("activa", true)
      .order("orden");
    if (frases && frases.length > 0) {
      const diaDelAnio = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
      frase = frases[diaDelAnio % frases.length].texto;
    }
  }

  return new Response(JSON.stringify({ success: true, frase }), {
    status: 200,
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
