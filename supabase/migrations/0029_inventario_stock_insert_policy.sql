-- inventario_stock nunca tuvo policy de insert: fn_inventario_asegurar_fila
-- hace "insert ... on conflict do nothing" para crear la fila sede+tipo bajo
-- demanda, pero esa comprobación de RLS se evalúa igual aunque el conflicto
-- termine sin hacer nada. Sin policy de insert, cualquier registro de
-- máscara/elásticos/GUM/botón desde operación fallaba con "new row violates
-- row-level security policy for table inventario_stock" aunque la fila ya
-- existiera (quedaba sembrada desde la migración 0024, pero el insert
-- intentado se rechaza antes de llegar al on conflict).

create policy inventario_stock_insert on inventario_stock for insert with check (fn_es_admin() or sede_id = fn_perfil_sede());
