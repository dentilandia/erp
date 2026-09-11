-- Antes, el aviso de "llegaron entregas nuevas" solo tenía un botón que
-- confirmaba TODAS las líneas de una — ahora cada línea se confirma o se
-- reporta como no recibida por separado. reportado_no_recibido saca la
-- línea del aviso pendiente sin sumarla a "Entradas" (eso se maneja
-- administrativamente, por fuera del software, por ahora).
alter table insumos_generales_entregas add column reportado_no_recibido boolean not null default false;

-- Nota libre por período para que la sede pida algo puntual que no esté en
-- el catálogo, junto con el pedido normal de cada ítem.
alter table insumos_generales_periodos add column nota_pedido text;
