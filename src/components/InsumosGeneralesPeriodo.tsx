import { useEffect, useMemo, useState } from "react";
import { Plus, ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "../lib/supabase";
import { today } from "../lib/format";
import type { InsumoGeneralCatalogo, InsumoGeneralPeriodo, InsumoGeneralMovimiento, InsumoGeneralEntrega } from "../lib/types";

interface EntregaConCatalogo extends InsumoGeneralEntrega {
  insumos_generales_catalogo: { nombre: string } | null;
}

/** Bodega operativa de una sede — réplica del Excel: catálogo compartido de
 *  172 ítems por categoría, con un período de conteo a la vez (inventario
 *  inicial, entrega 1/2, entradas, pedido → inventario final). Se usa tanto
 *  en Operación (atada a la sede activa) como en Administración (con
 *  selector de sede) — por eso recibe sedeId como prop en vez de leerlo del
 *  contexto de la ruta. */
export function InsumosGeneralesPeriodo({ sedeId }: { sedeId: string }) {
  const [catalogo, setCatalogo] = useState<InsumoGeneralCatalogo[]>([]);
  const [periodos, setPeriodos] = useState<InsumoGeneralPeriodo[]>([]);
  const [periodoId, setPeriodoId] = useState("");
  const [movimientos, setMovimientos] = useState<Record<string, InsumoGeneralMovimiento>>({});
  const [entregasRecibidas, setEntregasRecibidas] = useState<EntregaConCatalogo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [categoriasAbiertas, setCategoriasAbiertas] = useState<Record<string, boolean>>({});
  const [nuevaEtiqueta, setNuevaEtiqueta] = useState("");
  const [creandoPeriodo, setCreandoPeriodo] = useState(false);
  const [errorPeriodo, setErrorPeriodo] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("insumos_generales_catalogo")
      .select("*")
      .eq("activo", true)
      .order("orden")
      .then(({ data }) => setCatalogo((data as InsumoGeneralCatalogo[]) ?? []));
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

  useEffect(() => {
    setCargando(true);
    cargarPeriodos();
    cargarEntregasRecibidas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sedeId]);

  useEffect(() => {
    if (!periodoId) {
      setMovimientos({});
      return;
    }
    supabase
      .from("insumos_generales_movimientos")
      .select("*")
      .eq("periodo_id", periodoId)
      .then(({ data }) => {
        const filas = (data as InsumoGeneralMovimiento[]) ?? [];
        setMovimientos(Object.fromEntries(filas.map((m) => [m.catalogo_id, m])));
      });
  }, [periodoId]);

  const categorias = useMemo(() => Array.from(new Set(catalogo.map((c) => c.categoria))), [catalogo]);

  async function crearPeriodo() {
    if (!nuevaEtiqueta.trim()) return;
    setCreandoPeriodo(true);
    setErrorPeriodo(null);
    const { data: nuevo, error } = await supabase
      .from("insumos_generales_periodos")
      .insert({ sede_id: sedeId, etiqueta: nuevaEtiqueta.trim(), fecha_inicio: today() })
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
          m.inventario_inicial - m.entrega1 - m.entrega2 + m.entradas,
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
    setNuevaEtiqueta("");
    await cargarPeriodos();
    setPeriodoId(nuevo.id);
  }

  function actualizarCampo(catalogoId: string, campo: "inventario_inicial" | "entrega1" | "entrega2" | "entradas" | "pedido", valor: number) {
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

  const periodoActivo = periodos.find((p) => p.id === periodoId);

  if (cargando) return <p className="text-sm text-gray-400">Cargando…</p>;

  return (
    <div className="space-y-4">
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
          <input
            value={nuevaEtiqueta}
            onChange={(e) => setNuevaEtiqueta(e.target.value)}
            placeholder='Nombre del período nuevo, ej. "Septiembre 2026"'
            className="flex-1 min-w-[180px] rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            onClick={crearPeriodo}
            disabled={!nuevaEtiqueta.trim() || creandoPeriodo}
            className="flex items-center gap-2 rounded-lg bg-[var(--acento)] text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
          >
            <Plus size={16} /> {creandoPeriodo ? "Creando…" : "Nuevo período"}
          </button>
        </div>
        {errorPeriodo && <p className="text-sm text-red-600">{errorPeriodo}</p>}
        <p className="text-xs text-gray-400">
          El inventario inicial de un período nuevo parte del inventario final del período anterior de esta sede. La
          columna "Entradas" también se llena sola cuando administración registra una entrega desde la bodega
          administrativa central.
        </p>
      </section>

      {entregasRecibidas.length > 0 && (
        <section className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-400 mb-1.5">Últimas entregas recibidas de la bodega administrativa</p>
          <div className="space-y-1">
            {entregasRecibidas.map((e) => (
              <div key={e.id} className="text-xs text-gray-500">
                {e.fecha} · {e.insumos_generales_catalogo?.nombre ?? "—"} · <span className="font-medium">{e.cantidad}</span>
              </div>
            ))}
          </div>
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
                        <th className="px-2 py-1.5 text-right">Entrega 1</th>
                        <th className="px-2 py-1.5 text-right">Entrega 2</th>
                        <th className="px-2 py-1.5 text-right">Consumo</th>
                        <th className="px-2 py-1.5 text-right">Entradas</th>
                        <th className="px-2 py-1.5 text-right">Final</th>
                        <th className="px-2 py-1.5 text-right">Pedido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => {
                        const mov = movimientos[item.id];
                        if (!mov) return null;
                        const consumo = mov.entrega1 + mov.entrega2;
                        const final = mov.inventario_inicial - consumo + mov.entradas;
                        return (
                          <tr key={item.id} className="border-t border-gray-100">
                            <td className="px-3 py-1.5">{item.nombre}</td>
                            {(["inventario_inicial", "entrega1", "entrega2"] as const).map((campo) => (
                              <td key={campo} className="px-2 py-1.5 text-right">
                                <input
                                  type="number"
                                  defaultValue={mov[campo]}
                                  onBlur={(e) => {
                                    const v = Number(e.target.value) || 0;
                                    actualizarCampo(item.id, campo, v);
                                    guardarCampo(item.id, campo, v);
                                  }}
                                  className="w-16 rounded-md border border-gray-200 px-1.5 py-1 text-right"
                                />
                              </td>
                            ))}
                            <td className="px-2 py-1.5 text-right text-gray-500">{consumo}</td>
                            <td className="px-2 py-1.5 text-right">
                              <input
                                type="number"
                                defaultValue={mov.entradas}
                                onBlur={(e) => {
                                  const v = Number(e.target.value) || 0;
                                  actualizarCampo(item.id, "entradas", v);
                                  guardarCampo(item.id, "entradas", v);
                                }}
                                className="w-16 rounded-md border border-gray-200 px-1.5 py-1 text-right"
                              />
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
