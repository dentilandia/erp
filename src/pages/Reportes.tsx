import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { fmtCOP, today } from "../lib/format";
import type { Sede } from "../lib/types";
import { CalendarioCalor } from "../components/CalendarioCalor";
import { StatTile } from "../components/StatTile";

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

interface BarraItem {
  id: string;
  label: string;
  valor: number;
  color: string;
}

function inicioDeMes() {
  return new Date().toISOString().slice(0, 8) + "01";
}

/** Barras horizontales — para comparar pocas categorías (doctoras, sedes) con
 *  el valor exacto siempre visible al final de la barra. */
function BarrasHorizontales({ datos, formatear }: { datos: BarraItem[]; formatear: (n: number) => string }) {
  const max = Math.max(1, ...datos.map((d) => d.valor));
  if (datos.length === 0) return <p className="text-sm text-gray-400">Sin datos en este rango.</p>;
  return (
    <div className="space-y-2">
      {datos.map((d) => (
        <div key={d.id} className="flex items-center gap-2">
          <span className="w-28 sm:w-36 shrink-0 text-xs text-gray-500 truncate" title={d.label}>
            {d.label}
          </span>
          <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${(d.valor / max) * 100}%`, background: d.color }} />
          </div>
          <span className="w-24 sm:w-28 shrink-0 text-xs text-right font-semibold text-tinta">{formatear(d.valor)}</span>
        </div>
      ))}
    </div>
  );
}

/** Una sola barra horizontal apilada — para el reparto sede/Dentilandia
 *  (part-to-whole de solo 2 categorías: más preciso que una torta). */
function BarraApiladaSedes({ segmentos }: { segmentos: { id: string; nombre: string; valor: number; color: string }[] }) {
  const total = segmentos.reduce((a, s) => a + s.valor, 0);
  if (total <= 0) return <p className="text-sm text-gray-400">Sin datos.</p>;
  return (
    <div className="space-y-2">
      <div className="flex w-full h-6 rounded-full overflow-hidden">
        {segmentos.map((s, i) => {
          const pct = (s.valor / total) * 100;
          if (pct <= 0) return null;
          return (
            <div
              key={s.id}
              style={{
                width: `${pct}%`,
                background: s.color,
                borderRight: i < segmentos.length - 1 ? "2px solid white" : undefined,
              }}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
        {segmentos.map((s) => (
          <span key={s.id} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full inline-block shrink-0" style={{ background: s.color }} />
            {s.nombre}: <span className="font-semibold text-tinta">{fmtCOP(s.valor)}</span> ({((s.valor / total) * 100).toFixed(1)}%)
          </span>
        ))}
      </div>
    </div>
  );
}

export function Reportes() {
  const [sedes, setSedes] = useState<Sede[]>([]);
  const [sedeFiltro, setSedeFiltro] = useState("");
  const [desde, setDesde] = useState(inicioDeMes);
  const [hasta, setHasta] = useState(today);
  const [cargando, setCargando] = useState(true);
  const [filas, setFilas] = useState<FilaProductividad[]>([]);
  const [serieDiaria, setSerieDiaria] = useState<{ fecha: string; valor: number }[]>([]);

  const [cargandoSaldos, setCargandoSaldos] = useState(true);
  const [saldosPorSede, setSaldosPorSede] = useState<{ sedeId: string; sede: string; total: number }[]>([]);
  const [totalSaldoGeneral, setTotalSaldoGeneral] = useState(0);
  const [topSaldos, setTopSaldos] = useState<FilaSaldoFavor[]>([]);

  useEffect(() => {
    supabase
      .from("sedes")
      .select("id, nombre, color_acento")
      .order("nombre")
      .then(({ data }) => setSedes((data as Sede[]) ?? []));
  }, []);

  const sedeColor: Record<string, string> = useMemo(() => Object.fromEntries(sedes.map((s) => [s.id, s.color_acento])), [sedes]);

  useEffect(() => {
    (async () => {
      setCargando(true);
      let qVisitas = supabase.from("visitas").select("sede_id, doctora_id").eq("estado", "cobrado").gte("fecha", desde).lte("fecha", hasta);
      let qPagos = supabase
        .from("cargo_pagos")
        .select("valor, cargos!inner(categoria, sede_id, doctora_id, fecha)")
        .eq("cargos.categoria", "procedimiento")
        .gte("cargos.fecha", desde)
        .lte("cargos.fecha", hasta);
      let qSerie = supabase
        .from("cargo_pagos")
        .select("valor, cargos!inner(categoria, sede_id, fecha)")
        .eq("cargos.categoria", "procedimiento")
        .gte("cargos.fecha", desde)
        .lte("cargos.fecha", hasta);
      if (sedeFiltro) {
        qVisitas = qVisitas.eq("sede_id", sedeFiltro);
        qPagos = qPagos.eq("cargos.sede_id", sedeFiltro);
        qSerie = qSerie.eq("cargos.sede_id", sedeFiltro);
      }

      const [{ data: doctorasData }, { data: visitasData }, { data: pagosData }, { data: serieData }] = await Promise.all([
        supabase.from("doctoras").select("id, nombre"),
        qVisitas,
        qPagos,
        qSerie,
      ]);

      const sedeNombre: Record<string, string> = Object.fromEntries(sedes.map((s) => [s.id, s.nombre]));
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

      const porDia: Record<string, number> = {};
      for (const p of (serieData as unknown as { valor: number; cargos: { fecha: string } }[]) ?? []) {
        porDia[p.cargos.fecha] = (porDia[p.cargos.fecha] ?? 0) + Number(p.valor);
      }
      setSerieDiaria(
        Object.entries(porDia)
          .sort((a, b) => (a[0] < b[0] ? -1 : 1))
          .map(([fecha, valor]) => ({ fecha, valor })),
      );

      setCargando(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta, sedeFiltro, sedes.length]);

  useEffect(() => {
    (async () => {
      setCargandoSaldos(true);
      let q = supabase.from("saldos_favor").select("valor_disponible, fecha, sede_origen_id, sedes(nombre), pacientes(nombre)").gt("valor_disponible", 0);
      if (sedeFiltro) q = q.eq("sede_origen_id", sedeFiltro);
      const { data } = await q;
      const saldosFilas =
        (data as unknown as {
          valor_disponible: number;
          fecha: string;
          sede_origen_id: string;
          sedes: { nombre: string } | null;
          pacientes: { nombre: string } | null;
        }[]) ?? [];

      const porSede: Record<string, { sede: string; total: number }> = {};
      for (const s of saldosFilas) {
        porSede[s.sede_origen_id] = porSede[s.sede_origen_id] ?? { sede: s.sedes?.nombre ?? "—", total: 0 };
        porSede[s.sede_origen_id].total += Number(s.valor_disponible);
      }
      setSaldosPorSede(Object.entries(porSede).map(([sedeId, v]) => ({ sedeId, sede: v.sede, total: v.total })));
      setTotalSaldoGeneral(saldosFilas.reduce((a, s) => a + Number(s.valor_disponible), 0));
      setTopSaldos(
        [...saldosFilas]
          .sort((a, b) => b.valor_disponible - a.valor_disponible)
          .slice(0, 15)
          .map((s) => ({ paciente: s.pacientes?.nombre ?? "—", sede: s.sedes?.nombre ?? "—", valor: Number(s.valor_disponible), fecha: s.fecha })),
      );
      setCargandoSaldos(false);
    })();
  }, [sedeFiltro]);

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

  const barrasFacturacion: BarraItem[] = filas
    .map((f) => ({ id: `${f.sedeId}-${f.doctora}`, label: f.doctora, valor: f.total, color: sedeColor[f.sedeId] ?? "#2E253A" }))
    .sort((a, b) => b.valor - a.valor);
  const barrasPacientes: BarraItem[] = filas
    .map((f) => ({ id: `${f.sedeId}-${f.doctora}`, label: f.doctora, valor: f.pacientes, color: sedeColor[f.sedeId] ?? "#2E253A" }))
    .sort((a, b) => b.valor - a.valor);
  const barrasPromedio: BarraItem[] = filas
    .map((f) => ({ id: `${f.sedeId}-${f.doctora}`, label: f.doctora, valor: f.promedio, color: sedeColor[f.sedeId] ?? "#2E253A" }))
    .sort((a, b) => b.valor - a.valor);

  function setPreset(dias: number) {
    const hoy = new Date();
    const inicio = new Date(hoy);
    inicio.setDate(hoy.getDate() - (dias - 1));
    setDesde(inicio.toISOString().slice(0, 10));
    setHasta(hoy.toISOString().slice(0, 10));
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <section className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setSedeFiltro("")}
              className="text-xs font-semibold px-3 py-1.5 rounded-full border-2 transition-colors"
              style={{
                background: sedeFiltro === "" ? "#2E253A" : "transparent",
                borderColor: "#2E253A",
                color: sedeFiltro === "" ? "#ffffff" : "#2E253A",
              }}
            >
              Todas las sedes
            </button>
            {sedes.map((s) => (
              <button
                key={s.id}
                onClick={() => setSedeFiltro(s.id)}
                className="text-xs font-semibold px-3 py-1.5 rounded-full border-2 transition-colors"
                style={{
                  background: sedeFiltro === s.id ? s.color_acento : "transparent",
                  borderColor: s.color_acento,
                  color: sedeFiltro === s.id ? "#ffffff" : s.color_acento,
                }}
              >
                {s.nombre}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button onClick={() => setPreset(7)} className="text-xs font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200">
              7 días
            </button>
            <button onClick={() => setPreset(30)} className="text-xs font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200">
              30 días
            </button>
            <button
              onClick={() => {
                setDesde(inicioDeMes());
                setHasta(today());
              }}
              className="text-xs font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200"
            >
              Este mes
            </button>
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
            <span className="text-xs text-gray-400">a</span>
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
        </div>
      </section>

      {!cargando && (
        <div className="grid grid-cols-3 gap-2">
          <StatTile label="Total facturado" value={fmtCOP(totalGeneralFacturado)} color={sedeFiltro ? sedeColor[sedeFiltro] : "#2E253A"} />
          <StatTile label="Pacientes atendidos" value={`${totalGeneralPacientes}`} color={sedeFiltro ? sedeColor[sedeFiltro] : "#2E253A"} />
          <StatTile
            label="Promedio por paciente"
            value={fmtCOP(totalGeneralPacientes > 0 ? totalGeneralFacturado / totalGeneralPacientes : 0)}
            color={sedeFiltro ? sedeColor[sedeFiltro] : "#2E253A"}
          />
        </div>
      )}

      <section className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold text-tinta mb-1">Facturación por doctora</h2>
        <p className="text-xs text-gray-400 mb-3">
          Solo procedimiento/tratamiento (no RX ni conceptos administrativos); incluye saldo a favor, Addi, Sistecrédito
          y cualquier otro medio.
        </p>
        {cargando ? <p className="text-sm text-gray-400">Cargando…</p> : <BarrasHorizontales datos={barrasFacturacion} formatear={fmtCOP} />}
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold text-tinta mb-3">Pacientes atendidos por doctora</h2>
        {cargando ? (
          <p className="text-sm text-gray-400">Cargando…</p>
        ) : (
          <BarrasHorizontales datos={barrasPacientes} formatear={(n) => `${n}`} />
        )}
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold text-tinta mb-1">Facturación promedio por doctora</h2>
        <p className="text-xs text-gray-400 mb-3">Facturación total de la doctora dividida entre sus pacientes atendidos (ticket promedio).</p>
        {cargando ? <p className="text-sm text-gray-400">Cargando…</p> : <BarrasHorizontales datos={barrasPromedio} formatear={fmtCOP} />}
      </section>

      {!sedeFiltro && sedes.length > 1 && (
        <section className="bg-white rounded-xl border border-gray-200 p-4">
          <h2 className="font-semibold text-tinta mb-3">Peso de cada sede en el consolidado Dentilandia</h2>
          {cargando ? (
            <p className="text-sm text-gray-400">Cargando…</p>
          ) : (
            <BarraApiladaSedes
              segmentos={Object.entries(gruposPorSede).map(([sede, filasSede]) => ({
                id: sede,
                nombre: sede,
                valor: filasSede.reduce((a, f) => a + f.total, 0),
                color: sedeColor[filasSede[0]?.sedeId] ?? "#2E253A",
              }))}
            />
          )}
        </section>
      )}

      <section className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold text-tinta mb-3">Facturación por día</h2>
        {cargando ? (
          <p className="text-sm text-gray-400">Cargando…</p>
        ) : (
          <CalendarioCalor datos={serieDiaria} color={sedeFiltro ? sedeColor[sedeFiltro] ?? "#2E253A" : "#2E253A"} />
        )}
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold text-tinta mb-1">Detalle por sede y doctora</h2>
        <p className="text-xs text-gray-400 mb-3">La tabla que sustenta las gráficas de arriba, con el peso porcentual de cada doctora.</p>
        {cargando ? (
          <p className="text-sm text-gray-400">Cargando…</p>
        ) : filas.length === 0 ? (
          <p className="text-sm text-gray-400">Sin datos en este rango.</p>
        ) : (
          <div className="space-y-3">
            {Object.entries(gruposPorSede).map(([sede, filasSede]) => {
              const totalSede = filasSede.reduce((a, f) => a + f.total, 0);
              const pacientesSede = filasSede.reduce((a, f) => a + f.pacientes, 0);
              const pctSedeDentilandia = totalGeneralFacturado > 0 ? (totalSede / totalGeneralFacturado) * 100 : 0;
              return (
                <div key={sede} className="rounded-lg border border-gray-200 overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 bg-gray-50 text-sm font-semibold flex-wrap gap-2">
                    <span>{sede}</span>
                    <span>
                      {pacientesSede} pacientes · {fmtCOP(totalSede)}
                      {!sedeFiltro && ` · ${pctSedeDentilandia.toFixed(1)}% de Dentilandia`}
                    </span>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {filasSede.map((f) => {
                      const pctSede = totalSede > 0 ? (f.total / totalSede) * 100 : 0;
                      const pctDentilandia = totalGeneralFacturado > 0 ? (f.total / totalGeneralFacturado) * 100 : 0;
                      return (
                        <div key={`${f.sedeId}-${f.doctora}`} className="flex items-center justify-between px-3 py-2 text-sm flex-wrap gap-2">
                          <span className="font-medium">{f.doctora}</span>
                          <div className="flex items-center gap-4 text-gray-500">
                            <span>{f.pacientes} pacientes</span>
                            <span className="text-tinta font-semibold">{fmtCOP(f.total)}</span>
                            <span>prom. {fmtCOP(f.promedio)}</span>
                            <span>
                              {pctSede.toFixed(1)}% de {sede}
                            </span>
                            {!sedeFiltro && <span>{pctDentilandia.toFixed(1)}% de Dentilandia</span>}
                          </div>
                        </div>
                      );
                    })}
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
          clínica, no un ingreso disponible. No depende del rango de fechas de arriba (es el saldo vigente ahora).
        </p>
        {cargandoSaldos ? (
          <p className="text-sm text-gray-400">Cargando…</p>
        ) : (
          <>
            <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-100 text-sm font-semibold mb-3">
              <span>Total pendiente</span>
              <span>{fmtCOP(totalSaldoGeneral)}</span>
            </div>
            {!sedeFiltro && saldosPorSede.length > 0 && (
              <div className="mb-3">
                <BarrasHorizontales
                  datos={saldosPorSede.map((s) => ({ id: s.sedeId, label: s.sede, valor: s.total, color: sedeColor[s.sedeId] ?? "#2E253A" }))}
                  formatear={fmtCOP}
                />
              </div>
            )}
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
