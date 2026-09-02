-- Caja menor por sede: fondo fijo mensual, con lista de gastos con soporte
-- (factura/recibo). Acceso restringido: además de admin, solo la persona
-- marcada como responsable de caja menor en su sede puede verla/editarla —
-- no es para todo el equipo de operación, a diferencia del resto del ERP.

alter table perfiles add column if not exists puede_caja_menor boolean not null default false;

create table caja_menor_periodos (
  id uuid primary key default gen_random_uuid(),
  sede_id uuid not null references sedes(id),
  mes date not null, -- primer día del mes que cubre
  monto_asignado numeric(12,2) not null default 500000,
  reembolsado boolean not null default false,
  fecha_reembolso date,
  created_at timestamptz not null default now(),
  unique (sede_id, mes)
);

create table caja_menor_movimientos (
  id uuid primary key default gen_random_uuid(),
  periodo_id uuid not null references caja_menor_periodos(id) on delete cascade,
  fecha date not null default current_date,
  factura_numero text,
  nit_cedula text,
  pagado_a text not null,
  concepto text not null,
  valor_factura numeric(12,2) not null default 0,
  iva numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

create or replace function fn_puede_caja_menor()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select puede_caja_menor from perfiles where id = auth.uid()), false);
$$;

alter table caja_menor_periodos enable row level security;
alter table caja_menor_movimientos enable row level security;

create policy caja_menor_periodos_select on caja_menor_periodos for select using (
  fn_es_admin() or (fn_puede_caja_menor() and sede_id = fn_perfil_sede())
);
create policy caja_menor_periodos_insert on caja_menor_periodos for insert with check (
  fn_es_admin() or (fn_puede_caja_menor() and sede_id = fn_perfil_sede())
);
create policy caja_menor_periodos_update on caja_menor_periodos for update using (
  fn_es_admin() or (fn_puede_caja_menor() and sede_id = fn_perfil_sede())
);

create policy caja_menor_movimientos_select on caja_menor_movimientos for select using (
  fn_es_admin() or (fn_puede_caja_menor() and exists (select 1 from caja_menor_periodos pe where pe.id = periodo_id and pe.sede_id = fn_perfil_sede()))
);
create policy caja_menor_movimientos_insert on caja_menor_movimientos for insert with check (
  fn_es_admin() or (fn_puede_caja_menor() and exists (select 1 from caja_menor_periodos pe where pe.id = periodo_id and pe.sede_id = fn_perfil_sede()))
);
create policy caja_menor_movimientos_update on caja_menor_movimientos for update using (
  fn_es_admin() or (fn_puede_caja_menor() and exists (select 1 from caja_menor_periodos pe where pe.id = periodo_id and pe.sede_id = fn_perfil_sede()))
);
create policy caja_menor_movimientos_delete on caja_menor_movimientos for delete using (
  fn_es_admin() or (fn_puede_caja_menor() and exists (select 1 from caja_menor_periodos pe where pe.id = periodo_id and pe.sede_id = fn_perfil_sede()))
);
