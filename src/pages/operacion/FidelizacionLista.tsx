import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Phone } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { today } from "../../lib/format";
import { useAuth } from "../../auth/AuthContext";
import {
  ESTADOS_CASO,
  LISTAS_FIDELIZACION,
  MEDIOS_CONTACTO,
  PLAZO_DIAS,
  RESULTADOS_CONTACTO,
  type TipoFidelizacion,
} from "../../lib/fidelizacion";

interface Caso {
  id: string;
  tipo: TipoFidelizacion;
  fecha_atencion: string;
  fecha_limite: string;
  detalle: string | null;
  estado: string;
  proximo_contacto: string | null;
  cerrado_en: string | null;
  cerrado_por_nombre: string | null;
  pacientes: { nombre: string; telefono: string | null } | null;
  doctoras: { nombre: string } | null;
}

interface Contacto {
  id: string;
  fecha_contacto: string;
  medio: string;
  observacion: string | null;
  resultado: string;
  proximo_contacto: string | null;
  registrado_por_nombre: string | null;
  created_at: string;
}

interface FormContacto {
  medio: string;
  observacion: string;
  resultado: string;
  proximoContacto: string;
}

const FORM_VACIO: FormContacto = { medio: "llamada", observacion: "", resultado: "", proximoContacto: "" };

function diasEntre(desde: string, hasta: string): number {
  return Math.round((new Date(`${hasta}T00:00:00`).getTime() - new Date(`${desde}T00:00:00`).getTime()) / 86400000);
}

/** Semáforo del plazo de una semana para el primer contacto. */
function semaforo(c: Caso, hoy: string): { texto: string; clase: string } | null {
  if (ESTADOS_CASO[c.estado]?.cerrado) return null;
  if (c.estado === "en_proceso") {
    if (!c.proximo_contacto) return { texto: "Contactado — sin compromiso", clase: "bg-sky-50 text-sky-700" };
    const d = diasEntre(hoy, c.proximo_contacto);
    if (d < 0) return { texto: `Compromiso vencido (${c.proximo_contacto})`, clase: "bg-red-100 text-red-700" };
    if (d === 0) return { texto: "Compromiso: hoy", clase: "bg-amber-100 text-amber-800" };
    return { texto: `Compromiso: ${c.proximo_contacto}`, clase: "bg-sky-50 text-sky-700" };
  }
  // Verde mientras quedan más de 2 días del plazo, amarillo en los últimos
  // días, rojo vencido (7 días: verde 0-4, amarillo 5-7; 15 días: verde
  // 0-12, amarillo 13-15).
  const plazo = PLAZO_DIAS[c.tipo];
  const dias = diasEntre(c.fecha_atencion, hoy);
  if (dias > plazo) return { texto: `Vencido — ${dias} días sin contacto`, clase: "bg-red-100 text-red-700" };
  if (dias >= plazo - 2) return { texto: `Día ${dias} de ${plazo}`, clase: "bg-amber-100 text-amber-800" };
  return { texto: `Día ${dias} de ${plazo}`, clase: "bg-emerald-50 text-emerald-700" };
}

/** ¿Hay que contactarlo hoy? Abierto y con su compromiso (o, sin compromiso, su atención) ya cumplido. */
function esParaHoy(c: Caso, hoy: string): boolean {
  return !ESTADOS_CASO[c.estado]?.cerrado && (c.proximo_contacto ?? c.fecha_atencion) <= hoy;
}

