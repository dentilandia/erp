-- Listas de fidelización de Servicio al cliente, alimentadas desde Consultorio.
--
-- 1) Motivo de la cita en dos fases: visitas.motivos_cita (lista cerrada,
--    uno o varios) + visitas.tratamiento_detalle (aclaración libre).
--    visitas.tratamiento se sigue llenando (motivos + aclaración) para que
--    Recepción, Historial y el concepto del cargo sigan funcionando igual.
-- 2) fidelizacion_casos: un caso por visita y tipo, creado SOLO por trigger
--    al guardar la atención en Consultorio (o al corregirla):
--      presupuesto   → "Se le entregó presupuesto" (si NO se recomendó sedación)
--      sedacion      → "Se le recomendó sedación" (ya incluye su presupuesto)
--      primera_vez   → "Es primera vez"
--      radiografia   → "Se le mandó radiografía"
--      seguimiento_procedimiento → motivo de cita en la lista de procedimientos
--                       con seguimiento (operatoria, endodoncia, exodoncia, ...)
--    Plazo máximo de contacto: 7 días desde la atención (fecha_limite).
-- 3) fidelizacion_seguimientos: cada contacto (medio, qué dijo el paciente,
--    resultado, compromiso de volver a contactar en una fecha). Un trigger
--    actualiza el estado del caso y anota quién/cuándo lo cerró.
-- 4) Los contactos de fidelización suman a la meta diaria de 30 de cada
--    auxiliar (fn_resumen_recuperacion_dia) y cada mañana se envía al buzón
--    cuántos pacientes hay que contactar hoy, por sede y lista.

-- ── 1. Motivo de la cita ──────────────────────────────────────────────────
alter table visitas
  add column if not exists motivos_cita text[] not null default '{}',
  add column if not exists tratamiento_detalle text;

-- Procedimientos que generan seguimiento post-tratamiento. Mantener igual a
-- MOTIVOS_CON_SEGUIMIENTO en src/lib/fidelizacion.ts.
create or replace function fn_motivos_con_seguimiento()
returns text[]
language sql
immutable
as $$
  select array[
    'Operatoria', 'Endodoncia', 'Exodoncia', 'Frenillectomía',
    'Sedación intravenosa', 'Sedación óxido nitroso',
    'Instalación', 'Urgencia aparato', 'Trauma dental'
  ];
$$;

-- ── 2. Casos ──────────────────────────────────────────────────────────────
create table if not exists fidelizacion_casos (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('presupuesto', 'sedacion', 'primera_vez', 'radiografia', 'seguimiento_procedimiento')),
  visita_id uuid not null references visitas(id) on delete cascade,
  paciente_id uuid not null references pacientes(id) on delete cascade,
  sede_id uuid not null references sedes(id),
  doctora_id uuid references doctoras(id),
  fecha_atencion date not null,
  fecha_limite date not null,
  detalle text,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'en_proceso', 'agendo_cita', 'no_interesa', 'seguimiento_realizado')),
  proximo_contacto date,
  cerrado_en timestamptz,
  cerrado_por uuid references perfiles(id),
  cerrado_por_nombre text,
  created_at timestamptz not null default now(),
  unique (visita_id, tipo)
);

create index if not exists fidelizacion_casos_sede_tipo_idx on fidelizacion_casos (sede_id, tipo, estado);

create table if not exists fidelizacion_seguimientos (
  id uuid primary key default gen_random_uuid(),
  caso_id uuid not null references fidelizacion_casos(id) on delete cascade,
  sede_id uuid not null references sedes(id),
  fecha_contacto date not null default ((now() at time zone 'America/Bogota')::date),
  medio text not null check (medio in ('llamada', 'b2chat', 'mensaje')),
  observacion text,
  resultado text not null
    check (resultado in ('no_contesta', 'volver_a_contactar', 'agendo_cita', 'no_interesa', 'seguimiento_realizado')),
  proximo_contacto date,
  registrado_por uuid references perfiles(id) default auth.uid(),
  registrado_por_nombre text,
  created_at timestamptz not null default now()
);

create index if not exists fidelizacion_seguimientos_caso_idx on fidelizacion_seguimientos (caso_id, created_at desc);
create index if not exists fidelizacion_seguimientos_fecha_idx on fidelizacion_seguimientos (fecha_contacto, registrado_por);

alter table fidelizacion_casos enable row level security;
alter table fidelizacion_seguimientos enable row level security;

drop policy if exists fidelizacion_casos_select on fidelizacion_casos;
create policy fidelizacion_casos_select on fidelizacion_casos
  for select using (fn_es_admin() or sede_id = fn_perfil_sede());
drop policy if exists fidelizacion_casos_update on fidelizacion_casos;
create policy fidelizacion_casos_update on fidelizacion_casos
  for update using (fn_es_admin() or sede_id = fn_perfil_sede());
drop policy if exists fidelizacion_casos_delete on fidelizacion_casos;
create policy fidelizacion_casos_delete on fidelizacion_casos
  for delete using (fn_es_admin());

