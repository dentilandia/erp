import { useEffect, useMemo, useState } from "react";
import { Download, Check } from "lucide-react";
import { supabase } from "../lib/supabase";
import { fmtCOP, mesActual, periodoCiclo2625, periodoMesCompleto } from "../lib/format";
import type { Doctora, Sede } from "../lib/types";

const CONCEPTOS_SEDACION = [
  "Anticipo sedación intravenosa",
  "Sedación intravenosa",
  "Anticipo sedación óxido nitroso",
  "Sedación óxido nitroso",
];

const TABS = [
  { value: "doctoras", label: "Odontopediatra" },
  { value: "laboratorios", label: "Laboratorios" },
  { value: "sedacion", label: "Sedación" },
] as const;
type Tab = (typeof TABS)[number]["value"];

function descargarCSV(nombre: string, encabezado: string[], filas: (string | number)[][]) {
  const csv = [encabezado.join(","), ...filas.map((f) => f.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}

export function Liquidaciones() {
  const [tab, setTab] = useState<Tab>("doctoras");
  const [mes, setMes] = useState(mesActual());
  const [sedes, setSedes] = useState<Sede[]>([]);
  const [sedeId, setSedeId] = useState("");

  useEffect(() => {
    supabase.from("sedes").select("id, nombre, color_acento").order("nombre").then(({ data }) => setSedes((data as Sede[]) ?? []));
  }, []);

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1 bg-white rounded-lg border border-gray-200 p-1">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium ${
                tab === t.value ? "bg-[var(--acento)] text-white" : "text-gray-500"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          <select value={sedeId} onChange={(e) => setSedeId(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
            <option value="">Todas las sedes</option>
            {sedes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </div>
      </div>

      {tab === "doctoras" && <LiquidacionDoctoras mes={mes} sedeId={sedeId} />}
      {tab === "laboratorios" && <LiquidacionLaboratorios mes={mes} sedeId={sedeId} />}
      {tab === "sedacion" && <LiquidacionSedacion mes={mes} sedeId={sedeId} />}
    </div>
  );
}

// ============================================================
// Odontopediatra (doctoras)
// ============================================================

interface FilaDoctora {
  doctora: Doctora;
  totalVentas: number;
  totalLaboratorios: number;
  retencionTipo: "" | "voluntaria" | "depuracion";
  retencionValor: string;
  guardando: boolean;
  guardado: boolean;
}

function LiquidacionDoctoras({ mes, sedeId }: { mes: string; sedeId: string }) {
  const periodo = useMemo(() => periodoCiclo2625(mes), [mes]);
  const [pctHonorario, setPctHonorario] = useState(30);
  const [filas, setFilas] = useState<FilaDoctora[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    (async () => {
      setCargando(true);
      const { data: precio } = await supabase.from("precios_config").select("valor").eq("clave", "porcentaje_honorario").maybeSingle();
      const pct = precio ? Number(precio.valor) : 30;
      setPctHonorario(pct);

      const { data: doctoras } = await supabase.from("doctoras").select("*").order("nombre");

      let qPagos = supabase
        .from("cargo_pagos")
        .select("valor, cargos!inner(categoria, doctora_id, sede_id, fecha)")
        .eq("cargos.categoria", "procedimiento")
        .gte("cargos.fecha", periodo.inicio)
        .lte("cargos.fecha", periodo.fin);
      if (sedeId) qPagos = qPagos.eq("cargos.sede_id", sedeId);
      const { data: pagosData } = await qPagos;
      const ventasPorDoctora: Record<string, number> = {};
      for (const p of (pagosData as unknown as { valor: number; cargos: { doctora_id: string } }[]) ?? []) {
        ventasPorDoctora[p.cargos.doctora_id] = (ventasPorDoctora[p.cargos.doctora_id] ?? 0) + Number(p.valor);
      }

      let qLabs = supabase
        .from("lab_ordenes")
        .select("doctora_id, doctora_instala_id, tipo_servicio, sede_id, valor_factura, mes_liquidacion, fecha_emision_factura, fecha_recibido")
        .not("valor_factura", "is", null);
      if (sedeId) qLabs = qLabs.eq("sede_id", sedeId);
      const { data: labsData } = await qLabs;
      const labsPorDoctora: Record<string, number> = {};
      for (const l of labsData ?? []) {
        const fechaComparar = l.mes_liquidacion ?? l.fecha_emision_factura ?? l.fecha_recibido;
        if (!fechaComparar || fechaComparar < periodo.inicio || fechaComparar > periodo.fin) continue;
        const valor = Number(l.valor_factura);
        // Fabricación con doctora de instalación distinta a quien tomó la impresión
        // se reparte 50/50; en reparación (o sin doctora_instala_id) va completo a doctora_id.
        if (l.tipo_servicio === "fabricacion" && l.doctora_instala_id && l.doctora_instala_id !== l.doctora_id) {
          labsPorDoctora[l.doctora_id] = (labsPorDoctora[l.doctora_id] ?? 0) + valor / 2;
          labsPorDoctora[l.doctora_instala_id] = (labsPorDoctora[l.doctora_instala_id] ?? 0) + valor / 2;
        } else {
          labsPorDoctora[l.doctora_id] = (labsPorDoctora[l.doctora_id] ?? 0) + valor;
        }
      }

      const nuevasFilas: FilaDoctora[] = ((doctoras as Doctora[]) ?? [])
        .filter((d) => (ventasPorDoctora[d.id] ?? 0) > 0 || (labsPorDoctora[d.id] ?? 0) > 0)
        .map((d) => {
          const totalVentas = ventasPorDoctora[d.id] ?? 0;
          const bruto = totalVentas * (pct / 100);
          const retencionAuto = d.retencion_voluntaria_activa ? bruto * (Number(d.retencion_voluntaria_pct) / 100) : 0;
          return {
            doctora: d,
            totalVentas,
            totalLaboratorios: labsPorDoctora[d.id] ?? 0,
            retencionTipo: d.retencion_voluntaria_activa ? "voluntaria" : "",
            retencionValor: retencionAuto ? String(Math.round(retencionAuto)) : "",
            guardando: false,
            guardado: false,
          };
        });
      setFilas(nuevasFilas);
      setCargando(false);
    })();
  }, [periodo.inicio, periodo.fin, sedeId]);

  function actualizarFila(idx: number, cambios: Partial<FilaDoctora>) {
    setFilas((prev) => prev.map((f, i) => (i === idx ? { ...f, ...cambios } : f)));
  }

  async function guardarFila(idx: number) {
    const f = filas[idx];
    const bruto = f.totalVentas * (pctHonorario / 100);
    const retencion = Number(f.retencionValor) || 0;
    const totalPago = bruto - f.totalLaboratorios - retencion;
    actualizarFila(idx, { guardando: true });
    const { data, error } = await supabase
      .from("liquidaciones_doctora")
      .upsert(
        {
          doctora_id: f.doctora.id,
          periodo_inicio: periodo.inicio,
          periodo_fin: periodo.fin,
          total_ventas: f.totalVentas,
          porcentaje: pctHonorario,
          valor_bruto: bruto,
          total_laboratorios: f.totalLaboratorios,
          total_pago: totalPago,
          retencion_valor: retencion || null,
          retencion_tipo: retencion > 0 ? f.retencionTipo || "depuracion" : null,
          ibc: bruto,
          estado: retencion > 0 ? "retencion_asignada" : "calculada",
        },
        { onConflict: "doctora_id,periodo_inicio,periodo_fin" },
      )
      .select("id")
      .single();
    if (!error && data && retencion > 0) {
      await supabase.from("retenciones_historial").insert({
        liquidacion_id: data.id,
        valor: retencion,
        tipo: f.retencionTipo || "depuracion",
      });
    }
    actualizarFila(idx, { guardando: false, guardado: true });
    setTimeout(() => actualizarFila(idx, { guardado: false }), 1500);
  }

  if (cargando) return <p className="text-sm text-gray-400">Cargando…</p>;

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">
        Período {periodo.inicio} a {periodo.fin}. Solo cuenta lo efectivamente cobrado (incluye pagos con saldo a
        favor, no la creación de estos). IBC = valor bruto — confírmame si debe ser otro cálculo.
      </p>
      {filas.map((f, idx) => {
        const bruto = f.totalVentas * (pctHonorario / 100);
        const retencion = Number(f.retencionValor) || 0;
        const totalPago = bruto - f.totalLaboratorios - retencion;
        return (
          <div key={f.doctora.id} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-3 h-3 rounded-full shrink-0" style={{ background: f.doctora.color_pastel }} />
              <span className="font-semibold text-tinta">{f.doctora.nombre}</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-3">
              <div>
                <p className="text-xs text-gray-400">Total ventas</p>
                <p className="font-medium">{fmtCOP(f.totalVentas)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">% honorario</p>
                <p className="font-medium">{pctHonorario}%</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Valor bruto</p>
                <p className="font-medium">{fmtCOP(bruto)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Laboratorios</p>
                <p className="font-medium">{fmtCOP(f.totalLaboratorios)}</p>
              </div>
            </div>
            <div className="flex items-end gap-2 flex-wrap mb-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Retención</label>
                <select
                  value={f.retencionTipo}
                  onChange={(e) => actualizarFila(idx, { retencionTipo: e.target.value as FilaDoctora["retencionTipo"] })}
                  className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                >
                  <option value="">Ninguna</option>
                  <option value="voluntaria">Voluntaria</option>
                  <option value="depuracion">Depuración</option>
                </select>
              </div>
              <input
                type="number"
                value={f.retencionValor}
                onChange={(e) => actualizarFila(idx, { retencionValor: e.target.value })}
                placeholder="Valor retención"
                className="w-32 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              />
              <div className="ml-auto text-right">
                <p className="text-xs text-gray-400">Total a pagar</p>
                <p className="font-semibold text-lg">{fmtCOP(totalPago)}</p>
              </div>
            </div>
            <button
              onClick={() => guardarFila(idx)}
              disabled={f.guardando}
              className="flex items-center gap-2 rounded-lg bg-[var(--acento)] text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
            >
              {f.guardado ? <Check size={16} /> : null}
              {f.guardando ? "Guardando…" : f.guardado ? "Guardado" : "Guardar liquidación"}
            </button>
          </div>
        );
      })}
      {filas.length === 0 && <p className="text-sm text-gray-400">Sin ventas de procedimientos en este período.</p>}
    </div>
  );
}

// ============================================================
// Laboratorios
// ============================================================

interface FilaLab {
  id: string;
  fecha: string | null;
  paciente: string;
  doctora: string;
  doctoraInstala: string | null;
  laboratorio: string;
  tipo_servicio: string;
  factura_numero: string | null;
  valor_factura: number;
}

function LiquidacionLaboratorios({ mes, sedeId }: { mes: string; sedeId: string }) {
  const periodo = useMemo(() => periodoCiclo2625(mes), [mes]);
  const [filas, setFilas] = useState<FilaLab[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    (async () => {
      setCargando(true);
      let q = supabase
        .from("lab_ordenes")
        .select(
          "id, sede_id, mes_liquidacion, fecha_emision_factura, fecha_recibido, valor_factura, factura_numero, tipo_servicio, pacientes(nombre), doctoras!lab_ordenes_doctora_id_fkey(nombre), doctora_instala:doctoras!lab_ordenes_doctora_instala_id_fkey(nombre), laboratorios(nombre)",
        )
        .not("valor_factura", "is", null);
      if (sedeId) q = q.eq("sede_id", sedeId);
      const { data } = await q;
      const filtradas = ((data as unknown as {
        id: string; mes_liquidacion: string | null; fecha_emision_factura: string | null; fecha_recibido: string | null; valor_factura: number;
        factura_numero: string | null; tipo_servicio: string;
        pacientes: { nombre: string } | null; doctoras: { nombre: string } | null; doctora_instala: { nombre: string } | null; laboratorios: { nombre: string } | null;
      }[]) ?? []).filter((r) => {
        const f = r.mes_liquidacion ?? r.fecha_emision_factura ?? r.fecha_recibido;
        return f && f >= periodo.inicio && f <= periodo.fin;
      });
      setFilas(
        filtradas.map((r) => ({
          id: r.id,
          fecha: r.mes_liquidacion ?? r.fecha_emision_factura ?? r.fecha_recibido,
          paciente: r.pacientes?.nombre ?? "—",
          doctora: r.doctoras?.nombre ?? "—",
          doctoraInstala: r.doctora_instala?.nombre ?? null,
          laboratorio: r.laboratorios?.nombre ?? "—",
          tipo_servicio: r.tipo_servicio,
          factura_numero: r.factura_numero,
          valor_factura: Number(r.valor_factura),
        })),
      );
      setCargando(false);
    })();
  }, [periodo.inicio, periodo.fin, sedeId]);

  const totalesPorLab = useMemo(() => {
    const t: Record<string, number> = {};
    for (const f of filas) t[f.laboratorio] = (t[f.laboratorio] ?? 0) + f.valor_factura;
    return t;
  }, [filas]);

  const total = filas.reduce((a, f) => a + f.valor_factura, 0);

  function exportar() {
    descargarCSV(
      `liquidacion-laboratorios-${mes}.csv`,
      ["Fecha", "Paciente", "Doctora", "Doctora instala (50/50)", "Laboratorio", "Tipo servicio", "Factura", "Valor"],
      filas.map((f) => [
        f.fecha ?? "",
        f.paciente,
        f.doctora,
        f.doctoraInstala ?? "",
        f.laboratorio,
        f.tipo_servicio,
        f.factura_numero ?? "",
        f.valor_factura,
      ]),
    );
  }

  if (cargando) return <p className="text-sm text-gray-400">Cargando…</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">Período {periodo.inicio} a {periodo.fin}.</p>
        <button onClick={exportar} className="flex items-center gap-2 text-sm font-medium text-[var(--acento)]">
          <Download size={16} /> Exportar
        </button>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-gray-500">
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Paciente</th>
              <th className="px-3 py-2">Doctora</th>
              <th className="px-3 py-2">Laboratorio</th>
              <th className="px-3 py-2">Servicio</th>
              <th className="px-3 py-2">Factura</th>
              <th className="px-3 py-2 text-right">Valor</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.id} className="border-t border-gray-100">
                <td className="px-3 py-2">{f.fecha}</td>
                <td className="px-3 py-2">{f.paciente}</td>
                <td className="px-3 py-2">
                  {f.doctora}
                  {f.doctoraInstala && <span className="text-gray-400"> + {f.doctoraInstala} (50/50)</span>}
                </td>
                <td className="px-3 py-2">{f.laboratorio}</td>
                <td className="px-3 py-2">{f.tipo_servicio}</td>
                <td className="px-3 py-2">{f.factura_numero ?? "—"}</td>
                <td className="px-3 py-2 text-right">{fmtCOP(f.valor_factura)}</td>
              </tr>
            ))}
            {filas.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-gray-400">
                  Sin facturas de laboratorio en este período.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {Object.keys(totalesPorLab).length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-1 text-sm">
          {Object.entries(totalesPorLab).map(([lab, val]) => (
            <div key={lab} className="flex items-center justify-between">
              <span className="text-gray-500">{lab}</span>
              <span className="font-medium">{fmtCOP(val)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between pt-2 mt-2 border-t border-gray-100 font-semibold">
            <span>Total</span>
            <span>{fmtCOP(total)}</span>
          </div>
        </div>
      )}
      <p className="text-xs text-gray-400">
        Formato provisional — lo ajustamos apenas confirmes cómo se ve la planilla que ya manejan con los laboratorios.
      </p>
    </div>
  );
}

// ============================================================
// Sedación
// ============================================================

interface FilaSedacion {
  id: string;
  fecha: string;
  paciente: string;
  doctora: string;
  concepto: string;
  medio: string;
  valor: number;
}

function LiquidacionSedacion({ mes, sedeId }: { mes: string; sedeId: string }) {
  const periodo = useMemo(() => periodoMesCompleto(mes), [mes]);
  const [filas, setFilas] = useState<FilaSedacion[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    (async () => {
      setCargando(true);
      let q = supabase
        .from("cargo_pagos")
        .select(
          "id, medio_pago, valor, cargos!inner(concepto, fecha, sede_id, doctoras(nombre), visitas(pacientes(nombre)))",
        )
        .in("cargos.concepto", CONCEPTOS_SEDACION)
        .gte("cargos.fecha", periodo.inicio)
        .lte("cargos.fecha", periodo.fin);
      if (sedeId) q = q.eq("cargos.sede_id", sedeId);
      const { data } = await q;
      setFilas(
        ((data as unknown as {
          id: string; medio_pago: string; valor: number;
          cargos: { concepto: string; fecha: string; doctoras: { nombre: string } | null; visitas: { pacientes: { nombre: string } | null } | null };
        }[]) ?? []).map((r) => ({
          id: r.id,
          fecha: r.cargos.fecha,
          paciente: r.cargos.visitas?.pacientes?.nombre ?? "—",
          doctora: r.cargos.doctoras?.nombre ?? "—",
          concepto: r.cargos.concepto,
          medio: r.medio_pago,
          valor: Number(r.valor),
        })),
      );
      setCargando(false);
    })();
  }, [periodo.inicio, periodo.fin, sedeId]);

  const total = filas.reduce((a, f) => a + f.valor, 0);

  function exportar() {
    descargarCSV(
      `liquidacion-sedacion-${mes}.csv`,
      ["Fecha", "Paciente", "Doctora", "Concepto", "Medio de pago", "Valor"],
      filas.map((f) => [f.fecha, f.paciente, f.doctora, f.concepto, f.medio, f.valor]),
    );
  }

  if (cargando) return <p className="text-sm text-gray-400">Cargando…</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">Mes completo: {periodo.inicio} a {periodo.fin}.</p>
        <button onClick={exportar} className="flex items-center gap-2 text-sm font-medium text-[var(--acento)]">
          <Download size={16} /> Exportar
        </button>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {filas.map((f) => (
          <div key={f.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
            <span>
              {f.paciente} <span className="text-gray-400">· {f.fecha} · {f.concepto} · {f.doctora}</span>
            </span>
            <span className="flex items-center gap-3">
              <span className="text-xs text-gray-400">{f.medio}</span>
              <span className="font-semibold">{fmtCOP(f.valor)}</span>
            </span>
          </div>
        ))}
        {filas.length === 0 && <p className="px-4 py-4 text-sm text-gray-400">Sin sedaciones/anticipos en este período.</p>}
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between text-sm font-semibold">
        <span>Total</span>
        <span>{fmtCOP(total)}</span>
      </div>
      <p className="text-xs text-gray-400">
        Columnas provisionales (paciente, fecha, concepto, doctora, medio de pago, valor) — dime las columnas
        exactas de la planilla que ya usan y la ajusto.
      </p>
    </div>
  );
}
