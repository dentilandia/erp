-- Solicitud de insumos: la sede pide insumos a la bodega administrativa
-- desde el software (en vez de avisar por fuera). Administración ve las
-- solicitudes pendientes y, al entregarlas, se usa el mecanismo ya
-- existente de insumos_generales_entregas (que resta de la bodega
-- administrativa y suma "Entradas" en el período de la sede) — esta tabla
-- solo lleva el hilo de la solicitud y queda marcada 'entregada' con el
-- id de la entrega que la resolvió.
create table insumos_generales_solicitudes (
  id uuid primary key default gen_random_uuid(),
  sede_id uuid not null references sedes(id),
  catalogo_id uuid not null references insumos_generales_catalogo(id),
  cantidad numeric not null,
  nota text,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'entregada')),
  entrega_id uuid references insumos_generales_entregas(id),
  created_by uuid references perfiles(id),
  created_at timestamptz not null default now(),
  entregada_en timestamptz
);

alter table insumos_generales_solicitudes enable row level security;

create policy insumos_gen_solicitudes_select on insumos_generales_solicitudes
  for select using (fn_es_admin() or sede_id = fn_perfil_sede());
create policy insumos_gen_solicitudes_insert on insumos_generales_solicitudes
  for insert with check (fn_es_admin() or sede_id = fn_perfil_sede());
-- Solo admin marca una solicitud como entregada — la sede no debe poder
-- cerrarla ella misma.
create policy insumos_gen_solicitudes_update on insumos_generales_solicitudes
  for update using (fn_es_admin()) with check (fn_es_admin());
