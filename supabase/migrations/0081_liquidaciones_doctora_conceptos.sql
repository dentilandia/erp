-- Ajustes administrativos libres a la liquidación de una doctora: montos
-- que Tomás necesita sumar a mano (ej. corregir que a una doctora le
-- faltaron días porque se le atribuyeron a otra por error en un período ya
-- cerrado — no se puede recalcular solo, hay que poder escribir el valor).
-- Se suman al subtotal antes de retenciones, igual de visibles que
-- laboratorios/insumos pero como un monto a favor en vez de una deducción.
create table liquidaciones_doctora_conceptos (
  id uuid primary key default gen_random_uuid(),
  doctora_id uuid not null references doctoras(id),
  periodo_inicio date not null,
  periodo_fin date not null,
  concepto text not null,
  valor numeric not null check (valor <> 0),
  created_by uuid references perfiles(id),
  created_at timestamptz not null default now()
);
create index idx_liq_doctora_conceptos_periodo on liquidaciones_doctora_conceptos (doctora_id, periodo_inicio, periodo_fin);

alter table liquidaciones_doctora_conceptos enable row level security;
create policy liq_doctora_conceptos_select on liquidaciones_doctora_conceptos for select using (fn_es_admin());
create policy liq_doctora_conceptos_insert on liquidaciones_doctora_conceptos for insert with check (fn_es_admin());
create policy liq_doctora_conceptos_delete on liquidaciones_doctora_conceptos for delete using (fn_es_admin());

alter table liquidaciones_doctora add column total_conceptos_administrativos numeric not null default 0;
