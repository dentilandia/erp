-- Nuevo paso intermedio en el flujo de laboratorio: antes solo existía
-- 'enviado' (pedido creado desde consultorio) -> 'recibido' (de vuelta en la
-- clínica) -> 'instalado'. Ahora 'enviado' es solo el pedido creado; cuando
-- alguien de la clínica lo lleva físicamente al laboratorio pasa a
-- 'entregado' — ahí es donde queda mientras el laboratorio lo tiene.
alter table lab_ordenes drop constraint lab_ordenes_estado_check;
alter table lab_ordenes add constraint lab_ordenes_estado_check
  check (estado in ('enviado', 'entregado', 'recibido', 'instalado'));

-- Fecha en la que la clínica entrega físicamente el aparato al laboratorio.
alter table lab_ordenes add column fecha_entrega_laboratorio date;

-- Fecha de la próxima cita del paciente — la clínica la debe dejar al marcar
-- la entrega, para que el laboratorio sepa la fecha límite real. Hoy solo se
-- pide/usa para el laboratorio de Ruby (ver perfiles.laboratorio_id abajo).
alter table lab_ordenes add column fecha_cita_paciente date;

-- Fecha en que el laboratorio recibió físicamente el aparato en sus
-- instalaciones — la llena el propio laboratorio (usuario externo abajo),
-- distinta de fecha_recibido (que es cuando vuelve a la clínica, confirmado
-- por el equipo interno, no por el laboratorio).
alter table lab_ordenes add column fecha_recepcion_laboratorio date;

-- Usuario externo de laboratorio: hoy solo Ruby. Entra al ERP pero
-- restringido a ver/editar solo las órdenes de SU laboratorio (de cualquier
-- sede) — no ve pacientes, caja, ni nada más del sistema.
alter table perfiles drop constraint perfiles_rol_check;
alter table perfiles add constraint perfiles_rol_check
  check (rol in ('operacion', 'admin', 'laboratorio'));
alter table perfiles add column laboratorio_id uuid references laboratorios(id);
alter table perfiles add constraint perfiles_laboratorio_requiere_lab
  check (rol <> 'laboratorio' or laboratorio_id is not null);

create or replace function fn_es_laboratorio()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select rol = 'laboratorio' from perfiles where id = auth.uid()), false);
$$;

create or replace function fn_mi_laboratorio_id()
returns uuid language sql stable security definer set search_path = public as $$
  select laboratorio_id from perfiles where id = auth.uid();
$$;

-- Se suman a las policies existentes (fn_es_admin() OR sede_id = fn_perfil_sede())
-- — Postgres combina varias policies permisivas del mismo comando con OR, así
-- que esto no le quita acceso a nadie más, solo le abre a Ruby sus propias
-- órdenes sin importar la sede.
create policy lab_ordenes_select_laboratorio on lab_ordenes for select using (
  fn_es_laboratorio() and laboratorio_id = fn_mi_laboratorio_id()
);
create policy lab_ordenes_update_laboratorio on lab_ordenes for update using (
  fn_es_laboratorio() and laboratorio_id = fn_mi_laboratorio_id()
) with check (
  fn_es_laboratorio() and laboratorio_id = fn_mi_laboratorio_id()
);
