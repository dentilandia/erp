-- Soportes documentales por día de cierre de caja (Cierre de Caja, no Cierre diario).
alter table cierres_caja add column if not exists url_recibos_caja text;
alter table cierres_caja add column if not exists url_movimientos_banco text;
alter table cierres_caja add column if not exists url_tirilla_datafono text;
alter table cierres_caja add column if not exists url_reporte_datafono text;
