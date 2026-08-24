-- Nota libre para cosas que surgen después de la cita (ej. "no agendó cita",
-- "quedó pendiente de llamar"), distinta de "próxima cita" (que es para la
-- fecha/nota de agenda) y de "motivo_valor_cero".
alter table visitas add column if not exists observacion text;
