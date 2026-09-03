-- Igual que administración le entrega formalmente a una sede desde la
-- bodega administrativa, ahora operación puede registrar formalmente una
-- "salida" de SU PROPIA bodega (hacia consultorio/uso clínico) — con fecha,
-- ítem, cantidad y motivo opcional, en vez de solo los campos generales
-- Entrega 1/Entrega 2. Se suma a un nuevo campo "salidas" del período
-- (separado, no se mezcla con entrega1/entrega2 que siguen existiendo
-- igual que antes).

alter table insumos_generales_movimientos add column salidas integer not null default 0;

create table insumos_generales_salidas (
  id uuid primary key default gen_random_uuid(),
  sede_id uuid not null references sedes(id),
  periodo_id uuid not null references insumos_generales_periodos(id),
  catalogo_id uuid not null references insumos_generales_catalogo(id),
  cantidad integer not null check (cantidad > 0),
  fecha date not null default current_date,
  motivo text,
  created_by uuid references perfiles(id),
  created_at timestamptz not null default now()
);
create index idx_insumos_generales_salidas_sede on insumos_generales_salidas (sede_id, fecha desc);
create index idx_insumos_generales_salidas_periodo on insumos_generales_salidas (periodo_id);

create or replace function fn_salida_insumos_generales()
returns trigger language plpgsql as $$
begin
  update insumos_generales_movimientos
    set salidas = salidas + new.cantidad, updated_at = now()
    where periodo_id = new.periodo_id and catalogo_id = new.catalogo_id;
  if not found then
    insert into insumos_generales_movimientos (periodo_id, catalogo_id, salidas)
      values (new.periodo_id, new.catalogo_id, new.cantidad);
  end if;
  return new;
end;
$$;

create trigger trg_salida_insumos_generales
  after insert on insumos_generales_salidas
  for each row execute function fn_salida_insumos_generales();

alter table insumos_generales_salidas enable row level security;

-- A diferencia de la bodega administrativa (solo admin), acá sí puede
-- registrar operación de su propia sede — es su bodega.
create policy insumos_gen_salidas_select on insumos_generales_salidas for select using (
  fn_es_admin() or sede_id = fn_perfil_sede()
);
create policy insumos_gen_salidas_insert on insumos_generales_salidas for insert with check (
  fn_es_admin() or sede_id = fn_perfil_sede()
);
