import { useEffect, useMemo, useState } from "react";
import { LogIn, LogOut, Coffee, Utensils, Sparkles } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import { TIPOS_ASISTENCIA, type AsistenciaRegistro, type TipoAsistencia } from "../lib/types";

const ICONOS: Record<TipoAsistencia, typeof LogIn> = {
  llegada: LogIn,
  salida_almuerzo: Coffee,
  entrada_almuerzo: Utensils,
  salida: LogOut,
};

/** Marcar la jornada (llegada, salida/entrada de almuerzo, salida final) — la
 *  IP se valida del lado del servidor (edge function marcar-asistencia), no
 *  acá, porque un dato mandado desde el navegador se podría falsificar. Al
 *  marcar llegada o salida final, el edge function devuelve una frase del
 *  día (motivadora o de agradecimiento) que hay que cerrar para continuar. */
export function Asistencia() {
  const { perfil } = useAuth();
  const [marcando, setMarcando] = useState<TipoAsistencia | null>(null);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [registros, setRegistros] = useState<AsistenciaRegistro[]>([]);
  const [frase, setFrase] = useState<{ tipo: "llegada" | "salida"; texto: string } | null>(null);

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

  const yaMarcado = useMemo(() => new Set(registros.map((r) => r.tipo)), [registros]);

  async function marcar(tipo: TipoAsistencia) {
    setMarcando(tipo);
    setMensaje(null);
    const { data, error } = await supabase.functions.invoke("marcar-asistencia", { body: { tipo } });
    setMarcando(null);
    if (error || data?.error) {
      setMensaje({ tipo: "error", texto: data?.error ?? error?.message ?? "No se pudo registrar la marca." });
      return;
    }
    const etiqueta = TIPOS_ASISTENCIA.find((t) => t.value === tipo)?.label ?? tipo;
    setMensaje({ tipo: "ok", texto: `${etiqueta} registrada.` });
    if (data?.frase && (tipo === "llegada" || tipo === "salida")) {
      setFrase({ tipo, texto: data.frase });
    }
    cargarRegistros();
  }

  return (
    <div className="max-w-md mx-auto space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <h2 className="font-semibold text-tinta">Marcar asistencia</h2>
        <p className="text-xs text-gray-400">Solo funciona conectado a la red de la sede.</p>

        <div className="grid grid-cols-2 gap-2">
          {TIPOS_ASISTENCIA.map((t) => {
            const Icono = ICONOS[t.value];
            const marcadoHoy = yaMarcado.has(t.value);
            return (
              <button
                key={t.value}
                onClick={() => marcar(t.value)}
                disabled={marcando !== null || marcadoHoy}
                className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium disabled:opacity-40 ${
                  marcadoHoy ? "bg-gray-100 text-gray-400" : "bg-[var(--acento)] text-white"
                }`}
              >
                <Icono size={16} /> {marcando === t.value ? "Marcando…" : marcadoHoy ? `${t.label} ✓` : t.label}
              </button>
            );
          })}
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
                <span className="font-medium">{TIPOS_ASISTENCIA.find((t) => t.value === r.tipo)?.label ?? r.tipo}</span>
                <span className="text-gray-500">{new Date(r.marcado_en).toLocaleTimeString("es-CO")}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {frase && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-30">
          <div className="max-w-sm w-full rounded-2xl bg-gradient-to-br from-violet-500 to-teal p-6 text-white text-center space-y-4 shadow-2xl">
            <Sparkles size={32} className="mx-auto" />
            <p className="text-xs font-semibold uppercase tracking-wide opacity-80">
              {frase.tipo === "llegada" ? "Para arrancar el día" : "Gracias por hoy"}
            </p>
            <p className="text-lg font-medium leading-snug">{frase.texto}</p>
            <button
              onClick={() => setFrase(null)}
              className="w-full rounded-lg bg-white/20 hover:bg-white/30 py-2.5 text-sm font-semibold"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
