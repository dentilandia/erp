import { useEffect, useMemo, useState } from "react";
import { Plus, Check, ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import type { InsumoGeneralCatalogo, InsumoGeneralBodegaAdmin } from "../lib/types";

/** Existencias de la bodega administrativa central (una sola, no por sede —
 *  ahí llega lo que se compra antes de repartirse a las sedes). Operación la
 *  ve de solo lectura para saber qué hay disponible antes de pedir;
 *  Administración además puede registrar compras/ingresos. */
export function BodegaAdminTabla({ editable }: { editable: boolean }) {
  const { perfil } = useAuth();
  const [catalogo, setCatalogo] = useState<InsumoGeneralCatalogo[]>([]);
  const [stock, setStock] = useState<InsumoGeneralBodegaAdmin[]>([]);
  const [cargando, setCargando] = useState(true);
  const [categoriasAbiertas, setCategoriasAbiertas] = useState<Record<string, boolean>>({});

  const [catalogoIdCompra, setCatalogoIdCompra] = useState("");
  const [cantidadCompra, setCantidadCompra] = useState("");
  const [motivoCompra, setMotivoCompra] = useState("");
  const [guardandoCompra, setGuardandoCompra] = useState(false);
  const [compraOk, setCompraOk] = useState(false);
  const [errorCompra, setErrorCompra] = useState<string | null>(null);

  async function cargar() {
    const { data: cat } = await supabase.from("insumos_generales_catalogo").select("*").eq("activo", true).order("orden");
    setCatalogo((cat as InsumoGeneralCatalogo[]) ?? []);
    if (cat && cat.length > 0 && !catalogoIdCompra) setCatalogoIdCompra(cat[0].id);
    const { data: st } = await supabase.from("insumos_generales_bodega_admin").select("*");
    setStock((st as InsumoGeneralBodegaAdmin[]) ?? []);
    setCargando(false);
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const categorias = useMemo(() => Array.from(new Set(catalogo.map((c) => c.categoria))), [catalogo]);
  const cantidadPorCatalogo = useMemo(() => Object.fromEntries(stock.map((s) => [s.catalogo_id, s.cantidad])), [stock]);

  async function registrarCompra() {
    const cantidad = Number(cantidadCompra);
    if (!catalogoIdCompra || !cantidad) return;
    setGuardandoCompra(true);
    setErrorCompra(null);
    const { error } = await supabase.from("insumos_generales_bodega_admin_movimientos").insert({
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
            Para cuando llega mercancía nueva a la bodega central (usa un número negativo para corregir el conteo).
          </p>
          <div className="flex items-end gap-2 flex-wrap">
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
        <h2 className="font-semibold text-tinta mb-1">Bodega administrativa — existencias</h2>
        <p className="text-xs text-gray-400 mb-3">
          {editable
            ? "Central, no es por sede. Desde acá se le entrega a cada sede en la sección de abajo."
            : "Central, no es por sede — para saber qué hay disponible antes de pedir."}
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
