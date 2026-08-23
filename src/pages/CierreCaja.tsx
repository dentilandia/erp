import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import { fmtCOP, today } from "../lib/format";
import type { Sede, CierreCaja as CierreCajaRow } from "../lib/types";

const DIAS_SEMANA = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const DIAS_SEMANA_LARGO = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function fechaCorta(fecha: string) {
  const [y, m, d] = fecha.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return `${d} ${MESES[m - 1]} · ${DIAS_SEMANA[dt.getDay()]}`;
}

function fechaTarjeta(fecha: string) {
  const [y, m, d] = fecha.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return { corta: `${d} de ${MESES[m - 1]}`, diaSemana: DIAS_SEMANA_LARGO[dt.getDay()] };
}

function claveSedeDe(sede: Sede) {
  return sede.nombre.includes("Fabricato") ? "Fabricato" : "Las Americas";
}

/** Un día tiene algo pendiente de revisar/resolver. Mismo criterio para el
 *  filtro "Solo días con pendientes" y para la lista de la pestaña Pendientes. */
/** Falta el respaldo del cierre físico de caja: ni el arqueo del histórico
 *  (días viejos) ni el documento de recibos de caja (días nuevos, con el
 *  flujo de adjuntar documentos) están presentes. */
function faltaCierreFisico(c: CierreCajaRow) {
  return c.arqueo === null && !c.url_recibos_caja;
}

/** Falta el respaldo de datáfono: la bandera legacy sigue en true (nunca se
 *  adjuntó nada, ni antes ni ahora) y tampoco hay ninguno de los 2 documentos
 *  de datáfono adjuntos. */
function faltaDatafono(c: CierreCajaRow) {
  return c.dataf_sin_docs && !c.url_tirilla_datafono && !c.url_reporte_datafono;
}

