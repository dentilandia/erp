-- Paciente que agendó y NO asistió → el caso vuelve a su lista de contacto.
--
-- Cada mañana (6:55am Bogotá, antes del aviso de las 7:05) los casos que
-- quedaron como "Agendó cita" cuya fecha de cita ya pasó sin visita en el
-- ERP se reabren en la MISMA lista donde estaban:
--   fidelización  → estado 'pendiente'; el plazo se vuelve a contar desde la
--                   cita incumplida (reabierto_desde): 7 días, o 15 en
--                   radiografías (fecha_limite = fecha_cita + plazo).
--   recuperación  → estado 'en_proceso'.
-- Si el paciente llega después (Recepción crea su visita), el caso reabierto
-- se vuelve a cerrar solo como asistido.
-- Recuperación sin enlace con la ficha del ERP: antes de reabrir se busca la
-- visita por nombre; si el nombre no aparece en el ERP no se reabre (no se
-- puede verificar) y la pantalla lo muestra así.

alter table fidelizacion_casos
  add column if not exists reabierto_desde date,
  add column if not exists inasistencias int not null default 0;

alter table recuperacion_pacientes
  add column if not exists reabierto_desde date,
  add column if not exists inasistencias int not null default 0;

-- La sincronización desde Consultorio no debe pisar el plazo de un caso
-- reabierto (si corrigen la atención original).
do $$
declare
  v_def text;
begin
  select pg_get_functiondef('fn_fidelizacion_sincronizar_visita()'::regprocedure) into v_def;
  v_def := replace(v_def,
    'fecha_limite = excluded.fecha_limite,',
    'fecha_limite = case when fidelizacion_casos.reabierto_desde is null then excluded.fecha_limite else fidelizacion_casos.fecha_limite end,');
  if v_def not like '%fidelizacion_casos.reabierto_desde is null%' then
    raise exception 'fn_fidelizacion_sincronizar_visita no tiene la forma esperada';
  end if;
  execute v_def;
end;
$$;

create or replace function fn_reabrir_inasistencias()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hoy date := (now() at time zone 'America/Bogota')::date;
begin
  -- Recuperación sin enlace: buscar la visita por nombre antes de reabrir.
  update recuperacion_pacientes r
  set asistio_fecha = (
    select min(v.fecha) from visitas v join pacientes p on p.id = v.paciente_id
    where fn_normalizar_nombre(p.nombre) = fn_normalizar_nombre(r.nombre)
      and v.fecha >= coalesce((r.cerrado_en at time zone 'America/Bogota')::date, r.fecha_cita)
      and not coalesce(v.es_venta_producto, false)
  )
  where r.estado_recuperacion = 'recuperado' and r.paciente_id is null
    and r.fecha_cita is not null and r.fecha_cita < v_hoy and r.asistio_fecha is null;

  update recuperacion_pacientes r
  set estado_recuperacion = 'en_proceso',
      reabierto_desde = r.fecha_cita,
      inasistencias = r.inasistencias + 1
  where r.estado_recuperacion = 'recuperado'
    and r.fecha_cita is not null and r.fecha_cita < v_hoy
    and r.asistio_fecha is null
    and (r.paciente_id is not null
         or exists (select 1 from pacientes p where fn_normalizar_nombre(p.nombre) = fn_normalizar_nombre(r.nombre)));

  update fidelizacion_casos c
  set estado = 'pendiente',
      reabierto_desde = c.fecha_cita,
      fecha_limite = c.fecha_cita + fn_fidelizacion_plazo_dias(c.tipo),
      inasistencias = c.inasistencias + 1,
      proximo_contacto = null,
      cerrado_en = null,
      cerrado_por = null,
      cerrado_por_nombre = null
  where c.estado = 'agendo_cita'
    and c.fecha_cita is not null and c.fecha_cita < v_hoy
    and c.asistio_fecha is null;
end;
$$;

revoke all on function fn_reabrir_inasistencias() from public, anon, authenticated;

-- Al llegar el paciente: además de lo de 0100, cierra solo los casos que se
-- habían reabierto por inasistencia.
create or replace function fn_marcar_asistencia_recuperacion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text;
begin
  if coalesce(new.es_venta_producto, false) or new.paciente_id is null then
    return new;
  end if;
  begin
    select fn_normalizar_nombre(nombre) into v_nombre from pacientes where id = new.paciente_id;

    update recuperacion_pacientes r
    set paciente_id = new.paciente_id
    where r.paciente_id is null
      and fn_normalizar_nombre(r.nombre) = v_nombre
      and (select count(*) from pacientes p where fn_normalizar_nombre(p.nombre) = v_nombre) = 1;

    update recuperacion_pacientes r
    set asistio_fecha = new.fecha
    where r.paciente_id = new.paciente_id
      and r.estado_recuperacion = 'recuperado'
      and r.asistio_fecha is null
      and (r.cerrado_en is null or new.fecha >= (r.cerrado_en at time zone 'America/Bogota')::date);

    update recuperacion_pacientes r
    set estado_recuperacion = 'recuperado', asistio_fecha = new.fecha
    where r.paciente_id = new.paciente_id
      and r.estado_recuperacion in ('pendiente', 'en_proceso')
      and r.reabierto_desde is not null
      and new.fecha >= r.reabierto_desde;

    update fidelizacion_casos c
    set asistio_fecha = new.fecha
    where c.paciente_id = new.paciente_id
      and c.estado = 'agendo_cita'
      and c.asistio_fecha is null
      and new.fecha > c.fecha_atencion;

    update fidelizacion_casos c
    set estado = 'agendo_cita', asistio_fecha = new.fecha, cerrado_en = now()
    where c.paciente_id = new.paciente_id
      and c.estado in ('pendiente', 'en_proceso')
      and c.reabierto_desde is not null
      and new.fecha >= c.reabierto_desde;
  exception when others then
    raise warning 'fn_marcar_asistencia_recuperacion: %', sqlerrm;
  end;
  return new;
end;
$$;

select cron.unschedule(jobname) from cron.job where jobname = 'reabrir-inasistencias';
select cron.schedule(
  'reabrir-inasistencias',
  '55 11 * * *', -- 11:55 UTC = 6:55am Bogotá, todos los días
  $$ select fn_reabrir_inasistencias(); $$
);
