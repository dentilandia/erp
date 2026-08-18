import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { fmtCOP, today } from "../../lib/format";
import { TIPOS_INSUMO_CONSULTA, type Sede, type Doctora } from "../../lib/types";

interface VisitaRow {
  id: string;
  fecha: string;
  estado: string;
  tratamiento: string | null;
  doctora_id: string;
  remision_especialidad: string | null;
  pacientes: { nombre: string };
  doctoras: { nombre: string; color_pastel: string };
  cargos: { categoria: string; valor: number; cargo_pagos: { valor: number }[] }[];
  insumos_consulta: { tipo: string }[];
}

export function Historial() {
  const { sedeActiva } = useOutletContext<{ sedeActiva: Sede }>();
  const [desde, setDesde] = useState(today());
  const [hasta, setHasta] = useState(today());
  const [doctoraId, setDoctoraId] = useState("");
  const [doctoras, setDoctoras] = useState<Doctora[]>([]);
  const [soloRemisiones, setSoloRemisiones] = useState(false);
  const [insumoFiltro, setInsumoFiltro] = useState("");
  const [buscarPaciente, setBuscarPaciente] = useState("");
  const [visitas, setVisitas] = useState<VisitaRow[]>([]);

  useEffect(() => {
    supabase.from("doctoras").select("*").order("nombre").then(({ data }) => setDoctoras((data as Doctora[]) ?? []));
  }, []);

  useEffect(() => {
    (async () => {
      const insumosSelect = insumoFiltro ? "insumos_consulta!inner(tipo)" : "insumos_consulta(tipo)";
      const pacientesSelect = buscarPaciente.trim() ? "pacientes!inner(nombre)" : "pacientes(nombre)";
      let q = supabase
        .from("visitas")
        .select(
          `id, fecha, estado, tratamiento, doctora_id, remision_especialidad, ${pacientesSelect}, doctoras(nombre, color_pastel), cargos(categoria, valor, cargo_pagos(valor)), ${insumosSelect}`,
        )
        .eq("sede_id", sedeActiva.id)
        .gte("fecha", desde)
        .lte("fecha", hasta)
        .order("fecha", { ascending: false });
      if (doctoraId) q = q.eq("doctora_id", doctoraId);
      if (soloRemisiones) q = q.not("remision_especialidad", "is", null);
      if (insumoFiltro) q = q.eq("insumos_consulta.tipo", insumoFiltro);
      if (buscarPaciente.trim()) q = q.ilike("pacientes.nombre", `%${buscarPaciente.trim()}%`);
      const { data } = await q;
      setVisitas((data as unknown as VisitaRow[]) ?? []);
    })();
  }, [sedeActiva.id, desde, hasta, doctoraId, soloRemisiones, insumoFiltro, buscarPaciente]);

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex gap-3 flex-wrap items-center">
        <input
          value={buscarPaciente}
          onChange={(e) => setBuscarPaciente(e.target.value)}
          placeholder="Buscar paciente por nombre…"
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm min-w-[200px]"
        />
        <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        <button
          onClick={() => {
            setDesde("2020-01-01");
            setHasta(today());
          }}
          className="text-xs font-medium text-[var(--acento)]"
        >
          Ver todo el rango
        </button>
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
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={soloRemisiones} onChange={(e) => setSoloRemisiones(e.target.checked)} />
          Solo remisiones a otra especialidad
        </label>
        <select
          value={insumoFiltro}
          onChange={(e) => setInsumoFiltro(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">Cualquier insumo</option>
          {TIPOS_INSUMO_CONSULTA.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
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
                {v.remision_especialidad && (
                  <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                    Remitido: {v.remision_especialidad}
                  </span>
                )}
                {v.insumos_consulta?.map((i, idx) => (
                  <span key={idx} className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                    {TIPOS_INSUMO_CONSULTA.find((t) => t.value === i.tipo)?.label ?? i.tipo}
                  </span>
                ))}
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
