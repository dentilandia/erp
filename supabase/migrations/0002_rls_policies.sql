-- RLS: acceso por sede fija para 'operacion', libre para 'admin'.
-- anon no tiene ninguna policy (deny por defecto) — este sistema no tiene señalización pública.

alter table sedes enable row level security;
alter table doctoras enable row level security;
alter table pacientes enable row level security;
alter table laboratorios enable row level security;
alter table precios_config enable row level security;
alter table perfiles enable row level security;
alter table visitas enable row level security;
alter table cargos enable row level security;
alter table cargo_pagos enable row level security;
alter table saldos_favor enable row level security;
alter table insumos_consulta enable row level security;
alter table lab_ordenes enable row level security;
alter table cierres_diarios enable row level security;
alter table liquidaciones_doctora enable row level security;
alter table retenciones_historial enable row level security;

-- perfiles: cada usuario ve su propia fila; admin ve todas. Sin insert/update/delete
-- por RLS: los perfiles se crean desde el dashboard de Supabase (service_role), no self-serve.
create policy perfiles_select_propio on perfiles
  for select using (id = auth.uid() or fn_es_admin());

-- catálogos compartidos entre sedes (lectura abierta a cualquier usuario autenticado)
create policy sedes_select_todos on sedes for select using (auth.uid() is not null);
create policy sedes_update_admin on sedes for update using (fn_es_admin());

create policy doctoras_select_todos on doctoras for select using (auth.uid() is not null);
create policy doctoras_insert_admin on doctoras for insert with check (fn_es_admin());
create policy doctoras_update_admin on doctoras for update using (fn_es_admin());

create policy laboratorios_select_todos on laboratorios for select using (auth.uid() is not null);
create policy laboratorios_write_admin on laboratorios for all using (fn_es_admin()) with check (fn_es_admin());

create policy precios_select_todos on precios_config for select using (auth.uid() is not null);
create policy precios_write_admin on precios_config for all using (fn_es_admin()) with check (fn_es_admin());

-- pacientes: catálogo global — un paciente puede atenderse en cualquier sede
create policy pacientes_select_todos on pacientes for select using (auth.uid() is not null);
create policy pacientes_insert_todos on pacientes for insert with check (auth.uid() is not null);
create policy pacientes_update_todos on pacientes for update using (auth.uid() is not null);

-- Operación Diaria: sede fija para 'operacion', libre para 'admin'.
-- Nota: sede_id en cargos/cargo_pagos/insumos_consulta se fija por trigger ANTES de
-- que RLS evalúe la fila (Postgres corre BEFORE triggers antes del chequeo de WITH CHECK),
-- así que comparar sede_id = fn_perfil_sede() aquí ya usa el valor derivado de la visita real.
create policy visitas_select on visitas for select using (fn_es_admin() or sede_id = fn_perfil_sede());
create policy visitas_insert on visitas for insert with check (fn_es_admin() or sede_id = fn_perfil_sede());
create policy visitas_update on visitas for update using (fn_es_admin() or sede_id = fn_perfil_sede());

create policy cargos_select on cargos for select using (fn_es_admin() or sede_id = fn_perfil_sede());
create policy cargos_insert on cargos for insert with check (fn_es_admin() or sede_id = fn_perfil_sede());
create policy cargos_update on cargos for update using (fn_es_admin() or sede_id = fn_perfil_sede());
create policy cargos_delete on cargos for delete using (fn_es_admin() or sede_id = fn_perfil_sede());

create policy cargo_pagos_select on cargo_pagos for select using (fn_es_admin() or sede_id = fn_perfil_sede());
create policy cargo_pagos_insert on cargo_pagos for insert with check (fn_es_admin() or sede_id = fn_perfil_sede());
create policy cargo_pagos_update on cargo_pagos for update using (fn_es_admin() or sede_id = fn_perfil_sede());
create policy cargo_pagos_delete on cargo_pagos for delete using (fn_es_admin() or sede_id = fn_perfil_sede());

-- saldos_favor: lectura y creación cruzadas entre sedes (un saldo generado en una sede
-- se puede consumir en la otra); el descuento de valor_disponible en consumo normal
-- pasa por fn_cargo_pagos_ajustar_saldo() (SECURITY DEFINER), no por una policy de update.
create policy saldos_select_todos on saldos_favor for select using (auth.uid() is not null);
create policy saldos_insert on saldos_favor for insert with check (fn_es_admin() or sede_origen_id = fn_perfil_sede());
create policy saldos_update_admin on saldos_favor for update using (fn_es_admin());

create policy insumos_select on insumos_consulta for select using (fn_es_admin() or sede_id = fn_perfil_sede());
create policy insumos_insert on insumos_consulta for insert with check (fn_es_admin() or sede_id = fn_perfil_sede());
create policy insumos_update on insumos_consulta for update using (fn_es_admin() or sede_id = fn_perfil_sede());
create policy insumos_delete on insumos_consulta for delete using (fn_es_admin() or sede_id = fn_perfil_sede());

-- lab_ordenes: sede_id sí lo controla el cliente (visita_id es opcional, para poder
-- cargar facturas de laboratorio retrasadas sin una visita digital asociada), pero
-- WITH CHECK igual exige que coincida con la sede del perfil.
create policy lab_select on lab_ordenes for select using (fn_es_admin() or sede_id = fn_perfil_sede());
create policy lab_insert on lab_ordenes for insert with check (fn_es_admin() or sede_id = fn_perfil_sede());
create policy lab_update on lab_ordenes for update using (fn_es_admin() or sede_id = fn_perfil_sede());

create policy cierres_select on cierres_diarios for select using (fn_es_admin() or sede_id = fn_perfil_sede());
create policy cierres_insert on cierres_diarios for insert with check (fn_es_admin() or sede_id = fn_perfil_sede());
create policy cierres_update on cierres_diarios for update using (fn_es_admin() or sede_id = fn_perfil_sede());

-- Liquidaciones: solo admin. retenciones_historial además queda append-only
-- (sin policy de update/delete, ni siquiera para admin) por el requisito de
-- trazabilidad completa del traspaso.
create policy liquidaciones_admin on liquidaciones_doctora for all using (fn_es_admin()) with check (fn_es_admin());
create policy retenciones_select_admin on retenciones_historial for select using (fn_es_admin());
create policy retenciones_insert_admin on retenciones_historial for insert with check (fn_es_admin());
