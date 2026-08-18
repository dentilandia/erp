import { useEffect, useState } from "react";
import { Paperclip } from "lucide-react";
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
    doctoras: { nombre: string } | null;
    sedes: { nombre: string } | null;
    visitas: { pacientes: { nombre: string } | null } | null;
  };
}

export function Financiacion() {
  const [filas, setFilas] = useState<FilaFinanciacion[]>([]);
  const [soloPendientes, setSoloPendientes] = useState(true);

  async function cargar() {
    let q = supabase
      .from("cargo_pagos")
      .select(
        "id, valor, medio_pago, financiacion_pagado, financiacion_fecha_pago, comprobante_financiacion_url, cargos!inner(concepto, fecha, doctoras(nombre), sedes(nombre), visitas(pacientes(nombre)))",
      )
      .in("medio_pago", ["addi", "sistecredito"])
      .order("cargos(fecha)", { ascending: false });
    if (soloPendientes) q = q.eq("financiacion_pagado", false);
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
            <div>
              <span className="font-medium">{f.cargos.visitas?.pacientes?.nombre ?? "—"}</span>{" "}
              <span className="text-gray-400">
                · {f.cargos.fecha} · {f.cargos.concepto} · {f.cargos.doctoras?.nombre} · {f.cargos.sedes?.nombre}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span
                className="text-xs font-medium px-2 py-0.5 rounded-full"
                style={{ background: f.medio_pago === "addi" ? "#F0C48A40" : "#8FBFA840" }}
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
                <span className="text-xs text-amber-600">Sin comprobante</span>
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
                {f.financiacion_pagado ? "Marcar sin pagar" : "Marcar pagado"}
              </button>
            </div>
          </div>
        ))}
        {filas.length === 0 && <p className="px-4 py-4 text-sm text-gray-400">Sin registros.</p>}
      </div>
    </div>
  );
}
