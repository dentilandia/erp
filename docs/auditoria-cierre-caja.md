# Auditoría y rediseño del módulo Cierre de caja — traspaso a Claude Code

Rama: `cierre-caja-auditoria` (sin publicar en producción). Fecha: 17 nov 2026.
Plan de pendientes operativos (para el equipo): https://claude.ai/artifact/4VAVaRykCTXijVD9E2P7yk

## 1. Qué estaba mal (hallazgos de la auditoría)

1. **No había conciliación transacción por transacción.** La IA (`procesar-cierre-semana-ia`) devolvía un total por día; los campos `errores`, `transfs` y `dups_elec` solo tenían datos del histórico importado. No se detectaban abonos sin identificar, transferencias sin abono ni recibos faltantes o duplicados.
2. **`cierres_caja.cuadra` tenía default `true`.** En Fabricato, 33 de 33 días estaban en "Cuadra" con la IA aprobando solo 10; había 32 días en "Cuadra" con la IA diciendo "revisar".
3. **El facturado de comparación no era confiable.** `cierres_diarios.totales_por_medio` es una foto que solo se guarda al abrir Cierre diario. Además, había una condición de carrera al cambiar la fecha (ej. el 4 oct de Fabricato guardó los totales del 4 nov). En el 20 % de los días procesados por IA, el facturado era distinto a los pagos reales.
4. **Los gastos se restaban de la columna vieja `cierres_diarios.gasto`** en vez de `cierres_diarios_gastos`.
5. **Los documentos se truncaban a 60.000 caracteres**, y los Excel de Oral Drive declaran `<dimension ref="A1:C1"/>`: SheetJS solo leía los encabezados. **La IA nunca vio los recibos de caja.**
6. **Faltaba la fuente de las llaves de Fabricato.** El reporte de transacciones Bold no trae las transferencias por llaves Bre-B; esas salen en el **extracto de cuenta Bold**. En octubre fueron 72 llaves por $14,04 M (todo el "faltante" de Fabricato).
7. **Períodos cruzados**: octubre completo y semanas de octubre se pisaban. El cron solo procesaba períodos que empiezan lunes.
8. **Sin trazabilidad** en `cierres_caja`, `cierres_diarios` ni pendientes. 670 pendientes estaban "resueltos en bloque" sin usuario.
9. Había un cierre diario con fecha futura (26 nov, Fabricato).

## 2. Qué hay en la rama (6 commits)

| Archivo | Cambio |
|---|---|
| `supabase/migrations/0098_cierre_caja_controles.sql` | `cuadra` default false; solo una persona confirma (si hay novedades, exige nota ≥ 10 caracteres); reapertura automática si cambia `resultado_hash`; triggers de auditoría (`fn_registrar_cambio` y `fn_registrar_cambio_llave` para llaves de texto); pendientes exigen solución escrita y marca `resuelto_en_bloque`; sin fechas futuras; sin períodos cruzados; cron corregido + `procesando_desde` |
| `supabase/migrations/0099_conciliacion_bancaria.sql` | Vistas `v_cierre_pagos_erp` y `v_cierre_facturado_vivo` (facturado en vivo + gastos de la tabla nueva); tablas `banco_movimientos`, `recibos_sistema`, `conciliacion_enlaces` y `cierre_fuentes_cargadas` (RLS admin, huella única); motor `fn_conciliar_cierre(desde, hasta)`; resultado por día `fn_actualizar_cierres_caja(desde, hasta)`; vistas de trabajo `v_conc_*` |
| `supabase/functions/procesar-cierre-semana-ia/parsers.ts` | Lectores sin IA: Bancolombia Excel mensual, Bancolombia CSV, reporte de transacciones Bold, extracto de cuenta Bold (CSV) y recibos Oral Drive. `filasDeHoja()` recalcula el rango real de la hoja. |
| `supabase/functions/procesar-cierre-semana-ia/index.ts` | Reescrito: carga líneas → la IA solo lee las tirillas Redeban (gran total) → `fn_conciliar_cierre` → `fn_actualizar_cierres_caja` → resumen sin IA. Archivos vacíos o con formato desconocido se reportan en `error_ia`. CSV se lee con `raw: true` (si no, "01/11/2026" se lee como 11 de enero). |
| `src/pages/operacion/CierreDiario.tsx` | Corrige la carrera: `cargadoPara = sede|fecha` y descarta respuestas viejas. |
| `src/pages/CierreCaja.tsx` | Pestaña **Conciliación bancaria** (listas + botón "Identificar" con nota); confirmar "Cuadra" con nota; "Recalcular este día" por RPC; alertas del cruce en los pendientes; los pendientes validan el error del trigger. |
| `src/lib/types.ts` | Tipos `ResultadoCierre` y `AlertaCierre` y campos nuevos de `CierreCaja`. |

Verificación hecha: `tsc -b` y `vite build` sin errores. SQL parseado con libpg_query. Una versión anterior de 0098+0099 se probó en producción dentro de una transacción revertida (78 días recalculados). La versión final de 0099 **no se ha ejecutado contra la base**: probarla primero en una rama de Supabase o en una transacción.

## 3. Reglas de negocio confirmadas por Tomás