function tienePendientes(c: CierreCajaRow) {
  return (
    !c.cuadra ||
    c.errores.length > 0 ||
    faltaDatafono(c) ||
    faltaCierreFisico(c) ||
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
  if (faltaDatafono(c)) {
    items.push({
      clave: `${base}|Datáfono`,
      fecha: c.fecha,
      tipo: "Datáfono",
      descripcion: `Falta adjuntar la tirilla o el reporte de ${c.fuente_dataf ?? "datáfono"} (tarjeta facturada ${fmtCOP(c.tarjeta_fact)}).`,
    });
  }
  if (faltaCierreFisico(c)) {
    items.push({
      clave: `${base}|Cierre físico`,
      fecha: c.fecha,
      tipo: "Cierre físico",
      descripcion: "Falta adjuntar el reporte de recibos de caja de este día.",
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
  const [tab, setTab] = useState<"dias" | "pendientes" | "reporte" | "hacer">("dias");
  const [detalle, setDetalle] = useState<CierreCajaRow | null>(null);
  const [mesesAbiertos, setMesesAbiertos] = useState<Set<string>>(new Set());
  const [consignadosReales, setConsignadosReales] = useState<Record<string, boolean>>({});
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

    // Estado real de "Día consignado", tal como lo marca Operación Diaria en Cierre
    // diario — reemplaza el texto libre de nota_banco_extra del histórico importado,
    // que no se actualiza con los días nuevos y por eso mostraba "Sin verificar" mal.
    const { data: consignadosData } = await supabase.from("cierres_diarios").select("fecha, consignado").eq("sede_id", sedeActiva.id);
    const mapaConsignado: Record<string, boolean> = {};
    (consignadosData ?? []).forEach((r) => (mapaConsignado[r.fecha] = r.consignado));
    setConsignadosReales(mapaConsignado);

    setMesesAbiertos((prev) => {
      if (prev.size > 0) return prev;
      const mesesConFaltantes = new Set(filas.filter((c) => faltaDatafono(c) || faltaCierreFisico(c)).map((c) => c.fecha.slice(0, 7)));
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
      .on("postgres_changes", { event: "*", schema: "public", table: "cierres_diarios", filter: `sede_id=eq.${sedeActiva.id}` }, cargar)
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
        <button
          onClick={() => setTab("hacer")}
          className={`px-3 py-1.5 rounded-md text-sm font-medium ${tab === "hacer" ? "bg-[var(--acento)] text-white" : "text-gray-500"}`}
        >
          Hacer cierre
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
                      <div className="border-t border-gray-100 p-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                        {dias.map((c) => {
                          const consignado = consignadosReales[c.fecha] ?? false;
                          const claveRev = `${c.fecha}|${claveSede}`;
                          const { corta, diaSemana } = fechaTarjeta(c.fecha);
                          return (
                            <div key={c.id} className="rounded-xl border border-gray-200 bg-white p-3 flex flex-col gap-2">
                              <button onClick={() => setDetalle(c)} className="text-left hover:opacity-70" title="Ver detalle y adjuntar soportes">
                                <p className="text-sm font-semibold text-tinta">{corta}</p>
                                <p className="text-xs font-medium" style={{ color: "var(--acento)" }}>
                                  {diaSemana} · {claveSede}
                                </p>
                                <p className="text-lg font-bold text-tinta mt-1">{fmtCOP(c.total)}</p>
                              </button>
                              <div className="flex flex-wrap gap-1">
                                <span
                                  className="text-xs font-semibold px-2 py-0.5 rounded-full text-white"
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
                                {faltaDatafono(c) && (
                                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full text-white" style={{ background: "#C0392B" }}>
                                    ⚠ Falta {c.fuente_dataf ?? "tirilla/reporte de datáfono"}
                                  </span>
                                )}
                                {faltaCierreFisico(c) && (
                                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full text-white" style={{ background: "#C0392B" }}>
                                    ⚠ Falta cierre físico
                                  </span>
                                )}
                              </div>
                              <label className="flex items-center gap-1.5 text-xs text-gray-500 pt-1.5 border-t border-gray-100">
                                <input type="checkbox" checked={!!revisiones[claveRev]} onChange={() => toggleRevisado(c.fecha)} />
                                Revisé el cierre físico
                              </label>
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

      {tab === "hacer" && (
        <FormularioCierre cierres={cierres} claveSede={claveSede} sedeActiva={sedeActiva} onGuardado={cargar} />
      )}

      {detalle && <DetalleModal cierre={detalle} onClose={() => setDetalle(null)} claveSede={claveSede} sedeActiva={sedeActiva} onGuardado={cargar} />}
    </div>
  );
}

interface FormCierre {
  efvo_fact: string;
  tarjeta_fact: string;
  transf_fact: string;
  addi: string;
  gasto: string;
  transf_directa: string;
  cuadra: boolean;
  transf_por_verificar: boolean;
  transf_sin_banco: boolean;
  urgente_transf: boolean;
  consignacion_cuenta2: boolean;
  fuente_dataf: string;
  fuente_transf: string;
  nota_dataf_extra: string;
  nota_transf_extra: string;
  nota_banco_extra: string;
  nota_limitacion: string;
  nota_cuenta2: string;
  nota_consignacion_pendiente: string;
}

const FORM_VACIO: FormCierre = {
  efvo_fact: "0",
  tarjeta_fact: "0",
  transf_fact: "0",
  addi: "0",
  gasto: "",
  transf_directa: "0",
  cuadra: false,
  transf_por_verificar: false,
  transf_sin_banco: false,
  urgente_transf: false,
  consignacion_cuenta2: false,
  fuente_dataf: "",
  fuente_transf: "",
  nota_dataf_extra: "",
  nota_transf_extra: "",
  nota_banco_extra: "",
  nota_limitacion: "",
  nota_cuenta2: "",
  nota_consignacion_pendiente: "",
};

function FormularioCierre({
  cierres,
  claveSede,
  sedeActiva,
  onGuardado,
}: {
  cierres: CierreCajaRow[];
  claveSede: string;
  sedeActiva: Sede;
  onGuardado: () => void;
}) {
  const [fecha, setFecha] = useState(today());
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [form, setForm] = useState<FormCierre>(FORM_VACIO);
  const [addiDetalleAuto, setAddiDetalleAuto] = useState<{ paciente: string; valor: number; medio: string }[]>([]);
  const [subiendoDoc, setSubiendoDoc] = useState<string | null>(null);
  const [procesandoIA, setProcesandoIA] = useState(false);
  const [errorIA, setErrorIA] = useState<string | null>(null);

  const existente = cierres.find((c) => c.fecha === fecha) ?? null;

  async function procesarConIA() {
    if (!existente) return;
    setProcesandoIA(true);
    setErrorIA(null);
    try {
      const { data, error } = await supabase.functions.invoke("procesar-cierre-ia", { body: { cierre_id: existente.id } });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Error desconocido procesando el cierre.");
      onGuardado();
    } catch (e) {
      setErrorIA(e instanceof Error ? e.message : "No se pudo procesar el cierre con IA.");
    } finally {
      setProcesandoIA(false);
    }
  }

  async function facturadoDesdeErp() {
    const { data: pagosData } = await supabase
      .from("cargo_pagos")
      .select("medio_pago, valor, cargos!inner(sede_id, fecha, visitas(pacientes(nombre)))")
      .eq("cargos.sede_id", sedeActiva.id)
      .eq("cargos.fecha", fecha)
      .neq("medio_pago", "saldo_favor");
    const filas =
      (pagosData as unknown as {
        medio_pago: string;
        valor: number;
        cargos: { visitas: { pacientes: { nombre: string } | null } | null };
      }[]) ?? [];
    const porMedio: Record<string, number> = {};
    for (const p of filas) porMedio[p.medio_pago] = (porMedio[p.medio_pago] ?? 0) + Number(p.valor);

    // Saldos a favor creados sin cita (ej. anticipo de sedación pagado por
    // teléfono) son plata real del día pero no tienen cargo — hay que sumarlos
    // aparte, igual que ya hace Cierre diario en Operación.
    const { data: saldosData } = await supabase
      .from("saldos_favor")
      .select("valor, medio_origen, pacientes(nombre)")
      .eq("sede_origen_id", sedeActiva.id)
      .eq("fecha", fecha)
      .neq("medio_origen", "ajuste_manual");
    const saldosFilas = (saldosData as unknown as { valor: number; medio_origen: string; pacientes: { nombre: string } | null }[]) ?? [];
    for (const s of saldosFilas) porMedio[s.medio_origen] = (porMedio[s.medio_origen] ?? 0) + Number(s.valor);

    const addiDetalle = [
      ...filas
        .filter((p) => p.medio_pago === "addi" || p.medio_pago === "sistecredito")
        .map((p) => ({
          paciente: p.cargos.visitas?.pacientes?.nombre ?? "—",
          valor: Number(p.valor),
          medio: p.medio_pago === "addi" ? "Addi" : "Sistecrédito",
        })),
      ...saldosFilas
        .filter((s) => s.medio_origen === "addi" || s.medio_origen === "sistecredito")
        .map((s) => ({
          paciente: s.pacientes?.nombre ?? "—",
          valor: Number(s.valor),
          medio: s.medio_origen === "addi" ? "Addi" : "Sistecrédito",
        })),
    ];
    return {
      efectivo: porMedio["efectivo"] ?? 0,
      tarjeta: (porMedio["tarjeta_debito"] ?? 0) + (porMedio["tarjeta_credito"] ?? 0),
      transferencia: porMedio["transferencia_debito"] ?? 0,
      addi: (porMedio["addi"] ?? 0) + (porMedio["sistecredito"] ?? 0),
      addiDetalle,
    };
  }

  useEffect(() => {
    (async () => {
      setCargando(true);
      setMensaje(null);
      const erp = await facturadoDesdeErp();
      setAddiDetalleAuto(erp.addiDetalle);
      const ex = cierres.find((c) => c.fecha === fecha) ?? null;
      if (ex) {
        setForm({
          efvo_fact: String(ex.efvo_fact),
          tarjeta_fact: String(ex.tarjeta_fact),
          transf_fact: String(ex.transf_fact),
          addi: String(ex.addi),
          gasto: ex.gasto === null || ex.gasto === undefined ? "" : String(ex.gasto),
          transf_directa: String(ex.transf_directa),
          cuadra: ex.cuadra,
          transf_por_verificar: ex.transf_por_verificar,
          transf_sin_banco: ex.transf_sin_banco,
          urgente_transf: ex.urgente_transf,
          consignacion_cuenta2: ex.consignacion_cuenta2,
          fuente_dataf: ex.fuente_dataf ?? "",
          fuente_transf: ex.fuente_transf ?? "",
          nota_dataf_extra: ex.nota_dataf_extra ?? "",
          nota_transf_extra: ex.nota_transf_extra ?? "",
          nota_banco_extra: ex.nota_banco_extra ?? "",
          nota_limitacion: ex.nota_limitacion ?? "",
          nota_cuenta2: ex.nota_cuenta2 ?? "",
          nota_consignacion_pendiente: ex.nota_consignacion_pendiente ?? "",
        });
      } else {
        setForm({
          ...FORM_VACIO,
          efvo_fact: String(erp.efectivo),
          tarjeta_fact: String(erp.tarjeta),
          transf_fact: String(erp.transferencia),
          addi: String(erp.addi),
        });
      }
      setCargando(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fecha, sedeActiva.id]);

  async function recalcularDesdeErp() {
    const erp = await facturadoDesdeErp();
    setAddiDetalleAuto(erp.addiDetalle);
    setForm((f) => ({
      ...f,
      efvo_fact: String(erp.efectivo),
      tarjeta_fact: String(erp.tarjeta),
      transf_fact: String(erp.transferencia),
      addi: String(erp.addi),
    }));
  }

  function campo<K extends keyof FormCierre>(k: K, v: FormCierre[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  const efvo_fact = Number(form.efvo_fact) || 0;
  const tarjeta_fact = Number(form.tarjeta_fact) || 0;
  const transf_fact = Number(form.transf_fact) || 0;
  const addi = Number(form.addi) || 0;
  const total = efvo_fact + tarjeta_fact + transf_fact + addi;

  async function subirDoc(campo: keyof CierreCajaRow, file: File) {
    if (!existente) return;
    setSubiendoDoc(campo);
    const { error } = await subirDocumentoCierre(existente.id, claveSede, fecha, campo, file);
    if (error) window.alert(`No se pudo subir el documento: ${error.message}`);
    else onGuardado();
    setSubiendoDoc(null);
  }

  async function guardar() {
    setGuardando(true);
    setMensaje(null);
    const { error } = await supabase.from("cierres_caja").upsert(
      {
        fecha,
        sede: claveSede,
        efvo_fact,
        tarjeta_fact,
        transf_fact,
        addi,
        total,
        cuadra: form.cuadra,
        transf_directa: Number(form.transf_directa) || 0,
        transf_por_verificar: form.transf_por_verificar,
        transf_sin_banco: form.transf_sin_banco,
        urgente_transf: form.urgente_transf,
        gasto: form.gasto === "" ? null : Number(form.gasto),
        fuente_dataf: form.fuente_dataf || null,
        fuente_transf: form.fuente_transf || null,
        nota_dataf_extra: form.nota_dataf_extra || null,
        nota_transf_extra: form.nota_transf_extra || null,
        nota_banco_extra: form.nota_banco_extra || null,
        nota_limitacion: form.nota_limitacion || null,
        nota_cuenta2: form.nota_cuenta2 || null,
        consignacion_cuenta2: form.consignacion_cuenta2,
        nota_consignacion_pendiente: form.nota_consignacion_pendiente || null,
        // El cuadre ya no se digita a mano (arqueo/datáfono/banco) — se valida
        // adjuntando los documentos de abajo. Estos campos legacy se preservan
        // tal cual si el día ya existía (histórico anterior a este cambio).
        arqueo: existente?.arqueo ?? null,
        dataf_spro: existente?.dataf_spro ?? null,
        dataf_qr: existente?.dataf_qr ?? null,
        dif_efvo: existente?.dif_efvo ?? 0,
        dif_dataf_bruta: existente?.dif_dataf_bruta ?? null,
        dif_dataf_neta: existente?.dif_dataf_neta ?? null,
        dataf_explicado: existente?.dataf_explicado ?? false,
        dataf_explicacion: existente?.dataf_explicacion ?? null,
        dataf_sin_docs: existente ? existente.dataf_sin_docs : true,
        monto_cruzado: existente?.monto_cruzado ?? 0,
        errores: existente?.errores ?? [],
        transfs: existente?.transfs ?? [],
        dups_elec: existente?.dups_elec ?? [],
        addi_detalle: addiDetalleAuto,
      },
      { onConflict: "fecha,sede" },
    );
    setGuardando(false);
    if (error) {
      setMensaje(`Error al guardar: ${error.message}`);
    } else {
      setMensaje("Cierre guardado ✓");
      onGuardado();
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4 max-w-2xl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-semibold text-tinta">Hacer el cierre — {sedeActiva.nombre}</h3>
          <p className="text-xs text-gray-400">{existente ? "Editando un cierre ya guardado para este día." : "Cierre nuevo para este día."}</p>
        </div>
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      </div>

      {cargando ? (
        <p className="text-sm text-gray-400">Cargando…</p>
      ) : (
        <>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-semibold text-gray-500">Facturado (traído del ERP — puedes corregirlo)</p>
              <button onClick={recalcularDesdeErp} className="text-xs font-medium text-[var(--acento)] underline">
                ↺ Recalcular desde ERP
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(
                [
                  ["efvo_fact", "Efectivo"],
                  ["tarjeta_fact", "Tarjeta"],
                  ["transf_fact", "Transferencia"],
                  ["addi", "Addi/Sistecrédito"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="text-xs text-gray-500">
                  {label}
                  <input
                    type="number"
                    value={form[k]}
                    onChange={(e) => campo(k, e.target.value)}
                    className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1.5">Documentos del cierre (esto es lo que valida el cuadre)</p>
            {!existente ? (
              <p className="text-xs text-gray-400 rounded-lg border border-dashed border-gray-300 p-3">
                Guarda el cierre primero (botón de abajo) para poder adjuntar aquí los documentos de este día.
              </p>
            ) : (
              <div className="space-y-1.5">
                {DOCUMENTOS.map((d) => {
                  const url = existente[d.campo] as string | null;
                  return (
                    <div key={d.campo} className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm">
                      <span className="text-gray-600">{d.label}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        {url && (
                          <button onClick={() => verDocumentoCierre(url)} className="text-xs font-medium text-[var(--acento)] underline">
                            Ver
                          </button>
                        )}
                        <label className="text-xs font-medium text-gray-500 underline cursor-pointer">
                          {subiendoDoc === d.campo ? "Subiendo…" : url ? "Reemplazar" : "Adjuntar"}
                          <input
                            type="file"
                            className="hidden"
                            disabled={subiendoDoc === d.campo}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) subirDoc(d.campo, file);
                              e.target.value = "";
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {existente && (existente.url_recibos_caja || existente.url_movimientos_banco || existente.url_tirilla_datafono || existente.url_reporte_datafono) && (
            <div className="rounded-lg border border-dashed border-gray-300 p-3 space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-xs font-medium text-gray-500">
                  Claude puede leer los documentos de arriba y sugerir los totales reales
                </p>
                <button
                  onClick={procesarConIA}
                  disabled={procesandoIA}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-[var(--acento)] text-white disabled:opacity-40"
                >
                  {procesandoIA ? "Procesando…" : "✨ Procesar con IA"}
                </button>
              </div>
              {errorIA && <p className="text-xs text-red-600">{errorIA}</p>}
              {existente.analisis_ia && (
                <div className="rounded-lg bg-gray-50 p-3 text-sm space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Efectivo real (IA)</span>
                    <span>{existente.analisis_ia.efectivo_real === null ? "—" : fmtCOP(existente.analisis_ia.efectivo_real)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Datáfono real (IA)</span>
                    <span>{existente.analisis_ia.datafono_real === null ? "—" : fmtCOP(existente.analisis_ia.datafono_real)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Banco consignado (IA)</span>
                    <span>{existente.analisis_ia.banco_consignado === null ? "—" : fmtCOP(existente.analisis_ia.banco_consignado)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Diferencia efectivo</span>
                    <span className={existente.analisis_ia.diferencia_efectivo ? "text-red-600 font-medium" : ""}>
                      {existente.analisis_ia.diferencia_efectivo === null ? "—" : fmtCOP(existente.analisis_ia.diferencia_efectivo)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Diferencia datáfono</span>
                    <span className={existente.analisis_ia.diferencia_datafono ? "text-red-600 font-medium" : ""}>
                      {existente.analisis_ia.diferencia_datafono === null ? "—" : fmtCOP(existente.analisis_ia.diferencia_datafono)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 pt-1 border-t border-gray-200">{existente.analisis_ia.resumen}</p>
                  <p className="text-xs text-gray-400">
                    Sugerencia de la IA — revísala y marca tú mismo el check "Cuadra" más abajo, no se marca sola.
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-gray-500">
              Gasto del día
              <input
                type="number"
                value={form.gasto}
                onChange={(e) => campo("gasto", e.target.value)}
                className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-xs text-gray-500">
              Transferencia directa a cuenta
              <input
                type="number"
                value={form.transf_directa}
                onChange={(e) => campo("transf_directa", e.target.value)}
                className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-gray-500">
              Fuente datáfono
              <input
                value={form.fuente_dataf}
                onChange={(e) => campo("fuente_dataf", e.target.value)}
                placeholder="SPRO Bold / Redeban"
                className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-xs text-gray-500">
              Fuente transferencia
              <input
                value={form.fuente_transf}
                onChange={(e) => campo("fuente_transf", e.target.value)}
                placeholder="QR Bold / Bancolombia"
                className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              />
            </label>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1.5">Banderas</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {(
                [
                  ["transf_por_verificar", "Transferencia por verificar"],
                  ["transf_sin_banco", "Transferencia sin banco"],
                  ["urgente_transf", "Urgente transferencia"],
                  ["consignacion_cuenta2", "Consignación a cuenta 2"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" checked={form[k]} onChange={(e) => campo(k, e.target.checked)} />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1.5">Notas</p>
            <div className="space-y-1.5">
              {(
                [
                  ["nota_dataf_extra", "Nota datáfono extra"],
                  ["nota_transf_extra", "Nota transferencia extra"],
                  ["nota_banco_extra", "Nota banco / consignación"],
                  ["nota_limitacion", "Limitación"],
                  ["nota_cuenta2", "Nota cuenta 2"],
                  ["nota_consignacion_pendiente", "Consignación pendiente"],
                ] as const
              ).map(([k, label]) => (
                <input
                  key={k}
                  value={form[k]}
                  onChange={(e) => campo(k, e.target.value)}
                  placeholder={label}
                  className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                />
              ))}
            </div>
          </div>

          <p className="text-xs text-gray-400">
            Los cruces entre sede, posibles duplicados y transferencias específicas por verificar todavía no tienen un
            editor propio — mientras tanto regístralos en las notas de arriba. El Addi/Sistecrédito del día
            ({addiDetalleAuto.length} registro{addiDetalleAuto.length === 1 ? "" : "s"}) se recalcula automáticamente
            desde el ERP al guardar.
          </p>

          <div className="rounded-lg bg-gray-50 px-3 py-2.5 text-sm space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Total facturado (Operación)</span>
              <span className="font-semibold">{fmtCOP(total)}</span>
            </div>
            <label className="flex items-center gap-2 pt-2 border-t border-gray-100">
              <input type="checkbox" checked={form.cuadra} onChange={(e) => campo("cuadra", e.target.checked)} />
              <span className={`font-semibold ${form.cuadra ? "text-[#3E9B6F]" : "text-red-600"}`}>
                {form.cuadra ? "✔ Cuadra" : "Revisar"}
              </span>
              <span className="text-xs text-gray-400">— marca esto tú mismo después de comparar el total contra los documentos adjuntos</span>
            </label>
          </div>

          {mensaje && <p className={`text-sm ${mensaje.startsWith("Error") ? "text-red-600" : "text-[var(--acento)]"}`}>{mensaje}</p>}

          <button
            onClick={guardar}
            disabled={guardando}
            className="w-full rounded-lg bg-[var(--acento)] text-white py-2.5 text-sm font-medium disabled:opacity-40"
          >
            {guardando ? "Guardando…" : existente ? "Actualizar cierre" : "Guardar cierre"}
          </button>
        </>
      )}
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
  { campo: "url_recibos_caja", label: "Reporte de recibos de caja (Oral Drive)" },
  { campo: "url_movimientos_banco", label: "Movimientos de cuentas bancarias" },
  { campo: "url_tirilla_datafono", label: "Tirilla de datáfono" },
  { campo: "url_reporte_datafono", label: "Reporte de datáfono" },
];

/** Sube un soporte del día y lo asocia al cierre. Si es un documento de
 *  datáfono, apaga automáticamente la bandera legacy "dataf_sin_docs" —
 *  el cuadre ahora se valida adjuntando el archivo, no digitando un monto. */
async function subirDocumentoCierre(cierreId: string, claveSede: string, fecha: string, campo: keyof CierreCajaRow, file: File) {
  const path = `cierre-caja/${claveSede}/${fecha}-${campo}-${file.name}`;
  const { error: errorSubida } = await supabase.storage.from("comprobantes").upload(path, file, { upsert: true });
  if (errorSubida) return { error: errorSubida };
  const cambios: Record<string, unknown> = { [campo]: path };
  if (campo === "url_tirilla_datafono" || campo === "url_reporte_datafono") cambios.dataf_sin_docs = false;
  const { error: errorGuardado } = await supabase.from("cierres_caja").update(cambios).eq("id", cierreId);
  return { error: errorGuardado };
}

async function verDocumentoCierre(path: string) {
  const { data } = await supabase.storage.from("comprobantes").createSignedUrl(path, 60);
  if (data?.signedUrl) window.open(data.signedUrl, "_blank");
}

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

      // Saldos a favor creados sin cita (anticipos pagados sin que el paciente
      // se haya atendido) también son plata real del día, aunque no tengan cargo.
      const { data: saldosData } = await supabase
        .from("saldos_favor")
        .select("valor, medio_origen")
        .eq("sede_origen_id", sedeActiva.id)
        .eq("fecha", cierre.fecha)
        .neq("medio_origen", "ajuste_manual");
      for (const s of (saldosData as unknown as { valor: number; medio_origen: string }[]) ?? []) {
        porMedio[s.medio_origen] = (porMedio[s.medio_origen] ?? 0) + Number(s.valor);
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
    const { error } = await subirDocumentoCierre(cierre.id, claveSede, cierre.fecha, campo, file);
    if (error) {
      window.alert(`No se pudo subir el documento: ${error.message}`);
    } else {
      onGuardado();
    }
    setSubiendo(null);
  }

  const verDocumento = verDocumentoCierre;

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
