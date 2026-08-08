import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Paciente } from "../lib/types";

interface Props {
  onSelect: (paciente: Paciente) => void;
  placeholder?: string;
}

/** Busca pacientes existentes por nombre (trigram) y permite crear uno nuevo si no aparece. */
export function PacienteAutocomplete({ onSelect, placeholder }: Props) {
  const [query, setQuery] = useState("");
  const [resultados, setResultados] = useState<Paciente[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [creando, setCreando] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResultados([]);
      return;
    }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("pacientes")
        .select("id, nombre, telefono")
        .ilike("nombre", `%${query.trim()}%`)
        .limit(8);
      setResultados((data as Paciente[]) ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  async function crearPaciente() {
    const nombre = query.trim();
    if (!nombre) return;
    setCreando(true);
    const { data, error } = await supabase
      .from("pacientes")
      .insert({ nombre })
      .select("id, nombre, telefono")
      .single();
    setCreando(false);
    if (!error && data) {
      onSelect(data as Paciente);
      setQuery("");
      setAbierto(false);
    }
  }

  return (
    <div className="relative">
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setAbierto(true);
        }}
        onFocus={() => setAbierto(true)}
        placeholder={placeholder ?? "Buscar paciente por nombre…"}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
      />
      {abierto && query.trim().length >= 2 && (
        <div className="absolute z-10 mt-1 w-full bg-white rounded-lg border border-gray-200 shadow-lg max-h-56 overflow-y-auto">
          {resultados.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onSelect(p);
                setQuery("");
                setAbierto(false);
              }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
            >
              {p.nombre}
            </button>
          ))}
          <button
            type="button"
            disabled={creando}
            onClick={crearPaciente}
            className="w-full text-left px-3 py-2 text-sm text-teal font-medium hover:bg-gray-50 border-t border-gray-100"
          >
            {creando ? "Creando…" : `+ Crear paciente "${query.trim()}"`}
          </button>
        </div>
      )}
    </div>
  );
}
