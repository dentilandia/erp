import { useEffect, useMemo, useState } from "react";
import { LogIn, LogOut, Coffee, Utensils, Sunrise, PartyPopper } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import { TIPOS_ASISTENCIA, type AsistenciaRegistro, type TipoAsistencia } from "../lib/types";

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
  horas: number;
  horasExtra: number;
  horasDeficit: number;
  diasAusencia: number;
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
}

interface CompensacionReporte {
  perfil_id: string;
  fecha: string;
  minutos: number;
}

/** Arma el reporte de horas del mes: agrupa las marcas por persona y día
 *  calendario, calcula horas trabajadas (llegada→salida, descontando el
 *  almuerzo si hay salida/entrada de almuerzo, y sumando de vuelta los
 *  minutos ya compensados de un período anterior — si no, se le estaría
 *  restando esa diferencia dos veces) y las junta en semanas lunes-domingo.
 *  Se muestra cualquier semana que toque el mes seleccionado (aunque
 *  arranque en el mes anterior), pero el total de horas extra del mes solo
 *  suma las semanas cuyo lunes cae DENTRO del mes seleccionado — así una
 *  semana partida entre dos meses se ve en ambos, pero solo se paga una vez,
 *  en el mes donde arrancó (el mes siguiente al que se generó).
 */
