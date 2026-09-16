import { useEffect, useMemo, useState } from "react";
import { LogIn, LogOut, Coffee, Utensils, Sunrise, PartyPopper } from "lucide-react";
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

/** Horas realmente trabajadas ese día según sus marcas (mismo cálculo que
 *  usa el reporte mensual: llegada→salida, descontando almuerzo si hay). */
function horasTrabajadasDeMarcas(marcas: { tipo: TipoAsistencia; marcado_en: string }[]): number {
  const porTipo: Partial<Record<TipoAsistencia, string>> = {};
  for (const m of marcas) if (!porTipo[m.tipo]) porTipo[m.tipo] = m.marcado_en;
  if (!porTipo.llegada || !porTipo.salida) return 0;
  let horas = (new Date(porTipo.salida).getTime() - new Date(porTipo.llegada).getTime()) / 3_600_000;
  if (porTipo.salida_almuerzo && porTipo.entrada_almuerzo) {
    horas -= (new Date(porTipo.entrada_almuerzo).getTime() - new Date(porTipo.salida_almuerzo).getTime()) / 3_600_000;
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
    .select("minutos_compensados")
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
    .lt("marcado_en", hasta);
  const recalculado = Math.round(
    Math.max(
      0,
      jornadaOrdinariaHoras(fecha) -
        horasTrabajadasDeMarcas((marcas as { tipo: TipoAsistencia; marcado_en: string }[]) ?? []),
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

const ICONOS: Record<TipoAsistencia, typeof LogIn> = {
  llegada: LogIn,
  salida_almuerzo: Coffee,
  entrada_almuerzo: Utensils,
  salida: LogOut,
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
  festivos: Set<string>,
  rangoInicio: string,
  rangoFin: string,
  metaSemanal: number,
): FilaPersona[] {
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
    let horas = (new Date(marcas.salida).getTime() - new Date(marcas.llegada).getTime()) / 3_600_000;
    if (marcas.salida_almuerzo && marcas.entrada_almuerzo) {
      horas -= (new Date(marcas.entrada_almuerzo).getTime() - new Date(marcas.salida_almuerzo).getTime()) / 3_600_000;
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
  const [frase, setFrase] = useState<{ tipo: "llegada" | "salida"; texto: string } | null>(null);

  const [mesReporte, setMesReporte] = useState(() => new Date().toISOString().slice(0, 7));
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
  const [modoReporte, setModoReporte] = useState<"mes" | "periodo">("mes");
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

  // Solo para admin: día que se está simulando al marcar, para poder probar
  // el conteo de horas de varios días seguidos sin esperar a que pasen de
  // verdad. Por defecto es hoy (comportamiento normal).
  const [fechaMarca, setFechaMarca] = useState(() => fechaBogota(new Date().toISOString()));
  const [horaMarca, setHoraMarca] = useState(() => horaBogotaAhora());

  // Registro administrativo: admin carga/corrige la asistencia de cualquier
  // persona (para cargar retroactivo un período completo) y deja notas por
  // día explicando horas fuera de lo normal — inserta directo a la tabla
  // (RLS lo permite solo a admin), sin pasar por el edge function de
  // marcado en vivo, que no aplica acá.
  const [personas, setPersonas] = useState<{ id: string; nombre: string; sede_id: string | null }[]>([]);
  const [personaAdminId, setPersonaAdminId] = useState("");
  const [fechaAdmin, setFechaAdmin] = useState(() => fechaBogota(new Date().toISOString()));
  const [marcasPersona, setMarcasPersona] = useState<AsistenciaRegistro[]>([]);
  const [notaPersona, setNotaPersona] = useState("");
  const [notaOriginal, setNotaOriginal] = useState("");
  const [esCompensado, setEsCompensado] = useState(false);
  const [esCompensadoOriginal, setEsCompensadoOriginal] = useState(false);
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
  const [heHoraIngreso, setHeHoraIngreso] = useState("");
  const [guardandoHE, setGuardandoHE] = useState(false);
  const [errorHE, setErrorHE] = useState<string | null>(null);
  const [horaSalidaInput, setHoraSalidaInput] = useState<Record<string, string>>({});
  const [guardandoSalidaHE, setGuardandoSalidaHE] = useState<string | null>(null);
  const [finalizarForm, setFinalizarForm] = useState<
    Record<string, { pacientePago: boolean | null; seAgendoCita: boolean | null; tareas: Record<string, string> }>
  >({});
  const [guardandoFinalizarHE, setGuardandoFinalizarHE] = useState<string | null>(null);

  // Horas extra de atención acumuladas por persona y semana (a partir de las
  // solicitudes finalizadas de arriba) — se muestran aparte en el reporte
  // para diferenciarlas del resto de horas trabajadas normales.
  const [extraAtencionPorPersonaYSemana, setExtraAtencionPorPersonaYSemana] = useState<Record<string, number>>({});

  useEffect(() => {
    if (perfil?.rol !== "admin") return;
    supabase
      .from("perfiles")
      .select("id, nombre, sede_id")
      .order("nombre")
      .then(({ data }) => {
        const filas = data ?? [];
        setPersonas(filas);
        if (filas.length > 0) setPersonaAdminId((prev) => prev || filas[0].id);
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
      .select("nota")
      .eq("perfil_id", personaAdminId)
      .eq("fecha", fechaAdmin)
      .maybeSingle();
    const minutosCompensados = await recalcularCompensadoDia(personaAdminId, fechaAdmin);
    setNotaPersona(nota?.nota ?? "");
    setNotaOriginal(nota?.nota ?? "");
    setEsCompensado(minutosCompensados > 0);
    setEsCompensadoOriginal(minutosCompensados > 0);
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
  }

  async function guardarNotaPersona() {
    // El check de "compensado" no pide un número — calcula solo cuánto le
    // faltó ese día contra la jornada ordinaria (8.5h entre semana, 4h
    // sábado) y ese faltante se suma de vuelta a las horas de la semana en
    // el reporte, para no descontarlo dos veces (ya estaba a su favor de un
    // período anterior).
    if (esCompensado) {
      const horasTrabajadas = horasTrabajadasDeMarcas(marcasPersona);
      if (horasTrabajadas === 0) {
        setErrorAdmin('Para marcar "compensado" primero hay que cargar la llegada y la salida de ese día.');
        return;
      }
    }
    setGuardandoAdmin(true);
    setErrorAdmin(null);
    const minutosCompensados = esCompensado
      ? Math.round(Math.max(0, jornadaOrdinariaHoras(fechaAdmin) - horasTrabajadasDeMarcas(marcasPersona)) * 60)
      : 0;
    const { error } = await supabase.from("asistencia_notas_dia").upsert(
      {
        perfil_id: personaAdminId,
        fecha: fechaAdmin,
        nota: notaPersona.trim(),
        minutos_compensados: minutosCompensados,
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
    cargarReporte();
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
    const desde = `${fechaMarca}T00:00:00-05:00`;
    const hasta = `${sumarDias(fechaMarca, 1)}T00:00:00-05:00`;
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
  }, [perfil?.id, fechaMarca]);

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

  // Rango real que se está mostrando: mes calendario, o el período de
  // liquidación elegido (ej. 31 ago - 27 sept, que no coincide con el mes).
  function rangoReporte(): { inicio: string; fin: string } | null {
    if (modoReporte === "periodo") {
      const p = periodosLiquidacion.find((x) => x.id === periodoReporteId);
      if (!p) return null;
      return { inicio: p.fecha_inicio, fin: sumarDias(p.fecha_fin, 1) };
    }
    return { inicio: `${mesReporte}-01`, fin: sumarDias(`${mesReporte}-01`, 31).slice(0, 7) + "-01" };
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
      .gte("marcado_en", desde)
      .lt("marcado_en", hasta);
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
      .select("perfil_id, fecha, nota, minutos_compensados")
      .gte("fecha", desde)
      .lt("fecha", hasta);
    const notasRows =
      (notas as { perfil_id: string; fecha: string; nota: string; minutos_compensados: number }[]) ?? [];
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
      const clave = `${row.perfil_id}|${lunesDeSemana(fechaHE)}`;
      extraAtencion[clave] = (extraAtencion[clave] ?? 0) + extra;
    }
    setExtraAtencionPorPersonaYSemana(extraAtencion);

    setReporte(armarReporteHoras(filas, ausencias, compensaciones, festivosSet, rango.inicio, rango.fin, metaSemanal));
    setCargandoReporte(false);
  }

  useEffect(() => {
    cargarReporte();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesReporte, metaSemanal, modoReporte, periodoReporteId]);

  // PDF de la liquidación del período/mes que se está viendo, con un espacio
  // de firma por persona junto a sus horas compensadas/incapacidades — para
  // que cada quien firme que está de acuerdo con lo que se le está pagando.
  function descargarReportePdf() {
    const rango = rangoReporte();
    const etiquetaRango =
      modoReporte === "periodo"
        ? periodosLiquidacion.find((p) => p.id === periodoReporteId)?.etiqueta ?? "Período"
        : new Date(Date.UTC(Number(mesReporte.slice(0, 4)), Number(mesReporte.slice(5, 7)) - 1, 1)).toLocaleDateString(
            "es-CO",
            { month: "long", year: "numeric", timeZone: "UTC" },
          );

    const bloques = reporte
      .map((fila) => {
        const filasSemana = fila.semanas
          .map(
            (s) => `<tr class="${s.cuentaParaEsteMes ? "" : "fuera"}">
              <td>${s.lunes} — ${sumarDias(s.lunes, 6)}</td>
              <td class="num">${s.horasTrabajadas.toFixed(1)}</td>
              <td class="num">${s.minutosCompensados > 0 ? (s.minutosCompensados / 60).toFixed(1) : "—"}</td>
              <td class="num">${s.horasFestivo > 0 ? "+" + s.horasFestivo.toFixed(1) : "—"}</td>
              <td class="num tot">${s.horas.toFixed(1)}</td>
              <td class="num">${
                (extraAtencionPorPersonaYSemana[`${fila.perfilId}|${s.lunes}`] ?? 0) > 0
                  ? (extraAtencionPorPersonaYSemana[`${fila.perfilId}|${s.lunes}`] ?? 0).toFixed(1)
                  : "—"
              }</td>
              <td class="num">${s.horasDescuentoAusencia > 0 ? "−" + s.horasDescuentoAusencia.toFixed(1) : "—"}</td>
              <td class="num">${s.horasExtra > 0 ? s.horasExtra.toFixed(1) : "—"}</td>
              <td class="num">${s.horasDeficit > 0 ? s.horasDeficit.toFixed(1) : "—"}</td>
            </tr>`,
          )
          .join("");
        const observaciones = [
          ...(ausenciasPorPersona[fila.perfilId] ?? []).map((a) => ({ fecha: a.fecha, texto: ETIQUETAS_AUSENCIA[a.tipo] })),
          ...(notasPorPersona[fila.perfilId] ?? []).map((n) => ({
            fecha: n.fecha,
            texto: n.nota + (n.minutosCompensados > 0 ? ` (+${n.minutosCompensados}min comp.)` : ""),
          })),
        ].sort((a, b) => a.fecha.localeCompare(b.fecha));
        const observacionesHtml =
          observaciones.length > 0
            ? `<div class="obs">${observaciones
                .map((o) => `<p><strong>${formatFechaLarga(o.fecha)}:</strong> ${escPdf(o.texto)}</p>`)
                .join("")}</div>`
            : "";
        return `<div class="persona">
          <div class="col-tabla">
            <div class="nombre-linea">
              <strong>${escPdf(fila.nombre)}</strong>
              <span>Horas extra: <strong>${fila.totalHorasExtra.toFixed(1)} h</strong></span>
            </div>
            <table>
              <thead><tr><th>Semana</th><th>Trabaj.</th><th>Comp.</th><th>Festivo</th><th>Total</th><th>Atención</th><th>Ausencia</th><th>Extra</th><th>Déficit</th></tr></thead>
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
    if (perfil?.rol !== "admin") return;
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
    if (perfil?.rol !== "admin") return;
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
        hora_ingreso_consultorio: heHoraIngreso || null,
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
    setHeHoraIngreso("");
    cargarSolicitudesHE();
  }

  // Si ya había una salida marcada ese día, se reemplaza por esta — la idea
  // es que quede una sola salida real por día en asistencia_registros, sin
  // tener que corregirla a mano una segunda vez.
  async function guardarSalidaColaborador(
    solicitud: SolicitudHorasExtra,
    colaborador: ColaboradorHorasExtra & { nombre: string },
  ) {
    const hora = horaSalidaInput[colaborador.id];
    if (!hora) return;
    setGuardandoSalidaHE(colaborador.id);
    setErrorHE(null);
    const marcadoEn = new Date(`${solicitud.fecha}T${hora}:00-05:00`).toISOString();
    const desde = `${solicitud.fecha}T00:00:00-05:00`;
    const hasta = `${sumarDias(solicitud.fecha, 1)}T00:00:00-05:00`;
    const { data: existentes } = await supabase
      .from("asistencia_registros")
      .select("id")
      .eq("perfil_id", colaborador.perfil_id)
      .eq("tipo", "salida")
      .gte("marcado_en", desde)
      .lt("marcado_en", hasta);
    for (const ex of existentes ?? []) {
      await supabase.from("asistencia_registros").delete().eq("id", ex.id);
    }
    const { data: nuevaMarca, error } = await supabase
      .from("asistencia_registros")
      .insert({
        perfil_id: colaborador.perfil_id,
        sede_id: personas.find((p) => p.id === colaborador.perfil_id)?.sede_id ?? null,
        tipo: "salida",
        marcado_en: marcadoEn,
      })
      .select("id")
      .single();
    if (error || !nuevaMarca) {
      setGuardandoSalidaHE(null);
      setErrorHE(error?.message ?? "No se pudo registrar la salida.");
      return;
    }
    const { error: errorUpd } = await supabase
      .from("asistencia_horas_extra_colaboradores")
      .update({ hora_salida: marcadoEn, marca_registro_id: nuevaMarca.id })
      .eq("id", colaborador.id);
    setGuardandoSalidaHE(null);
    if (errorUpd) {
      setErrorHE(errorUpd.message);
      return;
    }
    // La salida cambió — si ese día ya tenía un "compensado" guardado
    // (calculado contra la salida anterior), queda desactualizado.
    await recalcularCompensadoDia(colaborador.perfil_id, solicitud.fecha);
    cargarSolicitudesHE();
    cargarReporte();
  }

  async function finalizarSolicitudHE(
    solicitud: SolicitudHorasExtra & { colaboradores: (ColaboradorHorasExtra & { nombre: string })[] },
  ) {
    const form = finalizarForm[solicitud.id];
    if (!form || form.pacientePago === null || form.seAgendoCita === null) return;
    setGuardandoFinalizarHE(solicitud.id);
    setErrorHE(null);
    const { error } = await supabase
      .from("asistencia_horas_extra")
      .update({
        estado: "finalizada",
        paciente_pago: form.pacientePago,
        se_agendo_cita: form.seAgendoCita,
        finalizada_en: new Date().toISOString(),
      })
      .eq("id", solicitud.id);
    if (error) {
      setGuardandoFinalizarHE(null);
      setErrorHE(error.message);
      return;
    }
    for (const c of solicitud.colaboradores) {
      const tarea = form.tareas[c.id]?.trim();
      if (tarea) {
        await supabase.from("asistencia_horas_extra_colaboradores").update({ tareas_realizadas: tarea }).eq("id", c.id);
      }
    }
    setGuardandoFinalizarHE(null);
    cargarSolicitudesHE();
  }

  async function cancelarSolicitudHE(id: string) {
    await supabase.from("asistencia_horas_extra").delete().eq("id", id);
    cargarSolicitudesHE();
  }

  const yaMarcado = useMemo(() => new Set(registros.map((r) => r.tipo)), [registros]);

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
      body: { tipo, fecha: fechaMarca, hora: horaMarca },
    });
    setMarcando(null);
    if (error || data?.error) {
      setMensaje({ tipo: "error", texto: data?.error ?? error?.message ?? "No se pudo registrar la marca." });
      return;
    }
    const etiqueta = TIPOS_ASISTENCIA.find((t) => t.value === tipo)?.label ?? tipo;
    setMensaje({ tipo: "ok", texto: `${etiqueta} registrada.` });
    if (data?.frase && (tipo === "llegada" || tipo === "salida")) {
      setFrase({ tipo, texto: data.frase });
    }
    cargarRegistros();
    cargarReporte();
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {perfil?.rol === "admin" && (
      <div className="max-w-md mx-auto space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <h2 className="font-semibold text-tinta">Marcar asistencia</h2>
        <p className="text-xs text-gray-400">Solo funciona conectado a la red de la sede.</p>

        {perfil?.rol === "admin" && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 space-y-1">
            <label className="block text-xs font-medium text-amber-800">Simular día y hora (solo pruebas)</label>
            <div className="flex gap-2">
              <input
                type="date"
                value={fechaMarca}
                onChange={(e) => setFechaMarca(e.target.value)}
                className="rounded-md border border-amber-300 px-2 py-1 text-sm"
              />
              <input
                type="time"
                value={horaMarca}
                onChange={(e) => setHoraMarca(e.target.value)}
                className="rounded-md border border-amber-300 px-2 py-1 text-sm"
              />
            </div>
            <p className="text-xs text-amber-700">
              Solo admin puede cambiarlo — a todos los demás siempre se les registra la hora real, aunque este módulo
              se abra a todo el personal.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          {TIPOS_ASISTENCIA.map((t) => {
            const Icono = ICONOS[t.value];
            const marcadoHoy = yaMarcado.has(t.value);
            const puede = habilitado(t.value);
            return (
              <button
                key={t.value}
                onClick={() => marcar(t.value)}
                disabled={marcando !== null || !puede}
                className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium disabled:opacity-40 ${
                  marcadoHoy ? "bg-gray-100 text-gray-400" : "bg-[var(--acento)] text-white"
                }`}
              >
                <Icono size={16} /> {marcando === t.value ? "Marcando…" : marcadoHoy ? `${t.label} ✓` : t.label}
              </button>
            );
          })}
        </div>

        {mensaje && (
          <p className={`text-sm ${mensaje.tipo === "ok" ? "text-emerald-700" : "text-red-600"}`}>{mensaje.texto}</p>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-500 mb-2">
          Tus marcas {fechaMarca === fechaBogota(new Date().toISOString()) ? "de hoy" : `del ${fechaMarca}`}
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
      )}

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
                disabled={guardandoAdmin || (notaPersona.trim() === notaOriginal && esCompensado === esCompensadoOriginal)}
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
          </div>

          {errorAdmin && <p className="text-sm text-red-600">{errorAdmin}</p>}
        </div>
      )}

      {perfil?.rol === "admin" && (
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
              <input
                type="time"
                value={heHoraIngreso}
                onChange={(e) => setHeHoraIngreso(e.target.value)}
                title="Hora de ingreso al consultorio"
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
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
                const todasConSalida = s.colaboradores.every((c) => c.hora_salida);
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
                          ) : s.estado === "finalizada" ? (
                            <span className="text-gray-400">Sin salida registrada</span>
                          ) : (
                            <>
                              <input
                                type="time"
                                value={horaSalidaInput[c.id] ?? ""}
                                onChange={(e) => setHoraSalidaInput((prev) => ({ ...prev, [c.id]: e.target.value }))}
                                className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                              />
                              <button
                                onClick={() => guardarSalidaColaborador(s, c)}
                                disabled={!horaSalidaInput[c.id] || guardandoSalidaHE === c.id}
                                className="text-xs font-medium px-2.5 py-1.5 rounded-md bg-[var(--acento)] text-white disabled:opacity-40"
                              >
                                {guardandoSalidaHE === c.id ? "Guardando…" : "Guardar salida"}
                              </button>
                            </>
                          )}
                        </div>
                      ))}
                    </div>

                    {s.estado === "abierta" && todasConSalida && (
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
          <h2 className="font-semibold text-tinta">Horas trabajadas por {modoReporte === "periodo" ? "período" : "mes"}</h2>
          <div className="flex items-center gap-2 flex-wrap">
            {perfil?.rol === "admin" && reporte.length > 0 && (
              <button
                onClick={descargarReportePdf}
                className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50"
              >
                Descargar PDF (con firma)
              </button>
            )}
            {periodosLiquidacion.length > 0 && (
              <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm">
                <button
                  onClick={() => setModoReporte("mes")}
                  className={`px-3 py-1.5 font-medium ${modoReporte === "mes" ? "bg-[var(--acento)] text-white" : "text-gray-500"}`}
                >
                  Mes
                </button>
                <button
                  onClick={() => setModoReporte("periodo")}
                  className={`px-3 py-1.5 font-medium ${modoReporte === "periodo" ? "bg-[var(--acento)] text-white" : "text-gray-500"}`}
                >
                  Período
                </button>
              </div>
            )}
            {modoReporte === "periodo" ? (
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
            ) : (
              <input
                type="month"
                value={mesReporte}
                onChange={(e) => setMesReporte(e.target.value)}
                className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
              />
            )}
          </div>
        </div>
        <p className="text-xs text-gray-400">
          Meta: {metaSemanal} h/semana (jornada legal). Las horas extra de cada semana se atribuyen al{" "}
          {modoReporte === "periodo" ? "período" : "mes"} en que empieza esa semana (lunes) — así se sabe cuánto se
          paga después.
        </p>
        {cargandoReporte ? (
          <p className="text-sm text-gray-400">Cargando…</p>
        ) : reporte.length === 0 ? (
          <p className="text-sm text-gray-400">
            Sin marcas completas (llegada + salida) {modoReporte === "periodo" ? "en este período" : "este mes"}.
          </p>
        ) : (
          <div className="space-y-4">
            {reporte.map((fila) => (
              <div key={fila.perfilId} className="border border-gray-100 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-medium text-sm">{fila.nombre}</p>
                  <p className="text-sm">
                    <span className="text-gray-500">Horas extra del {modoReporte === "periodo" ? "período" : "mes"}: </span>
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
                        <th className="font-normal pb-1 text-right">Totales</th>
                        <th className="font-normal pb-1 text-right">Atención pac.</th>
                        <th className="font-normal pb-1 text-right">Ausencia</th>
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
                              <span className="text-gray-400"> — se paga el {modoReporte === "periodo" ? "período" : "mes"} anterior</span>
                            )}
                          </td>
                          <td className="py-1 text-right">{s.horasTrabajadas.toFixed(1)}</td>
                          <td className="py-1 text-right text-violet-600">
                            {s.minutosCompensados > 0 ? (s.minutosCompensados / 60).toFixed(1) : "—"}
                          </td>
                          <td className="py-1 text-right text-indigo-600">{s.horasFestivo > 0 ? `+${s.horasFestivo.toFixed(1)}` : "—"}</td>
                          <td className="py-1 text-right font-medium">{s.horas.toFixed(1)}</td>
                          <td className="py-1 text-right text-pink-600">
                            {(extraAtencionPorPersonaYSemana[`${fila.perfilId}|${s.lunes}`] ?? 0) > 0
                              ? (extraAtencionPorPersonaYSemana[`${fila.perfilId}|${s.lunes}`] ?? 0).toFixed(1)
                              : "—"}
                          </td>
                          <td className="py-1 text-right text-sky-600">
                            {s.horasDescuentoAusencia > 0 ? `−${s.horasDescuentoAusencia.toFixed(1)}` : "—"}
                          </td>
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
                      esAusencia: true,
                      minutosCompensados: 0,
                    })),
                    ...(notasPorPersona[fila.perfilId] ?? []).map((n) => ({
                      fecha: n.fecha,
                      texto: n.nota,
                      esAusencia: false,
                      minutosCompensados: n.minutosCompensados,
                    })),
                  ].sort((a, b) => a.fecha.localeCompare(b.fecha));
                  if (observaciones.length === 0) return null;
                  return (
                    <div className="mt-2 pt-2 border-t border-gray-100 space-y-0.5">
                      {observaciones.map((o, i) => (
                        <p key={`${o.fecha}-${i}`} className={`text-xs ${o.esAusencia ? "text-sky-700" : "text-gray-500"}`}>
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
                onClick={() => setFrase(null)}
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
