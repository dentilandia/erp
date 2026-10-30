import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { RecuperacionPacientes } from "./RecuperacionPacientes";
import type { Sede } from "../../lib/types";

const TABS = [{ value: "recuperacion", label: "Recuperación de pacientes" }] as const;
type Tab = (typeof TABS)[number]["value"];

export function ServicioAlCliente() {
  const { sedeActiva } = useOutletContext<{ sedeActiva: Sede }>();
  const [tab, setTab] = useState<Tab>("recuperacion");

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      {TABS.length > 1 && (
        <div className="flex gap-1 bg-white rounded-lg border border-gray-200 p-1 w-fit">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium ${
                tab === t.value ? "bg-[var(--acento)] text-white" : "text-gray-500"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {tab === "recuperacion" && <RecuperacionPacientes sedeId={sedeActiva.id} />}
    </div>
  );
}
