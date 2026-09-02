import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Plus, Trash2, Download, FileText } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { fmtCOP, mesActual, today } from "../../lib/format";
import type { Sede, CajaMenorPeriodo, CajaMenorMovimiento } from "../../lib/types";
import { useAuth } from "../../auth/AuthContext";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function CajaMenor() {
  const { sedeActiva } = useOutletContext<{ sedeActiva: Sede }>();
  const { perfil } = useAuth();
  const [mes, setMes] = useState(mesActual());
  const [periodo, setPeriodo] = useState<CajaMenorPeriodo | null>(null);
  const [movimientos, setMovimientos] = useState<CajaMenorMovimiento[]>([]);
  const [cargando, setCargando] = useState(true);
  const [montoInput, setMontoInput] = useState("500000");
  const [error, setError] = useState<string | null>(null);

  const [fecha, setFecha] = useState(today());
  const [facturaNumero, setFacturaNumero] = useState("");
  const [nitCedula, setNitCedula] = useState("");
  const [pagadoA, setPagadoA] = useState("");
  const [concepto, setConcepto] = useState("");
  const [valorFactura, setValorFactura] = useState("");
  const [iva, setIva] = useState("0");
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    setCargando(true);
    const { data: periodoRow } = await supabase
      .from("caja_menor_periodos")
      .select("*")
      .eq("sede_id", sedeActiva.id)
      .eq("mes", `${mes}-01`)
      .maybeSingle();
    const p = (periodoRow as CajaMenorPeriodo) ?? null;
    setPeriodo(p);
    setMontoInput(String(p?.monto_asignado ?? 500000));
    if (p) {
      const { data: movs } = await supabase
        .from("caja_menor_movimientos")
        .select("*")
        .eq("periodo_id", p.id)
        .order("fecha", { ascending: true });
      setMovimientos((movs as CajaMenorMovimiento[]) ?? []);
    } else {
      setMovimientos([]);
    }
    setCargando(false);
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sedeActiva.id, mes]);

  async function asegurarPeriodo(): Promise<CajaMenorPeriodo | null> {
    if (periodo) return periodo;
    const { data, error: errorUpsert } = await supabase
      .from("caja_menor_periodos")
      .upsert({ sede_id: sedeActiva.id, mes: `${mes}-01`, monto_asignado: Number(montoInput) || 500000 }, { onConflict: "sede_id,mes" })
      .select("*")
      .single();
    if (errorUpsert || !data) {
      setError(errorUpsert?.message ?? "No se pudo crear el período de caja menor.");
      return null;
    }
    setPeriodo(data as CajaMenorPeriodo);
    return data as CajaMenorPeriodo;
  }

  async function guardarMonto() {
    const valor = Number(montoInput) || 0;
    setError(null);
    if (!periodo) {
      const p = await asegurarPeriodo();
      if (p && p.monto_asignado !== valor) {
        const { error: errorUpd } = await supabase.from("caja_menor_periodos").update({ monto_asignado: valor }).eq("id", p.id);
        if (errorUpd) setError(errorUpd.message);
        else setPeriodo({ ...p, monto_asignado: valor });
      }
      return;
    }
    const { error: errorUpd } = await supabase.from("caja_menor_periodos").update({ monto_asignado: valor }).eq("id", periodo.id);
    if (errorUpd) setError(errorUpd.message);
    else setPeriodo({ ...periodo, monto_asignado: valor });
  }

  async function marcarReembolsado(reembolsado: boolean) {
    const p = await asegurarPeriodo();
    if (!p) return;
    const { error: errorUpd } = await supabase
      .from("caja_menor_periodos")
      .update({ reembolsado, fecha_reembolso: reembolsado ? today() : null })
      .eq("id", p.id);
    if (errorUpd) {
      setError(errorUpd.message);
      return;
    }
    setPeriodo({ ...p, reembolsado, fecha_reembolso: reembolsado ? today() : null });
  }

  async function agregarMovimiento() {
    if (!pagadoA.trim() || !concepto.trim() || !Number(valorFactura)) return;
    setGuardando(true);
    setError(null);
    const p = await asegurarPeriodo();
    if (!p) {
      setGuardando(false);
      return;
    }
    const { error: errorInsert } = await supabase.from("caja_menor_movimientos").insert({
      periodo_id: p.id,
      fecha,
      factura_numero: facturaNumero.trim() || null,
      nit_cedula: nitCedula.trim() || null,
      pagado_a: pagadoA.trim(),
      concepto: concepto.trim(),
      valor_factura: Number(valorFactura) || 0,
      iva: Number(iva) || 0,
    });
    setGuardando(false);
    if (errorInsert) {
      setError(errorInsert.message);
      return;
    }
    setFecha(today());
    setFacturaNumero("");
    setNitCedula("");
    setPagadoA("");
    setConcepto("");
    setValorFactura("");
    setIva("0");
    cargar();
  }

  async function eliminarMovimiento(id: string) {
    if (!window.confirm("¿Eliminar este gasto de caja menor? Esta acción no se puede deshacer.")) return;
    const { error: errorDelete } = await supabase.from("caja_menor_movimientos").delete().eq("id", id);
    if (errorDelete) {
      window.alert(`No se pudo eliminar: ${errorDelete.message}`);
      return;
    }
    cargar();
  }

  const totalGastado = movimientos.reduce((a, m) => a + Number(m.valor_factura) + Number(m.iva), 0);
  const montoAsignado = periodo?.monto_asignado ?? (Number(montoInput) || 0);
  const saldoDisponible = montoAsignado - totalGastado;

  function exportarCSV() {
    const encabezado = ["Fecha", "Factura", "NIT/Cédula", "Pagado a", "Concepto", "Valor factura", "IVA", "Neto pagado"];
    const lineas = movimientos.map((m) =>
      [m.fecha, m.factura_numero ?? "", m.nit_cedula ?? "", m.pagado_a, m.concepto, m.valor_factura, m.iva, Number(m.valor_factura) + Number(m.iva)]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    const csv = [encabezado.join(","), ...lineas].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `caja-menor-${sedeActiva.nombre}-${mes}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportarPDF() {
    const filasHtml = movimientos
      .map(
        (m) =>
          `<tr><td>${esc(m.fecha)}</td><td>${esc(m.factura_numero ?? "—")}</td><td>${esc(m.nit_cedula ?? "—")}</td><td>${esc(
            m.pagado_a,
          )}</td><td>${esc(m.concepto)}</td><td class="num">${esc(fmtCOP(m.valor_factura))}</td><td class="num">${esc(
            fmtCOP(m.iva),
          )}</td><td class="num">${esc(fmtCOP(Number(m.valor_factura) + Number(m.iva)))}</td></tr>`,
      )
      .join("");
    const html = `<!doctype html>
<html><head><meta charset="utf-8" />
<title>Caja menor - ${esc(sedeActiva.nombre)} - ${mes}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #2E253A; padding: 24px; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  p.periodo { color: #666; font-size: 12px; margin: 0 0 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 12px; }
  th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
  th { background: #f5f5f5; }
  .num { text-align: right; }
  tfoot td { font-weight: 700; background: #fafafa; }
  .resumen { display: flex; gap: 24px; margin: 14px 0; font-size: 13px; }
  .resumen div { border: 1px solid #ddd; border-radius: 8px; padding: 10px 14px; }
  .resumen .valor { font-size: 16px; font-weight: 700; }
  .btn-imprimir {
    position: fixed; top: 14px; right: 14px; background: #2E253A; color: #fff; border: none;
    border-radius: 8px; padding: 8px 14px; font-size: 13px; font-family: inherit; cursor: pointer;
  }
  @media print { body { padding: 0; } .btn-imprimir { display: none; } }
</style>
</head>
<body>
  <button class="btn-imprimir" onclick="window.print()">Imprimir / Guardar como PDF</button>
  <h1>Reembolso caja menor — ${esc(sedeActiva.nombre)}</h1>
  <p class="periodo">Mes: ${mes} — Responsable: ${esc(perfil?.nombre ?? "—")}</p>
  <div class="resumen">
    <div>Monto asignado<div class="valor">${esc(fmtCOP(montoAsignado))}</div></div>
    <div>Total gastado<div class="valor">${esc(fmtCOP(totalGastado))}</div></div>
    <div>Saldo disponible<div class="valor">${esc(fmtCOP(saldoDisponible))}</div></div>
  </div>
  <table>
    <thead><tr><th>Fecha</th><th>Factura</th><th>NIT/Cédula</th><th>Pagado a</th><th>Concepto</th><th class="num">Valor</th><th class="num">IVA</th><th class="num">Neto</th></tr></thead>
    <tbody>${filasHtml || `<tr><td colspan="8">Sin gastos registrados este mes.</td></tr>`}</tbody>
    <tfoot><tr><td colspan="7">Total</td><td class="num">${esc(fmtCOP(totalGastado))}</td></tr></tfoot>
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
  }

  if (cargando) return <p className="text-sm text-gray-400">Cargando…</p>;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <section className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h2 className="font-semibold text-tinta">Caja menor — {sedeActiva.nombre}</h2>
          <div className="flex items-center gap-3 flex-wrap">
            <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <button onClick={exportarPDF} className="flex items-center gap-1.5 text-sm font-medium text-[var(--acento)]">
              <FileText size={15} /> PDF
            </button>
            <button onClick={exportarCSV} className="flex items-center gap-1.5 text-sm font-medium text-[var(--acento)]">
              <Download size={15} /> CSV
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Monto asignado del mes</label>
            <input
              type="number"
              value={montoInput}
              onChange={(e) => setMontoInput(e.target.value)}
              onBlur={guardarMonto}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">Total gastado</p>
            <p className="font-semibold text-tinta py-2">{fmtCOP(totalGastado)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">Saldo disponible</p>
            <p className={`font-semibold py-2 ${saldoDisponible < 0 ? "text-red-600" : "text-tinta"}`}>{fmtCOP(saldoDisponible)}</p>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm mt-3 pt-3 border-t border-gray-100">
          <input type="checkbox" checked={periodo?.reembolsado ?? false} onChange={(e) => marcarReembolsado(e.target.checked)} />
          Reembolsado por administración{periodo?.fecha_reembolso ? ` (${periodo.fecha_reembolso})` : ""}
        </label>
        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-500 mb-3">Agregar gasto</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          <input
            value={pagadoA}
            onChange={(e) => setPagadoA(e.target.value)}
            placeholder="Pagado a"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            value={concepto}
            onChange={(e) => setConcepto(e.target.value)}
            placeholder="Concepto"
            className="sm:col-span-2 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            value={facturaNumero}
            onChange={(e) => setFacturaNumero(e.target.value)}
            placeholder="N° factura (opcional)"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            value={nitCedula}
            onChange={(e) => setNitCedula(e.target.value)}
            placeholder="NIT o cédula (opcional)"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            type="number"
            value={valorFactura}
            onChange={(e) => setValorFactura(e.target.value)}
            placeholder="Valor factura"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            type="number"
            value={iva}
            onChange={(e) => setIva(e.target.value)}
            placeholder="IVA"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          onClick={agregarMovimiento}
          disabled={!pagadoA.trim() || !concepto.trim() || !Number(valorFactura) || guardando}
          className="flex items-center gap-2 rounded-lg bg-[var(--acento)] text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
        >
          <Plus size={16} /> {guardando ? "Guardando…" : "Registrar gasto"}
        </button>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-gray-500">
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Factura</th>
              <th className="px-3 py-2">Pagado a</th>
              <th className="px-3 py-2">Concepto</th>
              <th className="px-3 py-2 text-right">Valor</th>
              <th className="px-3 py-2 text-right">IVA</th>
              <th className="px-3 py-2 text-right">Neto</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {movimientos.map((m) => (
              <tr key={m.id} className="border-t border-gray-100">
                <td className="px-3 py-2">{m.fecha}</td>
                <td className="px-3 py-2">{m.factura_numero ?? "—"}</td>
                <td className="px-3 py-2">{m.pagado_a}</td>
                <td className="px-3 py-2">{m.concepto}</td>
                <td className="px-3 py-2 text-right">{fmtCOP(m.valor_factura)}</td>
                <td className="px-3 py-2 text-right">{fmtCOP(m.iva)}</td>
                <td className="px-3 py-2 text-right font-medium">{fmtCOP(Number(m.valor_factura) + Number(m.iva))}</td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => eliminarMovimiento(m.id)} className="text-gray-300 hover:text-red-500">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {movimientos.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-4 text-center text-gray-400">
                  Sin gastos registrados este mes.
                </td>
              </tr>
            )}
          </tbody>
          {movimientos.length > 0 && (
            <tfoot>
              <tr className="border-t border-gray-200 bg-gray-50 font-semibold">
                <td colSpan={6} className="px-3 py-2">
                  Total
                </td>
                <td className="px-3 py-2 text-right">{fmtCOP(totalGastado)}</td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </section>
    </div>
  );
}
