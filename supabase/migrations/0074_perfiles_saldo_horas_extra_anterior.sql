-- Saldo de horas extra acumuladas ANTES de que el sistema empezara a
-- llevar el detalle día a día (ej. Dentilandia ya llevaba tiempo
-- funcionando cuando arrancamos a registrar esto) — un valor que admin
-- pone una sola vez como "punto de partida". A partir de la fecha en que
-- se guarda, ese saldo se va descontando solo con cada "Compensado" que
-- se marque de ahí en adelante (ver cargarReporte en Asistencia.tsx), sin
-- que admin tenga que ir actualizándolo a mano.
alter table perfiles add column saldo_horas_extra_anterior numeric not null default 0;
alter table perfiles add column saldo_horas_extra_anterior_fecha date;
