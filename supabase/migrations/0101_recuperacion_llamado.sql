-- Recuperación de pacientes: ¿al paciente ya se le hizo al menos una llamada?
-- El protocolo es primero llamar y, si no contesta, B2Chat. Del 11 al 17 de
-- noviembre muchos se contactaron solo por B2Chat; la lista los señala como
-- "Falta llamada".

alter table recuperacion_pacientes add column if not exists llamado boolean not null default false;

update recuperacion_pacientes r
set llamado = true
where exists (select 1 from recuperacion_pacientes_seguimientos s where s.recuperacion_id = r.id and s.llamo);

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
      llamado = llamado or new.llamo,
      fecha_cita = case when new.agendo_cita and new.fecha_cita is not null then new.fecha_cita else fecha_cita end,
      asistio_fecha = case when new.agendo_cita and new.fecha_cita is not null then null else asistio_fecha end
  where id = new.recuperacion_id;
  return new;
end;
$$;
