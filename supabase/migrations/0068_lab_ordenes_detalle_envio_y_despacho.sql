-- Qué se incluyó físicamente en el envío al laboratorio (aparato para
-- reparar, modelo superior, modelo inferior, registro de mordida) — se marca
-- desde consultorio al enviar, y Ruby lo necesita ver igual que en su
-- planilla de control actual.
alter table lab_ordenes add column incluye_aparato boolean not null default false;
alter table lab_ordenes add column incluye_modelo_superior boolean not null default false;
alter table lab_ordenes add column incluye_modelo_inferior boolean not null default false;
alter table lab_ordenes add column incluye_registro_mordida boolean not null default false;

-- Número de orden del laboratorio — se conoce al otro día (o en el
-- transcurso del día), no al momento de enviar, así que se completa después
-- por edición, no es obligatorio al crear.
alter table lab_ordenes add column numero_orden text;

-- Fecha en que Ruby despacha el aparato de vuelta a la clínica — distinta de
-- fecha_recibido (cuando la clínica confirma que ya lo tiene en mano). Antes
-- no existía ningún registro de cuándo lo mandó ella, solo de cuándo lo
-- recibió la clínica.
alter table lab_ordenes add column fecha_despacho_laboratorio date;
