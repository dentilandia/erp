-- "Llave de aparato" ya existía como concepto facturable (precios, cargos)
-- pero no se podía rastrear como insumo físico en inventario_stock/
-- inventario_movimientos: el check constraint original solo permitía los 4
-- tipos con los que se creó la tabla (0024_inventario_insumos.sql).

alter table inventario_stock drop constraint inventario_stock_tipo_check;
alter table inventario_stock add constraint inventario_stock_tipo_check
  check (tipo in ('mascara_facial','elasticos_intraoral','gum','boton_traccion','llave_aparato'));

alter table inventario_movimientos drop constraint inventario_movimientos_tipo_check;
alter table inventario_movimientos add constraint inventario_movimientos_tipo_check
  check (tipo in ('mascara_facial','elasticos_intraoral','gum','boton_traccion','llave_aparato'));
