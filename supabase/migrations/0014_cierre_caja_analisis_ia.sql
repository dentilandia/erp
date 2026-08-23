-- Resultado del análisis automático (Claude) de los documentos de un día de
-- Cierre de Caja: totales que la IA leyó de cada documento y cómo se comparan
-- contra lo facturado por el ERP. Es solo una sugerencia para quien hace el
-- cierre — "cuadra" lo sigue confirmando una persona a mano.
alter table cierres_caja add column if not exists analisis_ia jsonb;
