import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const TIPOS_VALIDOS = ["llegada", "salida_almuerzo", "entrada_almuerzo", "salida"];

// IPv6: el sistema operativo/navegador genera un sufijo aleatorio distinto
// por dispositivo (y a veces por reinicio) por privacidad — solo el
// prefijo de red (primeros 4 grupos, los 64 bits que asigna el ISP a esa
// conexión) es estable y realmente identifica "la red de la sede". Si lo
// que se guardó en ip_permitida tiene menos de 8 grupos (osea es un
// prefijo, no una IP completa), se compara solo por prefijo; si tiene los
// 8 grupos o es IPv4, se exige coincidencia exacta.
function ipCoincide(ipCliente: string, permitida: string): boolean {
  if (permitida.includes(":")) {
    const esPrefijo = permitida.split(":").filter((g) => g.length > 0).length < 8;
    if (esPrefijo) {
      const prefijo = permitida.replace(/:+$/, "");
      return ipCliente.startsWith(prefijo + ":") || ipCliente === prefijo;
    }
  }
  return ipCliente === permitida;
}

// Registra una marca de la jornada (llegada, salida/entrada de almuerzo,
// salida final). Se ejecuta con el rol de servicio a propósito: la tabla
// asistencia_registros no tiene policy de insert para usuarios normales, así
// que este es el único camino para escribir ahí. Eso permite comprobar la IP
// pública del que llama (tomada de la conexión real, no de un dato que mande
// el cliente) antes de aceptar el registro.
//
// Al marcar "llegada" o "salida" (fin de jornada) devuelve además una frase
// motivadora/de agradecimiento — avanzan en orden según cuántas veces esa
// persona ya marcó ese tipo (ver más abajo), no por la fecha del calendario.
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

  let body: { tipo?: string; fecha?: string; hora?: string };
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
    .select("id, sede_id, rol, nombre, restriccion_ip")
    .eq("id", userData.user.id)
    .single();
  if (perfilError || !perfil) {
    return new Response(JSON.stringify({ error: "No se encontró el perfil." }), { status: 404, headers: cors });
  }

  const ipCliente = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  // sede_id de la marca que se va a insertar — por defecto la de perfil,
  // pero si la restricción es "contra cualquier sede" (ver abajo) se
  // reemplaza por la sede cuya red realmente coincidió con la IP.
  let sedeIdMarca = perfil.sede_id;

  // Mensaje que ve quien intenta marcar desde fuera de la sede — además
  // queda un registro en asistencia_intentos_bloqueados para que admin lo
  // pueda revisar (quién intentó marcar sin estar físicamente presente).
  const MENSAJE_FUERA_DE_SEDE = "¡Pillada! Debes estar en el consultorio para marcar asistencia.";
  async function rechazarPorIp() {
    await admin.from("asistencia_intentos_bloqueados").insert({ perfil_id: perfil.id, tipo: body.tipo, ip: ipCliente });
    return new Response(JSON.stringify({ error: MENSAJE_FUERA_DE_SEDE }), { status: 403, headers: cors });
  }

  if (perfil.sede_id) {
    // Restricción a UNA sede fija — el caso normal de operación, y también
    // el de un admin con sede fija asignada.
    const { data: sede } = await admin.from("sedes").select("ip_permitida").eq("id", perfil.sede_id).single();
    const permitidas = (sede?.ip_permitida ?? "")
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean);
    if (permitidas.length > 0 && (!ipCliente || !permitidas.some((p) => ipCoincide(ipCliente, p)))) {
      return await rechazarPorIp();
    }
  } else if (perfil.restriccion_ip) {
    // Restricción "contra cualquier sede" — para alguien que puede trabajar
    // cualquier día en cualquiera de las sedes (ej. Sirley): pasa si su IP
    // coincide con la red de AL MENOS una, y esa es la sede que queda
    // registrada en la marca.
    const { data: sedes } = await admin.from("sedes").select("id, ip_permitida");
    let sedeCoincidente: string | null = null;
    for (const s of sedes ?? []) {
      const permitidas = (s.ip_permitida ?? "")
        .split(",")
        .map((x: string) => x.trim())
        .filter(Boolean);
      if (permitidas.length > 0 && ipCliente && permitidas.some((p) => ipCoincide(ipCliente, p))) {
        sedeCoincidente = s.id;
        break;
      }
    }
    if (!sedeCoincidente) {
      return await rechazarPorIp();
    }
    sedeIdMarca = sedeCoincidente;
  }

  // Solo un admin puede simular el día/hora de una marca (para probar el
  // conteo de horas sin esperar días reales) — a cualquier otro rol se le
  // ignora por completo "fecha"/"hora" y siempre queda la hora real del
  // server, aunque el rol se abra a todo el personal más adelante. Bogotá
  // es UTC-5 fijo (sin horario de verano), así que ese offset es siempre
  // correcto acá.
  let marcadoEn: string | undefined;
  if (perfil.rol === "admin" && body.fecha && /^\d{4}-\d{2}-\d{2}$/.test(body.fecha)) {
    const hora = body.hora && /^\d{2}:\d{2}(:\d{2})?$/.test(body.hora) ? body.hora : "12:00";
    const horaCompleta = hora.length === 5 ? `${hora}:00` : hora;
    marcadoEn = new Date(`${body.fecha}T${horaCompleta}-05:00`).toISOString();
  }

  const { error: insertError } = await admin.from("asistencia_registros").insert({
    perfil_id: perfil.id,
    sede_id: sedeIdMarca,
    tipo: body.tipo,
    ip: ipCliente,
    ...(marcadoEn ? { marcado_en: marcadoEn } : {}),
  });
  if (insertError) {
    return new Response(JSON.stringify({ error: insertError.message }), { status: 500, headers: cors });
  }

  // Las frases avanzan en orden PERSONAL, no por día del calendario — así
  // cada quien vive el mismo hilo conductor desde la primera vez que marca,
  // sin importar si se saltó días por vacaciones/incapacidad o si es nueva.
  // Se cuentan las marcas de este tipo que ya tiene (la que se acaba de
  // insertar arriba ya cuenta), así que la primera vez le toca la frase #1.
  // Arranca el lunes 21 de septiembre de 2026 — antes de esa fecha no se
  // muestra ninguna frase, aunque ya estén cargadas.
  const FECHA_INICIO_FRASES = "2026-09-21";
  const hoyBogota = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  let frase: string | null = null;
  if ((body.tipo === "llegada" || body.tipo === "salida") && hoyBogota >= FECHA_INICIO_FRASES) {
    const { data: frases } = await admin
      .from("frases_motivacionales")
      .select("texto")
      .eq("tipo", body.tipo)
      .eq("activa", true)
      .order("orden");
    if (frases && frases.length > 0) {
      const { count } = await admin
        .from("asistencia_registros")
        .select("id", { count: "exact", head: true })
        .eq("perfil_id", perfil.id)
        .eq("tipo", body.tipo);
      const indice = Math.max(0, (count ?? 1) - 1) % frases.length;
      frase = frases[indice].texto;
    }
  }

  return new Response(JSON.stringify({ success: true, frase }), {
    status: 200,
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
