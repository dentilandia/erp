-- Corrección: la bodega administrativa NO es una sola central — cada sede
-- tiene la suya propia (Las Américas solo se entrega a sí misma, Fabricato
-- solo a sí misma). Se separan por sede_id, con vista consolidada (suma de
-- las dos) disponible desde la pantalla de Administración.
-- Ambas tablas siguen vacías (el módulo se acaba de crear), así que se
-- recrean limpias en vez de migrar datos.

drop trigger if exists trg_bodega_admin_movimiento on insumos_generales_bodega_admin_movimientos;
drop table if exists insumos_generales_bodega_admin_movimientos;
drop table if exists insumos_generales_bodega_admin;
drop function if exists fn_bodega_admin_asegurar_fila(uuid);
drop function if exists fn_bodega_admin_ajustar(uuid, integer);

create table insumos_generales_bodega_admin (
  id uuid primary key default gen_random_uuid(),
  sede_id uuid not null references sedes(id),
  catalogo_id uuid not null references insumos_generales_catalogo(id),
  cantidad integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (sede_id, catalogo_id)
);

create table insumos_generales_bodega_admin_movimientos (
  id uuid primary key default gen_random_uuid(),
  sede_id uuid not null references sedes(id),
  catalogo_id uuid not null references insumos_generales_catalogo(id),
  cantidad integer not null, -- positivo = compra/ingreso, negativo = ajuste manual hacia abajo
  motivo text,
  created_by uuid references perfiles(id),
  created_at timestamptz not null default now()
);

create or replace function fn_bodega_admin_asegurar_fila(p_sede uuid, p_catalogo uuid)
returns void language plpgsql as $$
begin
  insert into insumos_generales_bodega_admin (sede_id, catalogo_id) values (p_sede, p_catalogo)
  on conflict (sede_id, catalogo_id) do nothing;
end;
$$;

create or replace function fn_bodega_admin_ajustar(p_sede uuid, p_catalogo uuid, p_delta integer)
returns void language plpgsql as $$
begin
  perform fn_bodega_admin_asegurar_fila(p_sede, p_catalogo);
  update insumos_generales_bodega_admin
    set cantidad = cantidad + p_delta, updated_at = now()
    where sede_id = p_sede and catalogo_id = p_catalogo;
end;
$$;

create or replace function fn_bodega_admin_desde_movimiento()
returns trigger language plpgsql as $$
begin
  perform fn_bodega_admin_ajustar(new.sede_id, new.catalogo_id, new.cantidad);
  return new;
end;
$$;

create trigger trg_bodega_admin_movimiento
  after insert on insumos_generales_bodega_admin_movimientos
  for each row execute function fn_bodega_admin_desde_movimiento();

-- La entrega ya tenía sede_id (la sede destino) — ahora también identifica
-- de cuál bodega administrativa sale, porque cada sede solo se entrega a sí
-- misma (no existe cruce entre Las Américas y Fabricato).
create or replace function fn_bodega_admin_desde_entrega()
returns trigger language plpgsql as $$
begin
  perform fn_bodega_admin_ajustar(new.sede_id, new.catalogo_id, -new.cantidad);
  update insumos_generales_movimientos
    set entradas = entradas + new.cantidad, updated_at = now()
    where periodo_id = new.periodo_id and catalogo_id = new.catalogo_id;
  if not found then
    insert into insumos_generales_movimientos (periodo_id, catalogo_id, entradas)
      values (new.periodo_id, new.catalogo_id, new.cantidad);
  end if;
  return new;
end;
$$;

alter table insumos_generales_bodega_admin enable row level security;
alter table insumos_generales_bodega_admin_movimientos enable row level security;

-- Igual que el resto del sistema: cada sede ve (y admin) solo lo suyo.
create policy insumos_gen_bodega_admin_select on insumos_generales_bodega_admin for select using (
  fn_es_admin() or sede_id = fn_perfil_sede()
);
create policy insumos_gen_bodega_admin_movs_select on insumos_generales_bodega_admin_movimientos for select using (
  fn_es_admin() or sede_id = fn_perfil_sede()
);
create policy insumos_gen_bodega_admin_movs_insert on insumos_generales_bodega_admin_movimientos for insert with check (fn_es_admin());
