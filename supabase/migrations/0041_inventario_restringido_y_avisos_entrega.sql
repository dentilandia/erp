-- El módulo de Inventario (operación) queda restringido a las auxiliares de
-- odontología, igual patrón que puede_caja_menor: admin siempre lo ve, el
-- resto de operación solo si tiene este flag marcado.
alter table perfiles add column puede_inventario boolean not null default false;

update perfiles set puede_inventario = true where nombre in (
  'Angie Mendez', 'Bertha Cabeza', 'Michelle Garcia', 'Maria Camila Hernandez'
);

-- Para poder avisarle a la sede que una entrega de la bodega administrativa
-- ya le llegó (y no solo que el número cambió calladamente en la tabla).
alter table insumos_generales_entregas add column visto boolean not null default false;

-- Faltaba policy de update — la sede necesita poder marcar "visto" en sus
-- propias entregas (admin también, por si acaso).
create policy insumos_gen_entregas_update on insumos_generales_entregas for update using (
  fn_es_admin() or sede_id = fn_perfil_sede()
);
