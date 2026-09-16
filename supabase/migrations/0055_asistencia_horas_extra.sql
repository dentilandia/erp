-- Solicitudes de horas extra por atención de un paciente fuera de la
-- jornada normal (antes se avisaba por un grupo de WhatsApp aparte y no
-- quedaba nada registrado en el sistema). Cubre el ciclo completo: quién
-- atendió, con qué doctora y por qué se hizo tarde, y al cerrarla se carga
-- la hora de salida real de cada colaborador involucrado directamente en
-- asistencia_registros, para no tener que corregirla dos veces.
create table asistencia_horas_extra (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  doctora_id uuid references doctoras(id),
  paciente_nombre text not null,
  motivo text not null,
  hora_ingreso_consultorio time,
  estado text not null default 'abierta' check (estado in ('abierta', 'finalizada')),
  paciente_pago boolean,
  se_agendo_cita boolean,
  created_by uuid references perfiles(id),
  created_at timestamptz not null default now(),
  finalizada_en timestamptz
);
create index idx_asistencia_horas_extra_fecha on asistencia_horas_extra (fecha desc);

-- Un renglón por colaborador involucrado en la solicitud: cada quien tiene
-- su propia hora de salida (no siempre coincide) y sus propias tareas.
create table asistencia_horas_extra_colaboradores (
  id uuid primary key default gen_random_uuid(),
  solicitud_id uuid not null references asistencia_horas_extra(id) on delete cascade,
  perfil_id uuid not null references perfiles(id),
  hora_salida timestamptz,
  tareas_realizadas text,
  marca_registro_id uuid references asistencia_registros(id),
  unique (solicitud_id, perfil_id)
);

alter table asistencia_horas_extra enable row level security;
alter table asistencia_horas_extra_colaboradores enable row level security;

create policy asistencia_horas_extra_all on asistencia_horas_extra for all using (fn_es_admin()) with check (fn_es_admin());
create policy asistencia_horas_extra_colab_all on asistencia_horas_extra_colaboradores for all using (fn_es_admin()) with check (fn_es_admin());
