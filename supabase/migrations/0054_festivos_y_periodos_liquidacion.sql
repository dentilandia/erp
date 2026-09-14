-- Festivos de Colombia: un día festivo entre semana no debe contar como
-- déficit en el reporte de horas, igual que un día de vacaciones — pero
-- aplica parejo a todo el mundo (no se marca persona por persona).
create table festivos_colombia (
  fecha date primary key,
  nombre text not null
);

alter table festivos_colombia enable row level security;

create policy festivos_select on festivos_colombia for select using (true);
create policy festivos_write on festivos_colombia for all using (fn_es_admin()) with check (fn_es_admin());

-- Períodos de liquidación: el ciclo real de pago no coincide con el mes
-- calendario (ej. 31 de agosto al 27 de septiembre). Además del reporte
-- por mes calendario, se puede armar el mismo reporte agrupado por estos
-- rangos de fecha personalizados.
create table periodos_liquidacion (
  id uuid primary key default gen_random_uuid(),
  etiqueta text not null,
  fecha_inicio date not null,
  fecha_fin date not null,
  created_by uuid references perfiles(id),
  created_at timestamptz not null default now(),
  constraint periodos_liquidacion_rango check (fecha_fin >= fecha_inicio)
);

alter table periodos_liquidacion enable row level security;

create policy periodos_liquidacion_select on periodos_liquidacion for select using (true);
create policy periodos_liquidacion_write on periodos_liquidacion for all using (fn_es_admin()) with check (fn_es_admin());
