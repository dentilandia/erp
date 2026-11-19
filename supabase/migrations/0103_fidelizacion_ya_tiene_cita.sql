-- Presupuestos y Sedación: "Ya tiene cita agendada" + fecha en que viene el
-- paciente. Cierra el caso como 'agendo_cita' (con fecha_cita) sin exigir
-- la llamada; la asistencia se cruza sola con el ERP al llegar el paciente
-- a Recepción (fn_marcar_asistencia_recuperacion, 0100).
alter table fidelizacion_seguimientos
  add column if not exists ya_tenia_cita boolean not null default false;
