import { useEffect, useState } from "react";
import { Plus, Check } from "lucide-react";
import { supabase } from "../lib/supabase";
import type { Doctora } from "../lib/types";

const PALETA_SUGERIDA = [
  "#B08FC7", "#7FCBC4", "#F0C48A", "#E39B9B", "#8FBFA8", "#A8A0D8",
  "#F0B199", "#84B6D6", "#C9A0BE", "#9BC97F", "#D6B26A", "#8AA6C9", "#B5D6C4",
];

const ETIQUETAS_PRECIOS: Record<string, string> = {
  mascara_facial: "Máscara facial",
  elasticos_intraoral: "Elásticos intraoral",
  traccion_extraoral: "Tracción extra oral",
  rx: "RX",
};

export function Parametros() {
  const [doctoras, setDoctoras] = useState<Doctora[]>([]);
  const [precios, setPrecios] = useState<{ clave: string; valor: number }[]>([]);
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevoColor, setNuevoColor] = useState(PALETA_SUGERIDA[0]);
  const [guardando, setGuardando] = useState(false);
  const [precioGuardado, setPrecioGuardado] = useState<string | null>(null);

  async function cargar() {
    const { data: d } = await supabase.from("doctoras").select("*").order("nombre");
    setDoctoras((d as Doctora[]) ?? []);
    const { data: p } = await supabase.from("precios_config").select("clave, valor").order("clave");
    setPrecios(p ?? []);
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
    </div>
  );
}
