import { useEffect, useMemo, useState } from "react";
import { Plus, Check, ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import type { Sede, InsumoGeneralCatalogo, InsumoGeneralBodegaAdmin } from "../lib/types";

const CONSOLIDADO = "consolidado";

/** Existencias de la bodega administrativa — cada sede tiene la suya propia
 *  (Las Américas solo se entrega a sí misma, Fabricato solo a sí misma). Con
 *  sedeId fijo (Operación) se muestra de solo lectura la de esa sede nada
 *  más; sin sedeId (Administración) trae selector con las dos sedes más una
 *  vista "Consolidado" (suma de ambas), y ahí además se puede editar. */
export function BodegaAdminTabla({ editable, sedeId }: { editable: boolean; sedeId?: string }) {
  const { perfil } = useAuth();
  const [sedes, setSedes] = useState<Sede[]>([]);
  const [sedeIdVista, setSedeIdVista] = useState(sedeId ?? CONSOLIDADO);
  const [catalogo, setCatalogo] = useState<InsumoGeneralCatalogo[]>([]);
  const [stock, setStock] = useState<InsumoGeneralBodegaAdmin[]>([]);
  const [cargando, setCargando] = useState(true);
  const [categoriasAbiertas, setCategoriasAbiertas] = useState<Record<string, boolean>>({});

  const [sedeIdCompra, setSedeIdCompra] = useState(sedeId ?? "");
  const [catalogoIdCompra, setCatalogoIdCompra] = useState("");
  const [cantidadCompra, setCantidadCompra] = useState("");
  const [motivoCompra, setMotivoCompra] = useState("");
  const [guardandoCompra, setGuardandoCompra] = useState(false);
  const [compraOk, setCompraOk] = useState(false);
  const [errorCompra, setErrorCompra] = useState<string | null>(null);

  useEffect(() => {
    if (sedeId) return;
    supabase.from("sedes").select("id, nombre, color_acento").order("nombre").then(({ data }) => {
      const filas = (data as Sede[]) ?? [];
      setSedes(filas);
      if (filas.length > 0) setSedeIdCompra((prev) => prev || filas[0].id);
    });
  }, [sedeId]);

  async function cargar() {
    const { data: cat } = await supabase.from("insumos_generales_catalogo").select("*").eq("activo", true).order("orden");
    setCatalogo((cat as InsumoGeneralCatalogo[]) ?? []);
    if (cat && cat.length > 0 && !catalogoIdCompra) setCatalogoIdCompra(cat[0].id);
    let query = supabase.from("insumos_generales_bodega_admin").select("*");
    if (sedeIdVista !== CONSOLIDADO) query = query.eq("sede_id", sedeIdVista);
    const { data: st } = await query;
    setStock((st as InsumoGeneralBodegaAdmin[]) ?? []);
    setCargando(false);
  }

  useEffect(() => {
    setCargando(true);
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sedeIdVista]);

  const categorias = useMemo(() => Array.from(new Set(catalogo.map((c) => c.categoria))), [catalogo]);
  const cantidadPorCatalogo = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const s of stock) acc[s.catalogo_id] = (acc[s.catalogo_id] ?? 0) + s.cantidad;
    return acc;
  }, [stock]);

  async function registrarCompra() {
    const cantidad = Number(cantidadCompra);
    if (!sedeIdCompra || !catalogoIdCompra || !cantidad) return;
    setGuardandoCompra(true);
    setErrorCompra(null);
    const { error } = await supabase.from("insumos_generales_bodega_admin_movimientos").insert({
      sede_id: sedeIdCompra,
      catalogo_id: catalogoIdCompra,
      cantidad,
      motivo: motivoCompra.trim() || null,
      created_by: perfil?.id ?? null,
    });
    setGuardandoCompra(false);
    if (error) {
      setErrorCompra(error.message);
      return;
    }
    setCantidadCompra("");
    setMotivoCompra("");
    setCompraOk(true);
    setTimeout(() => setCompraOk(false), 2000);
    cargar();
  }

  if (cargando) return <p className="text-sm text-gray-400">Cargando…</p>;

  return (
    <div className="space-y-4">
      {editable && (
        <section className="bg-white rounded-xl border border-gray-200 p-4">
          <h2 className="font-semibold text-tinta mb-1">Registrar compra / ingreso a bodega administrativa</h2>
          <p className="text-xs text-gray-400 mb-3">
            Para cuando llega mercancía nueva a la bodega de una sede (usa un número negativo para corregir el conteo).
          </p>
          <div className="flex items-end gap-2 flex-wrap">
            {!sedeId && (
              <select
                value={sedeIdCompra}
                onChange={(e) => setSedeIdCompra(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                {sedes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                  </option>
                ))}
              </select>
            )}
            <select
              value={catalogoIdCompra}
              onChange={(e) => setCatalogoIdCompra(e.target.value)}
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
              value={cantidadCompra}
              onChange={(e) => setCantidadCompra(e.target.value)}
              placeholder="Cantidad"
              className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              value={motivoCompra}
              onChange={(e) => setMotivoCompra(e.target.value)}
              placeholder="Motivo (opcional)"
              className="flex-1 min-w-[160px] rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <button
              onClick={registrarCompra}
              disabled={!cantidadCompra || guardandoCompra}
              className="flex items-center gap-2 rounded-lg bg-[var(--acento)] text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
            >
              {compraOk ? <Check size={16} /> : <Plus size={16} />}
              {guardandoCompra ? "Guardando…" : compraOk ? "Registrado" : "Registrar"}
            </button>
          </div>
          {errorCompra && <p className="text-sm text-red-600 mt-2">{errorCompra}</p>}
        </section>
      )}

      <section className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
          <h2 className="font-semibold text-tinta">Bodega administrativa — existencias</h2>
          {!sedeId && (
            <select
              value={sedeIdVista}
              onChange={(e) => setSedeIdVista(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value={CONSOLIDADO}>Consolidado (ambas sedes)</option>
              {sedes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          )}
        </div>
        <p className="text-xs text-gray-400 mb-3">
          Cada sede tiene su propia bodega administrativa — Las Américas solo se entrega a Las Américas, Fabricato solo
          a Fabricato. {!sedeId && "Aquí se ve por separado o consolidada."}
        </p>
        <div className="space-y-1">
          {categorias.map((categoria) => {
            const items = catalogo.filter((c) => c.categoria === categoria);
            const abierta = !!categoriasAbiertas[categoria];
            return (
              <div key={categoria} className="border border-gray-100 rounded-lg">
                <button
                  onClick={() => setCategoriasAbiertas((prev) => ({ ...prev, [categoria]: !prev[categoria] }))}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm font-semibold text-tinta"
                >
                  {abierta ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  {categoria} ({items.length})
                </button>
                {abierta && (
                  <div className="border-t border-gray-100 divide-y divide-gray-50">
                    {items.map((item) => {
                      const cantidad = cantidadPorCatalogo[item.id] ?? 0;
                      return (
                        <div key={item.id} className="flex items-center justify-between px-3 py-1.5 text-sm">
                          <span>{item.nombre}</span>
                          <span className={`font-semibold ${cantidad <= 0 ? "text-red-600" : "text-tinta"}`}>{cantidad}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
