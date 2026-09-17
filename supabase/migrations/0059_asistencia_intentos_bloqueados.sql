-- Queda registro de cada intento de marcar asistencia rechazado por no
-- estar en la red de la sede — para que la parte administrativa pueda ver
-- quién intentó marcar desde fuera del consultorio. Solo el edge function
-- (rol de servicio) escribe acá.
create table asistencia_intentos_bloqueados (
  id uuid primary key default gen_random_uuid(),
  perfil_id uuid not null references perfiles(id),
  tipo text not null,
  ip text,
  creado_en timestamptz not null default now()
);
create index idx_asistencia_intentos_bloqueados_perfil on asistencia_intentos_bloqueados (perfil_id, creado_en desc);

alter table asistencia_intentos_bloqueados enable row level security;

create policy asistencia_intentos_bloqueados_select on asistencia_intentos_bloqueados for select using (fn_es_admin());
