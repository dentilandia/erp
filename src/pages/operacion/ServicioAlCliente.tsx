import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { RecuperacionPacientes } from "./RecuperacionPacientes";
import { FidelizacionLista } from "./FidelizacionLista";
import { supabase } from "../../lib/supabase";
import { today } from "../../lib/format";
import { LISTAS_FIDELIZACION, type TipoFidelizacion } from "../../lib/fidelizacion";
import type { Sede } from "../../lib/types";

type Tab = "recuperacion" | TipoFidelizacion;

const TABS: { value: Tab; label: string }[] = [
  { value: "recuperacion", label: "Recuperación de pacientes" },
  ...LISTAS_FIDELIZACION.map((l) => ({ value: l.tipo as Tab, label: l.label })),
];

export function ServicioAlCliente() {
  const { sedeActiva } = useOutletContext<{ sedeActiva: Sede }>();
  const [tab, setTab] = useState<Tab>("recuperacion");
  // Pacientes de las listas de fidelización que hay que contactar hoy, por
  // lista — el aviso con el que arranca el día la auxiliar.
  const [paraHoy, setParaHoy] = useState<Record<string, { total: number; vencidos: number }>>({});
  const [recargar, setRecargar] = useState(0);

  useEffect(() => {
    supabase.rpc("fn_fidelizacion_pendientes", { p_fecha: today() }).then(({ data }) => {
      const mapa: Record<string, { total: number; vencidos: number }> = {};
      for (const r of (data as { sede_id: string; tipo: string; por_contactar: number; vencidos: number }[]) ?? []) {
        if (r.sede_id !== sedeActiva.id) continue;
        mapa[r.tipo] = { total: r.por_contactar, vencidos: r.vencidos };
      }
      setParaHoy(mapa);
    });
  }, [sedeActiva.id, recargar]);

  const totalHoy = Object.values(paraHoy).reduce((a, r) => a + r.total, 0);
  const totalVencidos = Object.values(paraHoy).reduce((a, r) => a + r.vencidos, 0);

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      {totalHoy > 0 && (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3">
          <p className="font-semibold text-amber-900">
            📋 Hoy tienes {totalHoy} paciente{totalHoy === 1 ? "" : "s"} por contactar en las listas de fidelización
          </p>
          <p className="text-sm text-amber-800">
            {LISTAS_FIDELIZACION.filter((l) => paraHoy[l.tipo]?.total)
              .map((l) => `${l.label}: ${paraHoy[l.tipo].total}`)
              .join(" · ")}
            {totalVencidos > 0 && ` — ⚠ ${totalVencidos} ya pasaron la semana sin contacto`}
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-1 bg-white rounded-lg border border-gray-200 p-1 w-fit">
        {TABS.map((t) => {
          const n = paraHoy[t.value]?.total ?? 0;
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
