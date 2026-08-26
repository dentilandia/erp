-- Retención por depuración de renta: un valor independiente de la retención
-- voluntaria. Se conoce después de que la doctora entrega la cuenta de cobro
-- y el formato de depuración diligenciado (salud prepagada, interés
-- hipotecario, dependientes económicos) — solo guardamos el valor final en
-- pesos que se resta del total a pagar, ya calculado por fuera.
alter table liquidaciones_doctora add column if not exists retencion_depuracion_valor numeric(12,2) not null default 0;
