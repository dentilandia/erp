-- Se revierte el bloque automático de "aparatos de períodos anteriores"
-- (0076/0077): al probarlo, traía aparatos que ya se le habían liquidado a
-- otras doctoras en su período normal, porque no hay forma de distinguir
-- "nunca cobrado" de "ya cobrado en su momento" solo con la fecha. Tomás
-- prefiere seguir agregándolos él mismo a mano (editando mes_liquidacion en
-- Laboratorio operativo, como ya lo hacía) — ese mecanismo ya existente
-- sigue funcionando sin ningún cambio.
alter table lab_ordenes drop column liquidado_atrasado_en;
alter table liquidaciones_doctora drop column total_aparatos_atrasados;
