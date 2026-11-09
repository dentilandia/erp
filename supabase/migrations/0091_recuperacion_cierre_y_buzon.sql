-- Seguimiento diario de la recuperación de pacientes + buzón de notificaciones.
--
-- 1) Antes, al pasar un paciente a "descartado" o "recuperado" solo cambiaba
--    el estado: no quedaba CUÁNDO ni QUIÉN lo cerró, así que no se podía
--    contar cuántos cerró cada auxiliar por día. Ahora un trigger lo anota
--    solo (cerrado_en / cerrado_por) y lo borra si el caso se reabre.
-- 2) Tabla `notificaciones`: el buzón personal de cada usuario (campana en
--    el encabezado del ERP).
-- 3) Resumen diario por auxiliar de servicio al cliente y sede, contra la
--    meta de 30 contactos por auxiliar por día.
-- 4) Dos envíos automáticos (lunes a sábado, sin festivos):
--      7:00am Bogotá → cómo cerró el día hábil anterior.
--      2:00pm Bogotá → cómo va el día al iniciar la jornada de la tarde.
--    Cada auxiliar recibe lo suyo; los admin (gerencia, Sirley) reciben el
--    consolidado de todas.

-- ── 1. Fecha y responsable del cierre ─────────────────────────────────────
alter table recuperacion_pacientes
  add column if not exists cerrado_en timestamptz,
  add column if not exists cerrado_por uuid references perfiles(id),
  add column if not exists cerrado_por_nombre text;

create or replace function fn_recuperacion_marcar_cierre()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado_recuperacion in ('descartado', 'recuperado') then
    if old.estado_recuperacion is distinct from new.estado_recuperacion
       and old.estado_recuperacion not in ('descartado', 'recuperado') then
      new.cerrado_en := now();
      new.cerrado_por := auth.uid();
      new.cerrado_por_nombre := (select nombre from perfiles where id = auth.uid());
    end if;
  else
    new.cerrado_en := null;
    new.cerrado_por := null;
    new.cerrado_por_nombre := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_recuperacion_marcar_cierre on recuperacion_pacientes;
create trigger trg_recuperacion_marcar_cierre
  before update of estado_recuperacion on recuperacion_pacientes
  for each row execute function fn_recuperacion_marcar_cierre();

-- Casos ya cerrados: se les asigna el último seguimiento registrado (fecha y
-- persona). Los que se cerraron sin ningún seguimiento quedan sin dato.
update recuperacion_pacientes r
set cerrado_en = s.created_at,
    cerrado_por = s.registrado_por,
    cerrado_por_nombre = s.registrado_por_nombre
from (
  select distinct on (recuperacion_id) recuperacion_id, created_at, registrado_por, registrado_por_nombre
  from recuperacion_pacientes_seguimientos
  order by recuperacion_id, created_at desc
) s
where s.recuperacion_id = r.id
  and r.estado_recuperacion in ('descartado', 'recuperado')
  and r.cerrado_en is null;

-- ── 2. Buzón de notificaciones ────────────────────────────────────────────
create table if not exists notificaciones (
  id uuid primary key default gen_random_uuid(),
  perfil_id uuid not null references perfiles(id) on delete cascade,
  tipo text not null,
  fecha_referencia date not null,
  titulo text not null,
  cuerpo text not null,
  datos jsonb,
  leida_en timestamptz,
  created_at timestamptz not null default now(),
  unique (perfil_id, tipo, fecha_referencia)
);

create index if not exists notificaciones_perfil_idx on notificaciones (perfil_id, created_at desc);

alter table notificaciones enable row level security;

drop policy if exists notificaciones_select_propias on notificaciones;
create policy notificaciones_select_propias on notificaciones
  for select using (perfil_id = auth.uid());

drop policy if exists notificaciones_update_propias on notificaciones;
create policy notificaciones_update_propias on notificaciones
  for update using (perfil_id = auth.uid()) with check (perfil_id = auth.uid());

-- ── 3. Resumen diario ─────────────────────────────────────────────────────
-- Auxiliar de servicio al cliente = perfil cuyo cargo dice "servicio ... cliente"
-- (hoy está escrito de dos formas: "Servicio al cliente" y "servicio-cliente").
create or replace function fn_es_auxiliar_servicio_cliente(p_cargo text)
returns boolean
language sql
immutable
as $$
  select lower(translate(coalesce(p_cargo, ''), '-_', '  ')) like '%servicio%cliente%';
$$;

