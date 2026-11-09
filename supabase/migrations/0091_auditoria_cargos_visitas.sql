-- Registro de auditoría: quién cambió qué, cuándo, y los valores antes/después
-- — para zanjar disputas como "yo sí guardé el valor correcto" vs "ese fue el
-- valor que vi" sin depender de la memoria de nadie. Guarda la fila completa
-- (antes y después) en vez de campo por campo: más simple y no hay que
-- mantener una lista de columnas a vigilar si el esquema cambia.
create table public.cambios_auditoria (
  id uuid primary key default gen_random_uuid(),
  tabla text not null,
  registro_id uuid not null,
  operacion text not null check (operacion in ('insert', 'update', 'delete')),
  valores_anteriores jsonb,
  valores_nuevos jsonb,
  usuario_id uuid,
  usuario_nombre text,
  created_at timestamptz not null default now()
);

create index cambios_auditoria_tabla_registro_idx on public.cambios_auditoria (tabla, registro_id, created_at);

alter table public.cambios_auditoria enable row level security;

-- Solo admin la puede leer (para resolver este tipo de casos) — nadie la
-- puede insertar/editar/borrar desde el cliente, solo el trigger de abajo
-- (corre con permisos de servicio, sin pasar por policies de insert).
create policy cambios_auditoria_select_admin on public.cambios_auditoria
  for select using (fn_es_admin());

create or replace function public.fn_registrar_cambio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario_id uuid := auth.uid();
  v_usuario_nombre text;
begin
  select nombre into v_usuario_nombre from perfiles where id = v_usuario_id;

  if tg_op = 'INSERT' then
    insert into cambios_auditoria (tabla, registro_id, operacion, valores_nuevos, usuario_id, usuario_nombre)
    values (tg_table_name, new.id, 'insert', to_jsonb(new), v_usuario_id, v_usuario_nombre);
    return new;
  elsif tg_op = 'UPDATE' then
    insert into cambios_auditoria (tabla, registro_id, operacion, valores_anteriores, valores_nuevos, usuario_id, usuario_nombre)
    values (tg_table_name, new.id, 'update', to_jsonb(old), to_jsonb(new), v_usuario_id, v_usuario_nombre);
    return new;
  elsif tg_op = 'DELETE' then
    insert into cambios_auditoria (tabla, registro_id, operacion, valores_anteriores, usuario_id, usuario_nombre)
    values (tg_table_name, old.id, 'delete', to_jsonb(old), v_usuario_id, v_usuario_nombre);
    return old;
  end if;
  return null;
end;
$$;

create trigger trg_auditoria_cargos
  after insert or update or delete on public.cargos
  for each row execute function public.fn_registrar_cambio();

create trigger trg_auditoria_cargo_pagos
  after insert or update or delete on public.cargo_pagos
  for each row execute function public.fn_registrar_cambio();

create trigger trg_auditoria_visitas
  after insert or update or delete on public.visitas
  for each row execute function public.fn_registrar_cambio();
