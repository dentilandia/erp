import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { fmtCOP } from "../../lib/format";
import type { Sede, Doctora, EstadoLab } from "../../lib/types";

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
  const [filtroDoctora, setFiltroDoctora] = useState("");
  const [abierto, setAbierto] = useState<EstadoLab>("enviado");

  useEffect(() => {
    supabase.from("doctoras").select("*").order("nombre").then(({ data }) => setDoctoras((data as Doctora[]) ?? []));
  }, []);

  useEffect(() => {
    (async () => {
      let q = supabase
        .from("lab_ordenes")
        .select("id, estado, fecha_envio, factura_numero, valor_factura, doctora_id, pacientes(nombre), doctoras(nombre), laboratorios(nombre)")
        .eq("sede_id", sedeActiva.id)
        .order("fecha_envio", { ascending: false });
      if (filtroDoctora) q = q.eq("doctora_id", filtroDoctora);
      const { data } = await q;
      setOrdenes((data as unknown as LabRow[]) ?? []);
    })();
  }, [sedeActiva.id, filtroDoctora]);

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
