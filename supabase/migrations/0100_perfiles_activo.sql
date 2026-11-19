-- Permite desactivar un colaborador (ya no trabaja con nosotros) sin borrar
-- su historial: queda fuera de los selectores de "elegir colaborador" del
-- módulo de asistencia, pero su nombre sigue apareciendo donde ya quedó
-- registrado (cobros, auditoría, cierres, etc.).
alter table perfiles add column if not exists activo boolean not null default true;

update perfiles set activo = false where id = 'c1baae74-268f-4d5d-90a5-6c80e516838c';
