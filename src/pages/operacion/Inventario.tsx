import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { AlertTriangle, Plus, Check, ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { today } from "../../lib/format";
import {
  TIPOS_INVENTARIO,
  type Sede,
  type Doctora,
  type Paciente,
  type InventarioStock,
  type InsumoGeneralCatalogo,
  type InsumoGeneralPeriodo,
  type InsumoGeneralMovimiento,
} from "../../lib/types";
import { PacienteAutocomplete } from "../../components/PacienteAutocomplete";

const TIPO_LABEL: Record<string, string> = Object.fromEntries(TIPOS_INVENTARIO.map((t) => [t.value, t.label]));

const TABS = [
  { value: "clinicos", label: "Insumos clínicos" },
  { value: "generales", label: "Insumos generales" },
] as const;
type Tab = (typeof TABS)[number]["value"];

export function Inventario() {
  const [tab, setTab] = useState<Tab>("clinicos");
  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`text-sm font-medium px-3 py-1.5 rounded-lg ${
              tab === t.value ? "bg-[var(--acento)] text-white" : "bg-gray-100 text-gray-500"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "clinicos" ? <InsumosClinicos /> : <InsumosGenerales />}
    </div>
  );
}

interface EntregaBoton {
  id: string;
  fecha: string;
  con_cadeneta: boolean;
  pacientes: { nombre: string };
  doctoras: { nombre: string } | null;
}

function InsumosClinicos() {
  const { sedeActiva } = useOutletContext<{ sedeActiva: Sede }>();
  const [stock, setStock] = useState<InventarioStock[]>([]);
  const [doctoras, setDoctoras] = useState<Doctora[]>([]);
  const [ultimasEntregasBoton, setUltimasEntregasBoton] = useState<EntregaBoton[]>([]);
  const [cargando, setCargando] = useState(true);

  const [tipoReponer, setTipoReponer] = useState(TIPOS_INVENTARIO[0].value);
  const [cantidadReponer, setCantidadReponer] = useState("");
  const [motivoReponer, setMotivoReponer] = useState("");
  const [guardandoReponer, setGuardandoReponer] = useState(false);
  const [reponerOk, setReponerOk] = useState(false);
  const [errorReponer, setErrorReponer] = useState<string | null>(null);

  const [pacienteBoton, setPacienteBoton] = useState<Paciente | null>(null);
  const [doctoraBotonId, setDoctoraBotonId] = useState("");
  const [conCadeneta, setConCadeneta] = useState(false);
  const [guardandoBoton, setGuardandoBoton] = useState(false);
  const [botonOk, setBotonOk] = useState(false);
  const [errorBoton, setErrorBoton] = useState<string | null>(null);

  async function cargarStock() {
    const { data } = await supabase.from("inventario_stock").select("*").eq("sede_id", sedeActiva.id);
    setStock((data as InventarioStock[]) ?? []);
    const { data: entregas } = await supabase
      .from("entregas_boton")
      .select("id, fecha, con_cadeneta, pacientes(nombre), doctoras(nombre)")
      .eq("sede_id", sedeActiva.id)
      .order("fecha", { ascending: false })
      .limit(10);
    setUltimasEntregasBoton((entregas as unknown as EntregaBoton[]) ?? []);
    setCargando(false);
  }

  useEffect(() => {
    setCargando(true);
    cargarStock();
    supabase.from("doctoras").select("*").eq("activa", true).order("nombre").then(({ data }) => {
      setDoctoras((data as Doctora[]) ?? []);
      if (data && data.length > 0) setDoctoraBotonId((prev) => prev || data[0].id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sedeActiva.id]);

  async function guardarUmbral(id: string, umbral: number) {
    await supabase.from("inventario_stock").update({ umbral_alerta: umbral }).eq("id", id);
  }

  async function reponer() {
    const cantidad = Number(cantidadReponer);
    if (!cantidad) return;
    setGuardandoReponer(true);
    setErrorReponer(null);
    const { error } = await supabase.from("inventario_movimientos").insert({
      sede_id: sedeActiva.id,
      tipo: tipoReponer,
      cantidad,
      motivo: motivoReponer.trim() || null,
    });
    setGuardandoReponer(false);
    if (error) {
      setErrorReponer(error.message);
      return;
    }
    setCantidadReponer("");
    setMotivoReponer("");
    setReponerOk(true);
    setTimeout(() => setReponerOk(false), 2000);
    cargarStock();
  }

  async function registrarBoton() {
    if (!pacienteBoton || !doctoraBotonId) return;
    setGuardandoBoton(true);
    setErrorBoton(null);
    const { error } = await supabase.from("entregas_boton").insert({
      sede_id: sedeActiva.id,
      paciente_id: pacienteBoton.id,
      doctora_id: doctoraBotonId,
      con_cadeneta: conCadeneta,
      fecha: today(),
    });
    setGuardandoBoton(false);
    if (error) {
      setErrorBoton(error.message);
      return;
    }
    setPacienteBoton(null);
    setConCadeneta(false);
    setBotonOk(true);
    setTimeout(() => setBotonOk(false), 2000);
    cargarStock();
  }

  const alertas = stock.filter((s) => s.cantidad <= s.umbral_alerta);

  if (cargando) return <p className="text-sm text-gray-400">Cargando…</p>;

  return (
    <div className="space-y-4">
      {alertas.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <div className="flex items-center gap-2 text-amber-800 font-semibold text-sm mb-1">
            <AlertTriangle size={16} /> Stock bajo
          </div>
          <p className="text-sm text-amber-700">
            {alertas.map((a) => `${TIPO_LABEL[a.tipo] ?? a.tipo}: quedan ${a.cantidad}`).join(" · ")}
          </p>
        </div>
      )}

      <section className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold text-tinta mb-3">Inventario — {sedeActiva.nombre}</h2>
        {stock.length === 0 && (
          <p className="text-xs text-amber-600 mb-2">
            No se encontró la tabla de inventario en la base de datos todavía — falta correr la migración
            (0024_inventario_insumos.sql) en el SQL Editor de Supabase.
          </p>
        )}
        <div className="divide-y divide-gray-100">
          {TIPOS_INVENTARIO.map((t) => {
            const fila = stock.find((s) => s.tipo === t.value);
            const cantidad = fila?.cantidad ?? 0;
            const umbral = fila?.umbral_alerta ?? 5;
            const bajo = cantidad <= umbral;
            return (
              <div key={t.value} className="flex items-center gap-3 py-2.5 flex-wrap">
                <span className="text-sm flex-1 min-w-[140px]">{t.label}</span>
                <span className={`text-lg font-semibold ${bajo ? "text-red-600" : "text-tinta"}`}>{cantidad}</span>
                <div className="flex items-center gap-1.5 text-xs text-gray-400">
                  <span>Alerta si ≤</span>
                  <input
                    type="number"
                    defaultValue={umbral}
                    disabled={!fila}
                    onBlur={(e) => fila && guardarUmbral(fila.id, Number(e.target.value))}
                    className="w-14 rounded-md border border-gray-300 px-1.5 py-1 text-xs disabled:opacity-40"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold text-tinta mb-3">Reponer inventario</h2>
        <p className="text-xs text-gray-400 mb-3">
          Para cuando llega mercancía nueva o para corregir el conteo tras un inventario físico (usa un número negativo
          para bajar el conteo).
        </p>
        <div className="flex items-end gap-2 flex-wrap">
          <select
            value={tipoReponer}
            onChange={(e) => setTipoReponer(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            {TIPOS_INVENTARIO.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <input
            type="number"
            value={cantidadReponer}
            onChange={(e) => setCantidadReponer(e.target.value)}
            placeholder="Cantidad"
            className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            value={motivoReponer}
            onChange={(e) => setMotivoReponer(e.target.value)}
            placeholder="Motivo (opcional)"
            className="flex-1 min-w-[160px] rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            onClick={reponer}
            disabled={!cantidadReponer || guardandoReponer}
            className="flex items-center gap-2 rounded-lg bg-[var(--acento)] text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
          >
            {reponerOk ? <Check size={16} /> : <Plus size={16} />}
            {guardandoReponer ? "Guardando…" : reponerOk ? "Registrado" : "Registrar"}
          </button>
        </div>
        {errorReponer && <p className="text-sm text-red-600 mt-2">{errorReponer}</p>}
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold text-tinta mb-1">Registrar entrega de botón de tracción</h2>
        <p className="text-xs text-gray-400 mb-3">
          El botón no se cobra ni afecta la liquidación de la doctora — solo queda el registro de a quién se le entregó,
          para llevar el inventario.
        </p>
        <div className="space-y-2">
          {pacienteBoton ? (
            <div className="flex items-center justify-between rounded-lg border border-[var(--acento)] bg-[var(--acento)]/5 px-3 py-2 text-sm">
              <span>{pacienteBoton.nombre}</span>
              <button onClick={() => setPacienteBoton(null)} className="text-gray-400">
                ×
              </button>
            </div>
          ) : (
            <PacienteAutocomplete onSelect={setPacienteBoton} placeholder="Buscar paciente…" />
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={doctoraBotonId}
              onChange={(e) => setDoctoraBotonId(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              {doctoras.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nombre}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={conCadeneta} onChange={(e) => setConCadeneta(e.target.checked)} />
              Con cadeneta
            </label>
            <button
              onClick={registrarBoton}
              disabled={!pacienteBoton || guardandoBoton}
              className="ml-auto flex items-center gap-2 rounded-lg bg-[var(--acento)] text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
            >
              {botonOk ? <Check size={16} /> : <Plus size={16} />}
              {guardandoBoton ? "Guardando…" : botonOk ? "Registrado" : "Registrar entrega"}
            </button>
          </div>
          {errorBoton && <p className="text-sm text-red-600">{errorBoton}</p>}
        </div>
        {ultimasEntregasBoton.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-100 space-y-1">
            <p className="text-xs font-medium text-gray-400 mb-1">Últimas entregas</p>
            {ultimasEntregasBoton.map((e) => (
              <div key={e.id} className="text-xs text-gray-500">
                {e.fecha} · {e.pacientes?.nombre} · {e.doctoras?.nombre ?? "—"}
                {e.con_cadeneta ? " · con cadeneta" : ""}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** Insumos generales (bodega): réplica del Excel — catálogo compartido de
 *  172 ítems por categoría, con un período de conteo por sede a la vez
 *  (inventario inicial, entrega 1/2, entradas, pedido → inventario final). */
function InsumosGenerales() {
  const { sedeActiva } = useOutletContext<{ sedeActiva: Sede }>();
  const [catalogo, setCatalogo] = useState<InsumoGeneralCatalogo[]>([]);
  const [periodos, setPeriodos] = useState<InsumoGeneralPeriodo[]>([]);
  const [periodoId, setPeriodoId] = useState("");
  const [movimientos, setMovimientos] = useState<Record<string, InsumoGeneralMovimiento>>({});
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
      .eq("sede_id", sedeActiva.id)
      .order("fecha_inicio", { ascending: false });
    const filas = (data as InsumoGeneralPeriodo[]) ?? [];
    setPeriodos(filas);
    setPeriodoId((prev) => (prev && filas.some((p) => p.id === prev) ? prev : filas[0]?.id ?? ""));
    setCargando(false);
  }

  useEffect(() => {
    setCargando(true);
    cargarPeriodos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sedeActiva.id]);

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
      .insert({ sede_id: sedeActiva.id, etiqueta: nuevaEtiqueta.trim(), fecha_inicio: today() })
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
        <h2 className="font-semibold text-tinta mb-3">Bodega de insumos generales — {sedeActiva.nombre}</h2>
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
          El inventario inicial de un período nuevo parte del inventario final del período anterior de esta sede.
        </p>
      </section>

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
