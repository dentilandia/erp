-- Permite borrar una salida registrada por error (ej. ítem equivocado) —
-- antes no había ni policy ni forma de deshacerla desde el software. Al
-- borrar, el trigger descuenta esa cantidad del total acumulado en
-- insumos_generales_movimientos.salidas, simétrico al trigger de insert.
create policy insumos_gen_salidas_delete on insumos_generales_salidas
  for delete using (fn_es_admin() or sede_id = fn_perfil_sede());

create or replace function fn_salida_insumos_generales_eliminar()
returns trigger
language plpgsql
as $function$
begin
  update insumos_generales_movimientos
    set salidas = greatest(0, salidas - old.cantidad), updated_at = now()
    where periodo_id = old.periodo_id and catalogo_id = old.catalogo_id;
  return old;
end;
$function$;

create trigger trg_salida_insumos_generales_eliminar
  after delete on insumos_generales_salidas
  for each row
  execute function fn_salida_insumos_generales_eliminar();
