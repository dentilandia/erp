import { useEffect, useMemo, useState } from "react";
import { LogOut } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import { fmtCOP } from "../lib/format";
import { TIPOS_SERVICIO_LAB, type EstadoLab } from "../lib/types";

interface OrdenExterna {
  id: string;
  estado: EstadoLab;
  tipo_servicio: string;
  numero_orden: string | null;
  fecha_entrega_laboratorio: string | null;
  fecha_cita_paciente: string | null;
  fecha_recepcion_laboratorio: string | null;
  fecha_despacho_laboratorio: string | null;
  fecha_emision_factura: string | null;
  consecutivo: string | null;
  factura_numero: string | null;
  valor_factura: number | null;
  incluye_aparato: boolean;
  incluye_modelo_superior: boolean;
  incluye_modelo_inferior: boolean;
  incluye_registro_mordida: boolean;
  pacientes: { nombre: string } | null;
  doctoras: { nombre: string } | null;
  sedes: { nombre: string } | null;
}

const ESTADOS_VISIBLES: { value: EstadoLab; label: string }[] = [
  { value: "entregado", label: "En mi laboratorio" },
  { value: "recibido", label: "Devueltos, por instalar" },
  { value: "instalado", label: "Instalados" },
];

const TODAS_SEDES = "__todas__";

function Marca({ si }: { si: boolean }) {
  return <span className={si ? "text-[#009F98] font-semibold" : "text-gray-300"}>{si ? "X" : "—"}</span>;
}

/** Pantalla del usuario externo de laboratorio (hoy solo Ruby) — RLS ya
 *  restringe lab_ordenes a solo las órdenes de su propio laboratorio (de
 *  cualquier sede), así que acá no hace falta filtrar nada más. No comparte
 *  Layout con el resto del ERP: es una pantalla aparte, sin nav de
 *  operación/administración, porque no debe ver nada más del sistema. */
