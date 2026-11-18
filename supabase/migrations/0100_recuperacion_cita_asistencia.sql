-- Recuperación de pacientes y listas de fidelización:
-- 1) "Agendó cita" pide la FECHA de la cita (la auxiliar la escribe: el ERP no
--    tiene agenda de citas futuras).
-- 2) Asistencia AUTOMÁTICA: cuando el paciente llega y Recepción crea su
--    visita, el caso agendado queda con asistio_fecha. Si la fecha de la cita
--    pasó y no hay visita, la pantalla lo muestra como "No asistió".
-- 3) Recuperación se enlaza con la ficha del paciente del ERP (paciente_id):
--    hoy ninguno está enlazado. Se enlazan por nombre cuando el nombre es
--    único, y de ahí en adelante al llegar el paciente a Recepción.
-- 4) recuperacion_pacientes.ultimo_contacto / intentos: para ver qué casos
--    "en proceso" llevan días sin que nadie los vuelva a contactar.

create or replace function fn_normalizar_nombre(p text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(trim(translate(coalesce(p, ''), 'ÁÉÍÓÚÜáéíóúüÑñ', 'AEIOUUaeiouuNn')), '\s+', ' ', 'g'));
$$;

-- ── Columnas ──────────────────────────────────────────────────────────────
alter table recuperacion_pacientes_seguimientos add column if not exists fecha_cita date;
alter table recuperacion_pacientes
  add column if not exists fecha_cita date,
  add column if not exists asistio_fecha date,
  add column if not exists ultimo_contacto date,
  add column if not exists intentos int not null default 0;

alter table fidelizacion_seguimientos add column if not exists fecha_cita date;
alter table fidelizacion_casos
  add column if not exists fecha_cita date,
  add column if not exists asistio_fecha date;

-- ── Enlace con la ficha del paciente (solo nombres únicos) ────────────────
update recuperacion_pacientes r
set paciente_id = p.id
from (
  select fn_normalizar_nombre(nombre) n, min(id::text)::uuid id
  from pacientes
  group by 1
  having count(*) = 1
) p
where r.paciente_id is null
  and fn_normalizar_nombre(r.nombre) = p.n;

-- ── Último contacto e intentos ────────────────────────────────────────────
update recuperacion_pacientes r
set ultimo_contacto = s.ultimo, intentos = s.n
from (
  select recuperacion_id, max(fecha_contacto) ultimo, count(*)::int n
  from recuperacion_pacientes_seguimientos group by 1
) s
where s.recuperacion_id = r.id;

create or replace function fn_recuperacion_registrar_seguimiento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update recuperacion_pacientes
  set ultimo_contacto = greatest(coalesce(ultimo_contacto, new.fecha_contacto), new.fecha_contacto),
      intentos = intentos + 1,
      fecha_cita = case when new.agendo_cita and new.fecha_cita is not null then new.fecha_cita else fecha_cita end,
      asistio_fecha = case when new.agendo_cita and new.fecha_cita is not null then null else asistio_fecha end
  where id = new.recuperacion_id;
  return new;
end;
$$;

drop trigger if exists trg_recuperacion_registrar_seguimiento on recuperacion_pacientes_seguimientos;
create trigger trg_recuperacion_registrar_seguimiento
  after insert on recuperacion_pacientes_seguimientos
  for each row execute function fn_recuperacion_registrar_seguimiento();

-- Fidelización: la fecha de la cita queda en el caso al registrar "Agendó cita".
create or replace function fn_fidelizacion_registrar_seguimiento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cierra boolean := new.resultado in ('agendo_cita', 'no_interesa', 'seguimiento_realizado', 'seguimiento_en_consulta');
begin
  if new.registrado_por_nombre is null and new.registrado_por is not null then
    select nombre into new.registrado_por_nombre from perfiles where id = new.registrado_por;
  end if;
  if new.medio is null then
    new.medio := case when new.b2chat then 'b2chat' when new.llamo then 'llamada' else null end;
  end if;

  update fidelizacion_casos
  set estado = case when v_cierra then new.resultado else 'en_proceso' end,
      proximo_contacto = case when v_cierra then null else new.proximo_contacto end,
      fecha_consulta = case when new.resultado = 'seguimiento_en_consulta' then new.fecha_consulta else fecha_consulta end,
      fecha_cita = case when new.resultado = 'agendo_cita' then new.fecha_cita else fecha_cita end,
      cerrado_en = case when v_cierra then now() else null end,
      cerrado_por = case when v_cierra then new.registrado_por else null end,
      cerrado_por_nombre = case when v_cierra then new.registrado_por_nombre else null end
  where id = new.caso_id;

  return new;
end;
$$;

-- ── Asistencia automática ─────────────────────────────────────────────────
-- Casos ya agendados: la primera visita desde el día en que se agendó.
update recuperacion_pacientes r
set asistio_fecha = (
  select min(v.fecha) from visitas v
  where v.paciente_id = r.paciente_id and v.fecha >= (r.cerrado_en at time zone 'America/Bogota')::date
    and not coalesce(v.es_venta_producto, false)
)
where r.estado_recuperacion = 'recuperado' and r.paciente_id is not null and r.asistio_fecha is null and r.cerrado_en is not null;

update fidelizacion_casos c
set asistio_fecha = (
  select min(v.fecha) from visitas v
  where v.paciente_id = c.paciente_id and v.fecha > c.fecha_atencion
    and v.fecha >= (c.cerrado_en at time zone 'America/Bogota')::date
    and not coalesce(v.es_venta_producto, false)
)
where c.estado = 'agendo_cita' and c.asistio_fecha is null and c.cerrado_en is not null;

-- Al llegar el paciente (Recepción crea la visita): enlaza su caso de
-- Recuperación si aún no estaba enlazado y marca la asistencia. Nunca debe
-- impedir que se cree la visita: cualquier error queda como aviso.
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

    update fidelizacion_casos c
    set asistio_fecha = new.fecha
    where c.paciente_id = new.paciente_id
      and c.estado = 'agendo_cita'
      and c.asistio_fecha is null
      and new.fecha > c.fecha_atencion;
  exception when others then
    raise warning 'fn_marcar_asistencia_recuperacion: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists trg_marcar_asistencia_recuperacion on visitas;
create trigger trg_marcar_asistencia_recuperacion
  after insert on visitas
  for each row execute function fn_marcar_asistencia_recuperacion();
