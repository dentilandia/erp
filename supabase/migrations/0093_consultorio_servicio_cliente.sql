-- Nuevos checks del formulario de Consultorio (sección "Servicio al cliente")
-- y de Recepción ("no agendó su próxima cita") — ver Consultorio.tsx y
-- Recepcion.tsx para dónde se leen/escriben.
alter table visitas
  add column if not exists se_entrego_presupuesto boolean not null default false,
  add column if not exists se_recomendo_sedacion boolean not null default false,
  add column if not exists es_primera_vez boolean not null default false,
  add column if not exists se_mando_radiografia boolean not null default false,
  add column if not exists no_agendo_proxima_cita boolean not null default false;
