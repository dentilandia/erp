-- Ajustes de Servicio al cliente (23 nov):
-- 1) "Urgencia aparato" ya no genera Seguimiento de procedimientos. Se
--    quitan los casos abiertos que solo existían por ese motivo y aún no
--    tenían contactos.
-- 2) Seguimiento de procedimientos se hace el DÍA 8 después de la atención
--    (fecha_limite = atención + 8): antes de ese día no es urgente, ese día es
--    "para hoy" y después está vencido (ventana de 0 días, vs. 2 en las demás).
-- 3) En Seguimiento de procedimientos, si no contesta (ni llamada ni
--    mensaje) queda en proceso con compromiso para el día siguiente; si al
--    día siguiente tampoco contesta, se cierra solo como 'no_contesto'
--    (sale de la lista; no se vuelve a retomar).
-- 4) Un caso que no asistió a su cita se reabre como 'en_proceso' (ya se
--    estaba gestionando) con compromiso de contactarlo ese mismo día, no
--    como 'pendiente' / vencido.
-- 5) visitas.motivo_no_agendo: por qué el paciente no agendó su próxima cita
--    (ej. remitido a ortodoncia).

-- ── 1. Urgencia aparato fuera de la regla ─────────────────────────────────
create or replace function fn_motivos_con_seguimiento()
returns text[]
language sql
immutable
as $$
  select array[
    'Operatoria', 'Endodoncia', 'Exodoncia', 'Frenillectomía',
    'Sedación intravenosa', 'Sedación óxido nitroso',
    'Instalación', 'Trauma dental'
  ];
$$;

delete from fidelizacion_casos c
using visitas v
where v.id = c.visita_id
  and c.tipo = 'seguimiento_procedimiento'
  and c.estado in ('pendiente', 'en_proceso')
  and not exists (select 1 from unnest(v.motivos_cita) m where m = any (fn_motivos_con_seguimiento()))
  and not exists (select 1 from fidelizacion_seguimientos s where s.caso_id = c.id);

-- El detalle de los que quedan ya no menciona la urgencia.
update fidelizacion_casos c
set detalle = (
  select array_to_string(array_agg(m), ', ')
  from unnest(v.motivos_cita) m where m = any (fn_motivos_con_seguimiento())
) || coalesce(' — ' || nullif(trim(coalesce(v.tratamiento_detalle, '')), ''), '')
from visitas v
where v.id = c.visita_id and c.tipo = 'seguimiento_procedimiento'
  and 'Urgencia aparato' = any (v.motivos_cita)
  and exists (select 1 from unnest(v.motivos_cita) m where m = any (fn_motivos_con_seguimiento()));

-- ── 2. Seguimiento el día 8 ───────────────────────────────────────────────
create or replace function fn_fidelizacion_plazo_dias(p_tipo text)
returns int
language sql
immutable
as $$
  select case p_tipo when 'radiografia' then 15 when 'seguimiento_procedimiento' then 8 else 7 end;
$$;

-- Días antes del límite en que el caso ya cuenta como urgente ("por vencer").
create or replace function fn_fidelizacion_ventana_dias(p_tipo text)
returns int
language sql
immutable
as $$
  select case p_tipo when 'seguimiento_procedimiento' then 0 else 2 end;
$$;

update fidelizacion_casos
set fecha_limite = fecha_atencion + 8
where tipo = 'seguimiento_procedimiento' and reabierto_desde is null;

