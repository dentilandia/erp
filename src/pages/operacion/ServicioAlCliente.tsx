import { useState } from "react";
import { RecuperacionPacientes } from "./RecuperacionPacientes";

const TABS = [{ value: "recuperacion", label: "Recuperación de pacientes" }] as const;
type Tab = (typeof TABS)[number]["value"];

export function ServicioAlCliente() {
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

      {tab === "recuperacion" && <RecuperacionPacientes />}
    </div>
  );
}
