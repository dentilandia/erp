-- Claves de integraciones externas (hoy: el robot de facturas de compra en
-- Google Apps Script). La clave se genera aquí mismo y solo la ve un admin
-- desde Administración → Facturación, para pegarla en el menú 🧾 de la hoja.
-- La Edge Function sync-facturas-compra la compara con el header x-sync-key.

create table if not exists integraciones_claves (
  nombre text primary key,
  clave text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  creado_en timestamptz not null default now()
);

alter table integraciones_claves enable row level security;
create policy integraciones_claves_select_admin on integraciones_claves for select using (fn_es_admin());

insert into integraciones_claves (nombre) values ('facturas_compra') on conflict (nombre) do nothing;
