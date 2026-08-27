import { useState, type FormEvent } from "react";
import { useAuth } from "./AuthContext";

export function LoginPage() {
  const { signIn, enviarRecuperacion } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [modoRecuperar, setModoRecuperar] = useState(false);
  const [recuperado, setRecuperado] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const result = await signIn(email.trim(), password);
    setSubmitting(false);
    if (result) setError(result);
  }

  async function handleRecuperar(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const result = await enviarRecuperacion(email.trim());
    setSubmitting(false);
    if (result) setError(result);
    else setRecuperado(true);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-morado px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <img src="/logo-dentilandia.png" alt="Dentilandia" className="w-20 h-20 rounded-full mb-3" />
          <h1 className="text-white text-2xl font-semibold">Dentilandia</h1>
          <p className="text-gris text-sm">ERP · Operación Diaria</p>
        </div>

        {modoRecuperar ? (
          <div className="bg-white rounded-xl p-6 shadow-lg space-y-4">
            {recuperado ? (
              <p className="text-sm text-emerald-700">
                Listo, revisa tu correo — te llegó un link para poner una contraseña nueva.
              </p>
            ) : (
              <form onSubmit={handleRecuperar} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-tinta mb-1">Tu correo</label>
                  <input
                    type="email"
                    required
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
                  />
                </div>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-lg bg-teal text-white py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {submitting ? "Enviando…" : "Enviarme el link"}
                </button>
              </form>
            )}
            <button
              onClick={() => {
                setModoRecuperar(false);
                setRecuperado(false);
                setError(null);
              }}
              className="w-full text-center text-xs text-gray-400 hover:text-tinta"
            >
              Volver a iniciar sesión
            </button>
          </div>
        ) : (
          <>
            <form onSubmit={handleSubmit} className="bg-white rounded-xl p-6 shadow-lg space-y-4">
              <div>
                <label className="block text-sm font-medium text-tinta mb-1">Usuario</label>
                <input
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="recepcion@fabricato.dentilandia"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-tinta mb-1">Contraseña</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
                />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-teal text-white py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? "Ingresando…" : "Ingresar"}
              </button>
            </form>
            <button
              onClick={() => {
                setModoRecuperar(true);
                setError(null);
              }}
              className="w-full text-center text-xs text-gris hover:text-white mt-3"
            >
              ¿Olvidaste tu contraseña?
            </button>
          </>
        )}

        <p className="text-center text-gris text-xs mt-4">
          Este equipo queda fijo en la sede de la cuenta con la que ingreses.
        </p>
      </div>
    </div>
  );
}
