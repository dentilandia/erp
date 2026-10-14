-- Bancolombia no es un solo extracto para ambas sedes: cada sede tiene su
-- propia cuenta. El campo existente url_bancolombia queda para Las Américas
-- (transferencias de pacientes + consignación de efectivo); se agrega un
-- campo nuevo para la cuenta de Fabricato, que solo sirve para confirmar la
-- consignación de efectivo (las transferencias/tarjeta de Fabricato van por
-- Bold, no por esta cuenta).
alter table cierres_caja_semanas
  add column if not exists url_bancolombia_fabricato text;

comment on column cierres_caja_semanas.url_bancolombia is
  'Movimientos Bancolombia de la cuenta de Las Américas — transferencias de pacientes y consignación de efectivo.';

comment on column cierres_caja_semanas.url_bancolombia_fabricato is
  'Movimientos Bancolombia de la cuenta de Fabricato — solo para confirmar la consignación de efectivo (las transferencias/tarjeta de Fabricato van por Bold, no por esta cuenta).';
