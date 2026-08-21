import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import { fmtCOP } from "../lib/format";
import type { Sede, CierreCaja as CierreCajaRow } from "../lib/types";

const DIAS_SEMANA = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function fechaCorta(fecha: string) {
  const [y, m, d] = fecha.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return `${d} ${MESES[m - 1]} · ${DIAS_SEMANA[dt.getDay()]}`;
}

function claveSedeDe(sede: Sede) {
  return sede.nombre.includes("Fabricato") ? "Fabricato" : "Las Americas";
}

/** Un día tiene algo pendiente de revisar/resolver. Mismo criterio para el
 *  filtro "Solo días con pendientes" y para la lista de la pestaña Pendientes. */
function tienePendientes(c: CierreCajaRow) {
  return (
    !c.cuadra ||
    c.errores.length > 0 ||
    c.dataf_sin_docs ||
    c.arqueo === null ||
    (!!c.dif_dataf_bruta && !c.dataf_explicado) ||
    c.addi > 0 ||
    !!c.nota_consignacion_pendiente
  );
}

interface PendienteItem {
  clave: string;
  fecha: string;
  tipo: string;
  descripcion: string;
}

function pendientesDe(c: CierreCajaRow, claveSede: string): PendienteItem[] {
  const items: PendienteItem[] = [];
  const base = `${c.fecha}|${claveSede}`;
  if (c.dataf_sin_docs) {
    items.push({
      clave: `${base}|Datáfono`,
      fecha: c.fecha,
      tipo: "Datáfono",
      descripcion: `Falta el comprobante de ${c.fuente_dataf ?? "Redeban/SPRO Bold"} (tarjeta facturada ${fmtCOP(c.tarjeta_fact)}).`,
    });
  }
  if (c.arqueo === null) {
    items.push({
      clave: `${base}|Cierre físico`,
      fecha: c.fecha,
      tipo: "Cierre físico",
      descripcion: "Falta el cierre físico (arqueo de efectivo) de este día.",
    });
  }
  if (c.dif_dataf_bruta && !c.dataf_explicado) {
    items.push({
      clave: `${base}|Diferencia datáfono`,
      fecha: c.fecha,
      tipo: "Diferencia datáfono",
      descripcion: `Diferencia de ${fmtCOP(c.dif_dataf_bruta)} sin explicar entre tarjeta facturada y ${c.fuente_dataf ?? "datáfono"}.`,
    });
  }
  if (c.addi > 0) {
    items.push({
      clave: `${base}|Addi/Sistecrédito`,
      fecha: c.fecha,
      tipo: "Addi/Sistecrédito",
      descripcion: `Verificar ${fmtCOP(c.addi)} en Addi/Sistecrédito de este día.`,
    });
  }
  if (c.nota_consignacion_pendiente) {
    items.push({
      clave: `${base}|Consignación`,
      fecha: c.fecha,
      tipo: "Consignación",
      descripcion: c.nota_consignacion_pendiente,
    });
  }
  return items;
}

