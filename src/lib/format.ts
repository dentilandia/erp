export const fmtCOP = (v: number | null | undefined) => "$" + Math.round(v ?? 0).toLocaleString("es-CO");

export const today = () => new Date().toISOString().slice(0, 10);

export const uid = () => Math.random().toString(36).slice(2, 10);

const pad = (n: number) => String(n).padStart(2, "0");

export const mesActual = () => today().slice(0, 7);

/** Doctoras y laboratorios se liquidan del 26 del mes anterior al 25 del mes seleccionado. */
export function periodoCiclo2625(mesStr: string): { inicio: string; fin: string } {
  const [y, m] = mesStr.split("-").map(Number);
  let inicioY = y;
  let inicioM = m - 1;
  if (inicioM === 0) {
    inicioM = 12;
    inicioY = y - 1;
  }
  return { inicio: `${inicioY}-${pad(inicioM)}-26`, fin: `${y}-${pad(m)}-25` };
}

/** Sedación se liquida mes calendario completo. */
export function periodoMesCompleto(mesStr: string): { inicio: string; fin: string } {
  const [y, m] = mesStr.split("-").map(Number);
  const ultimoDia = new Date(y, m, 0).getDate();
  return { inicio: `${y}-${pad(m)}-01`, fin: `${y}-${pad(m)}-${pad(ultimoDia)}` };
}
