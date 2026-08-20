-- ============================================================
-- MÓDULO CIERRE DE CAJA — Esquema Supabase
-- Migra el dashboard HTML de conciliación de caja (Dashboard_Cuadre_Dentilandia.html)
-- a una tabla real, con historial de 76 días ya cuadrados (ver 0012_seed_cierre_caja.sql).
--
-- Nota de diseño: `sede` queda como texto libre ('Fabricato' / 'Las Americas'),
-- igual que en el dashboard original y el seed histórico, en vez de sede_id FK —
-- así el seed de 76 días no necesita reescribirse contra UUIDs reales. El
-- frontend mapea esos textos contra la sede activa por nombre.
-- ============================================================

create table if not exists cierres_caja (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  sede text not null,                     -- 'Fabricato' | 'Las Americas'

  -- Facturado (Oral Drive / módulo de recepción del ERP)
  tarjeta_fact numeric(14,2) not null default 0,
  transf_fact  numeric(14,2) not null default 0,
  efvo_fact    numeric(14,2) not null default 0,
  addi         numeric(14,2) not null default 0,   -- Addi + Sistecrédito combinados
  total        numeric(14,2) not null default 0,

  -- Real / documentos físicos
  arqueo       numeric(14,2),              -- Total efectivo (Cierre) físico; null = falta el cierre físico
  dataf_spro   numeric(14,2),              -- Gran Total Redeban o SPRO Bold; null = falta el comprobante
  dataf_qr     numeric(14,2),              -- QR Bold / eco Llaves ya explicado

  -- Diferencias y estado de cuadre
  monto_cruzado     numeric(14,2) not null default 0,
  dif_dataf_bruta   numeric(14,2),
  dif_dataf_neta    numeric(14,2),
  dataf_explicado   boolean not null default false,
  transf_directa    numeric(14,2) not null default 0,
  dif_efvo          numeric(14,2) not null default 0,
  cuadra            boolean not null default true,
  transf_por_verificar boolean not null default false,
  transf_sin_banco     boolean not null default false,
  dataf_sin_docs        boolean not null default false,
  urgente_transf        boolean not null default false,
  gasto                 numeric(14,2),          -- reposición de caja menor u otro gasto de caja

  -- Trazabilidad / fuente de cada dato
  fuente_dataf  text,   -- 'SPRO Bold' | 'Redeban'
  fuente_transf text,   -- 'QR Bold' | 'Bancolombia' | 'QR Bold + Llaves' ...

  -- Notas de auditoría (texto libre, igual que hoy en el dashboard)
  dataf_explicacion text,
  nota_dataf_extra   text,
  nota_transf_extra  text,
  nota_banco_extra   text,
  nota_limitacion    text,
  nota_cuenta2       text,
  consignacion_cuenta2      boolean not null default false,
  nota_consignacion_pendiente text,

  -- Detalle estructurado (listas variables -> jsonb)
  errores      jsonb not null default '[]'::jsonb,   -- [{tipo, paciente, valor, sede_recibo}]
  transfs      jsonb not null default '[]'::jsonb,   -- [{paciente, valor}]
  dups_elec    jsonb not null default '[]'::jsonb,   -- [{paciente, valor, medio, nota}]
  addi_detalle jsonb not null default '[]'::jsonb,   -- [{paciente, valor, medio}]

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (fecha, sede)
);

create index if not exists idx_cierres_caja_fecha on cierres_caja (fecha);
create index if not exists idx_cierres_caja_sede on cierres_caja (sede);

-- ---------- Checklist "Revisé el cierre físico" (por día+sede) ----------
create table if not exists cierres_revision_fisica (
  fecha date not null,
  sede text not null,
  revisado boolean not null default false,
  revisado_por uuid references auth.users(id),
  revisado_en timestamptz,
  primary key (fecha, sede)
);

-- ---------- Checklist de "Pendientes" (por ítem, no por día) ----------
-- clave = 'fecha|sede|tipo', ej. '2026-08-14|Las Americas|Datáfono'
create table if not exists cierres_pendientes_estado (
  clave text primary key,
  resuelto boolean not null default false,
  solucion text,
  resuelto_por uuid references auth.users(id),
  resuelto_en timestamptz,
  updated_at timestamptz not null default now()
);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_cierres_caja_updated on cierres_caja;
create trigger trg_cierres_caja_updated
  before update on cierres_caja
  for each row execute function set_updated_at();

drop trigger if exists trg_pendientes_updated on cierres_pendientes_estado;
create trigger trg_pendientes_updated
  before update on cierres_pendientes_estado
  for each row execute function set_updated_at();

-- ---------- RLS: solo admin (este módulo es de auditoría gerencial, ----------
-- igual que Liquidaciones — no lo ve ni lo toca el personal de sede).
alter table cierres_caja enable row level security;
alter table cierres_revision_fisica enable row level security;
alter table cierres_pendientes_estado enable row level security;

create policy cierres_caja_admin on cierres_caja
  for all using (fn_es_admin()) with check (fn_es_admin());
create policy cierres_revision_fisica_admin on cierres_revision_fisica
  for all using (fn_es_admin()) with check (fn_es_admin());
create policy cierres_pendientes_estado_admin on cierres_pendientes_estado
  for all using (fn_es_admin()) with check (fn_es_admin());
