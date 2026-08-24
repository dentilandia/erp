import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { LoginPage } from "./auth/LoginPage";
import { Layout } from "./components/Layout";
import { Recepcion } from "./pages/operacion/Recepcion";
import { Consultorio } from "./pages/operacion/Consultorio";
import { CierreDiario } from "./pages/operacion/CierreDiario";
import { LaboratorioOperativo } from "./pages/operacion/LaboratorioOperativo";
import { Historial } from "./pages/operacion/Historial";
import { ComprobantesFinanciacion } from "./pages/operacion/ComprobantesFinanciacion";
import { Liquidaciones } from "./pages/Liquidaciones";
import { Financiacion } from "./pages/Financiacion";
import { CierreCaja } from "./pages/CierreCaja";
import { Reportes } from "./pages/Reportes";
import { Parametros } from "./pages/Parametros";

function Gate({ children }: { children: React.ReactNode }) {
  const { loading, session, perfil, error } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        Cargando…
      </div>
    );
  }
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

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Gate>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<Navigate to="/operacion/recepcion" replace />} />
              <Route path="operacion/recepcion" element={<Recepcion />} />
              <Route path="operacion/consultorio" element={<Consultorio />} />
              <Route path="operacion/cierre" element={<CierreDiario />} />
              <Route path="operacion/laboratorio" element={<LaboratorioOperativo />} />
              <Route path="operacion/historial" element={<Historial />} />
              <Route path="operacion/comprobantes" element={<ComprobantesFinanciacion />} />
              <Route path="administracion/liquidaciones" element={<Liquidaciones />} />
              <Route path="administracion/financiacion" element={<Financiacion />} />
              <Route path="administracion/cierre-caja" element={<CierreCaja />} />
              <Route path="administracion/reportes" element={<Reportes />} />
              <Route path="parametros" element={<Parametros />} />
            </Route>
          </Routes>
        </Gate>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
