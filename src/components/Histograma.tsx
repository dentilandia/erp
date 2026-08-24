import { useState } from "react";
import { fmtCOP } from "../lib/format";

/** Histograma de barras verticales con tooltip al pasar el mouse — para la
 *  tendencia de facturación día a día (puede haber muchos días). */
export function Histograma({ datos, color }: { datos: { fecha: string; valor: number }[]; color: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const ancho = 600;
  const alto = 160;
  const margenInferior = 4;
  const max = Math.max(1, ...datos.map((d) => d.valor));
  const n = Math.max(1, datos.length);
  const anchoSlot = ancho / n;
  const anchoBarra = Math.max(1, Math.min(24, anchoSlot - 3));

  if (datos.length === 0) return <p className="text-sm text-gray-400">Sin datos en este rango.</p>;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${ancho} ${alto}`} className="w-full h-40" preserveAspectRatio="none">
        <line x1={0} y1={alto - margenInferior} x2={ancho} y2={alto - margenInferior} stroke="#e5e7eb" strokeWidth={1} />
        {datos.map((d, i) => {
          const h = d.valor > 0 ? Math.max(2, (d.valor / max) * (alto - margenInferior - 6)) : 0;
          const x = i * anchoSlot + (anchoSlot - anchoBarra) / 2;
          const y = alto - margenInferior - h;
          return (
            <rect
              key={d.fecha}
              x={x}
              y={y}
              width={anchoBarra}
              height={h}
              rx={2}
              fill={color}
              opacity={hover === null || hover === i ? 1 : 0.55}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover((h2) => (h2 === i ? null : h2))}
            />
          );
        })}
      </svg>
      {hover !== null && datos[hover] && (
        <div
          className="absolute -top-1 bg-tinta text-white text-xs rounded-md px-2 py-1 pointer-events-none whitespace-nowrap -translate-x-1/2"
          style={{ left: `${Math.min(94, Math.max(6, ((hover + 0.5) / n) * 100))}%` }}
        >
          {datos[hover].fecha} · {fmtCOP(datos[hover].valor)}
        </div>
      )}
    </div>
  );
}
