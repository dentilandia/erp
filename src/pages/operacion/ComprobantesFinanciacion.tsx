import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Paperclip, Check } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { fmtCOP } from "../../lib/format";
import type { Sede, MedioPago } from "../../lib/types";

interface FilaFinanciacion {
  id: string;
  valor: number;
  medio_pago: MedioPago;
  comprobante_financiacion_url: string | null;
  cargos: {
    concepto: string;
    fecha: string;
    doctoras: { nombre: string; color_pastel: string } | null;
    visitas: { pacientes: { nombre: string } | null } | null;
  };
}

export function ComprobantesFinanciacion() {
  const { sedeActiva } = useOutletContext<{ sedeActiva: Sede }>();
  const [filas, setFilas] = useState<FilaFinanciacion[]>([]);
  const [soloSinComprobante, setSoloSinComprobante] = useState(true);
  const [subiendoId, setSubiendoId] = useState<string | null>(null);

  async function cargar() {
    let q = supabase
      .from("cargo_pagos")
      .select(
        "id, valor, medio_pago, comprobante_financiacion_url, cargos!inner(concepto, fecha, sede_id, doctoras(nombre, color_pastel), visitas(pacientes(nombre)))",
      )
      .eq("cargos.sede_id", sedeActiva.id)
      .in("medio_pago", ["addi", "sistecredito"])
      .order("cargos(fecha)", { ascending: false });
    if (soloSinComprobante) q = q.is("comprobante_financiacion_url", null);
    const { data } = await q;
    setFilas((data as unknown as FilaFinanciacion[]) ?? []);
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sedeActiva.id, soloSinComprobante]);

  async function subirComprobante(id: string, file: File) {
    setSubiendoId(id);
    const path = `${sedeActiva.id}/financiacion-${id}-${file.name}`;
    const { error: errorSubida } = await supabase.storage.from("comprobantes").upload(path, file, { upsert: true });
    if (errorSubida) {
      window.alert(`No se pudo subir el comprobante: ${errorSubida.message}`);
      setSubiendoId(null);
      return;
    }
    const { error: errorGuardado } = await supabase.from("cargo_pagos").update({ comprobante_financiacion_url: path }).eq("id", id);
    if (errorGuardado) window.alert(`El archivo se subió pero no se pudo guardar el registro: ${errorGuardado.message}`);
    setSubiendoId(null);
    cargar();
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={soloSinComprobante} onChange={(e) => setSoloSinComprobante(e.target.checked)} />
        Solo sin comprobante
      </label>

      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {filas.map((f) => (
          <div key={f.id} className="flex items-center justify-between px-4 py-3 text-sm flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <div>
                <span className="font-medium">{f.cargos.visitas?.pacientes?.nombre ?? "—"}</span>{" "}
                <span className="text-gray-400">
                  · {f.cargos.fecha} · {f.cargos.concepto}
                </span>
              </div>
              {f.cargos.doctoras && (
                <span
                  className="text-xs font-semibold px-2 py-0.5 rounded-full text-white"
                  style={{ background: f.cargos.doctoras.color_pastel }}
                >
                  {f.cargos.doctoras.nombre}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span
                className="text-xs font-semibold px-2 py-0.5 rounded-full text-white"
                style={{ background: f.medio_pago === "addi" ? "#D99A2B" : "#4C8F6E" }}
              >
                {f.medio_pago === "addi" ? "Addi" : "Sistecrédito"}
              </span>
              <span className="font-semibold">{fmtCOP(f.valor)}</span>
              {f.comprobante_financiacion_url ? (
                <span className="flex items-center gap-1 text-xs text-[var(--acento)] font-medium">
                  <Check size={14} /> Comprobante adjunto
                </span>
              ) : (
                <label className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-[var(--acento)] text-white cursor-pointer">
                  <Paperclip size={14} />
                  {subiendoId === f.id ? "Subiendo…" : "Adjuntar comprobante"}
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && subirComprobante(f.id, e.target.files[0])}
                  />
                </label>
              )}
            </div>
          </div>
        ))}
        {filas.length === 0 && <p className="px-4 py-4 text-sm text-gray-400">Sin registros.</p>}
      </div>
    </div>
  );
}
