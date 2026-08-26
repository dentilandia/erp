import { useEffect, useMemo, useState } from "react";
import { Download, Check } from "lucide-react";
import { supabase } from "../lib/supabase";
import { fmtCOP, mesActual, periodoCiclo2625, periodoMesCompleto } from "../lib/format";
import { TIPOS_INSUMO_CONSULTA, type Doctora, type Sede } from "../lib/types";

const TIPOS_INSUMO_LABEL: Record<string, string> = Object.fromEntries(TIPOS_INSUMO_CONSULTA.map((t) => [t.value, t.label]));

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

      {tab === "doctoras" && <LiquidacionDoctoras mes={mes} sedeId={sedeId} sedes={sedes} />}
      {tab === "laboratorios" && <LiquidacionLaboratorios mes={mes} sedeId={sedeId} />}
      {tab === "sedacion" && <LiquidacionSedacion mes={mes} sedeId={sedeId} />}
    </div>
  );
}

// ============================================================
// Odontopediatra (doctoras)
// ============================================================

interface FilaDoctoraSede {
  sedeId: string;
  sedeNombre: string;
  ventas: number;
  labs: number;
  insumos: number;
}

interface DetalleLab {
  fecha: string | null;
  sedeNombre: string;
  paciente: string;
  laboratorio: string;
  facturaNumero: string | null;
  valor: number;
  nota: string | null;
}

interface DetalleInsumo {
  fecha: string;
  sedeNombre: string;
  paciente: string;
  tipo: string;
  valor: number;
}

