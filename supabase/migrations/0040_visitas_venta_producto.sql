-- Marca las visitas creadas al vuelo por "Registrar venta de producto" (llave/
-- caja de aparato, GUM vendidos sin cita) para poder mostrarlas separadas de
-- "Cobrados hoy" — no son un paciente atendido por la doctora seleccionada,
-- son solo el vehículo técnico que usa cargos/cargo_pagos (que exigen
-- visita_id) para que la venta cuente en Cierre diario.
alter table visitas add column es_venta_producto boolean not null default false;
