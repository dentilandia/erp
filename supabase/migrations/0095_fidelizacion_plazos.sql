-- Plazos de contacto por lista de fidelización:
--   Presupuestos, Sedación, Primeras veces, Seguimiento de procedimientos → 7 días
--   Radiografías → 15 días
-- Mantener igual a PLAZO_DIAS en src/lib/fidelizacion.ts.

create or replace function fn_fidelizacion_plazo_dias(p_tipo text)
returns int
language sql
immutable
as $$
  select case p_tipo when 'radiografia' then 15 else 7 end;
$$;

create or replace function fn_fidelizacion_sincronizar_visita()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tipos text[] := '{}';
  v_tipo text;
  v_motivos_seg text[];
  v_detalle text;
  v_detalle_seg text;
begin
  if coalesce(new.es_venta_producto, false) then
    return new;
  end if;

  if new.se_recomendo_sedacion then
    v_tipos := array_append(v_tipos, 'sedacion');
  elsif new.se_entrego_presupuesto then
    v_tipos := array_append(v_tipos, 'presupuesto');
  end if;
  if new.es_primera_vez then v_tipos := array_append(v_tipos, 'primera_vez'); end if;
  if new.se_mando_radiografia then v_tipos := array_append(v_tipos, 'radiografia'); end if;

  select coalesce(array_agg(m), '{}') into v_motivos_seg
  from unnest(coalesce(new.motivos_cita, '{}')) m
  where m = any (fn_motivos_con_seguimiento());
  if cardinality(v_motivos_seg) > 0 then
    v_tipos := array_append(v_tipos, 'seguimiento_procedimiento');
  end if;

  v_detalle := nullif(trim(coalesce(new.tratamiento, '')), '');
  v_detalle_seg := array_to_string(v_motivos_seg, ', ')
    || coalesce(' — ' || nullif(trim(coalesce(new.tratamiento_detalle, '')), ''), '');

  foreach v_tipo in array v_tipos loop
    insert into fidelizacion_casos (tipo, visita_id, paciente_id, sede_id, doctora_id, fecha_atencion, fecha_limite, detalle)
    values (v_tipo, new.id, new.paciente_id, new.sede_id, new.doctora_id, new.fecha,
            new.fecha + fn_fidelizacion_plazo_dias(v_tipo),
            case when v_tipo = 'seguimiento_procedimiento' then v_detalle_seg else v_detalle end)
    on conflict (visita_id, tipo) do update
      set doctora_id = excluded.doctora_id,
          sede_id = excluded.sede_id,
          fecha_atencion = excluded.fecha_atencion,
          fecha_limite = excluded.fecha_limite,
          detalle = excluded.detalle;
  end loop;

  delete from fidelizacion_casos c
  where c.visita_id = new.id
    and not (c.tipo = any (v_tipos))
    and not exists (select 1 from fidelizacion_seguimientos s where s.caso_id = c.id);

  return new;
end;
$$;

-- Casos de radiografía que ya existían: al nuevo plazo.
update fidelizacion_casos
set fecha_limite = fecha_atencion + fn_fidelizacion_plazo_dias(tipo)
where fecha_limite <> fecha_atencion + fn_fidelizacion_plazo_dias(tipo);

-- Aviso del buzón: "pasaron la semana" ya no aplica a todas las listas.
do $$
declare
  v_def text;
begin
  select pg_get_functiondef('fn_notificar_fidelizacion()'::regprocedure) into v_def;
  v_def := replace(v_def, 'ya pasaron la semana sin contacto.', 'ya pasaron su plazo sin contacto.');
  execute v_def;
end;
$$;
