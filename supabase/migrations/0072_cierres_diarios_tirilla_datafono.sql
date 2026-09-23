-- Igual que "Día consignado" (consignado/comprobante_url/fecha_consignacion),
-- pero para la tirilla física que imprime el datáfono al cierre del día —
-- Recepción la adjunta y marca el día, con el mismo requisito de adjuntar
-- el archivo antes de poder marcarlo.
alter table cierres_diarios add column tirilla_datafono boolean not null default false;
alter table cierres_diarios add column tirilla_datafono_url text;
alter table cierres_diarios add column fecha_tirilla_datafono date;
