import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Download, Paperclip, FileText } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { fmtCOP, today } from "../../lib/format";
import { MEDIOS_PAGO, type Sede, type MedioPago, type CierreDiario as CierreDiarioRow } from "../../lib/types";

interface CargoPagoFila {
  medio_pago: MedioPago;
  valor: number;
  cargos: {
    categoria: string;
    concepto: string;
    doctoras: { nombre: string } | null;
    visitas: { pacientes: { nombre: string } | null } | null;
  };
}

interface OtroIngresoAuto {
  id: string;
  valor: number;
  medio: string;
  paciente: string;
  concepto: string;
}

const ETIQUETAS_MEDIO: Record<string, string> = Object.fromEntries(MEDIOS_PAGO.map((m) => [m.value, m.label]));

export function CierreDiario() {
  const { sedeActiva } = useOutletContext<{ sedeActiva: Sede }>();
  const [fecha, setFecha] = useState(today());
  const [filas, setFilas] = useState<CargoPagoFila[]>([]);
  const [otrosCargos, setOtrosCargos] = useState<OtroIngresoAuto[]>([]);
  const [otrosSaldos, setOtrosSaldos] = useState<OtroIngresoAuto[]>([]);
  const [cierre, setCierre] = useState<CierreDiarioRow | null>(null);
  const [gasto, setGasto] = useState("0");
  const [subiendo, setSubiendo] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("cargo_pagos")
        .select(
          "medio_pago, valor, cargos!inner(categoria, concepto, sede_id, fecha, doctoras(nombre), visitas(pacientes(nombre)))",
        )
        .eq("cargos.sede_id", sedeActiva.id)
        .eq("cargos.fecha", fecha);
      const todas = (data as unknown as CargoPagoFila[]) ?? [];
      // Solo "procedimiento" cuenta como venta de la doctora (honorario). RX y
      // conceptos administrativos (GUM, sedación, anticipos...) van a "otros ingresos".
      setFilas(todas.filter((f) => f.cargos.categoria === "procedimiento"));
      setOtrosCargos(
        todas
          // Un pago con saldo a favor es dinero que ya se contó el día que se generó
          // ese saldo — contarlo otra vez aquí duplicaría el ingreso del día.
          .filter((f) => f.cargos.categoria !== "procedimiento" && f.medio_pago !== "saldo_favor")
          .map((f, i) => ({
            id: `cargo-${i}`,
            valor: Number(f.valor),
            medio: f.medio_pago,
            paciente: f.cargos.visitas?.pacientes?.nombre ?? "—",
            concepto: f.cargos.concepto,
          })),
      );

      const { data: saldosData } = await supabase
        .from("saldos_favor")
        .select("id, valor, medio_origen, pacientes(nombre)")
        .eq("sede_origen_id", sedeActiva.id)
        .eq("fecha", fecha)
        // Los saldos registrados manualmente desde Parámetros (traslado de un saldo
        // previo, corrección) no son plata recibida ese día — no deben sumar al cierre.
        .neq("medio_origen", "ajuste_manual");
      setOtrosSaldos(
        ((saldosData as unknown as { id: string; valor: number; medio_origen: string; pacientes: { nombre: string } | null }[]) ?? []).map(
          (s) => ({
            id: s.id,
            valor: Number(s.valor),
            medio: s.medio_origen,
            paciente: s.pacientes?.nombre ?? "—",
            concepto: "Anticipo / saldo a favor",
          }),
        ),
      );

      const { data: cierreRow } = await supabase
        .from("cierres_diarios")
        .select("*")
        .eq("sede_id", sedeActiva.id)
        .eq("fecha", fecha)
        .maybeSingle();
      setCierre((cierreRow as CierreDiarioRow) ?? null);
      setGasto(String(cierreRow?.gasto ?? 0));
    })();
  }, [sedeActiva.id, fecha]);

  const doctoras = useMemo(
    () => Array.from(new Set(filas.map((f) => f.cargos.doctoras?.nombre ?? "—"))).sort(),
    [filas],
  );

  const tabla = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    for (const f of filas) {
      const doc = f.cargos.doctoras?.nombre ?? "—";
      map[doc] = map[doc] ?? {};
      map[doc][f.medio_pago] = (map[doc][f.medio_pago] ?? 0) + Number(f.valor);
    }
    return map;
  }, [filas]);

  const totalPorMedio = useMemo(() => {
    const totales: Record<string, number> = {};
    for (const f of filas) totales[f.medio_pago] = (totales[f.medio_pago] ?? 0) + Number(f.valor);
    return totales;
  }, [filas]);

  const otrosIngresosAuto = useMemo(() => [...otrosCargos, ...otrosSaldos], [otrosCargos, otrosSaldos]);

  const totalOtrosAutoPorMedio = useMemo(() => {
    const totales: Record<string, number> = {};
    for (const o of otrosIngresosAuto) totales[o.medio] = (totales[o.medio] ?? 0) + o.valor;
    return totales;
  }, [otrosIngresosAuto]);

  const totalOtrosAuto = otrosIngresosAuto.reduce((a, o) => a + o.valor, 0);

  const totalEfectivoCierre =
    (totalPorMedio["efectivo"] ?? 0) + (totalOtrosAutoPorMedio["efectivo"] ?? 0) - Number(gasto || 0);

  async function guardarManual() {
    await supabase.from("cierres_diarios").upsert(
      {
        sede_id: sedeActiva.id,
        fecha,
        gasto: Number(gasto) || 0,
        consignado: cierre?.consignado ?? false,
        comprobante_url: cierre?.comprobante_url ?? null,
        fecha_consignacion: cierre?.fecha_consignacion ?? null,
        entregado_admin: cierre?.entregado_admin ?? false,
        fecha_entrega_admin: cierre?.fecha_entrega_admin ?? null,
      },
      { onConflict: "sede_id,fecha" },
    );
  }

  async function marcarConsignado(consignado: boolean) {
    if (consignado && !cierre?.comprobante_url) {
      window.alert("Adjunta el comprobante de consignación antes de marcar el día como consignado.");
      return;
    }
    await supabase
      .from("cierres_diarios")
      .upsert(
        {
          sede_id: sedeActiva.id,
          fecha,
          gasto: Number(gasto) || 0,
          consignado,
          fecha_consignacion: consignado ? today() : null,
          comprobante_url: cierre?.comprobante_url ?? null,
          entregado_admin: cierre?.entregado_admin ?? false,
          fecha_entrega_admin: cierre?.fecha_entrega_admin ?? null,
        },
        { onConflict: "sede_id,fecha" },
      )
      .select("*")
      .single()
      .then(({ data }) => setCierre((data as CierreDiarioRow) ?? null));
  }

  async function marcarEntregadoAdmin(entregado: boolean) {
    // A diferencia de "Día consignado", esta opción no exige comprobante —
    // es para cuando el efectivo se entrega en mano a la administración.
    await supabase
      .from("cierres_diarios")
      .upsert(
        {
          sede_id: sedeActiva.id,
          fecha,
          gasto: Number(gasto) || 0,
          consignado: cierre?.consignado ?? false,
          comprobante_url: cierre?.comprobante_url ?? null,
          fecha_consignacion: cierre?.fecha_consignacion ?? null,
          entregado_admin: entregado,
          fecha_entrega_admin: entregado ? today() : null,
        },
        { onConflict: "sede_id,fecha" },
      )
      .select("*")
      .single()
      .then(({ data }) => setCierre((data as CierreDiarioRow) ?? null));
  }

  async function subirComprobante(file: File) {
    setSubiendo(true);
    const path = `${sedeActiva.id}/${fecha}-${file.name}`;
    const { error: errorSubida } = await supabase.storage.from("comprobantes").upload(path, file, { upsert: true });
    if (errorSubida) {
      window.alert(`No se pudo subir el comprobante: ${errorSubida.message}`);
      setSubiendo(false);
      return;
    }
    const { data, error: errorGuardado } = await supabase
      .from("cierres_diarios")
      .upsert(
        {
          sede_id: sedeActiva.id,
          fecha,
          gasto: Number(gasto) || 0,
          consignado: cierre?.consignado ?? false,
          comprobante_url: path,
          fecha_consignacion: cierre?.fecha_consignacion ?? null,
          entregado_admin: cierre?.entregado_admin ?? false,
          fecha_entrega_admin: cierre?.fecha_entrega_admin ?? null,
        },
        { onConflict: "sede_id,fecha" },
      )
      .select("*")
      .single();
    if (errorGuardado) {
      window.alert(`El archivo se subió pero no se pudo guardar el registro: ${errorGuardado.message}`);
    } else {
      setCierre((data as CierreDiarioRow) ?? null);
    }
    setSubiendo(false);
  }

  async function verComprobante(path: string) {
    const { data } = await supabase.storage.from("comprobantes").createSignedUrl(path, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  }

  function exportarPDF() {
    const totalGeneral = Object.values(totalPorMedio).reduce((a, v) => a + v, 0);
    const filasHtml = doctoras
      .map((doc) => {
        const fila = tabla[doc] ?? {};
        const total = MEDIOS_PAGO.reduce((a, m) => a + (fila[m.value] ?? 0), 0);
        return `<tr><td>${doc}</td>${MEDIOS_PAGO.map(
          (m) => `<td style="text-align:right">${fila[m.value] ? fmtCOP(fila[m.value]) : "—"}</td>`,
        ).join("")}<td style="text-align:right;font-weight:600">${fmtCOP(total)}</td></tr>`;
      })
      .join("");

    const otrosHtml =
      otrosIngresosAuto.length > 0
        ? `<h3>Otros ingresos</h3>
           <table>
             <thead><tr><th>Paciente</th><th>Concepto</th><th>Medio</th><th style="text-align:right">Valor</th></tr></thead>
             <tbody>${otrosIngresosAuto
               .map(
                 (o) =>
                   `<tr><td>${o.paciente}</td><td>${o.concepto}</td><td>${ETIQUETAS_MEDIO[o.medio] ?? o.medio}</td><td style="text-align:right">${fmtCOP(o.valor)}</td></tr>`,
               )
               .join("")}</tbody>
           </table>
           <p style="text-align:right;font-weight:600">Total otros ingresos: ${fmtCOP(totalOtrosAuto)}</p>`
        : "";

    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
      <html>
        <head>
          <title>Cierre ${sedeActiva.nombre} - ${fecha}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #2a2438; }
            h2 { margin-bottom: 0; }
            h3 { margin-bottom: 6px; margin-top: 24px; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            th, td { padding: 6px 10px; border-bottom: 1px solid #ddd; font-size: 13px; }
            th { text-align: left; background: #f5f4f7; }
            tfoot td { font-weight: 700; border-top: 2px solid #333; }
            .resumen p { margin: 4px 0; }
            .firma { margin-top: 60px; display: flex; gap: 40px; }
            .firma div { flex: 1; border-top: 1px solid #333; padding-top: 6px; font-size: 12px; color: #555; }
            .vouchers { margin-top: 40px; border: 1px dashed #999; border-radius: 6px; padding: 12px; font-size: 12px; color: #555; }
          </style>
        </head>
        <body>
          <h2>Cierre diario — ${sedeActiva.nombre}</h2>
          <p>Fecha: ${fecha}</p>
          <table>
            <thead>
              <tr><th>Doctora</th>${MEDIOS_PAGO.map((m) => `<th style="text-align:right">${m.label}</th>`).join("")}<th style="text-align:right">Total</th></tr>
            </thead>
            <tbody>${filasHtml || `<tr><td colspan="${MEDIOS_PAGO.length + 2}">Sin cobros este día.</td></tr>`}</tbody>
            <tfoot>
              <tr><td>Total</td>${MEDIOS_PAGO.map((m) => `<td style="text-align:right">${totalPorMedio[m.value] ? fmtCOP(totalPorMedio[m.value]) : "—"}</td>`).join("")}<td style="text-align:right">${fmtCOP(totalGeneral)}</td></tr>
            </tfoot>
          </table>
          ${otrosHtml}
          <div class="resumen">
            <p>Gasto del día: ${fmtCOP(Number(gasto) || 0)}</p>
            <p><strong>Total efectivo (Cierre): ${fmtCOP(totalEfectivoCierre)}</strong></p>
            <p>Día consignado: ${cierre?.consignado ? "Sí" : "No"}</p>
            <p>Entregado a la administración: ${cierre?.entregado_admin ? "Sí" : "No"}</p>
          </div>
          <div class="vouchers">Adjuntar aquí los vouchers del datafono y demás soportes físicos del día.</div>
          <div class="firma">
            <div>Firma auxiliar</div>
            <div>Firma responsable / recibido</div>
          </div>
        </body>
      </html>
    `);
    win.document.close();
    win.focus();
    win.print();
  }

  function exportarCSV() {
    const encabezado = ["Doctora", ...MEDIOS_PAGO.map((m) => m.label), "Total"];
    const lineas = doctoras.map((doc) => {
      const fila = tabla[doc] ?? {};
      const total = MEDIOS_PAGO.reduce((a, m) => a + (fila[m.value] ?? 0), 0);
      return [doc, ...MEDIOS_PAGO.map((m) => fila[m.value] ?? 0), total].join(",");
    });
    const csv = [encabezado.join(","), ...lineas].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cierre-${sedeActiva.nombre}-${fecha}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        <div className="flex items-center gap-4">
          <button onClick={exportarPDF} className="flex items-center gap-2 text-sm font-medium text-[var(--acento)]">
            <FileText size={16} /> Descargar PDF
          </button>
          <button onClick={exportarCSV} className="flex items-center gap-2 text-sm font-medium text-[var(--acento)]">
            <Download size={16} /> Exportar
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-gray-500">
              <th className="px-3 py-2">Doctora</th>
              {MEDIOS_PAGO.map((m) => (
                <th key={m.value} className="px-3 py-2 text-right">
                  {m.label}
                </th>
              ))}
              <th className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {doctoras.map((doc) => {
              const fila = tabla[doc] ?? {};
              const total = MEDIOS_PAGO.reduce((a, m) => a + (fila[m.value] ?? 0), 0);
              return (
                <tr key={doc} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-medium">{doc}</td>
                  {MEDIOS_PAGO.map((m) => (
                    <td key={m.value} className="px-3 py-2 text-right">
                      {fila[m.value] ? fmtCOP(fila[m.value]) : "—"}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right font-semibold">{fmtCOP(total)}</td>
                </tr>
              );
            })}
            {doctoras.length === 0 && (
              <tr>
                <td colSpan={MEDIOS_PAGO.length + 2} className="px-3 py-4 text-center text-gray-400">
                  Sin cobros este día.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t border-gray-200 bg-gray-50 font-semibold">
              <td className="px-3 py-2">Total</td>
              {MEDIOS_PAGO.map((m) => (
                <td key={m.value} className="px-3 py-2 text-right">
                  {totalPorMedio[m.value] ? fmtCOP(totalPorMedio[m.value]) : "—"}
                </td>
              ))}
              <td className="px-3 py-2 text-right">{fmtCOP(Object.values(totalPorMedio).reduce((a, v) => a + v, 0))}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {otrosIngresosAuto.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-500 mb-1">Otros ingresos</h3>
          <p className="text-xs text-gray-400 mb-2">
            RX, conceptos administrativos (GUM, sedación, anticipos…) y saldo a favor generado hoy — no cuentan
            como venta de la doctora.
          </p>
          <div className="divide-y divide-gray-100 text-sm">
            {otrosIngresosAuto.map((o) => (
              <div key={o.id} className="flex items-center justify-between py-1.5">
                <span>
                  {o.paciente} <span className="text-gray-400">· {o.concepto} · {ETIQUETAS_MEDIO[o.medio] ?? o.medio}</span>
                </span>
                <span className="font-medium">{fmtCOP(o.valor)}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between pt-2 mt-2 border-t border-gray-100 text-sm font-semibold">
            <span>Total otros ingresos</span>
            <span>{fmtCOP(totalOtrosAuto)}</span>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Gasto del día</label>
          <input
            type="number"
            value={gasto}
            onChange={(e) => setGasto(e.target.value)}
            onBlur={guardarManual}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
          <span className="text-sm text-gray-500">Total efectivo (Cierre)</span>
          <span className="font-semibold">{fmtCOP(totalEfectivoCierre)}</span>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={cierre?.consignado ?? false} onChange={(e) => marcarConsignado(e.target.checked)} />
            Día consignado
          </label>
          <div className="flex items-center gap-3">
            {cierre?.comprobante_url && (
              <button
                onClick={() => verComprobante(cierre.comprobante_url!)}
                className="text-sm text-[var(--acento)] font-medium underline"
              >
                Ver comprobante
              </button>
            )}
            <label className="flex items-center gap-2 text-sm text-[var(--acento)] font-medium cursor-pointer">
              <Paperclip size={14} />
              {subiendo ? "Subiendo…" : cierre?.comprobante_url ? "Reemplazar" : "Adjuntar comprobante"}
              <input
                type="file"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && subirComprobante(e.target.files[0])}
              />
            </label>
          </div>
        </div>
        <div className="flex items-center justify-between pt-3 border-t border-gray-100">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={cierre?.entregado_admin ?? false}
              onChange={(e) => marcarEntregadoAdmin(e.target.checked)}
            />
            Entregado a la administración
          </label>
          <span className="text-xs text-gray-400">No necesita comprobante adjunto</span>
        </div>
      </div>
    </div>
  );
}
