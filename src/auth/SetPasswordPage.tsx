import { useState, type FormEvent } from "react";
import { useAuth } from "./AuthContext";

/** Se muestra cuando alguien entra desde el link del correo de invitación o de
 *  "olvidé mi contraseña" — antes de dejarlo pasar al ERP, le pide fijar una
 *  contraseña nueva. */
export function SetPasswordPage() {
  const { actualizarClave } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [enviando, setEnviando] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres.");
      return;
    }
    if (password !== confirmar) {
      setError("Las dos contraseñas no coinciden.");
      return;
    }
    setEnviando(true);
    const result = await actualizarClave(password);
    setEnviando(false);
    if (result) setError(result);
    else setOk(true);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-morado px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <img src="/logo-dentilandia.png" alt="Dentilandia" className="w-20 h-20 rounded-full mb-3" />
          <h1 className="text-white text-2xl font-semibold">Dentilandia</h1>
          <p className="text-gris text-sm">Elige tu contraseña</p>
        </div>
        <div className="bg-white rounded-xl p-6 shadow-lg space-y-4">
          {ok ? (
            <p className="text-sm text-emerald-700">
              Listo, ya quedó tu contraseña. Recarga la página para entrar al ERP.
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-tinta mb-1">Contraseña nueva</label>
                <input
                  type="password"
                  required
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-tinta mb-1">Confírmala</label>
                <input
                  type="password"
                  required
                  value={confirmar}
                  onChange={(e) => setConfirmar(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
                />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                type="submit"
                disabled={enviando}
                className="w-full rounded-lg bg-teal text-white py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                {enviando ? "Guardando…" : "Guardar contraseña"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
