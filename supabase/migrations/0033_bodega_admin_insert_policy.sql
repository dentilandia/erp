-- insumos_generales_bodega_admin se quedó sin policy de insert (igual bug
-- que ya se corrigió antes en inventario_stock): fn_bodega_admin_asegurar_fila
-- hace "insert ... on conflict do nothing" para crear la fila sede+ítem bajo
-- demanda, y esa comprobación de RLS se evalúa igual aunque el conflicto
-- termine sin hacer nada. Sin policy de insert, cualquier compra o entrega
-- fallaba con "new row violates row-level security policy".
create policy insumos_gen_bodega_admin_insert on insumos_generales_bodega_admin for insert with check (fn_es_admin());
