import { useEffect, useRef, useState } from "react";
import { Camera, RotateCcw, LogIn, LogOut } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import type { AsistenciaRegistro } from "../lib/types";

/** Marcar llegada/salida con foto — la IP se valida del lado del servidor
 *  (edge function marcar-asistencia), no acá, porque un dato mandado desde
 *  el navegador se podría falsificar. Si la sede no tiene IP configurada en
 *  Parámetros, no se restringe (para no bloquear antes de configurarla). */
export function Asistencia() {
  const { perfil } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camaraActiva, setCamaraActiva] = useState(false);
  const [errorCamara, setErrorCamara] = useState<string | null>(null);
  const [fotoBlob, setFotoBlob] = useState<Blob | null>(null);
  const [fotoUrl, setFotoUrl] = useState<string | null>(null);
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

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (fotoUrl) URL.revokeObjectURL(fotoUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function activarCamara() {
    setErrorCamara(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCamaraActiva(true);
    } catch {
      setErrorCamara("No se pudo acceder a la cámara — revisa que este dispositivo tenga una y que le hayas dado permiso al navegador.");
    }
  }

  function capturarFoto() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      setFotoBlob(blob);
      setFotoUrl(URL.createObjectURL(blob));
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setCamaraActiva(false);
    }, "image/jpeg", 0.85);
  }

  function reintentar() {
    if (fotoUrl) URL.revokeObjectURL(fotoUrl);
    setFotoBlob(null);
    setFotoUrl(null);
    setMensaje(null);
  }

  async function marcar(tipo: "llegada" | "salida") {
    if (!fotoBlob || !perfil) return;
    setMarcando(tipo);
    setMensaje(null);
    const path = `${perfil.id}/${Date.now()}.jpg`;
    const { error: errorSubida } = await supabase.storage.from("asistencia").upload(path, fotoBlob, {
      contentType: "image/jpeg",
    });
    if (errorSubida) {
      setMarcando(null);
      setMensaje({ tipo: "error", texto: `No se pudo subir la foto: ${errorSubida.message}` });
      return;
    }
    const { data, error } = await supabase.functions.invoke("marcar-asistencia", { body: { tipo, foto_path: path } });
    setMarcando(null);
    if (error || data?.error) {
      setMensaje({ tipo: "error", texto: data?.error ?? error?.message ?? "No se pudo registrar la marca." });
      return;
    }
    setMensaje({ tipo: "ok", texto: tipo === "llegada" ? "Llegada registrada." : "Salida registrada." });
    reintentar();
    cargarRegistros();
  }

  return (
    <div className="max-w-md mx-auto space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <h2 className="font-semibold text-tinta">Marcar asistencia</h2>
        <p className="text-xs text-gray-400">
          Toma una foto y luego marca llegada o salida. Solo funciona conectado a la red de la sede.
        </p>

        {!fotoUrl ? (
          <div className="space-y-2">
            <div className="relative rounded-lg overflow-hidden bg-gray-100 aspect-video flex items-center justify-center">
              {camaraActiva ? (
                <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
              ) : (
                <Camera size={32} className="text-gray-300" />
              )}
            </div>
            {errorCamara && <p className="text-sm text-red-600">{errorCamara}</p>}
            {!camaraActiva ? (
              <button
                onClick={activarCamara}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-[var(--acento)] text-white py-2.5 text-sm font-medium"
              >
                <Camera size={16} /> Activar cámara
              </button>
            ) : (
              <button
                onClick={capturarFoto}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-[var(--acento)] text-white py-2.5 text-sm font-medium"
              >
                <Camera size={16} /> Capturar foto
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <img src={fotoUrl} alt="Foto capturada" className="w-full rounded-lg" />
            <button
              onClick={reintentar}
              className="w-full flex items-center justify-center gap-2 rounded-lg border border-gray-300 text-gray-600 py-2 text-sm font-medium"
            >
              <RotateCcw size={14} /> Tomar otra
            </button>
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
          </div>
        )}

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
