import { useEffect, useMemo, useState } from "react";
import { Plus, Check, Bell, ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "../lib/supabase";
import { today } from "../lib/format";
import { useAuth } from "../auth/AuthContext";
import { BodegaAdminTabla } from "../components/BodegaAdminTabla";
import { InsumosGeneralesPeriodo } from "../components/InsumosGeneralesPeriodo";
import type { Sede, InsumoGeneralCatalogo, InsumoGeneralEntrega, InsumoGeneralSolicitud, InsumoGeneralSalida } from "../lib/types";

interface EntregaHistorial extends InsumoGeneralEntrega {
  insumos_generales_catalogo: { categoria: string; nombre: string } | null;
  insumos_generales_periodos: { etiqueta: string } | null;
}

interface SalidaHistorial extends InsumoGeneralSalida {
  insumos_generales_catalogo: { categoria: string; nombre: string } | null;
  insumos_generales_periodos: { etiqueta: string } | null;
}

interface SolicitudConDetalle extends InsumoGeneralSolicitud {
  insumos_generales_catalogo: { nombre: string } | null;
  sedes: { nombre: string } | null;
}

interface PedidoPendiente {
  movimientoId: string;
  periodoId: string;
  sedeId: string;
  sedeNombre: string;
  catalogoId: string;
  categoria: string;
  nombre: string;
  pedido: number;
}

function etiquetaMesActual(): string {
  const d = new Date();
  const mes = d.toLocaleDateString("es-CO", { month: "long" });
  return `${mes.charAt(0).toUpperCase()}${mes.slice(1)} ${d.getFullYear()}`;
}

export function AdministracionInventarios() {
  const { perfil } = useAuth();
  const [sedes, setSedes] = useState<Sede[]>([]);
  const [catalogo, setCatalogo] = useState<InsumoGeneralCatalogo[]>([]);

  const [sedeIdEntrega, setSedeIdEntrega] = useState("");
  const [catalogoIdEntrega, setCatalogoIdEntrega] = useState("");
  const [cantidadEntrega, setCantidadEntrega] = useState("");
  const [fechaEntrega, setFechaEntrega] = useState(today());
  const [guardandoEntrega, setGuardandoEntrega] = useState(false);
  const [entregaOk, setEntregaOk] = useState(false);
  const [errorEntrega, setErrorEntrega] = useState<string | null>(null);
  const [solicitudIdEnCurso, setSolicitudIdEnCurso] = useState<string | null>(null);

  const [solicitudesPendientes, setSolicitudesPendientes] = useState<SolicitudConDetalle[]>([]);

  const [pedidosPendientes, setPedidosPendientes] = useState<PedidoPendiente[]>([]);
  const [cantidadesEntregaPedido, setCantidadesEntregaPedido] = useState<Record<string, string>>({});
  const [entregandoPedidoId, setEntregandoPedidoId] = useState<string | null>(null);
  const [errorPedido, setErrorPedido] = useState<string | null>(null);

  const [sedeIdVista, setSedeIdVista] = useState("");

  const [sedeIdHistorial, setSedeIdHistorial] = useState("todas");
  const [historial, setHistorial] = useState<EntregaHistorial[]>([]);
  const [cargandoHistorial, setCargandoHistorial] = useState(true);
  const [periodosAbiertos, setPeriodosAbiertos] = useState<Record<string, boolean>>({});

  const [sedeIdHistorialSalidas, setSedeIdHistorialSalidas] = useState("todas");
  const [historialSalidas, setHistorialSalidas] = useState<SalidaHistorial[]>([]);
  const [cargandoHistorialSalidas, setCargandoHistorialSalidas] = useState(true);
  const [periodosAbiertosSalidas, setPeriodosAbiertosSalidas] = useState<Record<string, boolean>>({});

  useEffect(() => {
    supabase.from("sedes").select("id, nombre, color_acento").order("nombre").then(({ data }) => {
      const filas = (data as Sede[]) ?? [];
      setSedes(filas);
      if (filas.length > 0) {
        setSedeIdEntrega((prev) => prev || filas[0].id);
        setSedeIdVista((prev) => prev || filas[0].id);
      }
    });
    supabase
      .from("insumos_generales_catalogo")
      .select("*")
      .eq("activo", true)
      .order("orden")
      .then(({ data }) => {
        const filas = (data as InsumoGeneralCatalogo[]) ?? [];
        setCatalogo(filas);
        if (filas.length > 0) setCatalogoIdEntrega((prev) => prev || filas[0].id);
      });
  }, []);

  const categorias = useMemo(() => Array.from(new Set(catalogo.map((c) => c.categoria))), [catalogo]);

  async function cargarHistorial() {
    setCargandoHistorial(true);
    let query = supabase
      .from("insumos_generales_entregas")
      .select("*, insumos_generales_catalogo(categoria, nombre), insumos_generales_periodos(etiqueta)")
      .order("fecha", { ascending: false });
    if (sedeIdHistorial !== "todas") query = query.eq("sede_id", sedeIdHistorial);
    const { data } = await query.limit(500);
    setHistorial((data as unknown as EntregaHistorial[]) ?? []);
    setCargandoHistorial(false);
  }

  useEffect(() => {
    cargarHistorial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sedeIdHistorial]);

  async function cargarHistorialSalidas() {
    setCargandoHistorialSalidas(true);
    let query = supabase
      .from("insumos_generales_salidas")
      .select("*, insumos_generales_catalogo(categoria, nombre), insumos_generales_periodos(etiqueta)")
      .order("fecha", { ascending: false });
    if (sedeIdHistorialSalidas !== "todas") query = query.eq("sede_id", sedeIdHistorialSalidas);
    const { data } = await query.limit(500);
    setHistorialSalidas((data as unknown as SalidaHistorial[]) ?? []);
    setCargandoHistorialSalidas(false);
  }

  useEffect(() => {
    cargarHistorialSalidas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sedeIdHistorialSalidas]);

  async function cargarSolicitudesPendientes() {
    const { data } = await supabase
      .from("insumos_generales_solicitudes")
      .select("*, insumos_generales_catalogo(nombre), sedes(nombre)")
      .eq("estado", "pendiente")
      .order("created_at");
    setSolicitudesPendientes((data as unknown as SolicitudConDetalle[]) ?? []);
  }

  useEffect(() => {
    cargarSolicitudesPendientes();
  }, []);

  // Últimos pedidos de bodega pendientes de cada sede — el período más
  // reciente de cada una, ítems con pedido > 0. Sirve como "notificación"
  // visible ya que el sistema no manda avisos push ni por correo.
  async function cargarPedidosPendientes() {
    type PeriodoConSede = { id: string; sede_id: string; fecha_inicio: string; sedes: { nombre: string } | null };
    const { data: periodosData } = await supabase
      .from("insumos_generales_periodos")
      .select("id, sede_id, fecha_inicio, sedes(nombre)")
      .order("fecha_inicio", { ascending: false });
    const masRecientePorSede = new Map<string, { periodoId: string; sedeId: string; sedeNombre: string }>();
    for (const p of (periodosData as unknown as PeriodoConSede[]) ?? []) {
      if (!masRecientePorSede.has(p.sede_id)) {
        masRecientePorSede.set(p.sede_id, { periodoId: p.id, sedeId: p.sede_id, sedeNombre: p.sedes?.nombre ?? "—" });
      }
    }
    const periodoAInfo = new Map(Array.from(masRecientePorSede.values()).map((v) => [v.periodoId, v]));
    const periodoIds = Array.from(periodoAInfo.keys());
    if (periodoIds.length === 0) {
      setPedidosPendientes([]);
      return;
    }
    type MovConCatalogo = {
      id: string;
      periodo_id: string;
      catalogo_id: string;
      pedido: number;
      insumos_generales_catalogo: { categoria: string; nombre: string } | null;
    };
    const { data: movs } = await supabase
      .from("insumos_generales_movimientos")
      .select("id, periodo_id, catalogo_id, pedido, insumos_generales_catalogo(categoria, nombre)")
      .in("periodo_id", periodoIds)
      .gt("pedido", 0);
    const lista = ((movs as unknown as MovConCatalogo[]) ?? []).map((m) => {
      const info = periodoAInfo.get(m.periodo_id);
      return {
        movimientoId: m.id,
        periodoId: m.periodo_id,
        sedeId: info?.sedeId ?? "",
        sedeNombre: info?.sedeNombre ?? "—",
        catalogoId: m.catalogo_id,
        categoria: m.insumos_generales_catalogo?.categoria ?? "—",
        nombre: m.insumos_generales_catalogo?.nombre ?? "—",
        pedido: m.pedido,
      };
    });
    setPedidosPendientes(lista);
    setCantidadesEntregaPedido(Object.fromEntries(lista.map((p) => [p.movimientoId, String(p.pedido)])));
  }

  useEffect(() => {
    cargarPedidosPendientes();
  }, []);

  // Marcar "Entregado" hace lo mismo que "Entregar a una sede" (resta de la
  // bodega administrativa; "Entradas" en la sede queda pendiente de que
  // ellos confirmen recibido). Si se entrega menos de lo pedido, el pedido
  // no desaparece — se queda con lo que falta.
  async function marcarPedidoEntregado(p: PedidoPendiente) {
    const cantidad = Number(cantidadesEntregaPedido[p.movimientoId]);
    if (!cantidad || cantidad <= 0) return;
    setEntregandoPedidoId(p.movimientoId);
    setErrorPedido(null);
    const { error: errorEntregaPedido } = await supabase.from("insumos_generales_entregas").insert({
      catalogo_id: p.catalogoId,
      sede_id: p.sedeId,
      periodo_id: p.periodoId,
      cantidad,
      fecha: today(),
      created_by: perfil?.id ?? null,
    });
    if (errorEntregaPedido) {
      setEntregandoPedidoId(null);
      setErrorPedido(errorEntregaPedido.message);
      return;
    }
    const pedidoRestante = Math.max(0, p.pedido - cantidad);
    const { error: errorPedidoUpd } = await supabase
      .from("insumos_generales_movimientos")
      .update({ pedido: pedidoRestante })
      .eq("id", p.movimientoId);
    setEntregandoPedidoId(null);
    if (errorPedidoUpd) {
      setErrorPedido(errorPedidoUpd.message);
      return;
    }
    if (pedidoRestante > 0) {
      setPedidosPendientes((prev) => prev.map((x) => (x.movimientoId === p.movimientoId ? { ...x, pedido: pedidoRestante } : x)));
      setCantidadesEntregaPedido((prev) => ({ ...prev, [p.movimientoId]: String(pedidoRestante) }));
    } else {
      setPedidosPendientes((prev) => prev.filter((x) => x.movimientoId !== p.movimientoId));
    }
    if (sedeIdHistorial === "todas" || sedeIdHistorial === p.sedeId) cargarHistorial();
  }

  function prepararEntregaDesdeSolicitud(s: SolicitudConDetalle) {
    setSedeIdEntrega(s.sede_id);
    setCatalogoIdEntrega(s.catalogo_id);
    setCantidadEntrega(String(s.cantidad));
    setSolicitudIdEnCurso(s.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function registrarEntrega() {
    if (!sedeIdEntrega || !catalogoIdEntrega || !Number(cantidadEntrega)) return;
    setGuardandoEntrega(true);
    setErrorEntrega(null);
    let { data: periodo } = await supabase
      .from("insumos_generales_periodos")
      .select("id")
      .eq("sede_id", sedeIdEntrega)
      .order("fecha_inicio", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!periodo) {
      // La bodega administrativa se maneja de forma continua — no debe
      // bloquear la entrega porque la sede aún no abrió su período
      // operativo a mano, así que se crea uno solo.
      const { data: nuevo, error: errorPeriodo } = await supabase
        .from("insumos_generales_periodos")
        .insert({ sede_id: sedeIdEntrega, etiqueta: etiquetaMesActual(), fecha_inicio: today() })
        .select("id")
        .single();
      if (errorPeriodo || !nuevo) {
        setGuardandoEntrega(false);
        setErrorEntrega(errorPeriodo?.message ?? "No se pudo crear el período de esa sede.");
        return;
      }
      periodo = nuevo;
    }
    const { data: entrega, error } = await supabase
      .from("insumos_generales_entregas")
      .insert({
        catalogo_id: catalogoIdEntrega,
        sede_id: sedeIdEntrega,
        periodo_id: periodo.id,
        cantidad: Number(cantidadEntrega),
        fecha: fechaEntrega,
        created_by: perfil?.id ?? null,
      })
      .select("id")
      .single();
    setGuardandoEntrega(false);
    if (error) {
      setErrorEntrega(error.message);
      return;
    }
    if (solicitudIdEnCurso) {
      await supabase
        .from("insumos_generales_solicitudes")
        .update({ estado: "entregada", entrega_id: entrega.id, entregada_en: new Date().toISOString() })
        .eq("id", solicitudIdEnCurso);
      setSolicitudIdEnCurso(null);
      cargarSolicitudesPendientes();
    }
    setCantidadEntrega("");
    setEntregaOk(true);
    setTimeout(() => setEntregaOk(false), 2000);
    if (sedeIdHistorial === "todas" || sedeIdHistorial === sedeIdEntrega) cargarHistorial();
  }

  // Agrupa el histórico por período → categoría → ítems, para poder ver
  // rápido cuánto se entregó por categoría y expandir al detalle si hace falta.
  const historialPorPeriodo = useMemo(() => {
    const porPeriodo = new Map<string, { total: number; porCategoria: Map<string, { total: number; items: EntregaHistorial[] }> }>();
    for (const e of historial) {
      const etiqueta = e.insumos_generales_periodos?.etiqueta ?? "—";
      const categoria = e.insumos_generales_catalogo?.categoria ?? "—";
      if (!porPeriodo.has(etiqueta)) porPeriodo.set(etiqueta, { total: 0, porCategoria: new Map() });
      const p = porPeriodo.get(etiqueta)!;
      p.total += e.cantidad;
      if (!p.porCategoria.has(categoria)) p.porCategoria.set(categoria, { total: 0, items: [] });
      const c = p.porCategoria.get(categoria)!;
      c.total += e.cantidad;
      c.items.push(e);
    }
    return Array.from(porPeriodo.entries());
  }, [historial]);

  const historialSalidasPorPeriodo = useMemo(() => {
    const porPeriodo = new Map<string, { total: number; porCategoria: Map<string, { total: number; items: SalidaHistorial[] }> }>();
    for (const e of historialSalidas) {
      const etiqueta = e.insumos_generales_periodos?.etiqueta ?? "—";
      const categoria = e.insumos_generales_catalogo?.categoria ?? "—";
      if (!porPeriodo.has(etiqueta)) porPeriodo.set(etiqueta, { total: 0, porCategoria: new Map() });
      const p = porPeriodo.get(etiqueta)!;
      p.total += e.cantidad;
      if (!p.porCategoria.has(categoria)) p.porCategoria.set(categoria, { total: 0, items: [] });
      const c = p.porCategoria.get(categoria)!;
      c.total += e.cantidad;
      c.items.push(e);
    }
    return Array.from(porPeriodo.entries());
  }, [historialSalidas]);

  // Agrupa los pedidos pendientes por sede → categoría, para poder leerlos
  // de corrido en vez de una lista plana mezclada.
  const pedidosPendientesAgrupados = useMemo(() => {
    const porSede = new Map<string, Map<string, PedidoPendiente[]>>();
    for (const p of pedidosPendientes) {
      if (!porSede.has(p.sedeNombre)) porSede.set(p.sedeNombre, new Map());
      const porCategoria = porSede.get(p.sedeNombre)!;
      if (!porCategoria.has(p.categoria)) porCategoria.set(p.categoria, []);
      porCategoria.get(p.categoria)!.push(p);
    }
    return Array.from(porSede.entries()).map(([sedeNombre, porCategoria]) => ({
      sedeNombre,
      categorias: Array.from(porCategoria.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([categoria, items]) => ({
          categoria,
          items: [...items].sort((a, b) => a.nombre.localeCompare(b.nombre)),
        })),
    }));
  }, [pedidosPendientes]);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <BodegaAdminTabla editable />

      {pedidosPendientes.length > 0 && (
        <section className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
          <div className="flex items-center gap-2 text-amber-800 font-semibold text-sm mb-2">
            <Bell size={16} /> Pedidos de bodega pendientes ({pedidosPendientes.length})
          </div>
          <p className="text-xs text-amber-700 mb-2">
            Del período más reciente de cada sede, en Operación → Inventario → Insumos generales. Puedes cambiar la
            cantidad si no entregas todo lo pedido — lo que falte se queda pendiente. Al marcar "Entregado" se resta
            de la bodega administrativa y le llega el aviso a la sede para que confirme recibido (ahí se suma a sus
            "Entradas").
          </p>
          {errorPedido && <p className="text-sm text-red-600 mb-2">{errorPedido}</p>}
          <div className="space-y-3">
            {pedidosPendientesAgrupados.map((s) => (
              <div key={s.sedeNombre}>
                <p className="text-xs font-bold text-amber-900 uppercase tracking-wide mb-1">{s.sedeNombre}</p>
                <div className="space-y-2.5">
                  {s.categorias.map((c) => (
                    <div key={c.categoria}>
                      <p className="text-xs font-semibold text-amber-700 mb-1">{c.categoria}</p>
                      <div className="space-y-1 pl-2">
                        {c.items.map((p) => (
                          <div key={p.movimientoId} className="flex items-center justify-between gap-2 text-sm flex-wrap">
                            <p className="text-amber-800">
                              {p.nombre}: <span className="font-semibold">pedir {p.pedido}</span>
                            </p>
                            <div className="flex items-center gap-2 shrink-0">
                              <input
                                type="number"
                                value={cantidadesEntregaPedido[p.movimientoId] ?? String(p.pedido)}
                                onChange={(e) =>
                                  setCantidadesEntregaPedido((prev) => ({ ...prev, [p.movimientoId]: e.target.value }))
                                }
                                className="w-20 rounded-lg border border-amber-300 px-2 py-1.5 text-sm"
                              />
                              <button
                                onClick={() => marcarPedidoEntregado(p)}
                                disabled={entregandoPedidoId === p.movimientoId}
                                className="flex items-center gap-1 rounded-lg bg-amber-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-amber-700 disabled:opacity-40"
                              >
                                <Check size={14} /> {entregandoPedidoId === p.movimientoId ? "Entregando…" : "Entregado"}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {solicitudesPendientes.length > 0 && (
        <section className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
          <p className="font-semibold text-amber-800 mb-2">📋 Solicitudes pendientes de las sedes</p>
          <div className="space-y-1.5">
            {solicitudesPendientes.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2 text-sm flex-wrap">
                <span className="text-amber-700">
                  <span className="font-medium">{s.sedes?.nombre ?? "—"}</span> · {s.insumos_generales_catalogo?.nombre ?? "—"} ·{" "}
                  <span className="font-medium">{s.cantidad}</span>
                  {s.nota ? ` · ${s.nota}` : ""}
                </span>
                <button
                  onClick={() => prepararEntregaDesdeSolicitud(s)}
                  className="shrink-0 rounded-lg bg-amber-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-amber-700"
                >
                  Entregar
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold text-tinta mb-1">Entregar a una sede</h2>
        <p className="text-xs text-gray-400 mb-3">
          Resta de la bodega administrativa y le avisa a la sede — "Entradas" del período activo se suma cuando ellos
          confirmen recibido, no antes. Queda como histórico de entrega abajo.
        </p>
        {solicitudIdEnCurso && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2 flex items-center justify-between gap-2">
            Completando una solicitud pendiente — al entregar, queda marcada como resuelta.
            <button onClick={() => setSolicitudIdEnCurso(null)} className="underline shrink-0">
              Cancelar
            </button>
          </p>
        )}
        <div className="flex items-end gap-2 flex-wrap">
          <select
            value={sedeIdEntrega}
            onChange={(e) => setSedeIdEntrega(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            {sedes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
          <select
            value={catalogoIdEntrega}
            onChange={(e) => setCatalogoIdEntrega(e.target.value)}
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
            value={fechaEntrega}
            onChange={(e) => setFechaEntrega(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            type="number"
            value={cantidadEntrega}
            onChange={(e) => setCantidadEntrega(e.target.value)}
            placeholder="Cantidad"
            className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            onClick={registrarEntrega}
            disabled={!cantidadEntrega || guardandoEntrega}
            className="flex items-center gap-2 rounded-lg bg-[var(--acento)] text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
          >
            {entregaOk ? <Check size={16} /> : <Plus size={16} />}
            {guardandoEntrega ? "Guardando…" : entregaOk ? "Registrado" : "Entregar"}
          </button>
        </div>
        {errorEntrega && <p className="text-sm text-red-600 mt-2">{errorEntrega}</p>}
      </section>

      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold text-tinta">Existencias y conteo por sede</h2>
          <select
            value={sedeIdVista}
            onChange={(e) => setSedeIdVista(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            {sedes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </div>
        {sedeIdVista && <InsumosGeneralesPeriodo sedeId={sedeIdVista} />}
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h2 className="font-semibold text-tinta">Histórico de entregas (bodega administrativa → sede)</h2>
          <select
            value={sedeIdHistorial}
            onChange={(e) => setSedeIdHistorial(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="todas">Todas las sedes</option>
            {sedes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </div>
        {cargandoHistorial ? (
          <p className="text-sm text-gray-400">Cargando…</p>
        ) : historialPorPeriodo.length === 0 ? (
          <p className="text-sm text-gray-400">Todavía no hay entregas registradas.</p>
        ) : (
          <div className="space-y-2">
            {historialPorPeriodo.map(([etiqueta, p]) => {
              const abierto = !!periodosAbiertos[etiqueta];
              return (
                <div key={etiqueta} className="border border-gray-100 rounded-lg">
                  <button
                    onClick={() => setPeriodosAbiertos((prev) => ({ ...prev, [etiqueta]: !prev[etiqueta] }))}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm font-semibold text-tinta"
                  >
                    <span className="flex items-center gap-2">
                      {abierto ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      {etiqueta}
                    </span>
                    <span className="text-gray-400 font-normal">{p.total} unidades entregadas</span>
                  </button>
                  {abierto && (
                    <div className="border-t border-gray-100 divide-y divide-gray-50">
                      {Array.from(p.porCategoria.entries()).map(([categoria, c]) => (
                        <div key={categoria} className="px-3 py-2">
                          <div className="flex items-center justify-between text-sm font-medium text-gray-600 mb-1">
                            <span>{categoria}</span>
                            <span>{c.total}</span>
                          </div>
                          <div className="space-y-0.5">
                            {c.items.map((it) => (
                              <div key={it.id} className="flex items-center justify-between text-xs text-gray-500 pl-4">
                                <span>
                                  {it.fecha} · {it.insumos_generales_catalogo?.nombre ?? "—"}
                                  {sedeIdHistorial === "todas" && ` · ${sedes.find((s) => s.id === it.sede_id)?.nombre ?? "—"}`}
                                </span>
                                <span className="font-medium">{it.cantidad}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h2 className="font-semibold text-tinta">Histórico de salidas (consumo por sede)</h2>
          <select
            value={sedeIdHistorialSalidas}
            onChange={(e) => setSedeIdHistorialSalidas(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="todas">Todas las sedes</option>
            {sedes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </div>
        {cargandoHistorialSalidas ? (
          <p className="text-sm text-gray-400">Cargando…</p>
        ) : historialSalidasPorPeriodo.length === 0 ? (
          <p className="text-sm text-gray-400">Todavía no hay salidas registradas.</p>
        ) : (
          <div className="space-y-2">
            {historialSalidasPorPeriodo.map(([etiqueta, p]) => {
              const abierto = !!periodosAbiertosSalidas[etiqueta];
              return (
                <div key={etiqueta} className="border border-gray-100 rounded-lg">
                  <button
                    onClick={() => setPeriodosAbiertosSalidas((prev) => ({ ...prev, [etiqueta]: !prev[etiqueta] }))}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm font-semibold text-tinta"
                  >
                    <span className="flex items-center gap-2">
                      {abierto ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      {etiqueta}
                    </span>
                    <span className="text-gray-400 font-normal">{p.total} unidades salidas</span>
                  </button>
                  {abierto && (
                    <div className="border-t border-gray-100 divide-y divide-gray-50">
                      {Array.from(p.porCategoria.entries()).map(([categoria, c]) => (
                        <div key={categoria} className="px-3 py-2">
                          <div className="flex items-center justify-between text-sm font-medium text-gray-600 mb-1">
                            <span>{categoria}</span>
                            <span>{c.total}</span>
                          </div>
                          <div className="space-y-0.5">
                            {c.items.map((it) => (
                              <div key={it.id} className="flex items-center justify-between text-xs text-gray-500 pl-4">
                                <span>
                                  {it.fecha} · {it.insumos_generales_catalogo?.nombre ?? "—"}
                                  {sedeIdHistorialSalidas === "todas" && ` · ${sedes.find((s) => s.id === it.sede_id)?.nombre ?? "—"}`}
                                  {it.motivo ? ` · ${it.motivo}` : ""}
                                </span>
                                <span className="font-medium">{it.cantidad}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
