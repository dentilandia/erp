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
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [sede, setSede] = useState<Sede | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
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
  }, [session]);

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

  return (
    <AuthContext.Provider value={{ loading, session, perfil, sede, error, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}