create or replace function fn_resumen_recuperacion_dia(p_fecha date)
returns table (
  perfil_id uuid,
  nombre text,
  sede_id uuid,
  sede_nombre text,
  es_auxiliar boolean,
  contactos int,
  llamadas int,
  b2chat int,
  agendados int,
  descartados int,
  recuperados int
)
language sql
stable
security definer
set search_path = public
as $$
  with cont as (
    select s.registrado_por as pid, s.sede_id,
           count(distinct s.recuperacion_id)::int as contactos,
           count(distinct s.recuperacion_id) filter (where s.llamo)::int as llamadas,
           count(distinct s.recuperacion_id) filter (where s.retomo_b2chat)::int as b2chat,
           count(distinct s.recuperacion_id) filter (where s.agendo_cita)::int as agendados
    from recuperacion_pacientes_seguimientos s
    where s.fecha_contacto = p_fecha and s.registrado_por is not null
    group by 1, 2
  ),
  cier as (
    select r.cerrado_por as pid, r.sede_id,
           count(*) filter (where r.estado_recuperacion = 'descartado')::int as descartados,
           count(*) filter (where r.estado_recuperacion = 'recuperado')::int as recuperados
    from recuperacion_pacientes r
    where r.cerrado_por is not null
      and (r.cerrado_en at time zone 'America/Bogota')::date = p_fecha
    group by 1, 2
  ),
  actividad as (
    select pid, sede_id from cont
    union
    select pid, sede_id from cier
  ),
  claves as (
    select pid, sede_id from actividad
    union
    -- Auxiliares sin ninguna actividad ese día: igual aparecen (en su sede), en 0.
    select p.id, p.sede_id from perfiles p
    where fn_es_auxiliar_servicio_cliente(p.cargo)
      and not exists (select 1 from actividad a where a.pid = p.id)
  )
  select k.pid, p.nombre, k.sede_id, se.nombre,
         fn_es_auxiliar_servicio_cliente(p.cargo),
         coalesce(c.contactos, 0), coalesce(c.llamadas, 0), coalesce(c.b2chat, 0), coalesce(c.agendados, 0),
         coalesce(ci.descartados, 0), coalesce(ci.recuperados, 0)
  from claves k
  join perfiles p on p.id = k.pid
  left join sedes se on se.id = k.sede_id
  left join cont c on c.pid = k.pid and c.sede_id is not distinct from k.sede_id
  left join cier ci on ci.pid = k.pid and ci.sede_id is not distinct from k.sede_id
  order by se.nombre, p.nombre;
$$;

revoke all on function fn_resumen_recuperacion_dia(date) from public, anon;
grant execute on function fn_resumen_recuperacion_dia(date) to authenticated;

-- ── 4. Generación de notificaciones ───────────────────────────────────────
create or replace function fn_dia_habil(p_fecha date)
returns boolean
language sql
stable
set search_path = public
as $$
  select extract(isodow from p_fecha) <> 7
     and not exists (select 1 from festivos_colombia f where f.fecha = p_fecha);
$$;