export function CierreCaja() {
  const { sedeActiva } = useOutletContext<{ sedeActiva: Sede }>();
  const claveSede = claveSedeDe(sedeActiva);
  const [cierres, setCierres] = useState<CierreCajaRow[]>([]);
  const [revisiones, setRevisiones] = useState<Record<string, boolean>>({});
  const [pendientesEstado, setPendientesEstado] = useState<Record<string, { resuelto: boolean; solucion: string }>>({});
  const [soloConPendientes, setSoloConPendientes] = useState(false);
  const [tab, setTab] = useState<"dias" | "pendientes" | "reporte">("dias");
  const [detalle, setDetalle] = useState<CierreCajaRow | null>(null);
  const [mesesAbiertos, setMesesAbiertos] = useState<Set<string>>(new Set());
  const [reporteDesde, setReporteDesde] = useState(() => new Date().toISOString().slice(0, 8) + "01");
  const [reporteHasta, setReporteHasta] = useState(() => new Date().toISOString().slice(0, 10));

  async function cargar() {
    const { data } = await supabase.from("cierres_caja").select("*").eq("sede", claveSede).order("fecha", { ascending: false });
    const filas = (data as CierreCajaRow[]) ?? [];
    setCierres(filas);

    const { data: revData } = await supabase.from("cierres_revision_fisica").select("*");
    const mapaRev: Record<string, boolean> = {};
    (revData ?? []).forEach((r) => (mapaRev[`${r.fecha}|${r.sede}`] = r.revisado));
    setRevisiones(mapaRev);

    const { data: pendData } = await supabase.from("cierres_pendientes_estado").select("*");
    const mapaPend: Record<string, { resuelto: boolean; solucion: string }> = {};
    (pendData ?? []).forEach((p) => (mapaPend[p.clave] = { resuelto: p.resuelto, solucion: p.solucion ?? "" }));
    setPendientesEstado(mapaPend);

    setMesesAbiertos((prev) => {
      if (prev.size > 0) return prev;
      const mesesConFaltantes = new Set(filas.filter((c) => c.dataf_sin_docs || c.arqueo === null).map((c) => c.fecha.slice(0, 7)));
      const mesMasReciente = filas[0]?.fecha.slice(0, 7);
      if (mesMasReciente) mesesConFaltantes.add(mesMasReciente);
      return mesesConFaltantes;
    });
  }

  useEffect(() => {
    cargar();
    const channel = supabase
      .channel(`cierres_caja_${claveSede}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cierres_caja" }, cargar)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveSede]);

  async function toggleRevisado(fecha: string) {
    const clave = `${fecha}|${claveSede}`;
    const nuevo = !revisiones[clave];
    setRevisiones((prev) => ({ ...prev, [clave]: nuevo }));
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase.from("cierres_revision_fisica").upsert(
      { fecha, sede: claveSede, revisado: nuevo, revisado_por: user?.id ?? null, revisado_en: nuevo ? new Date().toISOString() : null },
      { onConflict: "fecha,sede" },
    );
  }

  async function marcarPendiente(clave: string, resuelto: boolean, solucion: string) {
    setPendientesEstado((prev) => ({ ...prev, [clave]: { resuelto, solucion } }));
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase.from("cierres_pendientes_estado").upsert(
      { clave, resuelto, solucion, resuelto_por: user?.id ?? null, resuelto_en: resuelto ? new Date().toISOString() : null },
      { onConflict: "clave" },
    );
  }

  function toggleMes(mes: string) {
    setMesesAbiertos((prev) => {
      const next = new Set(prev);
      if (next.has(mes)) next.delete(mes);
      else next.add(mes);
      return next;
    });
  }

  const cierresFiltrados = useMemo(
    () => (soloConPendientes ? cierres.filter(tienePendientes) : cierres),
    [cierres, soloConPendientes],
  );

  const gruposPorMes = useMemo(() => {
    const map: Record<string, CierreCajaRow[]> = {};
    for (const c of cierresFiltrados) {
      const mes = c.fecha.slice(0, 7);
      map[mes] = map[mes] ?? [];
      map[mes].push(c);
    }
    return map;
  }, [cierresFiltrados]);

  const totalPeriodo = cierresFiltrados.reduce((a, c) => a + Number(c.total), 0);

  const pendientesTodos = useMemo(() => cierres.flatMap((c) => pendientesDe(c, claveSede)), [cierres, claveSede]);
  const pendientesAbiertos = pendientesTodos.filter((p) => !pendientesEstado[p.clave]?.resuelto);
  const pendientesResueltos = pendientesTodos.filter((p) => pendientesEstado[p.clave]?.resuelto);

  const cierresReporte = useMemo(
    () => cierres.filter((c) => c.fecha >= reporteDesde && c.fecha <= reporteHasta),
    [cierres, reporteDesde, reporteHasta],
  );
  const reporte = useMemo(
    () => ({
      efectivo: cierresReporte.reduce((a, c) => a + Number(c.efvo_fact), 0),
      tarjeta: cierresReporte.reduce((a, c) => a + Number(c.tarjeta_fact), 0),
      transferencia: cierresReporte.reduce((a, c) => a + Number(c.transf_fact), 0),
      addi: cierresReporte.reduce((a, c) => a + Number(c.addi), 0),
      total: cierresReporte.reduce((a, c) => a + Number(c.total), 0),
    }),
    [cierresReporte],
  );

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex gap-1 bg-white rounded-lg border border-gray-200 p-1 w-fit">
        <button
          onClick={() => setTab("dias")}
          className={`px-3 py-1.5 rounded-md text-sm font-medium ${tab === "dias" ? "bg-[var(--acento)] text-white" : "text-gray-500"}`}
        >
          Días
        </button>
        <button
          onClick={() => setTab("pendientes")}
          className={`px-3 py-1.5 rounded-md text-sm font-medium ${tab === "pendientes" ? "bg-[var(--acento)] text-white" : "text-gray-500"}`}
        >
          Pendientes {pendientesAbiertos.length > 0 && `(${pendientesAbiertos.length})`}
        </button>
        <button
          onClick={() => setTab("reporte")}
          className={`px-3 py-1.5 rounded-md text-sm font-medium ${tab === "reporte" ? "bg-[var(--acento)] text-white" : "text-gray-500"}`}
        >
          Reporte
        </button>
      </div>

      {tab === "dias" && (
        <>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={soloConPendientes} onChange={(e) => setSoloConPendientes(e.target.checked)} />
              Solo días con pendientes
            </label>
            <span className="text-sm text-gray-500">
              Recaudo del período: <span className="font-semibold text-tinta">{fmtCOP(totalPeriodo)}</span>
            </span>
          </div>

          <div className="space-y-3">
            {Object.keys(gruposPorMes)
              .sort((a, b) => (a < b ? 1 : -1))
              .map((mes) => {
                const dias = gruposPorMes[mes];
                const abierto = mesesAbiertos.has(mes);
                const [y, m] = mes.split("-");
                return (
                  <div key={mes} className="bg-white rounded-xl border border-gray-200">
                    <button onClick={() => toggleMes(mes)} className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold">
                      <span className="flex items-center gap-2">
                        {abierto ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        {MESES[Number(m) - 1]} {y} ({dias.length})
                      </span>
                      <span className="text-gray-500 font-normal">{fmtCOP(dias.reduce((a, c) => a + Number(c.total), 0))}</span>
                    </button>
                    {abierto && (
                      <div className="border-t border-gray-100 divide-y divide-gray-100">
                        {dias.map((c) => {
                          const consignado = (c.nota_banco_extra ?? "").toLowerCase().includes("consignado");
                          const claveRev = `${c.fecha}|${claveSede}`;
                          return (
                            <div key={c.id} className="flex items-center justify-between px-4 py-3 text-sm flex-wrap gap-2">
                              <button
                                onClick={() => setDetalle(c)}
                                className="flex items-center gap-2 text-left flex-1 min-w-[220px] hover:opacity-70"
                                title="Ver detalle y adjuntar soportes"
                              >
                                <div>
                                  <p className="font-medium text-tinta">{fechaCorta(c.fecha)}</p>
                                  <p className="font-semibold">{fmtCOP(c.total)}</p>
                                </div>
                                <ChevronRight size={14} className="text-gray-300 shrink-0" />
                              </button>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span
                                  className={`text-xs font-semibold px-2 py-0.5 rounded-full text-white ${c.cuadra ? "" : ""}`}
                                  style={{ background: c.cuadra ? "#3E9B6F" : "#C0392B" }}
                                >
                                  {c.cuadra ? "✔ Cuadra" : "Revisar"}
                                </span>
                                {c.errores.length > 0 && (
                                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full text-white" style={{ background: "#C7891F" }}>
                                    {c.errores.length} alerta{c.errores.length > 1 ? "s" : ""}
                                  </span>
                                )}
                                <span
                                  className="text-xs font-semibold px-2 py-0.5 rounded-full text-white"
                                  style={{ background: consignado ? "#009F98" : "#8A8D91" }}
                                >
                                  💰 {consignado ? "Consignado" : "Sin verificar"}
                                </span>
                                {c.consignacion_cuenta2 && (
                                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full text-white" style={{ background: "#7B5AA6" }}>
                                    🏦 Cuenta 2
                                  </span>
                                )}
                                {c.dataf_sin_docs && (
                                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full text-white" style={{ background: "#C0392B" }}>
                                    ⚠ Falta {c.fuente_dataf ?? "Redeban/SPRO Bold"}
                                  </span>
                                )}
                                {c.arqueo === null && (
                                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full text-white" style={{ background: "#C0392B" }}>
                                    ⚠ Falta cierre físico
                                  </span>
                                )}
                                <label className="flex items-center gap-1.5 text-xs text-gray-500 ml-2">
                                  <input type="checkbox" checked={!!revisiones[claveRev]} onChange={() => toggleRevisado(c.fecha)} />
                                  Revisé el cierre físico
                                </label>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            {cierresFiltrados.length === 0 && <p className="text-sm text-gray-400">Sin días en este filtro.</p>}
          </div>
        </>
      )}

      {tab === "pendientes" && (
        <div className="space-y-3">
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {pendientesAbiertos.map((p) => (
              <PendienteRow key={p.clave} item={p} estado={pendientesEstado[p.clave]} onGuardar={marcarPendiente} />
            ))}
            {pendientesAbiertos.length === 0 && <p className="px-4 py-4 text-sm text-gray-400">Sin pendientes abiertos.</p>}
          </div>
          {pendientesResueltos.length > 0 && (
            <details className="bg-white rounded-xl border border-gray-200 p-4">
              <summary className="text-sm font-medium text-gray-500 cursor-pointer">Resueltos ({pendientesResueltos.length})</summary>
              <div className="divide-y divide-gray-100 mt-2">
                {pendientesResueltos.map((p) => (
                  <PendienteRow key={p.clave} item={p} estado={pendientesEstado[p.clave]} onGuardar={marcarPendiente} />
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {tab === "reporte" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Desde</label>
              <input
                type="date"
                value={reporteDesde}
                onChange={(e) => setReporteDesde(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Hasta</label>
              <input
                type="date"
                value={reporteHasta}
                onChange={(e) => setReporteHasta(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {[
              ["Efectivo", reporte.efectivo],
              ["Tarjeta (débito + crédito)", reporte.tarjeta],
              ["Transferencia", reporte.transferencia],
              ["Addi / Sistecrédito", reporte.addi],
            ].map(([label, valor]) => (
              <div key={label} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="text-gray-500">{label}</span>
                <span className="font-semibold">{fmtCOP(valor as number)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between px-4 py-3 text-sm font-semibold bg-gray-50">
              <span>Total ({cierresReporte.length} días)</span>
              <span>{fmtCOP(reporte.total)}</span>
            </div>
          </div>
          <p className="text-xs text-gray-400">
            Basado en lo cargado/auditado en Cierre de Caja para {sedeActiva.nombre} — no en lo facturado en vivo por
            Operación Diaria.
          </p>
        </div>
      )}

      {detalle && <DetalleModal cierre={detalle} onClose={() => setDetalle(null)} claveSede={claveSede} sedeActiva={sedeActiva} onGuardado={cargar} />}
    </div>
  );
}

function PendienteRow({
  item,
  estado,
  onGuardar,
}: {
  item: PendienteItem;
  estado: { resuelto: boolean; solucion: string } | undefined;
  onGuardar: (clave: string, resuelto: boolean, solucion: string) => void;
}) {
  const [solucion, setSolucion] = useState(estado?.solucion ?? "");
  return (
    <div className="px-4 py-3 text-sm space-y-1.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 mr-2">{item.tipo}</span>
          <span className="text-gray-400">{item.fecha}</span>
        </div>
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={estado?.resuelto ?? false}
            onChange={(e) => onGuardar(item.clave, e.target.checked, solucion)}
          />
          Resuelto
        </label>
      </div>
      <p className="text-gray-600">{item.descripcion}</p>
      <input
        value={solucion}
        onChange={(e) => setSolucion(e.target.value)}
        onBlur={() => onGuardar(item.clave, estado?.resuelto ?? false, solucion)}
        placeholder="Solución / nota…"
        className="w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
      />
    </div>
  );
}

const DOCUMENTOS: { campo: keyof CierreCajaRow; label: string }[] = [
  { campo: "url_recibos_caja", label: "Reporte de recibos de caja" },
  { campo: "url_movimientos_banco", label: "Movimientos de cuentas bancarias" },
  { campo: "url_tirilla_datafono", label: "Tirilla de datáfono" },
  { campo: "url_reporte_datafono", label: "Reporte de datáfono" },
];

interface CierreOperacion {
  consignado: boolean;
  comprobante_url: string | null;
  porMedio: Record<string, number>;
}

function DetalleModal({
  cierre,
  onClose,
  claveSede,
  sedeActiva,
  onGuardado,
}: {
  cierre: CierreCajaRow;
  onClose: () => void;
  claveSede: string;
  sedeActiva: Sede;
  onGuardado: () => void;
}) {
  const [operacion, setOperacion] = useState<CierreOperacion | null>(null);
  const [cargandoOperacion, setCargandoOperacion] = useState(true);
  const [subiendo, setSubiendo] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setCargandoOperacion(true);
      const { data: cierreDiario } = await supabase
        .from("cierres_diarios")
        .select("consignado, comprobante_url")
        .eq("sede_id", sedeActiva.id)
        .eq("fecha", cierre.fecha)
        .maybeSingle();

      const { data: pagosData } = await supabase
        .from("cargo_pagos")
        .select("medio_pago, valor, cargos!inner(sede_id, fecha)")
        .eq("cargos.sede_id", sedeActiva.id)
        .eq("cargos.fecha", cierre.fecha)
        .neq("medio_pago", "saldo_favor");
      const porMedio: Record<string, number> = {};
      for (const p of (pagosData as unknown as { medio_pago: string; valor: number }[]) ?? []) {
        porMedio[p.medio_pago] = (porMedio[p.medio_pago] ?? 0) + Number(p.valor);
      }

      setOperacion({
        consignado: cierreDiario?.consignado ?? false,
        comprobante_url: cierreDiario?.comprobante_url ?? null,
        porMedio,
      });
      setCargandoOperacion(false);
    })();
  }, [cierre.fecha, sedeActiva.id]);

  async function subirDocumento(campo: keyof CierreCajaRow, file: File) {
    setSubiendo(campo);
    const path = `cierre-caja/${claveSede}/${cierre.fecha}-${campo}-${file.name}`;
    const { error } = await supabase.storage.from("comprobantes").upload(path, file, { upsert: true });
    if (!error) {
      await supabase.from("cierres_caja").update({ [campo]: path }).eq("id", cierre.id);
      onGuardado();
    }
    setSubiendo(null);
  }

  async function verDocumento(path: string) {
    const { data } = await supabase.storage.from("comprobantes").createSignedUrl(path, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  }

  const totalOperacionEfectivo = operacion?.porMedio["efectivo"] ?? 0;
  const totalOperacionTarjeta = (operacion?.porMedio["tarjeta_debito"] ?? 0) + (operacion?.porMedio["tarjeta_credito"] ?? 0);
  const totalOperacionTransf = operacion?.porMedio["transferencia_debito"] ?? 0;
  const totalOperacionAddi = (operacion?.porMedio["addi"] ?? 0) + (operacion?.porMedio["sistecredito"] ?? 0);

  const filas = [
    { label: "Efectivo", facturado: cierre.efvo_fact, real: cierre.arqueo, diff: cierre.dif_efvo, operacion: totalOperacionEfectivo },
    { label: "Tarjeta", facturado: cierre.tarjeta_fact, real: cierre.dataf_spro, diff: cierre.dif_dataf_bruta, operacion: totalOperacionTarjeta },
    { label: "Transferencia", facturado: cierre.transf_fact, real: cierre.dataf_qr, diff: null, operacion: totalOperacionTransf },
    { label: "Addi / Sistecrédito", facturado: cierre.addi, real: null, diff: null, operacion: totalOperacionAddi },
  ];
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-20">
      <div className="bg-white rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-tinta">{fechaCorta(cierre.fecha)} · {cierre.sede}</h3>
          <button onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="py-1">Medio</th>
                <th className="py-1 text-right">Facturado</th>
                <th className="py-1 text-right">Real</th>
                <th className="py-1 text-right">Diferencia</th>
                <th className="py-1 text-right">Cierre diario (Operación)</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.label} className="border-t border-gray-100">
                  <td className="py-1.5">{f.label}</td>
                  <td className="py-1.5 text-right">{fmtCOP(f.facturado)}</td>
                  <td className="py-1.5 text-right">{f.real === null ? "—" : fmtCOP(f.real)}</td>
                  <td className="py-1.5 text-right">{f.diff === null || f.diff === undefined ? "—" : fmtCOP(f.diff)}</td>
                  <td className="py-1.5 text-right">{cargandoOperacion ? "…" : fmtCOP(f.operacion)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400 -mt-2">
          "Cierre diario (Operación)" es lo que hoy calcula en vivo la pantalla de Cierre diario de Operación Diaria
          para este día, a partir de los cobros reales del ERP — compáralo contra "Facturado" para detectar
          diferencias de digitación.
        </p>

        {!cargandoOperacion && (
          <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm flex items-center justify-between flex-wrap gap-2">
            <span>
              Consignado desde Operación Diaria:{" "}
              <span className="font-medium">{operacion?.consignado ? "Sí" : "No"}</span>
            </span>
            {operacion?.comprobante_url && (
              <button
                onClick={() => verDocumento(operacion.comprobante_url!)}
                className="text-xs font-medium text-[var(--acento)] underline"
              >
                Ver comprobante de consignación
              </button>
            )}
          </div>
        )}

        {[
          ["Explicación datáfono", cierre.dataf_explicacion],
          ["Nota datáfono", cierre.nota_dataf_extra],
          ["Nota transferencia", cierre.nota_transf_extra],
          ["Nota banco / consignación", cierre.nota_banco_extra],
          ["Limitación", cierre.nota_limitacion],
          ["Nota cuenta 2", cierre.nota_cuenta2],
          ["Consignación pendiente", cierre.nota_consignacion_pendiente],
        ]
          .filter(([, v]) => v)
          .map(([label, v]) => (
            <p key={label} className="text-sm">
              <span className="text-gray-500">{label}:</span> {v}
            </p>
          ))}

        {cierre.errores.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1">Errores / sede cruzada</p>
            <div className="space-y-1 text-xs text-gray-600">
              {cierre.errores.map((e, i) => (
                <p key={i}>
                  {e.tipo} · {e.paciente} · {fmtCOP(e.valor)} — {e.sede_recibo}
                </p>
              ))}
            </div>
          </div>
        )}
        {cierre.transfs.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1">Transferencias por verificar</p>
            <div className="space-y-1 text-xs text-gray-600">
              {cierre.transfs.map((t, i) => (
                <p key={i}>
                  {t.paciente} · {fmtCOP(t.valor)}
                </p>
              ))}
            </div>
          </div>
        )}
        {cierre.dups_elec.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1">Posibles duplicados / electrónicos</p>
            <div className="space-y-1 text-xs text-gray-600">
              {cierre.dups_elec.map((d, i) => (
                <p key={i}>
                  {d.paciente} · {fmtCOP(d.valor)} · {d.medio} — {d.nota}
                </p>
              ))}
            </div>
          </div>
        )}
        {cierre.addi_detalle.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1">Addi / Sistecrédito</p>
            <div className="space-y-1 text-xs text-gray-600">
              {cierre.addi_detalle.map((a, i) => (
                <p key={i}>
                  {a.paciente} · {fmtCOP(a.valor)} · {a.medio} {a.nota ? `— ${a.nota}` : ""}
                </p>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="text-xs font-semibold text-gray-500 mb-1.5">Soportes del día</p>
          <div className="space-y-1.5">
            {DOCUMENTOS.map((d) => {
              const url = cierre[d.campo] as string | null;
              return (
                <div
                  key={d.campo}
                  className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm"
                >
                  <span className="text-gray-600">{d.label}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    {url && (
                      <button
                        onClick={() => verDocumento(url)}
                        className="text-xs font-medium text-[var(--acento)] underline"
                      >
                        Ver
                      </button>
                    )}
                    <label className="text-xs font-medium text-gray-500 underline cursor-pointer">
                      {subiendo === d.campo ? "Subiendo…" : url ? "Reemplazar" : "Adjuntar"}
                      <input
                        type="file"
                        className="hidden"
                        disabled={subiendo === d.campo}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) subirDocumento(d.campo, file);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
