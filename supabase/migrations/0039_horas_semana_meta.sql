-- Meta de horas semanales para el reporte de horas trabajadas/horas extra de
-- Asistencia (jornada legal colombiana actual: 42 h/semana). Se guarda en
-- precios_config, la misma tabla clave/valor que ya se usa para otros
-- parámetros ajustables (gum, rx, etc.), para no crear una tabla nueva.
insert into precios_config (clave, valor) values ('horas_semana_meta', 42)
on conflict (clave) do nothing;
