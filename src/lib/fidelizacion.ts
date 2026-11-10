// Motivos de la cita (Consultorio → "Tratamiento") y listas de fidelización
// de Servicio al cliente. Ver supabase/migrations/0094_fidelizacion_servicio_cliente.sql.

export const MOTIVOS_CITA = [
  "Primera vez o valoración",
  "Mejor valoración",
  "Control periódico",
  "Control 3 meses",
  "Control 4 meses",
  "Control 6 meses",
  "Profifluor",
  "Sellantes",
  "Restauración",
  "Operatoria",
  "Endodoncia",
  "Exodoncia",
  "Frenillectomía",
  "Sedación intravenosa",
  "Sedación óxido nitroso",
  "Control aparatología",
  "Impresión",
  "Instalación",
  "Urgencia aparato",
  "Trauma dental",
] as const;

export const MOTIVO_PRIMERA_VEZ = "Primera vez o valoración";

// Procedimientos que generan "Seguimiento de procedimientos odontológicos".
// Mantener igual a fn_motivos_con_seguimiento() en la base de datos.
export const MOTIVOS_CON_SEGUIMIENTO: readonly string[] = [
  "Operatoria",
  "Endodoncia",
  "Exodoncia",
  "Frenillectomía",
  "Sedación intravenosa",
  "Sedación óxido nitroso",
  "Instalación",
  "Urgencia aparato",
  "Trauma dental",
];

/** Texto que queda en visitas.tratamiento (y en el concepto del cobro):
 *  "Operatoria, Control 6 meses — resina 55". */
export function componerTratamiento(motivos: string[], detalle: string): string {
  const d = detalle.trim();
  if (motivos.length === 0) return d;
  return motivos.join(", ") + (d ? ` — ${d}` : "");
}

export type TipoFidelizacion = "presupuesto" | "sedacion" | "primera_vez" | "radiografia" | "seguimiento_procedimiento";

export const LISTAS_FIDELIZACION: { tipo: TipoFidelizacion; label: string; descripcion: string }[] = [
  { tipo: "presupuesto", label: "Presupuestos", descripcion: "Pacientes a los que se les entregó presupuesto (sin sedación)." },
  { tipo: "sedacion", label: "Sedación", descripcion: "Pacientes a los que se les recomendó sedación (ya incluye su presupuesto)." },
  { tipo: "primera_vez", label: "Primeras veces", descripcion: "Pacientes que vinieron por primera vez." },
  { tipo: "radiografia", label: "Radiografías", descripcion: "Pacientes a los que se les mandó radiografía, para que no se pierdan." },
  {
    tipo: "seguimiento_procedimiento",
    label: "Seguimiento de procedimientos",
    descripcion: "Cómo ha evolucionado el paciente después de operatoria, endodoncia, exodoncia, sedación, instalación, urgencias y trauma.",
  },
];

export const ESTADOS_CASO: Record<string, { label: string; color: string; cerrado: boolean }> = {
  pendiente: { label: "Pendiente", color: "bg-amber-50 text-amber-700", cerrado: false },
  en_proceso: { label: "En proceso", color: "bg-sky-50 text-sky-700", cerrado: false },
  agendo_cita: { label: "Agendó cita", color: "bg-emerald-50 text-emerald-700", cerrado: true },
  no_interesa: { label: "No le interesa", color: "bg-gray-100 text-gray-500", cerrado: true },
  seguimiento_realizado: { label: "Seguimiento realizado", color: "bg-emerald-50 text-emerald-700", cerrado: true },
};

export const MEDIOS_CONTACTO = [
  { value: "llamada", label: "Llamada" },
  { value: "b2chat", label: "B2Chat" },
  { value: "mensaje", label: "Mensaje escrito" },
] as const;

export const RESULTADOS_CONTACTO = [
  { value: "no_contesta", label: "No contesta", cierra: false },
  { value: "volver_a_contactar", label: "Volver a contactar", cierra: false },
  { value: "agendo_cita", label: "Agendó cita", cierra: true },
  { value: "no_interesa", label: "No le interesa", cierra: true },
  { value: "seguimiento_realizado", label: "Seguimiento realizado", cierra: true },
] as const;
