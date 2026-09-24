-- "Otro motivo" (horas extra que no son por atención de un paciente, ej.
-- una visita de la secretaría de salud) no tiene nombre de paciente — se usa
-- paciente_nombre = null como la señal de que la solicitud no es por
-- atención de paciente, en vez de un valor sentinela como "NA".
alter table asistencia_horas_extra alter column paciente_nombre drop not null;
