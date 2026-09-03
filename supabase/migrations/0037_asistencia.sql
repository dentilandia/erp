-- Control de asistencia: cada persona marca su llegada/salida desde su
-- propia cuenta, con foto (para verificar que es ella) y restringido a la IP
-- pública de su sede (para que no se pueda marcar desde la casa). La
-- comprobación de IP se hace en un edge function con el rol de servicio —
-- por eso esta tabla NO tiene policy de insert para usuarios normales, el
-- único camino para insertar es a través del edge function.

alter table sedes add column ip_permitida text;

create table asistencia_registros (
  id uuid primary key default gen_random_uuid(),
  perfil_id uuid not null references perfiles(id),
  sede_id uuid references sedes(id),
  tipo text not null check (tipo in ('llegada', 'salida')),
  foto_path text,
  ip text,
  marcado_en timestamptz not null default now()
);
create index idx_asistencia_registros_perfil on asistencia_registros (perfil_id, marcado_en desc);
create index idx_asistencia_registros_sede on asistencia_registros (sede_id, marcado_en desc);

alter table asistencia_registros enable row level security;

-- Cada quien ve sus propios registros; admin los ve todos. Sin policy de
-- insert/update/delete a propósito — solo el edge function (rol de
-- servicio, que no pasa por RLS) puede escribir acá.
create policy asistencia_select on asistencia_registros for select using (
  fn_es_admin() or perfil_id = auth.uid()
);

-- Bucket privado para las fotos de asistencia. Ruta: <perfil_id>/<archivo> —
-- cada quien solo puede subir/ver dentro de su propia carpeta; admin ve todas.
insert into storage.buckets (id, name, public)
values ('asistencia', 'asistencia', false)
on conflict (id) do nothing;

create policy asistencia_fotos_select on storage.objects
  for select using (
    bucket_id = 'asistencia'
    and (fn_es_admin() or (storage.foldername(name))[1] = auth.uid()::text)
  );

create policy asistencia_fotos_insert on storage.objects
  for insert with check (
    bucket_id = 'asistencia'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
