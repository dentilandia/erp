-- Antes solo admin podía actualizar saldos_favor (saldos_update_admin), pero
-- cualquier cajera de operación necesita poder descontar valor_disponible al
-- aplicar un saldo a favor como medio de pago en un cobro. Sin esta policy
-- el update quedaba bloqueado por RLS sin dar error (0 filas afectadas, sin
-- excepción) — el mismo patrón de falla silenciosa ya visto antes en
-- visitas — así que el saldo se consumía en el pago pero nunca se
-- descontaba de la tabla.
create policy saldos_update_operacion on saldos_favor for update using (auth.uid() is not null) with check (auth.uid() is not null);
