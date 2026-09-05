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
import { CajaMenor } from "./pages/operacion/CajaMenor";
import { Liquidaciones } from "./pages/Liquidaciones";
import { Financiacion } from "./pages/Financiacion";
import { CierreCaja } from "./pages/CierreCaja";
import { Reportes } from "./pages/Reportes";
import { AdministracionInventarios } from "./pages/AdministracionInventarios";
import { Asistencia } from "./pages/Asistencia";
import { Parametros } from "./pages/Parametros";

/** Bloquea de verdad las rutas de administración/parámetros para el equipo de
 *  operación — antes solo estaban ocultas del menú, no impedidas por ruta. */
function SoloAdmin({ children }: { children: React.ReactNode }) {
  const { perfil } = useAuth();
  if (perfil?.rol !== "admin") return <Navigate to="/operacion/recepcion" replace />;
  return <>{children}</>;
}

/** Caja menor no es para todo el equipo de operación — solo admin y quien
 *  tenga perfiles.puede_caja_menor marcado en su sede. */
function SoloCajaMenor({ children }: { children: React.ReactNode }) {
  const { perfil } = useAuth();
  if (perfil?.rol !== "admin" && !perfil?.puede_caja_menor) return <Navigate to="/operacion/recepcion" replace />;
  return <>{children}</>;
}

/** En modo "Consultorio" (elegido al entrar) solo se puede ver Consultorio,
 *  Laboratorio, Inventario e Historial — el resto queda bloqueado de
 *  verdad por ruta, no solo oculto del menú. No aplica a admin (Tomás,
 *  Sirley), que siempre ve todo sin necesidad de elegir modo. */
function BloqueadoEnClinica({ children }: { children: React.ReactNode }) {
  const { perfil, modoOperacion } = useAuth();
  if (perfil?.rol !== "admin" && modoOperacion === "clinica") return <Navigate to="/operacion/consultorio" replace />;
  return <>{children}</>;
}

/** Consultorio, al revés, queda bloqueado en modo "Recepción" — no le sirve
 *  de nada a quien está en recepción. */
function BloqueadoEnRecepcion({ children }: { children: React.ReactNode }) {
  const { perfil, modoOperacion } = useAuth();
  if (perfil?.rol !== "admin" && modoOperacion === "recepcion") return <Navigate to="/operacion/recepcion" replace />;
  return <>{children}</>;
}

/** Se muestra cuando hay sesión pero aún no hay perfil (falta que Tomás lo
 *  cree). Deja fijar la contraseña ahí mismo por si el link de invitación/
 *  recuperación no activó la pantalla dedicada (pasa con algunos navegadores
 *  de correo en el celular, que dañan el link) — así no queda bloqueada. */
function SinPerfil({ error }: { error: string | null }) {
  const { actualizarClave, signOut, session, enviarRecuperacion } = useAuth();
  const [password, setPassword] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [reenviando, setReenviando] = useState(false);
  const [reenviado, setReenviado] = useState(false);

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

  async function handleReenviar() {
    if (!session?.user.email) return;
    setReenviando(true);
    await enviarRecuperacion(session.user.email);
    setReenviando(false);
    setReenviado(true);
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
              {session?.user.email && (
                <button
                  onClick={handleReenviar}
                  disabled={reenviando}
                  className="w-full text-center text-xs text-teal hover:underline disabled:opacity-50"
                >
                  {reenviando ? "Enviando…" : reenviado ? "Link reenviado — revisa tu correo" : "¿No funcionó? Reenviar link de acceso a mi correo"}
                </button>
              )}
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

/** Se pregunta una sola vez por sesión (no queda guardado de una vez para
 *  la próxima) — para todo el equipo de operación excepto admin. Determina
 *  qué tabs/rutas puede ver: en "Consultorio" solo Consultorio, Laboratorio,
 *  Inventario e Historial; en "Recepción" ve todo lo de operación. */
function SeleccionarModoOperacion() {
  const { perfil, elegirModoOperacion, signOut } = useAuth();
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-sm w-full space-y-4 text-center">
        <p className="text-sm text-gray-500">
          Hola, {perfil?.nombre} — ¿dónde vas a estar hoy?
        </p>
        <div className="space-y-2">
          <button
            onClick={() => elegirModoOperacion("recepcion")}
            className="w-full rounded-xl bg-[#2E253A] text-white py-4 text-sm font-semibold"
          >
            Recepción
          </button>
          <button
            onClick={() => elegirModoOperacion("clinica")}
            className="w-full rounded-xl border-2 border-[#2E253A] text-[#2E253A] py-4 text-sm font-semibold"
          >
            Consultorio
          </button>
        </div>
        <p className="text-xs text-gray-400">
          En Recepción ves Recepción, Cierre diario, Laboratorio, Inventario, Financiación, Historial y Caja menor (si la
          tienes asignada). En Consultorio solo ves Consultorio, Laboratorio, Inventario e Historial.
        </p>
        <button onClick={signOut} className="text-xs text-gray-400 hover:text-tinta">
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}

function Gate({ children }: { children: React.ReactNode }) {
  const { loading, session, perfil, error, recuperandoClave, modoOperacion } = useAuth();

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
  if (perfil.rol !== "admin" && !modoOperacion) return <SeleccionarModoOperacion />;
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
              <Route path="operacion/recepcion" element={<BloqueadoEnClinica><Recepcion /></BloqueadoEnClinica>} />
              <Route path="operacion/consultorio" element={<BloqueadoEnRecepcion><Consultorio /></BloqueadoEnRecepcion>} />
              <Route path="operacion/cierre" element={<BloqueadoEnClinica><CierreDiario /></BloqueadoEnClinica>} />
              <Route path="operacion/laboratorio" element={<LaboratorioOperativo />} />
              <Route path="operacion/inventario" element={<Inventario />} />
              <Route path="operacion/historial" element={<Historial />} />
              <Route path="operacion/comprobantes" element={<BloqueadoEnClinica><ComprobantesFinanciacion /></BloqueadoEnClinica>} />
              <Route path="operacion/caja-menor" element={<BloqueadoEnClinica><SoloCajaMenor><CajaMenor /></SoloCajaMenor></BloqueadoEnClinica>} />
              <Route path="administracion/liquidaciones" element={<SoloAdmin><Liquidaciones /></SoloAdmin>} />
              <Route path="administracion/financiacion" element={<SoloAdmin><Financiacion /></SoloAdmin>} />
              <Route path="administracion/cierre-caja" element={<SoloAdmin><CierreCaja /></SoloAdmin>} />
              <Route path="administracion/reportes" element={<SoloAdmin><Reportes /></SoloAdmin>} />
              <Route path="administracion/inventarios" element={<SoloAdmin><AdministracionInventarios /></SoloAdmin>} />
              <Route path="parametros" element={<SoloAdmin><Parametros /></SoloAdmin>} />
              <Route path="asistencia" element={<SoloAdmin><Asistencia /></SoloAdmin>} />
            </Route>
          </Routes>
        </Gate>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
