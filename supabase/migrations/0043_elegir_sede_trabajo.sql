-- Deja que alguien de operación elija en qué sede va a trabajar ESE día
-- (se desplaza a otra sede a cubrir o a cobrar, etc.), distinto de la sede
-- que tenga asignada por defecto. Esto tiene que actualizar perfiles.sede_id
-- de verdad — no solo un estado local — porque fn_perfil_sede() (con la que
-- están armadas casi todas las policies de RLS de operación) lee esa
-- columna directo de la base. Sin esto, el front mostraría la sede elegida
-- pero cualquier inserción/actualización real seguiría bloqueada contra la
-- sede vieja.
--
-- Se expone como función en vez de agregar una policy de "update propio"
-- genérica en perfiles, para no abrir la puerta a que alguien se cambie
-- rol/puede_caja_menor/etc. desde la consola del navegador — esta función
-- solo puede tocar sede_id, y solo la fila de quien la llama.
create or replace function fn_elegir_sede_trabajo(p_sede_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update perfiles set sede_id = p_sede_id where id = auth.uid();
end;
$$;

grant execute on function fn_elegir_sede_trabajo(uuid) to authenticated;