- **Las Américas:** transferencias por QR Bancolombia, sucursal virtual y Nequi → cuenta 33188020149. Tarjeta por Redeban: el **gran total de la tirilla debe ser igual a la tarjeta del ERP de ese día**; si no, buscar la diferencia en transferencias o sobrante de efectivo, y si no aparece, es faltante. Redeban abona neto (≈3,67 %) el día hábil siguiente, por franquicia y lote. Efectivo → consignación por corresponsal a …0149.
- **Fabricato:** transferencias por llaves y QR a la **cuenta Bold** (extracto de cuenta Bold), aunque algunas llegan por QR a …0149. Tarjeta por datáfono Bold (correo de cierre por turno; liquidación neta "TRANSFERENCIA BOLD" al día siguiente, ≈2,8 %). Efectivo → corresponsal a 33100002157.
- **Sedación:** no lleva recibo en Oral Drive (la empresa de sedación factura a Dentilandia). Sí debe aparecer la plata.
- **Tolerancia de fechas:** el pago o recibo puede quedar 1–2 días antes o después del abono (novedad con el paciente; se factura al día siguiente).
- **Recibos hechos en la otra sede:** pasa cuando quien hace el recibo tiene abierta la otra sede en Oral Drive. Se cruzan igual y se listan aparte.
- **Hermanos:** el acudiente paga varios hijos en un solo QR o llave → agrupar por paciente y por apellidos. El "Responsable legal" del recibo suele ser el nombre del QR.
- **GUM** = portaseda (producto).
- **Traslados internos** (Dentilandia ↔ cuenta Bold, …2157 ↔ …0149): no son ingreso.
- Bold: el CSV de movimientos solo se descarga para el mes corriente; el extracto (PDF) llega mes vencido.

## 4. Noviembre (1–12): resultado del cruce manual

- **Efectivo:** completo en el banco. Hay errores de marca en Cierre diario de Las Américas: 6 y 7 nov sin marcar (se consignaron el 9); 9 nov marcado "entregado" pero consignado el 13; 10–12 nov con las dos marcas a la vez.
- **Tarjeta Las Américas:** tirillas del 3–6 nov verificadas. 4, 5 y 6 cuadran al peso. **3 nov: tirilla $1.683.000 vs ERP $1.773.000.** La diferencia es el "saldo a favor" de $90.000 de Juana María Aguirre: es el pago del **15 sep** registrado otra vez el 3 nov como tarjeta crédito (doble registro, no faltante). Del 7 al 11 nov cuadra contra los abonos Redeban. **12 nov: −$5.533**; revisar con la tirilla.
- **Tarjeta Fabricato:** cuadra contra las liquidaciones Bold. Cierre de turnos Bold: 4 nov +$160.000 y 5 nov +$26.000 más que el ERP.
- **Transferencias:** Las Américas 90/95 cruzadas, Fabricato 58/67. Los pendientes, con nombres, están en el plan de acción.
- **Recibos:** 581 pagos vs 575 recibos; 559 cruzan solos. Pendientes: recibos GUM y anticipos por generar; correcciones #54181, #54205, #26556, #54172 y #54413; cobros con recibo pero sin pago en el ERP (Isabel Díaz #54299 $90.000; Thiago Londoño Addi #54351 $160.000).

## 5. Lo que falta hacer (en orden)

1. **Leer las tirillas Redeban del 7 al 12 nov** guardadas en el bucket `comprobantes` (ruta `37af479b-…/2026-11-DD-tirilla-*.jpeg`, columna `cierres_diarios.tirilla_datafono_url`). Con acceso a Storage (CLI vinculada o service role), descargarlas, leer el GRAN TOTAL y compararlo con la tarjeta del ERP de Las Américas de cada día. Prioridad: el 12 nov.
2. **Probar las migraciones** en una rama de Supabase (o en una transacción revertida) antes de aplicarlas: 0098 y luego 0099. Ojo: en producción ya existen 0096/0097 que no están en el repo (facturas_compra).
3. Aplicar 0098 + 0099 en producción. Al recalcular, unos 57 días de oct–nov en "Cuadra" se reabren solos (es intencional).
4. Desplegar `procesar-cierre-semana-ia` (index.ts + parsers.ts). Secrets: `ANTHROPIC_API_KEY` y `CIERRE_CAJA_CRON_SECRET` (ya existen).
5. Merge a `main` → Netlify publica la pantalla.
6. Cargar noviembre: crear un período 2026-11-01 → 2026-11-15 con los CSV de Bancolombia (…0149 y …2157), el extracto de cuenta Bold y el Sales de Oral Drive, y procesarlo. Comparar con la sección 4.
7. Mejoras pendientes del motor:
   - sugerencias muchos-a-muchos (varias llaves = varios cobros; ej. 4 llaves del 5 nov = $153.000 = 2 cobros);
   - cruce por similitud entre el nombre del QR y `recibos_sistema.responsable`;
   - valor casi igual (±$5.000) como sugerencia;
   - lector del extracto Bold en PDF (mes vencido; hoy se procesa a mano con pdfplumber);
   - tirilla vs abono Redeban (neto/0,9633) como segunda comprobación diaria;
   - opción en el ERP para "aplicar un pago anterior" sin crear un saldo a favor con medio de pago (caso Juana María).
8. Revisar el lector de correos Bold (`bold_cierre_turnos`): en noviembre solo llegó en 3 de 12 días.
9. `procesar-cierre-ia` (por día) ya no se usa desde la pantalla; se puede retirar.
