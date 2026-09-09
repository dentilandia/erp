-- Cuando alguien llega tarde o sale temprano pero ESE tiempo ya estaba
-- acumulado a su favor de un período anterior (autorizado), no se le debe
-- restar de nuevo de las horas de la semana — sería cobrarle el tiempo dos
-- veces. Este campo permite anotar cuántos minutos de esa diferencia ya
-- estaban compensados, para sumárselos de vuelta al cálculo de horas.
alter table asistencia_notas_dia add column minutos_compensados integer not null default 0;
