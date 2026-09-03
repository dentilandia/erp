-- Bodega administrativa central: además de la bodega operativa que ya
-- llevaba cada sede (insumos_generales_periodos/movimientos), ahora hay una
-- bodega central única donde llega lo que se compra, y desde ahí
-- administración le hace entregas formales a cada sede. Esa entrega (no
-- entrega1/entrega2, que siguen siendo el consumo interno que reporta la
-- propia sede) es la que queda como histórico real de "bodega administrativa
-- → sede", y además alimenta automáticamente el campo "entradas" del
-- período activo de esa sede.

create table insumos_generales_bodega_admin (
  id uuid primary key default gen_random_uuid(),
  catalogo_id uuid not null unique references insumos_generales_catalogo(id),
  cantidad integer not null default 0,
  updated_at timestamptz not null default now()
);

create table insumos_generales_bodega_admin_movimientos (
  id uuid primary key default gen_random_uuid(),
  catalogo_id uuid not null references insumos_generales_catalogo(id),
  cantidad integer not null, -- positivo = compra/ingreso, negativo = ajuste manual hacia abajo
  motivo text,
  created_by uuid references perfiles(id),
  created_at timestamptz not null default now()
);

create table insumos_generales_entregas (
  id uuid primary key default gen_random_uuid(),
  catalogo_id uuid not null references insumos_generales_catalogo(id),
  sede_id uuid not null references sedes(id),
  periodo_id uuid not null references insumos_generales_periodos(id),
  cantidad integer not null check (cantidad > 0),
  fecha date not null default current_date,
  created_by uuid references perfiles(id),
  created_at timestamptz not null default now()
);
create index idx_insumos_generales_entregas_sede on insumos_generales_entregas (sede_id, fecha desc);
create index idx_insumos_generales_entregas_periodo on insumos_generales_entregas (periodo_id);

-- Fila de stock bajo demanda, igual patrón que fn_inventario_asegurar_fila.
create or replace function fn_bodega_admin_asegurar_fila(p_catalogo uuid)
returns void language plpgsql as $$
begin
  insert into insumos_generales_bodega_admin (catalogo_id) values (p_catalogo)
  on conflict (catalogo_id) do nothing;
end;
$$;

create or replace function fn_bodega_admin_ajustar(p_catalogo uuid, p_delta integer)
returns void language plpgsql as $$
begin
  perform fn_bodega_admin_asegurar_fila(p_catalogo);
  update insumos_generales_bodega_admin
    set cantidad = cantidad + p_delta, updated_at = now()
    where catalogo_id = p_catalogo;
end;
$$;

create or replace function fn_bodega_admin_desde_movimiento()
returns trigger language plpgsql as $$
begin
  perform fn_bodega_admin_ajustar(new.catalogo_id, new.cantidad);
  return new;
end;
$$;

create trigger trg_bodega_admin_movimiento
  after insert on insumos_generales_bodega_admin_movimientos
  for each row execute function fn_bodega_admin_desde_movimiento();

-- Al entregar de la bodega administrativa a una sede: resta de la bodega
-- admin y suma como "entradas" del período de esa sede (si el ítem se agregó
-- al catálogo después de abrir el período y no tiene fila todavía, la crea).
create or replace function fn_bodega_admin_desde_entrega()
returns trigger language plpgsql as $$
begin
  perform fn_bodega_admin_ajustar(new.catalogo_id, -new.cantidad);
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

create trigger trg_bodega_admin_entrega
  after insert on insumos_generales_entregas
  for each row execute function fn_bodega_admin_desde_entrega();

alter table insumos_generales_bodega_admin enable row level security;
alter table insumos_generales_bodega_admin_movimientos enable row level security;
alter table insumos_generales_entregas enable row level security;

-- La existencia de la bodega administrativa la puede ver cualquiera
-- autenticado (operación y administración) — solo admin la modifica.
create policy insumos_gen_bodega_admin_select on insumos_generales_bodega_admin for select using (auth.uid() is not null);
create policy insumos_gen_bodega_admin_movs_select on insumos_generales_bodega_admin_movimientos for select using (auth.uid() is not null);
create policy insumos_gen_bodega_admin_movs_insert on insumos_generales_bodega_admin_movimientos for insert with check (fn_es_admin());

-- Las entregas a una sede las ve esa sede (o admin), y solo admin las crea.
create policy insumos_gen_entregas_select on insumos_generales_entregas for select using (
  fn_es_admin() or sede_id = fn_perfil_sede()
);
create policy insumos_gen_entregas_insert on insumos_generales_entregas for insert with check (fn_es_admin());
