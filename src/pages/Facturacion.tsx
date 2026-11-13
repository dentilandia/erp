import { useEffect, useMemo, useState } from "react";
import { Copy, Check, RefreshCw, AlertTriangle, Link2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { fmtCOP } from "../lib/format";
import { fetchTodasLasFilas } from "../lib/db";
import { StatTile } from "../components/StatTile";

/** Facturas de compra (cuentas por pagar). Los datos vienen del "Control de
 *  Facturación" (Google Sheet): el robot FacturasCompra.gs los envía cada día
 *  a la Edge Function sync-facturas-compra. Aquí solo se consultan. */

interface FacturaCompra {
  id: number;
  pestana: string;
  fila: number;
  mes: string;
  proveedor: string;
  numero: string | null;
  ds: string | null;
  fecha: string | null;
  vencimiento: string | null;
  valor_antes_iva: number;
  iva: number;
  total: number;
  rt_pct: number | null;
  rt_valor: number;
  valor_pagar: number;
  pagado: boolean;
  metodo_pago: string | null;
  dca: number;
  dpf: number;
  gpf: number;
  categoria: string | null;
  observaciones: string | null;
  origen: "manual" | "robot_dian" | "robot_cobro";
  sincronizado_en: string;
}

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const MESES_LARGOS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const SEDES = [
  { k: "dca", label: "DCA", color: "#009f98" },
  { k: "dpf", label: "DPF", color: "#7b5aa6" },
  { k: "gpf", label: "GPF", color: "#d08a2c" },
] as const;
const COLOR_SIN_REPARTIR = "#c9c8cf";

const n = (v: unknown) => Number(v) || 0;
const sinRepartir = (f: FacturaCompra) => Math.max(0, n(f.total) - n(f.dca) - n(f.dpf) - n(f.gpf));
const fechaCorta = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");

/** Lo que el equipo debe resolver en una fila registrada por el robot. */
function pendientesDe(f: FacturaCompra): string[] {
  const p: string[] = [];
  if (f.ds && /pendiente/i.test(f.ds)) p.push("Generar DS");
  if (f.origen !== "manual" && f.rt_pct === null) p.push("Definir retención");
  if (f.origen !== "manual" && n(f.total) > 0 && sinRepartir(f) > 1) p.push("Definir sede");
  return p;
}

export function Facturacion() {
  const [filas, setFilas] = useState<FacturaCompra[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mesSel, setMesSel] = useState<string>(""); // "" = todo el año
  const [busqueda, setBusqueda] = useState("");
  const [clave, setClave] = useState<string | null>(null);
  const [verConexion, setVerConexion] = useState(false);
  const [copiado, setCopiado] = useState(false);

  async function cargar() {
    setCargando(true);
    setError(null);
    try {
      const datos = await fetchTodasLasFilas<FacturaCompra>((desde, hasta) =>
        supabase.from("facturas_compra").select("*").order("mes").order("fila").range(desde, hasta),
      );
      setFilas(datos);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    const { data } = await supabase.from("integraciones_claves").select("clave").eq("nombre", "facturas_compra").maybeSingle();
    setClave((data as { clave: string } | null)?.clave ?? null);
    setCargando(false);
  }

  useEffect(() => {
    cargar();
  }, []);

  const meses = useMemo(() => Array.from(new Set(filas.map((f) => f.mes.slice(0, 7)))).sort(), [filas]);
  useEffect(() => {
    if (!mesSel && meses.length) setMesSel(meses[meses.length - 1]);
  }, [meses, mesSel]);

  const delMes = useMemo(() => (mesSel === "todo" ? filas : filas.filter((f) => f.mes.startsWith(mesSel))), [filas, mesSel]);
  const ultimaSync = useMemo(() => filas.reduce<string | null>((m, f) => (!m || f.sincronizado_en > m ? f.sincronizado_en : m), null), [filas]);

  const kpi = useMemo(() => {
    const total = delMes.reduce((a, f) => a + n(f.total), 0);
    const rt = delMes.reduce((a, f) => a + n(f.rt_valor), 0);
    const porPagar = delMes.filter((f) => !f.pagado).reduce((a, f) => a + n(f.valor_pagar), 0);
    const robot = delMes.filter((f) => f.origen !== "manual").length;
    return { total, rt, porPagar, docs: delMes.length, robot };
  }, [delMes]);

  const porMes = useMemo(() => {
    const anio = (meses[meses.length - 1] ?? "2026").slice(0, 4);
    return MESES.map((label, i) => {
      const k = `${anio}-${String(i + 1).padStart(2, "0")}`;
      const fs = filas.filter((f) => f.mes.startsWith(k));
      return {
        k,
        label,
        dca: fs.reduce((a, f) => a + n(f.dca), 0),
        dpf: fs.reduce((a, f) => a + n(f.dpf), 0),
        gpf: fs.reduce((a, f) => a + n(f.gpf), 0),
        sin: fs.reduce((a, f) => a + sinRepartir(f), 0),
        total: fs.reduce((a, f) => a + n(f.total), 0),
      };
    });
  }, [filas, meses]);
  const maxMes = Math.max(1, ...porMes.map((m) => m.total));

  const reparto = useMemo(() => {
    const r = { dca: 0, dpf: 0, gpf: 0, sin: 0 };
    delMes.forEach((f) => {
      r.dca += n(f.dca);
      r.dpf += n(f.dpf);
      r.gpf += n(f.gpf);
      r.sin += sinRepartir(f);
    });
    return r;
  }, [delMes]);
  const totalReparto = Math.max(1, reparto.dca + reparto.dpf + reparto.gpf + reparto.sin);

  const topProveedores = useMemo(() => {
    const m = new Map<string, { total: number; docs: number }>();
    delMes.forEach((f) => {
      const k = f.proveedor.trim();
      const x = m.get(k) ?? { total: 0, docs: 0 };
      x.total += n(f.total);
      x.docs += 1;
      m.set(k, x);
    });
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 10);
  }, [delMes]);

  const porCategoria = useMemo(() => {
    const m = new Map<string, number>();
    delMes.forEach((f) => {
      const k = (f.categoria || "Sin categoría").trim();
      m.set(k, (m.get(k) ?? 0) + n(f.total));
    });
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [delMes]);

  const pendientes = useMemo(
    () => delMes.map((f) => ({ f, p: pendientesDe(f) })).filter((x) => x.p.length > 0),
    [delMes],
  );
  const conteoPendientes = useMemo(() => {
    const c: Record<string, number> = {};
    pendientes.forEach((x) => x.p.forEach((p) => (c[p] = (c[p] ?? 0) + 1)));
    return c;
  }, [pendientes]);

  const detalle = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const base = q ? delMes.filter((f) => `${f.proveedor} ${f.numero ?? ""} ${f.categoria ?? ""}`.toLowerCase().includes(q)) : delMes;
    return [...base].sort((a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? ""));
  }, [delMes, busqueda]);

  async function copiarClave() {
    if (!clave) return;
    try {
      await navigator.clipboard.writeText(clave);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* el usuario puede seleccionar el texto a mano */
    }
  }

  const etiquetaMes = mesSel === "todo" ? "Todo el año" : mesSel ? `${MESES_LARGOS[Number(mesSel.slice(5, 7)) - 1]} ${mesSel.slice(0, 4)}` : "";

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <section className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-semibold text-tinta">Facturas de compra</h1>
          <p className="text-xs text-gray-400">
            Datos del Control de Facturación (Google Sheets).{" "}
            {ultimaSync ? `Última actualización: ${new Date(ultimaSync).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}.` : "Todavía no ha llegado ningún dato de la hoja."}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={mesSel} onChange={(e) => setMesSel(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
            {meses.map((m) => (
              <option key={m} value={m}>
                {MESES_LARGOS[Number(m.slice(5, 7)) - 1]} {m.slice(0, 4)}
              </option>
            ))}
            <option value="todo">Todo el año</option>
          </select>
          <button onClick={cargar} className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200">
            <RefreshCw size={14} /> Actualizar
          </button>
          <button onClick={() => setVerConexion((v) => !v)} className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200">
            <Link2 size={14} /> Conexión con la hoja
          </button>
        </div>
      </section>

      {verConexion && (
        <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-2 text-sm">
          <h2 className="font-semibold text-tinta">Conexión con la hoja</h2>
          <p className="text-gray-500 text-xs">
            En el Control de Facturación: menú 🧾 Facturas de compra → <b>Guardar clave del ERP</b>, pegue esta clave y acepte. Desde ese
            momento el robot envía todos los meses cada mañana y cada vez que se usa "Procesar ahora" o "Enviar al ERP ahora".
          </p>
          {clave ? (
            <div className="flex items-center gap-2 flex-wrap">
              <code className="text-xs bg-gray-50 border border-gray-200 rounded px-2 py-1.5 select-all break-all">{clave}</code>
              <button onClick={copiarClave} className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg text-white" style={{ background: "#2E253A" }}>
                {copiado ? <Check size={14} /> : <Copy size={14} />} {copiado ? "Copiada" : "Copiar clave"}
              </button>
            </div>
          ) : (
            <p className="text-xs text-red-600">No se encontró la clave de integración. Revise la migración 0097.</p>
          )}
        </section>
      )}

      {error && <p className="text-sm text-red-600">No se pudieron cargar las facturas: {error}</p>}

      {cargando ? (
        <p className="text-sm text-gray-400">Cargando…</p>
      ) : filas.length === 0 ? (
        <section className="bg-white rounded-xl border border-gray-200 p-6 text-sm text-gray-500 space-y-1">
          <p className="font-medium text-tinta">Aún no hay facturas en el ERP.</p>
          <p>Conecte la hoja con el botón "Conexión con la hoja" y luego use, en la hoja, 🧾 → "6. Enviar al ERP ahora".</p>
        </section>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <StatTile label={`Compras · ${etiquetaMes}`} value={fmtCOP(kpi.total)} />
            <StatTile label="Por pagar (sin marcar pagado)" value={fmtCOP(kpi.porPagar)} color="#b45309" />
            <StatTile label="Retención practicada" value={fmtCOP(kpi.rt)} color="#009f98" />
            <StatTile label="Documentos (registrados por el robot)" value={`${kpi.docs} (${kpi.robot})`} />
          </div>

          <section className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
              <h2 className="font-semibold text-tinta">Compras por mes y sede</h2>
              <div className="flex gap-3 text-xs text-gray-500 flex-wrap">
                {SEDES.map((s) => (
                  <span key={s.k} className="flex items-center gap-1">
                    <i className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: s.color }} /> {s.label}
                  </span>
                ))}
                <span className="flex items-center gap-1">
                  <i className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: COLOR_SIN_REPARTIR }} /> Sin repartir
                </span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <div className="flex items-end gap-2 h-48 min-w-[560px]">
                {porMes.map((m) => (
                  <button
                    key={m.k}
                    onClick={() => m.total > 0 && setMesSel(m.k)}
                    className="flex-1 flex flex-col items-center gap-1 h-full justify-end group"
                    title={`${m.label}: ${fmtCOP(m.total)}`}
                  >
                    <span className="text-[10px] text-gray-400 tabular-nums">{m.total > 0 ? `${Math.round(m.total / 1e6)} M` : ""}</span>
                    <div
                      className={`w-full rounded-t flex flex-col-reverse overflow-hidden ${mesSel === m.k ? "ring-2 ring-offset-1 ring-[#2E253A]" : ""}`}
                      style={{ height: `${(m.total / maxMes) * 100}%`, minHeight: m.total > 0 ? 2 : 0 }}
                    >
                      {SEDES.map((s) => (
                        <div key={s.k} style={{ height: `${m.total ? (m[s.k] / m.total) * 100 : 0}%`, background: s.color }} />
                      ))}
                      <div style={{ height: `${m.total ? (m.sin / m.total) * 100 : 0}%`, background: COLOR_SIN_REPARTIR }} />
                    </div>
                    <span className={`text-xs ${mesSel === m.k ? "font-semibold text-tinta" : "text-gray-500"}`}>{m.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <div className="grid md:grid-cols-2 gap-4">
            <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
              <h2 className="font-semibold text-tinta">Reparto por sede · {etiquetaMes}</h2>
              <div className="flex h-3 rounded-full overflow-hidden bg-gray-100">
                {SEDES.map((s) => (
                  <div key={s.k} style={{ width: `${(reparto[s.k] / totalReparto) * 100}%`, background: s.color }} />
                ))}
                <div style={{ width: `${(reparto.sin / totalReparto) * 100}%`, background: COLOR_SIN_REPARTIR }} />
              </div>
              <ul className="text-sm space-y-1">
                {[...SEDES.map((s) => ({ label: s.label, v: reparto[s.k], color: s.color })), { label: "Sin repartir", v: reparto.sin, color: COLOR_SIN_REPARTIR }].map((x) => (
                  <li key={x.label} className="flex justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <i className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: x.color }} />
                      {x.label}
                    </span>
                    <span className="tabular-nums">
                      {fmtCOP(x.v)} <span className="text-gray-400">· {((x.v / totalReparto) * 100).toFixed(0)}%</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
              <h2 className="font-semibold text-tinta">Por categoría · {etiquetaMes}</h2>
              <ul className="text-sm space-y-2">
                {porCategoria.map(([cat, v]) => (
                  <li key={cat} className="space-y-1">
                    <div className="flex justify-between gap-2">
                      <span className="truncate">{cat}</span>
                      <span className="tabular-nums">{fmtCOP(v)}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-gray-100">
                      <div className="h-1.5 rounded-full" style={{ width: `${(v / Math.max(1, porCategoria[0][1])) * 100}%`, background: "#2E253A" }} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
              <h2 className="font-semibold text-tinta">Principales proveedores · {etiquetaMes}</h2>
              <ol className="text-sm space-y-1.5">
                {topProveedores.map(([prov, x], i) => (
                  <li key={prov} className="flex justify-between gap-2">
                    <span className="truncate">
                      <span className="text-gray-400 tabular-nums mr-1.5">{i + 1}.</span>
                      {prov} <span className="text-gray-400 text-xs">· {x.docs} doc.</span>
                    </span>
                    <span className="tabular-nums">{fmtCOP(x.total)}</span>
                  </li>
                ))}
              </ol>
            </section>

            <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
              <h2 className="font-semibold text-tinta flex items-center gap-2">
                <AlertTriangle size={16} className="text-amber-600" /> Pendientes del robot · {etiquetaMes}
              </h2>
              {pendientes.length === 0 ? (
                <p className="text-sm text-gray-400">Nada pendiente.</p>
              ) : (
                <>
                  <div className="flex gap-1.5 flex-wrap">
                    {Object.entries(conteoPendientes).map(([k, c]) => (
                      <span key={k} className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700">
                        {k}: {c}
                      </span>
                    ))}
                  </div>
                  <ul className="text-sm divide-y divide-gray-100 max-h-64 overflow-y-auto">
                    {pendientes.map(({ f, p }) => (
                      <li key={f.id} className="py-1.5 flex justify-between gap-2">
                        <span className="truncate">
                          {f.proveedor} <span className="text-gray-400">#{f.numero ?? "—"}</span>
                        </span>
                        <span className="text-xs text-amber-700 whitespace-nowrap">{p.join(" · ")}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          </div>

          <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="font-semibold text-tinta">Detalle · {etiquetaMes}</h2>
              <input
                id="buscar-factura"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar proveedor, número o categoría"
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm w-64 max-w-full"
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                    <th className="py-2 pr-3 font-medium">Proveedor</th>
                    <th className="py-2 pr-3 font-medium">Número</th>
                    <th className="py-2 pr-3 font-medium">Fecha</th>
                    <th className="py-2 pr-3 font-medium text-right">Total</th>
                    <th className="py-2 pr-3 font-medium text-right">Rt</th>
                    <th className="py-2 pr-3 font-medium text-right">A pagar</th>
                    <th className="py-2 pr-3 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {detalle.slice(0, 300).map((f) => (
                    <tr key={f.id} className="border-b border-gray-100">
                      <td className="py-1.5 pr-3">
                        {f.proveedor}
                        {f.origen !== "manual" && (
                          <span className={`ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded ${f.origen === "robot_cobro" ? "bg-amber-50 text-amber-700" : "bg-teal-50 text-teal-700"}`}>
                            {f.origen === "robot_cobro" ? "Cuenta de cobro" : "Robot"}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums">{f.numero ?? "—"}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{fechaCorta(f.fecha)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{fmtCOP(f.total)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{f.rt_pct === null ? <span className="text-amber-700">?</span> : fmtCOP(f.rt_valor)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{fmtCOP(f.valor_pagar)}</td>
                      <td className="py-1.5 pr-3 text-xs">
                        {f.pagado ? (
                          <span className="text-emerald-700">Pagada{f.metodo_pago ? ` · ${f.metodo_pago}` : ""}</span>
                        ) : (
                          <span className="text-gray-500">Pendiente</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {detalle.length > 300 && <p className="text-xs text-gray-400 mt-2">Se muestran 300 de {detalle.length}. Use el buscador para encontrar el resto.</p>}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
