import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { fmtCOP, mesActual, today } from "../../lib/format";
import type { Sede, CajaMenorPeriodo, CajaMenorMovimiento } from "../../lib/types";

export function CajaMenor() {
  const { sedeActiva } = useOutletContext<{ sedeActiva: Sede }>();
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

  if (cargando) return <p className="text-sm text-gray-400">Cargando…</p>;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <section className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h2 className="font-semibold text-tinta">Caja menor — {sedeActiva.nombre}</h2>
          <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
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
