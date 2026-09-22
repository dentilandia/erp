-- Antes, al confirmar una entrega solo se podía aceptar la cantidad completa
-- que administración dijo haber enviado, o rechazarla del todo — no había
-- forma de decir "me entregaron 8 pero solo llegaron 4". Ahora quien recibe
-- puede corregir la cantidad real, y eso es lo que suma a "Entradas" (no lo
-- que administración registró que envió).
alter table insumos_generales_entregas add column cantidad_recibida integer;
-- Para que admin pueda descartar el aviso de diferencia una vez revisado,
-- igual que ya existe para "reportado_no_recibido".
alter table insumos_generales_entregas add column diferencia_vista boolean not null default false;

create or replace function fn_bodega_entrega_confirmada()
returns trigger
language plpgsql
as $$
begin
  if old.visto = false and new.visto = true then
    update insumos_generales_movimientos
      set entradas = entradas + coalesce(new.cantidad_recibida, new.cantidad), updated_at = now()
      where periodo_id = new.periodo_id and catalogo_id = new.catalogo_id;
    if not found then
      insert into insumos_generales_movimientos (periodo_id, catalogo_id, entradas)
        values (new.periodo_id, new.catalogo_id, coalesce(new.cantidad_recibida, new.cantidad));
    end if;
  end if;
  return new;
end;
$$;
