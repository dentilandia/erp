import { useEffect, useMemo, useState } from "react";
import { LogIn, LogOut, Coffee, Utensils, Sunrise, PartyPopper, Eye, EyeOff } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import {
  TIPOS_ASISTENCIA,
  type AsistenciaRegistro,
  type TipoAsistencia,
  type FestivoColombia,
  type PeriodoLiquidacion,
  type Doctora,
  type SolicitudHorasExtra,
  type ColaboradorHorasExtra,
} from "../lib/types";

// Jornada ordinaria: 8:30am-6:00pm con 1h de almuerzo entre semana (8.5h),
// 8am-12m el sábado sin almuerzo (4h). Un día de vacaciones/incapacidad
// resta esto de la meta semanal de esa semana, y también es lo que se usa
// para calcular cuánto le "falta" a un día compensado (ver más abajo).
function jornadaOrdinariaHoras(fechaYMD: string): number {
  return diaDeSemana(fechaYMD) === 6 ? 4 : 8.5;
}

/** Hora a la que "empieza a contar" la jornada ese día: la normal (8:30
 *  entre semana, 8:00 sábado) salvo que admin haya autorizado una distinta
 *  para esa persona ese día puntual (ej. reunión desde las 8am, alguien
 *  autorizado a entrar a las 10am). */
function horaInicioEsperada(fechaYMD: string, horaAutorizada?: string | null): string {
  // Postgres devuelve un "time" como "10:00:00" (con segundos) — se recorta
  // a "HH:MM" para poder concatenarle ":00" siempre de forma segura abajo.
  return (horaAutorizada || horasPorDefecto(fechaYMD).llegada).slice(0, 5);
}

/** Si llegó antes de la hora esperada, la llegada "efectiva" para contar
 *  horas es la hora esperada, no la real — llegar temprano no debe generar
 *  horas de más, ya que de todas formas empieza antes de lo que le tocaba. */
function llegadaEfectivaISO(marcadoEnLlegada: string, fechaYMD: string, horaAutorizada?: string | null): string {
  const inicioISO = new Date(`${fechaYMD}T${horaInicioEsperada(fechaYMD, horaAutorizada)}:00-05:00`).toISOString();
  return marcadoEnLlegada < inicioISO ? inicioISO : marcadoEnLlegada;
}

/** Horas realmente trabajadas ese día según sus marcas (mismo cálculo que
 *  usa el reporte mensual: llegada→salida, descontando almuerzo si hay).
 *  Si es entre semana y no marcó las dos horas de almuerzo, se asume 1h fija
 *  en vez de contarla como trabajada (el sábado no tiene almuerzo, no
 *  aplica). Llegar antes de la hora esperada de ese día no suma horas de
 *  más — se cuenta desde ahí, no desde la marca real. */
function horasTrabajadasDeMarcas(
  marcas: { tipo: TipoAsistencia; marcado_en: string }[],
  fecha: string,
  horaEntradaAutorizada?: string | null,
): number {
  const porTipo: Partial<Record<TipoAsistencia, string>> = {};
  for (const m of marcas) if (!porTipo[m.tipo]) porTipo[m.tipo] = m.marcado_en;
  if (!porTipo.llegada || !porTipo.salida) return 0;
  const llegadaEfectiva = llegadaEfectivaISO(porTipo.llegada, fecha, horaEntradaAutorizada);
  let horas = (new Date(porTipo.salida).getTime() - new Date(llegadaEfectiva).getTime()) / 3_600_000;
  if (porTipo.salida_almuerzo && porTipo.entrada_almuerzo) {
    horas -= (new Date(porTipo.entrada_almuerzo).getTime() - new Date(porTipo.salida_almuerzo).getTime()) / 3_600_000;
  } else if (diaDeSemana(fecha) !== 6) {
    horas -= 1;
  }
  return Math.max(0, horas);
}

/** Escapa texto libre (nombres, notas) antes de interpolarlo en el HTML del
 *  PDF, para no romper el documento si alguien escribió comillas o símbolos. */
