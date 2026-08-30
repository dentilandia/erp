import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Plus, X, Split, Trash2, Check } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { fmtCOP, today } from "../../lib/format";
import {
  MEDIOS_PAGO,
  CONCEPTOS_ADMINISTRATIVOS,
  MOTIVOS_SALDO_FAVOR,
  TIPOS_INSUMO_CONSULTA,
  type Sede,
  type Doctora,
  type Paciente,
  type MedioPago,
  type CategoriaCargo,
} from "../../lib/types";
import { PacienteAutocomplete } from "../../components/PacienteAutocomplete";

const CONCEPTO_PRECIO_CLAVE: Record<string, string> = {
  GUM: "gum",
  "Caja aparato": "caja_aparato",
  "Llave de aparato": "llave_aparato",
};

interface VisitaRow {
  id: string;
  estado: "espera" | "consulta" | "cobrado";
  fecha: string;
  paciente_id: string;
  doctora_id: string;
  pacientes: { nombre: string };
  doctoras: { nombre: string; color_pastel: string };
}

interface CargoRow {
  id: string;
  categoria: CategoriaCargo;
  concepto: string;
  valor: number;
}

interface PagoLinea {
  medio: MedioPago;
  valor: number;
}

interface ExcedenteLinea {
  medio: MedioPago;
  valor: number;
  motivo: string;
}

interface CargoEdit {
  id?: string; // undefined = concepto nuevo, aún no insertado
  categoria: CategoriaCargo;
  concepto: string;
  valor: number;
  pagos: PagoLinea[];
}

