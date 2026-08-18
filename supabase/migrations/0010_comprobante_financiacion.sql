-- Comprobante de pago de Addi/Sistecrédito (el certificado que imprime la
-- plataforma). Lo adjunta el personal de sede desde Operación Diaria;
-- Financiación (admin) lo revisa y marca pagado.
alter table cargo_pagos add column if not exists comprobante_financiacion_url text;
