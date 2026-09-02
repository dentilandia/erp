-- El botón de tracción pasa de ser una entrega gratuita (solo para llevar el
-- inventario) a cobrarse al paciente, igual que RX: se registra desde
-- Consultorio con un cargo "concepto_administrativo" (no resta de la
-- liquidación de honorarios de la doctora, igual que GUM/Caja aparato/Llave
-- de aparato/RX). Valor pedido: $23.000, editable después desde Parámetros.
insert into precios_config (clave, valor) values
  ('boton_traccion', 23000)
on conflict (clave) do nothing;
