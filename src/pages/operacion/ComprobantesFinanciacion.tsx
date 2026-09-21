import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Paperclip, Check } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { fmtCOP } from "../../lib/format";
import type { Sede, MedioPago } from "../../lib/types";

interface FilaFinanciacion {
  id: string;
  origen: "cargo" | "saldo";
  valor: number;
  medio_pago: MedioPago;
  comprobante_financiacion_url: string | null;
  paciente: string;
  concepto: string;
  doctoraNombre: string | null;
  doctoraColor: string | null;
}

export function ComprobantesFinanciacion() {
  const { sedeActiva } = useOutletContext<{ sedeActiva: Sede }>();
  const [filas, setFilas] = useState<FilaFinanciacion[]>([]);
  const [soloSinComprobante, setSoloSinComprobante] = useState(true);
  const [subiendoId, setSubiendoId] = useState<string | null>(null);

  async function cargar() {
    let qCargos = supabase
      .from("cargo_pagos")
      .select(
        "id, valor, medio_pago, comprobante_financiacion_url, cargos!inner(concepto, fecha, sede_id, doctoras(nombre, color_pastel), visitas(pacientes(nombre)))",
      )
      .eq("cargos.sede_id", sedeActiva.id)
      .in("medio_pago", ["addi", "sistecredito"])
      .order("cargos(fecha)", { ascending: false });
    if (soloSinComprobante) qCargos = qCargos.is("comprobante_financiacion_url", null);
    const { data: cargosData } = await qCargos;

    // Anticipos/saldos a favor pagados por Addi/Sistecrédito sin cargo
    // todavía (ej. sedación pagada por teléfono) — antes no aparecían acá.
    let qSaldos = supabase
      .from("saldos_favor")
      .select("id, valor, medio_origen, comprobante_financiacion_url, fecha, pacientes(nombre)")
      .eq("sede_origen_id", sedeActiva.id)
      .in("medio_origen", ["addi", "sistecredito"]);
    if (soloSinComprobante) qSaldos = qSaldos.is("comprobante_financiacion_url", null);
    const { data: saldosData } = await qSaldos;

    const deCargos = (
      (cargosData as unknown as {
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
      }[]) ?? []
    ).map((f) => ({
      id: f.id,
      origen: "cargo" as const,
      valor: Number(f.valor),
      medio_pago: f.medio_pago,
      comprobante_financiacion_url: f.comprobante_financiacion_url,
      paciente: f.cargos.visitas?.pacientes?.nombre ?? "—",
      concepto: `${f.cargos.fecha} · ${f.cargos.concepto}`,
      doctoraNombre: f.cargos.doctoras?.nombre ?? null,
      doctoraColor: f.cargos.doctoras?.color_pastel ?? null,
    }));

    const deSaldos = (
      (saldosData as unknown as {
        id: string;
        valor: number;
        medio_origen: MedioPago;
        comprobante_financiacion_url: string | null;
        fecha: string;
        pacientes: { nombre: string } | null;
      }[]) ?? []
    ).map((s) => ({
      id: s.id,
      origen: "saldo" as const,
      valor: Number(s.valor),
      medio_pago: s.medio_origen,
      comprobante_financiacion_url: s.comprobante_financiacion_url,
      paciente: s.pacientes?.nombre ?? "—",
      concepto: `${s.fecha} · Anticipo / saldo a favor`,
      doctoraNombre: null,
      doctoraColor: null,
    }));

    setFilas([...deCargos, ...deSaldos].sort((a, b) => b.concepto.localeCompare(a.concepto)));
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sedeActiva.id, soloSinComprobante]);

  async function subirComprobante(fila: FilaFinanciacion, file: File) {
    setSubiendoId(fila.id);
    const path = `${sedeActiva.id}/financiacion-${fila.id}-${file.name}`;
    const { error: errorSubida } = await supabase.storage.from("comprobantes").upload(path, file, { upsert: true });
    if (errorSubida) {
      window.alert(`No se pudo subir el comprobante: ${errorSubida.message}`);
      setSubiendoId(null);
      return;
    }
    const tabla = fila.origen === "cargo" ? "cargo_pagos" : "saldos_favor";
    const { error: errorGuardado } = await supabase.from(tabla).update({ comprobante_financiacion_url: path }).eq("id", fila.id);
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
          <div key={`${f.origen}-${f.id}`} className="flex items-center justify-between px-4 py-3 text-sm flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <div>
                <span className="font-medium">{f.paciente}</span> <span className="text-gray-400">· {f.concepto}</span>
              </div>
              {f.doctoraNombre && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full text-white" style={{ background: f.doctoraColor ?? undefined }}>
                  {f.doctoraNombre}
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
                    onChange={(e) => e.target.files?.[0] && subirComprobante(f, e.target.files[0])}
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
