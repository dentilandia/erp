-- Permite eliminar una visita desde Recepción (solo "en espera" / "por cobrar" en la UI;
-- las cobradas no se borran ahí, se corrigen reabriendo el cobro).
create policy visitas_delete on visitas
  for delete using (fn_es_admin() or sede_id = fn_perfil_sede());
