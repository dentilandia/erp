-- Interconsultas: a diferencia de "Remisión a otra especialidad" (una nota
-- simple en la visita), esto necesita seguimiento a lo largo del tiempo —
-- la respuesta del especialista suele llegar días o semanas después, y hay
-- que registrar si la doctora ya hizo la evolución en el sistema y si la
-- interconsulta quedó cerrada. Se administra desde Recepción.
create table interconsultas (
  id uuid primary key default gen_random_uuid(),
  visita_id uuid references visitas(id),
  sede_id uuid not null references sedes(id),
  paciente_id uuid not null references pacientes(id),
  doctora_id uuid not null references doctoras(id),
  especialidad text not null,
  fecha date not null default current_date,
  respuesta text,
  evolucion_doctora boolean not null default false,
  fin_interconsulta boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_interconsultas_sede on interconsultas (sede_id, fin_interconsulta);

alter table interconsultas enable row level security;
create policy interconsultas_select on interconsultas for select using (fn_es_admin() or sede_id = fn_perfil_sede());
create policy interconsultas_insert on interconsultas for insert with check (fn_es_admin() or sede_id = fn_perfil_sede());
create policy interconsultas_update on interconsultas for update using (fn_es_admin() or sede_id = fn_perfil_sede());
