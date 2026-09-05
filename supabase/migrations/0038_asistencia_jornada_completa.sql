-- Asistencia pasa de llegada/salida a las 4 marcas de una jornada completa:
-- llegada, salida a almuerzo, regreso de almuerzo, salida final. Además, al
-- marcar llegada se muestra una frase motivadora (obligatoria de ver) y al
-- marcar la salida final una de agradecimiento/felicitación — una nueva
-- cada día, eligiéndola por rotación (no hay que asignarle fecha a cada una).

alter table asistencia_registros drop constraint asistencia_registros_tipo_check;
alter table asistencia_registros add constraint asistencia_registros_tipo_check
  check (tipo in ('llegada', 'salida_almuerzo', 'entrada_almuerzo', 'salida'));

create table frases_motivacionales (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('llegada', 'salida')),
  texto text not null,
  orden integer not null default 0,
  activa boolean not null default true,
  created_at timestamptz not null default now()
);

alter table frases_motivacionales enable row level security;

-- Cualquiera autenticado puede leerlas (las necesita para el pop-up al
-- marcar) — solo admin las agrega/edita.
create policy frases_select on frases_motivacionales for select using (auth.uid() is not null);
create policy frases_write on frases_motivacionales for all using (fn_es_admin()) with check (fn_es_admin());
