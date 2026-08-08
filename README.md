# ERP Dentilandia

Vite + React + TypeScript + Tailwind v4 + Supabase.

## Estado actual (Capa 1 + Operación Diaria)

- Esquema completo de base de datos (`supabase/migrations/`), incluyendo el modelo
  de "pago por componente" (cada cargo tiene sus propios `cargo_pagos`, con su propio
  medio de pago) y el control estructural de saldo a favor (no se puede consumir más
  de lo que existe, protegido con un trigger + row lock).
- Autenticación por sede (login compartido por sede + admin con filtro libre).
- Operación Diaria: Recepción (llegada, cobro multi-medio, saldo a favor), Consultorio
  (registro clínico, RX, insumos, envío a laboratorio, marcar instalado), Cierre diario
  (tabla por doctora × medio de pago, consignación + comprobante), Laboratorio operativo,
  Historial.
- Liquidaciones, Financiación y Parámetros: **no están construidos todavía** — el
  esquema de `liquidaciones_doctora` y `retenciones_historial` ya existe, pero falta
  toda la interfaz. Ver la conversación con Claude Code para el orden de construcción.

## Puntos abiertos que quedaron pendientes (no se asumieron)

1. Columnas manuales exactas de la planilla de sedación.
2. Si GUM/RX van a alguna planilla de liquidación a terceros o son 100% ingreso Dentilandia.
3. El diseño de "marcar instalado" en Consultorio es provisional — Tomás lo va a revisar
   antes del piloto.

## Configuración

1. Copia `.env.example` a `.env` y completa con los datos de tu proyecto de Supabase
   (Project Settings → API): `VITE_SUPABASE_URL` y la **anon public key** (nunca la
   `service_role`).
2. Aplica las migraciones de `supabase/migrations/` a tu proyecto, en orden, ya sea con
   `supabase db push` (si tienes el CLI enlazado al proyecto) o pegando cada archivo en
   el SQL Editor del dashboard, en orden numérico.
3. Crea los perfiles de acceso desde el dashboard de Supabase (Authentication → Users,
   y luego una fila en la tabla `perfiles`):
   - Un usuario por sede con `rol = 'operacion'` y `sede_id` fijo (ej. `recepcion@fabricato.dentilandia`).
   - Un usuario admin con `rol = 'admin'` y `sede_id = null` (para Tomás).
4. `npm install && npm run dev`.

## Scripts

- `npm run dev` — servidor de desarrollo.
- `npm run build` — build de producción (`dist/`), listo para Netlify (`netlify.toml` incluido).