function escPdf(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Si el día ya tenía un "compensado" guardado pero después cambiaron las
 *  marcas de ese día (ej. se corrigió la llegada, o se cargó la salida de
 *  una hora extra), el valor guardado queda desactualizado — se recalcula
 *  contra las marcas actuales y se corrige en la base si no coincide. */
async function recalcularCompensadoDia(perfilId: string, fecha: string): Promise<number> {
  const { data: nota } = await supabase
    .from("asistencia_notas_dia")
    .select("minutos_compensados, hora_entrada_autorizada")
    .eq("perfil_id", perfilId)
    .eq("fecha", fecha)
    .maybeSingle();
  const minutosGuardados = nota?.minutos_compensados ?? 0;
  if (minutosGuardados <= 0) return minutosGuardados;
  const desde = `${fecha}T00:00:00-05:00`;
  const hasta = `${sumarDias(fecha, 1)}T00:00:00-05:00`;
  const { data: marcas } = await supabase
    .from("asistencia_registros")
    .select("tipo, marcado_en")
    .eq("perfil_id", perfilId)
    .gte("marcado_en", desde)
    .lt("marcado_en", hasta)
    .order("marcado_en");
  const recalculado = Math.round(
    Math.max(
      0,
      jornadaOrdinariaHoras(fecha) -
        horasTrabajadasDeMarcas(
          (marcas as { tipo: TipoAsistencia; marcado_en: string }[]) ?? [],
          fecha,
          nota?.hora_entrada_autorizada,
        ),
    ) * 60,
  );
  if (recalculado !== minutosGuardados) {
    await supabase
      .from("asistencia_notas_dia")
      .update({ minutos_compensados: recalculado })
      .eq("perfil_id", perfilId)
      .eq("fecha", fecha);
  }
  return recalculado;
}

const ETIQUETAS_AUSENCIA: Record<"vacaciones" | "incapacidad" | "descanso", string> = {
  vacaciones: "Vacaciones",
  incapacidad: "Incapacidad",
  descanso: "Descanso sabatino",
};

// Un color distinto por tipo de ausencia en las observaciones del reporte —
// antes las tres compartían el mismo azul y no se distinguían a simple vista.
const COLOR_AUSENCIA: Record<"vacaciones" | "incapacidad" | "descanso", string> = {
  vacaciones: "text-sky-700",
  incapacidad: "text-rose-600",
  descanso: "text-orange-600",
};

const ICONOS: Record<TipoAsistencia, typeof LogIn> = {
  llegada: LogIn,
  salida_almuerzo: Coffee,
  entrada_almuerzo: Utensils,
  salida: LogOut,
};

// Un color distinto por botón, en el mismo orden en que pasan durante el
// día (llegada → salida almuerzo → regreso almuerzo → salida) — antes los
// cuatro compartían el mismo color y era fácil tocar el que no era (pasó
// justo con la salida final en vez del regreso de almuerzo).
const COLOR_TIPO: Record<TipoAsistencia, string> = {
  llegada: "#009F98",
  salida_almuerzo: "#F5A524",
  entrada_almuerzo: "#3B82F6",
  salida: "#DC2626",
};

/** Convierte un timestamp a la fecha (YYYY-MM-DD) del día calendario en
 *  Bogotá — los marcado_en se guardan en UTC, así que agrupar por día sin
 *  esto correría el corte de jornada varias horas. */
function fechaBogota(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}

/** "31 de agosto de 2026" a partir de un YYYY-MM-DD. */
function formatFechaLarga(fechaYMD: string): string {
  const [y, m, d] = fechaYMD.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("es-CO", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Lunes (YYYY-MM-DD) de la semana ISO a la que pertenece esa fecha. */
function lunesDeSemana(fechaYMD: string): string {
  const [y, m, d] = fechaYMD.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay();
  dt.setUTCDate(dt.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return dt.toISOString().slice(0, 10);
}

function sumarDias(fechaYMD: string, dias: number): string {
  const [y, m, d] = fechaYMD.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + dias);
  return dt.toISOString().slice(0, 10);
}

function horaBogotaAhora(): string {
  return new Date().toLocaleTimeString("en-GB", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit" });
}

/** 0 = domingo ... 6 = sábado. */
// Debe coincidir con FECHA_INICIO_FRASES del edge function marcar-asistencia
// — antes de esta fecha no se mostró ningún mensaje, así que no tiene sentido
// avisar que "no lo leyó".
const FECHA_INICIO_FRASES = "2026-09-21";

function diaDeSemana(fechaYMD: string): number {
  const [y, m, d] = fechaYMD.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// Sábado es media jornada (8am-12m, sin almuerzo) — el resto de la semana
// es la jornada ordinaria completa (8:30am-6:00pm con 1h de almuerzo).
function horasPorDefecto(fechaYMD: string): Record<TipoAsistencia, string> {
  if (diaDeSemana(fechaYMD) === 6) {
    return { llegada: "08:00", salida_almuerzo: "12:00", entrada_almuerzo: "13:00", salida: "12:00" };
  }
  return { llegada: "08:30", salida_almuerzo: "12:00", entrada_almuerzo: "13:00", salida: "18:00" };
}

interface RegistroReporte {
  perfil_id: string;
  nombre: string;
  tipo: TipoAsistencia;
  marcado_en: string;
}

interface SemanaReporte {
  lunes: string;
  horasTrabajadas: number;
  horas: number;
  horasExtra: number;
  horasDeficit: number;
  diasAusencia: number;
  horasDescuentoAusencia: number;
  horasFestivo: number;
  minutosCompensados: number;
  cuentaParaEsteMes: boolean;
}

interface FilaPersona {
  perfilId: string;
  nombre: string;
  semanas: SemanaReporte[];
  totalHorasExtra: number;
}

interface AusenciaReporte {
  perfil_id: string;
  nombre: string;
  fecha: string;
  tipo: "vacaciones" | "incapacidad" | "descanso";
}

interface CompensacionReporte {
  perfil_id: string;
  fecha: string;
  minutos: number;
}

interface AutorizacionReporte {
  perfil_id: string;
  fecha: string;
  hora: string;
}

/** Arma el reporte de horas del rango (mes calendario o período de
 *  liquidación): agrupa las marcas por persona y día calendario, calcula
 *  horas trabajadas (llegada→salida, descontando el almuerzo si hay
 *  salida/entrada de almuerzo, y sumando de vuelta los minutos ya
 *  compensados de un período anterior — si no, se le estaría restando esa
 *  diferencia dos veces) y las junta en semanas lunes-domingo.
 *  Se muestra cualquier semana que toque el rango (aunque arranque antes),
 *  pero el total de horas extra solo suma las semanas cuyo lunes cae DENTRO
 *  del rango — así una semana partida entre dos rangos se ve en ambos, pero
 *  solo se paga una vez, en el rango donde arrancó.
 */
function armarReporteHoras(
  registros: RegistroReporte[],
  ausencias: AusenciaReporte[],
  compensaciones: CompensacionReporte[],
  autorizaciones: AutorizacionReporte[],
  festivos: Set<string>,
  rangoInicio: string,
  rangoFin: string,
  metaSemanal: number,
): FilaPersona[] {
  const horaAutorizadaPorDia = new Map<string, string>();
  for (const a of autorizaciones) horaAutorizadaPorDia.set(`${a.perfil_id}|${a.fecha}`, a.hora);

  const compensadosPorDia = new Map<string, number>();
  for (const c of compensaciones) {
    compensadosPorDia.set(`${c.perfil_id}|${c.fecha}`, (compensadosPorDia.get(`${c.perfil_id}|${c.fecha}`) ?? 0) + c.minutos);
  }

  const porPersonaYDia = new Map<string, { nombre: string; marcas: Record<string, string> }>();
  for (const r of registros) {
    const dia = fechaBogota(r.marcado_en);
    const clave = `${r.perfil_id}|${dia}`;
    if (!porPersonaYDia.has(clave)) porPersonaYDia.set(clave, { nombre: r.nombre, marcas: {} });
    const entrada = porPersonaYDia.get(clave)!;
    if (!entrada.marcas[r.tipo]) entrada.marcas[r.tipo] = r.marcado_en;
  }

  // Por ley, un festivo entre semana no se le puede descontar a nadie de la
  // meta — se le debe sumar como si hubiera trabajado, igual que el
  // compensado. Es automático (no depende de que alguien lo marque): para
  // cada persona con actividad ese mes, si trabajó menos que la jornada ese
  // día festivo (o nada), se le suma de vuelta la diferencia.
  const personasConocidas = new Map<string, string>();
  for (const clave of porPersonaYDia.keys()) {
    const [perfilId] = clave.split("|");
    if (!personasConocidas.has(perfilId)) personasConocidas.set(perfilId, porPersonaYDia.get(clave)!.nombre);
  }
  const creditoFestivoPorDia = new Map<string, number>();
  for (const [perfilId, nombre] of personasConocidas) {
    for (const fecha of festivos) {
      if (diaDeSemana(fecha) === 6 || diaDeSemana(fecha) === 0) continue; // festivo en fin de semana no aplica
      const marcas = porPersonaYDia.get(`${perfilId}|${fecha}`)?.marcas;
      let horasReales = 0;
      if (marcas?.llegada && marcas?.salida) {
        horasReales = (new Date(marcas.salida).getTime() - new Date(marcas.llegada).getTime()) / 3_600_000;
        if (marcas.salida_almuerzo && marcas.entrada_almuerzo) {
          horasReales -= (new Date(marcas.entrada_almuerzo).getTime() - new Date(marcas.salida_almuerzo).getTime()) / 3_600_000;
        } else {
          // Este bucle ya excluyó los festivos de fin de semana arriba, así
          // que si llegamos acá siempre es un día entre semana.
          horasReales -= 1;
        }
      }
      const credito = Math.max(0, jornadaOrdinariaHoras(fecha) - horasReales);
      if (credito > 0) creditoFestivoPorDia.set(`${perfilId}|${fecha}|${nombre}`, credito);
    }
  }

  const porPersonaYSemana = new Map<
    string,
    { nombre: string; horas: number; minutosCompensados: number; horasFestivo: number }
  >();
  for (const [clave, { nombre, marcas }] of porPersonaYDia) {
    const [perfilId, dia] = clave.split("|");
    if (!marcas.llegada || !marcas.salida) continue;
    // Llegar antes de la hora esperada (normal, o autorizada puntualmente
    // por admin ese día) no suma horas de más — se cuenta desde ahí.
    const llegadaEfectiva = llegadaEfectivaISO(marcas.llegada, dia, horaAutorizadaPorDia.get(clave));
    let horas = (new Date(marcas.salida).getTime() - new Date(llegadaEfectiva).getTime()) / 3_600_000;
    if (marcas.salida_almuerzo && marcas.entrada_almuerzo) {
      horas -= (new Date(marcas.entrada_almuerzo).getTime() - new Date(marcas.salida_almuerzo).getTime()) / 3_600_000;
    } else if (diaDeSemana(dia) !== 6) {
      // No marcó las dos horas de almuerzo entre semana — se asume 1h fija
      // en vez de contarla como trabajada (el sábado no aplica).
      horas -= 1;
    }
    const minutosDia = compensadosPorDia.get(clave) ?? 0;
    horas += minutosDia / 60;
    if (horas <= 0) continue;
    const lunes = lunesDeSemana(dia);
    const claveSemana = `${perfilId}|${lunes}`;
    const acumulado = porPersonaYSemana.get(claveSemana);
    porPersonaYSemana.set(claveSemana, {
      nombre,
      horas: (acumulado?.horas ?? 0) + horas,
      minutosCompensados: (acumulado?.minutosCompensados ?? 0) + minutosDia,
      horasFestivo: acumulado?.horasFestivo ?? 0,
    });
  }
  for (const [clave, credito] of creditoFestivoPorDia) {
    const [perfilId, dia, nombre] = clave.split("|");
    const lunes = lunesDeSemana(dia);
    const claveSemana = `${perfilId}|${lunes}`;
    const acumulado = porPersonaYSemana.get(claveSemana);
    porPersonaYSemana.set(claveSemana, {
      nombre: acumulado?.nombre ?? nombre,
      horas: (acumulado?.horas ?? 0) + credito,
      minutosCompensados: acumulado?.minutosCompensados ?? 0,
      horasFestivo: (acumulado?.horasFestivo ?? 0) + credito,
    });
  }

  // Un día de vacaciones/incapacidad resta una jornada ordinaria (8.5h) de
  // la meta semanal, para no marcarlo como déficit — entre semana sola
  // (8.5h × 5 días = 42.5h) ya se alcanza la meta legal de 42h/semana, así
  // que perder un día entre semana sí puede dejar a alguien por debajo.
  // El descanso sabatino NO resta nada: el sábado siempre fue tiempo extra
  // por encima de esas 42.5h entre semana, nunca parte de la meta — así que
  // descansarlo no crea ningún faltante que compensar.
  const ausenciasPorSemana = new Map<string, { nombre: string; dias: number; horasDescuento: number }>();
  for (const a of ausencias) {
    const lunes = lunesDeSemana(a.fecha);
    const claveSemana = `${a.perfil_id}|${lunes}`;
    const acumulado = ausenciasPorSemana.get(claveSemana);
    ausenciasPorSemana.set(claveSemana, {
      nombre: a.nombre,
      dias: (acumulado?.dias ?? 0) + 1,
      horasDescuento: (acumulado?.horasDescuento ?? 0) + (a.tipo === "descanso" ? 0 : jornadaOrdinariaHoras(a.fecha)),
    });
  }

  const clavesSemana = new Set([...porPersonaYSemana.keys(), ...ausenciasPorSemana.keys()]);

  const porPersona = new Map<string, FilaPersona>();
  for (const claveSemana of clavesSemana) {
    const [perfilId, lunes] = claveSemana.split("|");
    const domingo = sumarDias(lunes, 6);
    // La semana se muestra si toca el rango (aunque haya arrancado antes del
    // rango); el total solo cuenta las semanas que arrancan dentro de él.
    if (domingo < rangoInicio || lunes >= rangoFin) continue;
    const cuentaParaEsteMes = lunes >= rangoInicio && lunes < rangoFin;
    const horas = porPersonaYSemana.get(claveSemana)?.horas ?? 0;
    const minutosCompensados = porPersonaYSemana.get(claveSemana)?.minutosCompensados ?? 0;
    const horasFestivo = porPersonaYSemana.get(claveSemana)?.horasFestivo ?? 0;
    const diasAusencia = ausenciasPorSemana.get(claveSemana)?.dias ?? 0;
    const nombre = porPersonaYSemana.get(claveSemana)?.nombre ?? ausenciasPorSemana.get(claveSemana)?.nombre ?? "—";
    const horasDescuentoAusencia = ausenciasPorSemana.get(claveSemana)?.horasDescuento ?? 0;
    // El festivo no se resta de la meta (por ley no se le puede descontar a
    // nadie) — ya viene sumado dentro de "horas" como si se hubiera trabajado.
    const metaAjustada = Math.max(0, metaSemanal - horasDescuentoAusencia);
    if (!porPersona.has(perfilId)) porPersona.set(perfilId, { perfilId, nombre, semanas: [], totalHorasExtra: 0 });
    const fila = porPersona.get(perfilId)!;
    const horasExtra = Math.max(0, horas - metaAjustada);
    const horasDeficit = Math.max(0, metaAjustada - horas);
    const horasTrabajadas = horas - minutosCompensados / 60 - horasFestivo;
    fila.semanas.push({
      lunes,
      horasTrabajadas,
      horas,
      horasExtra,
      horasDeficit,
      diasAusencia,
      horasDescuentoAusencia,
      horasFestivo,
      minutosCompensados,
      cuentaParaEsteMes,
    });
    if (cuentaParaEsteMes) fila.totalHorasExtra += horasExtra;
  }

  return Array.from(porPersona.values())
    .map((f) => ({ ...f, semanas: f.semanas.sort((a, b) => a.lunes.localeCompare(b.lunes)) }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/** Marcar la jornada (llegada, salida/entrada de almuerzo, salida final) — la
 *  IP se valida del lado del servidor (edge function marcar-asistencia), no
 *  acá, porque un dato mandado desde el navegador se podría falsificar. Al
 *  marcar llegada o salida final, el edge function devuelve una frase del
 *  día (motivadora o de agradecimiento) que hay que cerrar para continuar. */
export function Asistencia() {
  const { perfil } = useAuth();
  const [marcando, setMarcando] = useState<TipoAsistencia | null>(null);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [registros, setRegistros] = useState<AsistenciaRegistro[]>([]);
  const [frase, setFrase] = useState<{ tipo: "llegada" | "salida"; texto: string; fecha: string } | null>(null);

  // Alerta administrativa: cada intento de marcar rechazado por no estar en
  // la red de la sede queda acá — para que Tomás/Sirley vean quién intentó
  // marcar sin estar físicamente presente. Se puede marcar como "leído" para
  // que desaparezca de la alerta activa sin borrarse — el historial completo
  // (leídos incluidos) queda aparte, más abajo.
  const [intentosBloqueados, setIntentosBloqueados] = useState<
    { id: string; nombre: string; tipo: TipoAsistencia; ip: string | null; creado_en: string }[]
  >([]);
  const [historialIntentos, setHistorialIntentos] = useState<
    { id: string; nombre: string; tipo: TipoAsistencia; ip: string | null; creado_en: string; leido: boolean }[]
  >([]);
  const [verHistorialIntentos, setVerHistorialIntentos] = useState(false);

  async function cargarIntentosBloqueados() {
    if (perfil?.rol !== "admin") return;
    const { data } = await supabase
      .from("asistencia_intentos_bloqueados")
      .select("id, tipo, ip, creado_en, perfiles(nombre)")
      .eq("leido", false)
      .order("creado_en", { ascending: false })
      .limit(20);
    setIntentosBloqueados(
      ((data as unknown as {
        id: string; tipo: TipoAsistencia; ip: string | null; creado_en: string; perfiles: { nombre: string } | null;
      }[]) ?? []).map((r) => ({ id: r.id, nombre: r.perfiles?.nombre ?? "—", tipo: r.tipo, ip: r.ip, creado_en: r.creado_en })),
    );
  }

  async function cargarHistorialIntentos() {
    const { data } = await supabase
      .from("asistencia_intentos_bloqueados")
      .select("id, tipo, ip, creado_en, leido, perfiles(nombre)")
      .order("creado_en", { ascending: false })
      .limit(100);
    setHistorialIntentos(
      ((data as unknown as {
        id: string; tipo: TipoAsistencia; ip: string | null; creado_en: string; leido: boolean;
        perfiles: { nombre: string } | null;
      }[]) ?? []).map((r) => ({
        id: r.id, nombre: r.perfiles?.nombre ?? "—", tipo: r.tipo, ip: r.ip, creado_en: r.creado_en, leido: r.leido,
      })),
    );
  }

  async function marcarLeidoIntento(id: string) {
    await supabase.from("asistencia_intentos_bloqueados").update({ leido: true }).eq("id", id);
    setIntentosBloqueados((prev) => prev.filter((i) => i.id !== id));
    if (verHistorialIntentos) cargarHistorialIntentos();
  }

  useEffect(() => {
    cargarIntentosBloqueados();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfil?.rol]);

  useEffect(() => {
    if (!verHistorialIntentos) return;
    cargarHistorialIntentos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verHistorialIntentos]);

  // Dashboard del día para admin: quién ha marcado y a qué hora — de un
  // vistazo, sin tener que abrir persona por persona en "Registrar
  // asistencia". Por defecto hoy, pero se puede mirar cualquier otro día.
  const [fechaDashboard, setFechaDashboard] = useState(() => fechaBogota(new Date().toISOString()));
  const [marcasDashboard, setMarcasDashboard] = useState<Record<string, Partial<Record<TipoAsistencia, string>>>>({});
  // Sede real donde marcó ese día (de la marca en sí, no la sede fija del
  // perfil) — para alguien como Sirley, que no tiene una sede fija asignada
  // y puede marcar en cualquiera de las dos, así se ve dónde estuvo hoy en
  // vez de quedar siempre en blanco.
  const [sedeDelDiaDashboard, setSedeDelDiaDashboard] = useState<Record<string, string>>({});
  // Hora de entrada autorizada ese día por persona (si admin ya la puso) —
  // para saber si una llegada distinta a la normal ya está justificada o
  // todavía hay que revisarla.
  const [horaAutorizadaDashboard, setHoraAutorizadaDashboard] = useState<Record<string, string>>({});
  const [horaSalidaAutorizadaDashboard, setHoraSalidaAutorizadaDashboard] = useState<Record<string, string>>({});
  // Quién confirmó haber leído el mensaje de llegada/salida ese día (clave
  // "perfilId|tipo") — para avisar a admin quién no lo está leyendo.
  const [frasesLeidasDashboard, setFrasesLeidasDashboard] = useState<Set<string>>(new Set());
  const [cargandoDashboard, setCargandoDashboard] = useState(true);

  async function cargarDashboardHoy() {
    setCargandoDashboard(true);
    const desde = `${fechaDashboard}T00:00:00-05:00`;
    const hasta = `${sumarDias(fechaDashboard, 1)}T00:00:00-05:00`;
    const { data } = await supabase
      .from("asistencia_registros")
      .select("perfil_id, tipo, marcado_en, sedes(nombre)")
      .gte("marcado_en", desde)
      .lt("marcado_en", hasta)
      .order("marcado_en");
    const mapa: Record<string, Partial<Record<TipoAsistencia, string>>> = {};
    const sedeDia: Record<string, string> = {};
    for (const r of (data as unknown as {
      perfil_id: string; tipo: TipoAsistencia; marcado_en: string; sedes: { nombre: string } | null;
    }[]) ?? []) {
      const entrada = (mapa[r.perfil_id] ??= {});
      if (!entrada[r.tipo]) entrada[r.tipo] = r.marcado_en;
      // La sede de la llegada manda; si no marcó llegada ese día, se queda
      // con la de la primera marca que sí tenga (por el order() de arriba).
      if (r.sedes?.nombre && (r.tipo === "llegada" || !sedeDia[r.perfil_id])) {
        sedeDia[r.perfil_id] = r.sedes.nombre;
      }
    }
    setMarcasDashboard(mapa);
    setSedeDelDiaDashboard(sedeDia);
    const { data: notasData } = await supabase
      .from("asistencia_notas_dia")
      .select("perfil_id, hora_entrada_autorizada, hora_salida_autorizada")
      .eq("fecha", fechaDashboard)
      .or("hora_entrada_autorizada.not.is.null,hora_salida_autorizada.not.is.null");
    const autorizadas: Record<string, string> = {};
    const autorizadasSalida: Record<string, string> = {};
    for (const n of (notasData as {
      perfil_id: string; hora_entrada_autorizada: string | null; hora_salida_autorizada: string | null;
    }[]) ?? []) {
      if (n.hora_entrada_autorizada) autorizadas[n.perfil_id] = n.hora_entrada_autorizada.slice(0, 5);
      if (n.hora_salida_autorizada) autorizadasSalida[n.perfil_id] = n.hora_salida_autorizada.slice(0, 5);
    }
    setHoraAutorizadaDashboard(autorizadas);
    setHoraSalidaAutorizadaDashboard(autorizadasSalida);
    const { data: leidasData } = await supabase
      .from("asistencia_frases_leidas")
      .select("perfil_id, tipo")
      .eq("fecha", fechaDashboard);
    setFrasesLeidasDashboard(
      new Set((leidasData as { perfil_id: string; tipo: string }[] ?? []).map((l) => `${l.perfil_id}|${l.tipo}`)),
    );
    setCargandoDashboard(false);
  }

  useEffect(() => {
    if (perfil?.rol !== "admin") return;
    cargarDashboardHoy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfil?.rol, fechaDashboard]);

  const [metaSemanal, setMetaSemanal] = useState(42);
  const [reporte, setReporte] = useState<FilaPersona[]>([]);
  const [cargandoReporte, setCargandoReporte] = useState(true);
  const [notasPorPersona, setNotasPorPersona] = useState<
    Record<string, { fecha: string; nota: string; minutosCompensados: number }[]>
  >({});
  const [ausenciasPorPersona, setAusenciasPorPersona] = useState<
    Record<string, { fecha: string; tipo: "vacaciones" | "incapacidad" | "descanso" }[]>
  >({});

  // El reporte se puede ver por mes calendario o por período de liquidación
  // real (ej. 31 ago - 27 sept) — el ciclo de pago no coincide con el mes.
  const [periodosLiquidacion, setPeriodosLiquidacion] = useState<PeriodoLiquidacion[]>([]);
  const [periodoReporteId, setPeriodoReporteId] = useState("");
  const [etiquetaPeriodoNueva, setEtiquetaPeriodoNueva] = useState("");
  const [inicioPeriodoNuevo, setInicioPeriodoNuevo] = useState("");
  const [finPeriodoNuevo, setFinPeriodoNuevo] = useState("");
  const [guardandoPeriodo, setGuardandoPeriodo] = useState(false);
  const [errorPeriodoLiq, setErrorPeriodoLiq] = useState<string | null>(null);

  // Festivos de Colombia — aplican parejo a todo el mundo, no se marcan
  // persona por persona.
  const [festivos, setFestivos] = useState<FestivoColombia[]>([]);
  const [fechaFestivoNueva, setFechaFestivoNueva] = useState("");
  const [nombreFestivoNuevo, setNombreFestivoNuevo] = useState("");
  const [guardandoFestivo, setGuardandoFestivo] = useState(false);
  const [errorFestivo, setErrorFestivo] = useState<string | null>(null);

  // Registro administrativo: admin carga/corrige la asistencia de cualquier
  // persona (para cargar retroactivo un período completo) y deja notas por
  // día explicando horas fuera de lo normal — inserta directo a la tabla
  // (RLS lo permite solo a admin), sin pasar por el edge function de
  // marcado en vivo, que no aplica acá.
  const [personas, setPersonas] = useState<
    { id: string; nombre: string; sede_id: string | null; sedeNombre: string | null }[]
  >([]);
  const [personaAdminId, setPersonaAdminId] = useState("");
  const [fechaAdmin, setFechaAdmin] = useState(() => fechaBogota(new Date().toISOString()));
  const [marcasPersona, setMarcasPersona] = useState<AsistenciaRegistro[]>([]);
  const [notaPersona, setNotaPersona] = useState("");
  const [notaOriginal, setNotaOriginal] = useState("");
  const [esCompensado, setEsCompensado] = useState(false);
  const [esCompensadoOriginal, setEsCompensadoOriginal] = useState(false);
  // Hora en la que admin autoriza puntualmente que empiece a contar la
  // jornada ese día (ej. reunión desde las 8am, alguien autorizado a
  // entrar a las 10am) — llegar antes de esto no suma horas de más.
  const [horaEntradaAutorizada, setHoraEntradaAutorizada] = useState("");
  const [horaEntradaAutorizadaOriginal, setHoraEntradaAutorizadaOriginal] = useState("");
  // Igual que arriba pero para la salida — no cambia el cálculo de horas
  // (salir temprano de verdad resta horas trabajadas; para perdonar eso está
  // "Compensado de tiempo"), solo apaga la alerta del dashboard una vez
  // revisada.
  const [horaSalidaAutorizada, setHoraSalidaAutorizada] = useState("");
  const [horaSalidaAutorizadaOriginal, setHoraSalidaAutorizadaOriginal] = useState("");
  // Para dejar "Compensado" programado ANTES de que la persona marque ese
  // día (ej. hoy programar mañana) — como todavía no hay llegada/salida
  // reales, no se puede calcular el faltante solo, así que se escribe a
  // mano. Una vez la persona marque, recalcularCompensadoDia lo recalcula
  // contra las marcas reales y corrige el número solo, sin volver acá.
  const [minutosCompensadoManual, setMinutosCompensadoManual] = useState("");
  const [minutosCompensadoManualOriginal, setMinutosCompensadoManualOriginal] = useState("");
  const [ausenciaPersona, setAusenciaPersona] = useState<{
    id: string;
    tipo: "vacaciones" | "incapacidad" | "descanso";
  } | null>(null);
  const [horaNueva, setHoraNueva] = useState<Record<TipoAsistencia, string>>(() =>
    horasPorDefecto(fechaBogota(new Date().toISOString())),
  );
  const [guardandoAdmin, setGuardandoAdmin] = useState(false);
  const [errorAdmin, setErrorAdmin] = useState<string | null>(null);

  // Listado aparte de control de vacaciones/incapacidades/descansos —
  // independiente del reporte de horas, para verlos todos juntos por mes.
  const [controlMes, setControlMes] = useState(() => new Date().toISOString().slice(0, 7));
  const [controlAusencias, setControlAusencias] = useState<
    { perfil_id: string; nombre: string; fecha: string; tipo: "vacaciones" | "incapacidad" | "descanso" }[]
  >([]);

  // Solicitudes de horas extra por atención de un paciente fuera de la
  // jornada normal — antes se avisaba por un grupo de WhatsApp aparte y no
  // quedaba nada registrado. Al finalizar la solicitud se carga sola la
  // hora de salida real de cada colaborador involucrado.
  const [doctoras, setDoctoras] = useState<Doctora[]>([]);
  const [solicitudesHE, setSolicitudesHE] = useState<
    (SolicitudHorasExtra & { colaboradores: (ColaboradorHorasExtra & { nombre: string })[] })[]
  >([]);
  const [heFecha, setHeFecha] = useState(() => fechaBogota(new Date().toISOString()));
  const [heDoctoraId, setHeDoctoraId] = useState("");
  const [heColaboradoresIds, setHeColaboradoresIds] = useState<string[]>([]);
  const [hePacienteNombre, setHePacienteNombre] = useState("");
  const [heMotivo, setHeMotivo] = useState("");
  const [guardandoHE, setGuardandoHE] = useState(false);
  const [errorHE, setErrorHE] = useState<string | null>(null);
  const [finalizarForm, setFinalizarForm] = useState<
    Record<string, { pacientePago: boolean | null; seAgendoCita: boolean | null; tareas: Record<string, string> }>
  >({});
  const [guardandoFinalizarHE, setGuardandoFinalizarHE] = useState<string | null>(null);

  // Horas extra de atención acumuladas por persona y semana (a partir de las
  // solicitudes finalizadas de arriba) — se muestran aparte en el reporte
  // para diferenciarlas del resto de horas trabajadas normales.
  const [extraAtencionPorPersonaYSemana, setExtraAtencionPorPersonaYSemana] = useState<Record<string, number>>({});
  const [extraAtencionPorPersonaYDia, setExtraAtencionPorPersonaYDia] = useState<Record<string, number>>({});

  useEffect(() => {
    // Operación también necesita esta lista para elegir colaboradores en
    // "Horas extra por atención de paciente" — el resto de usos de `personas`
    // (correcciones manuales, dashboard del día) siguen ocultos para ellos
    // porque esas secciones de abajo se quedan admin-only.
    if (perfil?.rol !== "admin" && perfil?.rol !== "operacion") return;
    supabase
      .from("perfiles")
      // El laboratorio externo (ej. Ruby) no marca asistencia por sede — se
      // excluye acá para que no aparezca en las correcciones manuales, en
      // las horas extra por atención ni en el dashboard del día.
      .select("id, nombre, sede_id, sedes(nombre)")
      .neq("rol", "laboratorio")
      .order("nombre")
      .then(({ data }) => {
        const filas = ((data as unknown as { id: string; nombre: string; sede_id: string | null; sedes: { nombre: string } | null }[]) ?? []).map(
          (p) => ({ id: p.id, nombre: p.nombre, sede_id: p.sede_id, sedeNombre: p.sedes?.nombre ?? null }),
        );
        setPersonas(filas);
        // Solo admin usa "Registro administrativo" (más abajo) — a operación
        // no le hace falta preseleccionar a nadie ahí.
        if (perfil?.rol === "admin" && filas.length > 0) setPersonaAdminId((prev) => prev || filas[0].id);
      });
  }, [perfil?.rol]);

  async function cargarMarcasPersona() {
    if (!personaAdminId) return;
    const desde = `${fechaAdmin}T00:00:00-05:00`;
    const hasta = `${sumarDias(fechaAdmin, 1)}T00:00:00-05:00`;
    const { data } = await supabase
      .from("asistencia_registros")
      .select("*")
      .eq("perfil_id", personaAdminId)
      .gte("marcado_en", desde)
      .lt("marcado_en", hasta)
      .order("marcado_en");
    const marcas = (data as AsistenciaRegistro[]) ?? [];
    setMarcasPersona(marcas);
    const { data: nota } = await supabase
      .from("asistencia_notas_dia")
      .select("nota, hora_entrada_autorizada, hora_salida_autorizada")
      .eq("perfil_id", personaAdminId)
      .eq("fecha", fechaAdmin)
      .maybeSingle();
    const minutosCompensados = await recalcularCompensadoDia(personaAdminId, fechaAdmin);
    setNotaPersona(nota?.nota ?? "");
    setNotaOriginal(nota?.nota ?? "");
    setEsCompensado(minutosCompensados > 0);
    setEsCompensadoOriginal(minutosCompensados > 0);
    // Si ese día no hay llegada y salida cargadas todavía, "compensado" no se
    // pudo calcular solo — lo que haya guardado es el estimado escrito a mano.
    const hayLlegadaYSalida = marcas.some((m) => m.tipo === "llegada") && marcas.some((m) => m.tipo === "salida");
    const manual = !hayLlegadaYSalida && minutosCompensados > 0 ? String(minutosCompensados) : "";
    setMinutosCompensadoManual(manual);
    setMinutosCompensadoManualOriginal(manual);
    const horaAutorizada = nota?.hora_entrada_autorizada?.slice(0, 5) ?? "";
    setHoraEntradaAutorizada(horaAutorizada);
    setHoraEntradaAutorizadaOriginal(horaAutorizada);
    const horaSalidaAutorizadaValor = nota?.hora_salida_autorizada?.slice(0, 5) ?? "";
    setHoraSalidaAutorizada(horaSalidaAutorizadaValor);
    setHoraSalidaAutorizadaOriginal(horaSalidaAutorizadaValor);
    const { data: ausencia } = await supabase
      .from("asistencia_ausencias")
      .select("id, tipo")
      .eq("perfil_id", personaAdminId)
      .eq("fecha", fechaAdmin)
      .maybeSingle();
    setAusenciaPersona(ausencia ?? null);
  }

  useEffect(() => {
    cargarMarcasPersona();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personaAdminId, fechaAdmin]);

  useEffect(() => {
    setHoraNueva(horasPorDefecto(fechaAdmin));
  }, [fechaAdmin]);

  async function agregarMarcaPersona(tipo: TipoAsistencia) {
    const persona = personas.find((p) => p.id === personaAdminId);
    if (!persona) return;
    setErrorAdmin(null);
    const marcadoEn = new Date(`${fechaAdmin}T${horaNueva[tipo]}:00-05:00`).toISOString();
    const { error } = await supabase.from("asistencia_registros").insert({
      perfil_id: persona.id,
      sede_id: persona.sede_id,
      tipo,
      marcado_en: marcadoEn,
    });
    if (error) {
      setErrorAdmin(error.message);
      return;
    }
    await cargarMarcasPersona();
    cargarReporte();
    cargarDashboardHoy();
  }

  async function eliminarMarcaPersona(id: string) {
    setErrorAdmin(null);
    const { error } = await supabase.from("asistencia_registros").delete().eq("id", id);
    if (error) {
      setErrorAdmin(error.message);
      return;
    }
    await cargarMarcasPersona();
    cargarReporte();
    cargarDashboardHoy();
  }

  async function guardarNotaPersona() {
    // El check de "compensado" no pide un número — calcula solo cuánto le
    // faltó ese día contra la jornada ordinaria (8.5h entre semana, 4h
    // sábado) y ese faltante se suma de vuelta a las horas de la semana en
    // el reporte, para no descontarlo dos veces (ya estaba a su favor de un
    // período anterior).
    // Si todavía no hay llegada y salida cargadas ese día (ej. se está
    // programando de un día para otro, antes de que la persona marque), no
    // se puede calcular el faltante solo — se usa el estimado escrito a
    // mano. Una vez la persona marque, recalcularCompensadoDia lo corrige
    // solo contra las horas reales la próxima vez que se abra este día.
    const hayLlegadaYSalida = marcasPersona.some((m) => m.tipo === "llegada") && marcasPersona.some((m) => m.tipo === "salida");
    if (esCompensado && !hayLlegadaYSalida && !minutosCompensadoManual.trim()) {
      setErrorAdmin(
        'Todavía no hay llegada y salida cargadas ese día — escribe cuántos minutos aproximados vas a compensarle (se ajusta solo cuando la persona marque).',
      );
      return;
    }
    setGuardandoAdmin(true);
    setErrorAdmin(null);
    const minutosCompensados = esCompensado
      ? hayLlegadaYSalida
        ? Math.round(
            Math.max(
              0,
              jornadaOrdinariaHoras(fechaAdmin) - horasTrabajadasDeMarcas(marcasPersona, fechaAdmin, horaEntradaAutorizada || null),
            ) * 60,
          )
        : Math.max(0, Math.round(Number(minutosCompensadoManual) || 0))
      : 0;
    const { error } = await supabase.from("asistencia_notas_dia").upsert(
      {
        perfil_id: personaAdminId,
        fecha: fechaAdmin,
        nota: notaPersona.trim(),
        minutos_compensados: minutosCompensados,
        hora_entrada_autorizada: horaEntradaAutorizada || null,
        hora_salida_autorizada: horaSalidaAutorizada || null,
        created_by: perfil?.id ?? null,
      },
      { onConflict: "perfil_id,fecha" },
    );
    setGuardandoAdmin(false);
    if (error) {
      setErrorAdmin(error.message);
      return;
    }
    setNotaOriginal(notaPersona.trim());
    setEsCompensadoOriginal(esCompensado);
    setHoraEntradaAutorizadaOriginal(horaEntradaAutorizada);
    setHoraSalidaAutorizadaOriginal(horaSalidaAutorizada);
    setMinutosCompensadoManualOriginal(minutosCompensadoManual);
    cargarReporte();
    cargarDashboardHoy();
  }

  async function marcarAusencia(tipo: "vacaciones" | "incapacidad" | "descanso") {
    setGuardandoAdmin(true);
    setErrorAdmin(null);
    const { data, error } = await supabase
      .from("asistencia_ausencias")
      .upsert(
        { perfil_id: personaAdminId, fecha: fechaAdmin, tipo, created_by: perfil?.id ?? null },
        { onConflict: "perfil_id,fecha" },
      )
      .select("id, tipo")
      .single();
    setGuardandoAdmin(false);
    if (error) {
      setErrorAdmin(error.message);
      return;
    }
    setAusenciaPersona(data);
    cargarReporte();
    cargarControlAusencias();
  }

  async function quitarAusencia() {
    if (!ausenciaPersona) return;
    setGuardandoAdmin(true);
    setErrorAdmin(null);
    const { error } = await supabase.from("asistencia_ausencias").delete().eq("id", ausenciaPersona.id);
    setGuardandoAdmin(false);
    if (error) {
      setErrorAdmin(error.message);
      return;
    }
    setAusenciaPersona(null);
    cargarReporte();
    cargarControlAusencias();
  }

  async function cargarRegistros() {
    if (!perfil) return;
    const hoy = fechaBogota(new Date().toISOString());
    const desde = `${hoy}T00:00:00-05:00`;
    const hasta = `${sumarDias(hoy, 1)}T00:00:00-05:00`;
    const { data } = await supabase
      .from("asistencia_registros")
      .select("*")
      .eq("perfil_id", perfil.id)
      .gte("marcado_en", desde)
      .lt("marcado_en", hasta)
      .order("marcado_en", { ascending: false });
    setRegistros((data as AsistenciaRegistro[]) ?? []);
  }

  useEffect(() => {
    cargarRegistros();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfil?.id]);

  useEffect(() => {
    supabase
      .from("precios_config")
      .select("valor")
      .eq("clave", "horas_semana_meta")
      .maybeSingle()
      .then(({ data }) => {
        if (data) setMetaSemanal(Number(data.valor));
      });
  }, []);

  // Rango real que se está mostrando: el período de liquidación elegido
  // (ej. 31 ago - 27 sept, que no coincide con el mes calendario).
  function rangoReporte(): { inicio: string; fin: string } | null {
    const p = periodosLiquidacion.find((x) => x.id === periodoReporteId);
    if (!p) return null;
    return { inicio: p.fecha_inicio, fin: sumarDias(p.fecha_fin, 1) };
  }

  async function cargarReporte() {
    const rango = rangoReporte();
    if (!rango) {
      setReporte([]);
      setCargandoReporte(false);
      return;
    }
    setCargandoReporte(true);
    // Se pide con 8 días de colchón a cada lado para que las semanas que
    // cruzan el borde del rango queden completas (armarReporteHoras las
    // filtra después por si el lunes de cada semana cae dentro o no).
    const desde = sumarDias(rango.inicio, -8);
    const hasta = sumarDias(rango.fin, 8);
    const { data } = await supabase
      .from("asistencia_registros")
      .select("perfil_id, tipo, marcado_en, perfiles(nombre)")
      // -05:00 explícito: sin esto, Postgres interpreta la fecha sola como
      // medianoche UTC (no medianoche Bogotá), corriendo el corte 5 horas —
      // el colchón de 8 días de arriba lo disimula, pero mejor no depender
      // de eso. order() hace determinista cuál marca "gana" si algún día
      // llega a quedar más de una del mismo tipo (ver armarReporteHoras).
      .gte("marcado_en", `${desde}T00:00:00-05:00`)
      .lt("marcado_en", `${hasta}T00:00:00-05:00`)
      .order("marcado_en");
    const filas = ((data as unknown as { perfil_id: string; tipo: TipoAsistencia; marcado_en: string; perfiles: { nombre: string } | null }[]) ?? []).map(
      (r) => ({ perfil_id: r.perfil_id, tipo: r.tipo, marcado_en: r.marcado_en, nombre: r.perfiles?.nombre ?? "—" }),
    );

    const { data: ausenciasData } = await supabase
      .from("asistencia_ausencias")
      .select("perfil_id, fecha, tipo, perfiles!asistencia_vacaciones_perfil_id_fkey(nombre)")
      .gte("fecha", desde)
      .lt("fecha", hasta);
    const ausenciasRows =
      (ausenciasData as unknown as {
        perfil_id: string;
        fecha: string;
        tipo: "vacaciones" | "incapacidad" | "descanso";
        perfiles: { nombre: string } | null;
      }[]) ?? [];
    const ausencias: AusenciaReporte[] = ausenciasRows.map((a) => ({
      perfil_id: a.perfil_id,
      fecha: a.fecha,
      nombre: a.perfiles?.nombre ?? "—",
      tipo: a.tipo,
    }));
    const ausenciasAgrupadas: Record<string, { fecha: string; tipo: "vacaciones" | "incapacidad" | "descanso" }[]> = {};
    for (const a of ausenciasRows) {
      (ausenciasAgrupadas[a.perfil_id] ??= []).push({ fecha: a.fecha, tipo: a.tipo });
    }
    setAusenciasPorPersona(ausenciasAgrupadas);

    const { data: notas } = await supabase
      .from("asistencia_notas_dia")
      .select("perfil_id, fecha, nota, minutos_compensados, hora_entrada_autorizada")
      .gte("fecha", desde)
      .lt("fecha", hasta);
    const notasRows =
      (notas as {
        perfil_id: string; fecha: string; nota: string; minutos_compensados: number; hora_entrada_autorizada: string | null;
      }[]) ?? [];
    const notasAgrupadas: Record<string, { fecha: string; nota: string; minutosCompensados: number }[]> = {};
    for (const n of notasRows) {
      if (n.nota || n.minutos_compensados) {
        (notasAgrupadas[n.perfil_id] ??= []).push({ fecha: n.fecha, nota: n.nota, minutosCompensados: n.minutos_compensados });
      }
    }
    setNotasPorPersona(notasAgrupadas);
    const compensaciones: CompensacionReporte[] = notasRows
      .filter((n) => n.minutos_compensados)
      .map((n) => ({ perfil_id: n.perfil_id, fecha: n.fecha, minutos: n.minutos_compensados }));
    const autorizaciones: AutorizacionReporte[] = notasRows
      .filter((n) => n.hora_entrada_autorizada)
      .map((n) => ({ perfil_id: n.perfil_id, fecha: n.fecha, hora: n.hora_entrada_autorizada as string }));

    const { data: festivosData } = await supabase.from("festivos_colombia").select("fecha").gte("fecha", desde).lt("fecha", hasta);
    const festivosSet = new Set((festivosData ?? []).map((f) => f.fecha as string));

    // Horas extra por atención de paciente ya cargadas (ver sección de
    // solicitudes arriba) — se calculan aparte de "horas" porque ya están
    // incluidas ahí a través de la marca de salida real; esto solo separa
    // cuánto de esa hora extra vino de una atención documentada.
    const { data: heData } = await supabase
      .from("asistencia_horas_extra_colaboradores")
      .select("perfil_id, hora_salida, asistencia_horas_extra(fecha)")
      .not("hora_salida", "is", null);
    const extraAtencion: Record<string, number> = {};
    const extraAtencionDia: Record<string, number> = {};
    for (const row of (heData as unknown as {
      perfil_id: string;
      hora_salida: string;
      asistencia_horas_extra: { fecha: string } | null;
    }[]) ?? []) {
      const fechaHE = row.asistencia_horas_extra?.fecha;
      if (!fechaHE || fechaHE < desde || fechaHE >= hasta) continue;
      const finNormal = horasPorDefecto(fechaHE).salida;
      const finNormalMs = new Date(`${fechaHE}T${finNormal}:00-05:00`).getTime();
      const extra = Math.max(0, (new Date(row.hora_salida).getTime() - finNormalMs) / 3_600_000);
      if (extra <= 0) continue;
      const claveSemana = `${row.perfil_id}|${lunesDeSemana(fechaHE)}`;
      extraAtencion[claveSemana] = (extraAtencion[claveSemana] ?? 0) + extra;
      const claveDia = `${row.perfil_id}|${fechaHE}`;
      extraAtencionDia[claveDia] = (extraAtencionDia[claveDia] ?? 0) + extra;
    }
    setExtraAtencionPorPersonaYSemana(extraAtencion);
    setExtraAtencionPorPersonaYDia(extraAtencionDia);

    setReporte(
      armarReporteHoras(filas, ausencias, compensaciones, autorizaciones, festivosSet, rango.inicio, rango.fin, metaSemanal),
    );
    setCargandoReporte(false);
  }

  useEffect(() => {
    cargarReporte();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metaSemanal, periodoReporteId]);

  // PDF de la liquidación del período que se está viendo, con un espacio de
  // firma por persona junto a sus horas compensadas/incapacidades — para
  // que cada quien firme que está de acuerdo con lo que se le está pagando.
  function descargarReportePdf() {
    const rango = rangoReporte();
    const etiquetaRango = periodosLiquidacion.find((p) => p.id === periodoReporteId)?.etiqueta ?? "Período";

    const bloques = reporte
      .map((fila) => {
        const filasSemana = fila.semanas
          .map(
            (s) => `<tr class="${s.cuentaParaEsteMes ? "" : "fuera"}">
              <td>${s.lunes} — ${sumarDias(s.lunes, 6)}</td>
              <td class="num">${s.horasTrabajadas.toFixed(1)}</td>
              <td class="num">${s.minutosCompensados > 0 ? (s.minutosCompensados / 60).toFixed(1) : "—"}</td>
              <td class="num">${s.horasFestivo > 0 ? "+" + s.horasFestivo.toFixed(1) : "—"}</td>
              <td class="num">${
                (extraAtencionPorPersonaYSemana[`${fila.perfilId}|${s.lunes}`] ?? 0) > 0
                  ? (extraAtencionPorPersonaYSemana[`${fila.perfilId}|${s.lunes}`] ?? 0).toFixed(1)
                  : "—"
              }</td>
              <td class="num">${s.horasDescuentoAusencia > 0 ? "+" + s.horasDescuentoAusencia.toFixed(1) : "—"}</td>
              <td class="num tot">${(s.horas + s.horasDescuentoAusencia).toFixed(1)}</td>
              <td class="num">${s.horasExtra > 0 ? s.horasExtra.toFixed(1) : "—"}</td>
              <td class="num">${s.horasDeficit > 0 ? s.horasDeficit.toFixed(1) : "—"}</td>
            </tr>`,
          )
          .join("");
        const COLOR_AUSENCIA_HEX: Record<"vacaciones" | "incapacidad" | "descanso", string> = {
          vacaciones: "#0369a1",
          incapacidad: "#e11d48",
          descanso: "#ea580c",
        };
        const observaciones = [
          ...(ausenciasPorPersona[fila.perfilId] ?? []).map((a) => ({
            fecha: a.fecha,
            texto: ETIQUETAS_AUSENCIA[a.tipo],
            color: COLOR_AUSENCIA_HEX[a.tipo],
          })),
          ...(notasPorPersona[fila.perfilId] ?? []).map((n) => ({
            fecha: n.fecha,
            texto: n.nota + (n.minutosCompensados > 0 ? ` (+${n.minutosCompensados}min comp.)` : ""),
            color: "#666",
          })),
          ...Object.entries(extraAtencionPorPersonaYDia)
            .filter(([clave]) => clave.startsWith(`${fila.perfilId}|`))
            .map(([clave, horas]) => ({
              fecha: clave.split("|")[1],
              texto: `${Math.round(horas * 60)} minutos extra acumulados por atención de paciente`,
              color: "#db2777",
            })),
        ].sort((a, b) => a.fecha.localeCompare(b.fecha));
        const observacionesHtml =
          observaciones.length > 0
            ? `<div class="obs">${observaciones
                .map((o) => `<p style="color:${o.color}"><strong>${formatFechaLarga(o.fecha)}:</strong> ${escPdf(o.texto)}</p>`)
                .join("")}</div>`
            : "";
        return `<div class="persona">
          <div class="col-tabla">
            <div class="nombre-linea">
              <strong>${escPdf(fila.nombre)}</strong>
              <span>Horas extra: <strong>${fila.totalHorasExtra.toFixed(1)} h</strong></span>
            </div>
            <table>
              <thead><tr><th>Semana</th><th>Trabaj.</th><th>Comp.</th><th>Festivo</th><th>Atención</th><th>Ausencia</th><th>Total</th><th>Extra</th><th>Déficit</th></tr></thead>
              <tbody>${filasSemana}</tbody>
            </table>
            ${observacionesHtml}
          </div>
          <div class="col-firma">
            <p class="titulo-firma">Confirmo que estoy de acuerdo con esta liquidación de horas.</p>
            <div class="linea-firma">Firma</div>
            <div class="linea-firma">Fecha</div>
          </div>
        </div>`;
      })
      .join("");

    const html = `<!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Liquidación de horas — ${escPdf(etiquetaRango)}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #2a2438; }
            h1 { font-size: 18px; margin-bottom: 4px; }
            .subtitulo { color: #777; font-size: 12px; margin-bottom: 20px; }
            .persona { display: flex; gap: 24px; border: 1px solid #ddd; border-radius: 8px; padding: 14px; margin-bottom: 16px; page-break-inside: avoid; }
            .col-tabla { flex: 2; }
            .col-firma { flex: 1; border-left: 1px dashed #bbb; padding-left: 18px; display: flex; flex-direction: column; justify-content: flex-end; }
            .nombre-linea { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; }
            th, td { padding: 4px 6px; border-bottom: 1px solid #eee; text-align: left; }
            th { color: #888; font-weight: 500; }
            td.num { text-align: right; }
            td.tot { font-weight: 600; }
            tr.fuera { opacity: 0.5; }
            .obs { margin-top: 8px; font-size: 10px; color: #666; }
            .obs p { margin: 2px 0; }
            .titulo-firma { font-size: 11px; color: #555; margin-bottom: 40px; }
            .linea-firma { border-top: 1px solid #333; padding-top: 4px; font-size: 11px; color: #555; margin-top: 28px; }
            .btn-imprimir { margin-bottom: 16px; }
            @media print { .btn-imprimir { display: none; } }
          </style>
        </head>
        <body>
          <button class="btn-imprimir" onclick="window.print()">Imprimir / Guardar PDF</button>
          <h1>Liquidación de horas — Dentilandia</h1>
          <p class="subtitulo">${escPdf(etiquetaRango)}${rango ? ` (${rango.inicio} — ${sumarDias(rango.fin, -1)})` : ""} · Meta: ${metaSemanal} h/semana</p>
          ${bloques}
        </body>
      </html>`;

    const ventana = window.open("", "_blank");
    if (!ventana) {
      window.alert("El navegador bloqueó la ventana emergente. Habilítala para poder descargar el PDF.");
      return;
    }
    ventana.document.write(html);
    ventana.document.close();
    ventana.focus();
  }

  async function cargarFestivos() {
    const { data } = await supabase.from("festivos_colombia").select("*").order("fecha");
    setFestivos((data as FestivoColombia[]) ?? []);
  }

  useEffect(() => {
    cargarFestivos();
  }, []);

  async function agregarFestivo() {
    if (!fechaFestivoNueva || !nombreFestivoNuevo.trim()) return;
    setGuardandoFestivo(true);
    setErrorFestivo(null);
    const { error } = await supabase
      .from("festivos_colombia")
      .insert({ fecha: fechaFestivoNueva, nombre: nombreFestivoNuevo.trim() });
    setGuardandoFestivo(false);
    if (error) {
      setErrorFestivo(error.message);
      return;
    }
    setFechaFestivoNueva("");
    setNombreFestivoNuevo("");
    cargarFestivos();
    cargarReporte();
  }

  async function eliminarFestivo(fecha: string) {
    await supabase.from("festivos_colombia").delete().eq("fecha", fecha);
    cargarFestivos();
    cargarReporte();
  }

  async function cargarPeriodosLiquidacion() {
    const { data } = await supabase.from("periodos_liquidacion").select("*").order("fecha_inicio", { ascending: false });
    const filas = (data as PeriodoLiquidacion[]) ?? [];
    setPeriodosLiquidacion(filas);
    if (filas.length > 0) setPeriodoReporteId((prev) => prev || filas[0].id);
  }

  useEffect(() => {
    cargarPeriodosLiquidacion();
  }, []);

  async function crearPeriodoLiquidacion() {
    if (!etiquetaPeriodoNueva.trim() || !inicioPeriodoNuevo || !finPeriodoNuevo) return;
    setGuardandoPeriodo(true);
    setErrorPeriodoLiq(null);
    const { data, error } = await supabase
      .from("periodos_liquidacion")
      .insert({
        etiqueta: etiquetaPeriodoNueva.trim(),
        fecha_inicio: inicioPeriodoNuevo,
        fecha_fin: finPeriodoNuevo,
        created_by: perfil?.id ?? null,
      })
      .select("id")
      .single();
    setGuardandoPeriodo(false);
    if (error) {
      setErrorPeriodoLiq(error.message);
      return;
    }
    setEtiquetaPeriodoNueva("");
    setInicioPeriodoNuevo("");
    setFinPeriodoNuevo("");
    await cargarPeriodosLiquidacion();
    if (data) setPeriodoReporteId(data.id);
  }

  async function eliminarPeriodoLiquidacion(id: string) {
    await supabase.from("periodos_liquidacion").delete().eq("id", id);
    if (periodoReporteId === id) setPeriodoReporteId("");
    cargarPeriodosLiquidacion();
  }

  async function cargarControlAusencias() {
    if (perfil?.rol !== "admin") return;
    const desde = `${controlMes}-01`;
    const hasta = sumarDias(desde, 31).slice(0, 7) + "-01";
    const { data } = await supabase
      .from("asistencia_ausencias")
      .select("perfil_id, fecha, tipo, perfiles!asistencia_vacaciones_perfil_id_fkey(nombre)")
      .gte("fecha", desde)
      .lt("fecha", hasta);
    const filas = (
      (data as unknown as {
        perfil_id: string;
        fecha: string;
        tipo: "vacaciones" | "incapacidad" | "descanso";
        perfiles: { nombre: string } | null;
      }[]) ?? []
    ).map((r) => ({ perfil_id: r.perfil_id, fecha: r.fecha, tipo: r.tipo, nombre: r.perfiles?.nombre ?? "—" }));
    setControlAusencias(filas);
  }

  useEffect(() => {
    cargarControlAusencias();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfil?.rol, controlMes]);

  async function cargarDoctoras() {
    const { data } = await supabase.from("doctoras").select("*").eq("activa", true).order("nombre");
    setDoctoras((data as Doctora[]) ?? []);
  }

  async function cargarSolicitudesHE() {
    if (perfil?.rol !== "admin" && perfil?.rol !== "operacion") return;
    const { data } = await supabase
      .from("asistencia_horas_extra")
      .select("*, asistencia_horas_extra_colaboradores(*, perfiles(nombre))")
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(30);
    const filas = (
      (data as unknown as (SolicitudHorasExtra & {
        asistencia_horas_extra_colaboradores: (ColaboradorHorasExtra & { perfiles: { nombre: string } | null })[];
      })[]) ?? []
    ).map((s) => ({
      ...s,
      colaboradores: s.asistencia_horas_extra_colaboradores.map((c) => ({ ...c, nombre: c.perfiles?.nombre ?? "—" })),
    }));
    setSolicitudesHE(filas);
  }

  useEffect(() => {
    if (perfil?.rol !== "admin" && perfil?.rol !== "operacion") return;
    cargarDoctoras();
    cargarSolicitudesHE();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfil?.rol]);

  async function crearSolicitudHE() {
    if (!heDoctoraId || heColaboradoresIds.length === 0 || !hePacienteNombre.trim() || !heMotivo.trim()) return;
    setGuardandoHE(true);
    setErrorHE(null);
    const { data: solicitud, error } = await supabase
      .from("asistencia_horas_extra")
      .insert({
        fecha: heFecha,
        doctora_id: heDoctoraId,
        paciente_nombre: hePacienteNombre.trim(),
        motivo: heMotivo.trim(),
        // Hora real del sistema al registrar la solicitud — ya no se pide
        // manualmente, para que quede la hora exacta en que de verdad llegó
        // el paciente, no una que alguien escriba de memoria después.
        hora_ingreso_consultorio: horaBogotaAhora(),
        created_by: perfil?.id ?? null,
      })
      .select("id")
      .single();
    if (error || !solicitud) {
      setGuardandoHE(false);
      setErrorHE(error?.message ?? "No se pudo crear la solicitud.");
      return;
    }
    const { error: errorColab } = await supabase
      .from("asistencia_horas_extra_colaboradores")
      .insert(heColaboradoresIds.map((perfilId) => ({ solicitud_id: solicitud.id, perfil_id: perfilId })));
    setGuardandoHE(false);
    if (errorColab) {
      setErrorHE(errorColab.message);
      return;
    }
    setHeDoctoraId("");
    setHeColaboradoresIds([]);
    setHePacienteNombre("");
    setHeMotivo("");
    cargarSolicitudesHE();
  }

  // Antes se marcaba la salida de cada colaborador (con una hora escrita a
  // mano) antes de saber siquiera si el paciente ya había sido atendido —
  // podía quedar una hora de salida de alguien que en realidad seguía con el
  // paciente. Ahora la salida se registra acá, junto con el resto de la
  // solicitud, en un solo guardado y con la hora real del sistema en ese
  // momento — es decir, primero se atiende y se llenan los datos, y llenarlos
  // es lo que marca la salida, no al revés. Si ya había una salida marcada
  // ese día, se reemplaza por esta, para que quede una sola salida real por
  // día en asistencia_registros.
  async function finalizarSolicitudHE(
    solicitud: SolicitudHorasExtra & { colaboradores: (ColaboradorHorasExtra & { nombre: string })[] },
  ) {
    const form = finalizarForm[solicitud.id];
    if (!form || form.pacientePago === null || form.seAgendoCita === null) return;
    setGuardandoFinalizarHE(solicitud.id);
    setErrorHE(null);
    const ahora = new Date().toISOString();
    const desde = `${solicitud.fecha}T00:00:00-05:00`;
    const hasta = `${sumarDias(solicitud.fecha, 1)}T00:00:00-05:00`;
    for (const c of solicitud.colaboradores) {
      const { data: existentes } = await supabase
        .from("asistencia_registros")
        .select("id")
        .eq("perfil_id", c.perfil_id)
        .eq("tipo", "salida")
        .gte("marcado_en", desde)
        .lt("marcado_en", hasta);
      for (const ex of existentes ?? []) {
        await supabase.from("asistencia_registros").delete().eq("id", ex.id);
      }
      const { data: nuevaMarca, error: errorMarca } = await supabase
        .from("asistencia_registros")
        .insert({
          perfil_id: c.perfil_id,
          sede_id: personas.find((p) => p.id === c.perfil_id)?.sede_id ?? null,
          tipo: "salida",
          marcado_en: ahora,
        })
        .select("id")
        .single();
      if (errorMarca || !nuevaMarca) {
        setGuardandoFinalizarHE(null);
        setErrorHE(errorMarca?.message ?? "No se pudo registrar la salida.");
        return;
      }
      const tarea = form.tareas[c.id]?.trim();
      const { error: errorUpd } = await supabase
        .from("asistencia_horas_extra_colaboradores")
        .update({ hora_salida: ahora, marca_registro_id: nuevaMarca.id, ...(tarea ? { tareas_realizadas: tarea } : {}) })
        .eq("id", c.id);
      if (errorUpd) {
        setGuardandoFinalizarHE(null);
        setErrorHE(errorUpd.message);
        return;
      }
      // La salida cambió — si ese día ya tenía un "compensado" guardado
      // (calculado contra la salida anterior), queda desactualizado.
      await recalcularCompensadoDia(c.perfil_id, solicitud.fecha);
    }
    const { error } = await supabase
      .from("asistencia_horas_extra")
      .update({
        estado: "finalizada",
        paciente_pago: form.pacientePago,
        se_agendo_cita: form.seAgendoCita,
        finalizada_en: ahora,
      })
      .eq("id", solicitud.id);
    setGuardandoFinalizarHE(null);
    if (error) {
      setErrorHE(error.message);
      return;
    }
    cargarSolicitudesHE();
    cargarReporte();
  }

  async function cancelarSolicitudHE(id: string) {
    await supabase.from("asistencia_horas_extra").delete().eq("id", id);
    cargarSolicitudesHE();
  }

  const yaMarcado = useMemo(() => new Set(registros.map((r) => r.tipo)), [registros]);

  // Recordatorio de almuerzo: si ya pasaron las 11:55 y no ha marcado salida
  // de almuerzo, o ya pasó la 1:00pm y salió pero no ha marcado la entrada —
  // se calcula al entrar/recargar la pantalla (no en vivo mientras la deja
  // abierta), así que si entra después de la hora igual le aparece.
  const recordatorioAlmuerzo = useMemo(() => {
    if (yaMarcado.has("salida")) return null;
    const horaActual = horaBogotaAhora();
    if (!yaMarcado.has("salida_almuerzo") && horaActual >= "11:55") {
      return "Recuerda marcar la salida de almuerzo.";
    }
    if (yaMarcado.has("salida_almuerzo") && !yaMarcado.has("entrada_almuerzo") && horaActual >= "13:00") {
      return "Recuerda marcar la entrada de almuerzo.";
    }
    return null;
  }, [yaMarcado]);

  // Orden de la jornada, pero flexible: la salida final siempre queda
  // habilitada apenas hay llegada (sin exigir pasar por el almuerzo), para
  // no bloquear a quien solo trabaja media jornada compensando horas.
  function habilitado(tipo: TipoAsistencia): boolean {
    if (yaMarcado.has(tipo) || yaMarcado.has("salida")) return false;
    if (tipo === "llegada") return true;
    if (!yaMarcado.has("llegada")) return false;
    if (tipo === "salida") return true;
    if (tipo === "salida_almuerzo") return true;
    if (tipo === "entrada_almuerzo") return yaMarcado.has("salida_almuerzo");
    return false;
  }

  async function marcar(tipo: TipoAsistencia) {
    setMarcando(tipo);
    setMensaje(null);
    const { data, error } = await supabase.functions.invoke("marcar-asistencia", {
      body: { tipo },
    });
    setMarcando(null);
    if (error || data?.error) {
      // supabase-js no pone el body del error (ej. "Debes estar conectado a
      // la red de la sede...") en `error.message` cuando el edge function
      // responde con un código distinto de 2xx — solo dice "Edge Function
      // returned a non-2xx status code". El mensaje real hay que sacarlo del
      // Response crudo en error.context.
      let texto = data?.error ?? "No se pudo registrar la marca.";
      const contexto = (error as { context?: Response } | null)?.context;
      if (!data?.error && contexto) {
        try {
          const cuerpo = await contexto.json();
          texto = cuerpo?.error ?? error?.message ?? texto;
        } catch {
          texto = error?.message ?? texto;
        }
      } else if (!data?.error && error?.message) {
        texto = error.message;
      }
      setMensaje({ tipo: "error", texto });
      cargarIntentosBloqueados();
      return;
    }
    const etiqueta = TIPOS_ASISTENCIA.find((t) => t.value === tipo)?.label ?? tipo;
    setMensaje({ tipo: "ok", texto: `${etiqueta} registrada.` });
    if (data?.frase && (tipo === "llegada" || tipo === "salida")) {
      setFrase({ tipo, texto: data.frase, fecha: fechaBogota(new Date().toISOString()) });
    }
    cargarRegistros();
    cargarReporte();
    if (perfil?.rol === "admin") cargarDashboardHoy();
  }

  // Confirmación de que la persona sí vio el mensaje (para que admin pueda
  // saber quién no lo está leyendo, no solo quién marcó) — se registra al
  // cerrar el mensaje con "Entendido", que es el único botón para cerrarlo.
  async function confirmarLecturaFrase() {
    if (!frase || !perfil) return;
    await supabase
      .from("asistencia_frases_leidas")
      .upsert({ perfil_id: perfil.id, fecha: frase.fecha, tipo: frase.tipo }, { onConflict: "perfil_id,fecha,tipo" });
    setFrase(null);
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {perfil?.rol === "admin" && intentosBloqueados.length > 0 && (
        <div className="bg-red-50 border-2 border-red-300 rounded-xl p-4 space-y-2">
          <h2 className="font-bold text-red-700">⚠ Intentos de marcado fuera de la sede</h2>
          <div className="space-y-1.5">
            {intentosBloqueados.map((i) => (
              <label key={i.id} className="flex items-start gap-2 text-sm text-red-700 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={false}
                  onChange={() => marcarLeidoIntento(i.id)}
                />
                <span>
                  <span className="font-semibold">{i.nombre}</span> intentó marcar "
                  {TIPOS_ASISTENCIA.find((t) => t.value === i.tipo)?.label ?? i.tipo}" el{" "}
                  {new Date(i.creado_en).toLocaleString("es-CO")}
                  {i.ip && ` desde la IP ${i.ip}`} — no estaba en la red de una sede.
                </span>
              </label>
            ))}
          </div>
          <p className="text-xs text-red-500">Marca la casilla para quitarla de acá — queda igual en el historial.</p>
        </div>
      )}

      {perfil?.rol === "admin" && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <button
            onClick={() => setVerHistorialIntentos((v) => !v)}
            className="text-sm font-medium text-[var(--acento)]"
          >
            {verHistorialIntentos ? "Ocultar historial de intentos fuera de la sede" : "Ver historial de intentos fuera de la sede"}
          </button>
          {verHistorialIntentos && (
            <div className="mt-3 divide-y divide-gray-50">
              {historialIntentos.length === 0 && <p className="text-sm text-gray-400">Sin registros.</p>}
              {historialIntentos.map((i) => (
                <div key={i.id} className="flex items-center justify-between py-1.5 text-sm gap-2">
                  <span className={i.leido ? "text-gray-400" : "text-red-700 font-medium"}>
                    <span className="font-semibold">{i.nombre}</span> — {TIPOS_ASISTENCIA.find((t) => t.value === i.tipo)?.label ?? i.tipo}
                    {i.ip && ` · IP ${i.ip}`}
                  </span>
                  <span className="text-xs text-gray-400 whitespace-nowrap">
                    {new Date(i.creado_en).toLocaleString("es-CO")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {perfil?.rol === "admin" && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-semibold text-tinta">
              {fechaDashboard === fechaBogota(new Date().toISOString()) ? "Hoy — quién ha marcado" : `Quién marcó el ${fechaDashboard}`}
            </h2>
            <input
              type="date"
              value={fechaDashboard}
              onChange={(e) => setFechaDashboard(e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
          {cargandoDashboard ? (
            <p className="text-sm text-gray-400">Cargando…</p>
          ) : personas.length === 0 ? (
            <p className="text-sm text-gray-400">Sin personas registradas.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 text-left">
                    <th className="font-normal pb-1.5 pr-3">Nombre</th>
                    <th className="font-normal pb-1.5 pr-3">Sede</th>
                    <th className="font-normal pb-1.5 pr-3 text-right">Llegada</th>
                    <th className="font-normal pb-1.5 pr-3 text-right">S. almuerzo</th>
                    <th className="font-normal pb-1.5 pr-3 text-right">E. almuerzo</th>
                    <th className="font-normal pb-1.5 text-right">Salida</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {personas.map((p) => {
                    const marcas = marcasDashboard[p.id] ?? {};
                    const esHoy = fechaDashboard === fechaBogota(new Date().toISOString());
                    const horaLimiteLlegada = diaDeSemana(fechaDashboard) === 6 ? "08:15" : "08:45";
                    const faltaLlegada =
                      !marcas.llegada && esHoy && diaDeSemana(fechaDashboard) !== 0 && horaBogotaAhora() >= horaLimiteLlegada;
                    // Llegada distinta (antes o después) a la esperada de ese
                    // día, sin que quede una hora autorizada guardada — para
                    // que no se pierda de vista sin tener que revisar marca
                    // por marca. Más de 5 min de diferencia para no marcar
                    // ruido por segundos de diferencia al marcar.
                    const horaAutorizada = horaAutorizadaDashboard[p.id];
                    const llegadaSinAutorizar =
                      marcas.llegada &&
                      !horaAutorizada &&
                      Math.abs(
                        new Date(marcas.llegada).getTime() -
                          new Date(`${fechaDashboard}T${horasPorDefecto(fechaDashboard).llegada}:00-05:00`).getTime(),
                      ) >
                        5 * 60_000;
                    // Salida antes de la hora normal, sin hora de salida
                    // autorizada guardada — igual que llegada, una vez que
                    // admin la revisa y la guarda, deja de avisar.
                    const horaSalidaAutorizada = horaSalidaAutorizadaDashboard[p.id];
                    const salidaSinAutorizar =
                      marcas.salida &&
                      !horaSalidaAutorizada &&
                      new Date(marcas.salida).getTime() <
                        new Date(`${fechaDashboard}T${horasPorDefecto(fechaDashboard).salida}:00-05:00`).getTime() - 5 * 60_000;
                    return (
                      <tr key={p.id}>
                        <td className="py-1.5 pr-3 font-medium">{p.nombre}</td>
                        <td className="py-1.5 pr-3 text-gray-500">{sedeDelDiaDashboard[p.id] ?? p.sedeNombre ?? "—"}</td>
                        {TIPOS_ASISTENCIA.map((t) => {
                          const marca = marcas[t.value];
                          const revisar = (t.value === "llegada" && llegadaSinAutorizar) || (t.value === "salida" && salidaSinAutorizar);
                          // Si vio (confirmó con "Entendido") el mensaje que le
                          // salió al marcar — solo aplica desde que existen los
                          // mensajes, y solo a llegada/salida (no almuerzo).
                          const mostrarLectura =
                            marca && (t.value === "llegada" || t.value === "salida") && fechaDashboard >= FECHA_INICIO_FRASES;
                          const leyoMensaje = mostrarLectura && frasesLeidasDashboard.has(`${p.id}|${t.value}`);
                          return (
                            <td
                              key={t.value}
                              title={revisar ? "Distinto a la hora normal — sin hora autorizada guardada. Revisar en Registro administrativo." : undefined}
                              className={`py-1.5 pr-3 text-right ${
                                marca
                                  ? revisar
                                    ? "text-amber-600 font-semibold"
                                    : "text-tinta"
                                  : t.value === "llegada" && faltaLlegada
                                    ? "text-red-600 font-semibold"
                                    : "text-gray-300"
                              }`}
                            >
                              <span className="inline-flex items-center gap-1">
                                {marca ? new Date(marca).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }) : "—"}
                                {revisar && "⚠"}
                                {mostrarLectura &&
                                  (leyoMensaje ? (
                                    <span title="Confirmó haber leído el mensaje">
                                      <Eye size={12} className="text-green-500" />
                                    </span>
                                  ) : (
                                    <span title="No confirmó haber leído el mensaje">
                                      <EyeOff size={12} className="text-gray-400" />
                                    </span>
                                  ))}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="max-w-md mx-auto space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <h2 className="font-semibold text-tinta">Marcar asistencia</h2>
        <p className="text-xs text-gray-400">Solo funciona conectado a la red de la sede.</p>

        {recordatorioAlmuerzo && (
          <div className="rounded-lg bg-amber-100 border border-amber-300 px-3 py-2 text-sm font-medium text-amber-800">
            🍽️ {recordatorioAlmuerzo}
          </div>
        )}


        <div className="flex flex-col gap-2">
          {TIPOS_ASISTENCIA.map((t, i) => {
            const Icono = ICONOS[t.value];
            const marcadoHoy = yaMarcado.has(t.value);
            const puede = habilitado(t.value);
            return (
              <div key={t.value} className="flex flex-col items-center gap-1">
                {i > 0 && <span className="text-gray-300 text-sm leading-none">↓</span>}
                <button
                  onClick={() => marcar(t.value)}
                  disabled={marcando !== null || !puede}
                  style={marcadoHoy ? undefined : { background: COLOR_TIPO[t.value] }}
                  className={`w-full flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium disabled:opacity-40 ${
                    marcadoHoy ? "bg-gray-100 text-gray-400" : "text-white"
                  }`}
                >
                  <Icono size={16} /> {marcando === t.value ? "Marcando…" : marcadoHoy ? `${t.label} ✓` : t.label}
                </button>
              </div>
            );
          })}
        </div>

        {mensaje && (
          <p className={mensaje.tipo === "ok" ? "text-sm text-emerald-700" : "text-sm font-bold text-red-600"}>
            {mensaje.texto}
          </p>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-500 mb-2">
          Tus marcas de hoy
        </h3>
        {registros.length === 0 ? (
          <p className="text-sm text-gray-400">Todavía no has marcado nada ese día.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {registros.map((r) => (
              <div key={r.id} className="flex items-center justify-between py-1.5 text-sm">
                <span className="font-medium">{TIPOS_ASISTENCIA.find((t) => t.value === r.tipo)?.label ?? r.tipo}</span>
                <span className="text-gray-500">{new Date(r.marcado_en).toLocaleTimeString("es-CO")}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      </div>

      {perfil?.rol === "admin" && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <h2 className="font-semibold text-tinta">Registrar asistencia (administración)</h2>
          <p className="text-xs text-gray-400">
            Para cargar retroactivo un período completo o corregir una marca — inserta directo, sin depender de que
            la persona lo haga desde su celular.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={personaAdminId}
              onChange={(e) => setPersonaAdminId(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm min-w-[180px]"
            >
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={fechaAdmin}
              onChange={(e) => setFechaAdmin(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="rounded-lg bg-sky-50 border border-sky-200 px-3 py-2">
            {ausenciaPersona ? (
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-sky-800">Día de {ETIQUETAS_AUSENCIA[ausenciaPersona.tipo].toLowerCase()}</span>
                <button onClick={quitarAusencia} className="text-xs text-red-500 hover:underline">
                  Quitar
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 flex-wrap text-sm">
                <span className="text-gray-500">Marcar este día como:</span>
                <button
                  onClick={() => marcarAusencia("vacaciones")}
                  className="text-xs font-medium px-2.5 py-1.5 rounded-md bg-sky-600 text-white"
                >
                  Vacaciones
                </button>
                <button
                  onClick={() => marcarAusencia("incapacidad")}
                  className="text-xs font-medium px-2.5 py-1.5 rounded-md bg-sky-600 text-white"
                >
                  Incapacidad
                </button>
                {diaDeSemana(fechaAdmin) === 6 && (
                  <button
                    onClick={() => marcarAusencia("descanso")}
                    className="text-xs font-medium px-2.5 py-1.5 rounded-md bg-sky-600 text-white"
                  >
                    Descansó
                  </button>
                )}
              </div>
            )}
            <p className="text-xs text-sky-700 mt-1">
              No cuenta como déficit de horas esa semana (resta {jornadaOrdinariaHoras(fechaAdmin)}h de la meta).
            </p>
          </div>

          <div className="space-y-2">
            {TIPOS_ASISTENCIA.filter(
              (t) => diaDeSemana(fechaAdmin) !== 6 || (t.value !== "salida_almuerzo" && t.value !== "entrada_almuerzo"),
            ).map((t) => {
              const marca = marcasPersona.find((m) => m.tipo === t.value);
              return (
                <div key={t.value} className="flex items-center gap-2 text-sm">
                  <span className="w-36 shrink-0">{t.label}</span>
                  {marca ? (
                    <div className="flex items-center gap-2 flex-1">
                      <span className="text-tinta font-medium">
                        {new Date(marca.marcado_en).toLocaleTimeString("es-CO")}
                      </span>
                      <button
                        onClick={() => eliminarMarcaPersona(marca.id)}
                        className="text-xs text-red-500 hover:underline"
                      >
                        Quitar
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input
                        type="time"
                        value={horaNueva[t.value]}
                        onChange={(e) => setHoraNueva((prev) => ({ ...prev, [t.value]: e.target.value }))}
                        className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                      />
                      <button
                        onClick={() => agregarMarcaPersona(t.value)}
                        className="text-xs font-medium px-2.5 py-1.5 rounded-md bg-[var(--acento)] text-white"
                      >
                        Agregar
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Nota del día (ej. "entró a la 1pm en vez de las 9am, autorizado")
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                value={notaPersona}
                onChange={(e) => setNotaPersona(e.target.value)}
                placeholder="Sin nota"
                className="flex-1 min-w-[160px] rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <button
                onClick={guardarNotaPersona}
                disabled={
                  guardandoAdmin ||
                  (notaPersona.trim() === notaOriginal &&
                    esCompensado === esCompensadoOriginal &&
                    horaEntradaAutorizada === horaEntradaAutorizadaOriginal &&
                    horaSalidaAutorizada === horaSalidaAutorizadaOriginal &&
                    minutosCompensadoManual === minutosCompensadoManualOriginal)
                }
                className="rounded-lg bg-[var(--acento)] text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
              >
                {guardandoAdmin ? "Guardando…" : "Guardar"}
              </button>
            </div>
            <label className="flex items-center gap-2 text-sm mt-2">
              <input type="checkbox" checked={esCompensado} onChange={(e) => setEsCompensado(e.target.checked)} />
              Compensado de tiempo
            </label>
            <p className="text-xs text-gray-400 mt-1">
              Si llegó tarde o salió temprano pero ese tiempo ya estaba a su favor de un período anterior (autorizado),
              marca esto y toca "Guardar": el sistema calcula solo cuánto le faltó ese día contra la jornada
              ({jornadaOrdinariaHoras(fechaAdmin)}h) y lo suma de vuelta a las horas de la semana, para no
              descontárselo dos veces.
            </p>
            {esCompensado &&
              !(marcasPersona.some((m) => m.tipo === "llegada") && marcasPersona.some((m) => m.tipo === "salida")) && (
                <div className="mt-2">
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Minutos aproximados a compensar (todavía no hay llegada y salida cargadas ese día — ej. lo estás
                    programando desde el día anterior)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={minutosCompensadoManual}
                    onChange={(e) => setMinutosCompensadoManual(e.target.value)}
                    placeholder="Ej. 60"
                    className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    En cuanto la persona marque llegada y salida ese día, este número se recalcula solo contra las
                    horas reales — no hay que volver a corregirlo a mano.
                  </p>
                </div>
              )}
            <div className="mt-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Hora de entrada autorizada ese día (si es distinta a la normal — ej. reunión desde las 8am, o alguien
                autorizado a entrar más tarde)
              </label>
              <input
                type="time"
                value={horaEntradaAutorizada}
                onChange={(e) => setHoraEntradaAutorizada(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <p className="text-xs text-gray-400 mt-1">
                Llegar antes de esta hora (o de la jornada normal, {horasPorDefecto(fechaAdmin).llegada}, si dejas
                esto vacío) no suma horas de más — las horas trabajadas se cuentan desde acá, no desde la marca real.
              </p>
            </div>
            <div className="mt-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Hora de salida autorizada ese día (si salió antes de la normal con permiso)
              </label>
              <input
                type="time"
                value={horaSalidaAutorizada}
                onChange={(e) => setHoraSalidaAutorizada(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <p className="text-xs text-gray-400 mt-1">
                Esto no cambia las horas trabajadas (salir antes sí resta horas de verdad — para perdonar ese
                faltante usa "Compensado de tiempo" arriba). Solo apaga la alerta del dashboard de "Hoy — quién ha
                marcado" una vez que ya revisaste que la salida temprano estaba autorizada.
              </p>
            </div>
          </div>

          {errorAdmin && <p className="text-sm text-red-600">{errorAdmin}</p>}
        </div>
      )}

      {(perfil?.rol === "admin" || perfil?.rol === "operacion") && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
          <div>
            <h2 className="font-semibold text-tinta">Horas extra por atención de paciente</h2>
            <p className="text-xs text-gray-400">
              Reemplaza el aviso por el grupo de WhatsApp — se registra acá y al finalizar se carga sola la hora de
              salida real de cada colaborador involucrado.
            </p>
          </div>

          <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 space-y-2">
            <p className="text-sm font-medium text-gray-600">Nueva solicitud</p>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="date"
                value={heFecha}
                onChange={(e) => setHeFecha(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <select
                value={heDoctoraId}
                onChange={(e) => setHeDoctoraId(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Doctora…</option>
                {doctoras.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nombre}
                  </option>
                ))}
              </select>
            </div>
            <input
              value={hePacienteNombre}
              onChange={(e) => setHePacienteNombre(e.target.value)}
              placeholder="Nombre del paciente"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              value={heMotivo}
              onChange={(e) => setHeMotivo(e.target.value)}
              placeholder="Motivo del atraso"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <div>
              <p className="text-xs text-gray-500 mb-1">Colaboradores que atendieron:</p>
              <div className="flex flex-wrap gap-2">
                {personas.map((p) => {
                  const marcado = heColaboradoresIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() =>
                        setHeColaboradoresIds((prev) =>
                          marcado ? prev.filter((id) => id !== p.id) : [...prev, p.id],
                        )
                      }
                      className={`text-xs font-medium px-2.5 py-1.5 rounded-full border ${
                        marcado ? "bg-[var(--acento)] text-white border-[var(--acento)]" : "border-gray-300 text-gray-600"
                      }`}
                    >
                      {p.nombre}
                    </button>
                  );
                })}
              </div>
            </div>
            {errorHE && <p className="text-sm text-red-600">{errorHE}</p>}
            <button
              onClick={crearSolicitudHE}
              disabled={
                guardandoHE || !heDoctoraId || heColaboradoresIds.length === 0 || !hePacienteNombre.trim() || !heMotivo.trim()
              }
              className="rounded-lg bg-[var(--acento)] text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
            >
              {guardandoHE ? "Guardando…" : "Registrar solicitud"}
            </button>
          </div>

          {solicitudesHE.length > 0 && (
            <div className="space-y-3">
              {solicitudesHE.map((s) => {
                const form = finalizarForm[s.id] ?? { pacientePago: null, seAgendoCita: null, tareas: {} };
                return (
                  <div
                    key={s.id}
                    className={`border rounded-lg p-3 text-sm ${
                      s.estado === "finalizada" ? "border-gray-100 bg-gray-50" : "border-amber-200 bg-amber-50"
                    }`}
                  >
                    <div className="flex items-center justify-between flex-wrap gap-1 mb-1">
                      <p className="font-medium">
                        {formatFechaLarga(s.fecha)} — {s.paciente_nombre}
                        {s.estado === "finalizada" && (
                          <span className="ml-2 text-xs text-emerald-700 font-normal">Finalizada</span>
                        )}
                      </p>
                      {s.estado === "abierta" && (
                        <button onClick={() => cancelarSolicitudHE(s.id)} className="text-xs text-red-500 hover:underline">
                          Cancelar
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mb-2">
                      Doctora: {doctoras.find((d) => d.id === s.doctora_id)?.nombre ?? "—"}
                      {s.hora_ingreso_consultorio && ` · Ingreso: ${s.hora_ingreso_consultorio}`} · Motivo: {s.motivo}
                    </p>
                    <div className="space-y-1.5">
                      {s.colaboradores.map((c) => (
                        <div key={c.id} className="flex items-center gap-2">
                          <span className="w-40 shrink-0">{c.nombre}</span>
                          {c.hora_salida ? (
                            <span className="text-tinta font-medium">
                              Salida: {new Date(c.hora_salida).toLocaleTimeString("es-CO")}
                            </span>
                          ) : (
                            <span className="text-gray-400">
                              {s.estado === "finalizada" ? "Sin salida registrada" : "Salida pendiente — se registra al finalizar"}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>

                    {s.estado === "abierta" && (
                      <div className="mt-3 pt-3 border-t border-amber-200 space-y-2">
                        <p className="text-xs font-medium text-gray-600">Para finalizar:</p>
                        <div className="flex items-center gap-2 flex-wrap text-xs">
                          <span className="text-gray-500">¿El paciente pagó?</span>
                          {[true, false].map((v) => (
                            <button
                              key={String(v)}
                              onClick={() =>
                                setFinalizarForm((prev) => ({ ...prev, [s.id]: { ...form, pacientePago: v } }))
                              }
                              className={`px-2.5 py-1 rounded-md font-medium ${
                                form.pacientePago === v ? "bg-[var(--acento)] text-white" : "bg-white border border-gray-300 text-gray-600"
                              }`}
                            >
                              {v ? "Sí" : "No"}
                            </button>
                          ))}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap text-xs">
                          <span className="text-gray-500">¿Se agendó cita?</span>
                          {[true, false].map((v) => (
                            <button
                              key={String(v)}
                              onClick={() =>
                                setFinalizarForm((prev) => ({ ...prev, [s.id]: { ...form, seAgendoCita: v } }))
                              }
                              className={`px-2.5 py-1 rounded-md font-medium ${
                                form.seAgendoCita === v ? "bg-[var(--acento)] text-white" : "bg-white border border-gray-300 text-gray-600"
                              }`}
                            >
                              {v ? "Sí" : "No"}
                            </button>
                          ))}
                        </div>
                        {s.colaboradores.map((c) => (
                          <input
                            key={c.id}
                            value={form.tareas[c.id] ?? ""}
                            onChange={(e) =>
                              setFinalizarForm((prev) => ({
                                ...prev,
                                [s.id]: { ...form, tareas: { ...form.tareas, [c.id]: e.target.value } },
                              }))
                            }
                            placeholder={`Tareas realizadas por ${c.nombre}`}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                          />
                        ))}
                        <button
                          onClick={() => finalizarSolicitudHE(s)}
                          disabled={form.pacientePago === null || form.seAgendoCita === null || guardandoFinalizarHE === s.id}
                          className="rounded-lg bg-emerald-600 text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
                        >
                          {guardandoFinalizarHE === s.id ? "Guardando…" : "Finalizar solicitud"}
                        </button>
                      </div>
                    )}

                    {s.estado === "finalizada" && (
                      <div className="mt-2 pt-2 border-t border-gray-200 text-xs text-gray-500 space-y-0.5">
                        <p>
                          Pagó: {s.paciente_pago ? "Sí" : "No"} · Cita agendada: {s.se_agendo_cita ? "Sí" : "No"}
                        </p>
                        {s.colaboradores
                          .filter((c) => c.tareas_realizadas)
                          .map((c) => (
                            <p key={c.id}>
                              <span className="font-medium">{c.nombre}:</span> {c.tareas_realizadas}
                            </p>
                          ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="font-semibold text-tinta">Horas trabajadas por período</h2>
          <div className="flex items-center gap-2 flex-wrap">
            {perfil?.rol === "admin" && reporte.length > 0 && (
              <button
                onClick={descargarReportePdf}
                className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50"
              >
                Descargar PDF (con firma)
              </button>
            )}
            <select
              value={periodoReporteId}
              onChange={(e) => setPeriodoReporteId(e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
            >
              {periodosLiquidacion.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.etiqueta}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-xs text-gray-400">
          Meta: {metaSemanal} h/semana (jornada legal). Las horas extra de cada semana se atribuyen al período en que
          empieza esa semana (lunes) — así se sabe cuánto se paga después.
        </p>
        {cargandoReporte ? (
          <p className="text-sm text-gray-400">Cargando…</p>
        ) : reporte.length === 0 ? (
          <p className="text-sm text-gray-400">Sin marcas completas (llegada + salida) en este período.</p>
        ) : (
          <div className="space-y-4">
            {reporte.map((fila) => (
              <div key={fila.perfilId} className="border border-gray-100 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-medium text-sm">{fila.nombre}</p>
                  <p className="text-sm">
                    <span className="text-gray-500">Horas extra del período: </span>
                    <span className={`font-semibold ${fila.totalHorasExtra > 0 ? "text-emerald-700" : "text-gray-400"}`}>
                      {fila.totalHorasExtra.toFixed(1)} h
                    </span>
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-gray-400 text-left">
                        <th className="font-normal pb-1">Semana</th>
                        <th className="font-normal pb-1 text-right">Trabajadas</th>
                        <th className="font-normal pb-1 text-right">Compensadas</th>
                        <th className="font-normal pb-1 text-right">Festivo</th>
                        <th className="font-normal pb-1 text-right">Atención pac.</th>
                        <th className="font-normal pb-1 text-right">Ausencia</th>
                        <th className="font-normal pb-1 text-right">Totales</th>
                        <th className="font-normal pb-1 text-right">Extra</th>
                        <th className="font-normal pb-1 text-right">Déficit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {fila.semanas.map((s) => (
                        <tr key={s.lunes} className={s.cuentaParaEsteMes ? "" : "opacity-50"}>
                          <td className="py-1">
                            {s.lunes} — {sumarDias(s.lunes, 6)}
                            {!s.cuentaParaEsteMes && (
                              <span className="text-gray-400"> — se paga el período anterior</span>
                            )}
                          </td>
                          <td className="py-1 text-right">{s.horasTrabajadas.toFixed(1)}</td>
                          <td className="py-1 text-right text-violet-600">
                            {s.minutosCompensados > 0 ? (s.minutosCompensados / 60).toFixed(1) : "—"}
                          </td>
                          <td className="py-1 text-right text-indigo-600">{s.horasFestivo > 0 ? `+${s.horasFestivo.toFixed(1)}` : "—"}</td>
                          <td className="py-1 text-right text-pink-600">
                            {(extraAtencionPorPersonaYSemana[`${fila.perfilId}|${s.lunes}`] ?? 0) > 0
                              ? (extraAtencionPorPersonaYSemana[`${fila.perfilId}|${s.lunes}`] ?? 0).toFixed(1)
                              : "—"}
                          </td>
                          <td className="py-1 text-right text-sky-600">
                            {s.horasDescuentoAusencia > 0 ? `+${s.horasDescuentoAusencia.toFixed(1)}` : "—"}
                          </td>
                          <td className="py-1 text-right font-medium">{(s.horas + s.horasDescuentoAusencia).toFixed(1)}</td>
                          <td className="py-1 text-right text-emerald-700">{s.horasExtra > 0 ? s.horasExtra.toFixed(1) : "—"}</td>
                          <td className="py-1 text-right text-amber-600">{s.horasDeficit > 0 ? s.horasDeficit.toFixed(1) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {(() => {
                  const observaciones = [
                    ...(ausenciasPorPersona[fila.perfilId] ?? []).map((a) => ({
                      fecha: a.fecha,
                      texto: ETIQUETAS_AUSENCIA[a.tipo],
                      color: COLOR_AUSENCIA[a.tipo],
                      minutosCompensados: 0,
                    })),
                    ...(notasPorPersona[fila.perfilId] ?? []).map((n) => ({
                      fecha: n.fecha,
                      texto: n.nota,
                      color: "text-gray-500",
                      minutosCompensados: n.minutosCompensados,
                    })),
                    ...Object.entries(extraAtencionPorPersonaYDia)
                      .filter(([clave]) => clave.startsWith(`${fila.perfilId}|`))
                      .map(([clave, horas]) => ({
                        fecha: clave.split("|")[1],
                        texto: `${Math.round(horas * 60)} minutos extra acumulados por atención de paciente`,
                        color: "text-pink-600",
                        minutosCompensados: 0,
                      })),
                  ].sort((a, b) => a.fecha.localeCompare(b.fecha));
                  if (observaciones.length === 0) return null;
                  return (
                    <div className="mt-2 pt-2 border-t border-gray-100 space-y-0.5">
                      {observaciones.map((o, i) => (
                        <p key={`${o.fecha}-${i}`} className={`text-xs ${o.color}`}>
                          <span className="font-medium">{formatFechaLarga(o.fecha)}:</span> {o.texto}
                          {o.minutosCompensados > 0 && (
                            <span className="text-violet-600 font-medium"> (+{o.minutosCompensados}min comp.)</span>
                          )}
                        </p>
                      ))}
                    </div>
                  );
                })()}
              </div>
            ))}
          </div>
        )}
      </div>

      {perfil?.rol === "admin" && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <h2 className="font-semibold text-tinta">Períodos de liquidación</h2>
          <p className="text-xs text-gray-400">
            El ciclo real de pago no coincide con el mes calendario (ej. 31 de agosto al 27 de septiembre). Crea acá
            esos rangos para poder ver el reporte de arriba agrupado por período en vez de por mes.
          </p>
          <div className="flex items-end gap-2 flex-wrap">
            <input
              value={etiquetaPeriodoNueva}
              onChange={(e) => setEtiquetaPeriodoNueva(e.target.value)}
              placeholder="Ej: 31 ago - 27 sept"
              className="flex-1 min-w-[140px] rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              type="date"
              value={inicioPeriodoNuevo}
              onChange={(e) => setInicioPeriodoNuevo(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <span className="text-xs text-gray-400">a</span>
            <input
              type="date"
              value={finPeriodoNuevo}
              onChange={(e) => setFinPeriodoNuevo(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <button
              onClick={crearPeriodoLiquidacion}
              disabled={!etiquetaPeriodoNueva.trim() || !inicioPeriodoNuevo || !finPeriodoNuevo || guardandoPeriodo}
              className="rounded-lg bg-[var(--acento)] text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
            >
              {guardandoPeriodo ? "Guardando…" : "Crear período"}
            </button>
          </div>
          {errorPeriodoLiq && <p className="text-sm text-red-600">{errorPeriodoLiq}</p>}
          {periodosLiquidacion.length > 0 && (
            <div className="divide-y divide-gray-50">
              {periodosLiquidacion.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-1 text-sm">
                  <span>
                    {p.etiqueta} <span className="text-gray-400">({p.fecha_inicio} — {p.fecha_fin})</span>
                  </span>
                  <button onClick={() => eliminarPeriodoLiquidacion(p.id)} className="text-xs text-red-500 hover:underline">
                    Quitar
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {perfil?.rol === "admin" && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-semibold text-tinta">Control de vacaciones e incapacidades</h2>
            <input
              type="month"
              value={controlMes}
              onChange={(e) => setControlMes(e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
            />
          </div>
          {(["vacaciones", "incapacidad", "descanso"] as const).map((tipo) => {
            const filas = controlAusencias.filter((a) => a.tipo === tipo).sort((a, b) => a.fecha.localeCompare(b.fecha));
            return (
              <div key={tipo}>
                <h3 className="text-sm font-semibold text-gray-500 mb-1">
                  {ETIQUETAS_AUSENCIA[tipo]} ({filas.length})
                </h3>
                {filas.length === 0 ? (
                  <p className="text-xs text-gray-400">Sin registros este mes.</p>
                ) : (
                  <div className="divide-y divide-gray-50">
                    {filas.map((a) => (
                      <div key={`${a.perfil_id}-${a.fecha}`} className="flex items-center justify-between py-1 text-sm">
                        <span>{a.nombre}</span>
                        <span className="text-gray-500">{formatFechaLarga(a.fecha)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {perfil?.rol === "admin" && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <h2 className="font-semibold text-tinta">Festivos de Colombia</h2>
          <p className="text-xs text-gray-400">
            Por ley el tiempo del festivo no se le puede descontar a nadie de la meta — se le suma a sus horas como si
            lo hubiera trabajado (igual que un compensado), automático para todo el mundo, sin marcarlo persona por
            persona.
          </p>
          <div className="flex items-end gap-2 flex-wrap">
            <input
              type="date"
              value={fechaFestivoNueva}
              onChange={(e) => setFechaFestivoNueva(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              value={nombreFestivoNuevo}
              onChange={(e) => setNombreFestivoNuevo(e.target.value)}
              placeholder="Ej: Amor y amistad"
              className="flex-1 min-w-[160px] rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <button
              onClick={agregarFestivo}
              disabled={!fechaFestivoNueva || !nombreFestivoNuevo.trim() || guardandoFestivo}
              className="rounded-lg bg-[var(--acento)] text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
            >
              {guardandoFestivo ? "Guardando…" : "Agregar"}
            </button>
          </div>
          {errorFestivo && <p className="text-sm text-red-600">{errorFestivo}</p>}
          {festivos.length > 0 && (
            <div className="divide-y divide-gray-50">
              {festivos.map((f) => (
                <div key={f.fecha} className="flex items-center justify-between py-1 text-sm">
                  <span>
                    {formatFechaLarga(f.fecha)} — {f.nombre}
                  </span>
                  <button onClick={() => eliminarFestivo(f.fecha)} className="text-xs text-red-500 hover:underline">
                    Quitar
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {frase && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-30">
          <div
            className={`relative max-w-sm w-full rounded-3xl p-8 text-white text-center shadow-2xl overflow-hidden ${
              frase.tipo === "llegada"
                ? "bg-gradient-to-br from-amber-400 via-orange-500 to-rose-500"
                : "bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-700"
            }`}
          >
            <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-white/10" />
            <div className="absolute -bottom-16 -left-12 w-48 h-48 rounded-full bg-white/10" />

            <div className="relative space-y-5">
              <div className="mx-auto w-16 h-16 rounded-full bg-white/20 flex items-center justify-center">
                {frase.tipo === "llegada" ? <Sunrise size={30} /> : <PartyPopper size={30} />}
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest opacity-80 mb-1">
                  {frase.tipo === "llegada" ? "Para arrancar el día" : "Fin de jornada"}
                </p>
                <p className="text-2xl font-extrabold leading-tight">
                  {frase.tipo === "llegada" ? "¡Buenos días!" : "¡Lo lograste!"}
                </p>
              </div>
              <p className="text-base font-medium leading-snug bg-white/15 rounded-xl px-4 py-3">{frase.texto}</p>
              <button
                onClick={confirmarLecturaFrase}
                className={`w-full rounded-xl bg-white py-3 text-sm font-bold hover:bg-white/90 ${
                  frase.tipo === "llegada" ? "text-orange-600" : "text-violet-700"
                }`}
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
