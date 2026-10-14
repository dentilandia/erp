-- El lote de documentos semanales de Cierre de Caja estaba forzado a
-- exactamente 7 días desde un lunes. Algunos períodos no caen limpio en eso
-- (ej. documentos que ya traen varios días sueltos de distintas semanas), así
-- que se agrega un fin de rango editable — si es null, se asume el lunes +
-- 6 días de siempre, para no romper nada de lo ya cargado.
alter table cierres_caja_semanas
  add column if not exists semana_fin date;

comment on column cierres_caja_semanas.semana_fin is
  'Fin del período a procesar (inclusive). Si es null, se asume semana_inicio + 6 días (una semana completa).';
