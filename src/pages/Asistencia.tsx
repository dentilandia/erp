import { useEffect, useMemo, useState } from "react";
import { LogIn, LogOut, Coffee, Utensils, Sparkles } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import { TIPOS_ASISTENCIA, type AsistenciaRegistro, type TipoAsistencia } from "../lib/types";

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
}

interface FilaPersona {
  perfilId: string;
  nombre: string;
  semanas: SemanaReporte[];
  totalHorasExtra: number;
}

/** Arma el reporte de horas del mes: agrupa las marcas por persona y día
 *  calendario, calcula horas trabajadas (llegada→salida, descontando el
 *  almuerzo si hay salida/entrada de almuerzo) y las junta en semanas
 *  lunes-domingo. Solo se cuentan las semanas cuyo lunes cae dentro del mes
 *  seleccionado — así una semana partida entre dos meses queda del lado del
 *  mes donde arrancó, que es como se van a pagar (horas extra del mes se
 *  pagan el mes siguiente).
 */
function armarReporteHoras(registros: RegistroReporte[], mesSeleccionado: string, metaSemanal: number): FilaPersona[] {
  const porPersonaYDia = new Map<string, { nombre: string; marcas: Record<string, string> }>();
  for (const r of registros) {
    const dia = fechaBogota(r.marcado_en);
    const clave = `${r.perfil_id}|${dia}`;
    if (!porPersonaYDia.has(clave)) porPersonaYDia.set(clave, { nombre: r.nombre, marcas: {} });
    const entrada = porPersonaYDia.get(clave)!;
    if (!entrada.marcas[r.tipo]) entrada.marcas[r.tipo] = r.marcado_en;
  }

  const porPersonaYSemana = new Map<string, { nombre: string; horas: number }>();
  for (const [clave, { nombre, marcas }] of porPersonaYDia) {
    const [perfilId, dia] = clave.split("|");
    if (!marcas.llegada || !marcas.salida) continue;
    let horas = (new Date(marcas.salida).getTime() - new Date(marcas.llegada).getTime()) / 3_600_000;
    if (marcas.salida_almuerzo && marcas.entrada_almuerzo) {
      horas -= (new Date(marcas.entrada_almuerzo).getTime() - new Date(marcas.salida_almuerzo).getTime()) / 3_600_000;
    }
    if (horas <= 0) continue;
    const lunes = lunesDeSemana(dia);
    const claveSemana = `${perfilId}|${lunes}`;
    const acumulado = porPersonaYSemana.get(claveSemana);
    porPersonaYSemana.set(claveSemana, { nombre, horas: (acumulado?.horas ?? 0) + horas });
  }

  const porPersona = new Map<string, FilaPersona>();
  for (const [claveSemana, { nombre, horas }] of porPersonaYSemana) {
    const [perfilId, lunes] = claveSemana.split("|");
    if (lunes.slice(0, 7) !== mesSeleccionado) continue;
    if (!porPersona.has(perfilId)) porPersona.set(perfilId, { perfilId, nombre, semanas: [], totalHorasExtra: 0 });
    const fila = porPersona.get(perfilId)!;
    const horasExtra = Math.max(0, horas - metaSemanal);
    const horasDeficit = Math.max(0, metaSemanal - horas);
    fila.semanas.push({ lunes, horas, horasExtra, horasDeficit });
    fila.totalHorasExtra += horasExtra;
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

  // Solo para admin: día que se está simulando al marcar, para poder probar
  // el conteo de horas de varios días seguidos sin esperar a que pasen de
  // verdad. Por defecto es hoy (comportamiento normal).
  const [fechaMarca, setFechaMarca] = useState(() => fechaBogota(new Date().toISOString()));
  const [horaMarca, setHoraMarca] = useState(() => horaBogotaAhora());

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
    setReporte(armarReporteHoras(filas, mesReporte, metaSemanal));
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
    if (fechaMarca.slice(0, 7) === mesReporte) cargarReporte();
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
                        <tr key={s.lunes}>
                          <td className="py-1">
                            {s.lunes} — {sumarDias(s.lunes, 6)}
                          </td>
                          <td className="py-1 text-right">{s.horas.toFixed(1)}</td>
                          <td className="py-1 text-right text-emerald-700">{s.horasExtra > 0 ? s.horasExtra.toFixed(1) : "—"}</td>
                          <td className="py-1 text-right text-amber-600">{s.horasDeficit > 0 ? s.horasDeficit.toFixed(1) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {frase && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-30">
          <div className="max-w-sm w-full rounded-2xl bg-gradient-to-br from-violet-500 to-teal p-6 text-white text-center space-y-4 shadow-2xl">
            <Sparkles size={32} className="mx-auto" />
            <p className="text-xs font-semibold uppercase tracking-wide opacity-80">
              {frase.tipo === "llegada" ? "Para arrancar el día" : "Gracias por hoy"}
            </p>
            <p className="text-lg font-medium leading-snug">{frase.texto}</p>
            <button
              onClick={() => setFrase(null)}
              className="w-full rounded-lg bg-white/20 hover:bg-white/30 py-2.5 text-sm font-semibold"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
