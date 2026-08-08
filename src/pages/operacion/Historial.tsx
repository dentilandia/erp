import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { fmtCOP, today } from "../../lib/format";
import type { Sede } from "../../lib/types";

interface VisitaRow {
  id: string;
  fecha: string;
  estado: string;
  tratamiento: string | null;
  pacientes: { nombre: string };
  doctoras: { nombre: string; color_pastel: string };
  cargos: { valor: number }[];
}

export function Historial() {
  const { sedeActiva } = useOutletContext<{ sedeActiva: Sede }>();
  const [desde, setDesde] = useState(today());
  const [hasta, setHasta] = useState(today());
  const [visitas, setVisitas] = useState<VisitaRow[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("visitas")
        .select("id, fecha, estado, tratamiento, pacientes(nombre), doctoras(nombre, color_pastel), cargos(valor)")
        .eq("sede_id", sedeActiva.id)
        .gte("fecha", desde)
        .lte("fecha", hasta)
        .order("fecha", { ascending: false });
      setVisitas((data as unknown as VisitaRow[]) ?? []);
    })();
  }, [sedeActiva.id, desde, hasta]);

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex gap-3">
        <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      </div>
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {visitas.map((v) => (
          <div key={v.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
            <div>
              <span className="font-medium">{v.pacientes?.nombre}</span>{" "}
              <span className="text-gray-400">
                · {v.fecha} · {v.tratamiento || "—"}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: v.doctoras?.color_pastel + "40" }}>
                {v.doctoras?.nombre}
              </span>
              <span className="font-semibold">{fmtCOP(v.cargos.reduce((a, c) => a + Number(c.valor), 0))}</span>
              <span className="text-xs text-gray-400 capitalize">{v.estado}</span>
            </div>
          </div>
        ))}
        {visitas.length === 0 && <p className="px-4 py-4 text-sm text-gray-400">Sin visitas en este rango.</p>}
      </div>
    </div>
  );
}
