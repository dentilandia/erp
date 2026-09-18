import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import { fmtCOP } from "../lib/format";
import { TIPOS_SERVICIO_LAB, type EstadoLab } from "../lib/types";

interface OrdenExterna {
  id: string;
  estado: EstadoLab;
  tipo_servicio: string;
  fecha_entrega_laboratorio: string | null;
  fecha_cita_paciente: string | null;
  fecha_recepcion_laboratorio: string | null;
  fecha_emision_factura: string | null;
  consecutivo: string | null;
  factura_numero: string | null;
  valor_factura: number | null;
  pacientes: { nombre: string } | null;
  doctoras: { nombre: string } | null;
  sedes: { nombre: string } | null;
}

const ESTADOS_VISIBLES: { value: EstadoLab; label: string }[] = [
  { value: "entregado", label: "En mi laboratorio" },
  { value: "recibido", label: "Devueltos, por instalar" },
  { value: "instalado", label: "Instalados" },
];

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
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editFechaRecepcion, setEditFechaRecepcion] = useState("");
  const [editFechaEmision, setEditFechaEmision] = useState("");
  const [editConsecutivo, setEditConsecutivo] = useState("");
  const [editValorFactura, setEditValorFactura] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cargar() {
    setCargando(true);
    const { data } = await supabase
      .from("lab_ordenes")
      .select(
        "id, estado, tipo_servicio, fecha_entrega_laboratorio, fecha_cita_paciente, fecha_recepcion_laboratorio, fecha_emision_factura, consecutivo, factura_numero, valor_factura, pacientes(nombre), doctoras!lab_ordenes_doctora_id_fkey(nombre), sedes(nombre)",
      )
      .order("fecha_entrega_laboratorio", { ascending: false });
    setOrdenes((data as unknown as OrdenExterna[]) ?? []);
    setCargando(false);
  }

  useEffect(() => {
    cargar();
  }, []);

  function empezarEdicion(o: OrdenExterna) {
    setEditandoId(o.id);
    setEditFechaRecepcion(o.fecha_recepcion_laboratorio ?? "");
    setEditFechaEmision(o.fecha_emision_factura ?? "");
    setEditConsecutivo(o.consecutivo ?? o.factura_numero ?? "");
    setEditValorFactura(o.valor_factura === null ? "" : String(o.valor_factura));
    setError(null);
  }

  async function guardar(id: string) {
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

      <main className="flex-1 p-4 max-w-3xl mx-auto w-full space-y-4">
        <p className="text-sm text-gray-500">Aparatos de las dos sedes que tiene tu laboratorio, o que ya devolviste.</p>

        {cargando ? (
          <p className="text-sm text-gray-400">Cargando…</p>
        ) : (
          ESTADOS_VISIBLES.map((e) => {
            const items = ordenes.filter((o) => o.estado === e.value);
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
                  <div className="border-t border-gray-100 divide-y divide-gray-100">
                    {items.map((o) =>
                      editandoId === o.id ? (
                        <div key={o.id} className="px-4 py-3 space-y-2">
                          <p className="text-sm font-medium">
                            {o.pacientes?.nombre}{" "}
                            <span className="text-gray-400">
                              · {o.doctoras?.nombre} · {o.sedes?.nombre}
                            </span>
                          </p>
                          <p className="text-xs text-gray-500">
                            {TIPOS_SERVICIO_LAB.find((t) => t.value === o.tipo_servicio)?.label}
                          </p>
                          {o.fecha_cita_paciente && (
                            <p className="text-xs font-semibold text-amber-700">
                              Fecha límite (cita del paciente): {o.fecha_cita_paciente}
                            </p>
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
                          <p className="text-xs font-medium text-gray-500 pt-1">Cuando lo despaches de vuelta, deja los datos de la factura:</p>
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
                          {error && <p className="text-sm text-red-600">{error}</p>}
                          <div className="flex gap-2">
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
                      ) : (
                        <div key={o.id} className="flex items-center justify-between px-4 py-2 text-sm">
                          <span>
                            {o.pacientes?.nombre}{" "}
                            <span className="text-gray-400">
                              · {o.doctoras?.nombre} · {o.sedes?.nombre}
                            </span>
                            {o.fecha_cita_paciente && (
                              <span className="ml-2 text-xs font-semibold text-amber-700">Cita: {o.fecha_cita_paciente}</span>
                            )}
                          </span>
                          <span className="flex items-center gap-3">
                            {o.valor_factura && <span className="text-gray-500">{fmtCOP(o.valor_factura)}</span>}
                            <button onClick={() => empezarEdicion(o)} className="text-[#009F98] font-medium text-xs">
                              {o.fecha_recepcion_laboratorio ? "Editar" : "Registrar"}
                            </button>
                          </span>
                        </div>
                      ),
                    )}
                    {items.length === 0 && <p className="px-4 py-3 text-sm text-gray-400">Sin órdenes.</p>}
                  </div>
                )}
              </div>
            );
          })
        )}
      </main>
    </div>
  );
}
