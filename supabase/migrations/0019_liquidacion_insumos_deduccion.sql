-- Las odontopediatras no pagan el 100% de los laboratorios + insumos de
-- aparatología (elásticos intraoral, tracción extra oral, máscara facial) —
-- pagan el mismo % que su honorario (ej. 30%) de esa suma. Se guardan por
-- separado el total crudo de insumos y la deducción ya aplicada, para que
-- quede trazable cuánto se dedujo y de qué base.
alter table liquidaciones_doctora add column if not exists total_insumos numeric(12,2) not null default 0;
alter table liquidaciones_doctora add column if not exists deduccion_labs_insumos numeric(12,2) not null default 0;
