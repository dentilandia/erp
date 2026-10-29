import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, MessageCircle, Check } from "lucide-react";
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
}

interface Seguimiento {
  id: string;
  fecha_contacto: string;
  observacion: string | null;
  agendo_cita: boolean;
  created_at: string;
  registrado_por_nombre: string | null;
}

const ESTADOS_RECUPERACION: { value: PacienteRecuperacion["estado_recuperacion"]; label: string; color: string }[] = [
  { value: "pendiente", label: "Pendiente", color: "bg-amber-50 text-amber-700" },
  { value: "en_proceso", label: "En proceso", color: "bg-sky-50 text-sky-700" },
  { value: "recuperado", label: "Recuperado", color: "bg-emerald-50 text-emerald-700" },
  { value: "descartado", label: "Descartado", color: "bg-gray-100 text-gray-500" },
];

function whatsappUrl(celular: string | null): string | null {
  if (!celular) return null;
  const digitos = celular.replace(/\D/g, "");
  if (!digitos) return null;
  const numero = digitos.length === 10 ? `57${digitos}` : digitos;
  return `https://wa.me/${numero}`;
}

export function RecuperacionPacientes() {
  const { perfil } = useAuth();
  const [pacientes, setPacientes] = useState<PacienteRecuperacion[]>([]);
  const [doctoras, setDoctoras] = useState<Doctora[]>([]);
  const [cargando, setCargando] = useState(true);

  const [filtroDoctora, setFiltroDoctora] = useState("");
  const [filtroEstadoCita, setFiltroEstadoCita] = useState("");
  const [filtroEstadoRecuperacion, setFiltroEstadoRecuperacion] = useState<string>("pendiente,en_proceso");
  const [busqueda, setBusqueda] = useState("");

  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({});
  const [seguimientosPorPaciente, setSeguimientosPorPaciente] = useState<Record<string, Seguimiento[]>>({});

  const [formFecha, setFormFecha] = useState<Record<string, string>>({});
  const [formObservacion, setFormObservacion] = useState<Record<string, string>>({});
  const [formAgendo, setFormAgendo] = useState<Record<string, boolean>>({});
  const [guardandoId, setGuardandoId] = useState<string | null>(null);

  const [contador, setContador] = useState<{ hoy: number; hora: number } | null>(null);

  useEffect(() => {
    cargarPacientes();
    supabase
      .from("doctoras")
      .select("*")
      .order("nombre")
      .then(({ data }) => setDoctoras((data as Doctora[]) ?? []));
  }, []);

  async function cargarPacientes() {
    setCargando(true);
    const { data } = await supabase
      .from("recuperacion_pacientes")
      .select("*, doctoras(nombre)")
      .order("fecha_ultima_cita", { ascending: false });
    setPacientes((data as unknown as PacienteRecuperacion[]) ?? []);
    setCargando(false);
  }

  async function cargarSeguimientos(id: string) {
    const { data } = await supabase
      .from("recuperacion_pacientes_seguimientos")
      .select("id, fecha_contacto, observacion, agendo_cita, created_at, registrado_por_nombre")
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
    if (!observacion) return;
    setGuardandoId(id);
    const agendo = formAgendo[id] ?? false;
    const { error } = await supabase.from("recuperacion_pacientes_seguimientos").insert({
      recuperacion_id: id,
      fecha_contacto: formFecha[id] || today(),
      observacion,
      agendo_cita: agendo,
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
    setFormObservacion((prev) => ({ ...prev, [id]: "" }));
    setFormAgendo((prev) => ({ ...prev, [id]: false }));
    setGuardandoId(null);
    await Promise.all([cargarPacientes(), cargarSeguimientos(id)]);
    actualizarContador();
  }

  async function cambiarEstado(id: string, estado: PacienteRecuperacion["estado_recuperacion"]) {
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
    return pacientes.filter((p) => {
      if (estadosRecuperacion && !estadosRecuperacion.includes(p.estado_recuperacion)) return false;
      if (filtroDoctora && p.doctora_id !== filtroDoctora) return false;
      if (filtroEstadoCita && p.estado_ultima_cita !== filtroEstadoCita) return false;
      if (q && !p.nombre.toLowerCase().includes(q) && !(p.celular ?? "").includes(q) && !(p.documento ?? "").includes(q)) return false;
      return true;
    });
  }, [pacientes, filtroEstadoRecuperacion, filtroDoctora, filtroEstadoCita, busqueda]);

  if (cargando) return <p className="text-sm text-gray-400">Cargando…</p>;

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-tinta">Recuperación de pacientes</h1>
        <p className="text-xs text-gray-400">
          Pacientes que asistieron durante 2026 y hoy no tienen cita programada — retómalos por WhatsApp y deja la
          observación de cada intento.
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
        </div>
        <p className="text-xs text-gray-400 mt-2">{pacientesFiltrados.length} pacientes con este filtro.</p>
      </div>

      <div className="space-y-2">
        {pacientesFiltrados.map((p) => {
          const estadoInfo = ESTADOS_RECUPERACION.find((e) => e.value === p.estado_recuperacion)!;
          const wa = whatsappUrl(p.celular);
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
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {wa && (
                    <a
                      href={wa}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-emerald-700"
                    >
                      <MessageCircle size={14} /> WhatsApp
                    </a>
                  )}
                  <select
                    value={p.estado_recuperacion}
                    onChange={(e) => cambiarEstado(p.id, e.target.value as PacienteRecuperacion["estado_recuperacion"])}
                    className={`rounded-lg px-2 py-1.5 text-xs font-medium border-0 ${estadoInfo.color}`}
                  >
                    {ESTADOS_RECUPERACION.map((e) => (
                      <option key={e.value} value={e.value}>
                        {e.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {abierto && (
                <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
                  {seguimientosPorPaciente[p.id]?.length ? (
                    <div className="space-y-1.5">
                      {seguimientosPorPaciente[p.id].map((s) => (
                        <div key={s.id} className="text-xs bg-gray-50 rounded-lg px-3 py-2">
                          <p className="text-gray-400">
                            {s.fecha_contacto} · {s.registrado_por_nombre ?? "—"}
                            {s.agendo_cita && <span className="text-emerald-600 font-medium"> · agendó cita</span>}
                          </p>
                          {s.observacion && <p className="text-gray-700 mt-0.5">{s.observacion}</p>}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400">Sin seguimientos todavía.</p>
                  )}

                  <div className="rounded-lg border border-gray-200 p-3 space-y-2">
                    <div className="flex gap-2 flex-wrap">
                      <input
                        type="date"
                        value={formFecha[p.id] ?? today()}
                        onChange={(e) => setFormFecha((prev) => ({ ...prev, [p.id]: e.target.value }))}
                        className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                      />
                      <input
                        value={formObservacion[p.id] ?? ""}
                        onChange={(e) => setFormObservacion((prev) => ({ ...prev, [p.id]: e.target.value }))}
                        placeholder="¿Qué pasó en el contacto de hoy?"
                        className="flex-1 min-w-[200px] rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-1.5 text-xs text-gray-600">
                        <input
                          type="checkbox"
                          checked={formAgendo[p.id] ?? false}
                          onChange={(e) => setFormAgendo((prev) => ({ ...prev, [p.id]: e.target.checked }))}
                        />
                        Agendó cita
                      </label>
                      <button
                        onClick={() => guardarSeguimiento(p.id)}
                        disabled={guardandoId === p.id || !(formObservacion[p.id] ?? "").trim()}
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
