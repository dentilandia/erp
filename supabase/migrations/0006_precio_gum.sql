-- Precio fijo de GUM (concepto administrativo), para que Recepción no tenga que
-- teclearlo cada vez y quede editable desde Parámetros como los demás precios.
insert into precios_config (clave, valor) values ('gum', 26000)
on conflict (clave) do nothing;
