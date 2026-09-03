-- El "Gasto del día" en Cierre Diario era solo un número, sin decir a qué
-- correspondía — se agrega un campo de texto para anotar el concepto.
alter table cierres_diarios add column gasto_concepto text;
