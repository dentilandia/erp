-- Inventario de insumos que se entregan a pacientes: máscara facial, elásticos
-- intraoral, GUM y botón de tracción. El stock baja solo cuando ya se registra
-- la entrega en el flujo que ya existe (insumos_consulta para máscara/
-- elásticos, un cargo de GUM) — no hay que llevar el conteo por fuera. Botón
-- de tracción no se rastreaba en ningún lado del sistema, así que se agrega
-- su propia tabla — a propósito NO se suma a insumos_consulta, porque esa
-- tabla sí resta de la liquidación de honorarios de la doctora y el botón no
-- debe afectarla.

create table inventario_stock (
  id uuid primary key default gen_random_uuid(),
  sede_id uuid not null references sedes(id),
  tipo text not null check (tipo in ('mascara_facial','elasticos_intraoral','gum','boton_traccion')),
  cantidad integer not null default 0,
  umbral_alerta integer not null default 5,
  updated_at timestamptz not null default now(),
  unique (sede_id, tipo)
);

create table entregas_boton (
  id uuid primary key default gen_random_uuid(),
  sede_id uuid not null references sedes(id),
  paciente_id uuid not null references pacientes(id),
  doctora_id uuid references doctoras(id),
  fecha date not null default current_date,
  con_cadeneta boolean not null default false,
  created_at timestamptz not null default now()
);

create table inventario_movimientos (
  id uuid primary key default gen_random_uuid(),
  sede_id uuid not null references sedes(id),
  tipo text not null check (tipo in ('mascara_facial','elasticos_intraoral','gum','boton_traccion')),
  cantidad integer not null, -- positivo = ingreso/reposición, negativo = ajuste manual hacia abajo (conteo físico)
  motivo text,
  created_at timestamptz not null default now()
);

-- Fila de stock por sede+tipo bajo demanda (evita tener que precrear las 8 filas a mano).
create or replace function fn_inventario_asegurar_fila(p_sede uuid, p_tipo text)
returns void language plpgsql as $$
begin
  insert into inventario_stock (sede_id, tipo) values (p_sede, p_tipo)
  on conflict (sede_id, tipo) do nothing;
end;
$$;

create or replace function fn_inventario_ajustar(p_sede uuid, p_tipo text, p_delta integer)
returns void language plpgsql as $$
begin
  perform fn_inventario_asegurar_fila(p_sede, p_tipo);
  update inventario_stock
    set cantidad = cantidad + p_delta, updated_at = now()
    where sede_id = p_sede and tipo = p_tipo;
end;
$$;

create or replace function fn_inventario_desde_insumo()
returns trigger language plpgsql as $$
begin
  if new.tipo in ('mascara_facial', 'elasticos_intraoral') then
    perform fn_inventario_ajustar(new.sede_id, new.tipo, -1);
  end if;
  return new;
end;
$$;

create trigger trg_inventario_insumo
  after insert on insumos_consulta
  for each row execute function fn_inventario_desde_insumo();

create or replace function fn_inventario_desde_cargo_gum()
returns trigger language plpgsql as $$
begin
  if new.concepto = 'GUM' then
    perform fn_inventario_ajustar(new.sede_id, 'gum', -1);
  end if;
  return new;
end;
$$;

create trigger trg_inventario_gum
  after insert on cargos
  for each row execute function fn_inventario_desde_cargo_gum();

create or replace function fn_inventario_desde_boton()
returns trigger language plpgsql as $$
begin
  perform fn_inventario_ajustar(new.sede_id, 'boton_traccion', -1);
  return new;
end;
$$;

create trigger trg_inventario_boton
  after insert on entregas_boton
  for each row execute function fn_inventario_desde_boton();

create or replace function fn_inventario_desde_movimiento()
returns trigger language plpgsql as $$
begin
  perform fn_inventario_ajustar(new.sede_id, new.tipo, new.cantidad);
  return new;
end;
$$;

create trigger trg_inventario_movimiento
  after insert on inventario_movimientos
  for each row execute function fn_inventario_desde_movimiento();

-- Umbrales de alerta por defecto pedidos: máscara 2, GUM 5, elásticos 5. Botón
-- sin umbral pedido explícito — queda en 5 por defecto, editable desde la pantalla.
insert into inventario_stock (sede_id, tipo, umbral_alerta)
select s.id, t.tipo, t.umbral
from sedes s
cross join (values
  ('mascara_facial', 2),
  ('elasticos_intraoral', 5),
  ('gum', 5),
  ('boton_traccion', 5)
) as t(tipo, umbral)
on conflict (sede_id, tipo) do nothing;

alter table inventario_stock enable row level security;
alter table entregas_boton enable row level security;
alter table inventario_movimientos enable row level security;

create policy inventario_stock_select on inventario_stock for select using (fn_es_admin() or sede_id = fn_perfil_sede());
create policy inventario_stock_update on inventario_stock for update using (fn_es_admin() or sede_id = fn_perfil_sede());

create policy entregas_boton_select on entregas_boton for select using (fn_es_admin() or sede_id = fn_perfil_sede());
create policy entregas_boton_insert on entregas_boton for insert with check (fn_es_admin() or sede_id = fn_perfil_sede());
create policy entregas_boton_delete on entregas_boton for delete using (fn_es_admin() or sede_id = fn_perfil_sede());

create policy inventario_movimientos_select on inventario_movimientos for select using (fn_es_admin() or sede_id = fn_perfil_sede());
create policy inventario_movimientos_insert on inventario_movimientos for insert with check (fn_es_admin() or sede_id = fn_perfil_sede());
