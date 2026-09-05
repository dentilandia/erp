import { useEffect, useState } from "react";
import { LogIn, LogOut } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import type { AsistenciaRegistro } from "../lib/types";

/** Marcar llegada/salida — la IP se valida del lado del servidor (edge
 *  function marcar-asistencia), no acá, porque un dato mandado desde el
 *  navegador se podría falsificar. Si la sede no tiene IP configurada en
 *  Parámetros, no se restringe (para no bloquear antes de configurarla). */
export function Asistencia() {
  const { perfil } = useAuth();
  const [marcando, setMarcando] = useState<"llegada" | "salida" | null>(null);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [registros, setRegistros] = useState<AsistenciaRegistro[]>([]);

  async function cargarRegistros() {
    if (!perfil) return;
    const desde = new Date();
    desde.setHours(0, 0, 0, 0);
    const { data } = await supabase
      .from("asistencia_registros")
      .select("*")
      .eq("perfil_id", perfil.id)
      .gte("marcado_en", desde.toISOString())
      .order("marcado_en", { ascending: false });
    setRegistros((data as AsistenciaRegistro[]) ?? []);
  }

  useEffect(() => {
    cargarRegistros();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfil?.id]);

  async function marcar(tipo: "llegada" | "salida") {
    setMarcando(tipo);
    setMensaje(null);
    const { data, error } = await supabase.functions.invoke("marcar-asistencia", { body: { tipo } });
    setMarcando(null);
    if (error || data?.error) {
      setMensaje({ tipo: "error", texto: data?.error ?? error?.message ?? "No se pudo registrar la marca." });
      return;
    }
    setMensaje({ tipo: "ok", texto: tipo === "llegada" ? "Llegada registrada." : "Salida registrada." });
    cargarRegistros();
  }

  return (
    <div className="max-w-md mx-auto space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <h2 className="font-semibold text-tinta">Marcar asistencia</h2>
        <p className="text-xs text-gray-400">Solo funciona conectado a la red de la sede.</p>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => marcar("llegada")}
            disabled={marcando !== null}
            className="flex items-center justify-center gap-2 rounded-lg bg-emerald-600 text-white py-2.5 text-sm font-medium disabled:opacity-40"
          >
            <LogIn size={16} /> {marcando === "llegada" ? "Marcando…" : "Marcar llegada"}
          </button>
          <button
            onClick={() => marcar("salida")}
            disabled={marcando !== null}
            className="flex items-center justify-center gap-2 rounded-lg bg-amber-600 text-white py-2.5 text-sm font-medium disabled:opacity-40"
          >
            <LogOut size={16} /> {marcando === "salida" ? "Marcando…" : "Marcar salida"}
          </button>
        </div>

        {mensaje && (
          <p className={`text-sm ${mensaje.tipo === "ok" ? "text-emerald-700" : "text-red-600"}`}>{mensaje.texto}</p>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-500 mb-2">Tus marcas de hoy</h3>
        {registros.length === 0 ? (
          <p className="text-sm text-gray-400">Todavía no has marcado nada hoy.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {registros.map((r) => (
              <div key={r.id} className="flex items-center justify-between py-1.5 text-sm">
                <span className="capitalize font-medium">{r.tipo}</span>
                <span className="text-gray-500">{new Date(r.marcado_en).toLocaleTimeString("es-CO")}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
