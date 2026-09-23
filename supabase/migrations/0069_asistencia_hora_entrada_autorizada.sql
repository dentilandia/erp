-- Hora de inicio de jornada autorizada por admin para una persona en un día
-- puntual (ej. reunión desde las 8am en vez del 8:30 normal, o alguien
-- autorizado a entrar a las 10am ese día). Se usa como el "punto de partida"
-- real para contar horas trabajadas: llegar ANTES de esta hora (o de la
-- jornada normal si no hay ninguna autorizada) no debe sumar horas de más —
-- se cuenta desde la hora esperada, no desde la marca real si llegó temprano.
alter table asistencia_notas_dia add column hora_entrada_autorizada time;
