import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { ClipboardList, Stethoscope, Wallet, FlaskConical, History, LogOut } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { supabase } from "../lib/supabase";
import type { Sede } from "../lib/types";

const TABS = [
  { to: "/operacion/recepcion", label: "Recepción", icon: ClipboardList },
  { to: "/operacion/consultorio", label: "Consultorio", icon: Stethoscope },
  { to: "/operacion/cierre", label: "Cierre diario", icon: Wallet },
  { to: "/operacion/laboratorio", label: "Laboratorio", icon: FlaskConical },
  { to: "/operacion/historial", label: "Historial", icon: History },
];

/** Sede sobre la que trabaja la pantalla: fija si el perfil es de operación,
 *  seleccionable si es admin (filtro de sede libre). */
export function useSedeActiva() {
  const { perfil, sede } = useAuth();
  const [sedes, setSedes] = useState<Sede[]>([]);
  const [sedeAdminId, setSedeAdminId] = useState<string | null>(null);

  useEffect(() => {
    if (perfil?.rol !== "admin") return;
    supabase
      .from("sedes")
      .select("id, nombre, color_acento")
      .order("nombre")
      .then(({ data }) => {
        setSedes((data as Sede[]) ?? []);
        if (data && data.length > 0) setSedeAdminId((prev) => prev ?? data[0].id);
      });
  }, [perfil?.rol]);

  if (perfil?.rol === "admin") {
    const activa = sedes.find((s) => s.id === sedeAdminId) ?? null;
    return { sedeActiva: activa, sedes, setSedeAdminId, esAdmin: true };
  }
  return { sedeActiva: sede, sedes: sede ? [sede] : [], setSedeAdminId: () => {}, esAdmin: false };
}

export function Layout() {
  const { perfil, signOut } = useAuth();
  const { sedeActiva, sedes, setSedeAdminId, esAdmin } = useSedeActiva();

  return (
    <div className="min-h-screen flex flex-col">
      <header
        className="flex items-center justify-between px-4 py-3 text-white"
        style={{ background: "#2E253A" }}
      >
        <div className="flex items-center gap-3">
          <img src="/logo-dentilandia.png" alt="" className="w-8 h-8 rounded-full" />
          <span className="font-semibold">Dentilandia ERP</span>
        </div>
        <div className="flex items-center gap-3">
          {esAdmin ? (
            <select
              value={sedeActiva?.id ?? ""}
              onChange={(e) => setSedeAdminId(e.target.value)}
              className="text-sm rounded-md px-2 py-1 text-tinta"
            >
              {sedes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          ) : (
            sedeActiva && (
              <span
                className="text-xs font-semibold px-3 py-1 rounded-full"
                style={{ background: sedeActiva.color_acento }}
              >
                {sedeActiva.nombre}
              </span>
            )
          )}
          <span className="text-sm text-gris">{perfil?.nombre}</span>
          <button onClick={signOut} title="Cerrar sesión" className="text-gris hover:text-white">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <nav className="flex gap-1 px-4 py-2 bg-white border-b border-gray-200 overflow-x-auto">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap ${
                isActive ? "text-white" : "text-gray-500 hover:bg-gray-100"
              }`
            }
            style={({ isActive }) => (isActive ? { background: "#2E253A" } : {})}
          >
            <t.icon size={16} />
            {t.label}
          </NavLink>
        ))}
      </nav>

      <main className="flex-1 p-4">
        {sedeActiva ? (
          <Outlet context={{ sedeActiva }} />
        ) : (
          <p className="text-gray-500 text-sm">Cargando sede…</p>
        )}
      </main>
    </div>
  );
}
