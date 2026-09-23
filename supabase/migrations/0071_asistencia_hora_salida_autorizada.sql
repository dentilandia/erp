-- Simétrico a hora_entrada_autorizada (migración 0069): registrar que una
-- salida antes de la hora normal quedó revisada y autorizada por admin ese
-- día puntual (ej. permiso para salir más temprano). No cambia el cálculo de
-- horas trabajadas (salir temprano sí reduce las horas trabajadas de verdad;
-- para perdonar ese faltante existe "Compensado de tiempo") — solo apaga la
-- alerta del dashboard una vez que ya se revisó.
alter table asistencia_notas_dia add column hora_salida_autorizada time;
