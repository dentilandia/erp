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
  if (error || !perfil) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <p className="text-red-600 max-w-sm text-center text-sm">{error}</p>
      </div>
    );
  }
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
