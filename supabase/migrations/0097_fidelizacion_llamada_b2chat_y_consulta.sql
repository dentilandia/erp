-- Registro de contacto de las listas de fidelización en dos pasos, como en
-- Recuperación de pacientes: 1) llamada, 2) si no contestó, B2Chat. Los dos
-- pasos pueden quedar en el mismo registro (llamo + b2chat).
-- Además, en Seguimiento de procedimientos el seguimiento se puede hacer en
-- la consulta del paciente: resultado 'seguimiento_en_consulta' + la fecha
-- de esa consulta, que cierra el caso.

alter table fidelizacion_seguimientos
  add column if not exists llamo boolean not null default false,
  add column if not exists b2chat boolean not null default false,
  add column if not exists fecha_consulta date;

-- `medio` queda como dato histórico (los registros anteriores eligieron uno
-- solo); los nuevos lo llenan con el último paso hecho.
alter table fidelizacion_seguimientos alter column medio drop not null;
update fidelizacion_seguimientos
set llamo = (medio = 'llamada'), b2chat = (medio = 'b2chat')
where not llamo and not b2chat;

alter table fidelizacion_seguimientos drop constraint if exists fidelizacion_seguimientos_resultado_check;
alter table fidelizacion_seguimientos add constraint fidelizacion_seguimientos_resultado_check
  check (resultado in ('no_contesta', 'volver_a_contactar', 'agendo_cita', 'no_interesa', 'seguimiento_realizado', 'seguimiento_en_consulta'));

alter table fidelizacion_casos add column if not exists fecha_consulta date;
alter table fidelizacion_casos drop constraint if exists fidelizacion_casos_estado_check;
alter table fidelizacion_casos add constraint fidelizacion_casos_estado_check
  check (estado in ('pendiente', 'en_proceso', 'agendo_cita', 'no_interesa', 'seguimiento_realizado', 'seguimiento_en_consulta'));

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
      cerrado_en = case when v_cierra then now() else null end,
      cerrado_por = case when v_cierra then new.registrado_por else null end,
      cerrado_por_nombre = case when v_cierra then new.registrado_por_nombre else null end
  where id = new.caso_id;

  return new;
end;
$$;

-- Meta diaria: llamadas y B2Chat de fidelización salen de los nuevos checks.
do $$
declare
  v_def text;
begin
  select pg_get_functiondef('fn_resumen_recuperacion_dia(date)'::regprocedure) into v_def;
  v_def := replace(v_def, 'f.medio = ''llamada'', f.medio = ''b2chat''', 'f.llamo, f.b2chat');
  if v_def not like '%f.llamo, f.b2chat%' then
    raise exception 'fn_resumen_recuperacion_dia no tiene la forma esperada';
  end if;
  execute v_def;
end;
$$;
