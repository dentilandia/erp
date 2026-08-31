import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import type { Perfil, Sede } from "../lib/types";

interface AuthState {
  loading: boolean;
  session: Session | null;
  perfil: Perfil | null;
  sede: Sede | null;
  error: string | null;
  recuperandoClave: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  enviarRecuperacion: (email: string) => Promise<string | null>;
  actualizarClave: (password: string) => Promise<string | null>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [sede, setSede] = useState<Sede | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recuperandoClave, setRecuperandoClave] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setLoading(false);
    });
    // PASSWORD_RECOVERY se dispara cuando alguien entra desde el link del
    // correo de "olvidé mi contraseña" (o de invitación) — en ese caso no
    // debe pasar directo al ERP, sino pedirle que ponga una contraseña nueva.
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (event === "PASSWORD_RECOVERY") setRecuperandoClave(true);
      if (!next) {
        setPerfil(null);
        setSede(null);
        setLoading(false);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data: perfilRow, error: perfilError } = await supabase
        .from("perfiles")
        .select("id, nombre, rol, sede_id")
        .eq("id", session.user.id)
        .single();
      if (cancelled) return;
      if (perfilError || !perfilRow) {
        setError(
          "Tu usuario no tiene un perfil configurado en el ERP. Pídele a Tomás que te cree el perfil en la tabla 'perfiles'.",
        );
        setLoading(false);
        return;
      }
      setPerfil(perfilRow as Perfil);
      if (perfilRow.sede_id) {
        const { data: sedeRow } = await supabase
          .from("sedes")
          .select("id, nombre, color_acento")
          .eq("id", perfilRow.sede_id)
          .single();
        if (!cancelled) setSede((sedeRow as Sede) ?? null);
      } else {
        setSede(null);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // Depende del id del usuario, no del objeto session completo — Supabase
    // dispara un evento (y una session nueva) en cosas como actualizarClave()
    // aunque sea el mismo usuario, y eso volvía a poner loading=true y
    // recreaba la pantalla de "sin perfil", borrando el mensaje de éxito
    // antes de que se alcanzara a ver.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  async function signIn(email: string, password: string) {
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      return signInError.message === "Invalid login credentials"
        ? "Usuario o contraseña incorrectos."
        : signInError.message;
    }
    return null;
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  async function enviarRecuperacion(email: string) {
    const { error: recError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    return recError ? recError.message : null;
  }

  async function actualizarClave(password: string) {
    const { error: updError } = await supabase.auth.updateUser({ password });
    if (updError) {
      // Pasa seguido cuando el link de invitación/recuperación se abrió dentro
      // del navegador embebido de una app de correo (Gmail, Outlook) en el
      // celular — ese navegador a veces no guarda bien la sesión que trae el
      // link. El mensaje de Supabase ("Auth session missing!") no dice nada
      // de esto, así que lo traducimos a algo accionable.
      if (updError.message.toLowerCase().includes("session missing")) {
        return "No se pudo guardar la contraseña porque el link no cargó bien la sesión en este navegador — pasa seguido al abrir el link desde la app de Gmail/Outlook en el celular. Copia el link y ábrelo en Chrome o Safari, o pide un link nuevo con \"Reenviar link de acceso\" abajo.";
      }
      return updError.message;
    }
    setRecuperandoClave(false);
    return null;
  }

  return (
    <AuthContext.Provider
      value={{ loading, session, perfil, sede, error, recuperandoClave, signIn, signOut, enviarRecuperacion, actualizarClave }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}
