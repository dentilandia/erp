-- Para poder avisar en Liquidaciones cuando un laboratorio se edita/marca
-- instalado DESPUÉS de que ya se guardó la liquidación de esa doctora para
-- ese período (Tomás lo pidió: la "foto" que se guarda no se actualiza
-- sola, así que si algo cambia después hay que verlo a simple vista en vez
-- de confiar en acordarse). set_updated_at() ya existe (0011_cierre_caja.sql).
alter table liquidaciones_doctora add column updated_at timestamptz not null default now();

drop trigger if exists trg_liquidaciones_doctora_updated on liquidaciones_doctora;
create trigger trg_liquidaciones_doctora_updated
before update on liquidaciones_doctora
for each row execute function set_updated_at();

drop trigger if exists trg_lab_ordenes_updated on lab_ordenes;
create trigger trg_lab_ordenes_updated
before update on lab_ordenes
for each row execute function set_updated_at();
