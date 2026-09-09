-- Generaliza la tabla de vacaciones para cubrir también incapacidad — ambas
-- son días que no deben contar como "déficit" de horas en el reporte
-- semanal (se les resta 8.5h, la jornada ordinaria, de la meta de esa
-- semana). Tabla estaba vacía (la función nunca se llegó a construir en el
-- frontend), así que renombrar es seguro.
alter table asistencia_vacaciones rename to asistencia_ausencias;
alter table asistencia_ausencias add column tipo text not null default 'vacaciones' check (tipo in ('vacaciones', 'incapacidad'));
alter table asistencia_ausencias alter column tipo drop default;

alter policy asistencia_vacaciones_select on asistencia_ausencias rename to asistencia_ausencias_select;
alter policy asistencia_vacaciones_write on asistencia_ausencias rename to asistencia_ausencias_write;