export function LaboratorioExterno() {
  const { perfil, signOut } = useAuth();
  const [ordenes, setOrdenes] = useState<OrdenExterna[]>([]);
  const [cargando, setCargando] = useState(true);
  const [abierto, setAbierto] = useState<EstadoLab | "">("entregado");
  const [sedeFiltro, setSedeFiltro] = useState(TODAS_SEDES);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editFechaRecepcion, setEditFechaRecepcion] = useState("");
  const [editFechaEmision, setEditFechaEmision] = useState("");
  const [editConsecutivo, setEditConsecutivo] = useState("");
  const [editValorFactura, setEditValorFactura] = useState("");
  const [editFechaDespacho, setEditFechaDespacho] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cargar() {
    setCargando(true);
    const { data } = await supabase
      .from("lab_ordenes")
      .select(
        "id, estado, tipo_servicio, numero_orden, fecha_entrega_laboratorio, fecha_cita_paciente, fecha_recepcion_laboratorio, fecha_despacho_laboratorio, fecha_emision_factura, consecutivo, factura_numero, valor_factura, incluye_aparato, incluye_modelo_superior, incluye_modelo_inferior, incluye_registro_mordida, pacientes(nombre), doctoras!lab_ordenes_doctora_id_fkey(nombre), sedes(nombre)",
      )
      .order("fecha_entrega_laboratorio", { ascending: false });
    setOrdenes((data as unknown as OrdenExterna[]) ?? []);
    setCargando(false);
  }

  useEffect(() => {
    cargar();
  }, []);

  const sedesDisponibles = useMemo(
    () => Array.from(new Set(ordenes.map((o) => o.sedes?.nombre).filter((n): n is string => !!n))).sort(),
    [ordenes],
  );

  function empezarEdicion(o: OrdenExterna) {
    setEditandoId(o.id);
    setEditFechaRecepcion(o.fecha_recepcion_laboratorio ?? "");
    setEditFechaEmision(o.fecha_emision_factura ?? "");
    setEditConsecutivo(o.consecutivo ?? o.factura_numero ?? "");
    setEditValorFactura(o.valor_factura === null ? "" : String(o.valor_factura));
    setEditFechaDespacho(o.fecha_despacho_laboratorio ?? "");
    setError(null);
  }

  const facturaCompleta = editFechaEmision !== "" && editConsecutivo.trim() !== "" && editValorFactura !== "";

  async function guardar(id: string) {
    if (editFechaDespacho && !facturaCompleta) {
      setError("Antes de poner la fecha de despacho, completa la fecha, el consecutivo y el valor de la factura.");
      return;
    }
    setGuardando(true);
    setError(null);
    const { error: err } = await supabase
      .from("lab_ordenes")
      .update({
        fecha_recepcion_laboratorio: editFechaRecepcion || null,
        fecha_emision_factura: editFechaEmision || null,
        consecutivo: editConsecutivo.trim() || null,
        factura_numero: editConsecutivo.trim() || null,
        valor_factura: editValorFactura === "" ? null : Number(editValorFactura),
        fecha_despacho_laboratorio: editFechaDespacho || null,
      })
      .eq("id", id);
    setGuardando(false);
    if (err) {
      setError(err.message);
      return;
    }
    setEditandoId(null);
    cargar();
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 text-white" style={{ background: "#2E253A" }}>
        <div className="flex items-center gap-3">
          <img src="/logo-dentilandia.png" alt="" className="w-8 h-8 rounded-full" />
          <span className="font-semibold">Dentilandia — Laboratorio</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gris">{perfil?.nombre}</span>
          <button onClick={signOut} title="Cerrar sesión" className="text-gris hover:text-white">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <main className="flex-1 p-4 max-w-5xl mx-auto w-full space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-sm text-gray-500">Aparatos de las dos sedes que tiene tu laboratorio, o que ya devolviste.</p>
          {sedesDisponibles.length > 1 && (
            <select
              value={sedeFiltro}
              onChange={(e) => setSedeFiltro(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value={TODAS_SEDES}>Todas las sedes</option>
              {sedesDisponibles.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
        </div>

        {cargando ? (
          <p className="text-sm text-gray-400">Cargando…</p>
        ) : (
          ESTADOS_VISIBLES.map((e) => {
            const items = ordenes.filter(
              (o) => o.estado === e.value && (sedeFiltro === TODAS_SEDES || o.sedes?.nombre === sedeFiltro),
            );
            const expandido = abierto === e.value;
            return (
              <div key={e.value} className="bg-white rounded-xl border border-gray-200">
                <button
                  onClick={() => setAbierto(abierto === e.value ? "" : e.value)}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold"
                >
                  {e.label} ({items.length})
                </button>
                {expandido && (
                  <div className="border-t border-gray-100">
                    {items.length === 0 ? (
                      <p className="px-4 py-3 text-sm text-gray-400">Sin órdenes.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs sm:text-sm">
                          <thead>
                            <tr className="bg-gray-50 text-left text-gray-500">
                              <th className="px-2 py-1.5 whitespace-nowrap">Fecha envío</th>
                              <th className="px-2 py-1.5 whitespace-nowrap">N° orden</th>
                              <th className="px-2 py-1.5">Paciente</th>
                              <th className="px-2 py-1.5">Doctora</th>
                              {sedeFiltro === TODAS_SEDES && <th className="px-2 py-1.5">Sede</th>}
                              <th className="px-2 py-1.5 text-center">Aparato</th>
                              <th className="px-2 py-1.5 text-center">Mod. sup.</th>
                              <th className="px-2 py-1.5 text-center">Mod. inf.</th>
                              <th className="px-2 py-1.5 text-center">Mordida</th>
                              <th className="px-2 py-1.5 text-right">Factura</th>
                              <th className="px-2 py-1.5"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((o) => (
                              <tr key={o.id} className="border-t border-gray-100 align-top">
                                <td className="px-2 py-2 whitespace-nowrap">{o.fecha_entrega_laboratorio ?? "—"}</td>
                                <td className="px-2 py-2 whitespace-nowrap">{o.numero_orden ?? "—"}</td>
                                <td className="px-2 py-2">
                                  {o.pacientes?.nombre ?? "—"}
                                  {o.fecha_cita_paciente && (
                                    <div className="text-xs font-semibold text-amber-700">Cita: {o.fecha_cita_paciente}</div>
                                  )}
                                </td>
                                <td className="px-2 py-2">{o.doctoras?.nombre ?? "—"}</td>
                                {sedeFiltro === TODAS_SEDES && <td className="px-2 py-2">{o.sedes?.nombre ?? "—"}</td>}
                                <td className="px-2 py-2 text-center">
                                  <Marca si={o.incluye_aparato} />
                                </td>
                                <td className="px-2 py-2 text-center">
                                  <Marca si={o.incluye_modelo_superior} />
                                </td>
                                <td className="px-2 py-2 text-center">
                                  <Marca si={o.incluye_modelo_inferior} />
                                </td>
                                <td className="px-2 py-2 text-center">
                                  <Marca si={o.incluye_registro_mordida} />
                                </td>
                                <td className="px-2 py-2 text-right">{o.valor_factura ? fmtCOP(o.valor_factura) : "—"}</td>
                                <td className="px-2 py-2 text-right whitespace-nowrap">
                                  <button onClick={() => empezarEdicion(o)} className="text-[#009F98] font-medium">
                                    {o.fecha_recepcion_laboratorio ? "Editar" : "Registrar"}
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}

        {editandoId &&
          (() => {
            const o = ordenes.find((x) => x.id === editandoId);
            if (!o) return null;
            return (
              <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-20">
                <div className="bg-white rounded-xl max-w-md w-full p-5 space-y-3">
                  <p className="text-sm font-medium">
                    {o.pacientes?.nombre}{" "}
                    <span className="text-gray-400">
                      · {o.doctoras?.nombre} · {o.sedes?.nombre}
                    </span>
                  </p>
                  <p className="text-xs text-gray-500">
                    {TIPOS_SERVICIO_LAB.find((t) => t.value === o.tipo_servicio)?.label}
                    {o.numero_orden && ` · N° ${o.numero_orden}`}
                  </p>
                  {o.fecha_cita_paciente && (
                    <p className="text-xs font-semibold text-amber-700">Fecha límite (cita del paciente): {o.fecha_cita_paciente}</p>
                  )}
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Fecha en que lo recibiste en tu laboratorio</label>
                    <input
                      type="date"
                      value={editFechaRecepcion}
                      onChange={(e) => setEditFechaRecepcion(e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                    />
                  </div>
                  <p className="text-xs font-medium text-gray-500 pt-1">Datos de la factura (obligatorios antes de despacharlo de vuelta):</p>
                  <div className="flex gap-2 flex-wrap">
                    <input
                      value={editConsecutivo}
                      onChange={(e) => setEditConsecutivo(e.target.value)}
                      placeholder="Consecutivo de la factura"
                      className="flex-1 min-w-[120px] rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                    />
                    <input
                      type="number"
                      value={editValorFactura}
                      onChange={(e) => setEditValorFactura(e.target.value)}
                      placeholder="Valor de la factura"
                      className="flex-1 min-w-[120px] rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                    />
                    <input
                      type="date"
                      value={editFechaEmision}
                      onChange={(e) => setEditFechaEmision(e.target.value)}
                      className="flex-1 min-w-[120px] rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Fecha en que lo despachaste de vuelta a la clínica</label>
                    <input
                      type="date"
                      value={editFechaDespacho}
                      disabled={!facturaCompleta}
                      onChange={(e) => setEditFechaDespacho(e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm disabled:opacity-40"
                    />
                    {!facturaCompleta && (
                      <p className="text-xs text-gray-400 mt-1">Completa primero los 3 datos de la factura de arriba.</p>
                    )}
                  </div>
                  {error && <p className="text-sm text-red-600">{error}</p>}
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => guardar(o.id)}
                      disabled={guardando}
                      className="rounded-md bg-[#009F98] text-white px-3 py-1.5 text-sm font-medium disabled:opacity-40"
                    >
                      {guardando ? "Guardando…" : "Guardar"}
                    </button>
                    <button onClick={() => setEditandoId(null)} className="px-2 text-gray-400 text-sm">
                      Cancelar
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}
      </main>
    </div>
  );
}
