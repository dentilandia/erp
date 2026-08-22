import { useEffect, useState } from "react";
import { Paperclip, Check } from "lucide-react";
import { supabase } from "../lib/supabase";
import { fmtCOP, today } from "../lib/format";
import type { MedioPago } from "../lib/types";

interface FilaFinanciacion {
  id: string;
  valor: number;
  medio_pago: MedioPago;
  financiacion_pagado: boolean | null;
  financiacion_fecha_pago: string | null;
  comprobante_financiacion_url: string | null;
  cargos: {
    concepto: string;
    fecha: string;
    doctoras: { nombre: string; color_pastel: string } | null;
    sedes: { nombre: string } | null;
    visitas: { pacientes: { nombre: string } | null } | null;
  };
}

export function Financiacion() {
  const [filas, setFilas] = useState<FilaFinanciacion[]>([]);
  const [soloPendientes, setSoloPendientes] = useState(true);
  const [subiendoId, setSubiendoId] = useState<string | null>(null);

  async function cargar() {
    let q = supabase
      .from("cargo_pagos")
      .select(
        "id, valor, medio_pago, financiacion_pagado, financiacion_fecha_pago, comprobante_financiacion_url, cargos!inner(concepto, fecha, doctoras(nombre, color_pastel), sedes(nombre), visitas(pacientes(nombre)))",
      )
      .in("medio_pago", ["addi", "sistecredito"])
      .order("cargos(fecha)", { ascending: false });
    // financiacion_pagado queda en null hasta que se marca explícitamente pagado —
    // "pendiente" debe incluir null además de false, si no los recién creados se pierden.
    if (soloPendientes) q = q.not("financiacion_pagado", "is", true);
    const { data } = await q;
    setFilas((data as unknown as FilaFinanciacion[]) ?? []);
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soloPendientes]);

  async function marcarPagado(id: string, pagado: boolean) {
    await supabase
      .from("cargo_pagos")
      .update({ financiacion_pagado: pagado, financiacion_fecha_pago: pagado ? today() : null })
      .eq("id", id);
    cargar();
  }

  async function verComprobante(path: string) {
    const { data } = await supabase.storage.from("comprobantes").createSignedUrl(path, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  }

  async function subirComprobante(id: string, file: File) {
    setSubiendoId(id);
    const path = `financiacion-admin/${id}-${file.name}`;
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

  const total = filas.reduce((a, f) => a + Number(f.valor), 0);

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={soloPendientes} onChange={(e) => setSoloPendientes(e.target.checked)} />
          Solo pendientes de pago
        </label>
        <span className="text-sm text-gray-500">
          Total {soloPendientes ? "pendiente" : "listado"}: <span className="font-semibold text-tinta">{fmtCOP(total)}</span>
        </span>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {filas.map((f) => (
          <div key={f.id} className="flex items-center justify-between px-4 py-3 text-sm flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <div>
                <span className="font-medium">{f.cargos.visitas?.pacientes?.nombre ?? "—"}</span>{" "}
                <span className="text-gray-400">
                  · {f.cargos.fecha} · {f.cargos.concepto} · {f.cargos.sedes?.nombre}
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
            <div className="flex items-center gap-3 flex-wrap">
              <span
                className="text-xs font-semibold px-2 py-0.5 rounded-full text-white"
                style={{ background: f.medio_pago === "addi" ? "#D99A2B" : "#4C8F6E" }}
              >
                {f.medio_pago === "addi" ? "Addi" : "Sistecrédito"}
              </span>
              <span className="font-semibold">{fmtCOP(f.valor)}</span>
              {f.comprobante_financiacion_url ? (
                <button
                  onClick={() => verComprobante(f.comprobante_financiacion_url!)}
                  className="flex items-center gap-1 text-xs text-[var(--acento)] font-medium"
                >
                  <Paperclip size={12} /> Ver comprobante
                </button>
              ) : (
                <label className="flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-lg bg-amber-100 text-amber-700 cursor-pointer">
                  <Paperclip size={12} />
                  {subiendoId === f.id ? "Subiendo…" : "Adjuntar comprobante"}
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && subirComprobante(f.id, e.target.files[0])}
                  />
                </label>
              )}
              {f.financiacion_pagado ? (
                <span className="text-xs text-gray-400">Pagado {f.financiacion_fecha_pago}</span>
              ) : null}
              <button
                onClick={() => marcarPagado(f.id, !f.financiacion_pagado)}
                className={`text-xs font-medium px-3 py-1.5 rounded-lg ${
                  f.financiacion_pagado ? "bg-gray-100 text-gray-500" : "bg-[var(--acento)] text-white"
                }`}
              >
                {f.financiacion_pagado ? (
                  <span className="flex items-center gap-1"><Check size={12} /> Marcar sin pagar</span>
                ) : (
                  "Marcar pagado"
                )}
              </button>
            </div>
          </div>
        ))}
        {filas.length === 0 && <p className="px-4 py-4 text-sm text-gray-400">Sin registros.</p>}
      </div>
    </div>
  );
}
