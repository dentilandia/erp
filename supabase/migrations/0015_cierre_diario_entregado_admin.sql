-- Segunda forma de cerrar el efectivo del día en Cierre diario: entregado en
-- mano a la administración, sin necesidad de comprobante (a diferencia de
-- "Día consignado", que sí exige adjuntar el comprobante del banco).
alter table cierres_diarios add column if not exists entregado_admin boolean not null default false;
alter table cierres_diarios add column if not exists fecha_entrega_admin date;
