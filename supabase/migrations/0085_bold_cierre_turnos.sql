-- Guarda, por día y sede, los "cierres de turno" que Bold manda por correo
-- (no-responder@bold.co, asunto "¡Tienes un nuevo cierre de ventas!") — un
-- día puede traer varios turnos. Se llena automático desde Gmail (sin subir
-- nada a mano) y reemplaza, para Fabricato, la lectura por IA de un documento
-- semanal de datáfono: acá el valor ya viene exacto en el cuerpo del correo.
alter table cierres_diarios
  add column if not exists bold_cierre_turnos jsonb not null default '[]'::jsonb;

comment on column cierres_diarios.bold_cierre_turnos is
  'Array de turnos Bold de ese día: [{"email_id","desde","hasta","valor","ventas_exitosas","anulaciones"}, ...]. Se arma automático leyendo Gmail, no se sube a mano.';
