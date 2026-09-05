import { useEffect, useState } from "react";
import { Plus, Check, X, Trash2, Bell, ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "../lib/supabase";
import { today } from "../lib/format";
import {
  MOTIVOS_SALDO_FAVOR,
  type Doctora,
  type Sede,
  type Paciente,
  type SaldoFavor,
  type InsumoGeneralCatalogo,
  type AsistenciaRegistro,
} from "../lib/types";
import { PacienteAutocomplete } from "../components/PacienteAutocomplete";
import { useAuth } from "../auth/AuthContext";

const PALETA_SUGERIDA = [
  "#B08FC7", "#7FCBC4", "#F0C48A", "#E39B9B", "#8FBFA8", "#A8A0D8",
  "#F0B199", "#84B6D6", "#C9A0BE", "#9BC97F", "#D6B26A", "#8AA6C9", "#B5D6C4",
];

const ETIQUETAS_PRECIOS: Record<string, string> = {
  mascara_facial: "Máscara facial",
  elasticos_intraoral: "Elásticos intraoral",
  traccion_extraoral: "Tracción extra oral",
  rx: "RX",
  gum: "GUM",
  caja_aparato: "Caja aparato",
  llave_aparato: "Llave de aparato",
  boton_traccion: "Botón de tracción",
  porcentaje_honorario: "% honorario doctora (Odontopediatra)",
  horas_semana_meta: "Meta de horas semanales (jornada legal)",
};

interface PedidoPendiente {
  sedeNombre: string;
  categoria: string;
  nombre: string;
  pedido: number;
}

export function Parametros() {
  const { perfil } = useAuth();
  const [doctoras, setDoctoras] = useState<Doctora[]>([]);
  const [pedidosPendientes, setPedidosPendientes] = useState<PedidoPendiente[]>([]);
  const [precios, setPrecios] = useState<{ clave: string; valor: number }[]>([]);
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevoColor, setNuevoColor] = useState(PALETA_SUGERIDA[0]);
  const [guardando, setGuardando] = useState(false);
  const [precioGuardado, setPrecioGuardado] = useState<string | null>(null);

  const [sedes, setSedes] = useState<Sede[]>([]);
  const [pacienteSaldo, setPacienteSaldo] = useState<Paciente | null>(null);
  const [sedeSaldoId, setSedeSaldoId] = useState("");
  const [fechaSaldo, setFechaSaldo] = useState(today());
  const [valorSaldo, setValorSaldo] = useState("");
  const [motivoSaldo, setMotivoSaldo] = useState(MOTIVOS_SALDO_FAVOR[0]);
  const [notasSaldo, setNotasSaldo] = useState("");
  const [guardandoSaldo, setGuardandoSaldo] = useState(false);
  const [saldoRegistrado, setSaldoRegistrado] = useState(false);
  const [errorSaldo, setErrorSaldo] = useState<string | null>(null);

  const [pacienteEditar, setPacienteEditar] = useState<Paciente | null>(null);
  const [saldosPaciente, setSaldosPaciente] = useState<SaldoFavor[]>([]);
  const [saldoGuardadoId, setSaldoGuardadoId] = useState<string | null>(null);
  const [errorSaldoExistente, setErrorSaldoExistente] = useState<string | null>(null);

  const [catalogoGeneral, setCatalogoGeneral] = useState<InsumoGeneralCatalogo[]>([]);
  const [categoriasAbiertas, setCategoriasAbiertas] = useState<Record<string, boolean>>({});
  const [nuevoItemCategoria, setNuevoItemCategoria] = useState("");
  const [nuevoItemNombre, setNuevoItemNombre] = useState("");
  const [guardandoItem, setGuardandoItem] = useState(false);
  const [errorCatalogo, setErrorCatalogo] = useState<string | null>(null);

  const [errorIpSede, setErrorIpSede] = useState<string | null>(null);
  const [asistenciaRegistros, setAsistenciaRegistros] = useState<
    (AsistenciaRegistro & { perfiles: { nombre: string } | null; sedes: { nombre: string } | null })[]
  >([]);

  async function cargar() {
    const { data: d } = await supabase.from("doctoras").select("*").order("nombre");
    setDoctoras((d as Doctora[]) ?? []);
    const { data: p } = await supabase.from("precios_config").select("clave, valor").order("clave");
    setPrecios(p ?? []);
    const { data: s } = await supabase.from("sedes").select("id, nombre, color_acento, ip_permitida").order("nombre");
    setSedes((s as Sede[]) ?? []);
    if (s && s.length > 0) setSedeSaldoId((prev) => prev || s[0].id);
  }

  async function guardarIpSede(id: string, valor: string) {
    setErrorIpSede(null);
    const { error } = await supabase.from("sedes").update({ ip_permitida: valor.trim() || null }).eq("id", id);
    if (error) {
      setErrorIpSede(error.message);
      return;
    }
    setSedes((prev) => prev.map((s) => (s.id === id ? { ...s, ip_permitida: valor.trim() || null } : s)));
  }

  async function cargarAsistencia() {
    const { data } = await supabase
      .from("asistencia_registros")
      .select("*, perfiles(nombre), sedes(nombre)")
      .order("marcado_en", { ascending: false })
      .limit(50);
    setAsistenciaRegistros(
      (data as unknown as (AsistenciaRegistro & { perfiles: { nombre: string } | null; sedes: { nombre: string } | null })[]) ?? [],
    );
  }

  async function verFotoAsistencia(path: string) {
    const { data } = await supabase.storage.from("asistencia").createSignedUrl(path, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  }

  // Últimos pedidos de bodega pendientes de las dos sedes — el período más
  // reciente de cada sede, ítems con pedido > 0. Sirve como "notificación"
  // visible ya que el sistema no manda avisos push ni por correo.
  async function cargarPedidosPendientes() {
    type PeriodoConSede = { id: string; sede_id: string; fecha_inicio: string; sedes: { nombre: string } | null };
    const { data: periodosData } = await supabase
      .from("insumos_generales_periodos")
      .select("id, sede_id, fecha_inicio, sedes(nombre)")
      .order("fecha_inicio", { ascending: false });
    const masRecientePorSede = new Map<string, { periodoId: string; sedeNombre: string }>();
    for (const p of (periodosData as unknown as PeriodoConSede[]) ?? []) {
      if (!masRecientePorSede.has(p.sede_id)) {
        masRecientePorSede.set(p.sede_id, { periodoId: p.id, sedeNombre: p.sedes?.nombre ?? "—" });
      }
    }
    const periodoASede = new Map(Array.from(masRecientePorSede.values()).map((v) => [v.periodoId, v.sedeNombre]));
    const periodoIds = Array.from(periodoASede.keys());
    if (periodoIds.length === 0) {
      setPedidosPendientes([]);
      return;
    }
    type MovConCatalogo = { periodo_id: string; pedido: number; insumos_generales_catalogo: { categoria: string; nombre: string } | null };
    const { data: movs } = await supabase
      .from("insumos_generales_movimientos")
      .select("periodo_id, pedido, insumos_generales_catalogo(categoria, nombre)")
      .in("periodo_id", periodoIds)
      .gt("pedido", 0);
    setPedidosPendientes(
      ((movs as unknown as MovConCatalogo[]) ?? []).map((m) => ({
        sedeNombre: periodoASede.get(m.periodo_id) ?? "—",
        categoria: m.insumos_generales_catalogo?.categoria ?? "—",
        nombre: m.insumos_generales_catalogo?.nombre ?? "—",
        pedido: m.pedido,
      })),
    );
  }

  async function cargarCatalogoGeneral() {
    const { data } = await supabase.from("insumos_generales_catalogo").select("*").order("orden");
    setCatalogoGeneral((data as InsumoGeneralCatalogo[]) ?? []);
  }

  useEffect(() => {
    cargar();
    cargarPedidosPendientes();
    cargarCatalogoGeneral();
    cargarAsistencia();
  }, []);

  const categoriasGeneral = Array.from(new Set(catalogoGeneral.map((c) => c.categoria)));

  async function agregarItemCatalogo() {
    if (!nuevoItemCategoria.trim() || !nuevoItemNombre.trim()) return;
    setGuardandoItem(true);
    setErrorCatalogo(null);
    const siguienteOrden = Math.max(0, ...catalogoGeneral.map((c) => c.orden)) + 1;
    const { error } = await supabase.from("insumos_generales_catalogo").insert({
      categoria: nuevoItemCategoria.trim(),
      nombre: nuevoItemNombre.trim(),
      orden: siguienteOrden,
    });
    setGuardandoItem(false);
    if (error) {
      setErrorCatalogo(error.message);
      return;
    }
    setNuevoItemNombre("");
    cargarCatalogoGeneral();
  }

  async function actualizarItemCatalogo(id: string, cambios: Partial<InsumoGeneralCatalogo>) {
    setCatalogoGeneral((prev) => prev.map((c) => (c.id === id ? { ...c, ...cambios } : c)));
    const { error } = await supabase.from("insumos_generales_catalogo").update(cambios).eq("id", id);
    if (error) setErrorCatalogo(error.message);
  }

  async function actualizarDoctora(id: string, cambios: Partial<Doctora>) {
    setDoctoras((prev) => prev.map((d) => (d.id === id ? { ...d, ...cambios } : d)));
    await supabase.from("doctoras").update(cambios).eq("id", id);
  }

  async function agregarDoctora() {
    if (!nuevoNombre.trim()) return;
    setGuardando(true);
    await supabase.from("doctoras").insert({ nombre: nuevoNombre.trim(), color_pastel: nuevoColor });
    setNuevoNombre("");
    setGuardando(false);
    cargar();
  }

  function editarPrecio(clave: string, valor: number) {
    setPrecios((prev) => prev.map((p) => (p.clave === clave ? { ...p, valor } : p)));
  }

  async function guardarPrecio(clave: string, valor: number) {
    await supabase.from("precios_config").update({ valor }).eq("clave", clave);
    setPrecioGuardado(clave);
    setTimeout(() => setPrecioGuardado((prev) => (prev === clave ? null : prev)), 1500);
  }

  async function registrarSaldo() {
    const valor = Number(valorSaldo);
    if (!pacienteSaldo || !sedeSaldoId || !valor) return;
    setGuardandoSaldo(true);
    setErrorSaldo(null);
    const { error } = await supabase.from("saldos_favor").insert({
      paciente_id: pacienteSaldo.id,
      sede_origen_id: sedeSaldoId,
      valor,
      valor_disponible: valor,
      medio_origen: "ajuste_manual",
      motivo: motivoSaldo,
      registrado_por: perfil?.id ?? null,
      fecha: fechaSaldo,
      notas: notasSaldo.trim() || null,
    });
    setGuardandoSaldo(false);
    if (error) {
      setErrorSaldo(error.message);
      return;
    }
    setPacienteSaldo(null);
    setValorSaldo("");
    setNotasSaldo("");
    setSaldoRegistrado(true);
    setTimeout(() => setSaldoRegistrado(false), 2000);
  }

  async function cargarSaldosPaciente(p: Paciente) {
    setPacienteEditar(p);
    const { data } = await supabase
      .from("saldos_favor")
      .select("*")
      .eq("paciente_id", p.id)
      .order("fecha", { ascending: false });
    setSaldosPaciente((data as SaldoFavor[]) ?? []);
  }

  function editarSaldoPaciente(id: string, cambios: Partial<SaldoFavor>) {
    setSaldosPaciente((prev) => prev.map((s) => (s.id === id ? { ...s, ...cambios } : s)));
  }

  async function guardarSaldoPaciente(id: string) {
    const s = saldosPaciente.find((x) => x.id === id);
    if (!s) return;
    setErrorSaldoExistente(null);
    const { error } = await supabase
      .from("saldos_favor")
      .update({ fecha: s.fecha, valor: s.valor, valor_disponible: s.valor_disponible, motivo: s.motivo, notas: s.notas })
      .eq("id", id);
    if (error) {
      setErrorSaldoExistente(error.message);
      return;
    }
    setSaldoGuardadoId(id);
    setTimeout(() => setSaldoGuardadoId((prev) => (prev === id ? null : prev)), 1500);
  }

  async function eliminarSaldoPaciente(id: string) {
    if (!window.confirm("¿Eliminar este saldo a favor? Esta acción no se puede deshacer.")) return;
    setErrorSaldoExistente(null);
    const { error } = await supabase.from("saldos_favor").delete().eq("id", id);
    if (error) {
      // Ej: hay un pago que ya usó este saldo (cargo_pagos.saldo_id) — no se
      // puede borrar sin antes deshacer ese pago o cambiarlo a otro medio.
      setErrorSaldoExistente(error.message);
      return;
    }
    setSaldosPaciente((prev) => prev.filter((s) => s.id !== id));
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {pedidosPendientes.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <div className="flex items-center gap-2 text-amber-800 font-semibold text-sm mb-2">
            <Bell size={16} /> Pedidos de bodega pendientes ({pedidosPendientes.length})
          </div>
          <p className="text-xs text-amber-700 mb-2">
            Del período más reciente de cada sede, en Operación → Inventario → Insumos generales.
          </p>
          <div className="space-y-0.5">
            {pedidosPendientes.map((p, i) => (
              <p key={i} className="text-sm text-amber-800">
                <span className="font-medium">{p.sedeNombre}</span> · {p.categoria} · {p.nombre}:{" "}
                <span className="font-semibold">pedir {p.pedido}</span>
              </p>
            ))}
          </div>
        </div>
      )}

      <section className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold text-tinta mb-1">Sedes — IP para control de asistencia</h2>
        <p className="text-xs text-gray-400 mb-3">
          Restringe "Marcar asistencia" a la red de la sede — se compara contra la IP pública real de quien marca (no
          se puede falsificar desde el navegador). Busca "cuál es mi IP" en Google desde un computador de esa sede
          para saber cuál poner. Si la dejas vacía, no se restringe. Si el internet de la sede cambia de IP, hay que
          actualizarla acá.
        </p>
        <div className="divide-y divide-gray-100">
          {sedes.map((s) => (
            <div key={s.id} className="flex items-center gap-3 py-2.5">
              <span className="font-medium text-sm flex-1">{s.nombre}</span>
              <input
                defaultValue={s.ip_permitida ?? ""}
                onBlur={(e) => e.target.value.trim() !== (s.ip_permitida ?? "") && guardarIpSede(s.id, e.target.value)}
                placeholder="Sin restricción"
                className="w-44 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              />
            </div>
          ))}
        </div>
        {errorIpSede && <p className="text-sm text-red-600 mt-2">{errorIpSede}</p>}
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold text-tinta mb-3">Asistencia — últimos registros</h2>
        <div className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
          {asistenciaRegistros.map((r) => (
            <div key={r.id} className="flex items-center justify-between py-1.5 text-sm">
              <span>
                <span className="font-medium">{r.perfiles?.nombre ?? "—"}</span>{" "}
                <span className="text-gray-400">
                  · {r.sedes?.nombre ?? "—"} · <span className="capitalize">{r.tipo}</span> ·{" "}
                  {new Date(r.marcado_en).toLocaleString("es-CO")}
                </span>
              </span>
              {r.foto_path && (
                <button onClick={() => verFotoAsistencia(r.foto_path!)} className="text-xs font-medium text-[var(--acento)] underline">
                  Ver foto
                </button>
              )}
            </div>
          ))}
          {asistenciaRegistros.length === 0 && <p className="text-sm text-gray-400 py-2">Sin registros todavía.</p>}
        </div>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold text-tinta mb-3">Doctoras</h2>
        <div className="divide-y divide-gray-100">
          {doctoras.map((d) => (
            <div key={d.id} className="flex items-center gap-3 py-2.5 flex-wrap">
              <span className="w-4 h-4 rounded-full shrink-0" style={{ background: d.color_pastel }} />
              <span className="font-medium text-sm flex-1 min-w-[160px]">{d.nombre}</span>
              <label className="flex items-center gap-1.5 text-xs text-gray-500">
                <input
                  type="checkbox"
                  checked={d.retencion_voluntaria_activa}
                  onChange={(e) => actualizarDoctora(d.id, { retencion_voluntaria_activa: e.target.checked })}
                />
                Retención voluntaria
              </label>
              <input
                type="number"
                step="0.1"
                value={d.retencion_voluntaria_pct}
                onChange={(e) => actualizarDoctora(d.id, { retencion_voluntaria_pct: Number(e.target.value) })}
                disabled={!d.retencion_voluntaria_activa}
                className="w-16 rounded-md border border-gray-300 px-2 py-1 text-xs disabled:opacity-40"
              />
              <span className="text-xs text-gray-400">%</span>
              <label className="flex items-center gap-1.5 text-xs text-gray-500">
                <input
                  type="checkbox"
                  checked={d.activa}
                  onChange={(e) => actualizarDoctora(d.id, { activa: e.target.checked })}
                />
                Activa
              </label>
            </div>
          ))}
        </div>

        <div className="mt-4 pt-4 border-t border-dashed border-gray-200">
          <p className="text-xs font-medium text-gray-500 mb-2">Agregar doctora</p>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              value={nuevoNombre}
              onChange={(e) => setNuevoNombre(e.target.value)}
              placeholder="Nombre completo"
              className="flex-1 min-w-[200px] rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <div className="flex items-center gap-1">
              {PALETA_SUGERIDA.map((c) => (
                <button
                  key={c}
                  onClick={() => setNuevoColor(c)}
                  className="w-6 h-6 rounded-full border-2"
                  style={{ background: c, borderColor: nuevoColor === c ? "#2E253A" : "transparent" }}
                />
              ))}
            </div>
            <button
              onClick={agregarDoctora}
              disabled={!nuevoNombre.trim() || guardando}
              className="flex items-center gap-2 rounded-lg bg-[var(--acento)] text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
            >
              <Plus size={16} /> Agregar
            </button>
          </div>
        </div>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold text-tinta mb-3">Precios de insumos y RX</h2>
        <div className="divide-y divide-gray-100">
          {precios.map((p) => (
            <div key={p.clave} className="flex items-center justify-between py-2.5">
              <span className="text-sm">{ETIQUETAS_PRECIOS[p.clave] ?? p.clave}</span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={p.valor}
                  onChange={(e) => editarPrecio(p.clave, Number(e.target.value))}
                  className="w-32 rounded-md border border-gray-300 px-2 py-1 text-sm text-right"
                />
                <button
                  onClick={() => guardarPrecio(p.clave, p.valor)}
                  className="flex items-center gap-1 rounded-md bg-[var(--acento)] text-white px-3 py-1.5 text-xs font-medium"
                >
                  {precioGuardado === p.clave ? <Check size={14} /> : "Guardar"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold text-tinta mb-1">Registrar saldo a favor manual</h2>
        <p className="text-xs text-gray-400 mb-3">
          Para saldos que el paciente ya tenía antes del sistema, o para correcciones. Una vez registrado,
          queda disponible como medio de pago "Saldo a favor" en el cobro de ese paciente.
        </p>
        <div className="space-y-2">
          {pacienteSaldo ? (
            <div className="flex items-center justify-between rounded-lg border border-[var(--acento)] bg-[var(--acento)]/5 px-3 py-2 text-sm">
              <span>{pacienteSaldo.nombre}</span>
              <button onClick={() => setPacienteSaldo(null)}>
                <X size={14} />
              </button>
            </div>
          ) : (
            <PacienteAutocomplete onSelect={setPacienteSaldo} placeholder="Buscar paciente…" />
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={sedeSaldoId}
              onChange={(e) => setSedeSaldoId(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              {sedes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={fechaSaldo}
              onChange={(e) => setFechaSaldo(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              type="number"
              placeholder="Valor"
              value={valorSaldo}
              onChange={(e) => setValorSaldo(e.target.value)}
              className="w-32 rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <select
              value={motivoSaldo}
              onChange={(e) => setMotivoSaldo(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              {MOTIVOS_SALDO_FAVOR.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <input
            value={notasSaldo}
            onChange={(e) => setNotasSaldo(e.target.value)}
            placeholder="Nota (ej: saldo trasladado del sistema anterior)"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          {errorSaldo && <p className="text-sm text-red-600">{errorSaldo}</p>}
          <button
            onClick={registrarSaldo}
            disabled={!pacienteSaldo || !valorSaldo || guardandoSaldo}
            className="flex items-center gap-2 rounded-lg bg-[var(--acento)] text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
          >
            {saldoRegistrado ? <Check size={16} /> : <Plus size={16} />}
            {guardandoSaldo ? "Registrando…" : saldoRegistrado ? "Registrado" : "Registrar saldo"}
          </button>
        </div>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold text-tinta mb-1">Corregir saldo a favor existente</h2>
        <p className="text-xs text-gray-400 mb-3">
          Para arreglar la fecha o el valor de un saldo a favor que ya quedó mal registrado.
        </p>
        {pacienteEditar ? (
          <div className="flex items-center justify-between rounded-lg border border-[var(--acento)] bg-[var(--acento)]/5 px-3 py-2 text-sm mb-2">
            <span>{pacienteEditar.nombre}</span>
            <button
              onClick={() => {
                setPacienteEditar(null);
                setSaldosPaciente([]);
              }}
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <PacienteAutocomplete onSelect={cargarSaldosPaciente} placeholder="Buscar paciente…" />
        )}

        {errorSaldoExistente && <p className="text-sm text-red-600 mt-2">{errorSaldoExistente}</p>}
        {pacienteEditar && (
          <div className="space-y-3 mt-2">
            {saldosPaciente.map((s) => (
              <div key={s.id} className="rounded-lg border border-gray-200 p-3 flex items-center gap-2 flex-wrap">
                <input
                  type="date"
                  value={s.fecha}
                  onChange={(e) => editarSaldoPaciente(s.id, { fecha: e.target.value })}
                  className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                />
                <div>
                  <label className="block text-[10px] text-gray-400">Valor total</label>
                  <input
                    type="number"
                    value={s.valor}
                    onChange={(e) => editarSaldoPaciente(s.id, { valor: Number(e.target.value) })}
                    className="w-28 rounded-md border border-gray-300 px-2 py-1 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-400">Disponible</label>
                  <input
                    type="number"
                    value={s.valor_disponible}
                    onChange={(e) => editarSaldoPaciente(s.id, { valor_disponible: Number(e.target.value) })}
                    className="w-28 rounded-md border border-gray-300 px-2 py-1 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-400">Motivo</label>
                  <select
                    value={s.motivo ?? ""}
                    onChange={(e) => editarSaldoPaciente(s.id, { motivo: e.target.value })}
                    className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                  >
                    <option value="">— sin motivo —</option>
                    {MOTIVOS_SALDO_FAVOR.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => guardarSaldoPaciente(s.id)}
                  className="flex items-center gap-1 rounded-md bg-[var(--acento)] text-white px-3 py-1.5 text-xs font-medium"
                >
                  {saldoGuardadoId === s.id ? <Check size={14} /> : "Guardar"}
                </button>
                <button
                  onClick={() => eliminarSaldoPaciente(s.id)}
                  title="Eliminar este saldo a favor"
                  className="flex items-center gap-1 rounded-md border border-red-200 text-red-500 px-3 py-1.5 text-xs font-medium hover:bg-red-50"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {saldosPaciente.length === 0 && <p className="text-sm text-gray-400">Sin saldos a favor registrados.</p>}
          </div>
        )}
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold text-tinta mb-1">Catálogo de insumos generales (bodega)</h2>
        <p className="text-xs text-gray-400 mb-3">
          Agrega ítems nuevos o desactiva los que ya no se usan — desactivar no borra el historial de conteos ya
          hechos con ese ítem. Se ve reflejado en Operación → Inventario → Insumos generales de ambas sedes.
        </p>
        <div className="flex items-end gap-2 flex-wrap mb-3">
          <input
            list="categorias-existentes"
            value={nuevoItemCategoria}
            onChange={(e) => setNuevoItemCategoria(e.target.value)}
            placeholder="Categoría"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <datalist id="categorias-existentes">
            {categoriasGeneral.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <input
            value={nuevoItemNombre}
            onChange={(e) => setNuevoItemNombre(e.target.value)}
            placeholder="Nombre del ítem"
            className="flex-1 min-w-[160px] rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            onClick={agregarItemCatalogo}
            disabled={!nuevoItemCategoria.trim() || !nuevoItemNombre.trim() || guardandoItem}
            className="flex items-center gap-2 rounded-lg bg-[var(--acento)] text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
          >
            <Plus size={16} /> {guardandoItem ? "Agregando…" : "Agregar ítem"}
          </button>
        </div>
        {errorCatalogo && <p className="text-sm text-red-600 mb-2">{errorCatalogo}</p>}
        <div className="divide-y divide-gray-100 border-t border-gray-100">
          {categoriasGeneral.map((categoria) => {
            const items = catalogoGeneral.filter((c) => c.categoria === categoria);
            const abierta = !!categoriasAbiertas[categoria];
            return (
              <div key={categoria}>
                <button
                  onClick={() => setCategoriasAbiertas((prev) => ({ ...prev, [categoria]: !prev[categoria] }))}
                  className="w-full flex items-center gap-2 py-2 text-sm font-medium text-tinta"
                >
                  {abierta ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  {categoria} ({items.length})
                </button>
                {abierta && (
                  <div className="pb-2 space-y-1">
                    {items.map((item) => (
                      <div key={item.id} className="flex items-center gap-2 pl-5">
                        <input
                          defaultValue={item.nombre}
                          onBlur={(e) => e.target.value.trim() && e.target.value !== item.nombre && actualizarItemCatalogo(item.id, { nombre: e.target.value.trim() })}
                          className={`flex-1 rounded-md border border-gray-200 px-2 py-1 text-sm ${!item.activo ? "text-gray-400 line-through" : ""}`}
                        />
                        <label className="flex items-center gap-1.5 text-xs text-gray-500">
                          <input
                            type="checkbox"
                            checked={item.activo}
                            onChange={(e) => actualizarItemCatalogo(item.id, { activo: e.target.checked })}
                          />
                          Activo
                        </label>
                      </div>
                    ))}
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
