-- Porcentaje de honorario de doctora (Odontopediatra), configurable desde Parámetros
-- en vez de quedar hardcodeado, para que un cambio de política no requiera tocar código.
insert into precios_config (clave, valor) values ('porcentaje_honorario', 30)
on conflict (clave) do nothing;