function armarReporteHoras(
  registros: RegistroReporte[],
  ausencias: AusenciaReporte[],
  compensaciones: CompensacionReporte[],
  mesSeleccionado: string,
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

  const porPersonaYSemana = new Map<string, { nombre: string; horas: number; minutosCompensados: number }>();
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
    });
  }

  // Un día de vacaciones/incapacidad resta una jornada ordinaria (8.5h entre
  // semana, 4h el sábado) de la meta semanal de esa semana, para no
  // marcarlo como déficit.
  const ausenciasPorSemana = new Map<string, { nombre: string; dias: number; horasDescuento: number }>();
  for (const a of ausencias) {
    const lunes = lunesDeSemana(a.fecha);
    const claveSemana = `${a.perfil_id}|${lunes}`;
    const acumulado = ausenciasPorSemana.get(claveSemana);
    ausenciasPorSemana.set(claveSemana, {
      nombre: a.nombre,
      dias: (acumulado?.dias ?? 0) + 1,
      horasDescuento: (acumulado?.horasDescuento ?? 0) + jornadaOrdinariaHoras(a.fecha),
    });
  }

  const clavesSemana = new Set([...porPersonaYSemana.keys(), ...ausenciasPorSemana.keys()]);
  const mesInicio = `${mesSeleccionado}-01`;
  const mesFin = sumarDias(`${mesSeleccionado}-01`, 31).slice(0, 7) + "-01"; // primer día del mes siguiente

  const porPersona = new Map<string, FilaPersona>();
  for (const claveSemana of clavesSemana) {
    const [perfilId, lunes] = claveSemana.split("|");
    const domingo = sumarDias(lunes, 6);
    // La semana se muestra si toca el mes seleccionado (aunque haya arrancado
    // el mes anterior); el total del mes solo cuenta las que arrancan en él.
    if (domingo < mesInicio || lunes >= mesFin) continue;
    const cuentaParaEsteMes = lunes.slice(0, 7) === mesSeleccionado;
    const horas = porPersonaYSemana.get(claveSemana)?.horas ?? 0;
    const minutosCompensados = porPersonaYSemana.get(claveSemana)?.minutosCompensados ?? 0;
    const diasAusencia = ausenciasPorSemana.get(claveSemana)?.dias ?? 0;
    const nombre = porPersonaYSemana.get(claveSemana)?.nombre ?? ausenciasPorSemana.get(claveSemana)?.nombre ?? "—";
    const horasDescuentoAusencia = ausenciasPorSemana.get(claveSemana)?.horasDescuento ?? 0;
    const metaAjustada = Math.max(0, metaSemanal - horasDescuentoAusencia);
    if (!porPersona.has(perfilId)) porPersona.set(perfilId, { perfilId, nombre, semanas: [], totalHorasExtra: 0 });
    const fila = porPersona.get(perfilId)!;
    const horasExtra = Math.max(0, horas - metaAjustada);
    const horasDeficit = Math.max(0, metaAjustada - horas);
    fila.semanas.push({ lunes, horas, horasExtra, horasDeficit, diasAusencia, minutosCompensados, cuentaParaEsteMes });
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
  const [notasPorPersona, setNotasPorPersona] = useState<Record<string, { fecha: string; nota: string }[]>>({});
  const [ausenciasPorPersona, setAusenciasPorPersona] = useState<
    Record<string, { fecha: string; tipo: "vacaciones" | "incapacidad" | "descanso" }[]>
  >({});

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
    setMarcasPersona((data as AsistenciaRegistro[]) ?? []);
    const { data: nota } = await supabase
      .from("asistencia_notas_dia")
      .select("nota, minutos_compensados")
      .eq("perfil_id", personaAdminId)
      .eq("fecha", fechaAdmin)
      .maybeSingle();
    setNotaPersona(nota?.nota ?? "");
    setNotaOriginal(nota?.nota ?? "");
    setEsCompensado((nota?.minutos_compensados ?? 0) > 0);
    setEsCompensadoOriginal((nota?.minutos_compensados ?? 0) > 0);
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
    cargarMarcasPersona();
    cargarReporte();
  }

  async function eliminarMarcaPersona(id: string) {
    setErrorAdmin(null);
    const { error } = await supabase.from("asistencia_registros").delete().eq("id", id);
    if (error) {
      setErrorAdmin(error.message);
      return;
    }
    cargarMarcasPersona();
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

  async function cargarReporte() {
    setCargandoReporte(true);
    // Se pide con 8 días de colchón a cada lado para que las semanas que
    // cruzan el borde del mes queden completas (armarReporteHoras las filtra
    // después por el mes del lunes de cada semana).
    const desde = sumarDias(`${mesReporte}-01`, -8);
    const hasta = sumarDias(`${mesReporte}-01`, 39);
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
      .select("perfil_id, fecha, tipo, perfiles(nombre)")
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
    const notasAgrupadas: Record<string, { fecha: string; nota: string }[]> = {};
    for (const n of notasRows) {
      if (n.nota) (notasAgrupadas[n.perfil_id] ??= []).push({ fecha: n.fecha, nota: n.nota });
    }
    setNotasPorPersona(notasAgrupadas);
    const compensaciones: CompensacionReporte[] = notasRows
      .filter((n) => n.minutos_compensados)
      .map((n) => ({ perfil_id: n.perfil_id, fecha: n.fecha, minutos: n.minutos_compensados }));

    setReporte(armarReporteHoras(filas, ausencias, compensaciones, mesReporte, metaSemanal));
    setCargandoReporte(false);
  }

  useEffect(() => {
    cargarReporte();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesReporte, metaSemanal]);

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

      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="font-semibold text-tinta">Horas trabajadas por mes</h2>
          <input
            type="month"
            value={mesReporte}
            onChange={(e) => setMesReporte(e.target.value)}
            className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
          />
        </div>
        <p className="text-xs text-gray-400">
          Meta: {metaSemanal} h/semana (jornada legal). Las horas extra de cada semana se atribuyen al mes en que
          empieza esa semana (lunes) — así se sabe cuánto se paga el mes siguiente.
        </p>
        {cargandoReporte ? (
          <p className="text-sm text-gray-400">Cargando…</p>
        ) : reporte.length === 0 ? (
          <p className="text-sm text-gray-400">Sin marcas completas (llegada + salida) este mes.</p>
        ) : (
          <div className="space-y-4">
            {reporte.map((fila) => (
              <div key={fila.perfilId} className="border border-gray-100 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-medium text-sm">{fila.nombre}</p>
                  <p className="text-sm">
                    <span className="text-gray-500">Horas extra del mes: </span>
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
                        <th className="font-normal pb-1 text-right">Horas</th>
                        <th className="font-normal pb-1 text-right">Extra</th>
                        <th className="font-normal pb-1 text-right">Déficit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {fila.semanas.map((s) => (
                        <tr key={s.lunes} className={s.cuentaParaEsteMes ? "" : "opacity-50"}>
                          <td className="py-1">
                            {s.lunes} — {sumarDias(s.lunes, 6)}
                            {s.diasAusencia > 0 && (
                              <span className="text-sky-600"> (−{s.diasAusencia}d ausencia)</span>
                            )}
                            {s.minutosCompensados > 0 && (
                              <span className="text-violet-600"> (+{s.minutosCompensados}min comp.)</span>
                            )}
                            {!s.cuentaParaEsteMes && <span className="text-gray-400"> — se paga el mes anterior</span>}
                          </td>
                          <td className="py-1 text-right">{s.horas.toFixed(1)}</td>
                          <td className="py-1 text-right text-emerald-700">{s.horasExtra > 0 ? s.horasExtra.toFixed(1) : "—"}</td>
                          <td className="py-1 text-right text-amber-600">{s.horasDeficit > 0 ? s.horasDeficit.toFixed(1) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {ausenciasPorPersona[fila.perfilId]?.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-gray-100 space-y-0.5">
                    {ausenciasPorPersona[fila.perfilId]
                      .sort((a, b) => a.fecha.localeCompare(b.fecha))
                      .map((a) => (
                        <p key={a.fecha} className="text-xs text-sky-700">
                          <span className="font-medium">{a.fecha}:</span> {ETIQUETAS_AUSENCIA[a.tipo]}
                        </p>
                      ))}
                  </div>
                )}
                {notasPorPersona[fila.perfilId]?.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-gray-100 space-y-0.5">
                    {notasPorPersona[fila.perfilId]
                      .sort((a, b) => a.fecha.localeCompare(b.fecha))
                      .map((n) => (
                        <p key={n.fecha} className="text-xs text-gray-500">
                          <span className="font-medium">{n.fecha}:</span> {n.nota}
                        </p>
                      ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

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