drop policy if exists fidelizacion_seguimientos_select on fidelizacion_seguimientos;
create policy fidelizacion_seguimientos_select on fidelizacion_seguimientos
  for select using (fn_es_admin() or sede_id = fn_perfil_sede());
drop policy if exists fidelizacion_seguimientos_insert on fidelizacion_seguimientos;
create policy fidelizacion_seguimientos_insert on fidelizacion_seguimientos
  for insert with check (fn_es_admin() or sede_id = fn_perfil_sede());
drop policy if exists fidelizacion_seguimientos_delete on fidelizacion_seguimientos;
create policy fidelizacion_seguimientos_delete on fidelizacion_seguimientos
  for delete using (fn_es_admin());

-- Crea / actualiza / quita los casos de una visita según lo marcado en
-- Consultorio. Un caso que ya tiene contactos registrados nunca se borra
-- aunque desmarquen el check (para no perder la gestión hecha).
create or replace function fn_fidelizacion_sincronizar_visita()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tipos text[] := '{}';
  v_tipo text;
  v_motivos_seg text[];
  v_detalle text;
  v_detalle_seg text;
begin
  if coalesce(new.es_venta_producto, false) then
    return new;
  end if;

  if new.se_recomendo_sedacion then
    v_tipos := array_append(v_tipos, 'sedacion');
  elsif new.se_entrego_presupuesto then
    v_tipos := array_append(v_tipos, 'presupuesto');
  end if;
  if new.es_primera_vez then v_tipos := array_append(v_tipos, 'primera_vez'); end if;
  if new.se_mando_radiografia then v_tipos := array_append(v_tipos, 'radiografia'); end if;

  select coalesce(array_agg(m), '{}') into v_motivos_seg
  from unnest(coalesce(new.motivos_cita, '{}')) m
  where m = any (fn_motivos_con_seguimiento());
  if cardinality(v_motivos_seg) > 0 then
    v_tipos := array_append(v_tipos, 'seguimiento_procedimiento');
  end if;

  v_detalle := nullif(trim(coalesce(new.tratamiento, '')), '');
  v_detalle_seg := array_to_string(v_motivos_seg, ', ')
    || coalesce(' — ' || nullif(trim(coalesce(new.tratamiento_detalle, '')), ''), '');

  foreach v_tipo in array v_tipos loop
    insert into fidelizacion_casos (tipo, visita_id, paciente_id, sede_id, doctora_id, fecha_atencion, fecha_limite, detalle)
    values (v_tipo, new.id, new.paciente_id, new.sede_id, new.doctora_id, new.fecha, new.fecha + 7,
            case when v_tipo = 'seguimiento_procedimiento' then v_detalle_seg else v_detalle end)
    on conflict (visita_id, tipo) do update
      set doctora_id = excluded.doctora_id,
          sede_id = excluded.sede_id,
          fecha_atencion = excluded.fecha_atencion,
          fecha_limite = excluded.fecha_limite,
          detalle = excluded.detalle;
  end loop;

  delete from fidelizacion_casos c
  where c.visita_id = new.id
    and not (c.tipo = any (v_tipos))
    and not exists (select 1 from fidelizacion_seguimientos s where s.caso_id = c.id);

  return new;
end;
$$;

drop trigger if exists trg_fidelizacion_sincronizar_visita on visitas;
create trigger trg_fidelizacion_sincronizar_visita
  after insert or update of se_entrego_presupuesto, se_recomendo_sedacion, es_primera_vez, se_mando_radiografia,
    motivos_cita, tratamiento, tratamiento_detalle, doctora_id, fecha, sede_id
  on visitas
  for each row execute function fn_fidelizacion_sincronizar_visita();

-- Cada contacto actualiza el estado del caso, su compromiso de próximo
-- contacto y, si lo cierra, quién y cuándo.
create or replace function fn_fidelizacion_registrar_seguimiento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cierra boolean := new.resultado in ('agendo_cita', 'no_interesa', 'seguimiento_realizado');
begin
  if new.registrado_por_nombre is null and new.registrado_por is not null then
    select nombre into new.registrado_por_nombre from perfiles where id = new.registrado_por;
  end if;

  update fidelizacion_casos
  set estado = case when v_cierra then new.resultado else 'en_proceso' end,
      proximo_contacto = case when v_cierra then null else new.proximo_contacto end,
      cerrado_en = case when v_cierra then now() else null end,
      cerrado_por = case when v_cierra then new.registrado_por else null end,
      cerrado_por_nombre = case when v_cierra then new.registrado_por_nombre else null end
  where id = new.caso_id;

  return new;
end;
$$;

drop trigger if exists trg_fidelizacion_registrar_seguimiento on fidelizacion_seguimientos;
create trigger trg_fidelizacion_registrar_seguimiento
  before insert on fidelizacion_seguimientos
  for each row execute function fn_fidelizacion_registrar_seguimiento();

