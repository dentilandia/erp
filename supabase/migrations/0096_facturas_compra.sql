-- Facturas de compra (cuentas por pagar) — espejo del "Control de Facturación 2026"
-- (Google Sheet). La hoja sigue siendo la fuente: el robot de Apps Script
-- (FacturasCompra.gs) envía todas las filas de las pestañas de mes a la Edge
-- Function sync-facturas-compra, que las reemplaza por pestaña con
-- fn_facturas_compra_reemplazar(). Nada se edita desde el ERP.

create table if not exists facturas_compra (
  id bigint generated always as identity primary key,
  pestana text not null,             -- "Noviembre 2026"
  fila int not null,                 -- fila en la pestaña (desde 3)
  mes date not null,                 -- primer día del mes de la pestaña
  proveedor text not null,
  numero text,
  ds text,                           -- documento soporte (cuentas de cobro)
  fecha date,
  vencimiento date,
  valor_antes_iva numeric(14,2) not null default 0,
  iva numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  rt_pct numeric(7,4),               -- null = retención pendiente de definir
  rt_valor numeric(14,2) not null default 0,
  ica numeric(14,2) not null default 0,
  nc numeric(14,2) not null default 0,
  valor_pagar numeric(14,2) not null default 0,
  pagado boolean not null default false,
  metodo_pago text,
  dca numeric(14,2) not null default 0,
  dpf numeric(14,2) not null default 0,
  gpf numeric(14,2) not null default 0,
  categoria text,
  observaciones text,
  origen text not null default 'manual' check (origen in ('manual', 'robot_dian', 'robot_cobro')),
  sincronizado_en timestamptz not null default now(),
  unique (pestana, fila)
);

create index if not exists facturas_compra_mes_idx on facturas_compra (mes);
create index if not exists facturas_compra_proveedor_idx on facturas_compra (proveedor);

alter table facturas_compra enable row level security;

-- Solo administración la ve. No hay policies de escritura: solo se escribe
-- desde la Edge Function (service_role) a través de la función de abajo.
create policy facturas_compra_select_admin on facturas_compra for select using (fn_es_admin());

-- Reemplaza, en una sola transacción, todas las filas de las pestañas recibidas.
-- Así una fila borrada o movida en la hoja también desaparece del ERP.
create or replace function fn_facturas_compra_reemplazar(p_pestanas text[], p_filas jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  delete from facturas_compra where pestana = any (p_pestanas);
  insert into facturas_compra (
    pestana, fila, mes, proveedor, numero, ds, fecha, vencimiento,
    valor_antes_iva, iva, total, rt_pct, rt_valor, ica, nc, valor_pagar,
    pagado, metodo_pago, dca, dpf, gpf, categoria, observaciones, origen
  )
  select
    f->>'pestana', (f->>'fila')::int, (f->>'mes')::date, f->>'proveedor',
    nullif(f->>'numero', ''), nullif(f->>'ds', ''),
    nullif(f->>'fecha', '')::date, nullif(f->>'vencimiento', '')::date,
    coalesce((f->>'valor_antes_iva')::numeric, 0), coalesce((f->>'iva')::numeric, 0),
    coalesce((f->>'total')::numeric, 0), (f->>'rt_pct')::numeric,
    coalesce((f->>'rt_valor')::numeric, 0), coalesce((f->>'ica')::numeric, 0),
    coalesce((f->>'nc')::numeric, 0), coalesce((f->>'valor_pagar')::numeric, 0),
    coalesce((f->>'pagado')::boolean, false), nullif(f->>'metodo_pago', ''),
    coalesce((f->>'dca')::numeric, 0), coalesce((f->>'dpf')::numeric, 0), coalesce((f->>'gpf')::numeric, 0),
    nullif(f->>'categoria', ''), nullif(f->>'observaciones', ''),
    coalesce(nullif(f->>'origen', ''), 'manual')
  from jsonb_array_elements(p_filas) f;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function fn_facturas_compra_reemplazar(text[], jsonb) from public, anon, authenticated;
grant execute on function fn_facturas_compra_reemplazar(text[], jsonb) to service_role;
