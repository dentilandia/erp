-- Recuperación de pacientes: dos formas más de registrar un seguimiento,
-- sin que haga falta la llamada:
--   ya_tenia_cita     → la auxiliar encuentra que el paciente ya tiene cita
--                       agendada: se registra con su fecha y queda recuperado
--                       (agendo_cita = true + fecha_cita).
--   paciente_escribio → el paciente o los papás escribieron para agendar
--                       (el contacto lo inició la familia).
alter table recuperacion_pacientes_seguimientos
  add column if not exists ya_tenia_cita boolean not null default false,
  add column if not exists paciente_escribio boolean not null default false;
