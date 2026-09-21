-- Fabricato consigna/mueve también por Bold (aparte del datáfono) — hace
-- falta un segundo campo de "movimientos de banco" porque Bancolombia
-- (ambas sedes) y Bold (solo Fabricato) son dos fuentes distintas para el
-- mismo día.
alter table cierres_caja add column url_movimientos_banco_2 text;

-- El cierre real no se hace día por día: cada semana se sube un solo lote de
-- 5 documentos (que cada uno cubre varios días/ambas sedes) y se compara
-- contra los cierres diarios de esos 7 días. Esta tabla guarda esos 5
-- documentos de la semana; el resultado del análisis se reparte entre las
-- filas de cierres_caja de cada día y sede (14 en total por semana).
create table cierres_caja_semanas (
  id uuid primary key default gen_random_uuid(),
  semana_inicio date not null unique, -- lunes de la semana
  url_datafono_americas text,
  url_datafono_fabricato text,
  url_bancolombia text,
  url_bold_fabricato text,
  url_recibos_caja text,
  procesando boolean not null default false,
  procesado_en timestamptz,
  resumen_ia text,
  error_ia text,
  created_at timestamptz not null default now()
);

alter table cierres_caja_semanas enable row level security;
create policy cierres_caja_semanas_admin on cierres_caja_semanas
  for all
  using (fn_es_admin())
  with check (fn_es_admin());
