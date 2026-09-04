import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { fmtCOP, today } from "../../lib/format";
import { TIPOS_INSUMO_CONSULTA, MEDIOS_PAGO, type Sede, type Doctora } from "../../lib/types";
import { CalendarioCalor } from "../../components/CalendarioCalor";
import { StatTile } from "../../components/StatTile";

const MEDIO_PAGO_LABEL: Record<string, string> = Object.fromEntries(MEDIOS_PAGO.map((m) => [m.value, m.label]));

// Un color distinto por medio de pago, para diferenciarlos de un vistazo en
// Historial sin tener que leer la etiqueta de cada badge.
const MEDIO_PAGO_COLOR: Record<string, string> = {
  efectivo: "bg-emerald-50 text-emerald-700",
  tarjeta_debito: "bg-blue-50 text-blue-700",
  tarjeta_credito: "bg-indigo-50 text-indigo-700",
  transferencia_debito: "bg-cyan-50 text-cyan-700",
  addi: "bg-pink-50 text-pink-700",
  sistecredito: "bg-orange-50 text-orange-700",
  saldo_favor: "bg-violet-50 text-violet-700",
};

interface VisitaRow {
  id: string;
  fecha: string;
  estado: string;
  tratamiento: string | null;
  doctora_id: string;
  cobrado_por: string | null;
  remision_especialidad: string | null;
  proxima_cita: string | null;
  observacion: string | null;
  pacientes: { nombre: string };
  doctoras: { nombre: string; color_pastel: string };
  perfiles: { nombre: string } | null;
  cargos: { categoria: string; valor: number; cargo_pagos: { valor: number; medio_pago: string }[] }[];
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
  const [medioPagoFiltro, setMedioPagoFiltro] = useState("");
  const [valorFiltro, setValorFiltro] = useState("");
  const [cajeraFiltro, setCajeraFiltro] = useState("");
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
          `id, fecha, estado, tratamiento, doctora_id, cobrado_por, remision_especialidad, proxima_cita, observacion, ${pacientesSelect}, doctoras(nombre, color_pastel), perfiles(nombre), cargos(categoria, valor, cargo_pagos(valor, medio_pago)), ${insumosSelect}`,
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

