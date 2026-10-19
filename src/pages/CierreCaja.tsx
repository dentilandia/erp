import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import { fmtCOP, today } from "../lib/format";
import type { Sede, CierreCaja as CierreCajaRow, CierreCajaSemana } from "../lib/types";

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

function sumarDiasCal(fechaYMD: string, dias: number): string {
  const [y, m, d] = fechaYMD.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + dias);
  return dt.toISOString().slice(0, 10);
}

function lunesDeSemana(fechaYMD: string): string {
  const [y, m, d] = fechaYMD.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay();
  dt.setUTCDate(dt.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return dt.toISOString().slice(0, 10);
}

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

interface FinanciacionDia {
  suma: number;
  sinComprobante: number;
}

/** Cruza el Addi/Sistecrédito facturado ese día×sede contra lo que de verdad
 *  está cargado en Financiación (cargo_pagos + saldos_favor, con la imagen de
 *  la solicitud del crédito adjunta) — ya no basta con que el ERP tenga un
 *  monto en addi para considerarlo verificado. */
function pendienteAddi(c: CierreCajaRow, financiacion: Record<string, FinanciacionDia>): string | null {
  if (c.addi <= 0) return null;
  const datos = financiacion[`${c.fecha}|${c.sede}`];
  if (!datos || datos.suma === 0) {
    return `Facturado ${fmtCOP(c.addi)} en Addi/Sistecrédito, pero no hay ningún crédito cargado en Financiación para este día — faltan por cargar.`;
  }
  const diferencia = c.addi - datos.suma;
  if (Math.abs(diferencia) >= 1) {
    return `Diferencia de ${fmtCOP(diferencia)} entre lo facturado en Addi/Sistecrédito (${fmtCOP(c.addi)}) y lo cargado en Financiación (${fmtCOP(datos.suma)}).`;
  }
  if (datos.sinComprobante > 0) {
    return `Falta adjuntar la solicitud del crédito de ${datos.sinComprobante} registro${datos.sinComprobante > 1 ? "s" : ""} en Financiación.`;
  }
  return null;
}

function tienePendientes(c: CierreCajaRow, financiacion: Record<string, FinanciacionDia>) {
  return (
    !c.cuadra ||
    c.errores.length > 0 ||
    faltaDatafono(c) ||
    faltaCierreFisico(c) ||
    (!!c.dif_dataf_bruta && !c.dataf_explicado) ||
    pendienteAddi(c, financiacion) !== null ||
    !!c.nota_consignacion_pendiente
  );
}

interface PendienteItem {
  clave: string;
  fecha: string;
  sede: string;
  tipo: string;
  descripcion: string;
}

/** El panel ahora es gerencial (ambas sedes a la vez, con filtro de pastilla
 *  encima), así que cada pendiente lleva su propia sede en vez de asumir una
 *  sola fija para toda la página. */
function pendientesDe(c: CierreCajaRow, financiacion: Record<string, FinanciacionDia>): PendienteItem[] {
  const items: PendienteItem[] = [];
  const base = `${c.fecha}|${c.sede}`;
  if (faltaDatafono(c)) {
    items.push({
      clave: `${base}|Datáfono`,
      fecha: c.fecha,
      sede: c.sede,
      tipo: "Datáfono",
      descripcion: `Falta adjuntar la tirilla o el reporte de ${c.fuente_dataf ?? "datáfono"} (tarjeta facturada ${fmtCOP(c.tarjeta_fact)}).`,
    });
  }
  if (faltaCierreFisico(c)) {
    items.push({
      clave: `${base}|Cierre físico`,
      fecha: c.fecha,
      sede: c.sede,
      tipo: "Cierre físico",
      descripcion: "Falta adjuntar el reporte de recibos de caja de este día.",
    });
  }
  if (c.dif_dataf_bruta && !c.dataf_explicado) {
    items.push({
      clave: `${base}|Diferencia datáfono`,
      fecha: c.fecha,
      sede: c.sede,
      tipo: "Diferencia datáfono",
      descripcion: `Diferencia de ${fmtCOP(c.dif_dataf_bruta)} sin explicar entre tarjeta facturada y ${c.fuente_dataf ?? "datáfono"}.`,
    });
  }
  const addiDescripcion = pendienteAddi(c, financiacion);
  if (addiDescripcion) {
    items.push({
      clave: `${base}|Addi/Sistecrédito`,
      fecha: c.fecha,
      sede: c.sede,
      tipo: "Addi/Sistecrédito",
      descripcion: addiDescripcion,
    });
  }
  if (c.nota_consignacion_pendiente) {
    items.push({
      clave: `${base}|Consignación`,
      fecha: c.fecha,
      sede: c.sede,
      tipo: "Consignación",
      descripcion: c.nota_consignacion_pendiente,
    });
  }
  return items;
}

type TabCierre = "cuadre" | "pendientes" | "errores";
type SedeFiltro = "todas" | "Fabricato" | "Las Americas";
type Preset = "todo" | "7" | "mes" | "custom";

export function CierreCaja() {
  const [cierres, setCierres] = useState<CierreCajaRow[]>([]);
  const [sedes, setSedes] = useState<Sede[]>([]);
  const [revisiones, setRevisiones] = useState<Record<string, boolean>>({});
  const [pendientesEstado, setPendientesEstado] = useState<Record<string, { resuelto: boolean; solucion: string }>>({});
  const [consignadosReales, setConsignadosReales] = useState<Record<string, { consignado: boolean; entregado_admin: boolean }>>({});
  const [financiacionPorDiaSede, setFinanciacionPorDiaSede] = useState<Record<string, FinanciacionDia>>({});
  const [soloConPendientes, setSoloConPendientes] = useState(false);
  const [tab, setTab] = useState<TabCierre>("cuadre");
  const [sedeFiltro, setSedeFiltro] = useState<SedeFiltro>("todas");
  const [preset, setPreset] = useState<Preset>("todo");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [detalle, setDetalle] = useState<CierreCajaRow | null>(null);
  const [mesesAbiertos, setMesesAbiertos] = useState<Set<string>>(new Set());

  /** Carga todo desde cero cada vez — no depende de estado externo, así que
   *  la misma referencia sirve tanto para la carga inicial como para el
   *  handler del canal realtime, sin arrastrar closures viejos. */
  async function cargar() {
    const { data: sedesData } = await supabase.from("sedes").select("id, nombre, color_acento").order("nombre");
    const listaSedes = (sedesData as Sede[]) ?? [];
    setSedes(listaSedes);

    const { data } = await supabase.from("cierres_caja").select("*").order("fecha", { ascending: false });
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
    // que no se actualiza con los días nuevos. Ahora cubre ambas sedes a la vez.
    if (listaSedes.length > 0) {
      const { data: consignadosData } = await supabase
        .from("cierres_diarios")
        .select("fecha, sede_id, consignado, entregado_admin")
        .in(
          "sede_id",
          listaSedes.map((s) => s.id),
        );
      const mapaConsignado: Record<string, { consignado: boolean; entregado_admin: boolean }> = {};
      (consignadosData ?? []).forEach((r) => {
        const sede = listaSedes.find((s) => s.id === r.sede_id);
        if (!sede) return;
        mapaConsignado[`${r.fecha}|${claveSedeDe(sede)}`] = { consignado: r.consignado, entregado_admin: r.entregado_admin };
      });
      setConsignadosReales(mapaConsignado);
    }

    // Cruce de Addi/Sistecrédito contra Financiación: lo facturado ese día×sede
    // ya no se da por verificado solo porque el ERP tenga un monto — hay que
    // confirmar que de verdad esté cargado ahí (y con la solicitud adjunta).
    {
      const { data: cargosAddiData } = await supabase
        .from("cargo_pagos")
        .select("valor, comprobante_financiacion_url, cargos!inner(fecha, sedes(nombre))")
        .in("medio_pago", ["addi", "sistecredito"]);
      const { data: saldosAddiData } = await supabase
        .from("saldos_favor")
        .select("valor, comprobante_financiacion_url, fecha, sedes:sede_origen_id(nombre)")
        .in("medio_origen", ["addi", "sistecredito"]);

      const mapaFinanciacion: Record<string, FinanciacionDia> = {};
      const acumular = (fecha: string | undefined, nombreSede: string | null | undefined, valor: number, tieneComprobante: boolean) => {
        if (!fecha || !nombreSede) return;
        const clave = `${fecha}|${nombreSede.includes("Fabricato") ? "Fabricato" : "Las Americas"}`;
        const actual = mapaFinanciacion[clave] ?? { suma: 0, sinComprobante: 0 };
        actual.suma += valor;
        if (!tieneComprobante) actual.sinComprobante += 1;
        mapaFinanciacion[clave] = actual;
      };
      (
        (cargosAddiData as unknown as {
          valor: number;
          comprobante_financiacion_url: string | null;
          cargos: { fecha: string; sedes: { nombre: string } | null };
        }[]) ?? []
      ).forEach((f) => acumular(f.cargos.fecha, f.cargos.sedes?.nombre, Number(f.valor), !!f.comprobante_financiacion_url));
      (
        (saldosAddiData as unknown as {
          valor: number;
          comprobante_financiacion_url: string | null;
          fecha: string;
          sedes: { nombre: string } | null;
        }[]) ?? []
      ).forEach((s) => acumular(s.fecha, s.sedes?.nombre, Number(s.valor), !!s.comprobante_financiacion_url));
      setFinanciacionPorDiaSede(mapaFinanciacion);
    }

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
      .channel("cierres_caja_gerencial")
      .on("postgres_changes", { event: "*", schema: "public", table: "cierres_caja" }, cargar)
      .on("postgres_changes", { event: "*", schema: "public", table: "cierres_diarios" }, cargar)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleRevisado(fecha: string, sede: string) {
    const clave = `${fecha}|${sede}`;
    const nuevo = !revisiones[clave];
    setRevisiones((prev) => ({ ...prev, [clave]: nuevo }));
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase.from("cierres_revision_fisica").upsert(
      { fecha, sede, revisado: nuevo, revisado_por: user?.id ?? null, revisado_en: nuevo ? new Date().toISOString() : null },
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

  function enRango(fecha: string) {
    if (desde && fecha < desde) return false;
    if (hasta && fecha > hasta) return false;
    return true;
  }

  function aplicarPreset(p: Preset) {
    setPreset(p);
    if (p === "todo") {
      setDesde("");
      setHasta("");
    } else if (p === "7") {
      setDesde(sumarDiasCal(today(), -6));
      setHasta(today());
    } else if (p === "mes") {
      setDesde(today().slice(0, 8) + "01");
      setHasta(today());
    }
  }

  const cierresPeriodoSede = useMemo(
    () => cierres.filter((c) => enRango(c.fecha) && (sedeFiltro === "todas" || c.sede === sedeFiltro)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cierres, desde, hasta, sedeFiltro],
  );

  const cierresFiltrados = useMemo(
    () => (soloConPendientes ? cierresPeriodoSede.filter((c) => tienePendientes(c, financiacionPorDiaSede)) : cierresPeriodoSede),
    [cierresPeriodoSede, soloConPendientes, financiacionPorDiaSede],
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

  const totalPeriodo = cierresPeriodoSede.reduce((a, c) => a + Number(c.total), 0);
  const diasCuadrados = cierresPeriodoSede.filter((c) => c.cuadra).length;

  const pendientesTodos = useMemo(
    () => cierresPeriodoSede.flatMap((c) => pendientesDe(c, financiacionPorDiaSede)),
    [cierresPeriodoSede, financiacionPorDiaSede],
  );
  const pendientesAbiertos = pendientesTodos.filter((p) => !pendientesEstado[p.clave]?.resuelto);
  const pendientesResueltos = pendientesTodos.filter((p) => pendientesEstado[p.clave]?.resuelto);

  // Las dos "alertas" pedidas: transferencias que todavía no se identifican
  // contra ningún recibo (transfs) y el resto de hallazgos de cuadre, que
  // incluyen plata que sobra en el banco sin recibo, sede cruzada, duplicados, etc.
  const transferenciasPorVerificar = useMemo(
    () => cierresPeriodoSede.flatMap((c) => c.transfs.map((t, i) => ({ ...t, fecha: c.fecha, sede: c.sede, _k: i }))),
    [cierresPeriodoSede],
  );
  const erroresCuadre = useMemo(
    () => cierresPeriodoSede.flatMap((c) => c.errores.map((e, i) => ({ ...e, fecha: c.fecha, sede: c.sede, _k: i }))),
    [cierresPeriodoSede],
  );
  const dupsElectronicos = useMemo(
    () => cierresPeriodoSede.flatMap((c) => c.dups_elec.map((d, i) => ({ ...d, fecha: c.fecha, sede: c.sede, _k: i }))),
    [cierresPeriodoSede],
  );

  const promedioPorSede = useMemo(() => {
    return (["Fabricato", "Las Americas"] as const).map((s) => {
      const dias = cierres.filter((c) => c.sede === s && enRango(c.fecha));
      const total = dias.reduce((a, c) => a + Number(c.total), 0);
      return { sede: s, dias: dias.length, promedio: dias.length > 0 ? total / dias.length : 0 };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cierres, desde, hasta]);

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-1 bg-white rounded-lg border border-gray-200 p-1 w-fit">
          <button
            onClick={() => setTab("cuadre")}
            className={`px-3 py-1.5 rounded-md text-sm font-medium ${tab === "cuadre" ? "bg-[var(--acento)] text-white" : "text-gray-500"}`}
          >
            Cuadre de caja
          </button>
          <button
            onClick={() => setTab("pendientes")}
            className={`px-3 py-1.5 rounded-md text-sm font-medium ${tab === "pendientes" ? "bg-[var(--acento)] text-white" : "text-gray-500"}`}
          >
            Pendientes {pendientesAbiertos.length > 0 && `(${pendientesAbiertos.length})`}
          </button>
          <button
            onClick={() => setTab("errores")}
            className={`px-3 py-1.5 rounded-md text-sm font-medium ${tab === "errores" ? "bg-[var(--acento)] text-white" : "text-gray-500"}`}
          >
            Errores {erroresCuadre.length + transferenciasPorVerificar.length > 0 && `(${erroresCuadre.length + transferenciasPorVerificar.length})`}
          </button>
        </div>

        <div className="flex items-center gap-2 text-xs flex-wrap">
          <input
            type="date"
            value={desde}
            onChange={(e) => {
              setDesde(e.target.value);
              setPreset("custom");
            }}
            className="rounded-lg border border-gray-300 px-2 py-1.5"
          />
          <span className="text-gray-300">–</span>
          <input
            type="date"
            value={hasta}
            onChange={(e) => {
              setHasta(e.target.value);
              setPreset("custom");
            }}
            className="rounded-lg border border-gray-300 px-2 py-1.5"
          />
          {(["todo", "7", "mes"] as const).map((p) => (
            <button
              key={p}
              onClick={() => aplicarPreset(p)}
              className={`px-2.5 py-1 rounded-full font-semibold ${preset === p ? "bg-[var(--acento)] text-white" : "bg-gray-100 text-gray-500"}`}
            >
              {p === "todo" ? "Todo" : p === "7" ? "Últimos 7 días" : "Este mes"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {(["todas", "Fabricato", "Las Americas"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSedeFiltro(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${
              sedeFiltro === s ? "bg-[var(--acento)] text-white border-[var(--acento)]" : "bg-white text-gray-500 border-gray-200"
            }`}
          >
            {s === "todas" ? "Todas las sedes" : s === "Fabricato" ? "Parque Fabricato" : "Las Américas"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {promedioPorSede.map((p) => (
          <div key={p.sede} className="rounded-xl border border-gray-200 bg-white p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold" style={{ color: "var(--acento)" }}>
                {p.sede === "Fabricato" ? "Parque Fabricato" : "Las Américas"}
              </p>
              <p className="text-xs text-gray-400">
                {p.dias} día{p.dias !== 1 ? "s" : ""} en el período
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase font-semibold text-gray-400">Promedio/día</p>
              <p className="text-lg font-bold text-tinta">{fmtCOP(p.promedio)}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Recaudo del período" value={fmtCOP(totalPeriodo)} accent="#1BA098" />
        <KpiCard label="Días cuadrados" value={`${diasCuadrados}/${cierresPeriodoSede.length}`} accent="#2E9E5B" />
        <KpiCard label="Pendientes abiertos" value={String(pendientesAbiertos.length)} accent="#D64545" />
        <KpiCard label="Transferencias por verificar" value={String(transferenciasPorVerificar.length)} accent="#E0A458" />
      </div>

      {tab === "cuadre" && (
        <>
          <details className="bg-white rounded-xl border border-gray-200 p-4" open>
            <summary className="text-sm font-semibold text-tinta cursor-pointer">Documentos de la semana</summary>
            <div className="mt-3">
              <FormularioSemana onGuardado={cargar} onAbrirDetalle={setDetalle} />
            </div>
          </details>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={soloConPendientes} onChange={(e) => setSoloConPendientes(e.target.checked)} />
            Solo días con pendientes
          </label>

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
                          const estadoOperacion = consignadosReales[`${c.fecha}|${c.sede}`];
                          const consignado = estadoOperacion?.consignado ?? false;
                          const entregadoAdmin = estadoOperacion?.entregado_admin ?? false;
                          const claveRev = `${c.fecha}|${c.sede}`;
                          const { corta, diaSemana } = fechaTarjeta(c.fecha);
                          return (
                            <div key={c.id} className="rounded-xl border border-gray-200 bg-white p-3 flex flex-col gap-2">
                              <button onClick={() => setDetalle(c)} className="text-left hover:opacity-70" title="Ver detalle y adjuntar soportes">
                                <p className="text-sm font-semibold text-tinta">{corta}</p>
                                <p className="text-xs font-medium" style={{ color: "var(--acento)" }}>
                                  {diaSemana} · {c.sede}
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
                                  style={{ background: consignado ? "#009F98" : entregadoAdmin ? "#5C7EAA" : "#8A8D91" }}
                                >
                                  💰 {consignado ? "Consignado" : entregadoAdmin ? "Entregado a admin" : "Sin verificar"}
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
                                <input type="checkbox" checked={!!revisiones[claveRev]} onChange={() => toggleRevisado(c.fecha, c.sede)} />
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

      {tab === "errores" && (
        <div className="space-y-6">
          <ErroresSeccion
            titulo="Transferencias por identificar"
            cantidad={transferenciasPorVerificar.length}
            vacio="Sin transferencias pendientes de identificar en este período."
          >
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 bg-gray-50">
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Sede</th>
                  <th className="px-3 py-2">Paciente</th>
                  <th className="px-3 py-2 text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {transferenciasPorVerificar.map((t) => (
                  <tr key={`${t.fecha}-${t.sede}-${t._k}`} className="border-t border-gray-100">
                    <td className="px-3 py-2">{t.fecha}</td>
                    <td className="px-3 py-2">{t.sede}</td>
                    <td className="px-3 py-2">{t.paciente}</td>
                    <td className="px-3 py-2 text-right font-semibold">{fmtCOP(t.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ErroresSeccion>

          <ErroresSeccion titulo="Errores y alertas de cuadre" cantidad={erroresCuadre.length} vacio="Sin alertas en este período.">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 bg-gray-50">
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Sede</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Paciente</th>
                  <th className="px-3 py-2">Detalle</th>
                  <th className="px-3 py-2 text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {erroresCuadre.map((e) => (
                  <tr key={`${e.fecha}-${e.sede}-${e._k}`} className="border-t border-gray-100">
                    <td className="px-3 py-2">{e.fecha}</td>
                    <td className="px-3 py-2">{e.sede}</td>
                    <td className="px-3 py-2">
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{e.tipo}</span>
                    </td>
                    <td className="px-3 py-2">{e.paciente}</td>
                    <td className="px-3 py-2 text-gray-500">{e.sede_recibo}</td>
                    <td className="px-3 py-2 text-right font-semibold">{fmtCOP(e.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ErroresSeccion>

          {dupsElectronicos.length > 0 && (
            <ErroresSeccion titulo="Posibles duplicados electrónicos" cantidad={dupsElectronicos.length}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 bg-gray-50">
                    <th className="px-3 py-2">Fecha</th>
                    <th className="px-3 py-2">Sede</th>
                    <th className="px-3 py-2">Paciente</th>
                    <th className="px-3 py-2">Medio</th>
                    <th className="px-3 py-2">Nota</th>
                    <th className="px-3 py-2 text-right">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {dupsElectronicos.map((d) => (
                    <tr key={`${d.fecha}-${d.sede}-${d._k}`} className="border-t border-gray-100">
                      <td className="px-3 py-2">{d.fecha}</td>
                      <td className="px-3 py-2">{d.sede}</td>
                      <td className="px-3 py-2">{d.paciente}</td>
                      <td className="px-3 py-2">{d.medio}</td>
                      <td className="px-3 py-2 text-gray-500">{d.nota}</td>
                      <td className="px-3 py-2 text-right font-semibold">{fmtCOP(d.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ErroresSeccion>
          )}
        </div>
      )}

      {detalle && <DetalleModal cierre={detalle} onClose={() => setDetalle(null)} sedes={sedes} onGuardado={cargar} />}
    </div>
  );
}

function KpiCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 relative overflow-hidden">
      <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: accent }} />
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="text-xl font-bold text-tinta mt-1">{value}</p>
    </div>
  );
}

function ErroresSeccion({
  titulo,
  cantidad,
  vacio,
  children,
}: {
  titulo: string;
  cantidad: number;
  vacio?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "var(--acento)" }}>
        {titulo} {cantidad > 0 && `(${cantidad})`}
      </h3>
      {cantidad === 0 && vacio ? (
        <p className="text-sm text-gray-400 bg-white rounded-xl border border-gray-200 px-4 py-3">{vacio}</p>
      ) : (
        <div className="overflow-x-auto bg-white rounded-xl border border-gray-200">{children}</div>
      )}
    </div>
  );
}

const DOCUMENTOS_SEMANA: { campo: keyof CierreCajaSemana; label: string }[] = [
  { campo: "url_bancolombia", label: "Movimientos Bancolombia — Las Américas" },
  { campo: "url_bancolombia_fabricato", label: "Movimientos Bancolombia — Fabricato (solo consignación de efectivo)" },
  { campo: "url_bold_fabricato", label: "Movimientos Bold — Fabricato" },
  { campo: "url_recibos_caja", label: "Excel recibos de caja del sistema — ambas sedes" },
];

/** El cierre real no se hace día por día: cada período se sube un solo lote
 *  de 3 documentos (cada uno cubre varios días, y salvo Bancolombia, una
 *  sola sede) y se compara contra el facturado de ese período — sin que
 *  nadie tenga que digitar ningún valor, todo sale del ERP (vía Cierre diario
 *  de Operación, ya integrado) y de lo que la IA lee en los documentos. El
 *  período suele ser una semana (por eso "Hasta" arranca en +6 días), pero
 *  es un rango libre — algunos lotes de documentos no llegan alineados a
 *  semanas de lunes a lunes. */
function FormularioSemana({
  onGuardado,
  onAbrirDetalle,
}: {
  onGuardado: () => void;
  onAbrirDetalle: (c: CierreCajaRow) => void;
}) {
  const [semanaInicio, setSemanaInicio] = useState(() => lunesDeSemana(sumarDiasCal(today(), -7)));
  const [semanaFin, setSemanaFin] = useState(() => sumarDiasCal(lunesDeSemana(sumarDiasCal(today(), -7)), 6));
  const [semana, setSemana] = useState<CierreCajaSemana | null>(null);
  const [cargando, setCargando] = useState(true);
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const [procesando, setProcesando] = useState(false);
  const [resumenDias, setResumenDias] = useState<CierreCajaRow[]>([]);

  async function cargarSemana() {
    setCargando(true);
    const { data } = await supabase.from("cierres_caja_semanas").select("*").eq("semana_inicio", semanaInicio).maybeSingle();
    const fila = (data as CierreCajaSemana) ?? null;
    setSemana(fila);
    if (fila?.semana_fin) setSemanaFin(fila.semana_fin);
    const { data: diasData } = await supabase
      .from("cierres_caja")
      .select("*")
      .gte("fecha", semanaInicio)
      .lte("fecha", fila?.semana_fin ?? semanaFin)
      .order("fecha");
    setResumenDias((diasData as CierreCajaRow[]) ?? []);
    setCargando(false);
  }

  useEffect(() => {
    cargarSemana();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [semanaInicio]);

  async function asegurarSemana(): Promise<CierreCajaSemana | null> {
    if (semana) return semana;
    const { data, error } = await supabase
      .from("cierres_caja_semanas")
      .upsert({ semana_inicio: semanaInicio, semana_fin: semanaFin }, { onConflict: "semana_inicio" })
      .select("*")
      .single();
    if (error || !data) {
      window.alert(`No se pudo crear el período: ${error?.message}`);
      return null;
    }
    setSemana(data as CierreCajaSemana);
    return data as CierreCajaSemana;
  }

  async function guardarRangoFin(nuevoFin: string) {
    setSemanaFin(nuevoFin);
    if (semana) {
      await supabase.from("cierres_caja_semanas").update({ semana_fin: nuevoFin }).eq("id", semana.id);
      cargarSemana();
    }
  }

  async function subirDocumento(campo: keyof CierreCajaSemana, file: File) {
    setSubiendo(campo);
    const s = await asegurarSemana();
    if (!s) {
      setSubiendo(null);
      return;
    }
    const path = `cierre-caja/semanas/${semanaInicio}/${campo}-${file.name}`;
    const { error: errorSubida } = await supabase.storage.from("comprobantes").upload(path, file, { upsert: true });
    if (errorSubida) {
      window.alert(`No se pudo subir el documento: ${errorSubida.message}`);
      setSubiendo(null);
      return;
    }
    const { error: errorGuardado } = await supabase.from("cierres_caja_semanas").update({ [campo]: path }).eq("id", s.id);
    if (errorGuardado) window.alert(`El archivo se subió pero no se pudo guardar el registro: ${errorGuardado.message}`);
    setSubiendo(null);
    cargarSemana();
  }

  async function verDocumento(path: string) {
    const { data } = await supabase.storage.from("comprobantes").createSignedUrl(path, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  }

  async function procesarSemana() {
    if (!semana) return;
    setProcesando(true);
    try {
      const { data, error } = await supabase.functions.invoke("procesar-cierre-semana-ia", { body: { semana_id: semana.id } });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Error desconocido procesando la semana.");
    } catch (e) {
      window.alert(
        e && typeof e === "object" && "message" in e
          ? String((e as { message: unknown }).message)
          : "No se pudo procesar la semana con IA.",
      );
    } finally {
      setProcesando(false);
      await cargarSemana();
      onGuardado();
    }
  }

  const hayAlgunDocumento = semana ? DOCUMENTOS_SEMANA.some((d) => semana[d.campo]) : false;
  const diasPorSede = useMemo(() => {
    const map: Record<string, CierreCajaRow | undefined> = {};
    for (const c of resumenDias) map[`${c.fecha}|${c.sede}`] = c;
    return map;
  }, [resumenDias]);
  const finEfectivo = semana?.semana_fin ?? semanaFin;
  const fechasSemana = useMemo(() => {
    const dias: string[] = [];
    for (let f = semanaInicio; f <= finEfectivo && dias.length < 60; f = sumarDiasCal(f, 1)) dias.push(f);
    return dias;
  }, [semanaInicio, finEfectivo]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-gray-400 max-w-md">
          Sube acá los documentos de todo el período (una sola vez, no por día) — el sistema compara contra lo que ya
          cerró cada día en Cierre diario de Operación y te dice cuáles días no cuadran. Por defecto es una semana,
          pero puedes estirar "Hasta" para cubrir cualquier rango de días. La tarjeta de ninguna de las 2 sedes se
          sube acá: la de Las Américas se toma automático de la tirilla que ya se adjunta cada día en Cierre diario
          de Operación, y la de Fabricato se arma sola leyendo los correos de cierre de turno de Bold.
        </p>
        <div className="flex items-end gap-2">
          <label className="text-xs text-gray-500">
            Desde
            <input
              type="date"
              value={semanaInicio}
              onChange={(e) => {
                const nuevoInicio = e.target.value;
                setSemanaInicio(nuevoInicio);
                if (semanaFin < nuevoInicio) setSemanaFin(sumarDiasCal(nuevoInicio, 6));
              }}
              className="mt-0.5 block rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs text-gray-500">
            Hasta
            <input
              type="date"
              value={finEfectivo}
              min={semanaInicio}
              onChange={(e) => guardarRangoFin(e.target.value)}
              className="mt-0.5 block rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
        </div>
      </div>

      {cargando ? (
        <p className="text-sm text-gray-400">Cargando…</p>
      ) : (
        <>
          <div className="space-y-1.5">
            {DOCUMENTOS_SEMANA.map((d) => {
              const url = semana?.[d.campo] as string | null | undefined;
              return (
                <div key={d.campo} className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm">
                  <span className="text-gray-600">{d.label}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    {url && (
                      <button onClick={() => verDocumento(url)} className="text-xs font-medium text-[var(--acento)] underline">
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

          <button
            onClick={procesarSemana}
            disabled={!hayAlgunDocumento || procesando}
            className="flex items-center gap-1.5 text-sm font-medium px-4 py-2.5 rounded-lg bg-[var(--acento)] text-white disabled:opacity-40"
          >
            {procesando ? "Procesando…" : "✨ Procesar semana con IA"}
          </button>
          {semana?.error_ia && <p className="text-sm text-red-600">{semana.error_ia}</p>}
          {(semana?.resumen_ia_las_americas || semana?.resumen_ia_fabricato) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {semana?.resumen_ia_las_americas && (
                <p className="text-sm rounded-lg bg-gray-50 p-3">
                  <span className="font-semibold text-gray-600">Resumen de la IA — Las Américas: </span>
                  {semana.resumen_ia_las_americas}
                </p>
              )}
              {semana?.resumen_ia_fabricato && (
                <p className="text-sm rounded-lg bg-gray-50 p-3">
                  <span className="font-semibold text-gray-600">Resumen de la IA — Fabricato: </span>
                  {semana.resumen_ia_fabricato}
                </p>
              )}
            </div>
          )}

          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1.5">Días de esta semana</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 text-xs">
                    <th className="py-1 pr-2">Fecha</th>
                    <th className="py-1 pr-2">Las Américas</th>
                    <th className="py-1">Fabricato</th>
                  </tr>
                </thead>
                <tbody>
                  {fechasSemana.map((fecha) => (
                    <tr key={fecha} className="border-t border-gray-100">
                      <td className="py-1.5 pr-2 text-gray-500">{fecha}</td>
                      {(["Las Americas", "Fabricato"] as const).map((sede) => {
                        const c = diasPorSede[`${fecha}|${sede}`];
                        return (
                          <td key={sede} className="py-1.5 pr-2">
                            {c ? (
                              <button
                                onClick={() => onAbrirDetalle(c)}
                                className="text-xs font-semibold px-2 py-0.5 rounded-full text-white"
                                style={{ background: c.cuadra ? "#3E9B6F" : "#C0392B" }}
                              >
                                {c.cuadra ? "✔ Cuadra" : "Revisar"}
                              </button>
                            ) : (
                              <span className="text-xs text-gray-300">Sin datos</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
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
          <span className="text-gray-400">
            {item.fecha} · {item.sede}
          </span>
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

// El Excel de recibos de caja y los movimientos bancarios (las 2 cuentas) ya
// llegan solos a cada día desde el documento semanal (Documentos de la
// semana) — subirlos también aquí sería duplicar lo mismo dos veces. Lo
// único que de verdad puede faltar día a día es el datáfono, cuando la
// fuente determinística (tirilla Redeban o correo de Bold) no está
// disponible para ese día — estos 2 slots quedan como respaldo manual.
const DOCUMENTOS: { campo: keyof CierreCajaRow; label: string }[] = [
  { campo: "url_tirilla_datafono", label: "Tirilla de datáfono" },
  { campo: "url_reporte_datafono", label: "Reporte de datáfono" },
];

interface FormNotasCierre {
  transf_directa: string;
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
  entregado_admin: boolean;
  porMedio: Record<string, number>;
}

function DetalleModal({
  cierre,
  onClose,
  sedes,
  onGuardado,
}: {
  cierre: CierreCajaRow;
  onClose: () => void;
  sedes: Sede[];
  onGuardado: () => void;
}) {
  const claveSede = cierre.sede;
  const sedeDelCierre = sedes.find((s) => claveSedeDe(s) === cierre.sede) ?? null;

  const [operacion, setOperacion] = useState<CierreOperacion | null>(null);
  const [cargandoOperacion, setCargandoOperacion] = useState(true);
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const [cuadra, setCuadra] = useState(cierre.cuadra);
  const [procesandoIA, setProcesandoIA] = useState(false);
  const [errorIA, setErrorIA] = useState<string | null>(null);
  const [notas, setNotas] = useState<FormNotasCierre>({
    transf_directa: String(cierre.transf_directa ?? 0),
    transf_por_verificar: cierre.transf_por_verificar,
    transf_sin_banco: cierre.transf_sin_banco,
    urgente_transf: cierre.urgente_transf,
    consignacion_cuenta2: cierre.consignacion_cuenta2,
    fuente_dataf: cierre.fuente_dataf ?? "",
    fuente_transf: cierre.fuente_transf ?? "",
    nota_dataf_extra: cierre.nota_dataf_extra ?? "",
    nota_transf_extra: cierre.nota_transf_extra ?? "",
    nota_banco_extra: cierre.nota_banco_extra ?? "",
    nota_limitacion: cierre.nota_limitacion ?? "",
    nota_cuenta2: cierre.nota_cuenta2 ?? "",
    nota_consignacion_pendiente: cierre.nota_consignacion_pendiente ?? "",
  });

  useEffect(() => {
    if (!sedeDelCierre) {
      setCargandoOperacion(false);
      return;
    }
    (async () => {
      setCargandoOperacion(true);
      const { data: cierreDiario } = await supabase
        .from("cierres_diarios")
        .select("consignado, comprobante_url, entregado_admin")
        .eq("sede_id", sedeDelCierre.id)
        .eq("fecha", cierre.fecha)
        .maybeSingle();

      const { data: pagosData } = await supabase
        .from("cargo_pagos")
        .select("medio_pago, valor, cargos!inner(sede_id, fecha)")
        .eq("cargos.sede_id", sedeDelCierre.id)
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
        .eq("sede_origen_id", sedeDelCierre.id)
        .eq("fecha", cierre.fecha)
        .neq("medio_origen", "ajuste_manual");
      for (const s of (saldosData as unknown as { valor: number; medio_origen: string }[]) ?? []) {
        porMedio[s.medio_origen] = (porMedio[s.medio_origen] ?? 0) + Number(s.valor);
      }

      setOperacion({
        consignado: cierreDiario?.consignado ?? false,
        comprobante_url: cierreDiario?.comprobante_url ?? null,
        entregado_admin: cierreDiario?.entregado_admin ?? false,
        porMedio,
      });
      setCargandoOperacion(false);
    })();
  }, [cierre.fecha, sedeDelCierre]);

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

  async function guardarCuadra(v: boolean) {
    setCuadra(v);
    await supabase.from("cierres_caja").update({ cuadra: v }).eq("id", cierre.id);
    onGuardado();
  }

  function campoNota<K extends keyof FormNotasCierre>(k: K, v: FormNotasCierre[K]) {
    setNotas((n) => ({ ...n, [k]: v }));
  }

  async function guardarNotas(override?: Partial<FormNotasCierre>) {
    const n = { ...notas, ...override };
    await supabase
      .from("cierres_caja")
      .update({
        transf_directa: Number(n.transf_directa) || 0,
        transf_por_verificar: n.transf_por_verificar,
        transf_sin_banco: n.transf_sin_banco,
        urgente_transf: n.urgente_transf,
        consignacion_cuenta2: n.consignacion_cuenta2,
        fuente_dataf: n.fuente_dataf || null,
        fuente_transf: n.fuente_transf || null,
        nota_dataf_extra: n.nota_dataf_extra || null,
        nota_transf_extra: n.nota_transf_extra || null,
        nota_banco_extra: n.nota_banco_extra || null,
        nota_limitacion: n.nota_limitacion || null,
        nota_cuenta2: n.nota_cuenta2 || null,
        nota_consignacion_pendiente: n.nota_consignacion_pendiente || null,
      })
      .eq("id", cierre.id);
    onGuardado();
  }

  function toggleNota(
    k: "transf_por_verificar" | "transf_sin_banco" | "urgente_transf" | "consignacion_cuenta2",
    v: boolean,
  ) {
    campoNota(k, v);
    guardarNotas({ [k]: v });
  }

  async function procesarConIA() {
    setProcesandoIA(true);
    setErrorIA(null);
    try {
      const { data, error } = await supabase.functions.invoke("procesar-cierre-ia", { body: { cierre_id: cierre.id } });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Error desconocido procesando el cierre.");
      onGuardado();
    } catch (e) {
      setErrorIA(
        e && typeof e === "object" && "message" in e
          ? String((e as { message: unknown }).message)
          : "No se pudo procesar el cierre con IA.",
      );
    } finally {
      setProcesandoIA(false);
    }
  }

  const totalOperacionEfectivo = operacion?.porMedio["efectivo"] ?? 0;
  const totalOperacionTarjeta = (operacion?.porMedio["tarjeta_debito"] ?? 0) + (operacion?.porMedio["tarjeta_credito"] ?? 0);
  const totalOperacionTransf = operacion?.porMedio["transferencia_debito"] ?? 0;
  const totalOperacionAddi = (operacion?.porMedio["addi"] ?? 0) + (operacion?.porMedio["sistecredito"] ?? 0);

  const filas = [
    {
      label: "Efectivo",
      facturado: cierre.efvo_fact,
      real: cierre.analisis_ia?.efectivo_real ?? null,
      diff: cierre.analisis_ia?.diferencia_efectivo ?? null,
      operacion: totalOperacionEfectivo,
    },
    {
      label: "Tarjeta",
      facturado: cierre.tarjeta_fact,
      real: cierre.analisis_ia?.tarjeta_real ?? null,
      diff: cierre.analisis_ia?.diferencia_tarjeta ?? null,
      operacion: totalOperacionTarjeta,
    },
    {
      label: "Transferencia",
      facturado: cierre.transf_fact,
      real: cierre.analisis_ia?.transferencia_real ?? null,
      diff: cierre.analisis_ia?.diferencia_transferencia ?? null,
      operacion: totalOperacionTransf,
    },
    { label: "Addi / Sistecrédito", facturado: cierre.addi, real: null, diff: null, operacion: totalOperacionAddi },
  ];
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-20">
      <div className="bg-white rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-tinta">
            {fechaCorta(cierre.fecha)} · {cierre.sede}
          </h3>
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
                <th className="py-1 text-right">Real (IA)</th>
                <th className="py-1 text-right">Diferencia (IA)</th>
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
          diferencias de digitación. "Real (IA)" es lo que Claude leyó en los documentos adjuntos de la semana.
        </p>

        {cierre.analisis_ia && (
          <div className="rounded-lg bg-gray-50 p-3 text-sm space-y-1.5">
            <p className="text-gray-600">{cierre.analisis_ia.resumen}</p>
            <p className="text-xs text-gray-400">
              Sugerencia de la IA:{" "}
              <span className={cierre.analisis_ia.cuadra_sugerido ? "text-[#3E9B6F] font-medium" : "text-red-600 font-medium"}>
                {cierre.analisis_ia.cuadra_sugerido ? "cuadra" : "revisar"}
              </span>{" "}
              — revísala y marca tú mismo el check "Cuadra" abajo, no se marca sola.
            </p>
          </div>
        )}

        <div className="flex items-center justify-between flex-wrap gap-2">
          <label className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
            <input type="checkbox" checked={cuadra} onChange={(e) => guardarCuadra(e.target.checked)} />
            <span className={`font-semibold ${cuadra ? "text-[#3E9B6F]" : "text-red-600"}`}>{cuadra ? "✔ Cuadra" : "Revisar"}</span>
          </label>
          <button
            onClick={procesarConIA}
            disabled={procesandoIA}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-[var(--acento)] text-white disabled:opacity-40"
          >
            {procesandoIA ? "Procesando…" : "✨ Reprocesar este día con IA"}
          </button>
        </div>
        {errorIA && <p className="text-xs text-red-600">{errorIA}</p>}

        {!cargandoOperacion && (
          <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm flex items-center justify-between flex-wrap gap-2">
            <span>
              Consignado desde Operación Diaria:{" "}
              <span className="font-medium">{operacion?.consignado ? "Sí" : "No"}</span>
              {" · "}Entregado a admin:{" "}
              <span className="font-medium">{operacion?.entregado_admin ? "Sí" : "No"}</span>
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

        {cierre.dataf_explicacion && (
          <p className="text-sm">
            <span className="text-gray-500">Explicación datáfono:</span> {cierre.dataf_explicacion}
          </p>
        )}

        <details className="rounded-lg border border-gray-200 p-3">
          <summary className="text-xs font-semibold text-gray-500 cursor-pointer">Banderas y notas</summary>
          <div className="mt-2 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-gray-500">
                Transferencia directa a cuenta
                <input
                  type="number"
                  value={notas.transf_directa}
                  onChange={(e) => campoNota("transf_directa", e.target.value)}
                  onBlur={() => guardarNotas()}
                  className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-xs text-gray-500">
                Fuente datáfono
                <input
                  value={notas.fuente_dataf}
                  onChange={(e) => campoNota("fuente_dataf", e.target.value)}
                  onBlur={() => guardarNotas()}
                  placeholder="SPRO Bold / Redeban"
                  className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-xs text-gray-500">
                Fuente transferencia
                <input
                  value={notas.fuente_transf}
                  onChange={(e) => campoNota("fuente_transf", e.target.value)}
                  onBlur={() => guardarNotas()}
                  placeholder="QR Bold / Bancolombia"
                  className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  ["transf_por_verificar", "Transferencia por verificar"],
                  ["transf_sin_banco", "Transferencia sin banco"],
                  ["urgente_transf", "Urgente transferencia"],
                  ["consignacion_cuenta2", "Consignación a cuenta 2"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" checked={notas[k]} onChange={(e) => toggleNota(k, e.target.checked)} />
                  {label}
                </label>
              ))}
            </div>
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
                  value={notas[k]}
                  onChange={(e) => campoNota(k, e.target.value)}
                  onBlur={() => guardarNotas()}
                  placeholder={label}
                  className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs"
                />
              ))}
            </div>
          </div>
        </details>

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
