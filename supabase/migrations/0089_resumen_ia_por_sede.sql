-- El resumen de "Procesar semana con IA" venía como un solo párrafo que
-- mezclaba Las Américas y Fabricato — más difícil de leer cuando los
-- hallazgos de cada sede no tienen nada que ver entre sí. Se separa en dos
-- columnas, una por sede, para mostrarlas como dos bloques independientes.
alter table cierres_caja_semanas
  add column if not exists resumen_ia_las_americas text,
  add column if not exists resumen_ia_fabricato text;

comment on column cierres_caja_semanas.resumen_ia_las_americas is
  'Resumen de la IA (procesar-cierre-semana-ia) solo de los hallazgos de Las Américas.';
comment on column cierres_caja_semanas.resumen_ia_fabricato is
  'Resumen de la IA (procesar-cierre-semana-ia) solo de los hallazgos de Fabricato.';
