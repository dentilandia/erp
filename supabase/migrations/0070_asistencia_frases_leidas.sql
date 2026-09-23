-- Registro de que una persona efectivamente vio (y confirmó con "Entendido")
-- el mensaje motivacional que se muestra al marcar llegada/salida — para que
-- admin pueda saber quién no lo está leyendo, no solo quién marcó.
create table asistencia_frases_leidas (
  id uuid primary key default gen_random_uuid(),
  perfil_id uuid not null references perfiles(id),
  fecha date not null,
  tipo text not null check (tipo in ('llegada', 'salida')),
  leido_en timestamptz not null default now(),
  unique (perfil_id, fecha, tipo)
);

alter table asistencia_frases_leidas enable row level security;

-- Cada quien registra su propia confirmación de lectura.
create policy "asistencia_frases_leidas_insert_propia" on asistencia_frases_leidas
  for insert to authenticated
  with check (perfil_id = auth.uid());

-- Cada quien ve la suya, y admin ve todas (para el dashboard de alertas).
create policy "asistencia_frases_leidas_select" on asistencia_frases_leidas
  for select to authenticated
  using (perfil_id = auth.uid() or fn_es_admin());