  // Medio de pago por visita, calculado una sola vez y reusado tanto para
  // filtrar (buscar descuadres por medio específico) como para pintar los
  // badges de cada fila.
  const visitasConMedios = useMemo(
    () =>
      visitas.map((v) => {
        const porMedio: Record<string, number> = {};
        for (const c of v.cargos) {
          for (const p of c.cargo_pagos) {
            porMedio[p.medio_pago] = (porMedio[p.medio_pago] ?? 0) + Number(p.valor);
          }
        }
        const totalCargos = v.cargos.reduce((a, c) => a + Number(c.valor), 0);
        const totalPagado = Object.values(porMedio).reduce((a, x) => a + x, 0);
        return { ...v, porMedio, totalCargos, totalPagado };
      }),
    [visitas],
  );
  // Quién cobró cada visita — para poder cruzar exactamente lo mismo que se
  // ve en el resumen "Cierre por persona" de Cierre Diario y encontrar la
  // visita puntual detrás de un total.
  const cajeras = useMemo(() => {
    const map = new Map<string, string>();
    for (const v of visitas) if (v.cobrado_por) map.set(v.cobrado_por, v.perfiles?.nombre ?? "—");
    return Array.from(map.entries())
      .map(([id, nombre]) => ({ id, nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [visitas]);

  const visitasFiltradas = useMemo(() => {
    let filas = visitasConMedios;
    if (medioPagoFiltro) filas = filas.filter((v) => medioPagoFiltro in v.porMedio);
    if (cajeraFiltro) filas = filas.filter((v) => v.cobrado_por === cajeraFiltro);
    const valorNum = Math.round(Number(valorFiltro));
    if (valorFiltro.trim() && valorNum > 0) {
      filas = filas.filter(
        (v) => Math.round(v.totalCargos) === valorNum || Object.values(v.porMedio).some((x) => Math.round(x) === valorNum),
      );
    }
    return filas;
  }, [visitasConMedios, medioPagoFiltro, valorFiltro, cajeraFiltro]);

  // Facturación por día para control de honorarios: solo procedimiento/tratamiento
  // (no RX ni conceptos administrativos), sin importar el medio de pago —
  // incluye lo pagado con saldo a favor, porque ya es venta hecha de la doctora.
  const resumenHonorarios = useMemo(() => {
    if (!doctoraId) return [];
    const porFecha: Record<string, number> = {};
    for (const v of visitas) {
      const totalProcedimiento = v.cargos.filter((c) => c.categoria === "procedimiento").reduce((a, c) => a + Number(c.valor), 0);
      if (totalProcedimiento > 0) porFecha[v.fecha] = (porFecha[v.fecha] ?? 0) + totalProcedimiento;
    }
    return Object.entries(porFecha).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [visitas, doctoraId]);
  const totalHonorarios = resumenHonorarios.reduce((a, [, v]) => a + v, 0);
  const calorDatos = [...resumenHonorarios].reverse().map(([fecha, valor]) => ({ fecha, valor }));

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
        <select
          value={medioPagoFiltro}
          onChange={(e) => setMedioPagoFiltro(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">Cualquier medio de pago</option>
          {MEDIOS_PAGO.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <input
          type="number"
          value={valorFiltro}
          onChange={(e) => setValorFiltro(e.target.value)}
          placeholder="Buscar por valor, ej. 136000"
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm w-44"
        />
        {cajeras.length > 0 && (
          <select
            value={cajeraFiltro}
            onChange={(e) => setCajeraFiltro(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">Cualquier cajera</option>
            {cajeras.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        )}
      </div>

      {doctoraId && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="font-semibold text-tinta mb-1">
            Facturación por día — {doctoras.find((d) => d.id === doctoraId)?.nombre}
          </h3>
          <p className="text-xs text-gray-400 mb-3">
            Solo procedimiento/tratamiento (no RX ni conceptos administrativos), incluye lo pagado con saldo a favor —
            para el control de honorarios.
          </p>
          {resumenHonorarios.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mb-4">
              <StatTile label="Total del rango" value={fmtCOP(totalHonorarios)} color={sedeActiva.color_acento} />
              <StatTile label="Días con facturación" value={`${resumenHonorarios.length}`} color={sedeActiva.color_acento} />
              <StatTile label="Promedio por día" value={fmtCOP(totalHonorarios / resumenHonorarios.length)} color={sedeActiva.color_acento} />
            </div>
          )}
          {resumenHonorarios.length > 0 && (
            <div className="mb-3">
              <CalendarioCalor datos={calorDatos} color={sedeActiva.color_acento} />
            </div>
          )}
          <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">
            {resumenHonorarios.map(([fecha, total]) => (
              <div key={fecha} className="flex items-center justify-between px-3 py-2 text-sm">
                <span>{fecha}</span>
                <span className="font-medium">{fmtCOP(total)}</span>
              </div>
            ))}
            {resumenHonorarios.length === 0 && <p className="px-3 py-3 text-sm text-gray-400">Sin facturación en este rango.</p>}
            {resumenHonorarios.length > 0 && (
              <div className="flex items-center justify-between px-3 py-2 text-sm font-semibold bg-gray-50">
                <span>Total del rango</span>
                <span>{fmtCOP(totalHonorarios)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {visitasFiltradas.map((v) => {
          const { porMedio, totalCargos, totalPagado } = v;
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
                {v.proxima_cita && (
                  <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                    Próxima cita: {v.proxima_cita}
                  </span>
                )}
                {v.observacion && (
                  <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                    Obs: {v.observacion}
                  </span>
                )}
                {v.insumos_consulta?.map((i, idx) => (
                  <span key={idx} className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                    {TIPOS_INSUMO_CONSULTA.find((t) => t.value === i.tipo)?.label ?? i.tipo}
                  </span>
                ))}
                {Object.entries(porMedio).map(([medio, valor]) => (
                  <span
                    key={medio}
                    className={`ml-2 text-xs font-medium px-2 py-0.5 rounded-full ${MEDIO_PAGO_COLOR[medio] ?? "bg-gray-100 text-gray-600"}`}
                  >
                    {MEDIO_PAGO_LABEL[medio] ?? medio}: {fmtCOP(valor)}
                  </span>
                ))}
                {Object.keys(porMedio).length === 0 && v.estado === "cobrado" && (
                  <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                    Sin pago registrado
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {v.perfiles?.nombre && (
                  <span className="text-xs text-gray-400">{v.perfiles.nombre}</span>
                )}
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
        {visitasFiltradas.length === 0 && <p className="px-4 py-4 text-sm text-gray-400">Sin visitas en este rango.</p>}
      </div>
    </div>
  );
}
