import { useState } from "react";
import { fmtCOP } from "../lib/format";

const DIAS_SEMANA = ["D", "L", "M", "X", "J", "V", "S"];
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

interface Punto {
  fecha: string;
  valor: number;
}

/** Calendario tipo "mapa de calor" — un cuadro por día, más intenso entre más
 *  factura ese día. Más visual que una tabla para ver patrones (ej. qué días
 *  de la semana facturan más). */
export function CalendarioCalor({ datos, color }: { datos: Punto[]; color: string }) {
  const [hover, setHover] = useState<string | null>(null);

  if (datos.length === 0) return <p className="text-sm text-gray-400">Sin datos en este rango.</p>;

  const valorPorFecha: Record<string, number> = Object.fromEntries(datos.map((d) => [d.fecha, d.valor]));
  const max = Math.max(1, ...datos.map((d) => d.valor));
  const meses = Array.from(new Set(datos.map((d) => d.fecha.slice(0, 7)))).sort();

  return (
    <div className="space-y-4">
      {meses.map((mes) => {
        const [y, m] = mes.split("-").map(Number);
        const diasEnMes = new Date(y, m, 0).getDate();
        const primerDiaSemana = new Date(y, m - 1, 1).getDay();
        const celdas: (string | null)[] = [
          ...Array(primerDiaSemana).fill(null),
          ...Array.from({ length: diasEnMes }, (_, i) => `${mes}-${String(i + 1).padStart(2, "0")}`),
        ];
        return (
          <div key={mes}>
            <p className="text-xs font-semibold text-gray-500 mb-1.5 capitalize">
              {MESES[m - 1]} {y}
            </p>
            <div className="grid grid-cols-7 gap-1">
              {DIAS_SEMANA.map((d, i) => (
                <div key={i} className="text-[10px] text-gray-400 text-center">
                  {d}
                </div>
              ))}
              {celdas.map((fecha, i) => {
                if (!fecha) return <div key={`vacio-${i}`} />;
                const valor = valorPorFecha[fecha] ?? 0;
                const intensidad = valor > 0 ? 0.18 + 0.82 * (valor / max) : 0;
                return (
                  <div
                    key={fecha}
                    onMouseEnter={() => setHover(fecha)}
                    onMouseLeave={() => setHover((h) => (h === fecha ? null : h))}
                    className="relative aspect-square rounded-md flex items-center justify-center text-[10px]"
                    style={{ background: valor > 0 ? color : "#f3f4f6", opacity: valor > 0 ? intensidad : 1 }}
                  >
                    <span className={valor > 0 && intensidad > 0.55 ? "text-white" : "text-gray-400"}>{Number(fecha.slice(-2))}</span>
                    {hover === fecha && valor > 0 && (
                      <div className="absolute z-10 bottom-full mb-1 left-1/2 -translate-x-1/2 bg-tinta text-white text-xs rounded-md px-2 py-1 whitespace-nowrap pointer-events-none">
                        {fecha} · {fmtCOP(valor)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
