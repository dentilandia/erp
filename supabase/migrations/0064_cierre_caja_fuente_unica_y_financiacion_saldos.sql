-- El cierre diario de Recepción pasa a ser la fuente oficial de los totales
-- por medio de pago para el Cierre de Caja de admin, en vez de que cada
-- pantalla recalcule por su lado desde cargo_pagos/saldos_favor (lo que
-- podía divergir, ej. el gasto del día no se restaba en Cierre de Caja).
alter table cierres_diarios add column totales_por_medio jsonb not null default '{}'::jsonb;

-- Los pagos Addi/Sistecrédito registrados como saldo a favor (anticipos sin
-- cargo todavía, ej. sedación pagada por teléfono) no aparecían en
-- Financiación porque esas pantallas solo miraban cargo_pagos — se les da el
-- mismo seguimiento (comprobante + marcado de pagado) que a los de cargo_pagos.
alter table saldos_favor add column financiacion_pagado boolean;
alter table saldos_favor add column financiacion_fecha_pago date;
alter table saldos_favor add column comprobante_financiacion_url text;
