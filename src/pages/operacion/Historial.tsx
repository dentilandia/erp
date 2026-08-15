import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { fmtCOP, today } from "../../lib/format";
import type { Sede, Doctora } from "../../lib/types";

interface VisitaRow {
  id: string;
  fecha: string;
  estado: string;
  tratamiento: string | null;
  doctora_id: string;
  pacientes: { nombre: string };
  doctoras: { nombre: string; color_pastel: string };
  cargos: { categoria: string; valor: number; cargo_pagos: { valor: number }[] }[];
}

export function Historial() {
  const { sedeActiva } = useOutletContext<{ sedeActiva: Sede }>();
  const [desde, setDesde] = useState(today());
  const [hasta, setHasta] = useState(today());
  const [doctoraId, setDoctoraId] = useState("");
  const [doctoras, setDoctoras] = useState<Doctora[]>([]);
  const [visitas, setVisitas] = useState<VisitaRow[]>([]);

  useEffect(() => {
    supabase.from("doctoras").select("*").order("nombre").then(({ data }) => setDoctoras((data as Doctora[]) ?? []));
  }, []);

  useEffect(() => {
    (async () => {
      let q = supabase
        .from("visitas")
        .select(
          "id, fecha, estado, tratamiento, doctora_id, pacientes(nombre), doctoras(nombre, color_pastel), cargos(categoria, valor, cargo_pagos(valor))",
        )
        .eq("sede_id", sedeActiva.id)
        .gte("fecha", desde)
        .lte("fecha", hasta)
        .order("fecha", { ascending: false });
      if (doctoraId) q = q.eq("doctora_id", doctoraId);
      const { data } = await q;
      setVisitas((data as unknown as VisitaRow[]) ?? []);
    })();
  }, [sedeActiva.id, desde, hasta, doctoraId]);

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex gap-3 flex-wrap">
        <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        <select
          value={doctoraId}
          onChange={(e) => setDoctoraId(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">Todas las doctoras</option>
          {doctoras.map((d) => (
            <option key={d.id} value={d.id}>
              {d.nombre}
            </option>
          ))}
        </select>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {visitas.map((v) => {
          const totalCargos = v.cargos.reduce((a, c) => a + Number(c.valor), 0);
          const totalPagado = v.cargos.reduce((a, c) => a + c.cargo_pagos.reduce((x, p) => x + Number(p.valor), 0), 0);
          const sinCuadrar = v.estado === "cobrado" && Math.round(totalPagado) !== Math.round(totalCargos);
          return (
            <div key={v.id} className="flex items-center justify-between px-4 py-2.5 text-sm flex-wrap gap-1">
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
                <span className="font-semibold">{fmtCOP(totalCargos)}</span>
                <span className="text-xs text-gray-400 capitalize">{v.estado}</span>
                {sinCuadrar && (
                  <span className="text-xs font-medium text-red-600" title="Lo cobrado no coincide con el valor de los cargos">
                    ⚠ pagado {fmtCOP(totalPagado)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        {visitas.length === 0 && <p className="px-4 py-4 text-sm text-gray-400">Sin visitas en este rango.</p>}
      </div>
    </div>
  );
}
