-- Marca si ya se trasladó el saldo de horas extra de este período (lo que
-- generó de extra, menos lo compensado desde el saldo anterior) a
-- perfiles.saldo_horas_extra_anterior — para no volver a trasladarlo dos
-- veces si se crean varios períodos seguidos.
alter table periodos_liquidacion add column saldo_trasladado boolean not null default false;
