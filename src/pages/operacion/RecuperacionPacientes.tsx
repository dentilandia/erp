import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Phone, MessageSquare, Check } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { today } from "../../lib/format";
import { useAuth } from "../../auth/AuthContext";
import type { Doctora } from "../../lib/types";

interface PacienteRecuperacion {
  id: string;
  documento: string | null;
  nombre: string;
  celular: string | null;
  doctora_id: string | null;
  doctora_nombre_original: string | null;
  fecha_ultima_cita: string | null;
  motivo_ultima_cita: string | null;
  estado_ultima_cita: string | null;
  estado_recuperacion: "pendiente" | "en_proceso" | "recuperado" | "descartado";
  doctoras: { nombre: string } | null;
  // Fecha de la cita que se agendó (la escribe la auxiliar) y la fecha en que
  // el paciente llegó de verdad (la marca el sistema solo, al crear Recepción
  // su visita). Ver supabase/migrations/0100_recuperacion_cita_asistencia.sql.
  fecha_cita: string | null;
  asistio_fecha: string | null;
  ultimo_contacto: string | null;
  intentos: number;
  llamado: boolean;
}

type Alerta = "" | "frios" | "sin_llamada" | "no_asistio" | "por_asistir" | "asistio";

function diasDesde(fecha: string, hoy: string): number {
  return Math.round((new Date(`${hoy}T00:00:00`).getTime() - new Date(`${fecha}T00:00:00`).getTime()) / 86400000);
}

function fechaCorta(d: string): string {
  return new Date(`${d}T12:00:00`).toLocaleDateString("es-CO", { day: "numeric", month: "short" });
}

/** En qué grupo de alerta cae el paciente (un caso "en proceso" puede estar frío Y sin llamada). */
function alertasDe(p: PacienteRecuperacion, hoy: string): Alerta[] {
  const a: Alerta[] = [];
  if (p.estado_recuperacion === "en_proceso") {
    if (!p.ultimo_contacto || diasDesde(p.ultimo_contacto, hoy) > 7) a.push("frios");
    if (!p.llamado) a.push("sin_llamada");
  }
  if (p.estado_recuperacion === "recuperado") {
    if (p.asistio_fecha) a.push("asistio");
    else if (p.fecha_cita && p.fecha_cita < hoy) a.push("no_asistio");
    else a.push("por_asistir");
  }
  return a;
}

interface Seguimiento {
  id: string;
  fecha_contacto: string;
  llamo: boolean;
  retomo_b2chat: boolean;
  observacion: string | null;
  agendo_cita: boolean;
  fecha_cita: string | null;
  ya_tenia_cita: boolean;
  paciente_escribio: boolean;
  created_at: string;
  registrado_por_nombre: string | null;
}

const ESTADOS_RECUPERACION: { value: PacienteRecuperacion["estado_recuperacion"]; label: string; color: string }[] = [
  { value: "pendiente", label: "Pendiente", color: "bg-amber-50 text-amber-700" },
  { value: "en_proceso", label: "En proceso", color: "bg-sky-50 text-sky-700" },
  { value: "recuperado", label: "Recuperado", color: "bg-emerald-50 text-emerald-700" },
  { value: "descartado", label: "Descartado", color: "bg-gray-100 text-gray-500" },
];

