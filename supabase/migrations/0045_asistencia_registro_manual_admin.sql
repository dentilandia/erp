-- Permite a admin registrar/corregir asistencia de cualquier persona
-- directamente (para cargar retroactivo el mes, corregir una marca mal
-- puesta, etc.) — antes el único camino de insert era el edge function
-- marcar-asistencia, pensado para que cada quien marque la suya propia con
-- validación de IP en tiempo real, no para carga administrativa masiva.
create policy asistencia_registros_insert_admin on asistencia_registros for insert with check (fn_es_admin());
create policy asistencia_registros_delete_admin on asistencia_registros for delete using (fn_es_admin());

-- Nota libre por persona y día (ej. "entró a la 1pm en vez de las 9am,
-- autorizado") — no es una marca más, es contexto para explicar por qué las
-- horas de ese día no fueron las de siempre antes de que eso reste horas
-- sin explicación en el reporte.
create table asistencia_notas_dia (
  id uuid primary key default gen_random_uuid(),
  perfil_id uuid not null references perfiles(id),
  fecha date not null,
  nota text not null,
  created_by uuid references perfiles(id),
  updated_at timestamptz not null default now(),
  unique (perfil_id, fecha)
);

alter table asistencia_notas_dia enable row level security;

create policy asistencia_notas_select on asistencia_notas_dia for select using (fn_es_admin() or perfil_id = auth.uid());
create policy asistencia_notas_write on asistencia_notas_dia for all using (fn_es_admin()) with check (fn_es_admin());
