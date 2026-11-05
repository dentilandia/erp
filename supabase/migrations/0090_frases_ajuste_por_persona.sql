create table if not exists public.frases_ajuste (
  perfil_id uuid not null references public.perfiles(id) on delete cascade,
  tipo text not null check (tipo in ('llegada','salida')),
  ajuste integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (perfil_id, tipo)
);
alter table public.frases_ajuste enable row level security;
-- Sin policies a propósito: solo la edge function (rol de servicio) la lee.