export function Recepcion() {
  const { sedeActiva } = useOutletContext<{ sedeActiva: Sede }>();
  const [fecha, setFecha] = useState(today());

  const [visitas, setVisitas] = useState<VisitaRow[]>([]);
  const [doctoras, setDoctoras] = useState<Doctora[]>([]);
  const [cargando, setCargando] = useState(true);

  const [nuevoPaciente, setNuevoPaciente] = useState<Paciente | null>(null);
  const [nuevaDoctoraId, setNuevaDoctoraId] = useState("");
  const [creandoVisita, setCreandoVisita] = useState(false);

  const [cobrandoId, setCobrandoId] = useState<string | null>(null);
  const [filtroDoctoraCobradas, setFiltroDoctoraCobradas] = useState("");

  const [pacienteSaldoExterno, setPacienteSaldoExterno] = useState<Paciente | null>(null);
  const [medioSaldoExterno, setMedioSaldoExterno] = useState<MedioPago>("efectivo");
  const [motivoSaldoExterno, setMotivoSaldoExterno] = useState(MOTIVOS_SALDO_FAVOR[0]);
  const [valorSaldoExterno, setValorSaldoExterno] = useState("");
  const [notaSaldoExterno, setNotaSaldoExterno] = useState("");
  const [guardandoSaldoExterno, setGuardandoSaldoExterno] = useState(false);
  const [saldoExternoOk, setSaldoExternoOk] = useState(false);
  const [errorSaldoExterno, setErrorSaldoExterno] = useState<string | null>(null);
  const [mostrarSaldoExterno, setMostrarSaldoExterno] = useState(false);

  async function cargarVisitas() {
    const { data } = await supabase
      .from("visitas")
      .select("id, estado, fecha, paciente_id, doctora_id, pacientes(nombre), doctoras(nombre, color_pastel)")
      .eq("sede_id", sedeActiva.id)
      .eq("fecha", fecha)
      .order("created_at", { ascending: false });
    setVisitas((data as unknown as VisitaRow[]) ?? []);
    setCargando(false);
  }

  useEffect(() => {
    setCargando(true);
    cargarVisitas();
    supabase.from("doctoras").select("*").eq("activa", true).order("nombre").then(({ data }) => {
      setDoctoras((data as Doctora[]) ?? []);
      if (data && data.length > 0) {
        const recordada = localStorage.getItem(`recepcion_doctora_${sedeActiva.id}`);
        const existe = recordada && data.some((d) => d.id === recordada);
        setNuevaDoctoraId(existe ? recordada! : data[0].id);
      }
    });

    const channel = supabase
      .channel(`visitas-${sedeActiva.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "visitas", filter: `sede_id=eq.${sedeActiva.id}` }, () => {
        cargarVisitas();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sedeActiva.id, fecha]);

  async function crearVisita() {
    if (!nuevoPaciente || !nuevaDoctoraId) return;
    setCreandoVisita(true);
    await supabase.from("visitas").insert({
      sede_id: sedeActiva.id,
      paciente_id: nuevoPaciente.id,
      doctora_id: nuevaDoctoraId,
      fecha,
      estado: "espera",
    });
    setNuevoPaciente(null);
    setCreandoVisita(false);
    cargarVisitas();
  }

  async function eliminarVisita(id: string) {
    if (!window.confirm("¿Eliminar esta visita? Esto no se puede deshacer.")) return;
    await supabase.from("visitas").delete().eq("id", id);
    cargarVisitas();
  }

  async function registrarSaldoSinCita() {
    const valor = Number(valorSaldoExterno);
    if (!pacienteSaldoExterno || !valor) return;
    setGuardandoSaldoExterno(true);
    setErrorSaldoExterno(null);
    const { error } = await supabase.from("saldos_favor").insert({
      paciente_id: pacienteSaldoExterno.id,
      sede_origen_id: sedeActiva.id,
      valor,
      valor_disponible: valor,
      medio_origen: medioSaldoExterno,
      motivo: motivoSaldoExterno,
      fecha,
      notas: notaSaldoExterno.trim() || null,
    });
    setGuardandoSaldoExterno(false);
    if (error) {
      setErrorSaldoExterno(error.message);
      return;
    }
    setPacienteSaldoExterno(null);
    setValorSaldoExterno("");
    setNotaSaldoExterno("");
    setSaldoExternoOk(true);
    setTimeout(() => setSaldoExternoOk(false), 2000);
  }

  const enEspera = visitas.filter((v) => v.estado === "espera");
  const listaCobro = visitas.filter((v) => v.estado === "consulta");
  const cobradasTodas = visitas.filter((v) => v.estado === "cobrado");
  const doctorasCobradas = Array.from(
    new Map(cobradasTodas.map((v) => [v.doctora_id, v.doctoras?.nombre])).entries(),
  ).sort((a, b) => (a[1] ?? "").localeCompare(b[1] ?? ""));
  const cobradas = filtroDoctoraCobradas ? cobradasTodas.filter((v) => v.doctora_id === filtroDoctoraCobradas) : cobradasTodas;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <section className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-tinta">Llegada de paciente</h2>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">Fecha de la visita</label>
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
            />
          </div>
        </div>
        {fecha !== today() && (
          <p className="text-xs text-amber-600 mb-3">
            Estás registrando en una fecha distinta a hoy — las listas de abajo también son de ese día.
          </p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3">
          <div>
            {nuevoPaciente ? (
              <div className="flex items-center justify-between rounded-lg border border-[var(--acento)] bg-[var(--acento)]/5 px-3 py-2 text-sm">
                <span>{nuevoPaciente.nombre}</span>
                <button onClick={() => setNuevoPaciente(null)}>
                  <X size={14} />
                </button>
              </div>
            ) : (
              <PacienteAutocomplete onSelect={setNuevoPaciente} />
            )}
          </div>
          <select
            value={nuevaDoctoraId}
            onChange={(e) => {
              setNuevaDoctoraId(e.target.value);
              localStorage.setItem(`recepcion_doctora_${sedeActiva.id}`, e.target.value);
            }}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            {doctoras.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nombre}
              </option>
            ))}
          </select>
          <button
            onClick={crearVisita}
            disabled={!nuevoPaciente || creandoVisita}
            className="flex items-center justify-center gap-2 rounded-lg bg-[var(--acento)] text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
          >
            <Plus size={16} /> Registrar llegada
          </button>
        </div>
      </section>

      <ResumenOperacionDia sedeId={sedeActiva.id} fecha={fecha} />

      <section className="bg-white rounded-xl border border-dashed border-gray-300 p-4">
        {!mostrarSaldoExterno ? (
          <button
            onClick={() => setMostrarSaldoExterno(true)}
            className="flex items-center gap-2 text-sm font-medium text-[var(--acento)]"
          >
            <Plus size={16} /> Registrar saldo a favor (paciente sin cita hoy)
          </button>
        ) : (
          <>
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-semibold text-tinta">Registrar saldo a favor (paciente sin cita hoy)</h2>
              <button onClick={() => setMostrarSaldoExterno(false)}>
                <X size={16} className="text-gray-400" />
              </button>
            </div>
            <p className="text-xs text-gray-400 mb-3">
              Para cuando un paciente paga por adelantado sin venir ese día — ej. anticipo de sedación que agenda
              después. Este pago sí cuenta como ingreso del día en Cierre diario, con la fecha de arriba ({fecha}).
            </p>
            <div className="space-y-2">
              {pacienteSaldoExterno ? (
                <div className="flex items-center justify-between rounded-lg border border-[var(--acento)] bg-[var(--acento)]/5 px-3 py-2 text-sm">
                  <span>{pacienteSaldoExterno.nombre}</span>
                  <button onClick={() => setPacienteSaldoExterno(null)}>
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <PacienteAutocomplete onSelect={setPacienteSaldoExterno} placeholder="Buscar paciente…" />
              )}
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={medioSaldoExterno}
                  onChange={(e) => setMedioSaldoExterno(e.target.value as MedioPago)}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  {MEDIOS_PAGO.filter((m) => m.value !== "saldo_favor").map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  placeholder="Valor"
                  value={valorSaldoExterno}
                  onChange={(e) => setValorSaldoExterno(e.target.value)}
                  className="w-32 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <select
                  value={motivoSaldoExterno}
                  onChange={(e) => setMotivoSaldoExterno(e.target.value)}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  {MOTIVOS_SALDO_FAVOR.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <input
                value={notaSaldoExterno}
                onChange={(e) => setNotaSaldoExterno(e.target.value)}
                placeholder="Nota (ej: anticipo sedación, pendiente de agendar)"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              {errorSaldoExterno && <p className="text-sm text-red-600">{errorSaldoExterno}</p>}
              <button
                onClick={registrarSaldoSinCita}
                disabled={!pacienteSaldoExterno || !valorSaldoExterno || guardandoSaldoExterno}
                className="flex items-center gap-2 rounded-lg bg-[var(--acento)] text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
              >
                {saldoExternoOk ? <Check size={16} /> : <Plus size={16} />}
                {guardandoSaldoExterno ? "Registrando…" : saldoExternoOk ? "Registrado" : "Registrar saldo a favor"}
              </button>
            </div>
          </>
        )}
      </section>

      <PanelInterconsultas sedeId={sedeActiva.id} />

      <section>
        <h3 className="text-sm font-semibold text-gray-500 mb-2">En espera ({enEspera.length})</h3>
        <p className="text-xs text-gray-400 mb-2">
          Toca un paciente en espera para cobrarle directamente un concepto administrativo (RX, GUM, caja/llave de
          aparato) o crear un saldo a favor, sin necesidad de que pase por consultorio.
        </p>
        <div className="space-y-2">
          {enEspera.map((v) => (
            <VisitaCard key={v.id} v={v} onClick={() => setCobrandoId(v.id)} onDelete={() => eliminarVisita(v.id)} />
          ))}
          {enEspera.length === 0 && !cargando && <p className="text-sm text-gray-400">Sin pacientes en espera.</p>}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-gray-500 mb-2">Por cobrar ({listaCobro.length})</h3>
        <div className="space-y-2">
          {listaCobro.map((v) => (
            <VisitaCard key={v.id} v={v} onClick={() => setCobrandoId(v.id)} resaltar onDelete={() => eliminarVisita(v.id)} />
          ))}
          {listaCobro.length === 0 && !cargando && <p className="text-sm text-gray-400">Nadie pendiente de cobro.</p>}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-gray-500">Cobrados hoy ({cobradas.length})</h3>
          {doctorasCobradas.length > 1 && (
            <div className="flex gap-1 flex-wrap">
              <button
                onClick={() => setFiltroDoctoraCobradas("")}
                className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                  filtroDoctoraCobradas === "" ? "bg-[var(--acento)] text-white" : "bg-gray-100 text-gray-500"
                }`}
              >
                Todas
              </button>
              {doctorasCobradas.map(([id, nombre]) => (
                <button
                  key={id}
                  onClick={() => setFiltroDoctoraCobradas(id)}
                  className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                    filtroDoctoraCobradas === id ? "bg-[var(--acento)] text-white" : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {nombre}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-2">
          {cobradas.map((v) => (
            <VisitaCard key={v.id} v={v} onClick={() => setCobrandoId(v.id)} cobrado />
          ))}
        </div>
      </section>

      {cobrandoId && (
        <ModalCobro
          visitaId={cobrandoId}
          sedeId={sedeActiva.id}
          onClose={() => setCobrandoId(null)}
          onConfirmado={() => {
            setCobrandoId(null);
            cargarVisitas();
          }}
        />
      )}
    </div>
  );
}

function VisitaCard({
  v,
  onClick,
  resaltar,
  cobrado,
  onDelete,
}: {
  v: VisitaRow;
  onClick?: () => void;
  resaltar?: boolean;
  cobrado?: boolean;
  onDelete?: () => void;
}) {
  return (
    <div
      className={`w-full flex items-center gap-2 rounded-lg border px-4 py-2.5 ${
        resaltar ? "border-[var(--acento)] bg-[var(--acento)]/5" : "border-gray-200 bg-white"
      } ${cobrado ? "opacity-70" : ""}`}
    >
      <button
        onClick={onClick}
        disabled={!onClick}
        className={`flex-1 flex items-center justify-between text-left ${onClick ? "hover:opacity-80" : ""}`}
      >
        <span className="font-medium text-tinta">{v.pacientes?.nombre}</span>
        <span
          className="text-xs font-medium px-2 py-0.5 rounded-full"
          style={{ background: v.doctoras?.color_pastel + "40" }}
        >
          {v.doctoras?.nombre}
        </span>
      </button>
      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Eliminar visita"
          className="text-gray-300 hover:text-red-500 shrink-0"
        >
          <Trash2 size={16} />
        </button>
      )}
    </div>
  );
}

interface ResumenLabRow {
  id: string;
  paciente: string;
  doctora: string;
  laboratorio: string;
  tipo_servicio: string;
}

/** Informativo: qué se envió y qué se instaló hoy, para verificación rápida de operación. */
function ResumenOperacionDia({ sedeId, fecha }: { sedeId: string; fecha: string }) {
  const [enviados, setEnviados] = useState<ResumenLabRow[]>([]);
  const [instalados, setInstalados] = useState<ResumenLabRow[]>([]);

  useEffect(() => {
    (async () => {
      const select = "id, tipo_servicio, pacientes(nombre), doctoras!lab_ordenes_doctora_id_fkey(nombre), laboratorios(nombre)";
      type Fila = {
        id: string; tipo_servicio: string;
        pacientes: { nombre: string } | null; doctoras: { nombre: string } | null; laboratorios: { nombre: string } | null;
      };
      const mapear = (rows: Fila[]): ResumenLabRow[] =>
        rows.map((r) => ({
          id: r.id,
          paciente: r.pacientes?.nombre ?? "—",
          doctora: r.doctoras?.nombre ?? "—",
          laboratorio: r.laboratorios?.nombre ?? "—",
          tipo_servicio: r.tipo_servicio,
        }));
      // Solo lo que viene de una visita real ese día (enviado/instalado desde
      // Consultorio) — lo que se agrega manualmente desde Laboratorio no tiene
      // visita_id y no refleja quién atendió ese día en esta sede.
      const { data: env } = await supabase
        .from("lab_ordenes")
        .select(select)
        .eq("sede_id", sedeId)
        .eq("fecha_envio", fecha)
        .not("visita_id", "is", null);
      setEnviados(mapear((env as unknown as Fila[]) ?? []));
      const { data: inst } = await supabase
        .from("lab_ordenes")
        .select(select)
        .eq("sede_id", sedeId)
        .eq("fecha_instalado", fecha)
        .not("visita_id", "is", null);
      setInstalados(mapear((inst as unknown as Fila[]) ?? []));
    })();
  }, [sedeId, fecha]);

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-500 mb-3">Resumen del día — laboratorio</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-xs font-medium text-gray-400 mb-1">Enviados hoy ({enviados.length})</p>
          <div className="space-y-1">
            {enviados.map((r) => (
              <div key={r.id} className="rounded-md bg-gray-50 px-2 py-1.5">
                {r.paciente} <span className="text-gray-400">· {r.doctora} · {r.laboratorio}</span>
              </div>
            ))}
            {enviados.length === 0 && <p className="text-xs text-gray-400">Ninguno.</p>}
          </div>
        </div>
        <div>
          <p className="text-xs font-medium text-gray-400 mb-1">Instalados hoy ({instalados.length})</p>
          <div className="space-y-1">
            {instalados.map((r) => (
              <div key={r.id} className="rounded-md bg-gray-50 px-2 py-1.5">
                {r.paciente} <span className="text-gray-400">· {r.doctora}</span>
              </div>
            ))}
            {instalados.length === 0 && <p className="text-xs text-gray-400">Ninguno.</p>}
          </div>
        </div>
      </div>
    </section>
  );
}

interface InterconsultaFila {
  id: string;
  fecha: string;
  paciente: string;
  doctora: string;
  especialidad: string;
  respuesta: string;
  evolucion_doctora: boolean;
  fin_interconsulta: boolean;
}

/** Reporte histórico de interconsultas — se administra desde Recepción hasta que se cierran. */
function PanelInterconsultas({ sedeId }: { sedeId: string }) {
  const [abierto, setAbierto] = useState(false);
  const [filas, setFilas] = useState<InterconsultaFila[]>([]);
  const [soloPendientes, setSoloPendientes] = useState(true);
  const [guardandoId, setGuardandoId] = useState<string | null>(null);

  useEffect(() => {
    if (!abierto) return;
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, sedeId, soloPendientes]);

  async function cargar() {
    let q = supabase
      .from("interconsultas")
      .select("id, fecha, especialidad, respuesta, evolucion_doctora, fin_interconsulta, pacientes(nombre), doctoras(nombre)")
      .eq("sede_id", sedeId)
      .order("fecha", { ascending: false });
    if (soloPendientes) q = q.eq("fin_interconsulta", false);
    const { data } = await q;
    setFilas(
      ((data as unknown as {
        id: string; fecha: string; especialidad: string; respuesta: string | null;
        evolucion_doctora: boolean; fin_interconsulta: boolean;
        pacientes: { nombre: string } | null; doctoras: { nombre: string } | null;
      }[]) ?? []).map((r) => ({
        id: r.id,
        fecha: r.fecha,
        paciente: r.pacientes?.nombre ?? "—",
        doctora: r.doctoras?.nombre ?? "—",
        especialidad: r.especialidad,
        respuesta: r.respuesta ?? "",
        evolucion_doctora: r.evolucion_doctora,
        fin_interconsulta: r.fin_interconsulta,
      })),
    );
  }

  function actualizarFila(id: string, cambios: Partial<InterconsultaFila>) {
    setFilas((prev) => prev.map((f) => (f.id === id ? { ...f, ...cambios } : f)));
  }

  async function guardarFila(id: string) {
    const f = filas.find((x) => x.id === id);
    if (!f) return;
    setGuardandoId(id);
    await supabase
      .from("interconsultas")
      .update({
        respuesta: f.respuesta.trim() || null,
        evolucion_doctora: f.evolucion_doctora,
        fin_interconsulta: f.fin_interconsulta,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    setGuardandoId(null);
    if (soloPendientes && f.fin_interconsulta) {
      setFilas((prev) => prev.filter((x) => x.id !== id));
    }
  }

  return (
    <section className="bg-white rounded-xl border border-dashed border-gray-300 p-4">
      <button onClick={() => setAbierto((v) => !v)} className="flex items-center gap-2 text-sm font-medium text-[var(--acento)]">
        {abierto ? "Ocultar interconsultas" : "Ver interconsultas"}
      </button>
      {abierto && (
        <div className="mt-3 space-y-3">
          <label className="flex items-center gap-2 text-xs text-gray-500">
            <input type="checkbox" checked={soloPendientes} onChange={(e) => setSoloPendientes(e.target.checked)} />
            Solo pendientes (sin cerrar)
          </label>
          <div className="space-y-2">
            {filas.map((f) => (
              <div key={f.id} className="rounded-lg border border-gray-200 p-3 space-y-2">
                <div className="flex items-center justify-between text-sm flex-wrap gap-1">
                  <span className="font-medium">{f.paciente}</span>
                  <span className="text-xs text-gray-400">
                    {f.fecha} · {f.doctora} · remitido a {f.especialidad}
                  </span>
                </div>
                <textarea
                  value={f.respuesta}
                  onChange={(e) => actualizarFila(f.id, { respuesta: e.target.value })}
                  placeholder="Respuesta de la interconsulta…"
                  rows={2}
                  className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                />
                <div className="flex items-center gap-4 flex-wrap">
                  <label className="flex items-center gap-1.5 text-xs text-gray-500">
                    <input
                      type="checkbox"
                      checked={f.evolucion_doctora}
                      onChange={(e) => actualizarFila(f.id, { evolucion_doctora: e.target.checked })}
                    />
                    Evolución doctora en el sistema
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-gray-500">
                    <input
                      type="checkbox"
                      checked={f.fin_interconsulta}
                      onChange={(e) => actualizarFila(f.id, { fin_interconsulta: e.target.checked })}
                    />
                    Fin interconsulta
                  </label>
                  <button
                    onClick={() => guardarFila(f.id)}
                    disabled={guardandoId === f.id}
                    className="ml-auto rounded-md bg-[var(--acento)] text-white px-3 py-1 text-xs font-medium disabled:opacity-40"
                  >
                    {guardandoId === f.id ? "Guardando…" : "Guardar"}
                  </button>
                </div>
              </div>
            ))}
            {filas.length === 0 && <p className="text-sm text-gray-400">Sin interconsultas{soloPendientes ? " pendientes" : ""}.</p>}
          </div>
        </div>
      )}
    </section>
  );
}

function ModalCobro({
  visitaId,
  sedeId,
  onClose,
  onConfirmado,
}: {
  visitaId: string;
  sedeId: string;
  onClose: () => void;
  onConfirmado: () => void;
}) {
  const [pacienteId, setPacienteId] = useState<string | null>(null);
  const [pacienteNombre, setPacienteNombre] = useState("");
  const [estadoVisita, setEstadoVisita] = useState<"espera" | "consulta" | "cobrado">("consulta");
  const [visitaFecha, setVisitaFecha] = useState(today());
  const [tratamiento, setTratamiento] = useState("");
  const [proximaCita, setProximaCita] = useState("");
  const [insumos, setInsumos] = useState<Record<string, boolean>>({});
  const [insumosOriginales, setInsumosOriginales] = useState<string[]>([]);
  const [cargos, setCargos] = useState<CargoEdit[]>([]);
  const [cargosOriginalesIds, setCargosOriginalesIds] = useState<string[]>([]);
  const [saldoDisponible, setSaldoDisponible] = useState(0);
  const [excedentes, setExcedentes] = useState<ExcedenteLinea[]>([]);
  const [excedenteMedio, setExcedenteMedio] = useState<MedioPago>("efectivo");
  const [excedenteMotivo, setExcedenteMotivo] = useState(MOTIVOS_SALDO_FAVOR[0]);
  const [excedenteValor, setExcedenteValor] = useState("");
  const [conceptoTipo, setConceptoTipo] = useState(CONCEPTOS_ADMINISTRATIVOS[0]);
  const [conceptoValor, setConceptoValor] = useState("");
  const [precios, setPrecios] = useState<Record<string, number>>({});
  const [motivoCero, setMotivoCero] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [cargandoModal, setCargandoModal] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: visita } = await supabase
        .from("visitas")
        .select("id, estado, fecha, paciente_id, motivo_valor_cero, tratamiento, proxima_cita, pacientes(nombre)")
        .eq("id", visitaId)
        .single();
      if (!visita) return;
      const v = visita as unknown as {
        id: string;
        estado: "espera" | "consulta" | "cobrado";
        fecha: string;
        paciente_id: string;
        motivo_valor_cero: string | null;
        tratamiento: string | null;
        proxima_cita: string | null;
        pacientes: { nombre: string };
      };
      setPacienteId(v.paciente_id);
      setPacienteNombre(v.pacientes?.nombre ?? "");
      setEstadoVisita(v.estado);
      setVisitaFecha(v.fecha);
      setTratamiento(v.tratamiento ?? "");
      setProximaCita(v.proxima_cita ?? "");
      setMotivoCero(v.motivo_valor_cero ?? "");

      const { data: cargosData } = await supabase
        .from("cargos")
        .select("id, categoria, concepto, valor, cargo_pagos(medio_pago, valor)")
        .eq("visita_id", visitaId);

      const rows = (cargosData as unknown as (CargoRow & { cargo_pagos: { medio_pago: MedioPago; valor: number }[] })[]) ?? [];
      setCargos(
        rows.map((c) => ({
          id: c.id,
          categoria: c.categoria,
          concepto: c.concepto,
          valor: c.valor,
          pagos:
            c.cargo_pagos.length > 0
              ? c.cargo_pagos.map((p) => ({ medio: p.medio_pago, valor: p.valor }))
              : [{ medio: "efectivo" as MedioPago, valor: c.valor }],
        })),
      );
      setCargosOriginalesIds(rows.map((c) => c.id));

      const { data: insumosData } = await supabase.from("insumos_consulta").select("tipo").eq("visita_id", visitaId);
      const tiposExistentes = (insumosData ?? []).map((i) => i.tipo);
      setInsumosOriginales(tiposExistentes);
      setInsumos(Object.fromEntries(tiposExistentes.map((t) => [t, true])));

      const { data: saldos } = await supabase
        .from("saldos_favor")
        .select("valor_disponible")
        .eq("paciente_id", v.paciente_id)
        .gt("valor_disponible", 0);
      setSaldoDisponible((saldos ?? []).reduce((a, s) => a + Number(s.valor_disponible), 0));

      const { data: preciosData } = await supabase.from("precios_config").select("clave, valor");
      const preciosMap: Record<string, number> = {};
      (preciosData ?? []).forEach((p) => (preciosMap[p.clave] = Number(p.valor)));
      setPrecios(preciosMap);
      setCargandoModal(false);
    })();
  }, [visitaId]);

  const totalCargos = useMemo(() => cargos.reduce((a, c) => a + c.valor, 0), [cargos]);
  const totalPagos = useMemo(
    () => cargos.reduce((a, c) => a + c.pagos.reduce((x, p) => x + (Number(p.valor) || 0), 0), 0),
    [cargos],
  );
  const saldoUsadoEnPagos = useMemo(
    () =>
      cargos.reduce(
        (a, c) => a + c.pagos.filter((p) => p.medio === "saldo_favor").reduce((x, p) => x + (Number(p.valor) || 0), 0),
        0,
      ),
    [cargos],
  );

  function actualizarPago(idx: number, pIdx: number, campo: "medio" | "valor", valor: string) {
    setCargos((prev) =>
      prev.map((c, i) =>
        i !== idx
          ? c
          : {
              ...c,
              pagos: c.pagos.map((p, j) => (j !== pIdx ? p : { ...p, [campo]: campo === "valor" ? Number(valor) || 0 : valor })),
            },
      ),
    );
  }

  function actualizarConcepto(idx: number, concepto: string) {
    setCargos((prev) => prev.map((c, i) => (i !== idx ? c : { ...c, concepto })));
  }

  function actualizarValorCargo(idx: number, valor: string) {
    setCargos((prev) => prev.map((c, i) => (i !== idx ? c : { ...c, valor: Number(valor) || 0 })));
  }

  function dividirPago(idx: number) {
    setCargos((prev) =>
      prev.map((c, i) => (i !== idx ? c : { ...c, pagos: [...c.pagos, { medio: "efectivo" as MedioPago, valor: 0 }] })),
    );
  }

  function quitarPago(idx: number, pIdx: number) {
    setCargos((prev) => prev.map((c, i) => (i !== idx ? c : { ...c, pagos: c.pagos.filter((_, j) => j !== pIdx) })));
  }

  function agregarConcepto() {
    const valor = Number(conceptoValor);
    if (!valor) return;
    setCargos((prev) => [
      ...prev,
      { categoria: "concepto_administrativo", concepto: conceptoTipo, valor, pagos: [{ medio: "efectivo", valor }] },
    ]);
    setConceptoValor("");
  }

  function agregarRx() {
    const valor = precios["rx"] ?? 0;
    setCargos((prev) => [...prev, { categoria: "rx", concepto: "RX", valor, pagos: [{ medio: "efectivo", valor }] }]);
  }

  function quitarCargo(idx: number) {
    setCargos((prev) => prev.filter((_, i) => i !== idx));
  }

  function agregarExcedente() {
    const valor = Number(excedenteValor);
    if (!valor) return;
    setExcedentes((prev) => [...prev, { medio: excedenteMedio, valor, motivo: excedenteMotivo }]);
    setExcedenteValor("");
  }

  function quitarExcedente(idx: number) {
    setExcedentes((prev) => prev.filter((_, i) => i !== idx));
  }

  const idxProcedimiento = cargos.findIndex((c) => c.categoria === "procedimiento");

  async function confirmar() {
    setErrorMsg(null);
    if (cargos.length === 0 && !motivoCero.trim()) {
      setErrorMsg("Este paciente no tiene ningún cargo. Escribe el motivo para cobrar $0.");
      return;
    }
    for (const c of cargos) {
      const suma = c.pagos.reduce((a, p) => a + (Number(p.valor) || 0), 0);
      if (Math.round(suma) !== Math.round(c.valor)) {
        setErrorMsg(`"${c.concepto}" vale ${fmtCOP(c.valor)} pero los pagos asignados suman ${fmtCOP(suma)}.`);
        return;
      }
    }
    if (saldoUsadoEnPagos > saldoDisponible) {
      setErrorMsg(`El paciente solo tiene ${fmtCOP(saldoDisponible)} de saldo a favor disponible.`);
      return;
    }
    setGuardando(true);
    try {
      const idsActuales = cargos.filter((c) => c.id).map((c) => c.id);
      const idsAEliminar = cargosOriginalesIds.filter((id) => !idsActuales.includes(id));
      for (const id of idsAEliminar) {
        const { error } = await supabase.from("cargos").delete().eq("id", id);
        if (error) throw error;
      }

      const tiposActuales = Object.keys(insumos).filter((k) => insumos[k]);
      const tiposAAgregar = tiposActuales.filter((t) => !insumosOriginales.includes(t));
      const tiposAQuitar = insumosOriginales.filter((t) => !tiposActuales.includes(t));
      for (const tipo of tiposAAgregar) {
        const { error } = await supabase
          .from("insumos_consulta")
          .insert({ visita_id: visitaId, tipo, valor_costo: precios[tipo] ?? 0 });
        if (error) throw error;
      }
      for (const tipo of tiposAQuitar) {
        const { error } = await supabase.from("insumos_consulta").delete().eq("visita_id", visitaId).eq("tipo", tipo);
        if (error) throw error;
      }

      for (const c of cargos) {
        let cargoId = c.id;
        if (!cargoId) {
          const { data, error } = await supabase
            .from("cargos")
            .insert({ visita_id: visitaId, categoria: c.categoria, concepto: c.concepto, valor: c.valor, registrado_en: "recepcion" })
            .select("id")
            .single();
          if (error) throw error;
          cargoId = data.id;
        } else {
          // Permite corregir concepto/valor de un cargo ya existente (error de digitación).
          const { error } = await supabase.from("cargos").update({ concepto: c.concepto, valor: c.valor }).eq("id", cargoId);
          if (error) throw error;
        }
        // Reemplaza los pagos existentes de este cargo por el estado actual del formulario.
        await supabase.from("cargo_pagos").delete().eq("cargo_id", cargoId);
        for (const p of c.pagos) {
          if (!p.valor) continue;
          if (p.medio === "saldo_favor") {
            const { data: saldos } = await supabase
              .from("saldos_favor")
              .select("id, valor_disponible")
              .eq("paciente_id", pacienteId)
              .gt("valor_disponible", 0)
              .order("fecha", { ascending: true });
            let restante = p.valor;
            for (const s of saldos ?? []) {
              if (restante <= 0) break;
              const tomar = Math.min(restante, Number(s.valor_disponible));
              const { error } = await supabase
                .from("cargo_pagos")
                .insert({ cargo_id: cargoId, medio_pago: "saldo_favor", valor: tomar, saldo_id: s.id });
              if (error) throw error;
              restante -= tomar;
            }
            continue;
          }
          const { error } = await supabase.from("cargo_pagos").insert({ cargo_id: cargoId, medio_pago: p.medio, valor: p.valor });
          if (error) throw error;
        }
      }

      for (const e of excedentes) {
        if (!e.valor) continue;
        const { error } = await supabase.from("saldos_favor").insert({
          paciente_id: pacienteId,
          sede_origen_id: sedeId,
          valor: e.valor,
          valor_disponible: e.valor,
          medio_origen: e.medio,
          motivo: e.motivo,
          fecha: visitaFecha,
        });
        if (error) throw error;
      }

      await supabase
        .from("visitas")
        .update({
          estado: "cobrado",
          motivo_valor_cero: cargos.length === 0 ? motivoCero.trim() : null,
          proxima_cita: proximaCita || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", visitaId);
      onConfirmado();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Error al guardar el cobro.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-20">
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-tinta">
            Cobro — {pacienteNombre} {estadoVisita === "cobrado" && <span className="text-xs text-gray-400">(corrigiendo cobro)</span>}
          </h3>
          <button onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {cargandoModal ? (
          <p className="text-sm text-gray-400">Cargando…</p>
        ) : (
          <>
            {saldoDisponible > 0 && (
              <p className="text-sm text-[var(--acento)] bg-[var(--acento)]/10 rounded-lg px-3 py-2 mb-3">
                Saldo a favor disponible: {fmtCOP(saldoDisponible)}
              </p>
            )}

            <div className="rounded-lg border-2 border-amber-300 bg-amber-50/60 px-3 py-3 mb-3 space-y-3">
              <p className="text-xs font-semibold text-amber-700">Registrado en consultorio (editable aquí)</p>
              {tratamiento && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-gray-500 shrink-0">Tratamiento:</span>
                  <span className="flex-1 min-w-0 truncate">{tratamiento}</span>
                  {idxProcedimiento !== -1 && (
                    <input
                      type="number"
                      value={cargos[idxProcedimiento].valor || ""}
                      onChange={(e) => actualizarValorCargo(idxProcedimiento, e.target.value)}
                      className="w-28 shrink-0 rounded-md border border-gray-300 px-2 py-1 text-sm"
                    />
                  )}
                </div>
              )}

              <div>
                <p className="text-xs text-gray-500 mb-1.5">Insumos de aparatología entregados</p>
                <div className="flex flex-col gap-1">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={cargos.some((c) => c.categoria === "rx")}
                      onChange={(e) => {
                        if (e.target.checked) {
                          agregarRx();
                        } else {
                          const idx = cargos.findIndex((c) => c.categoria === "rx");
                          if (idx !== -1) quitarCargo(idx);
                        }
                      }}
                    />
                    RX tomada {precios["rx"] ? `(${fmtCOP(precios["rx"])})` : ""}
                  </label>
                  {TIPOS_INSUMO_CONSULTA.map((t) => (
                    <label key={t.value} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={!!insumos[t.value]}
                        onChange={(e) => setInsumos((prev) => ({ ...prev, [t.value]: e.target.checked }))}
                      />
                      {t.label} {precios[t.value] ? `(${fmtCOP(precios[t.value])})` : ""}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Próxima cita</label>
                <input
                  value={proximaCita}
                  onChange={(e) => setProximaCita(e.target.value)}
                  placeholder="Nota de consultorio, o la fecha ya agendada"
                  className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>
            </div>

            {cargos.length === 0 && (
              <div className="rounded-lg border border-dashed border-gray-300 p-3 mb-4">
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Este paciente no tiene ningún cargo — motivo para cobrar $0
                </label>
                <input
                  value={motivoCero}
                  onChange={(e) => setMotivoCero(e.target.value)}
                  placeholder="Ej: revisión de cortesía, ajuste sin costo"
                  className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>
            )}

            <div className="space-y-3 mb-4">
              {cargos.map((c, idx) => (
                <div key={c.id ?? `nuevo-${idx}`} className="rounded-lg border border-gray-200 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      value={c.concepto}
                      onChange={(e) => actualizarConcepto(idx, e.target.value)}
                      className="flex-1 min-w-0 rounded-md border border-gray-200 px-2 py-1 text-sm font-medium"
                    />
                    {c.categoria !== "procedimiento" && (
                      <input
                        type="number"
                        value={c.valor || ""}
                        onChange={(e) => actualizarValorCargo(idx, e.target.value)}
                        className="w-28 rounded-md border border-gray-200 px-2 py-1 text-sm"
                      />
                    )}
                    <button onClick={() => dividirPago(idx)} title="Dividir en varios medios de pago">
                      <Split size={14} className="text-gray-400" />
                    </button>
                    {c.categoria !== "procedimiento" && (
                      <button onClick={() => quitarCargo(idx)}>
                        <X size={14} className="text-gray-400" />
                      </button>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {c.pagos.map((p, pIdx) => (
                      <div key={pIdx} className="flex gap-2">
                        <select
                          value={p.medio}
                          onChange={(e) => actualizarPago(idx, pIdx, "medio", e.target.value)}
                          className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm"
                        >
                          {MEDIOS_PAGO.filter((m) => m.value !== "saldo_favor" || saldoDisponible > 0).map((m) => (
                            <option key={m.value} value={m.value}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          value={p.valor || ""}
                          onChange={(e) => actualizarPago(idx, pIdx, "valor", e.target.value)}
                          className="w-32 rounded-md border border-gray-300 px-2 py-1 text-sm"
                        />
                        {c.pagos.length > 1 && (
                          <button onClick={() => quitarPago(idx, pIdx)}>
                            <X size={14} className="text-gray-400" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-lg border border-dashed border-gray-300 p-3 mb-4">
              <p className="text-xs font-medium text-gray-500 mb-2">Agregar concepto administrativo</p>
              <div className="flex gap-2">
                <select
                  value={conceptoTipo}
                  onChange={(e) => {
                    setConceptoTipo(e.target.value);
                    const clave = CONCEPTO_PRECIO_CLAVE[e.target.value];
                    setConceptoValor(clave && precios[clave] ? String(precios[clave]) : "");
                  }}
                  className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm"
                >
                  {CONCEPTOS_ADMINISTRATIVOS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  placeholder="Valor"
                  value={conceptoValor}
                  onChange={(e) => setConceptoValor(e.target.value)}
                  className="w-32 rounded-md border border-gray-300 px-2 py-1 text-sm"
                />
                <button onClick={agregarConcepto} className="rounded-md bg-gray-100 px-3 text-sm font-medium">
                  <Plus size={14} />
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-dashed border-gray-300 p-3 mb-4">
              <p className="text-xs font-medium text-gray-500 mb-2">Crear saldo a favor</p>
              {excedentes.length > 0 && (
                <div className="space-y-1 mb-2">
                  {excedentes.map((e, idx) => (
                    <div key={idx} className="flex items-center justify-between rounded-md bg-gray-50 px-2 py-1 text-sm">
                      <span>
                        {MEDIOS_PAGO.find((m) => m.value === e.medio)?.label} · {fmtCOP(e.valor)} · {e.motivo}
                      </span>
                      <button onClick={() => quitarExcedente(idx)}>
                        <X size={14} className="text-gray-400" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2 flex-wrap">
                <select
                  value={excedenteMedio}
                  onChange={(e) => setExcedenteMedio(e.target.value as MedioPago)}
                  className="flex-1 min-w-[120px] rounded-md border border-gray-300 px-2 py-1 text-sm"
                >
                  {MEDIOS_PAGO.filter((m) => m.value !== "saldo_favor").map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  placeholder="Valor"
                  value={excedenteValor}
                  onChange={(e) => setExcedenteValor(e.target.value)}
                  className="w-32 rounded-md border border-gray-300 px-2 py-1 text-sm"
                />
                <button onClick={agregarExcedente} className="rounded-md bg-gray-100 px-3 text-sm font-medium">
                  <Plus size={14} />
                </button>
              </div>
              <div className="mt-2">
                <label className="block text-xs text-gray-500 mb-1">¿Para qué es?</label>
                <select
                  value={excedenteMotivo}
                  onChange={(e) => setExcedenteMotivo(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
                >
                  {MOTIVOS_SALDO_FAVOR.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between text-sm mb-3">
              <span className="text-gray-500">Total a cobrar</span>
              <span className="font-semibold">{fmtCOP(totalCargos)}</span>
            </div>
            <div className="flex items-center justify-between text-sm mb-4">
              <span className="text-gray-500">Total asignado en pagos</span>
              <span className={`font-semibold ${totalPagos !== totalCargos ? "text-amber-600" : ""}`}>{fmtCOP(totalPagos)}</span>
            </div>

            {errorMsg && <p className="text-sm text-red-600 mb-3">{errorMsg}</p>}

            <button
              onClick={confirmar}
              disabled={guardando || (cargos.length === 0 && !motivoCero.trim())}
              className="w-full rounded-lg bg-[var(--acento)] text-white py-2.5 text-sm font-medium disabled:opacity-40"
            >
              {guardando ? "Guardando…" : "Confirmar cobro"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
