# Pruebas del robot de facturas

Simulan Google Sheets, Drive, Gmail y la IA en Node para correr `procesarAhora()` y `simular()` de
punta a punta con casos reales (EPM a nombre de otro, cuentas de cobro de varias personas,
comprobantes sin extensión, pagos con tarjeta, anexos de seguridad social).

```bash
node integraciones/facturas-compra/pruebas/corrida-completa.cjs
SIM=1 node integraciones/facturas-compra/pruebas/corrida-completa.cjs
```
