-- Aparatos instalados en un período de liquidación anterior que nunca se le
-- cobraron a la doctora en su momento (se descubren después). Se agregan a
-- un bloque aparte "Aparatos de períodos anteriores por liquidar" en la
-- liquidación del período ACTUAL de la doctora (Liquidaciones.tsx), sin
-- tocar mes_liquidacion/fecha_instalado (que quedan como la fecha real de
-- instalación). liquidado_atrasado_en se llena con el fin del período en el
-- que se guardó esa liquidación — null significa que sigue pendiente. Ese
-- mismo campo hace que, ese mismo período, también le aparezca a
-- Ruby/Ortokit como una factura normal por pagar en LiquidacionLaboratorios.
alter table lab_ordenes add column liquidado_atrasado_en date;
