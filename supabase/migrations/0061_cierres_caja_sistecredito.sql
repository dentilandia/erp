-- Agrega la columna sistecredito a cierres_caja: faltaba en el esquema pero
-- sí aparece como medio de pago en el dataset de cuadre reconciliado
-- (Dashboard_Cuadre_Dentilandia.html, 124 registros 30 jun - 14 sep 2026).
alter table cierres_caja add column if not exists sistecredito numeric;
