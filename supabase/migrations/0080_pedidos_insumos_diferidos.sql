-- Cuando administración entrega menos de lo pedido y ya NO va a completar el
-- resto en esta misma vuelta (se cubre en el próximo pedido de bodega), antes
-- ese resto se quedaba indefinidamente en la columna "Pedido" sin que la sede
-- supiera por qué seguía ahí. Esta tabla deja un aviso explícito — mismo
-- patrón que insumos_generales_entregas: admin crea la fila, la sede la ve y
-- la marca "Entendido" (visto) para que desaparezca.
create table insumos_generales_pedidos_diferidos (
  id uuid primary key default gen_random_uuid(),
  periodo_id uuid not null references insumos_generales_periodos(id),
  sede_id uuid not null references sedes(id),
  catalogo_id uuid not null references insumos_generales_catalogo(id),
  cantidad integer not null check (cantidad > 0),
  fecha date not null default current_date,
  created_by uuid references perfiles(id),
  created_at timestamptz not null default now(),
  visto boolean not null default false
);
create index idx_insumos_generales_pedidos_diferidos_sede on insumos_generales_pedidos_diferidos (sede_id, visto);

alter table insumos_generales_pedidos_diferidos enable row level security;

create policy insumos_gen_pedidos_diferidos_select on insumos_generales_pedidos_diferidos for select using (
  fn_es_admin() or sede_id = fn_perfil_sede()
);
create policy insumos_gen_pedidos_diferidos_insert on insumos_generales_pedidos_diferidos for insert with check (fn_es_admin());
create policy insumos_gen_pedidos_diferidos_update on insumos_generales_pedidos_diferidos for update using (
  fn_es_admin() or sede_id = fn_perfil_sede()
);
