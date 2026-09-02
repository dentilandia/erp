-- Para filtrar el Cierre Diario por quién hizo cada cobro (relevo de turno
-- entre recepcionistas de la misma sede) — antes ningún pago quedaba
-- asociado a una persona específica, solo a la doctora/sede.
alter table visitas add column if not exists cobrado_por uuid references perfiles(id);
alter table saldos_favor add column if not exists registrado_por uuid references perfiles(id);

-- El filtro por cajera necesita poder mostrar el nombre de los compañeros de
-- la misma sede (no solo el propio) — perfiles_select_propio solo deja ver
-- la fila de uno mismo o, si es admin, todas. Esta policy se suma (OR) para
-- que cualquier operación vea nombre/rol de quienes comparten su sede.
create policy perfiles_select_misma_sede on perfiles
  for select using (sede_id = fn_perfil_sede());