-- ── 4. Meta diaria y buzón ────────────────────────────────────────────────
-- Igual que en 0091, pero los contactos de fidelización también cuentan.
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
  with contactos_todos as (
    select s.registrado_por as pid, s.sede_id, 'r:' || s.recuperacion_id as caso,
           s.llamo, s.retomo_b2chat, s.agendo_cita
    from recuperacion_pacientes_seguimientos s
    where s.fecha_contacto = p_fecha and s.registrado_por is not null
    union all
    select f.registrado_por, f.sede_id, 'f:' || f.caso_id,
           f.medio = 'llamada', f.medio = 'b2chat', f.resultado = 'agendo_cita'
    from fidelizacion_seguimientos f
    where f.fecha_contacto = p_fecha and f.registrado_por is not null
  ),
  cont as (
    select pid, sede_id,
           count(distinct caso)::int as contactos,
           count(distinct caso) filter (where llamo)::int as llamadas,
           count(distinct caso) filter (where retomo_b2chat)::int as b2chat,
           count(distinct caso) filter (where agendo_cita)::int as agendados
    from contactos_todos
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

-- Pacientes de fidelización para contactar en una fecha, por sede y lista:
-- casos abiertos cuyo compromiso de contacto (o, sin compromiso, la fecha de
-- la atención) ya llegó.
create or replace function fn_fidelizacion_pendientes(p_fecha date)
returns table (sede_id uuid, sede_nombre text, tipo text, por_contactar int, vencidos int)
language sql
stable
security definer
set search_path = public
as $$
  select c.sede_id, se.nombre, c.tipo,
         count(*)::int,
         count(*) filter (where c.fecha_limite < p_fecha and c.estado = 'pendiente')::int
  from fidelizacion_casos c
  join sedes se on se.id = c.sede_id
  where c.estado in ('pendiente', 'en_proceso')
    and coalesce(c.proximo_contacto, c.fecha_atencion) <= p_fecha
  group by 1, 2, 3;
$$;

revoke all on function fn_fidelizacion_pendientes(date) from public, anon;
grant execute on function fn_fidelizacion_pendientes(date) to authenticated;

create or replace function fn_notificar_fidelizacion()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_sede record;
  v_cuerpo text;
  v_total int;
  v_consolidado text := '';
  v_total_general int := 0;
begin
  if not fn_dia_habil(v_hoy) then
    return;
  end if;

  for v_sede in
    select s.sede_id, s.sede_nombre,
           sum(s.por_contactar)::int as total, sum(s.vencidos)::int as vencidos,
           string_agg(
             case s.tipo
               when 'presupuesto' then 'Presupuestos'
               when 'sedacion' then 'Sedación'
               when 'primera_vez' then 'Primeras veces'
               when 'radiografia' then 'Radiografías'
               else 'Seguimiento de procedimientos'
             end || ': ' || s.por_contactar, ' · ' order by s.tipo) as detalle
    from fn_fidelizacion_pendientes(v_hoy) s
    group by s.sede_id, s.sede_nombre
  loop
    v_total := v_sede.total;
    v_cuerpo := 'Hoy tienes ' || v_total || ' pacientes por contactar en ' || v_sede.sede_nombre || '.'
      || E'\n' || v_sede.detalle
      || case when v_sede.vencidos > 0 then E'\n' || '⚠ ' || v_sede.vencidos || ' ya pasaron la semana sin contacto.' else '' end;

    insert into notificaciones (perfil_id, tipo, fecha_referencia, titulo, cuerpo)
    select p.id, 'fidelizacion_agenda_dia', v_hoy,
           'Fidelización — hoy: ' || v_total || ' pacientes por contactar', v_cuerpo
    from perfiles p
    where fn_es_auxiliar_servicio_cliente(p.cargo) and p.sede_id = v_sede.sede_id
    on conflict (perfil_id, tipo, fecha_referencia)
    do update set titulo = excluded.titulo, cuerpo = excluded.cuerpo, created_at = now(), leida_en = null;

    v_total_general := v_total_general + v_total;
    v_consolidado := v_consolidado || E'\n' || '• ' || v_sede.sede_nombre || ': ' || v_total
      || ' (' || v_sede.detalle || ')'
      || case when v_sede.vencidos > 0 then ' — ' || v_sede.vencidos || ' vencidos' else '' end;
  end loop;

  if v_total_general > 0 then
    insert into notificaciones (perfil_id, tipo, fecha_referencia, titulo, cuerpo)
    select p.id, 'fidelizacion_agenda_dia_consolidado', v_hoy,
           'Fidelización — hoy: ' || v_total_general || ' pacientes por contactar',
           'Pacientes de las listas de fidelización para contactar hoy:' || v_consolidado
    from perfiles p where p.rol = 'admin'
    on conflict (perfil_id, tipo, fecha_referencia)
    do update set titulo = excluded.titulo, cuerpo = excluded.cuerpo, created_at = now(), leida_en = null;
  end if;
end;
$$;

revoke all on function fn_notificar_fidelizacion() from public, anon, authenticated;

select cron.unschedule(jobname) from cron.job where jobname = 'fidelizacion-agenda-manana';
select cron.schedule(
  'fidelizacion-agenda-manana',
  '5 12 * * 1-6', -- 12:05 UTC = 7:05am Bogotá, lunes a sábado
  $$ select fn_notificar_fidelizacion(); $$
);
