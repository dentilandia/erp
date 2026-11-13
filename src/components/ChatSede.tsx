import { useEffect, useRef, useState } from "react";
import { MessageCircle, X, Send } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthContext";
import type { MensajeChat } from "../lib/types";

const CLAVE_ULTIMA_LECTURA = "erp_chat_ultima_lectura_";

// Paleta fija tipo "grupos de WhatsApp": cada persona siempre sale del mismo
// color, calculado a partir de su id (estable aunque cambie el orden de los
// mensajes o quien esté mirando el chat).
const COLORES_AUTOR = ["#D32F2F", "#1976D2", "#388E3C", "#F57C00", "#7B1FA2", "#00796B", "#C2185B", "#5D4037"];

function colorAutor(autorId: string | null, autorNombre: string | null): string {
  const clave = autorId ?? autorNombre ?? "";
  let hash = 0;
  for (let i = 0; i < clave.length; i++) hash = (hash * 31 + clave.charCodeAt(i)) % 1_000_000;
  return COLORES_AUTOR[hash % COLORES_AUTOR.length];
}

function primerNombre(nombre: string | null): string {
  return nombre?.trim().split(/\s+/)[0] || "—";
}

// Dos tonos ascendentes (estilo "aviso de mensaje") generados con Web Audio,
// sin depender de un archivo de sonido. Si el navegador bloquea audio por no
// haber habido interacción previa del usuario, falla en silencio — no es
// crítico, el aviso visual sigue funcionando igual.
function reproducirSonidoAviso() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const tocarTono = (frecuencia: number, inicio: number, duracion: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = frecuencia;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + inicio);
      gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + inicio + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + inicio + duracion);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + inicio);
      osc.stop(ctx.currentTime + inicio + duracion + 0.05);
    };
    tocarTono(880, 0, 0.12);
    tocarTono(1320, 0.14, 0.18);
  } catch {
    // Audio bloqueado por el navegador — se ignora, el resto del aviso sigue.
  }
}