interface FilaDoctora {
  doctora: Doctora;
  totalVentas: number;
  totalLaboratorios: number;
  totalInsumos: number;
  porSede: FilaDoctoraSede[];
  detalleLabs: DetalleLab[];
  detalleInsumos: DetalleInsumo[];
  retencionValor: string;
  retencionDepuracionValor: string;
  guardando: boolean;
  guardado: boolean;
  detalleAbierto: boolean;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Abre una ventana de impresión con el respaldo — la doctora/admin le da "Guardar como PDF" desde el diálogo de impresión. */
function exportarDetalleDoctora(periodo: { inicio: string; fin: string }, f: FilaDoctora) {
  const totalLabs = f.detalleLabs.reduce((a, d) => a + d.valor, 0);
  const totalOtros = f.detalleInsumos.reduce((a, d) => a + d.valor, 0);
  const filasLabs = f.detalleLabs
    .map(
      (d) =>
        `<tr><td>${esc(d.fecha ?? "—")}</td><td>${esc(d.sedeNombre)}</td><td>${esc(d.paciente)}</td><td>${esc(d.laboratorio)}${
          d.nota ? ` <span class="nota">(${esc(d.nota)})</span>` : ""
        }</td><td>${esc(d.facturaNumero ?? "—")}</td><td class="num">${esc(fmtCOP(d.valor))}</td></tr>`,
    )
    .join("");
  const filasOtros = f.detalleInsumos
    .map(
      (d) =>
        `<tr><td>${esc(d.fecha)}</td><td>${esc(d.sedeNombre)}</td><td>${esc(d.paciente)}</td><td>${esc(d.tipo)}</td><td class="num">${esc(fmtCOP(d.valor))}</td></tr>`,
    )
    .join("");
  const html = `<!doctype html>
<html><head><meta charset="utf-8" />
<title>Respaldo liquidación - ${esc(f.doctora.nombre)}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #2E253A; padding: 24px; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  p.periodo { color: #666; font-size: 12px; margin: 0 0 22px; }
  h2 { font-size: 14px; margin: 22px 0 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { border: 1px solid #ddd; padding: 5px 7px; text-align: left; }
  th { background: #f5f5f5; }
  .num { text-align: right; }
  .nota { color: #888; }
  tfoot td { font-weight: 600; background: #fafafa; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <h1>Respaldo de liquidación — ${esc(f.doctora.nombre)}</h1>
  <p class="periodo">Período ${periodo.inicio} a ${periodo.fin}</p>

  <h2>Laboratorios (aparatos)</h2>
  <table>
    <thead><tr><th>Fecha</th><th>Sede</th><th>Paciente</th><th>Laboratorio</th><th>Factura</th><th class="num">Valor</th></tr></thead>
    <tbody>${filasLabs || `<tr><td colspan="6">Sin laboratorios en este período.</td></tr>`}</tbody>
    <tfoot><tr><td colspan="5">Total laboratorios</td><td class="num">${esc(fmtCOP(totalLabs))}</td></tr></tfoot>
  </table>

  <h2>Otros aparatología</h2>
  <table>
    <thead><tr><th>Fecha</th><th>Sede</th><th>Paciente</th><th>Insumo</th><th class="num">Valor</th></tr></thead>
    <tbody>${filasOtros || `<tr><td colspan="5">Sin otros aparatología en este período.</td></tr>`}</tbody>
    <tfoot><tr><td colspan="4">Total otros aparatología</td><td class="num">${esc(fmtCOP(totalOtros))}</td></tr></tfoot>
  </table>
</body></html>`;
  const ventana = window.open("", "_blank");
  if (!ventana) {
    window.alert("El navegador bloqueó la ventana de impresión — permite ventanas emergentes para este sitio e inténtalo de nuevo.");
    return;
  }
  ventana.document.write(html);
  ventana.document.close();
  ventana.focus();
  ventana.onload = () => ventana.print();
}

function LiquidacionDoctoras({ mes, sedeId, sedes }: { mes: string; sedeId: string; sedes: Sede[] }) {
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
      const sedeNombre: Record<string, string> = Object.fromEntries(sedes.map((s) => [s.id, s.nombre]));

      let qPagos = supabase
        .from("cargo_pagos")
        .select("valor, cargos!inner(categoria, doctora_id, sede_id, fecha)")
        .eq("cargos.categoria", "procedimiento")
        .gte("cargos.fecha", periodo.inicio)
        .lte("cargos.fecha", periodo.fin);
      if (sedeId) qPagos = qPagos.eq("cargos.sede_id", sedeId);
      const { data: pagosData } = await qPagos;
      const ventasPorDoctora: Record<string, number> = {};
      const ventasPorDoctoraSede: Record<string, Record<string, number>> = {};
      for (const p of (pagosData as unknown as { valor: number; cargos: { doctora_id: string; sede_id: string } }[]) ?? []) {
        const { doctora_id, sede_id } = p.cargos;
        ventasPorDoctora[doctora_id] = (ventasPorDoctora[doctora_id] ?? 0) + Number(p.valor);
        ventasPorDoctoraSede[doctora_id] = ventasPorDoctoraSede[doctora_id] ?? {};
        ventasPorDoctoraSede[doctora_id][sede_id] = (ventasPorDoctoraSede[doctora_id][sede_id] ?? 0) + Number(p.valor);
      }

      let qLabs = supabase
        .from("lab_ordenes")
        .select(
          "doctora_id, doctora_instala_id, tipo_servicio, sede_id, valor_factura, mes_liquidacion, fecha_emision_factura, fecha_recibido, factura_numero, pacientes(nombre), laboratorios(nombre)",
        )
        .not("valor_factura", "is", null);
      if (sedeId) qLabs = qLabs.eq("sede_id", sedeId);
      const { data: labsData } = await qLabs;
      const labsPorDoctora: Record<string, number> = {};
      const labsPorDoctoraSede: Record<string, Record<string, number>> = {};
      const detalleLabsPorDoctora: Record<string, DetalleLab[]> = {};
      const sumarLab = (doctoraId: string, sedeIdItem: string, valor: number) => {
        labsPorDoctora[doctoraId] = (labsPorDoctora[doctoraId] ?? 0) + valor;
        labsPorDoctoraSede[doctoraId] = labsPorDoctoraSede[doctoraId] ?? {};
        labsPorDoctoraSede[doctoraId][sedeIdItem] = (labsPorDoctoraSede[doctoraId][sedeIdItem] ?? 0) + valor;
      };
      const agregarDetalleLab = (doctoraId: string, det: DetalleLab) => {
        detalleLabsPorDoctora[doctoraId] = detalleLabsPorDoctora[doctoraId] ?? [];
        detalleLabsPorDoctora[doctoraId].push(det);
      };
      for (const l of (labsData as unknown as {
        doctora_id: string; doctora_instala_id: string | null; tipo_servicio: string; sede_id: string; valor_factura: number;
        mes_liquidacion: string | null; fecha_emision_factura: string | null; fecha_recibido: string | null; factura_numero: string | null;
        pacientes: { nombre: string } | null; laboratorios: { nombre: string } | null;
      }[]) ?? []) {
        const fechaComparar = l.mes_liquidacion ?? l.fecha_emision_factura ?? l.fecha_recibido;
        if (!fechaComparar || fechaComparar < periodo.inicio || fechaComparar > periodo.fin) continue;
        const valor = Number(l.valor_factura);
        const sedeNom = sedeNombre[l.sede_id] ?? "—";
        const paciente = l.pacientes?.nombre ?? "—";
        const laboratorio = l.laboratorios?.nombre ?? "—";
        // Fabricación con doctora de instalación distinta a quien tomó la impresión
        // se reparte 50/50; en reparación (o sin doctora_instala_id) va completo a doctora_id.
        if (l.tipo_servicio === "fabricacion" && l.doctora_instala_id && l.doctora_instala_id !== l.doctora_id) {
          sumarLab(l.doctora_id, l.sede_id, valor / 2);
          sumarLab(l.doctora_instala_id, l.sede_id, valor / 2);
          agregarDetalleLab(l.doctora_id, {
            fecha: fechaComparar, sedeNombre: sedeNom, paciente, laboratorio, facturaNumero: l.factura_numero,
            valor: valor / 2, nota: "50/50 con doctora que instaló",
          });
          agregarDetalleLab(l.doctora_instala_id, {
            fecha: fechaComparar, sedeNombre: sedeNom, paciente, laboratorio, facturaNumero: l.factura_numero,
            valor: valor / 2, nota: "50/50 con doctora que tomó la impresión",
          });
        } else {
          sumarLab(l.doctora_id, l.sede_id, valor);
          agregarDetalleLab(l.doctora_id, {
            fecha: fechaComparar, sedeNombre: sedeNom, paciente, laboratorio, facturaNumero: l.factura_numero,
            valor, nota: null,
          });
        }
      }

      // Insumos de aparatología (elásticos intraoral, tracción extra oral, máscara
      // facial) también los paga la doctora al mismo % que su honorario, igual que
      // los laboratorios — se suman a la misma base antes de aplicar el %.
      let qInsumos = supabase
        .from("insumos_consulta")
        .select("valor_costo, tipo, visitas!inner(doctora_id, sede_id, fecha, pacientes(nombre))")
        .gte("visitas.fecha", periodo.inicio)
        .lte("visitas.fecha", periodo.fin);
      if (sedeId) qInsumos = qInsumos.eq("visitas.sede_id", sedeId);
      const { data: insumosData } = await qInsumos;
      const insumosPorDoctora: Record<string, number> = {};
      const insumosPorDoctoraSede: Record<string, Record<string, number>> = {};
      const detalleInsumosPorDoctora: Record<string, DetalleInsumo[]> = {};
      for (const i of (insumosData as unknown as {
        valor_costo: number; tipo: string;
        visitas: { doctora_id: string; sede_id: string; fecha: string; pacientes: { nombre: string } | null };
      }[]) ?? []) {
        const { doctora_id, sede_id, fecha, pacientes } = i.visitas;
        const valor = Number(i.valor_costo);
        insumosPorDoctora[doctora_id] = (insumosPorDoctora[doctora_id] ?? 0) + valor;
        insumosPorDoctoraSede[doctora_id] = insumosPorDoctoraSede[doctora_id] ?? {};
        insumosPorDoctoraSede[doctora_id][sede_id] = (insumosPorDoctoraSede[doctora_id][sede_id] ?? 0) + valor;
        detalleInsumosPorDoctora[doctora_id] = detalleInsumosPorDoctora[doctora_id] ?? [];
        detalleInsumosPorDoctora[doctora_id].push({
          fecha,
          sedeNombre: sedeNombre[sede_id] ?? "—",
          paciente: pacientes?.nombre ?? "—",
          tipo: TIPOS_INSUMO_LABEL[i.tipo] ?? i.tipo,
          valor,
        });
      }

      // Si el período ya se había liquidado antes (ej. la doctora entregó la
      // depuración de renta después de guardar), recuperamos lo guardado en vez
      // de recalcular desde cero, para no perder ediciones manuales previas.
      const { data: guardadasData } = await supabase
        .from("liquidaciones_doctora")
        .select("doctora_id, retencion_valor, retencion_depuracion_valor")
        .eq("periodo_inicio", periodo.inicio)
        .eq("periodo_fin", periodo.fin);
      const guardadaPorDoctora: Record<string, { retencionValor: number | null; retencionDepuracion: number }> = {};
      for (const g of (guardadasData as { doctora_id: string; retencion_valor: number | null; retencion_depuracion_valor: number }[]) ?? []) {
        guardadaPorDoctora[g.doctora_id] = {
          retencionValor: g.retencion_valor,
          retencionDepuracion: Number(g.retencion_depuracion_valor ?? 0),
        };
      }

      const nuevasFilas: FilaDoctora[] = ((doctoras as Doctora[]) ?? [])
        .filter((d) => (ventasPorDoctora[d.id] ?? 0) > 0 || (labsPorDoctora[d.id] ?? 0) > 0 || (insumosPorDoctora[d.id] ?? 0) > 0)
        .map((d) => {
          const totalVentas = ventasPorDoctora[d.id] ?? 0;
          const totalLaboratorios = labsPorDoctora[d.id] ?? 0;
          const totalInsumos = insumosPorDoctora[d.id] ?? 0;
          const bruto = totalVentas * (pct / 100);
          const retencionAuto = d.retencion_voluntaria_activa ? bruto * (Number(d.retencion_voluntaria_pct) / 100) : 0;
          const guardada = guardadaPorDoctora[d.id];
          const retencionVoluntariaValor = guardada?.retencionValor != null ? Number(guardada.retencionValor) : retencionAuto;
          const sedeIds = new Set([
            ...Object.keys(ventasPorDoctoraSede[d.id] ?? {}),
            ...Object.keys(labsPorDoctoraSede[d.id] ?? {}),
            ...Object.keys(insumosPorDoctoraSede[d.id] ?? {}),
          ]);
          const porSede: FilaDoctoraSede[] = Array.from(sedeIds).map((sid) => ({
            sedeId: sid,
            sedeNombre: sedeNombre[sid] ?? "—",
            ventas: ventasPorDoctoraSede[d.id]?.[sid] ?? 0,
            labs: labsPorDoctoraSede[d.id]?.[sid] ?? 0,
            insumos: insumosPorDoctoraSede[d.id]?.[sid] ?? 0,
          }));
          return {
            doctora: d,
            totalVentas,
            totalLaboratorios,
            totalInsumos,
            porSede,
            detalleLabs: detalleLabsPorDoctora[d.id] ?? [],
            detalleInsumos: detalleInsumosPorDoctora[d.id] ?? [],
            retencionValor: retencionVoluntariaValor ? String(Math.round(retencionVoluntariaValor)) : "",
            retencionDepuracionValor: guardada?.retencionDepuracion ? String(Math.round(guardada.retencionDepuracion)) : "",
            guardando: false,
            guardado: false,
            detalleAbierto: false,
          };
        });
      setFilas(nuevasFilas);
      setCargando(false);
    })();
  }, [periodo.inicio, periodo.fin, sedeId, sedes]);

  function actualizarFila(idx: number, cambios: Partial<FilaDoctora>) {
    setFilas((prev) => prev.map((f, i) => (i === idx ? { ...f, ...cambios } : f)));
  }

  async function guardarFila(idx: number) {
    const f = filas[idx];
    const bruto = f.totalVentas * (pctHonorario / 100);
    const deduccion = (f.totalLaboratorios + f.totalInsumos) * (pctHonorario / 100);
    const retencionVoluntaria = Number(f.retencionValor) || 0;
    const retencionDepuracion = Number(f.retencionDepuracionValor) || 0;
    const totalPago = bruto - deduccion - retencionVoluntaria - retencionDepuracion;
    // IBC (Ingreso Base de Cotización) para seguridad social de independientes:
    // 40% del valor total a pagar, por ley.
    const ibc = totalPago * 0.4;
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
          total_insumos: f.totalInsumos,
          deduccion_labs_insumos: deduccion,
          total_pago: totalPago,
          retencion_valor: retencionVoluntaria || null,
          retencion_tipo: retencionVoluntaria > 0 ? "voluntaria" : null,
          retencion_depuracion_valor: retencionDepuracion,
          ibc,
          estado: retencionVoluntaria > 0 || retencionDepuracion > 0 ? "retencion_asignada" : "calculada",
        },
        { onConflict: "doctora_id,periodo_inicio,periodo_fin" },
      )
      .select("id")
      .single();
    if (!error && data) {
      if (retencionVoluntaria > 0) {
        await supabase.from("retenciones_historial").insert({
          liquidacion_id: data.id,
          valor: retencionVoluntaria,
          tipo: "voluntaria",
        });
      }
      if (retencionDepuracion > 0) {
        await supabase.from("retenciones_historial").insert({
          liquidacion_id: data.id,
          valor: retencionDepuracion,
          tipo: "depuracion",
        });
      }
    }
    actualizarFila(idx, { guardando: false, guardado: true });
    setTimeout(() => actualizarFila(idx, { guardado: false }), 1500);
  }

  if (cargando) return <p className="text-sm text-gray-400">Cargando…</p>;

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">
        Período {periodo.inicio} a {periodo.fin}. Solo cuenta lo efectivamente cobrado (incluye pagos con saldo a
        favor, no la creación de estos). IBC = 40% del total a pagar (base de cotización a seguridad social).
      </p>
      {filas.map((f, idx) => {
        const bruto = f.totalVentas * (pctHonorario / 100);
        const totalLaboratoriosInsumos = f.totalLaboratorios + f.totalInsumos;
        const deduccion = totalLaboratoriosInsumos * (pctHonorario / 100);
        const retencionVoluntaria = Number(f.retencionValor) || 0;
        const retencionDepuracion = Number(f.retencionDepuracionValor) || 0;
        const totalPago = bruto - deduccion - retencionVoluntaria - retencionDepuracion;
        const ibc = totalPago * 0.4;
        return (
          <div key={f.doctora.id} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-3 h-3 rounded-full shrink-0" style={{ background: f.doctora.color_pastel }} />
              <span className="font-semibold text-tinta">{f.doctora.nombre}</span>
            </div>

            {!sedeId && f.porSede.length > 1 && (
              <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 mb-3">
                <div className="grid grid-cols-4 gap-2 px-3 py-1.5 text-xs font-semibold text-gray-500 bg-gray-50">
                  <span>Sede</span>
                  <span className="text-right">Ventas</span>
                  <span className="text-right">Laboratorios</span>
                  <span className="text-right">Otros aparatología</span>
                </div>
                {f.porSede.map((s) => (
                  <div key={s.sedeId} className="grid grid-cols-4 gap-2 px-3 py-1.5 text-sm">
                    <span>{s.sedeNombre}</span>
                    <span className="text-right">{fmtCOP(s.ventas)}</span>
                    <span className="text-right">{fmtCOP(s.labs)}</span>
                    <span className="text-right">{fmtCOP(s.insumos)}</span>
                  </div>
                ))}
                <div className="grid grid-cols-4 gap-2 px-3 py-1.5 text-sm font-semibold bg-gray-50">
                  <span>Total</span>
                  <span className="text-right">{fmtCOP(f.totalVentas)}</span>
                  <span className="text-right">{fmtCOP(f.totalLaboratorios)}</span>
                  <span className="text-right">{fmtCOP(f.totalInsumos)}</span>
                </div>
              </div>
            )}

            <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 space-y-1.5 text-sm mb-3">
              <div className="flex items-center justify-between">
                <span className="text-gray-500">
                  Honorarios — {pctHonorario}% de {fmtCOP(f.totalVentas)} en ventas
                </span>
                <span className="font-medium text-emerald-700">+{fmtCOP(bruto)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">
                  Laboratorios + otros aparatología — {pctHonorario}% de {fmtCOP(totalLaboratoriosInsumos)}{" "}
                  (labs {fmtCOP(f.totalLaboratorios)} + otros {fmtCOP(f.totalInsumos)})
                </span>
                <span className="font-medium text-red-600">-{fmtCOP(deduccion)}</span>
              </div>
              <div className="flex items-center justify-between pt-1.5 border-t border-gray-200 font-semibold">
                <span>Subtotal (antes de retenciones)</span>
                <span>{fmtCOP(bruto - deduccion)}</span>
              </div>
            </div>
            <div className="flex items-end gap-4 flex-wrap mb-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Retención voluntaria</label>
                <input
                  type="number"
                  value={f.retencionValor}
                  onChange={(e) => actualizarFila(idx, { retencionValor: e.target.value })}
                  placeholder="0"
                  className="w-32 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Retención depuración de renta
                </label>
                <input
                  type="number"
                  value={f.retencionDepuracionValor}
                  onChange={(e) => actualizarFila(idx, { retencionDepuracionValor: e.target.value })}
                  placeholder="0"
                  title="Solo se conoce después de recibir la cuenta de cobro y el formato de depuración diligenciado — puedes agregarla más tarde, aunque ya hayas guardado la liquidación."
                  className="w-32 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div className="ml-auto flex items-end gap-6">
                <div className="text-right">
                  <p className="text-xs text-gray-400">IBC seg. social (40%)</p>
                  <p className="font-medium">{fmtCOP(ibc)}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-400">Total a pagar</p>
                  <p className="font-semibold text-lg">{fmtCOP(totalPago)}</p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 mb-3">
              <button
                onClick={() => actualizarFila(idx, { detalleAbierto: !f.detalleAbierto })}
                className="text-xs font-medium text-[var(--acento)]"
              >
                {f.detalleAbierto ? "Ocultar detalle" : "Ver detalle (laboratorios e insumos)"}
              </button>
              {(f.detalleLabs.length > 0 || f.detalleInsumos.length > 0) && (
                <button
                  onClick={() => exportarDetalleDoctora(periodo, f)}
                  className="flex items-center gap-1 text-xs font-medium text-gray-500"
                >
                  <Download size={13} /> Exportar respaldo en PDF
                </button>
              )}
            </div>

            {f.detalleAbierto && (
              <div className="space-y-3 mb-3">
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1">
                    Aparatos instalados / enviados a laboratorio ({f.detalleLabs.length})
                  </p>
                  <div className="rounded-lg border border-gray-200 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-gray-50 text-left text-gray-500">
                          <th className="px-2 py-1.5">Fecha</th>
                          <th className="px-2 py-1.5">Sede</th>
                          <th className="px-2 py-1.5">Paciente</th>
                          <th className="px-2 py-1.5">Laboratorio</th>
                          <th className="px-2 py-1.5">Factura</th>
                          <th className="px-2 py-1.5 text-right">Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {f.detalleLabs.map((d, i) => (
                          <tr key={i} className="border-t border-gray-100">
                            <td className="px-2 py-1.5">{d.fecha}</td>
                            <td className="px-2 py-1.5">{d.sedeNombre}</td>
                            <td className="px-2 py-1.5">{d.paciente}</td>
                            <td className="px-2 py-1.5">
                              {d.laboratorio}
                              {d.nota && <span className="text-gray-400"> ({d.nota})</span>}
                            </td>
                            <td className="px-2 py-1.5">{d.facturaNumero ?? "—"}</td>
                            <td className="px-2 py-1.5 text-right">{fmtCOP(d.valor)}</td>
                          </tr>
                        ))}
                        {f.detalleLabs.length === 0 && (
                          <tr>
                            <td colSpan={6} className="px-2 py-2 text-center text-gray-400">
                              Sin laboratorios en este período.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1">
                    Otros aparatología entregados ({f.detalleInsumos.length})
                  </p>
                  <div className="rounded-lg border border-gray-200 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-gray-50 text-left text-gray-500">
                          <th className="px-2 py-1.5">Fecha</th>
                          <th className="px-2 py-1.5">Sede</th>
                          <th className="px-2 py-1.5">Paciente</th>
                          <th className="px-2 py-1.5">Insumo</th>
                          <th className="px-2 py-1.5 text-right">Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {f.detalleInsumos.map((d, i) => (
                          <tr key={i} className="border-t border-gray-100">
                            <td className="px-2 py-1.5">{d.fecha}</td>
                            <td className="px-2 py-1.5">{d.sedeNombre}</td>
                            <td className="px-2 py-1.5">{d.paciente}</td>
                            <td className="px-2 py-1.5">{d.tipo}</td>
                            <td className="px-2 py-1.5 text-right">{fmtCOP(d.valor)}</td>
                          </tr>
                        ))}
                        {f.detalleInsumos.length === 0 && (
                          <tr>
                            <td colSpan={5} className="px-2 py-2 text-center text-gray-400">
                              Sin otros aparatología en este período.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

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
  doctoraId: string;
  doctora: string;
  doctoraInstala: string | null;
  laboratorio: string;
  tipo_servicio: string;
  factura_numero: string | null;
  valor_factura: number;
}

interface FilaInsumo {
  id: string;
  fecha: string;
  paciente: string;
  doctoraId: string;
  doctora: string;
  tipo: string;
  valor: number;
}

function LiquidacionLaboratorios({ mes, sedeId }: { mes: string; sedeId: string }) {
  const periodo = useMemo(() => periodoCiclo2625(mes), [mes]);
  const [doctoras, setDoctoras] = useState<Doctora[]>([]);
  const [doctoraId, setDoctoraId] = useState("");
  const [filas, setFilas] = useState<FilaLab[]>([]);
  const [insumos, setInsumos] = useState<FilaInsumo[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    supabase.from("doctoras").select("*").order("nombre").then(({ data }) => setDoctoras((data as Doctora[]) ?? []));
  }, []);

  useEffect(() => {
    (async () => {
      setCargando(true);
      let q = supabase
        .from("lab_ordenes")
        .select(
          "id, sede_id, mes_liquidacion, fecha_emision_factura, fecha_recibido, valor_factura, factura_numero, tipo_servicio, doctora_id, pacientes(nombre), doctoras!lab_ordenes_doctora_id_fkey(nombre), doctora_instala:doctoras!lab_ordenes_doctora_instala_id_fkey(nombre), laboratorios(nombre)",
        )
        .not("valor_factura", "is", null);
      if (sedeId) q = q.eq("sede_id", sedeId);
      if (doctoraId) q = q.or(`doctora_id.eq.${doctoraId},doctora_instala_id.eq.${doctoraId}`);
      const { data } = await q;
      const filtradas = ((data as unknown as {
        id: string; mes_liquidacion: string | null; fecha_emision_factura: string | null; fecha_recibido: string | null; valor_factura: number;
        factura_numero: string | null; tipo_servicio: string; doctora_id: string;
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
          doctoraId: r.doctora_id,
          doctora: r.doctoras?.nombre ?? "—",
          doctoraInstala: r.doctora_instala?.nombre ?? null,
          laboratorio: r.laboratorios?.nombre ?? "—",
          tipo_servicio: r.tipo_servicio,
          factura_numero: r.factura_numero,
          valor_factura: Number(r.valor_factura),
        })),
      );

      let qInsumos = supabase
        .from("insumos_consulta")
        .select("id, tipo, valor_costo, visitas!inner(fecha, sede_id, doctora_id, pacientes(nombre), doctoras(nombre))")
        .gte("visitas.fecha", periodo.inicio)
        .lte("visitas.fecha", periodo.fin);
      if (sedeId) qInsumos = qInsumos.eq("visitas.sede_id", sedeId);
      if (doctoraId) qInsumos = qInsumos.eq("visitas.doctora_id", doctoraId);
      const { data: insumosData } = await qInsumos;
      setInsumos(
        ((insumosData as unknown as {
          id: string; tipo: string; valor_costo: number;
          visitas: { fecha: string; doctora_id: string; pacientes: { nombre: string } | null; doctoras: { nombre: string } | null };
        }[]) ?? []).map((r) => ({
          id: r.id,
          fecha: r.visitas.fecha,
          paciente: r.visitas.pacientes?.nombre ?? "—",
          doctoraId: r.visitas.doctora_id,
          doctora: r.visitas.doctoras?.nombre ?? "—",
          tipo: TIPOS_INSUMO_LABEL[r.tipo] ?? r.tipo,
          valor: Number(r.valor_costo),
        })),
      );
      setCargando(false);
    })();
  }, [periodo.inicio, periodo.fin, sedeId, doctoraId]);

  const totalesPorLab = useMemo(() => {
    const t: Record<string, number> = {};
    for (const f of filas) t[f.laboratorio] = (t[f.laboratorio] ?? 0) + f.valor_factura;
    return t;
  }, [filas]);

  const total = filas.reduce((a, f) => a + f.valor_factura, 0);
  const totalInsumos = insumos.reduce((a, i) => a + i.valor, 0);

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

  function exportarInsumos() {
    descargarCSV(
      `liquidacion-insumos-${mes}.csv`,
      ["Fecha", "Paciente", "Doctora", "Insumo", "Valor"],
      insumos.map((i) => [i.fecha, i.paciente, i.doctora, i.tipo, i.valor]),
    );
  }

  if (cargando) return <p className="text-sm text-gray-400">Cargando…</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-gray-400">Período {periodo.inicio} a {periodo.fin}.</p>
        <select value={doctoraId} onChange={(e) => setDoctoraId(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm">
          <option value="">Todas las doctoras</option>
          {doctoras.map((d) => (
            <option key={d.id} value={d.id}>
              {d.nombre}
            </option>
          ))}
        </select>
      </div>
      <p className="text-xs text-gray-400 -mt-2">
        Para enviarle a cada doctora el respaldo de lo que se le está descontando: filtra por su nombre y exporta las
        dos tablas (facturas de laboratorio e insumos de aparatología).
      </p>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-500">Facturas de laboratorio</h3>
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

      <div className="flex items-center justify-between pt-2">
        <h3 className="text-sm font-semibold text-gray-500">Otros aparatología</h3>
        <button onClick={exportarInsumos} className="flex items-center gap-2 text-sm font-medium text-[var(--acento)]">
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
              <th className="px-3 py-2">Insumo</th>
              <th className="px-3 py-2 text-right">Valor</th>
            </tr>
          </thead>
          <tbody>
            {insumos.map((i) => (
              <tr key={i.id} className="border-t border-gray-100">
                <td className="px-3 py-2">{i.fecha}</td>
                <td className="px-3 py-2">{i.paciente}</td>
                <td className="px-3 py-2">{i.doctora}</td>
                <td className="px-3 py-2">{i.tipo}</td>
                <td className="px-3 py-2 text-right">{fmtCOP(i.valor)}</td>
              </tr>
            ))}
            {insumos.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-gray-400">
                  Sin otros aparatología en este período.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {insumos.length > 0 && (
        <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-white border border-gray-200 text-sm font-semibold">
          <span>Total otros aparatología</span>
          <span>{fmtCOP(totalInsumos)}</span>
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
