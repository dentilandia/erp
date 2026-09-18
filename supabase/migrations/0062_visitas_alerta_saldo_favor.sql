-- Casilla para que consultorio marque que el paciente debe dejar saldo a
-- favor, aparte de la observación en texto libre — cuando está marcada,
-- recepción ve un aviso grande en rojo al cobrar (entre el bloque amarillo
-- de "registrado en consultorio" y el azul de "observación de consultorio").
-- Antes solo existía la observación en texto libre, que se podía pasar por
-- alto (como pasó con un caso real donde quedó anotada y nunca se cobró).
alter table visitas add column alerta_saldo_favor boolean not null default false;
