-- La auxiliar necesita poder anotar la próxima cita en texto libre
-- ("en 3 semanas para ajuste", etc.) para que Recepción sepa qué agendar,
-- en vez de forzar una fecha exacta.
alter table visitas alter column proxima_cita type text;
