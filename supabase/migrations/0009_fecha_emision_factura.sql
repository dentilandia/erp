-- Fecha de emisión de la factura del laboratorio (distinta de fecha_recibido,
-- que es cuando llegó el aparato a la clínica).
alter table lab_ordenes add column if not exists fecha_emision_factura date;
