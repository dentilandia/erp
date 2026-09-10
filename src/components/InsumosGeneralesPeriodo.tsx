import { useEffect, useMemo, useState } from "react";
import { Plus, Check, ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "../lib/supabase";
import { today } from "../lib/format";
import { useAuth } from "../auth/AuthContext";
import type {
  InsumoGeneralCatalogo,
  InsumoGeneralPeriodo,
  InsumoGeneralMovimiento,
  InsumoGeneralEntrega,
  InsumoGeneralSalida,
  InsumoGeneralSolicitud,
} from "../lib/types";

interface EntregaConCatalogo extends InsumoGeneralEntrega {
  insumos_generales_catalogo: { nombre: string } | null;
}

interface SalidaConCatalogo extends InsumoGeneralSalida {
  insumos_generales_catalogo: { nombre: string } | null;
}

interface SolicitudConCatalogo extends InsumoGeneralSolicitud {
  insumos_generales_catalogo: { nombre: string } | null;
}

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
const ANIO_ACTUAL = new Date().getFullYear();
const ANIOS = [ANIO_ACTUAL - 1, ANIO_ACTUAL, ANIO_ACTUAL + 1];

/** Bodega operativa de una sede — réplica del Excel: catálogo compartido de
 *  172 ítems por categoría, con un período de conteo a la vez (inventario
 *  inicial, entrega 1/2, salidas, entradas, pedido → inventario final). Se
 *  usa tanto en Operación (atada a la sede activa) como en Administración
 *  (con selector de sede) — por eso recibe sedeId como prop en vez de
 *  leerlo del contexto de la ruta. */
export function InsumosGeneralesPeriodo({ sedeId }: { sedeId: string }) {
  const { perfil } = useAuth();
  const [catalogo, setCatalogo] = useState<InsumoGeneralCatalogo[]>([]);
  const [periodos, setPeriodos] = useState<InsumoGeneralPeriodo[]>([]);
  const [periodoId, setPeriodoId] = useState("");
  const [movimientos, setMovimientos] = useState<Record<string, InsumoGeneralMovimiento>>({});
  const [entregasRecibidas, setEntregasRecibidas] = useState<EntregaConCatalogo[]>([]);
  const [salidasRegistradas, setSalidasRegistradas] = useState<SalidaConCatalogo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [categoriasAbiertas, setCategoriasAbiertas] = useState<Record<string, boolean>>({});
  const [mesNuevo, setMesNuevo] = useState(MESES[new Date().getMonth()]);
  const [anioNuevo, setAnioNuevo] = useState(new Date().getFullYear());
  const [creandoPeriodo, setCreandoPeriodo] = useState(false);
  const [errorPeriodo, setErrorPeriodo] = useState<string | null>(null);

  const [catalogoIdSalida, setCatalogoIdSalida] = useState("");
  const [cantidadSalida, setCantidadSalida] = useState("");
  const [fechaSalida, setFechaSalida] = useState(today());
  const [motivoSalida, setMotivoSalida] = useState("");
  const [guardandoSalida, setGuardandoSalida] = useState(false);
  const [salidaOk, setSalidaOk] = useState(false);
  const [errorSalida, setErrorSalida] = useState<string | null>(null);

  const [solicitudes, setSolicitudes] = useState<SolicitudConCatalogo[]>([]);
  const [catalogoIdSolicitud, setCatalogoIdSolicitud] = useState("");
  const [cantidadSolicitud, setCantidadSolicitud] = useState("");
  const [notaSolicitud, setNotaSolicitud] = useState("");
  const [guardandoSolicitud, setGuardandoSolicitud] = useState(false);
  const [solicitudOk, setSolicitudOk] = useState(false);
  const [errorSolicitud, setErrorSolicitud] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("insumos_generales_catalogo")
      .select("*")
      .eq("activo", true)
      .order("orden")
      .then(({ data }) => {
        const filas = (data as InsumoGeneralCatalogo[]) ?? [];
        setCatalogo(filas);
        if (filas.length > 0) setCatalogoIdSalida((prev) => prev || filas[0].id);
      });
  }, []);

  async function cargarPeriodos() {
    const { data } = await supabase
      .from("insumos_generales_periodos")
      .select("*")
      .eq("sede_id", sedeId)
      .order("fecha_inicio", { ascending: false });
    const filas = (data as InsumoGeneralPeriodo[]) ?? [];
    setPeriodos(filas);
    setPeriodoId((prev) => (prev && filas.some((p) => p.id === prev) ? prev : filas[0]?.id ?? ""));
    setCargando(false);
  }

  async function cargarEntregasRecibidas() {
    const { data } = await supabase
      .from("insumos_generales_entregas")
      .select("*, insumos_generales_catalogo(nombre)")
      .eq("sede_id", sedeId)
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(10);
    setEntregasRecibidas((data as unknown as EntregaConCatalogo[]) ?? []);
  }

  async function marcarEntregasVistas() {
    const ids = entregasRecibidas.filter((e) => !e.visto).map((e) => e.id);
    if (ids.length === 0) return;
    await supabase.from("insumos_generales_entregas").update({ visto: true }).in("id", ids);
    cargarEntregasRecibidas();
  }

  async function cargarSalidas() {
    const { data } = await supabase
      .from("insumos_generales_salidas")
      .select("*, insumos_generales_catalogo(nombre)")
      .eq("sede_id", sedeId)
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(10);
    setSalidasRegistradas((data as unknown as SalidaConCatalogo[]) ?? []);
  }

  async function cargarSolicitudes() {
    const { data } = await supabase
      .from("insumos_generales_solicitudes")
      .select("*, insumos_generales_catalogo(nombre)")
      .eq("sede_id", sedeId)
      .order("created_at", { ascending: false })
      .limit(10);
    setSolicitudes((data as unknown as SolicitudConCatalogo[]) ?? []);
  }

  useEffect(() => {
    setCargando(true);
    cargarPeriodos();
    cargarEntregasRecibidas();
    cargarSalidas();
    cargarSolicitudes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sedeId]);

  async function cargarMovimientos() {
    if (!periodoId) {
      setMovimientos({});
      return;
    }
    const { data } = await supabase.from("insumos_generales_movimientos").select("*").eq("periodo_id", periodoId);
    const filas = (data as InsumoGeneralMovimiento[]) ?? [];
    setMovimientos(Object.fromEntries(filas.map((m) => [m.catalogo_id, m])));
    // Si el período está completamente vacío (recién creado en otra sesión, o
    // se recargó la página), se abren todas las categorías de una vez — si no,
    // parece que no hay dónde escribir el inventario inicial.
    const vacio = filas.every(
      (m) => !m.inventario_inicial && !m.entrega1 && !m.entrega2 && !m.salidas && !m.entradas && !m.pedido,
    );
    if (filas.length > 0 && vacio) {
      setCategoriasAbiertas(Object.fromEntries(catalogo.map((c) => [c.categoria, true])));
    }
  }

  useEffect(() => {
    cargarMovimientos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodoId]);

  const categorias = useMemo(() => Array.from(new Set(catalogo.map((c) => c.categoria))), [catalogo]);

  async function crearPeriodo() {
    setCreandoPeriodo(true);
    setErrorPeriodo(null);
    const etiqueta = `${mesNuevo} ${anioNuevo}`;
    const { data: nuevo, error } = await supabase
      .from("insumos_generales_periodos")
      .insert({ sede_id: sedeId, etiqueta, fecha_inicio: today() })
      .select("*")
      .single();
    if (error || !nuevo) {
      setCreandoPeriodo(false);
      setErrorPeriodo(error?.message ?? "No se pudo crear el período.");
      return;
    }
    // El inventario inicial de este período parte del inventario final del
    // período anterior de la misma sede (0 si es el primero).
    const anterior = periodos[0];
    let inicialPorCatalogo: Record<string, number> = {};
    if (anterior) {
      const { data: movsAnterior } = await supabase
        .from("insumos_generales_movimientos")
        .select("*")
        .eq("periodo_id", anterior.id);
      inicialPorCatalogo = Object.fromEntries(
        ((movsAnterior as InsumoGeneralMovimiento[]) ?? []).map((m) => [
          m.catalogo_id,
          m.inventario_inicial - m.entrega1 - m.entrega2 - m.salidas + m.entradas,
        ]),
      );
    }
    const filasNuevas = catalogo.map((c) => ({
      periodo_id: nuevo.id,
      catalogo_id: c.id,
      inventario_inicial: inicialPorCatalogo[c.id] ?? 0,
    }));
    const { error: errorMovs } = await supabase.from("insumos_generales_movimientos").insert(filasNuevas);
    setCreandoPeriodo(false);
    if (errorMovs) {
      setErrorPeriodo(errorMovs.message);
      return;
    }
    await cargarPeriodos();
    setPeriodoId(nuevo.id);
    // Abre todas las categorías de una vez — si no, un período recién creado
    // se ve como si solo tuviera "Registrar salida" y no quedara claro dónde
    // escribir el inventario inicial (las categorías empiezan colapsadas).
    setCategoriasAbiertas(Object.fromEntries(categorias.map((c) => [c, true])));
  }

  function actualizarCampo(
    catalogoId: string,
    campo: "inventario_inicial" | "entrega1" | "entrega2" | "salidas" | "entradas" | "pedido",
    valor: number,
  ) {
    setMovimientos((prev) => {
      const actual = prev[catalogoId];
      if (!actual) return prev;
      return { ...prev, [catalogoId]: { ...actual, [campo]: valor } };
    });
  }

  async function guardarCampo(catalogoId: string, campo: string, valor: number) {
    const mov = movimientos[catalogoId];
    if (!mov) return;
    await supabase.from("insumos_generales_movimientos").update({ [campo]: valor }).eq("id", mov.id);
  }

  async function registrarSalida() {
    if (!periodoId || !catalogoIdSalida || !Number(cantidadSalida)) return;
    setGuardandoSalida(true);
    setErrorSalida(null);
    const { error } = await supabase.from("insumos_generales_salidas").insert({
      sede_id: sedeId,
      periodo_id: periodoId,
      catalogo_id: catalogoIdSalida,
      cantidad: Number(cantidadSalida),
      fecha: fechaSalida,
      motivo: motivoSalida.trim() || null,
      created_by: perfil?.id ?? null,
    });
    setGuardandoSalida(false);
    if (error) {
      setErrorSalida(error.message);
      return;
    }
    setCantidadSalida("");
    setMotivoSalida("");
    setSalidaOk(true);
    setTimeout(() => setSalidaOk(false), 2000);
    const categoria = catalogo.find((c) => c.id === catalogoIdSalida)?.categoria;
    if (categoria) setCategoriasAbiertas((prev) => ({ ...prev, [categoria]: true }));
    cargarMovimientos();
    cargarSalidas();
  }

  async function crearSolicitud() {
    if (!catalogoIdSolicitud || !Number(cantidadSolicitud)) return;
    setGuardandoSolicitud(true);
    setErrorSolicitud(null);
    const { error } = await supabase.from("insumos_generales_solicitudes").insert({
      sede_id: sedeId,
      catalogo_id: catalogoIdSolicitud,
      cantidad: Number(cantidadSolicitud),
      nota: notaSolicitud.trim() || null,
      created_by: perfil?.id ?? null,
    });
    setGuardandoSolicitud(false);
    if (error) {
      setErrorSolicitud(error.message);
      return;
    }
    setCantidadSolicitud("");
    setNotaSolicitud("");
    setSolicitudOk(true);
    setTimeout(() => setSolicitudOk(false), 2000);
    cargarSolicitudes();
  }

  const periodoActivo = periodos.find((p) => p.id === periodoId);
  const entregasNoVistas = entregasRecibidas.filter((e) => !e.visto);

  if (cargando) return <p className="text-sm text-gray-400">Cargando…</p>;

  return (
    <div className="space-y-4">
      {entregasNoVistas.length > 0 && (
        <section className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-4">
          <p className="font-semibold text-emerald-800 mb-2">📦 Llegaron entregas nuevas de administración</p>
          <div className="space-y-1 mb-3">
            {entregasNoVistas.map((e) => (
              <p key={e.id} className="text-sm text-emerald-700">
                {e.fecha} · {e.insumos_generales_catalogo?.nombre ?? "—"} ·{" "}
                <span className="font-semibold">{e.cantidad}</span>
              </p>
            ))}
          </div>
          <p className="text-xs text-emerald-600 mb-2">
            Ya se sumaron solas a "Entradas" del período correspondiente — esto es solo para que no se te pase que
            llegaron.
          </p>
          <button
            onClick={marcarEntregasVistas}
            className="rounded-lg bg-emerald-600 text-white px-4 py-2 text-sm font-medium hover:bg-emerald-700"
          >
            Entendido
          </button>
        </section>
      )}

      <section className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <select
            value={periodoId}
            onChange={(e) => setPeriodoId(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            {periodos.length === 0 && <option value="">Sin períodos todavía</option>}
            {periodos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.etiqueta}
                {p.cerrado ? " (cerrado)" : ""}
              </option>
            ))}
          </select>
          <select
            value={mesNuevo}
            onChange={(e) => setMesNuevo(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            {MESES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <select
            value={anioNuevo}
            onChange={(e) => setAnioNuevo(Number(e.target.value))}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            {ANIOS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <button
            onClick={crearPeriodo}
            disabled={creandoPeriodo}
            className="flex items-center gap-2 rounded-lg bg-[var(--acento)] text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
          >
            <Plus size={16} /> {creandoPeriodo ? "Creando…" : "Nuevo período"}
          </button>
        </div>
        {errorPeriodo && <p className="text-sm text-red-600">{errorPeriodo}</p>}
        <p className="text-xs text-gray-400">
          El inventario inicial de un período nuevo parte del inventario final del período anterior de esta sede. La
          columna "Entradas" se llena sola cuando administración registra una entrega desde la bodega administrativa;
          "Salidas" se llena con el formulario de abajo.
        </p>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold text-tinta mb-1">Solicitar insumos a la bodega administrativa</h2>
        <p className="text-xs text-gray-400 mb-3">
          Queda como pendiente hasta que administración la entregue — ahí llega la notificación y se suma sola a
          "Entradas" de esta sede.
        </p>
        <div className="flex items-end gap-2 flex-wrap">
          <select
            value={catalogoIdSolicitud}
            onChange={(e) => setCatalogoIdSolicitud(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm min-w-[200px]"
          >
            {categorias.map((categoria) => (
              <optgroup key={categoria} label={categoria}>
                {catalogo
                  .filter((c) => c.categoria === categoria)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          <input
            type="number"
            value={cantidadSolicitud}
            onChange={(e) => setCantidadSolicitud(e.target.value)}
            placeholder="Cantidad"
            className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            value={notaSolicitud}
            onChange={(e) => setNotaSolicitud(e.target.value)}
            placeholder="Nota (opcional)"
            className="flex-1 min-w-[160px] rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            onClick={crearSolicitud}
            disabled={!cantidadSolicitud || guardandoSolicitud}
            className="flex items-center gap-2 rounded-lg bg-[var(--acento)] text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
          >
            {solicitudOk ? <Check size={16} /> : <Plus size={16} />}
            {guardandoSolicitud ? "Guardando…" : solicitudOk ? "Solicitada" : "Solicitar"}
          </button>
        </div>
        {errorSolicitud && <p className="text-sm text-red-600 mt-2">{errorSolicitud}</p>}
        {solicitudes.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-100 space-y-1">
            <p className="text-xs font-medium text-gray-400 mb-1">Últimas solicitudes</p>
            {solicitudes.map((s) => (
              <div key={s.id} className="flex items-center justify-between text-xs text-gray-500">
                <span>
                  {s.insumos_generales_catalogo?.nombre ?? "—"} · <span className="font-medium">{s.cantidad}</span>
                  {s.nota ? ` · ${s.nota}` : ""}
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 font-medium ${
                    s.estado === "entregada" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {s.estado === "entregada" ? "Entregada" : "Pendiente"}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {periodoActivo && (
        <section className="bg-white rounded-xl border border-gray-200 p-4">
          <h2 className="font-semibold text-tinta mb-1">Registrar salida</h2>
          <p className="text-xs text-gray-400 mb-3">
            Para cuando sale mercancía de esta bodega hacia consultorio o uso clínico — queda registrada con fecha e
            ítem, y suma a "Salidas" del período activo.
          </p>
          <div className="flex items-end gap-2 flex-wrap">
            <select
              value={catalogoIdSalida}
              onChange={(e) => setCatalogoIdSalida(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm min-w-[200px]"
            >
              {categorias.map((categoria) => (
                <optgroup key={categoria} label={categoria}>
                  {catalogo
                    .filter((c) => c.categoria === categoria)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
            <input
              type="date"
              value={fechaSalida}
              onChange={(e) => setFechaSalida(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              type="number"
              value={cantidadSalida}
              onChange={(e) => setCantidadSalida(e.target.value)}
              placeholder="Cantidad"
              className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              value={motivoSalida}
              onChange={(e) => setMotivoSalida(e.target.value)}
              placeholder="Motivo (opcional)"
              className="flex-1 min-w-[160px] rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <button
              onClick={registrarSalida}
              disabled={!cantidadSalida || guardandoSalida}
              className="flex items-center gap-2 rounded-lg bg-[var(--acento)] text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
            >
              {salidaOk ? <Check size={16} /> : <Plus size={16} />}
              {guardandoSalida ? "Guardando…" : salidaOk ? "Registrado" : "Registrar"}
            </button>
          </div>
          {errorSalida && <p className="text-sm text-red-600 mt-2">{errorSalida}</p>}
        </section>
      )}

      {(entregasRecibidas.length > 0 || salidasRegistradas.length > 0) && (
        <section className="bg-white rounded-xl border border-gray-200 p-4 grid sm:grid-cols-2 gap-4">
          {entregasRecibidas.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-400 mb-1.5">Últimas entregas recibidas de la bodega administrativa</p>
              <div className="space-y-1">
                {entregasRecibidas.map((e) => (
                  <div key={e.id} className="text-xs text-gray-500">
                    {e.fecha} · {e.insumos_generales_catalogo?.nombre ?? "—"} · <span className="font-medium">{e.cantidad}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {salidasRegistradas.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-400 mb-1.5">Últimas salidas registradas</p>
              <div className="space-y-1">
                {salidasRegistradas.map((s) => (
                  <div key={s.id} className="text-xs text-gray-500">
                    {s.fecha} · {s.insumos_generales_catalogo?.nombre ?? "—"} · <span className="font-medium">{s.cantidad}</span>
                    {s.motivo ? ` · ${s.motivo}` : ""}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {!periodoActivo ? (
        <p className="text-sm text-gray-400">Crea un período para empezar a registrar el conteo.</p>
      ) : (
        categorias.map((categoria) => {
          const items = catalogo.filter((c) => c.categoria === categoria);
          const abierta = !!categoriasAbiertas[categoria];
          return (
            <section key={categoria} className="bg-white rounded-xl border border-gray-200">
              <button
                onClick={() => setCategoriasAbiertas((prev) => ({ ...prev, [categoria]: !prev[categoria] }))}
                className="w-full flex items-center gap-2 px-4 py-3 text-sm font-semibold text-tinta"
              >
                {abierta ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                {categoria} ({items.length})
              </button>
              {abierta && (
                <div className="border-t border-gray-100 overflow-x-auto">
                  <table className="w-full text-xs sm:text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-left text-gray-500">
                        <th className="px-3 py-1.5">Ítem</th>
                        <th className="px-2 py-1.5 text-right">Inicial</th>
                        <th className="px-2 py-1.5 text-right">Salidas</th>
                        <th className="px-2 py-1.5 text-right">Entradas</th>
                        <th className="px-2 py-1.5 text-right">Final</th>
                        <th className="px-2 py-1.5 text-right">Pedido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => {
                        const mov = movimientos[item.id];
                        if (!mov) return null;
                        const final = mov.inventario_inicial - mov.salidas + mov.entradas;
                        return (
                          <tr key={item.id} className="border-t border-gray-100">
                            <td className="px-3 py-1.5">{item.nombre}</td>
                            <td className="px-2 py-1.5 text-right">
                              <input
                                type="number"
                                defaultValue={mov.inventario_inicial}
                                onBlur={(e) => {
                                  const v = Number(e.target.value) || 0;
                                  actualizarCampo(item.id, "inventario_inicial", v);
                                  guardarCampo(item.id, "inventario_inicial", v);
                                }}
                                className="w-16 rounded-md border border-gray-200 px-1.5 py-1 text-right"
                              />
                            </td>
                            <td className="px-2 py-1.5 text-right text-gray-500" title="Se llena sola con 'Registrar salida' — no editable a mano.">
                              {mov.salidas}
                            </td>
                            <td className="px-2 py-1.5 text-right text-gray-500" title="Se llena sola cuando administración entrega — no editable a mano.">
                              {mov.entradas}
                            </td>
                            <td className={`px-2 py-1.5 text-right font-semibold ${final <= 0 ? "text-red-600" : "text-tinta"}`}>
                              {final}
                            </td>
                            <td className="px-2 py-1.5 text-right">
                              <input
                                type="number"
                                defaultValue={mov.pedido}
                                onBlur={(e) => {
                                  const v = Number(e.target.value) || 0;
                                  actualizarCampo(item.id, "pedido", v);
                                  guardarCampo(item.id, "pedido", v);
                                }}
                                className="w-16 rounded-md border border-gray-200 px-1.5 py-1 text-right"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
