-- fn_es_sedacion() excluía del cruce de recibos (y de "Recibo no generado")
-- cualquier cobro cuyo concepto tuviera la palabra "sedación" EN CUALQUIER
-- PARTE del texto — pero muchos conceptos compuestos la mencionan solo como
-- contexto de la cita ("OPERATORIA 1 HORA SEDACION INTRAVENOSA, TIENE
-- 350SF", "ENDODONCIA CON SEDACION", "GUIA DE ERUPCION ... SEDACION OXIDO
-- NITROSO ...") sin ser en sí un cobro de sedación — esos cobros quedaban
-- EXCLUIDOS PARA SIEMPRE del cruce con su recibo, aunque el recibo exacto
-- existiera, saliendo como "Recibo sin pago en ERP" sin solución posible.
-- Ahora solo se excluyen los dos conceptos administrativos reales de
-- sedación (ver CONCEPTOS_ADMINISTRATIVOS en el frontend), por coincidencia
-- exacta, no por contener la palabra.
create or replace function fn_es_sedacion(p_concepto text)
returns boolean
language sql
immutable
as $function$
  select coalesce(fn_normalizar_nombre(p_concepto) in ('sedacion intravenosa', 'sedacion oxido nitroso'), false)
$function$;
