import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Plus, X, Split, Trash2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { fmtCOP, today } from "../../lib/format";
import {
  MEDIOS_PAGO,
  CONCEPTOS_ADMINISTRATIVOS,
  type Sede,
  type Doctora,
  type Paciente,
  type MedioPago,
  type CategoriaCargo,
} from "../../lib/types";
import { PacienteAutocomplete } from "../../components/PacienteAutocomplete";

const CONCEPTO_PRECIO_CLAVE: Record<string, string> = { GUM: "gum" };

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
      if (data && data.length > 0) setNuevaDoctoraId(data[0].id);
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

  const enEspera = visitas.filter((v) => v.estado === "espera");
  const listaCobro = visitas.filter((v) => v.estado === "consulta");
  const cobradas = visitas.filter((v) => v.estado === "cobrado");

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
            onChange={(e) => setNuevaDoctoraId(e.target.value)}
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

      <section>
        <h3 className="text-sm font-semibold text-gray-500 mb-2">En espera ({enEspera.length})</h3>
        <div className="space-y-2">
          {enEspera.map((v) => (
            <VisitaCard key={v.id} v={v} onDelete={() => eliminarVisita(v.id)} />
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
        <h3 className="text-sm font-semibold text-gray-500 mb-2">Cobrados hoy ({cobradas.length})</h3>
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
  const [cargos, setCargos] = useState<CargoEdit[]>([]);
  const [saldoDisponible, setSaldoDisponible] = useState(0);
  const [excedentes, setExcedentes] = useState<PagoLinea[]>([]);
  const [excedenteMedio, setExcedenteMedio] = useState<MedioPago>("efectivo");
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

  function quitarCargo(idx: number) {
    setCargos((prev) => prev.filter((_, i) => i !== idx));
  }

  function agregarExcedente() {
    const valor = Number(excedenteValor);
    if (!valor) return;
    setExcedentes((prev) => [...prev, { medio: excedenteMedio, valor }]);
    setExcedenteValor("");
  }

  function quitarExcedente(idx: number) {
    setExcedentes((prev) => prev.filter((_, i) => i !== idx));
  }

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
        await supabase.from("saldos_favor").insert({
          paciente_id: pacienteId,
          sede_origen_id: sedeId,
          valor: e.valor,
          valor_disponible: e.valor,
          medio_origen: e.medio,
          fecha: visitaFecha,
        });
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

            {tratamiento && (
              <p className="text-sm bg-gray-50 rounded-lg px-3 py-2 mb-3">
                <span className="text-gray-500">Tratamiento (consultorio):</span> {tratamiento}
              </p>
            )}

            <div className="mb-3">
              <label className="block text-xs font-medium text-gray-500 mb-1">Próxima cita</label>
              <input
                value={proximaCita}
                onChange={(e) => setProximaCita(e.target.value)}
                placeholder="Nota de consultorio, o la fecha ya agendada"
                className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              />
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
                    <input
                      type="number"
                      value={c.valor || ""}
                      onChange={(e) => actualizarValorCargo(idx, e.target.value)}
                      className="w-28 rounded-md border border-gray-200 px-2 py-1 text-sm"
                    />
                    <button onClick={() => dividirPago(idx)} title="Dividir en varios medios de pago">
                      <Split size={14} className="text-gray-400" />
                    </button>
                    {c.categoria === "concepto_administrativo" && (
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
              <p className="text-xs font-medium text-gray-500 mb-2">Excedente / anticipo (crea saldo a favor)</p>
              {excedentes.length > 0 && (
                <div className="space-y-1 mb-2">
                  {excedentes.map((e, idx) => (
                    <div key={idx} className="flex items-center justify-between rounded-md bg-gray-50 px-2 py-1 text-sm">
                      <span>
                        {MEDIOS_PAGO.find((m) => m.value === e.medio)?.label} · {fmtCOP(e.valor)}
                      </span>
                      <button onClick={() => quitarExcedente(idx)}>
                        <X size={14} className="text-gray-400" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <select
                  value={excedenteMedio}
                  onChange={(e) => setExcedenteMedio(e.target.value as MedioPago)}
                  className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm"
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
