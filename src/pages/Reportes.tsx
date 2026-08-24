import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { fmtCOP } from "../lib/format";

interface FilaProductividad {
  sedeId: string;
  sede: string;
  doctora: string;
  pacientes: number;
  total: number;
  promedio: number;
}

interface FilaSaldoFavor {
  paciente: string;
  sede: string;
  valor: number;
  fecha: string;
}

export function Reportes() {
  const [desde, setDesde] = useState(() => new Date().toISOString().slice(0, 8) + "01");
  const [hasta, setHasta] = useState(() => new Date().toISOString().slice(0, 10));
  const [cargando, setCargando] = useState(true);
  const [filas, setFilas] = useState<FilaProductividad[]>([]);

  const [cargandoSaldos, setCargandoSaldos] = useState(true);
  const [saldosPorSede, setSaldosPorSede] = useState<{ sede: string; total: number }[]>([]);
  const [totalSaldoGeneral, setTotalSaldoGeneral] = useState(0);
  const [topSaldos, setTopSaldos] = useState<FilaSaldoFavor[]>([]);

  useEffect(() => {
    (async () => {
      setCargando(true);
      const [{ data: sedesData }, { data: doctorasData }, { data: visitasData }, { data: pagosData }] = await Promise.all([
        supabase.from("sedes").select("id, nombre"),
        supabase.from("doctoras").select("id, nombre"),
        supabase.from("visitas").select("sede_id, doctora_id").eq("estado", "cobrado").gte("fecha", desde).lte("fecha", hasta),
        supabase
          .from("cargo_pagos")
          .select("valor, cargos!inner(categoria, sede_id, doctora_id, fecha)")
          .eq("cargos.categoria", "procedimiento")
          .gte("cargos.fecha", desde)
          .lte("cargos.fecha", hasta),
      ]);

      const sedeNombre: Record<string, string> = Object.fromEntries(((sedesData as { id: string; nombre: string }[]) ?? []).map((s) => [s.id, s.nombre]));
      const doctoraNombre: Record<string, string> = Object.fromEntries(
        ((doctorasData as { id: string; nombre: string }[]) ?? []).map((d) => [d.id, d.nombre]),
      );

      const pacientesPorClave: Record<string, number> = {};
      for (const v of (visitasData as { sede_id: string; doctora_id: string }[]) ?? []) {
        const clave = `${v.sede_id}|${v.doctora_id}`;
        pacientesPorClave[clave] = (pacientesPorClave[clave] ?? 0) + 1;
      }

      const facturadoPorClave: Record<string, number> = {};
      for (const p of (pagosData as unknown as { valor: number; cargos: { sede_id: string; doctora_id: string } }[]) ?? []) {
        const clave = `${p.cargos.sede_id}|${p.cargos.doctora_id}`;
        facturadoPorClave[clave] = (facturadoPorClave[clave] ?? 0) + Number(p.valor);
      }

      const claves = new Set([...Object.keys(pacientesPorClave), ...Object.keys(facturadoPorClave)]);
      const filasCalc = Array.from(claves).map((clave) => {
        const [sedeId, doctoraId] = clave.split("|");
        const pacientes = pacientesPorClave[clave] ?? 0;
        const total = facturadoPorClave[clave] ?? 0;
        return {
          sedeId,
          sede: sedeNombre[sedeId] ?? "—",
          doctora: doctoraNombre[doctoraId] ?? "—",
          pacientes,
          total,
          promedio: pacientes > 0 ? total / pacientes : 0,
        };
      });
      filasCalc.sort((a, b) => a.sede.localeCompare(b.sede) || b.total - a.total);
      setFilas(filasCalc);
      setCargando(false);
    })();
  }, [desde, hasta]);

  useEffect(() => {
    (async () => {
      setCargandoSaldos(true);
      const { data } = await supabase
        .from("saldos_favor")
        .select("valor_disponible, fecha, sedes(nombre), pacientes(nombre)")
        .gt("valor_disponible", 0);
      const saldosFilas =
        (data as unknown as { valor_disponible: number; fecha: string; sedes: { nombre: string } | null; pacientes: { nombre: string } | null }[]) ?? [];

      const porSede: Record<string, number> = {};
      for (const s of saldosFilas) {
        const sede = s.sedes?.nombre ?? "—";
        porSede[sede] = (porSede[sede] ?? 0) + Number(s.valor_disponible);
      }
      setSaldosPorSede(Object.entries(porSede).map(([sede, total]) => ({ sede, total })));
      setTotalSaldoGeneral(saldosFilas.reduce((a, s) => a + Number(s.valor_disponible), 0));
      setTopSaldos(
        [...saldosFilas]
          .sort((a, b) => b.valor_disponible - a.valor_disponible)
          .slice(0, 15)
          .map((s) => ({ paciente: s.pacientes?.nombre ?? "—", sede: s.sedes?.nombre ?? "—", valor: Number(s.valor_disponible), fecha: s.fecha })),
      );
      setCargandoSaldos(false);
    })();
  }, []);

  const gruposPorSede = useMemo(() => {
    const map: Record<string, FilaProductividad[]> = {};
    for (const f of filas) {
      map[f.sede] = map[f.sede] ?? [];
      map[f.sede].push(f);
    }
    return map;
  }, [filas]);

  const totalGeneralPacientes = filas.reduce((a, f) => a + f.pacientes, 0);
  const totalGeneralFacturado = filas.reduce((a, f) => a + f.total, 0);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <section className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
          <h2 className="font-semibold text-tinta">Pacientes atendidos y facturación por sede y doctora</h2>
          <div className="flex items-center gap-2">
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
            <span className="text-xs text-gray-400">a</span>
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
        </div>
        <p className="text-xs text-gray-400 mb-3">
          Pacientes atendidos = visitas cobradas en el rango. Facturación = solo procedimiento/tratamiento (no RX ni
          conceptos administrativos), incluye saldo a favor, Addi, Sistecrédito y cualquier otro medio.
        </p>

        {cargando ? (
          <p className="text-sm text-gray-400">Cargando…</p>
        ) : filas.length === 0 ? (
          <p className="text-sm text-gray-400">Sin datos en este rango.</p>
        ) : (
          <div className="space-y-3">
            {Object.entries(gruposPorSede).map(([sede, filasSede]) => {
              const totalSede = filasSede.reduce((a, f) => a + f.total, 0);
              const pacientesSede = filasSede.reduce((a, f) => a + f.pacientes, 0);
              return (
                <div key={sede} className="rounded-lg border border-gray-200 overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 bg-gray-50 text-sm font-semibold">
                    <span>{sede}</span>
                    <span>
                      {pacientesSede} pacientes · {fmtCOP(totalSede)}
                    </span>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {filasSede.map((f) => (
                      <div key={`${f.sedeId}-${f.doctora}`} className="flex items-center justify-between px-3 py-2 text-sm flex-wrap gap-2">
                        <span className="font-medium">{f.doctora}</span>
                        <div className="flex items-center gap-4 text-gray-500">
                          <span>{f.pacientes} pacientes</span>
                          <span className="text-tinta font-semibold">{fmtCOP(f.total)}</span>
                          <span>prom. {fmtCOP(f.promedio)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-100 text-sm font-semibold">
              <span>Total general</span>
              <span>
                {totalGeneralPacientes} pacientes · {fmtCOP(totalGeneralFacturado)}
              </span>
            </div>
          </div>
        )}
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold text-tinta mb-1">Saldo a favor pendiente por usar</h2>
        <p className="text-xs text-gray-400 mb-3">
          Plata que los pacientes ya pagaron por adelantado y todavía no han usado — es una obligación pendiente de la
          clínica, no un ingreso disponible.
        </p>
        {cargandoSaldos ? (
          <p className="text-sm text-gray-400">Cargando…</p>
        ) : (
          <>
            <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-100 text-sm font-semibold mb-3">
              <span>Total pendiente</span>
              <span>{fmtCOP(totalSaldoGeneral)}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {saldosPorSede.map((s) => (
                <div key={s.sede} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-sm">
                  <span className="text-gray-500">{s.sede}</span>
                  <span className="font-medium">{fmtCOP(s.total)}</span>
                </div>
              ))}
            </div>
            {topSaldos.length > 0 && (
              <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">
                <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 bg-gray-50">Pacientes con mayor saldo pendiente</div>
                {topSaldos.map((s, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span>
                      {s.paciente} <span className="text-gray-400">· {s.sede} · desde {s.fecha}</span>
                    </span>
                    <span className="font-medium">{fmtCOP(s.valor)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