-- p_momento: 'manana' (resumen del día hábil anterior) o 'tarde' (avance de hoy).
create or replace function fn_notificar_recuperacion(p_momento text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c_meta constant int := 30;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_fecha date;
  v_tipo text;
  v_etiqueta text;
  v_r record;
  v_titulo text;
  v_cuerpo text;
  v_lineas text := '';
  v_total_contactos int := 0;
  v_total_cerrados int := 0;
  v_num_aux int := 0;
  v_falta int;
  v_cumplen int := 0;
  v_datos jsonb;
  v_dias text[] := array['lun','mar','mié','jue','vie','sáb','dom'];
  v_meses text[] := array['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
begin
  if not fn_dia_habil(v_hoy) then
    return;
  end if;

  if p_momento = 'manana' then
    v_tipo := 'recuperacion_resumen_dia';
    v_fecha := v_hoy - 1;
    while not fn_dia_habil(v_fecha) loop
      v_fecha := v_fecha - 1;
    end loop;
  elsif p_momento = 'tarde' then
    v_tipo := 'recuperacion_avance_tarde';
    v_fecha := v_hoy;
  else
    raise exception 'Momento no válido: %', p_momento;
  end if;

  v_etiqueta := v_dias[extract(isodow from v_fecha)::int] || ' ' || extract(day from v_fecha)::int
                || ' ' || v_meses[extract(month from v_fecha)::int];

  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_datos
  from fn_resumen_recuperacion_dia(v_fecha) x;

  -- Mensaje personal para cada auxiliar de servicio al cliente.
  for v_r in select * from fn_resumen_recuperacion_dia(v_fecha) where es_auxiliar loop
    v_falta := greatest(c_meta - v_r.contactos, 0);
    if p_momento = 'manana' then
      v_titulo := 'Recuperación de pacientes — ' || v_etiqueta || ': ' || v_r.contactos || ' de ' || c_meta;
      v_cuerpo := 'En ' || coalesce(v_r.sede_nombre, 'tu sede') || ' contactaste ' || v_r.contactos
        || ' de ' || c_meta || ' pacientes'
        || case when v_falta = 0 then '. ¡Meta cumplida!' else ' — te faltaron ' || v_falta || '.' end;
    else
      v_titulo := 'Recuperación de pacientes — hoy vas ' || v_r.contactos || ' de ' || c_meta;
      v_cuerpo := 'Inicia la jornada de la tarde: llevas ' || v_r.contactos || ' de ' || c_meta
        || ' contactos en ' || coalesce(v_r.sede_nombre, 'tu sede')
        || case when v_falta = 0 then '. ¡Meta cumplida!' else '. Te faltan ' || v_falta || ' para la meta.' end;
    end if;
    v_cuerpo := v_cuerpo || E'\n' || 'Llamadas: ' || v_r.llamadas || ' · B2Chat: ' || v_r.b2chat
      || ' · Agendaron cita: ' || v_r.agendados
      || E'\n' || 'Casos cerrados: ' || (v_r.descartados + v_r.recuperados)
      || ' (' || v_r.descartados || ' descartados, ' || v_r.recuperados || ' recuperados)';

    insert into notificaciones (perfil_id, tipo, fecha_referencia, titulo, cuerpo, datos)
    values (v_r.perfil_id, v_tipo, v_fecha, v_titulo, v_cuerpo, to_jsonb(v_r))
    on conflict (perfil_id, tipo, fecha_referencia)
    do update set titulo = excluded.titulo, cuerpo = excluded.cuerpo, datos = excluded.datos,
                  created_at = now(), leida_en = null;
  end loop;

  -- Consolidado para gerencia (todos los admin, incluida Sirley).
  for v_r in select * from fn_resumen_recuperacion_dia(v_fecha) loop
    v_total_contactos := v_total_contactos + v_r.contactos;
    v_total_cerrados := v_total_cerrados + v_r.descartados + v_r.recuperados;
    if v_r.es_auxiliar then
      v_num_aux := v_num_aux + 1;
      if v_r.contactos >= c_meta then v_cumplen := v_cumplen + 1; end if;
    end if;
    v_lineas := v_lineas || E'\n' || '• ' || v_r.nombre || ' (' || coalesce(v_r.sede_nombre, 'sin sede') || '): '
      || v_r.contactos || case when v_r.es_auxiliar then '/' || c_meta else '' end || ' contactos'
      || case when v_r.es_auxiliar and v_r.contactos < c_meta then ' — faltaron ' || (c_meta - v_r.contactos) else '' end
      || ' · cerrados ' || (v_r.descartados + v_r.recuperados)
      || ' (' || v_r.descartados || ' desc., ' || v_r.recuperados || ' recup.)'
      || ' · citas ' || v_r.agendados
      || case when v_r.es_auxiliar then '' else ' [no tiene cargo de servicio al cliente]' end;
  end loop;

  v_titulo := 'Recuperación — ' || case when p_momento = 'manana' then v_etiqueta else 'avance de hoy 2pm' end
    || ': ' || v_total_contactos || ' de ' || (c_meta * v_num_aux) || ' contactos';
  v_cuerpo := v_cumplen || ' de ' || v_num_aux || ' auxiliares cumplieron la meta de ' || c_meta
    || '. Casos cerrados: ' || v_total_cerrados || '.' || v_lineas;

  insert into notificaciones (perfil_id, tipo, fecha_referencia, titulo, cuerpo, datos)
  select p.id, v_tipo || '_consolidado', v_fecha, v_titulo, v_cuerpo, v_datos
  from perfiles p where p.rol = 'admin'
  on conflict (perfil_id, tipo, fecha_referencia)
  do update set titulo = excluded.titulo, cuerpo = excluded.cuerpo, datos = excluded.datos,
                created_at = now(), leida_en = null;
end;
$$;

revoke all on function fn_notificar_recuperacion(text) from public, anon, authenticated;

create extension if not exists pg_cron;

select cron.unschedule(jobname) from cron.job
where jobname in ('recuperacion-resumen-manana', 'recuperacion-avance-tarde');

select cron.schedule(
  'recuperacion-resumen-manana',
  '0 12 * * 1-6', -- 12:00 UTC = 7:00am Bogotá, lunes a sábado
  $$ select fn_notificar_recuperacion('manana'); $$
);

select cron.schedule(
  'recuperacion-avance-tarde',
  '0 19 * * 1-6', -- 19:00 UTC = 2:00pm Bogotá, lunes a sábado
  $$ select fn_notificar_recuperacion('tarde'); $$
);
