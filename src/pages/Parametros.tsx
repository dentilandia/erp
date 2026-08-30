import { useEffect, useState } from "react";
import { Plus, Check, X, Trash2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { today } from "../lib/format";
import type { Doctora, Sede, Paciente, SaldoFavor } from "../lib/types";
import { PacienteAutocomplete } from "../components/PacienteAutocomplete";

const PALETA_SUGERIDA = [
  "#B08FC7", "#7FCBC4", "#F0C48A", "#E39B9B", "#8FBFA8", "#A8A0D8",
  "#F0B199", "#84B6D6", "#C9A0BE", "#9BC97F", "#D6B26A", "#8AA6C9", "#B5D6C4",
];

const ETIQUETAS_PRECIOS: Record<string, string> = {
  mascara_facial: "Máscara facial",
  elasticos_intraoral: "Elásticos intraoral",
  traccion_extraoral: "Tracción extra oral",
  rx: "RX",
  gum: "GUM",
  caja_aparato: "Caja aparato",
  llave_aparato: "Llave de aparato",
  porcentaje_honorario: "% honorario doctora (Odontopediatra)",
};

export function Parametros() {
  const [doctoras, setDoctoras] = useState<Doctora[]>([]);
  const [precios, setPrecios] = useState<{ clave: string; valor: number }[]>([]);
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevoColor, setNuevoColor] = useState(PALETA_SUGERIDA[0]);
  const [guardando, setGuardando] = useState(false);
  const [precioGuardado, setPrecioGuardado] = useState<string | null>(null);

  const [sedes, setSedes] = useState<Sede[]>([]);
  const [pacienteSaldo, setPacienteSaldo] = useState<Paciente | null>(null);
  const [sedeSaldoId, setSedeSaldoId] = useState("");
  const [fechaSaldo, setFechaSaldo] = useState(today());
  const [valorSaldo, setValorSaldo] = useState("");
  const [notasSaldo, setNotasSaldo] = useState("");
  const [guardandoSaldo, setGuardandoSaldo] = useState(false);
  const [saldoRegistrado, setSaldoRegistrado] = useState(false);
  const [errorSaldo, setErrorSaldo] = useState<string | null>(null);

  const [pacienteEditar, setPacienteEditar] = useState<Paciente | null>(null);
  const [saldosPaciente, setSaldosPaciente] = useState<SaldoFavor[]>([]);
  const [saldoGuardadoId, setSaldoGuardadoId] = useState<string | null>(null);

  async function cargar() {
    const { data: d } = await supabase.from("doctoras").select("*").order("nombre");
    setDoctoras((d as Doctora[]) ?? []);
    const { data: p } = await supabase.from("precios_config").select("clave, valor").order("clave");
    setPrecios(p ?? []);
    const { data: s } = await supabase.from("sedes").select("id, nombre, color_acento").order("nombre");
    setSedes((s as Sede[]) ?? []);
    if (s && s.length > 0) setSedeSaldoId((prev) => prev || s[0].id);
  }

  useEffect(() => {
    cargar();
  }, []);

  async function actualizarDoctora(id: string, cambios: Partial<Doctora>) {
    setDoctoras((prev) => prev.map((d) => (d.id === id ? { ...d, ...cambios } : d)));
    await supabase.from("doctoras").update(cambios).eq("id", id);
  }

  async function agregarDoctora() {
    if (!nuevoNombre.trim()) return;
    setGuardando(true);
    await supabase.from("doctoras").insert({ nombre: nuevoNombre.trim(), color_pastel: nuevoColor });
    setNuevoNombre("");
    setGuardando(false);
    cargar();
  }

  function editarPrecio(clave: string, valor: number) {
    setPrecios((prev) => prev.map((p) => (p.clave === clave ? { ...p, valor } : p)));
  }

  async function guardarPrecio(clave: string, valor: number) {
    await supabase.from("precios_config").update({ valor }).eq("clave", clave);
    setPrecioGuardado(clave);
    setTimeout(() => setPrecioGuardado((prev) => (prev === clave ? null : prev)), 1500);
  }

  async function registrarSaldo() {
    const valor = Number(valorSaldo);
    if (!pacienteSaldo || !sedeSaldoId || !valor) return;
    setGuardandoSaldo(true);
    setErrorSaldo(null);
    const { error } = await supabase.from("saldos_favor").insert({
      paciente_id: pacienteSaldo.id,
      sede_origen_id: sedeSaldoId,
      valor,
      valor_disponible: valor,
      medio_origen: "ajuste_manual",
      fecha: fechaSaldo,
      notas: notasSaldo.trim() || null,
    });
    setGuardandoSaldo(false);
    if (error) {
      setErrorSaldo(error.message);
      return;
    }
    setPacienteSaldo(null);
    setValorSaldo("");
    setNotasSaldo("");
    setSaldoRegistrado(true);
    setTimeout(() => setSaldoRegistrado(false), 2000);
  }

  async function cargarSaldosPaciente(p: Paciente) {
    setPacienteEditar(p);
    const { data } = await supabase
      .from("saldos_favor")
      .select("*")
      .eq("paciente_id", p.id)
      .order("fecha", { ascending: false });
    setSaldosPaciente((data as SaldoFavor[]) ?? []);
  }

  function editarSaldoPaciente(id: string, cambios: Partial<SaldoFavor>) {
    setSaldosPaciente((prev) => prev.map((s) => (s.id === id ? { ...s, ...cambios } : s)));
  }

  async function guardarSaldoPaciente(id: string) {
    const s = saldosPaciente.find((x) => x.id === id);
    if (!s) return;
    await supabase
      .from("saldos_favor")
      .update({ fecha: s.fecha, valor: s.valor, valor_disponible: s.valor_disponible, notas: s.notas })
      .eq("id", id);
    setSaldoGuardadoId(id);
    setTimeout(() => setSaldoGuardadoId((prev) => (prev === id ? null : prev)), 1500);
  }

  async function eliminarSaldoPaciente(id: string) {
    if (!window.confirm("¿Eliminar este saldo a favor? Esta acción no se puede deshacer.")) return;
    await supabase.from("saldos_favor").delete().eq("id", id);
    setSaldosPaciente((prev) => prev.filter((s) => s.id !== id));
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <section className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold text-tinta mb-3">Doctoras</h2>
        <div className="divide-y divide-gray-100">
          {doctoras.map((d) => (
            <div key={d.id} className="flex items-center gap-3 py-2.5 flex-wrap">
              <span className="w-4 h-4 rounded-full shrink-0" style={{ background: d.color_pastel }} />
              <span className="font-medium text-sm flex-1 min-w-[160px]">{d.nombre}</span>
              <label className="flex items-center gap-1.5 text-xs text-gray-500">
                <input
                  type="checkbox"
                  checked={d.retencion_voluntaria_activa}
                  onChange={(e) => actualizarDoctora(d.id, { retencion_voluntaria_activa: e.target.checked })}
                />
                Retención voluntaria
              </label>
              <input
                type="number"
                step="0.1"
                value={d.retencion_voluntaria_pct}
                onChange={(e) => actualizarDoctora(d.id, { retencion_voluntaria_pct: Number(e.target.value) })}
                disabled={!d.retencion_voluntaria_activa}
                className="w-16 rounded-md border border-gray-300 px-2 py-1 text-xs disabled:opacity-40"
              />
              <span className="text-xs text-gray-400">%</span>
              <label className="flex items-center gap-1.5 text-xs text-gray-500">
                <input
                  type="checkbox"
                  checked={d.activa}
                  onChange={(e) => actualizarDoctora(d.id, { activa: e.target.checked })}
                />
                Activa
              </label>
            </div>
          ))}
        </div>

        <div className="mt-4 pt-4 border-t border-dashed border-gray-200">
          <p className="text-xs font-medium text-gray-500 mb-2">Agregar doctora</p>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              value={nuevoNombre}
              onChange={(e) => setNuevoNombre(e.target.value)}
              placeholder="Nombre completo"
              className="flex-1 min-w-[200px] rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <div className="flex items-center gap-1">
              {PALETA_SUGERIDA.map((c) => (
                <button
                  key={c}
                  onClick={() => setNuevoColor(c)}
                  className="w-6 h-6 rounded-full border-2"
                  style={{ background: c, borderColor: nuevoColor === c ? "#2E253A" : "transparent" }}
                />
              ))}
            </div>
            <button
              onClick={agregarDoctora}
              disabled={!nuevoNombre.trim() || guardando}
              className="flex items-center gap-2 rounded-lg bg-[var(--acento)] text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
            >
              <Plus size={16} /> Agregar
            </button>
          </div>
        </div>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold text-tinta mb-3">Precios de insumos y RX</h2>
        <div className="divide-y divide-gray-100">
          {precios.map((p) => (
            <div key={p.clave} className="flex items-center justify-between py-2.5">
              <span className="text-sm">{ETIQUETAS_PRECIOS[p.clave] ?? p.clave}</span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={p.valor}
                  onChange={(e) => editarPrecio(p.clave, Number(e.target.value))}
                  className="w-32 rounded-md border border-gray-300 px-2 py-1 text-sm text-right"
                />
                <button
                  onClick={() => guardarPrecio(p.clave, p.valor)}
                  className="flex items-center gap-1 rounded-md bg-[var(--acento)] text-white px-3 py-1.5 text-xs font-medium"
                >
                  {precioGuardado === p.clave ? <Check size={14} /> : "Guardar"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold text-tinta mb-1">Registrar saldo a favor manual</h2>
        <p className="text-xs text-gray-400 mb-3">
          Para saldos que el paciente ya tenía antes del sistema, o para correcciones. Una vez registrado,
          queda disponible como medio de pago "Saldo a favor" en el cobro de ese paciente.
        </p>
        <div className="space-y-2">
          {pacienteSaldo ? (
            <div className="flex items-center justify-between rounded-lg border border-[var(--acento)] bg-[var(--acento)]/5 px-3 py-2 text-sm">
              <span>{pacienteSaldo.nombre}</span>
              <button onClick={() => setPacienteSaldo(null)}>
                <X size={14} />
              </button>
            </div>
          ) : (
            <PacienteAutocomplete onSelect={setPacienteSaldo} placeholder="Buscar paciente…" />
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={sedeSaldoId}
              onChange={(e) => setSedeSaldoId(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              {sedes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={fechaSaldo}
              onChange={(e) => setFechaSaldo(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              type="number"
              placeholder="Valor"
              value={valorSaldo}
              onChange={(e) => setValorSaldo(e.target.value)}
              className="w-32 rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <input
            value={notasSaldo}
            onChange={(e) => setNotasSaldo(e.target.value)}
            placeholder="Nota (ej: saldo trasladado del sistema anterior)"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          {errorSaldo && <p className="text-sm text-red-600">{errorSaldo}</p>}
          <button
            onClick={registrarSaldo}
            disabled={!pacienteSaldo || !valorSaldo || guardandoSaldo}
            className="flex items-center gap-2 rounded-lg bg-[var(--acento)] text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
          >
            {saldoRegistrado ? <Check size={16} /> : <Plus size={16} />}
            {guardandoSaldo ? "Registrando…" : saldoRegistrado ? "Registrado" : "Registrar saldo"}
          </button>
        </div>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold text-tinta mb-1">Corregir saldo a favor existente</h2>
        <p className="text-xs text-gray-400 mb-3">
          Para arreglar la fecha o el valor de un saldo a favor que ya quedó mal registrado.
        </p>
        {pacienteEditar ? (
          <div className="flex items-center justify-between rounded-lg border border-[var(--acento)] bg-[var(--acento)]/5 px-3 py-2 text-sm mb-2">
            <span>{pacienteEditar.nombre}</span>
            <button
              onClick={() => {
                setPacienteEditar(null);
                setSaldosPaciente([]);
              }}
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <PacienteAutocomplete onSelect={cargarSaldosPaciente} placeholder="Buscar paciente…" />
        )}

        {pacienteEditar && (
          <div className="space-y-3 mt-2">
            {saldosPaciente.map((s) => (
              <div key={s.id} className="rounded-lg border border-gray-200 p-3 flex items-center gap-2 flex-wrap">
                <input
                  type="date"
                  value={s.fecha}
                  onChange={(e) => editarSaldoPaciente(s.id, { fecha: e.target.value })}
                  className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                />
                <div>
                  <label className="block text-[10px] text-gray-400">Valor total</label>
                  <input
                    type="number"
                    value={s.valor}
                    onChange={(e) => editarSaldoPaciente(s.id, { valor: Number(e.target.value) })}
                    className="w-28 rounded-md border border-gray-300 px-2 py-1 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-400">Disponible</label>
                  <input
                    type="number"
                    value={s.valor_disponible}
                    onChange={(e) => editarSaldoPaciente(s.id, { valor_disponible: Number(e.target.value) })}
                    className="w-28 rounded-md border border-gray-300 px-2 py-1 text-sm"
                  />
                </div>
                <button
                  onClick={() => guardarSaldoPaciente(s.id)}
                  className="flex items-center gap-1 rounded-md bg-[var(--acento)] text-white px-3 py-1.5 text-xs font-medium"
                >
                  {saldoGuardadoId === s.id ? <Check size={14} /> : "Guardar"}
                </button>
                <button
                  onClick={() => eliminarSaldoPaciente(s.id)}
                  title="Eliminar este saldo a favor"
                  className="flex items-center gap-1 rounded-md border border-red-200 text-red-500 px-3 py-1.5 text-xs font-medium hover:bg-red-50"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {saldosPaciente.length === 0 && <p className="text-sm text-gray-400">Sin saldos a favor registrados.</p>}
          </div>
        )}
      </section>
    </div>
  );
}
