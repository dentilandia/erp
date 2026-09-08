-- Comprobante de datáfono: por ahora solo en Las Américas, se adjunta desde
-- el modal de Atención de Consultorio (obligatorio si se marca el check).
alter table visitas add column comprobante_datafono_url text;
