-- El edge function procesar-cierre-semana-ia (y procesar-cierre-ia) escriben
-- el análisis de la IA en cierres_caja.analisis_ia, y el frontend (Hacer
-- Cierre) ya lo lee — pero la columna nunca se creó. Como el código no
-- revisaba el error de cada upsert, todas las escrituras de un período
-- fallaban en silencio ("column analisis_ia does not exist") sin que nada se
-- guardara ni se reportara.
alter table cierres_caja
  add column if not exists analisis_ia jsonb;

comment on column cierres_caja.analisis_ia is
  'Lectura de la IA de los documentos de soporte (efectivo/tarjeta/transferencia reales y diferencias contra lo facturado) — no marca "cuadra" sola, solo sugiere.';
