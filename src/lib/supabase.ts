import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copia .env.example a .env y complétalas con los datos de tu proyecto de Supabase.",
  );
}

export const supabase = createClient(url, anonKey);

// El refresco automático del token de sesión usa un temporizador de la
// pestaña — el navegador lo pausa/retrasa cuando la pestaña queda en
// segundo plano (común en celular, al cambiar de app y volver), así que el
// token podía terminar expirado sin refrescarse a tiempo. Eso no se nota en
// la pantalla (el perfil sigue en memoria), pero cualquier guardado fallaba
// silencioso con un error de permisos, porque la petición llegaba sin sesión
// válida. Patrón oficial de Supabase: recomendar/pausar el refresco según la
// visibilidad de la pestaña, para que al volver a ella se ponga al día antes
// de que alguien intente guardar algo.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