export function ChatSede({ sedeId, sedeNombre, sedeColor }: { sedeId: string; sedeNombre: string; sedeColor: string }) {
  const { perfil } = useAuth();
  const [abierto, setAbierto] = useState(false);
  const [mensajes, setMensajes] = useState<MensajeChat[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [noLeidos, setNoLeidos] = useState(0);
  const [vistaPrevia, setVistaPrevia] = useState<{ nombre: string; texto: string } | null>(null);
  const finRef = useRef<HTMLDivElement>(null);
  const perfilIdRef = useRef<string | null>(perfil?.id ?? null);
  const vistaPreviaTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abiertoRef = useRef(abierto);

  useEffect(() => {
    perfilIdRef.current = perfil?.id ?? null;
  }, [perfil?.id]);

  useEffect(() => {
    abiertoRef.current = abierto;
  }, [abierto]);

  useEffect(() => {
    setMensajes([]);
    setAbierto(false);
    cargarMensajes();

    const canal = supabase
      .channel(`chat_sede_${sedeId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "mensajes_chat", filter: `sede_id=eq.${sedeId}` },
        (payload) => {
          const nuevo = payload.new as MensajeChat;
          setMensajes((prev) => [...prev, nuevo]);
          // Mensaje de otra persona: sonido + vista previa, para que
          // recepción se entere aunque tenga el chat cerrado y la cabeza en
          // otra cosa — antes solo subía el número del globito, que es fácil
          // de no notar si no se está mirando esa esquina de la pantalla.
          if (nuevo.autor_id !== perfilIdRef.current) {
            reproducirSonidoAviso();
            if (!abiertoRef.current) {
              setVistaPrevia({ nombre: primerNombre(nuevo.autor_nombre), texto: nuevo.contenido });
              if (vistaPreviaTimeoutRef.current) clearTimeout(vistaPreviaTimeoutRef.current);
              vistaPreviaTimeoutRef.current = setTimeout(() => setVistaPrevia(null), 8000);
            }
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(canal);
      if (vistaPreviaTimeoutRef.current) clearTimeout(vistaPreviaTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sedeId]);

  useEffect(() => {
    if (abierto) {
      finRef.current?.scrollIntoView({ behavior: "smooth" });
      const ultimoMensaje = mensajes[mensajes.length - 1];
      if (ultimoMensaje) localStorage.setItem(CLAVE_ULTIMA_LECTURA + sedeId, ultimoMensaje.created_at);
      setNoLeidos(0);
      setVistaPrevia(null);
    } else {
      const ultimaLectura = localStorage.getItem(CLAVE_ULTIMA_LECTURA + sedeId);
      setNoLeidos(
        mensajes.filter((m) => m.autor_id !== perfil?.id && (!ultimaLectura || m.created_at > ultimaLectura)).length,
      );
    }
  }, [mensajes, abierto, sedeId, perfil?.id]);

  async function cargarMensajes() {
    const { data } = await supabase
      .from("mensajes_chat")
      .select("*")
      .eq("sede_id", sedeId)
      .order("created_at", { ascending: true })
      .limit(200);
    setMensajes((data as MensajeChat[]) ?? []);
  }

  async function enviar() {
    const contenido = texto.trim();
    if (!contenido || enviando) return;
    setEnviando(true);
    setTexto("");
    const { error } = await supabase.from("mensajes_chat").insert({
      sede_id: sedeId,
      autor_id: perfil?.id ?? null,
      autor_nombre: perfil?.nombre ?? null,
      contenido,
    });
    if (error) {
      window.alert(`No se pudo enviar el mensaje: ${error.message}`);
      setTexto(contenido);
    }
    setEnviando(false);
  }

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {abierto && (
        <div className="mb-2 w-80 h-[420px] bg-white rounded-xl border border-gray-200 shadow-xl flex flex-col overflow-hidden">
          <div
            className="flex items-center justify-between px-3 py-2 text-white text-sm font-medium shrink-0"
            style={{ background: sedeColor }}
          >
            <span>Chat · {sedeNombre}</span>
            <button onClick={() => setAbierto(false)}>
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
            {mensajes.length === 0 && <p className="text-xs text-gray-400 text-center py-4">Sin mensajes todavía.</p>}
            {mensajes.map((m) => {
              const esPropio = m.autor_id === perfil?.id;
              return (
                <div key={m.id} className={`flex flex-col ${esPropio ? "items-end" : "items-start"}`}>
                  {!esPropio && (
                    <span className="text-[11px] font-semibold px-1" style={{ color: colorAutor(m.autor_id, m.autor_nombre) }}>
                      {primerNombre(m.autor_nombre)}
                    </span>
                  )}
                  <div
                    className={`max-w-[85%] rounded-xl px-3 py-1.5 text-sm whitespace-pre-wrap break-words ${
                      esPropio ? "text-white rounded-br-sm" : "bg-gray-100 text-gray-700 rounded-bl-sm"
                    }`}
                    style={esPropio ? { background: sedeColor } : undefined}
                  >
                    {m.contenido}
                  </div>
                </div>
              );
            })}
            <div ref={finRef} />
          </div>
          <div className="flex items-center gap-1.5 p-2 border-t border-gray-100 shrink-0">
            <input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  enviar();
                }
              }}
              placeholder="Escribe un mensaje…"
              className="flex-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm"
            />
            <button
              onClick={enviar}
              disabled={enviando || !texto.trim()}
              className="rounded-lg text-white p-2 disabled:opacity-40 shrink-0"
              style={{ background: sedeColor }}
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      )}
      {!abierto && vistaPrevia && (
        <button
          onClick={() => setAbierto(true)}
          className="mb-2 ml-auto block w-72 text-left bg-white rounded-xl border border-gray-200 shadow-xl px-3 py-2"
        >
          <span className="text-[11px] font-semibold" style={{ color: sedeColor }}>
            💬 {vistaPrevia.nombre} escribió:
          </span>
          <p className="text-sm text-gray-700 line-clamp-2 mt-0.5">{vistaPrevia.texto}</p>
        </button>
      )}
      <div className="relative ml-auto w-14 h-14">
        {noLeidos > 0 && !abierto && (
          <span className="absolute inset-0 rounded-full animate-ping" style={{ background: sedeColor, opacity: 0.5 }} />
        )}
        <button
          onClick={() => setAbierto((prev) => !prev)}
          className={`relative w-14 h-14 rounded-full text-white shadow-lg flex items-center justify-center ${
            noLeidos > 0 && !abierto ? "animate-bounce" : ""
          }`}
          style={{ background: sedeColor }}
        >
          <MessageCircle size={24} />
          {noLeidos > 0 && (
            <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center ring-2 ring-white">
              {noLeidos > 9 ? "9+" : noLeidos}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