create or replace function fn_fidelizacion_pendientes(p_fecha date)
returns table (
  sede_id uuid,
  sede_nombre text,
  tipo text,
  plazo_dias int,
  vencidos int,
  por_vencer int,
  compromisos_hoy int,
  a_tiempo int,
  urgentes int
)
language sql
stable
security definer
set search_path = public
as $$
  with c as (
    select c.sede_id, se.nombre as sede_nombre, c.tipo,
           case
             when c.estado = 'pendiente' and p_fecha > c.fecha_limite then 'vencido'
             when c.estado = 'pendiente' and p_fecha >= c.fecha_limite - fn_fidelizacion_ventana_dias(c.tipo) then 'por_vencer'
             when c.estado = 'pendiente' then 'a_tiempo'
             when c.estado = 'en_proceso' and c.proximo_contacto is not null and c.proximo_contacto <= p_fecha then 'compromiso'
             else 'otro'
           end as franja
    from fidelizacion_casos c
    join sedes se on se.id = c.sede_id
    where c.estado in ('pendiente', 'en_proceso')
      and c.fecha_atencion <= p_fecha
  )
  select sede_id, sede_nombre, tipo, fn_fidelizacion_plazo_dias(tipo),
         count(*) filter (where franja = 'vencido')::int,
         count(*) filter (where franja = 'por_vencer')::int,
         count(*) filter (where franja = 'compromiso')::int,
         count(*) filter (where franja = 'a_tiempo')::int,
         count(*) filter (where franja in ('vencido', 'por_vencer', 'compromiso'))::int
  from c
  where franja <> 'otro'
  group by sede_id, sede_nombre, tipo;
$$;

-- ── 3. No contestó → se cierra ────────────────────────────────────────────
alter table fidelizacion_casos drop constraint if exists fidelizacion_casos_estado_check;
alter table fidelizacion_casos add constraint fidelizacion_casos_estado_check
  check (estado in ('pendiente', 'en_proceso', 'agendo_cita', 'no_interesa', 'seguimiento_realizado', 'seguimiento_en_consulta', 'no_contesto'));
alter table fidelizacion_seguimientos drop constraint if exists fidelizacion_seguimientos_resultado_check;
alter table fidelizacion_seguimientos add constraint fidelizacion_seguimientos_resultado_check
  check (resultado in ('no_contesta', 'volver_a_contactar', 'agendo_cita', 'no_interesa', 'seguimiento_realizado', 'seguimiento_en_consulta', 'no_contesto'));

create or replace function fn_fidelizacion_registrar_seguimiento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tipo text;
  v_cierra boolean;
begin
  select tipo into v_tipo from fidelizacion_casos where id = new.caso_id;

  -- Seguimiento de procedimientos: segundo "no contesta" → se cierra solo;
  -- el primero deja compromiso para el día siguiente.
  if v_tipo = 'seguimiento_procedimiento' and new.resultado = 'no_contesta' then
    if exists (select 1 from fidelizacion_seguimientos s where s.caso_id = new.caso_id and s.resultado = 'no_contesta') then
      new.resultado := 'no_contesto';
      new.proximo_contacto := null;
    elsif new.proximo_contacto is null then
      new.proximo_contacto := new.fecha_contacto + 1;
    end if;
  end if;

  v_cierra := new.resultado in ('agendo_cita', 'no_interesa', 'seguimiento_realizado', 'seguimiento_en_consulta', 'no_contesto');

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

-- ── 4. Inasistencia → en proceso, no pendiente ────────────────────────────
create or replace function fn_reabrir_inasistencias()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hoy date := (now() at time zone 'America/Bogota')::date;
begin
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
  set estado = 'en_proceso',
      reabierto_desde = c.fecha_cita,
      fecha_limite = c.fecha_cita + fn_fidelizacion_plazo_dias(c.tipo),
      inasistencias = c.inasistencias + 1,
      proximo_contacto = v_hoy,
      cerrado_en = null,
      cerrado_por = null,
      cerrado_por_nombre = null
  where c.estado = 'agendo_cita'
    and c.fecha_cita is not null and c.fecha_cita < v_hoy
    and c.asistio_fecha is null;
end;
$$;

-- Casos ya reabiertos como pendientes: pasan a en proceso con compromiso hoy.
update fidelizacion_casos
set estado = 'en_proceso',
    proximo_contacto = coalesce(proximo_contacto, (now() at time zone 'America/Bogota')::date)
where estado = 'pendiente' and reabierto_desde is not null;

-- ── 5. Motivo de no agendar la próxima cita ───────────────────────────────
alter table visitas add column if not exists motivo_no_agendo text;
