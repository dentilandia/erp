export const fmtCOP = (v: number | null | undefined) => "$" + Math.round(v ?? 0).toLocaleString("es-CO");

export const today = () => new Date().toISOString().slice(0, 10);

export const uid = () => Math.random().toString(36).slice(2, 10);