export function FidelizacionLista({ sedeId, tipo, onCambio }: { sedeId: string; tipo: TipoFidelizacion; onCambio: () => void }) {
  const { perfil } = useAuth();
  const hoy = today();
  const lista = LISTAS_FIDELIZACION.find((l) => l.tipo === tipo)!;
  const [casos, setCasos] = useState<Caso[]>([]);
  const [cargando, setCargando] = useState(true);
  const [filtro, setFiltro] = useState<"hoy" | "abiertos" | "vencidos" | "cerrados" | "todos">("abiertos");
  const [busqueda, setBusqueda] = useState("");
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({});
  const [contactos, setContactos] = useState<Record<string, Contacto[]>>({});
  const [forms, setForms] = useState<Record<string, FormContacto>>({});
  const [guardandoId, setGuardandoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function cargar() {
    setCargando(true);
    const { data } = await supabase
      .from("fidelizacion_casos")
      .select("id, tipo, fecha_atencion, fecha_limite, detalle, estado, proximo_contacto, cerrado_en, cerrado_por_nombre, pacientes(nombre, telefono), doctoras(nombre)")
      .eq("sede_id", sedeId)
      .eq("tipo", tipo)
      .order("fecha_atencion", { ascending: true });
    setCasos((data as unknown as Caso[]) ?? []);
    setCargando(false);
  }

  useEffect(() => {
    cargar();
    setAbiertos({});
    setContactos({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sedeId, tipo]);

  async function cargarContactos(id: string) {
    const { data } = await supabase
      .from("fidelizacion_seguimientos")
      .select("id, fecha_contacto, medio, observacion, resultado, proximo_contacto, registrado_por_nombre, created_at")
      .eq("caso_id", id)
      .order("created_at", { ascending: false });
    setContactos((prev) => ({ ...prev, [id]: (data as Contacto[]) ?? [] }));
  }

  function alternar(id: string) {
    const abrir = !abiertos[id];
    setAbiertos((prev) => ({ ...prev, [id]: abrir }));
    if (abrir && !contactos[id]) cargarContactos(id);
  }

  const formDe = (id: string) => forms[id] ?? FORM_VACIO;
  const actualizarForm = (id: string, cambios: Partial<FormContacto>) =>
    setForms((prev) => ({ ...prev, [id]: { ...formDe(id), ...cambios } }));

  async function registrar(c: Caso) {
    const f = formDe(c.id);
    if (!f.resultado) {
      setError("Elige el resultado del contacto.");
      return;
    }
    if (f.resultado === "volver_a_contactar" && !f.proximoContacto) {
      setError('Con "Volver a contactar" pon la fecha en que te comprometiste a contactarlo.');
      return;
    }
    setError(null);
    setGuardandoId(c.id);
    const { error: err } = await supabase.from("fidelizacion_seguimientos").insert({
      caso_id: c.id,
      sede_id: sedeId,
      medio: f.medio,
      observacion: f.observacion.trim() || null,
      resultado: f.resultado,
      proximo_contacto: f.proximoContacto || null,
      registrado_por: perfil?.id ?? null,
      registrado_por_nombre: perfil?.nombre ?? null,
    });
    setGuardandoId(null);
    if (err) {
      setError(`No se pudo registrar: ${err.message}`);
      return;
    }
    setForms((prev) => {
      const next = { ...prev };
      delete next[c.id];
      return next;
    });
    await Promise.all([cargar(), cargarContactos(c.id)]);
    onCambio();
  }

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return casos.filter((c) => {
      const cerrado = ESTADOS_CASO[c.estado]?.cerrado;
      if (filtro === "hoy" && !esParaHoy(c, hoy)) return false;
      if (filtro === "abiertos" && cerrado) return false;
      if (filtro === "vencidos" && (cerrado || c.estado !== "pendiente" || c.fecha_limite >= hoy)) return false;
      if (filtro === "cerrados" && !cerrado) return false;
      if (q && !(c.pacientes?.nombre ?? "").toLowerCase().includes(q) && !(c.pacientes?.telefono ?? "").includes(q)) return false;
      return true;
    });
  }, [casos, filtro, busqueda, hoy]);

  const conteo = useMemo(
    () => ({
      hoy: casos.filter((c) => esParaHoy(c, hoy)).length,
      abiertos: casos.filter((c) => !ESTADOS_CASO[c.estado]?.cerrado).length,
      vencidos: casos.filter((c) => c.estado === "pendiente" && c.fecha_limite < hoy).length,
      cerrados: casos.filter((c) => ESTADOS_CASO[c.estado]?.cerrado).length,
    }),
    [casos, hoy],
  );

  const FILTROS: { value: typeof filtro; label: string }[] = [
    { value: "hoy", label: `Para hoy (${conteo.hoy})` },
    { value: "abiertos", label: `Abiertos (${conteo.abiertos})` },
    { value: "vencidos", label: `Vencidos (${conteo.vencidos})` },
    { value: "cerrados", label: `Cerrados (${conteo.cerrados})` },
    { value: "todos", label: "Todos" },
  ];

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h1 className="text-lg font-semibold text-tinta">{lista.label}</h1>
        <p className="text-sm text-gray-500">{lista.descripcion} Plazo máximo para el primer contacto: {PLAZO_DIAS[tipo]} días desde la atención.</p>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {FILTROS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFiltro(f.value)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border ${
                filtro === f.value ? "bg-[var(--acento)] text-white border-transparent" : "border-gray-200 text-gray-600"
              }`}
            >
              {f.label}
            </button>
          ))}
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar paciente o teléfono"
            className="ml-auto rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
          />
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {cargando ? (
        <p className="text-sm text-gray-400">Cargando…</p>
      ) : visibles.length === 0 ? (
        <p className="text-sm text-gray-400 bg-white rounded-xl border border-gray-200 p-4">
          {casos.length === 0
            ? "Todavía no hay pacientes en esta lista. Se agregan solos cuando Consultorio guarda la atención."
            : "No hay pacientes con este filtro."}
        </p>
      ) : (
        <div className="space-y-2">
          {visibles.map((c) => {
            const sem = semaforo(c, hoy);
            const est = ESTADOS_CASO[c.estado];
            const f = formDe(c.id);
            return (
              <div key={c.id} className="bg-white rounded-xl border border-gray-200">
                <button onClick={() => alternar(c.id)} className="w-full flex items-start gap-2 px-4 py-3 text-left">
                  {abiertos[c.id] ? <ChevronDown size={16} className="mt-1 shrink-0" /> : <ChevronRight size={16} className="mt-1 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-tinta">{c.pacientes?.nombre ?? "—"}</span>
                      {c.pacientes?.telefono && (
                        <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                          <Phone size={12} /> {c.pacientes.telefono}
                        </span>
                      )}
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${est?.color ?? ""}`}>{est?.label ?? c.estado}</span>
                      {sem && <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${sem.clase}`}>{sem.texto}</span>}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Atención {c.fecha_atencion} · {c.doctoras?.nombre ?? "—"}
                      {c.detalle ? ` · ${c.detalle}` : ""}
                      {est?.cerrado && c.cerrado_por_nombre ? ` · cerrado por ${c.cerrado_por_nombre}` : ""}
                    </p>
                  </div>
                </button>

                {abiertos[c.id] && (
                  <div className="border-t border-gray-100 px-4 py-3 space-y-3">
                    {!est?.cerrado && (
                      <div className="rounded-lg bg-gray-50 p-3 space-y-2">
                        <p className="text-xs font-semibold text-gray-500">Registrar contacto de hoy</p>
                        <div className="flex flex-wrap gap-2">
                          <select
                            value={f.medio}
                            onChange={(e) => actualizarForm(c.id, { medio: e.target.value })}
                            className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm bg-white"
                          >
                            {MEDIOS_CONTACTO.map((m) => (
                              <option key={m.value} value={m.value}>
                                {m.label}
                              </option>
                            ))}
                          </select>
                          <select
                            value={f.resultado}
                            onChange={(e) => actualizarForm(c.id, { resultado: e.target.value })}
                            className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm bg-white"
                          >
                            <option value="">Resultado…</option>
                            {RESULTADOS_CONTACTO.map((r) => (
                              <option key={r.value} value={r.value}>
                                {r.label}
                                {r.cierra ? " (cierra el caso)" : ""}
                              </option>
                            ))}
                          </select>
                          {(f.resultado === "volver_a_contactar" || f.resultado === "no_contesta") && (
                            <label className="flex items-center gap-1 text-xs text-gray-600">
                              Volver a contactar el
                              <input
                                type="date"
                                min={hoy}
                                value={f.proximoContacto}
                                onChange={(e) => actualizarForm(c.id, { proximoContacto: e.target.value })}
                                className="rounded-lg border border-gray-300 px-2 py-1 text-sm"
                              />
                            </label>
                          )}
                        </div>
                        <textarea
                          value={f.observacion}
                          onChange={(e) => actualizarForm(c.id, { observacion: e.target.value })}
                          placeholder="¿Qué dijo el paciente?"
                          rows={2}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                        />
                        <button
                          onClick={() => registrar(c)}
                          disabled={guardandoId === c.id}
                          className="rounded-lg bg-[var(--acento)] text-white text-sm font-medium px-4 py-1.5 disabled:opacity-50"
                        >
                          {guardandoId === c.id ? "Guardando…" : "Registrar contacto"}
                        </button>
                      </div>
                    )}

                    <div>
                      <p className="text-xs font-semibold text-gray-500 mb-1">Historial de contactos</p>
                      {!contactos[c.id] ? (
                        <p className="text-xs text-gray-400">Cargando…</p>
                      ) : contactos[c.id].length === 0 ? (
                        <p className="text-xs text-gray-400">Todavía no se ha contactado.</p>
                      ) : (
                        <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                          {contactos[c.id].map((k) => (
                            <div key={k.id} className="px-3 py-2 text-sm">
                              <p className="text-xs text-gray-500">
                                {new Date(k.created_at).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })} ·{" "}
                                {MEDIOS_CONTACTO.find((m) => m.value === k.medio)?.label ?? k.medio} ·{" "}
                                <span className="font-medium text-gray-700">
                                  {RESULTADOS_CONTACTO.find((r) => r.value === k.resultado)?.label ?? k.resultado}
                                </span>
                                {k.proximo_contacto ? ` · volver a contactar el ${k.proximo_contacto}` : ""}
                                {k.registrado_por_nombre ? ` · ${k.registrado_por_nombre}` : ""}
                              </p>
                              {k.observacion && <p className="text-gray-700">{k.observacion}</p>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
