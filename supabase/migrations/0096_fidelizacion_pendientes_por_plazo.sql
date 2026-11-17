-- La notificación de las 7:05am y el aviso de Servicio al cliente contaban
-- como "por contactar hoy" TODOS los casos abiertos, aunque estuvieran en su
-- primer día con 6 (o 14) días de plazo por delante. Ahora se separan según
-- el plazo de cada lista (fn_fidelizacion_plazo_dias):
--   vencidos        → sin contacto y ya pasó el plazo (rojo)
--   por_vencer      → sin contacto, en los últimos 3 días del plazo (amarillo)
--   compromisos_hoy → ya contactados, con fecha de volver a contactar hoy o antes
--   a_tiempo        → sin contacto y con plazo de sobra (verde): se pueden adelantar
-- "Urgentes para hoy" = vencidos + por vencer + compromisos de hoy.
-- Mantener igual a semaforo() / esParaHoy() en FidelizacionLista.tsx.

drop function if exists fn_fidelizacion_pendientes(date);

create function fn_fidelizacion_pendientes(p_fecha date)
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
             when c.estado = 'pendiente' and p_fecha >= c.fecha_limite - 2 then 'por_vencer'
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
  v_titulo text;
  v_cuerpo text;
  v_consolidado text := '';
  v_urg_total int := 0;
  v_tiempo_total int := 0;
begin
  if not fn_dia_habil(v_hoy) then
    return;
  end if;

  for v_sede in
    select s.sede_id, s.sede_nombre,
           sum(s.urgentes)::int as urgentes,
           sum(s.vencidos)::int as vencidos,
           sum(s.por_vencer)::int as por_vencer,
           sum(s.compromisos_hoy)::int as compromisos,
           sum(s.a_tiempo)::int as a_tiempo,
           string_agg(
             case s.tipo
               when 'presupuesto' then 'Presupuestos'
               when 'sedacion' then 'Sedación'
               when 'primera_vez' then 'Primeras veces'
               when 'radiografia' then 'Radiografías'
               else 'Seguimiento de procedimientos'
             end || ' (' || s.plazo_dias || ' días): '
             || case when s.urgentes > 0 then s.urgentes || ' urgente' || case when s.urgentes = 1 then '' else 's' end else '0 urgentes' end
             || case when s.a_tiempo > 0 then ', ' || s.a_tiempo || ' a tiempo' else '' end,
             E'\n' order by s.tipo) as detalle
    from fn_fidelizacion_pendientes(v_hoy) s
    group by s.sede_id, s.sede_nombre
  loop
    if v_sede.urgentes > 0 then
      v_titulo := 'Fidelización — hoy: ' || v_sede.urgentes || ' urgentes por contactar';
      v_cuerpo := 'En ' || v_sede.sede_nombre || ' hoy debes contactar ' || v_sede.urgentes || ' pacientes: '
        || v_sede.vencidos || ' vencidos, ' || v_sede.por_vencer || ' por vencer y '
        || v_sede.compromisos || ' compromisos de llamar hoy.';
    else
      v_titulo := 'Fidelización — hoy: sin casos urgentes';
      v_cuerpo := 'En ' || v_sede.sede_nombre || ' no hay casos vencidos, por vencer ni compromisos para hoy.';
    end if;
    if v_sede.a_tiempo > 0 then
      v_cuerpo := v_cuerpo || E'\n' || v_sede.a_tiempo || ' más están a tiempo: puedes adelantarlos.';
    end if;
    v_cuerpo := v_cuerpo || E'\n' || v_sede.detalle;

    insert into notificaciones (perfil_id, tipo, fecha_referencia, titulo, cuerpo)
    select p.id, 'fidelizacion_agenda_dia', v_hoy, v_titulo, v_cuerpo
    from perfiles p
    where fn_es_auxiliar_servicio_cliente(p.cargo) and p.sede_id = v_sede.sede_id
    on conflict (perfil_id, tipo, fecha_referencia)
    do update set titulo = excluded.titulo, cuerpo = excluded.cuerpo, created_at = now(), leida_en = null;

    v_urg_total := v_urg_total + v_sede.urgentes;
    v_tiempo_total := v_tiempo_total + v_sede.a_tiempo;
    v_consolidado := v_consolidado || E'\n' || '• ' || v_sede.sede_nombre || ': ' || v_sede.urgentes || ' urgentes ('
      || v_sede.vencidos || ' vencidos, ' || v_sede.por_vencer || ' por vencer, ' || v_sede.compromisos
      || ' compromisos) y ' || v_sede.a_tiempo || ' a tiempo';
  end loop;

  if v_urg_total + v_tiempo_total > 0 then
    insert into notificaciones (perfil_id, tipo, fecha_referencia, titulo, cuerpo)
    select p.id, 'fidelizacion_agenda_dia_consolidado', v_hoy,
           'Fidelización — hoy: ' || v_urg_total || ' urgentes por contactar',
           'Casos urgentes = vencidos + por vencer (últimos 3 días del plazo) + compromisos de llamar hoy. '
           || 'Plazos: 7 días (presupuestos, sedación, primeras veces, seguimientos) y 15 días (radiografías).'
           || v_consolidado
    from perfiles p where p.rol = 'admin'
    on conflict (perfil_id, tipo, fecha_referencia)
    do update set titulo = excluded.titulo, cuerpo = excluded.cuerpo, created_at = now(), leida_en = null;
  end if;
end;
$$;

revoke all on function fn_notificar_fidelizacion() from public, anon, authenticated;
