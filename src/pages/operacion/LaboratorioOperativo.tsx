import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Plus, X } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { fmtCOP, today } from "../../lib/format";
import { TIPOS_SERVICIO_LAB, type Sede, type Doctora, type Laboratorio, type Paciente, type EstadoLab } from "../../lib/types";
import { PacienteAutocomplete } from "../../components/PacienteAutocomplete";

interface LabRow {
  id: string;
  estado: EstadoLab;
  fecha_envio: string;
  factura_numero: string | null;
  valor_factura: number | null;
  doctora_id: string;
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

  const [mostrarForm, setMostrarForm] = useState(false);
  const [nuevoPaciente, setNuevoPaciente] = useState<Paciente | null>(null);
  const [nuevaDoctoraId, setNuevaDoctoraId] = useState("");
  const [nuevoLaboratorioId, setNuevoLaboratorioId] = useState("");
  const [nuevoTipoServicio, setNuevoTipoServicio] = useState(TIPOS_SERVICIO_LAB[0].value);
  const [nuevaFecha, setNuevaFecha] = useState(today());
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
      .select("id, estado, fecha_envio, factura_numero, valor_factura, doctora_id, pacientes(nombre), doctoras(nombre), laboratorios(nombre)")
      .eq("sede_id", sedeActiva.id)
      .order("fecha_envio", { ascending: false });
    if (filtroDoctora) q = q.eq("doctora_id", filtroDoctora);
    const { data } = await q;
    setOrdenes((data as unknown as LabRow[]) ?? []);
  }

  async function enviarAparato() {
    if (!nuevoPaciente || !nuevaDoctoraId || !nuevoLaboratorioId) return;
    setEnviando(true);
    await supabase.from("lab_ordenes").insert({
      sede_id: sedeActiva.id,
      doctora_id: nuevaDoctoraId,
      paciente_id: nuevoPaciente.id,
      laboratorio_id: nuevoLaboratorioId,
      tipo_servicio: nuevoTipoServicio,
      estado: "enviado",
      fecha_envio: nuevaFecha,
    });
    setEnviando(false);
    setMostrarForm(false);
    setNuevoPaciente(null);
    setNuevaFecha(today());
    cargarOrdenes();
  }

  async function marcarRecibido(id: string) {
    const facturaNumero = window.prompt("Número de factura del laboratorio:");
    if (facturaNumero === null) return;
    const valorFacturaStr = window.prompt("Valor de la factura:");
    if (valorFacturaStr === null) return;
    await supabase
      .from("lab_ordenes")
      .update({
        estado: "recibido",
        fecha_recibido: new Date().toISOString().slice(0, 10),
        factura_numero: facturaNumero || null,
        valor_factura: Number(valorFacturaStr) || null,
      })
      .eq("id", id);
    setOrdenes((prev) =>
      prev.map((o) =>
        o.id === id ? { ...o, estado: "recibido", factura_numero: facturaNumero, valor_factura: Number(valorFacturaStr) || null } : o,
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
          <div className="flex gap-2 flex-wrap">
            <select
              value={nuevaDoctoraId}
              onChange={(e) => setNuevaDoctoraId(e.target.value)}
              className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            >
              {doctoras.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nombre}
                </option>
              ))}
            </select>
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
          </div>
          <div className="flex gap-2 flex-wrap">
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
            <input
              type="date"
              value={nuevaFecha}
              onChange={(e) => setNuevaFecha(e.target.value)}
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
          <button
            onClick={enviarAparato}
            disabled={!nuevoPaciente || enviando}
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
                {items.map((o) => (
                  <div key={o.id} className="flex items-center justify-between px-4 py-2 text-sm">
                    <span>
                      {o.pacientes?.nombre} <span className="text-gray-400">· {o.doctoras?.nombre} · {o.laboratorios?.nombre}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      {o.valor_factura && <span className="text-gray-500">{fmtCOP(o.valor_factura)}</span>}
                      {e.value === "enviado" && (
                        <button onClick={() => marcarRecibido(o.id)} className="text-[var(--acento)] font-medium text-xs">
                          Marcar recibido
                        </button>
                      )}
                    </span>
                  </div>
                ))}
                {items.length === 0 && <p className="px-4 py-3 text-sm text-gray-400">Sin órdenes.</p>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
