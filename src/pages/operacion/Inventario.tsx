import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { AlertTriangle, Plus, Check } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { today } from "../../lib/format";
import { TIPOS_INVENTARIO, type Sede, type Doctora, type Paciente, type InventarioStock } from "../../lib/types";
import { PacienteAutocomplete } from "../../components/PacienteAutocomplete";
import { BodegaAdminTabla } from "../../components/BodegaAdminTabla";
import { InsumosGeneralesPeriodo } from "../../components/InsumosGeneralesPeriodo";

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
 *  (inventario inicial, entrega 1/2, entradas, pedido → inventario final).
 *  Incluye también la existencia de la bodega administrativa central de
 *  solo lectura (se administra desde Administración → Inventarios). */
function InsumosGenerales() {
  const { sedeActiva } = useOutletContext<{ sedeActiva: Sede }>();
  return (
    <div className="space-y-4">
      <BodegaAdminTabla editable={false} />
      <h2 className="font-semibold text-tinta">Bodega de insumos generales — {sedeActiva.nombre}</h2>
      <InsumosGeneralesPeriodo sedeId={sedeActiva.id} />
    </div>
  );
}
