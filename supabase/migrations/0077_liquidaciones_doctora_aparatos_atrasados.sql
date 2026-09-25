-- Total de aparatos de períodos anteriores incluidos en esta liquidación
-- (ver lab_ordenes.liquidado_atrasado_en) — se guarda aparte de
-- total_laboratorios para que quede su propio registro histórico.
alter table liquidaciones_doctora add column total_aparatos_atrasados numeric(12,2) not null default 0;