export function RecuperacionPacientes({ sedeId }: { sedeId: string }) {
  const { perfil } = useAuth();
  const [pacientes, setPacientes] = useState<PacienteRecuperacion[]>([]);
  const [doctoras, setDoctoras] = useState<Doctora[]>([]);
  const [cargando, setCargando] = useState(true);

  const [filtroDoctora, setFiltroDoctora] = useState("");
  const [filtroEstadoCita, setFiltroEstadoCita] = useState("");
  const [filtroEstadoRecuperacion, setFiltroEstadoRecuperacion] = useState<string>("pendiente,en_proceso");
  const [busqueda, setBusqueda] = useState("");
  const [filtroMotivo, setFiltroMotivo] = useState("");

  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({});
  const [seguimientosPorPaciente, setSeguimientosPorPaciente] = useState<Record<string, Seguimiento[]>>({});

  const [formFecha, setFormFecha] = useState<Record<string, string>>({});
  const [formLlamo, setFormLlamo] = useState<Record<string, boolean>>({});
  const [formRetomoB2chat, setFormRetomoB2chat] = useState<Record<string, boolean>>({});
  const [formObservacion, setFormObservacion] = useState<Record<string, string>>({});
  const [formAgendo, setFormAgendo] = useState<Record<string, boolean>>({});
  const [formFechaCita, setFormFechaCita] = useState<Record<string, string>>({});
  // Sin llamada: el paciente ya tenía cita agendada, o él/los papás escribieron.
  const [formYaTeniaCita, setFormYaTeniaCita] = useState<Record<string, boolean>>({});
  const [formEscribio, setFormEscribio] = useState<Record<string, boolean>>({});
  const [filtroAlerta, setFiltroAlerta] = useState<Alerta>("");
  const [guardandoId, setGuardandoId] = useState<string | null>(null);

  const [contador, setContador] = useState<{ hoy: number; hora: number } | null>(null);

  useEffect(() => {
    cargarPacientes();
    supabase
      .from("doctoras")
      .select("*")
      .order("nombre")
      .then(({ data }) => setDoctoras((data as Doctora[]) ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sedeId]);

  async function cargarPacientes() {
    setCargando(true);
    const { data } = await supabase
      .from("recuperacion_pacientes")
      .select("*, doctoras(nombre)")
      .eq("sede_id", sedeId)
      .order("fecha_ultima_cita", { ascending: false });
    setPacientes((data as unknown as PacienteRecuperacion[]) ?? []);
    setCargando(false);
  }

  async function cargarSeguimientos(id: string) {
    const { data } = await supabase
      .from("recuperacion_pacientes_seguimientos")
      .select("id, fecha_contacto, llamo, retomo_b2chat, observacion, agendo_cita, fecha_cita, ya_tenia_cita, paciente_escribio, created_at, registrado_por_nombre")
      .eq("recuperacion_id", id)
      .order("created_at", { ascending: false });
    setSeguimientosPorPaciente((prev) => ({ ...prev, [id]: (data as Seguimiento[]) ?? [] }));
  }

  function alternarAbierto(id: string) {
    const abrir = !abiertos[id];
    setAbiertos((prev) => ({ ...prev, [id]: abrir }));
    if (abrir && !seguimientosPorPaciente[id]) cargarSeguimientos(id);
  }

  // Contador de hoy/esta hora para quien está llamando — solo de lo que ESE
  // perfil registró, no de todo el equipo. "En el buen sentido": no bloquea
  // nada, solo se muestra después de cada registro para dar presión positiva.
  async function actualizarContador() {
    if (!perfil) return;
    const inicioHoy = `${today()}T00:00:00`;
    const haceUnaHora = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const [{ count: hoy }, { count: hora }] = await Promise.all([
      supabase
        .from("recuperacion_pacientes_seguimientos")
        .select("id", { count: "exact", head: true })
        .eq("registrado_por", perfil.id)
        .gte("created_at", inicioHoy),
      supabase
        .from("recuperacion_pacientes_seguimientos")
        .select("id", { count: "exact", head: true })
        .eq("registrado_por", perfil.id)
        .gte("created_at", haceUnaHora),
    ]);
    setContador({ hoy: hoy ?? 0, hora: hora ?? 0 });
  }

  async function guardarSeguimiento(id: string) {
    const observacion = (formObservacion[id] ?? "").trim();
    const llamo = formLlamo[id] ?? false;
    const retomoB2chat = formRetomoB2chat[id] ?? false;
    const yaTeniaCita = formYaTeniaCita[id] ?? false;
    const escribio = formEscribio[id] ?? false;
    if (!llamo && !yaTeniaCita && !escribio) {
      window.alert(
        'Marca el paso 1: la llamada (y B2chat si no contestó). Si no llamaste, marca "Ya tenía cita agendada" o "El paciente / los papás escribieron".',
      );
      return;
    }
    const agendo = yaTeniaCita || (formAgendo[id] ?? false);
    const fechaCita = formFechaCita[id] ?? "";
    if (agendo && !fechaCita) {
      window.alert("Pon la fecha de la cita que se agendó.");
      return;
    }
    setGuardandoId(id);
    const { error } = await supabase.from("recuperacion_pacientes_seguimientos").insert({
      recuperacion_id: id,
      sede_id: sedeId,
      fecha_contacto: formFecha[id] || today(),
      llamo,
      retomo_b2chat: retomoB2chat,
      observacion: observacion || null,
      agendo_cita: agendo,
      fecha_cita: agendo ? fechaCita : null,
      ya_tenia_cita: yaTeniaCita,
      paciente_escribio: escribio,
      registrado_por: perfil?.id ?? null,
      registrado_por_nombre: perfil?.nombre ?? null,
    });
    if (error) {
      setGuardandoId(null);
      window.alert(`No se pudo guardar el seguimiento: ${error.message}`);
      return;
    }
    const pacienteActual = pacientes.find((p) => p.id === id);
    if (agendo) {
      await supabase.from("recuperacion_pacientes").update({ estado_recuperacion: "recuperado" }).eq("id", id);
    } else if (pacienteActual?.estado_recuperacion === "pendiente") {
      await supabase.from("recuperacion_pacientes").update({ estado_recuperacion: "en_proceso" }).eq("id", id);
    }
    setFormFecha((prev) => ({ ...prev, [id]: "" }));
    setFormLlamo((prev) => ({ ...prev, [id]: false }));
    setFormRetomoB2chat((prev) => ({ ...prev, [id]: false }));
    setFormObservacion((prev) => ({ ...prev, [id]: "" }));
    setFormAgendo((prev) => ({ ...prev, [id]: false }));
    setPideFechaId(null);
    setFormYaTeniaCita((prev) => ({ ...prev, [id]: false }));
    setFormEscribio((prev) => ({ ...prev, [id]: false }));
    setFormFechaCita((prev) => ({ ...prev, [id]: "" }));
    setGuardandoId(null);
    await Promise.all([cargarPacientes(), cargarSeguimientos(id)]);
    actualizarContador();
  }

  // "Recuperado" no se pone a mano desde el selector: sin la fecha de la cita
  // no se puede verificar después si el paciente asistió. Se abre el
  // formulario de seguimiento con "Agendó cita" marcado para que la pongan.
  const [pideFechaId, setPideFechaId] = useState<string | null>(null);
  async function cambiarEstado(id: string, estado: PacienteRecuperacion["estado_recuperacion"]) {
    if (estado === "recuperado") {
      setFormAgendo((prev) => ({ ...prev, [id]: true }));
      setPideFechaId(id);
      if (!abiertos[id]) alternarAbierto(id);
      return;
    }
    await supabase.from("recuperacion_pacientes").update({ estado_recuperacion: estado }).eq("id", id);
    cargarPacientes();
  }

  const estadosCitaDisponibles = useMemo(
    () => Array.from(new Set(pacientes.map((p) => p.estado_ultima_cita).filter((e): e is string => !!e))).sort(),
    [pacientes],
  );

  const pacientesFiltrados = useMemo(() => {
    const estadosRecuperacion = filtroEstadoRecuperacion ? filtroEstadoRecuperacion.split(",") : null;
    const q = busqueda.trim().toLowerCase();
    const m = filtroMotivo.trim().toLowerCase();
    const hoy = today();
    return pacientes.filter((p) => {
      if (filtroAlerta) return alertasDe(p, hoy).includes(filtroAlerta);
      if (estadosRecuperacion && !estadosRecuperacion.includes(p.estado_recuperacion)) return false;
      if (filtroDoctora && p.doctora_id !== filtroDoctora) return false;
      if (filtroEstadoCita && p.estado_ultima_cita !== filtroEstadoCita) return false;
      if (q && !p.nombre.toLowerCase().includes(q) && !(p.celular ?? "").includes(q) && !(p.documento ?? "").includes(q)) return false;
      if (m && !(p.motivo_ultima_cita ?? "").toLowerCase().includes(m)) return false;
      return true;
    });
  }, [pacientes, filtroEstadoRecuperacion, filtroDoctora, filtroEstadoCita, busqueda, filtroMotivo, filtroAlerta]);

  const conteoAlertas = useMemo(() => {
    const hoy = today();
    const c: Record<string, number> = {};
    for (const p of pacientes) for (const a of alertasDe(p, hoy)) c[a] = (c[a] ?? 0) + 1;
    return c;
  }, [pacientes]);

  const ALERTAS: { value: Exclude<Alerta, "">; label: string; ayuda: string; clase: string }[] = [
    { value: "frios", label: "En proceso sin contacto hace +7 días", ayuda: "Se están enfriando: retómalos hoy.", clase: "border-red-200 bg-red-50 text-red-800" },
    { value: "sin_llamada", label: "En proceso sin llamada", ayuda: "Solo se les escribió por B2chat: falta llamarlos.", clase: "border-amber-200 bg-amber-50 text-amber-800" },
    { value: "no_asistio", label: "Agendaron y no asistieron", ayuda: "La fecha de la cita pasó y no llegaron: vuelve a llamarlos.", clase: "border-red-200 bg-red-50 text-red-800" },
    { value: "por_asistir", label: "Agendados por asistir", ayuda: "Tienen cita futura o no tienen fecha de cita registrada.", clase: "border-sky-200 bg-sky-50 text-sky-800" },
    { value: "asistio", label: "Asistieron", ayuda: "Llegaron a consulta después de agendar (lo marca el sistema).", clase: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  ];

  if (cargando) return <p className="text-sm text-gray-400">Cargando…</p>;

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-tinta">Recuperación de pacientes</h1>
        <p className="text-xs text-gray-400">
          Pacientes que asistieron durante 2026 y hoy no tienen cita programada — primero llama, luego retómalo por
          B2chat, y deja la observación de cada intento.
        </p>
      </div>

      {contador && (
        <div className="rounded-xl border-2 border-[var(--acento)] bg-[var(--acento)]/5 p-3 flex items-center gap-4 text-sm">
          <span className="font-semibold text-[var(--acento)]">
            Hoy llevas {contador.hoy} {contador.hoy === 1 ? "paciente retomado" : "pacientes retomados"}
          </span>
          <span className="text-gray-500">{contador.hora} en la última hora</span>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {ALERTAS.map((a) => (
          <button
            key={a.value}
            onClick={() => setFiltroAlerta(filtroAlerta === a.value ? "" : a.value)}
            title={a.ayuda}
            className={`rounded-xl border px-3 py-2 text-left ${a.clase} ${filtroAlerta === a.value ? "ring-2 ring-[var(--acento)]" : ""}`}
          >
            <span className="block text-xl font-bold">{conteoAlertas[a.value] ?? 0}</span>
            <span className="block text-xs font-medium leading-tight">{a.label}</span>
          </button>
        ))}
      </div>
      {filtroAlerta && (
        <p className="text-xs text-gray-600">
          Mostrando: <strong>{ALERTAS.find((a) => a.value === filtroAlerta)?.label}</strong> —{" "}
          {ALERTAS.find((a) => a.value === filtroAlerta)?.ayuda}{" "}
          <button onClick={() => setFiltroAlerta("")} className="text-[var(--acento)] font-medium">
            Quitar filtro
          </button>
        </p>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-wrap gap-2">
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre, celular o documento…"
            className="flex-1 min-w-[200px] rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <select
            value={filtroDoctora}
            onChange={(e) => setFiltroDoctora(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">Todas las doctoras</option>
            {doctoras.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nombre}
              </option>
            ))}
          </select>
          <select
            value={filtroEstadoCita}
            onChange={(e) => setFiltroEstadoCita(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">Cualquier estado de última cita</option>
            {estadosCitaDisponibles.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
          <select
            value={filtroEstadoRecuperacion}
            onChange={(e) => setFiltroEstadoRecuperacion(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="pendiente,en_proceso">Por recuperar (pendiente + en proceso)</option>
            {ESTADOS_RECUPERACION.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
            <option value="">Todos</option>
          </select>
          <input
            value={filtroMotivo}
            onChange={(e) => setFiltroMotivo(e.target.value)}
            placeholder="Buscar en el motivo de la última cita…"
            className="flex-1 min-w-[220px] rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <p className="text-xs text-gray-400 mt-2">{pacientesFiltrados.length} pacientes con este filtro.</p>
      </div>

      <div className="space-y-2">
        {pacientesFiltrados.map((p) => {
          const estadoInfo = ESTADOS_RECUPERACION.find((e) => e.value === p.estado_recuperacion)!;
          const abierto = !!abiertos[p.id];
          return (
            <div key={p.id} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div>
                  <button onClick={() => alternarAbierto(p.id)} className="flex items-center gap-1.5 font-medium text-tinta">
                    {abierto ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    {p.nombre}
                  </button>
                  <p className="text-xs text-gray-400 mt-0.5 ml-[22px]">
                    {p.doctoras?.nombre ?? p.doctora_nombre_original ?? "—"} · Última cita: {p.fecha_ultima_cita ?? "—"}
                    {p.estado_ultima_cita ? ` (${p.estado_ultima_cita})` : ""}
                    {p.celular ? ` · ${p.celular}` : ""}
                  </p>
                  {p.motivo_ultima_cita && <p className="text-xs text-gray-500 mt-1 ml-[22px] max-w-xl">{p.motivo_ultima_cita}</p>}
                  <BadgesPaciente p={p} />
                </div>
                <select
                  value={p.estado_recuperacion}
                  onChange={(e) => cambiarEstado(p.id, e.target.value as PacienteRecuperacion["estado_recuperacion"])}
                  className={`shrink-0 rounded-lg px-2 py-1.5 text-xs font-medium border-0 ${estadoInfo.color}`}
                >
                  {ESTADOS_RECUPERACION.map((e) => (
                    <option key={e.value} value={e.value}>
                      {e.label}
                    </option>
                  ))}
                </select>
              </div>

              {abierto && (
                <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
                  {seguimientosPorPaciente[p.id]?.length ? (
                    <div className="space-y-1.5">
                      {seguimientosPorPaciente[p.id].map((s) => (
                        <div key={s.id} className="text-xs bg-gray-50 rounded-lg px-3 py-2">
                          <p className="text-gray-400 flex items-center gap-1">
                            {s.llamo && <Phone size={12} />}
                            {s.retomo_b2chat && <MessageSquare size={12} />}
                            {s.fecha_contacto} · {s.registrado_por_nombre ?? "—"}
                            {s.paciente_escribio && <span className="text-sky-700 font-medium"> · el paciente / los papás escribieron</span>}
                            {s.agendo_cita && (
                              <span className="text-emerald-600 font-medium">
                                {" "}
                                · {s.ya_tenia_cita ? "ya tenía cita" : "agendó cita"}
                                {s.fecha_cita ? ` para el ${fechaCorta(s.fecha_cita)}` : ""}
                              </span>
                            )}
                          </p>
                          {s.observacion && <p className="text-gray-700 mt-0.5">{s.observacion}</p>}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400">Sin seguimientos todavía.</p>
                  )}

                  <div className="rounded-lg border border-gray-200 p-3 space-y-2">
                    {pideFechaId === p.id && (
                      <p className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                        Para marcarlo como recuperado, registra el seguimiento con la <strong>fecha de la cita</strong> (o marca
                        "Ya tenía cita agendada") y dale "Guardar seguimiento".
                      </p>
                    )}
                    <div className="flex gap-2 flex-wrap">
                      <label className="flex items-center gap-1.5 text-sm text-emerald-800 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={formYaTeniaCita[p.id] ?? false}
                          onChange={(e) => {
                            const v = e.target.checked;
                            setFormYaTeniaCita((prev) => ({ ...prev, [p.id]: v }));
                            setFormAgendo((prev) => ({ ...prev, [p.id]: v }));
                          }}
                        />
                        📅 Ya tenía cita agendada
                      </label>
                      <label className="flex items-center gap-1.5 text-sm text-sky-800 rounded-lg border border-sky-200 bg-sky-50 px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={formEscribio[p.id] ?? false}
                          onChange={(e) => setFormEscribio((prev) => ({ ...prev, [p.id]: e.target.checked }))}
                        />
                        ✉️ El paciente / los papás escribieron
                      </label>
                      <span className="self-center text-xs text-gray-400">(en estos casos no hace falta llamar)</span>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <input
                        type="date"
                        value={formFecha[p.id] ?? today()}
                        onChange={(e) => setFormFecha((prev) => ({ ...prev, [p.id]: e.target.value }))}
                        className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                      />
                      <label className="flex items-center gap-1.5 text-sm text-gray-600 rounded-lg border border-gray-300 px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={formLlamo[p.id] ?? false}
                          onChange={(e) => {
                            const v = e.target.checked;
                            setFormLlamo((prev) => ({ ...prev, [p.id]: v }));
                            if (!v) setFormRetomoB2chat((prev) => ({ ...prev, [p.id]: false }));
                          }}
                        />
                        📞 1. Llamó
                      </label>
                      <label
                        className={`flex items-center gap-1.5 text-sm text-gray-600 rounded-lg border border-gray-300 px-2 py-1.5 ${
                          formLlamo[p.id] ? "" : "opacity-50"
                        }`}
                        title="Primero la llamada; B2chat solo si no contestó"
                      >
                        <input
                          type="checkbox"
                          disabled={!formLlamo[p.id]}
                          checked={formRetomoB2chat[p.id] ?? false}
                          onChange={(e) => setFormRetomoB2chat((prev) => ({ ...prev, [p.id]: e.target.checked }))}
                        />
                        💬 2. B2chat (no contestó)
                      </label>
                      <input
                        value={formObservacion[p.id] ?? ""}
                        onChange={(e) => setFormObservacion((prev) => ({ ...prev, [p.id]: e.target.value }))}
                        placeholder="¿Qué pasó en el contacto de hoy? (opcional)"
                        className="flex-1 min-w-[200px] rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-1.5 text-xs text-gray-600">
                        <input
                          type="checkbox"
                          checked={formAgendo[p.id] ?? false}
                          disabled={formYaTeniaCita[p.id] ?? false}
                          onChange={(e) => setFormAgendo((prev) => ({ ...prev, [p.id]: e.target.checked }))}
                        />
                        {formYaTeniaCita[p.id] ? "Ya tenía cita" : "Agendó cita"}
                        {formAgendo[p.id] && (
                          <>
                            <span className="ml-1">— fecha de la cita</span>
                            <input
                              type="date"
                              min={today()}
                              value={formFechaCita[p.id] ?? ""}
                              onChange={(e) => setFormFechaCita((prev) => ({ ...prev, [p.id]: e.target.value }))}
                              className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
                            />
                          </>
                        )}
                      </label>
                      <button
                        onClick={() => guardarSeguimiento(p.id)}
                        disabled={guardandoId === p.id}
                        className="flex items-center gap-1.5 rounded-lg bg-[var(--acento)] text-white px-4 py-1.5 text-sm font-medium disabled:opacity-40"
                      >
                        <Check size={14} /> {guardandoId === p.id ? "Guardando…" : "Guardar seguimiento"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {pacientesFiltrados.length === 0 && <p className="text-sm text-gray-400 text-center py-8">Nadie con este filtro.</p>}
      </div>
    </div>
  );
}

/** Etiquetas de seguimiento: días sin contacto, falta llamada, y si el agendado asistió. */
function BadgesPaciente({ p }: { p: PacienteRecuperacion }) {
  const hoy = today();
  const badges: { texto: string; clase: string }[] = [];
  if (p.estado_recuperacion === "en_proceso") {
    if (!p.ultimo_contacto) badges.push({ texto: "Sin contactos registrados", clase: "bg-red-100 text-red-700" });
    else {
      const d = diasDesde(p.ultimo_contacto, hoy);
      badges.push({
        texto: d === 0 ? "Contactado hoy" : `Último contacto hace ${d} día${d === 1 ? "" : "s"}`,
        clase: d > 7 ? "bg-red-100 text-red-700" : d >= 3 ? "bg-amber-100 text-amber-800" : "bg-emerald-50 text-emerald-700",
      });
    }
    if (!p.llamado) badges.push({ texto: "Falta llamada", clase: "bg-amber-100 text-amber-800" });
  }
  if (p.estado_recuperacion === "recuperado") {
    if (p.asistio_fecha) badges.push({ texto: `Asistió el ${fechaCorta(p.asistio_fecha)}`, clase: "bg-emerald-100 text-emerald-800" });
    else if (p.fecha_cita && p.fecha_cita < hoy)
      badges.push({ texto: `No asistió (cita ${fechaCorta(p.fecha_cita)})`, clase: "bg-red-100 text-red-700" });
    else if (p.fecha_cita) badges.push({ texto: `Cita el ${fechaCorta(p.fecha_cita)}`, clase: "bg-sky-50 text-sky-700" });
    else badges.push({ texto: "Sin fecha de cita", clase: "bg-gray-100 text-gray-600" });
  }
  if (p.intentos > 0) badges.push({ texto: `${p.intentos} intento${p.intentos === 1 ? "" : "s"}`, clase: "bg-gray-100 text-gray-600" });
  if (badges.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5 ml-[22px]">
      {badges.map((b) => (
        <span key={b.texto} className={`text-xs font-medium px-2 py-0.5 rounded-full ${b.clase}`}>
          {b.texto}
        </span>
      ))}
    </div>
  );
}
