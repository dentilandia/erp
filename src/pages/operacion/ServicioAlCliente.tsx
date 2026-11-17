import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { RecuperacionPacientes } from "./RecuperacionPacientes";
import { FidelizacionLista } from "./FidelizacionLista";
import { supabase } from "../../lib/supabase";
import { today } from "../../lib/format";
import { LISTAS_FIDELIZACION, type TipoFidelizacion } from "../../lib/fidelizacion";
import type { Sede } from "../../lib/types";

type Tab = "recuperacion" | TipoFidelizacion;

/** Una fila de fn_fidelizacion_pendientes(): casos abiertos de una lista según su plazo. */
interface Pendientes {
  vencidos: number;
  por_vencer: number;
  compromisos_hoy: number;
  a_tiempo: number;
  urgentes: number;
}

const TABS: { value: Tab; label: string }[] = [
  { value: "recuperacion", label: "Recuperación de pacientes" },
  ...LISTAS_FIDELIZACION.map((l) => ({ value: l.tipo as Tab, label: l.label })),
];

export function ServicioAlCliente() {
  const { sedeActiva } = useOutletContext<{ sedeActiva: Sede }>();
  const [tab, setTab] = useState<Tab>("recuperacion");
  // Pacientes de las listas de fidelización que hay que contactar hoy, por
  // lista — el aviso con el que arranca el día la auxiliar.
  const [paraHoy, setParaHoy] = useState<Record<string, Pendientes>>({});
  const [recargar, setRecargar] = useState(0);

  useEffect(() => {
    supabase.rpc("fn_fidelizacion_pendientes", { p_fecha: today() }).then(({ data }) => {
      const mapa: Record<string, Pendientes> = {};
      for (const r of (data as (Pendientes & { sede_id: string; tipo: string })[]) ?? []) {
        if (r.sede_id !== sedeActiva.id) continue;
        mapa[r.tipo] = r;
      }
      setParaHoy(mapa);
    });
  }, [sedeActiva.id, recargar]);

  const sumar = (k: keyof Pendientes) => Object.values(paraHoy).reduce((a, r) => a + r[k], 0);
  const urgentes = sumar("urgentes");
  const aTiempo = sumar("a_tiempo");

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      {urgentes + aTiempo > 0 && (
        <div className={`rounded-xl border-2 px-4 py-3 ${urgentes > 0 ? "border-amber-300 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
          <p className={`font-semibold ${urgentes > 0 ? "text-amber-900" : "text-emerald-900"}`}>
            {urgentes > 0
              ? `📋 Hoy tienes ${urgentes} paciente${urgentes === 1 ? "" : "s"} urgente${urgentes === 1 ? "" : "s"} por contactar`
              : "✅ Hoy no tienes pacientes urgentes en las listas de fidelización"}
          </p>
          <p className={`text-sm ${urgentes > 0 ? "text-amber-800" : "text-emerald-800"}`}>
            {urgentes > 0 &&
              `${sumar("vencidos")} vencidos · ${sumar("por_vencer")} por vencer · ${sumar("compromisos_hoy")} compromisos de llamar hoy. `}
            {aTiempo > 0 && `${aTiempo} más están a tiempo y se pueden adelantar.`}
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-1 bg-white rounded-lg border border-gray-200 p-1 w-fit">
        {TABS.map((t) => {
          const n = paraHoy[t.value]?.urgentes ?? 0;
          return (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium inline-flex items-center gap-1.5 ${
                tab === t.value ? "bg-[var(--acento)] text-white" : "text-gray-500"
              }`}
            >
              {t.label}
              {n > 0 && (
                <span
                  className={`text-xs font-bold rounded-full px-1.5 ${
                    paraHoy[t.value]?.vencidos ? "bg-red-500 text-white" : "bg-amber-400 text-white"
                  }`}
                >
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {tab === "recuperacion" ? (
        <RecuperacionPacientes sedeId={sedeActiva.id} />
      ) : (
        <FidelizacionLista sedeId={sedeActiva.id} tipo={tab} onCambio={() => setRecargar((n) => n + 1)} />
      )}
    </div>
  );
}
