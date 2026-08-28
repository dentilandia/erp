import { useState, type FormEvent } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { LoginPage } from "./auth/LoginPage";
import { SetPasswordPage } from "./auth/SetPasswordPage";
import { Layout } from "./components/Layout";
import { Recepcion } from "./pages/operacion/Recepcion";
import { Consultorio } from "./pages/operacion/Consultorio";
import { CierreDiario } from "./pages/operacion/CierreDiario";
import { LaboratorioOperativo } from "./pages/operacion/LaboratorioOperativo";
import { Inventario } from "./pages/operacion/Inventario";
import { Historial } from "./pages/operacion/Historial";
import { ComprobantesFinanciacion } from "./pages/operacion/ComprobantesFinanciacion";
import { Liquidaciones } from "./pages/Liquidaciones";
import { Financiacion } from "./pages/Financiacion";
import { CierreCaja } from "./pages/CierreCaja";
import { Reportes } from "./pages/Reportes";
import { Parametros } from "./pages/Parametros";

/** Bloquea de verdad las rutas de administración/parámetros para el equipo de
 *  operación — antes solo estaban ocultas del menú, no impedidas por ruta. */
function SoloAdmin({ children }: { children: React.ReactNode }) {
  const { perfil } = useAuth();
  if (perfil?.rol !== "admin") return <Navigate to="/operacion/recepcion" replace />;
  return <>{children}</>;
}

/** Se muestra cuando hay sesión pero aún no hay perfil (falta que Tomás lo
 *  cree). Deja fijar la contraseña ahí mismo por si el link de invitación/
 *  recuperación no activó la pantalla dedicada (pasa con algunos navegadores
 *  de correo en el celular, que dañan el link) — así no queda bloqueada. */
function SinPerfil({ error }: { error: string | null }) {
  const { actualizarClave, signOut } = useAuth();
  const [password, setPassword] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      setResultado("La contraseña debe tener al menos 6 caracteres.");
      return;
    }
    setEnviando(true);
    const result = await actualizarClave(password);
    setEnviando(false);
    setResultado(result);
    if (!result) setOk(true);
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-sm w-full space-y-4">
        <p className="text-red-600 text-center text-sm">{error}</p>
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          {ok ? (
            <p className="text-sm text-emerald-700">Contraseña guardada. Cuando Tomás te cree el perfil, entras normal.</p>
          ) : (
            <>
              <p className="text-xs text-gray-500">
                Si todavía no has puesto tu contraseña, ponla aquí mientras tanto:
              </p>
              <form onSubmit={handleSubmit} className="space-y-2">
                <input
                  type="password"
                  required
                  placeholder="Contraseña nueva"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                {resultado && <p className="text-xs text-red-600">{resultado}</p>}
                <button
                  type="submit"
                  disabled={enviando}
                  className="w-full rounded-lg bg-teal text-white py-2 text-sm font-medium disabled:opacity-50"
                >
                  {enviando ? "Guardando…" : "Guardar contraseña"}
                </button>
              </form>
            </>
          )}
          <button onClick={signOut} className="w-full text-center text-xs text-gray-400 hover:text-tinta">
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
}

function Gate({ children }: { children: React.ReactNode }) {
  const { loading, session, perfil, error, recuperandoClave } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        Cargando…
      </div>
    );
  }
  if (recuperandoClave) return <SetPasswordPage />;
  if (!session) return <LoginPage />;
  if (error || !perfil) return <SinPerfil error={error} />;
  return <>{children}</>;
}

const CLAVE_ULTIMA_RUTA = "erp_ultima_ruta";

function App() {
  const ultimaRuta = localStorage.getItem(CLAVE_ULTIMA_RUTA);
  return (
    <AuthProvider>
      <BrowserRouter>
        <Gate>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<Navigate to={ultimaRuta || "/operacion/recepcion"} replace />} />
              <Route path="operacion/recepcion" element={<Recepcion />} />
              <Route path="operacion/consultorio" element={<Consultorio />} />
              <Route path="operacion/cierre" element={<CierreDiario />} />
              <Route path="operacion/laboratorio" element={<LaboratorioOperativo />} />
              <Route path="operacion/inventario" element={<Inventario />} />
              <Route path="operacion/historial" element={<Historial />} />
              <Route path="operacion/comprobantes" element={<ComprobantesFinanciacion />} />
              <Route path="administracion/liquidaciones" element={<SoloAdmin><Liquidaciones /></SoloAdmin>} />
              <Route path="administracion/financiacion" element={<SoloAdmin><Financiacion /></SoloAdmin>} />
              <Route path="administracion/cierre-caja" element={<SoloAdmin><CierreCaja /></SoloAdmin>} />
              <Route path="administracion/reportes" element={<SoloAdmin><Reportes /></SoloAdmin>} />
              <Route path="parametros" element={<SoloAdmin><Parametros /></SoloAdmin>} />
            </Route>
          </Routes>
        </Gate>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
