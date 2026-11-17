-- Capacitación: "Completa tu perfil" no guardaba nada.
-- perfiles no tiene policy de UPDATE (los perfiles los administra Tomás), así que el
-- update desde capacitacion.html afectaba 0 filas sin error y la pantalla volvía a pedir
-- el cargo una y otra vez. Esta función deja que cada persona fije SOLO su cargo de
-- capacitación (y su nombre/sede si estaban vacíos), sin abrir el UPDATE de toda la tabla:
-- rol y sede siguen siendo de administración.

create or replace function fn_completar_perfil_capacitacion(p_nombre text, p_sede_id uuid, p_cargo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'No hay sesión iniciada';
  end if;
  if p_cargo is null or p_cargo not in ('recepcion', 'servicio-cliente', 'auxiliar') then
    raise exception 'Cargo no válido';
  end if;
  update perfiles
     set cargo = p_cargo,
         nombre = coalesce(nullif(trim(nombre), ''), nullif(trim(p_nombre), ''), nombre),
         sede_id = coalesce(sede_id, p_sede_id)
   where id = auth.uid();
  if not found then
    raise exception 'Tu cuenta todavía no tiene perfil en el ERP: pide a administración que lo cree';
  end if;
end;
$$;

revoke all on function fn_completar_perfil_capacitacion(text, uuid, text) from public, anon;
grant execute on function fn_completar_perfil_capacitacion(text, uuid, text) to authenticated;
