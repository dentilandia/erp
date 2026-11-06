import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, X } from "lucide-react";
import { supabase } from "../lib/supabase";

interface Notificacion {
  id: string;
  tipo: string;
  fecha_referencia: string;
  titulo: string;
  cuerpo: string;
  leida_en: string | null;
  created_at: string;
}

// Cada cuánto se revisa si llegaron mensajes nuevos (los genera la base de
// datos a las 7am y a las 2pm, así que no hace falta más seguido).
const INTERVALO_MS = 5 * 60 * 1000;

function haceCuanto(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("es-CO", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/** Buzón personal (campana del encabezado): resúmenes automáticos de
 *  recuperación de pacientes y cualquier aviso futuro del ERP. */
export function BuzonNotificaciones({ perfilId }: { perfilId: string }) {
  const [items, setItems] = useState<Notificacion[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contenedor = useRef<HTMLDivElement>(null);

  const cargar = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("notificaciones")
      .select("id, tipo, fecha_referencia, titulo, cuerpo, leida_en, created_at")
      .eq("perfil_id", perfilId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (err) {
      setError(err.message);
      return;
    }
    setError(null);
    setItems((data as Notificacion[]) ?? []);
  }, [perfilId]);

  useEffect(() => {
    cargar();
    const t = setInterval(cargar, INTERVALO_MS);
    const alVolver = () => document.visibilityState === "visible" && cargar();
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [cargar]);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (contenedor.current && !contenedor.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [abierto]);

  async function marcarLeidas(ids: string[]) {
    if (ids.length === 0) return;
    const ahora = new Date().toISOString();
    setItems((prev) => prev.map((n) => (ids.includes(n.id) ? { ...n, leida_en: ahora } : n)));
    const { error: err } = await supabase.from("notificaciones").update({ leida_en: ahora }).in("id", ids);
    if (err) {
      setError(err.message);
      cargar();
    }
  }

  const sinLeer = items.filter((n) => !n.leida_en);

  return (
    <div className="relative" ref={contenedor}>
      <button
        onClick={() => setAbierto((v) => !v)}
        title="Buzón de notificaciones"
        className="relative text-gris hover:text-white"
      >
        <Bell size={18} />
        {sinLeer.length > 0 && (
          <span className="absolute -top-1.5 -right-2 min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-4 text-center">
            {sinLeer.length > 9 ? "9+" : sinLeer.length}
          </span>
        )}
      </button>

      {abierto && (
        <div className="absolute right-0 mt-2 w-[min(26rem,calc(100vw-2rem))] max-h-[70vh] flex flex-col bg-white text-gray-800 rounded-xl shadow-xl border border-gray-200 z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <span className="font-semibold text-sm">Buzón</span>
            <div className="flex items-center gap-3">
              {sinLeer.length > 0 && (
                <button
                  onClick={() => marcarLeidas(sinLeer.map((n) => n.id))}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800"
                >
                  <CheckCheck size={14} /> Marcar todo como leído
                </button>
              )}
              <button onClick={() => setAbierto(false)} className="text-gray-400 hover:text-gray-700">
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="overflow-y-auto">
            {error && <p className="px-4 py-3 text-xs text-red-600">No se pudo cargar el buzón: {error}</p>}
            {!error && items.length === 0 && (
              <p className="px-4 py-6 text-sm text-gray-500 text-center">No tienes mensajes.</p>
            )}
            {items.map((n) => (
              <button
                key={n.id}
                onClick={() => !n.leida_en && marcarLeidas([n.id])}
                className={`block w-full text-left px-4 py-3 border-b border-gray-100 last:border-0 ${
                  n.leida_en ? "bg-white" : "bg-teal-50/60 hover:bg-teal-50"
                }`}
              >
                <div className="flex items-start gap-2">
                  {!n.leida_en && <span className="mt-1.5 w-2 h-2 rounded-full bg-teal-600 shrink-0" />}
                  <div className="min-w-0">
                    <p className={`text-sm ${n.leida_en ? "text-gray-700" : "font-semibold"}`}>{n.titulo}</p>
                    <p className="text-xs text-gray-600 whitespace-pre-line mt-1">{n.cuerpo}</p>
                    <p className="text-[11px] text-gray-400 mt-1">{haceCuanto(n.created_at)}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
