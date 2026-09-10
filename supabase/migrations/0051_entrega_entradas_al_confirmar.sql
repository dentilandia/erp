-- Antes, "Entradas" del período de la sede se sumaba apenas administración
-- registraba la entrega (insert en insumos_generales_entregas), sin esperar
-- a que la sede confirmara que de verdad la recibió. Ahora se separa en dos
-- pasos: al entregar solo se resta de la bodega administrativa; "Entradas"
-- se suma únicamente cuando la sede marca la entrega como vista/recibida
-- (visto pasa de false a true) — eso ya lo hace el botón "Entendido" del
-- aviso en InsumosGeneralesPeriodo, que ahora además dispara este trigger.
create or replace function fn_bodega_admin_desde_entrega()
returns trigger
language plpgsql
as $function$
begin
  perform fn_bodega_admin_ajustar(new.sede_id, new.catalogo_id, -new.cantidad);
  return new;
end;
$function$;

create or replace function fn_bodega_entrega_confirmada()
returns trigger
language plpgsql
as $function$
begin
  if old.visto = false and new.visto = true then
    update insumos_generales_movimientos
      set entradas = entradas + new.cantidad, updated_at = now()
      where periodo_id = new.periodo_id and catalogo_id = new.catalogo_id;
    if not found then
      insert into insumos_generales_movimientos (periodo_id, catalogo_id, entradas)
        values (new.periodo_id, new.catalogo_id, new.cantidad);
    end if;
  end if;
  return new;
end;
$function$;

create trigger trg_bodega_entrega_confirmada
  after update on insumos_generales_entregas
  for each row
  execute function fn_bodega_entrega_confirmada();
