-- Faltaban las políticas de DELETE en varias tablas — los botones de eliminar
-- en la app fallaban en silencio porque RLS bloquea por defecto cualquier
-- operación sin una política explícita para ese comando. cargos, cargo_pagos
-- e insumos_consulta sí las tenían; estas tres se quedaron por fuera.
create policy lab_delete on lab_ordenes for delete using (fn_es_admin() or sede_id = fn_perfil_sede());
create policy visitas_delete on visitas for delete using (fn_es_admin() or sede_id = fn_perfil_sede());
-- saldos_favor sigue el mismo nivel de restricción que su política de update (solo admin).
create policy saldos_delete_admin on saldos_favor for delete using (fn_es_admin());
