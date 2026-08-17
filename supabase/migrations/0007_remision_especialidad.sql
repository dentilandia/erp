-- Control de pacientes remitidos a otra especialidad (endodoncia, etc.)
-- desde consultorio, para poder darles seguimiento.
alter table visitas add column if not exists remision_especialidad text;
