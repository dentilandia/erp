-- Cuando una doctora toma la impresión (envía a fabricar) y otra distinta
-- instala el aparato, el costo del laboratorio se reparte 50/50 entre las
-- dos (solo aplica a tipo_servicio='fabricacion'; en 'reparacion' el pago
-- completo pasa a quien instala, reasignando doctora_id directamente).
alter table lab_ordenes add column if not exists doctora_instala_id uuid references doctoras(id);
