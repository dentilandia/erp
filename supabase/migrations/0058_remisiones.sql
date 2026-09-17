-- Remisiones a otra especialidad — mismo patrón que interconsultas: se crea
-- desde Consultorio cuando se marca "remisión a especialidad" y Recepción
-- la administra hasta que se cierra (antes remision_especialidad solo era
-- un texto suelto en visitas, sin ningún seguimiento ni forma de saber si
-- ya se resolvió).
create table remisiones (
  id uuid primary key default gen_random_uuid(),
  visita_id uuid references visitas(id),
  sede_id uuid not null references sedes(id),
  paciente_id uuid not null references pacientes(id),
  doctora_id uuid not null references doctoras(id),
  especialidad text not null,
  fecha date not null,
  respuesta text,
  cerrada boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table remisiones enable row level security;

create policy remisiones_insert on remisiones for insert with check (fn_es_admin() or sede_id = fn_perfil_sede());
create policy remisiones_select on remisiones for select using (fn_es_admin() or sede_id = fn_perfil_sede());
create policy remisiones_update on remisiones for update using (fn_es_admin() or sede_id = fn_perfil_sede());
