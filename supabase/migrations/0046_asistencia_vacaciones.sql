-- Control de vacaciones: un día marcado como vacación no debe aparecer como
-- "déficit" en el reporte semanal de horas — la jornada ordinaria es de
-- 8:30am a 6:00pm con 1h de almuerzo (8.5h/día), así que cada día de
-- vacaciones le resta 8.5h a la meta semanal (42h) de esa semana.
create table asistencia_vacaciones (
  id uuid primary key default gen_random_uuid(),
  perfil_id uuid not null references perfiles(id),
  fecha date not null,
  nota text,
  created_by uuid references perfiles(id),
  created_at timestamptz not null default now(),
  unique (perfil_id, fecha)
);

alter table asistencia_vacaciones enable row level security;

create policy asistencia_vacaciones_select on asistencia_vacaciones for select using (fn_es_admin() or perfil_id = auth.uid());
create policy asistencia_vacaciones_write on asistencia_vacaciones for all using (fn_es_admin()) with check (fn_es_admin());
