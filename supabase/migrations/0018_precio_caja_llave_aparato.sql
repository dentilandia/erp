-- "Caja aparato" y "Llave de aparato" pasan a tener precio fijo configurable
-- desde Parámetros, igual que GUM y RX (suman al cierre de caja como
-- concepto administrativo, pero no a la liquidación de honorarios de la
-- doctora). Ajusta el valor real en Parámetros después de correr esto.
insert into precios_config (clave, valor) values
  ('caja_aparato', 0),
  ('llave_aparato', 0)
on conflict (clave) do nothing;
