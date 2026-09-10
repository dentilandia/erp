-- Descanso sabatino: algunas personas descansan un sábado al mes (por
-- turnos). Ese día no debe contar como déficit de horas en el reporte
-- semanal — reutiliza el mismo mecanismo de vacaciones/incapacidad
-- (resta la jornada ordinaria de ese día, 4h el sábado, de la meta de la
-- semana), solo que como un tercer tipo de ausencia.
alter table asistencia_ausencias drop constraint asistencia_ausencias_tipo_check;
alter table asistencia_ausencias add constraint asistencia_ausencias_tipo_check
  check (tipo in ('vacaciones', 'incapacidad', 'descanso'));
