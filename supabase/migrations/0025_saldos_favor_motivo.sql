-- Para qué es el saldo a favor (anticipo/pago de sedación, reparación o
-- modificación de aparato, tratamiento odontológico) — antes solo quedaba en
-- notas de texto libre, ahora es una opción fija para que quede claro de un
-- vistazo qué originó cada saldo.
alter table saldos_favor add column if not exists motivo text;
