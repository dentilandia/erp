import { useEffect, useState, type CSSProperties } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  ClipboardList,
  Stethoscope,
  Wallet,
  FlaskConical,
  History,
  LogOut,
  LayoutGrid,
  Receipt,
  CreditCard,
  Settings,
  Paperclip,
  Landmark,
  Building2,
  BarChart3,
  GraduationCap,
  Boxes,
  PiggyBank,
  Warehouse,
  Clock,
} from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { supabase } from "../lib/supabase";
import type { Sede } from "../lib/types";

const TABS = [
  { to: "/operacion/recepcion", label: "Recepción", icon: ClipboardList, restringidoEnClinica: true },
  { to: "/operacion/consultorio", label: "Consultorio", icon: Stethoscope },
  { to: "/operacion/cierre", label: "Cierre diario", icon: Wallet, restringidoEnClinica: true },
  { to: "/operacion/laboratorio", label: "Laboratorio", icon: FlaskConical },
  { to: "/operacion/inventario", label: "Inventario", icon: Boxes },
  { to: "/operacion/comprobantes", label: "Financiación", icon: Paperclip, restringidoEnClinica: true },
  { to: "/operacion/historial", label: "Historial", icon: History },
  { to: "/operacion/caja-menor", label: "Caja menor", icon: PiggyBank, soloCajaMenor: true, restringidoEnClinica: true },
];

const SECCIONES = [
  { to: "/operacion/recepcion", match: "/operacion", label: "Operación Diaria", icon: LayoutGrid },
  { to: "/administracion/liquidaciones", match: "/administracion", label: "Administración", icon: Building2 },
  { to: "/parametros", match: "/parametros", label: "Parámetros", icon: Settings },
];

const ADMIN_TABS = [
  { to: "/administracion/liquidaciones", label: "Liquidaciones", icon: Receipt },
  { to: "/administracion/financiacion", label: "Financiación", icon: CreditCard },
  { to: "/administracion/cierre-caja", label: "Cierre de Caja", icon: Landmark },
  { to: "/administracion/reportes", label: "Reportes", icon: BarChart3 },
  { to: "/administracion/inventarios", label: "Inventarios", icon: Warehouse },
];

/** Sede sobre la que trabaja la pantalla: fija si el perfil es de operación,
 *  seleccionable si es admin (filtro de sede libre). */
const CLAVE_SEDE_ADMIN = "erp_sede_admin";

export function useSedeActiva() {
  const { perfil, sede } = useAuth();
  const [sedes, setSedes] = useState<Sede[]>([]);
  const [sedeAdminId, setSedeAdminIdState] = useState<string | null>(() => localStorage.getItem(CLAVE_SEDE_ADMIN));
  const [errorSedes, setErrorSedes] = useState<string | null>(null);

  function setSedeAdminId(id: string) {
    localStorage.setItem(CLAVE_SEDE_ADMIN, id);
    setSedeAdminIdState(id);
  }

  useEffect(() => {
    if (perfil?.rol !== "admin") return;
    supabase
      .from("sedes")
      .select("id, nombre, color_acento")
      .order("nombre")
      .then(({ data, error }) => {
        if (error) {
          console.error("No se pudieron cargar las sedes:", error);
          setErrorSedes(error.message);
          return;
        }
        setSedes((data as Sede[]) ?? []);
        // Si la sede recordada ya no existe, cae a la primera disponible.
        if (data && data.length > 0) {
          setSedeAdminIdState((prev) => (prev && data.some((s) => s.id === prev) ? prev : data[0].id));
        }
      });
  }, [perfil?.rol]);

  if (perfil?.rol === "admin") {
    const activa = sedes.find((s) => s.id === sedeAdminId) ?? null;
    return { sedeActiva: activa, sedes, setSedeAdminId, esAdmin: true, errorSedes };
  }
  return { sedeActiva: sede, sedes: sede ? [sede] : [], setSedeAdminId: () => {}, esAdmin: false, errorSedes: null };
}

export function Layout() {
  const { perfil, signOut, modoOperacion } = useAuth();
  const { sedeActiva, sedes, setSedeAdminId, esAdmin, errorSedes } = useSedeActiva();
  const location = useLocation();
  const enOperacion = location.pathname.startsWith("/operacion");
  const enAdministracion = location.pathname.startsWith("/administracion");

  // Recuerda la última pantalla visitada — al volver a abrir el ERP (o si el
  // navegador recarga la pestaña en segundo plano), retoma ahí en vez de
  // reiniciar siempre en Recepción.
  useEffect(() => {
    localStorage.setItem("erp_ultima_ruta", location.pathname);
  }, [location.pathname]);

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
            errorSedes ? (
              <span className="text-xs text-red-300">No se pudieron cargar las sedes: {errorSedes}</span>
            ) : sedes.length === 0 ? (
              <span className="text-xs text-gris">Cargando sedes…</span>
            ) : (
              <div className="flex items-center gap-1.5">
                {sedes.map((s) => {
                  const activa = sedeActiva?.id === s.id;
                  return (
                    <button
                      key={s.id}
                      onClick={() => setSedeAdminId(s.id)}
                      className="text-xs font-semibold px-3 py-1.5 rounded-full border-2 transition-colors"
                      style={{
                        background: activa ? s.color_acento : "transparent",
                        borderColor: s.color_acento,
                        color: activa ? "#ffffff" : s.color_acento,
                      }}
                    >
                      {s.nombre}
                    </button>
                  );
                })}
              </div>
            )
          ) : (
            sedeActiva && (
              <span
                className="text-xs font-semibold px-3 py-1.5 rounded-full"
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

      <nav className="flex gap-1 px-4 py-2 bg-tinta/95 overflow-x-auto">
        {esAdmin &&
          SECCIONES.map((s) => {
            const activa = location.pathname.startsWith(s.match);
            return (
              <NavLink
                key={s.to}
                to={s.to}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap ${
                  activa ? "text-white" : "text-gris hover:bg-white/10"
                }`}
                style={activa ? { background: "#009F98" } : {}}
              >
                <s.icon size={16} />
                {s.label}
              </NavLink>
            );
          })}
        <NavLink
          to="/asistencia"
          className={({ isActive }) =>
            `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap ${
              isActive ? "text-white" : "text-gris hover:bg-white/10"
            }`
          }
          style={({ isActive }) => (isActive ? { background: "#009F98" } : {})}
        >
          <Clock size={16} />
          Asistencia
        </NavLink>
        <a
          href="/capacitacion.html"
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap text-gris hover:bg-white/10"
        >
          <GraduationCap size={16} />
          Capacitación
        </a>
      </nav>

      {enOperacion && (
        <nav className="flex gap-1 px-4 py-2 bg-white border-b border-gray-200 overflow-x-auto">
          {TABS.filter(
            (t) =>
              (!t.soloCajaMenor || perfil?.rol === "admin" || perfil?.puede_caja_menor) &&
              (!t.restringidoEnClinica || perfil?.rol === "admin" || modoOperacion !== "clinica"),
          ).map((t) => (
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
      )}

      {enAdministracion && (
        <nav className="flex gap-1 px-4 py-2 bg-white border-b border-gray-200 overflow-x-auto">
          {ADMIN_TABS.map((t) => (
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
      )}

      <main
        className="flex-1 p-4"
        style={sedeActiva ? ({ "--acento": sedeActiva.color_acento } as CSSProperties) : undefined}
      >
        {sedeActiva ? (
          <Outlet context={{ sedeActiva }} />
        ) : (
          <p className="text-gray-500 text-sm">Cargando sede…</p>
        )}
      </main>
    </div>
  );
}
