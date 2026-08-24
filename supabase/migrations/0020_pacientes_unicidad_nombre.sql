-- Candado a nivel de base de datos contra pacientes duplicados: además de la
-- validación del lado del cliente (PacienteAutocomplete), esto garantiza que
-- nunca se pueda insertar dos veces el mismo nombre (sin importar mayúsculas
-- o espacios extra), venga de donde venga la inserción.
create unique index if not exists pacientes_nombre_unico on pacientes (lower(trim(nombre)));
