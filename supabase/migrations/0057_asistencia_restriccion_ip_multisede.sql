-- Sirley puede trabajar cualquier día en cualquiera de las dos sedes, así
-- que no le sirve quedar fija a un solo sede_id para la restricción de IP
-- (eso la bloquearía el día que esté en la otra). Se agrega un flag aparte
-- que dice "esta persona debe marcar desde la red de alguna sede" sin atarla
-- a una en particular — el edge function revisa contra todas y usa la que
-- coincida como sede_id de esa marca.
alter table perfiles add column restriccion_ip boolean not null default false;

update perfiles set sede_id = null, restriccion_ip = true
where id = '4f2ab421-a05c-4c06-987c-d4a8a5eb90f0';
