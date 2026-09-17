-- Permite marcar un intento bloqueado como "leído" para que desaparezca de
-- la alerta activa (sin borrarlo — el registro queda para el historial).
alter table asistencia_intentos_bloqueados add column leido boolean not null default false;

create policy asistencia_intentos_bloqueados_update on asistencia_intentos_bloqueados for update using (fn_es_admin());
