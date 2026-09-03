-- Tercera vez con el mismo tipo de bug: a insumos_generales_bodega_admin
-- también le faltaba la policy de update. fn_bodega_admin_ajustar hace
-- "update ... set cantidad = cantidad + delta" dentro del trigger — sin
-- policy de update, esa actualización se queda en 0 filas afectadas sin
-- lanzar error (no es un insert, así que no truena, simplemente no hace
-- nada), por lo que la fila se creaba en 0 y nunca sumaba lo comprado.
create policy insumos_gen_bodega_admin_update on insumos_generales_bodega_admin for update using (fn_es_admin());
