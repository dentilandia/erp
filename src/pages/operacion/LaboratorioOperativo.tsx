import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Plus, X, Pencil, Check } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { fmtCOP, today } from "../../lib/format";
import { TIPOS_SERVICIO_LAB, type Sede, type Doctora, type Laboratorio, type Paciente, type EstadoLab } from "../../lib/types";
import { PacienteAutocomplete } from "../../components/PacienteAutocomplete";

interface EnvioLab {
  laboratorioId: string;
  laboratorioNombre: string;
  tipoServicio: string;
}

interface LabRow {
  id: string;
  estado: EstadoLab;
  fecha_envio: string;
  factura_numero: string | null;
  consecutivo: string | null;
  valor_factura: number | null;
  fecha_emision_factura: string | null;
  fecha_recibido: string | null;
  mes_liquidacion: string | null;
  doctora_id: string;
  laboratorio_id: string;
  paciente_id: string;
  tipo_servicio: string;
  pacientes: { nombre: string };
  doctoras: { nombre: string };
  laboratorios: { nombre: string };
}

const ESTADOS: { value: EstadoLab; label: string }[] = [
  { value: "enviado", label: "Por recibir" },
  { value: "recibido", label: "Por instalar" },
  { value: "instalado", label: "Instalados" },
];

export function LaboratorioOperativo() {
  const { sedeActiva } = useOutletContext<{ sedeActiva: Sede }>();
  const [ordenes, setOrdenes] = useState<LabRow[]>([]);
  const [doctoras, setDoctoras] = useState<Doctora[]>([]);
  const [laboratorios, setLaboratorios] = useState<Laboratorio[]>([]);
  const [filtroDoctora, setFiltroDoctora] = useState("");
  const [abierto, setAbierto] = useState<EstadoLab>("enviado");
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editDoctoraId, setEditDoctoraId] = useState("");
  const [editLaboratorioId, setEditLaboratorioId] = useState("");
  const [editTipoServicio, setEditTipoServicio] = useState("");
  const [guardandoEdit, setGuardandoEdit] = useState(false);

  const [mostrarForm, setMostrarForm] = useState(false);
  const [nuevoPaciente, setNuevoPaciente] = useState<Paciente | null>(null);
  const [nuevaDoctoraId, setNuevaDoctoraId] = useState("");
  const [nuevoLaboratorioId, setNuevoLaboratorioId] = useState("");
  const [nuevoTipoServicio, setNuevoTipoServicio] = useState(TIPOS_SERVICIO_LAB[0].value);
  const [nuevaFecha, setNuevaFecha] = useState(today());
  const [enviosLab, setEnviosLab] = useState<EnvioLab[]>([]);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    supabase.from("doctoras").select("*").order("nombre").then(({ data }) => {
      setDoctoras((data as Doctora[]) ?? []);
      if (data && data.length > 0) setNuevaDoctoraId((prev) => prev || data[0].id);
    });
    supabase.from("laboratorios").select("*").eq("activo", true).then(({ data }) => {
      setLaboratorios((data as Laboratorio[]) ?? []);
      if (data && data.length > 0) setNuevoLaboratorioId((prev) => prev || data[0].id);
    });
  }, []);

  useEffect(() => {
    cargarOrdenes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sedeActiva.id, filtroDoctora]);

  async function cargarOrdenes() {
    let q = supabase
      .from("lab_ordenes")
      .select(
        "id, estado, fecha_envio, factura_numero, consecutivo, valor_factura, fecha_emision_factura, fecha_recibido, mes_liquidacion, doctora_id, laboratorio_id, paciente_id, tipo_servicio, pacientes(nombre), doctoras(nombre), laboratorios(nombre)",
      )
      .eq("sede_id", sedeActiva.id)
      .order("fecha_envio", { ascending: false });
    if (filtroDoctora) q = q.eq("doctora_id", filtroDoctora);
    const { data } = await q;
    setOrdenes((data as unknown as LabRow[]) ?? []);
  }

  function agregarEnvioLab() {
    const lab = laboratorios.find((l) => l.id === nuevoLaboratorioId);
    if (!lab) return;
    setEnviosLab((prev) => [...prev, { laboratorioId: nuevoLaboratorioId, laboratorioNombre: lab.nombre, tipoServicio: nuevoTipoServicio }]);
  }

  function quitarEnvioLab(idx: number) {
    setEnviosLab((prev) => prev.filter((_, i) => i !== idx));
  }

  async function enviarAparato() {
    if (!nuevoPaciente || !nuevaDoctoraId || enviosLab.length === 0) return;
    setEnviando(true);
    for (const envio of enviosLab) {
      await supabase.from("lab_ordenes").insert({
        sede_id: sedeActiva.id,
        doctora_id: nuevaDoctoraId,
        paciente_id: nuevoPaciente.id,
        laboratorio_id: envio.laboratorioId,
        tipo_servicio: envio.tipoServicio,
        estado: "enviado",
        fecha_envio: nuevaFecha,
      });
    }
    setEnviando(false);
    setMostrarForm(false);
    setNuevoPaciente(null);
    setEnviosLab([]);
    setNuevaFecha(today());
    cargarOrdenes();
  }

  function empezarEdicion(o: LabRow) {
    setEditandoId(o.id);
    setEditDoctoraId(o.doctora_id);
    setEditLaboratorioId(o.laboratorio_id);
    setEditTipoServicio(o.tipo_servicio);
  }

  async function guardarEdicion(id: string) {
    setGuardandoEdit(true);
    await supabase
      .from("lab_ordenes")
      .update({ doctora_id: editDoctoraId, laboratorio_id: editLaboratorioId, tipo_servicio: editTipoServicio })
      .eq("id", id);
    setGuardandoEdit(false);
    setEditandoId(null);
    cargarOrdenes();
  }

  async function marcarRecibido(o: LabRow) {
    const facturaNumero = window.prompt(
      "Consecutivo de la factura (el mismo si vienen varios aparatos en una sola factura):",
    );
    if (facturaNumero === null) return;
    if (facturaNumero.trim()) {
      const { data: existentes } = await supabase
        .from("lab_ordenes")
        .select("paciente_id, pacientes(nombre)")
        .eq("laboratorio_id", o.laboratorio_id)
        .eq("factura_numero", facturaNumero.trim())
        .neq("id", o.id);
      const conflicto = ((existentes as unknown as { paciente_id: string; pacientes: { nombre: string } | null }[]) ?? []).find(
        (e) => e.paciente_id !== o.paciente_id,
      );
      if (conflicto) {
        const seguir = window.confirm(
          `Ese consecutivo ya está asociado a ${conflicto.pacientes?.nombre ?? "otro paciente"} — ¿seguro que quieres usarlo también aquí?`,
        );
        if (!seguir) return;
      }
    }
    const valorFacturaStr = window.prompt("Valor de la factura:");
    if (valorFacturaStr === null) return;
    const fechaEmision = window.prompt("Fecha de la factura (AAAA-MM-DD):", today());
    if (fechaEmision === null) return;
    await supabase
      .from("lab_ordenes")
      .update({
        estado: "recibido",
        fecha_recibido: today(),
        factura_numero: facturaNumero.trim() || null,
        consecutivo: facturaNumero.trim() || null,
        valor_factura: Number(valorFacturaStr) || null,
        fecha_emision_factura: fechaEmision.trim() || null,
      })
      .eq("id", o.id);
    setOrdenes((prev) =>
      prev.map((x) =>
        x.id === o.id
          ? {
              ...x,
              estado: "recibido",
              factura_numero: facturaNumero.trim() || null,
              consecutivo: facturaNumero.trim() || null,
              valor_factura: Number(valorFacturaStr) || null,
              fecha_emision_factura: fechaEmision.trim() || null,
            }
          : x,
      ),
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
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
        <button
          onClick={() => setMostrarForm((v) => !v)}
          className="flex items-center gap-2 rounded-lg bg-[var(--acento)] text-white px-4 py-2 text-sm font-medium"
        >
          <Plus size={16} /> Enviar aparato a laboratorio
        </button>
      </div>

      {mostrarForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-gray-500">Nuevo envío a laboratorio</p>
            <button onClick={() => setMostrarForm(false)}>
              <X size={14} className="text-gray-400" />
            </button>
          </div>
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
          <select
            value={nuevaDoctoraId}
            onChange={(e) => setNuevaDoctoraId(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          >
            {doctoras.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nombre}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={nuevaFecha}
            onChange={(e) => setNuevaFecha(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />

          {enviosLab.length > 0 && (
            <div className="space-y-1">
              {enviosLab.map((e, idx) => (
                <div key={idx} className="flex items-center justify-between rounded-md bg-gray-50 px-2 py-1.5 text-sm">
                  <span>
                    {e.laboratorioNombre} · {TIPOS_SERVICIO_LAB.find((t) => t.value === e.tipoServicio)?.label}
                  </span>
                  <button onClick={() => quitarEnvioLab(idx)}>
                    <X size={14} className="text-gray-400" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2 flex-wrap">
            <select
              value={nuevoLaboratorioId}
              onChange={(e) => setNuevoLaboratorioId(e.target.value)}
              className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            >
              {laboratorios.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nombre}
                </option>
              ))}
            </select>
            <select
              value={nuevoTipoServicio}
              onChange={(e) => setNuevoTipoServicio(e.target.value)}
              className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            >
              {TIPOS_SERVICIO_LAB.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <button onClick={agregarEnvioLab} className="rounded-md bg-gray-100 px-3 text-sm font-medium">
              <Plus size={14} />
            </button>
          </div>
          <p className="text-xs text-gray-400">Agrega uno por cada aparato (ej. si va superior e inferior, agrega los dos).</p>
          <button
            onClick={enviarAparato}
            disabled={!nuevoPaciente || enviosLab.length === 0 || enviando}
            className="w-full rounded-lg bg-[var(--acento)] text-white py-2 text-sm font-medium disabled:opacity-40"
          >
            {enviando ? "Enviando…" : "Enviar a laboratorio"}
          </button>
        </div>
      )}

      {ESTADOS.map((e) => {
        const items = ordenes.filter((o) => o.estado === e.value);
        return (
          <div key={e.value} className="bg-white rounded-xl border border-gray-200">
            <button
              onClick={() => setAbierto(abierto === e.value ? ("" as EstadoLab) : e.value)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold"
            >
              {e.label} ({items.length})
            </button>
            {abierto === e.value && (
              <div className="border-t border-gray-100 divide-y divide-gray-100">
                {items.map((o) =>
                  editandoId === o.id ? (
                    <div key={o.id} className="px-4 py-3 space-y-2">
                      <p className="text-sm font-medium">{o.pacientes?.nombre}</p>
                      <div className="flex gap-2 flex-wrap">
                        <select
                          value={editDoctoraId}
                          onChange={(e) => setEditDoctoraId(e.target.value)}
                          className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                        >
                          {doctoras.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.nombre}
                            </option>
                          ))}
                        </select>
                        <select
                          value={editLaboratorioId}
                          onChange={(e) => setEditLaboratorioId(e.target.value)}
                          className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                        >
                          {laboratorios.map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.nombre}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex gap-2">
                        <select
                          value={editTipoServicio}
                          onChange={(e) => setEditTipoServicio(e.target.value)}
                          className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                        >
                          {TIPOS_SERVICIO_LAB.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => guardarEdicion(o.id)}
                          disabled={guardandoEdit}
                          className="flex items-center gap-1 rounded-md bg-[var(--acento)] text-white px-3 text-sm font-medium disabled:opacity-40"
                        >
                          <Check size={14} /> Guardar
                        </button>
                        <button onClick={() => setEditandoId(null)} className="px-2 text-gray-400">
                          <X size={16} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div key={o.id} className="flex items-center justify-between px-4 py-2 text-sm">
                      <span>
                        {o.pacientes?.nombre} <span className="text-gray-400">· {o.doctoras?.nombre} · {o.laboratorios?.nombre}</span>
                      </span>
                      <span className="flex items-center gap-3">
                        {(o.mes_liquidacion || o.fecha_emision_factura || o.fecha_recibido) && (
                          <span className="text-xs text-gray-400" title="Fecha usada para el período de liquidación">
                            {o.mes_liquidacion ?? o.fecha_emision_factura ?? o.fecha_recibido}
                          </span>
                        )}
                        {o.valor_factura && <span className="text-gray-500">{fmtCOP(o.valor_factura)}</span>}
                        <button onClick={() => empezarEdicion(o)} title="Editar" className="text-gray-400 hover:text-[var(--acento)]">
                          <Pencil size={14} />
                        </button>
                        {e.value === "enviado" && (
                          <button onClick={() => marcarRecibido(o)} className="text-[var(--acento)] font-medium text-xs">
                            Marcar recibido
                          </button>
                        )}
                      </span>
                    </div>
                  ),
                )}
                {items.length === 0 && <p className="px-4 py-3 text-sm text-gray-400">Sin órdenes.</p>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
