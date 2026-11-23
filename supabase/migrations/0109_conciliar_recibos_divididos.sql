-- El sistema de facturación a veces parte un solo cobro del ERP en varios
-- recibos (ej. $294.000 facturados como recibo de $200.000 + recibo de
-- $94.000, mismo paciente, misma fecha, mismo medio). El cruce ya agrupaba
-- varios cobros del ERP contra un solo recibo (agrupado_paciente), pero no
-- al revés: varios recibos contra un solo cobro del ERP. Se agrega ese
-- sentido faltante como última pasada de recibos.
--
-- Para poder guardar varios enlaces tipo 'recibo' con el mismo cargo_pago_id
-- (uno por cada recibo del grupo), hay que relajar el índice único que antes
-- solo permitía un enlace 'recibo' por cada pago del ERP: ahora se permite
-- más de uno, siempre que no se repita exactamente el mismo par pago-recibo.
drop index if exists uq_enlace_recibo_cargo;
drop index if exists uq_enlace_recibo_saldo;
create unique index if not exists uq_enlace_recibo_cargo_recibo
  on conciliacion_enlaces (cargo_pago_id, recibo_id) where tipo = 'recibo';
create unique index if not exists uq_enlace_recibo_saldo_recibo
  on conciliacion_enlaces (saldo_id, recibo_id) where tipo = 'recibo';

create or replace function fn_conciliar_cierre(p_desde date, p_hasta date)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_pago record;
  v_grupo record;
  v_mov_id uuid;
  v_rec_id uuid;
  v_pago_id uuid;
  v_pago_origen text;
  v_ini date := p_desde - 5;
  v_fin date := p_hasta + 5;
  n_exacto int := 0;
  n_tarjeta int := 0;
  n_agrupado int := 0;
  v_nivel int;
  n_consig int := 0;
  n_recibos int := 0;
  n_recibos_grupo int := 0;
  n_recibos_grupo_rec int := 0;
begin
  if auth.uid() is not null and not fn_es_admin() then
    raise exception 'Solo un administrador puede conciliar.';
  end if;

  delete from conciliacion_enlaces e
  using banco_movimientos m
  where e.movimiento_id = m.id and e.origen = 'automatico' and m.fecha between v_ini and v_fin;
  delete from conciliacion_enlaces e
  using recibos_sistema r
  where e.recibo_id = r.id and e.origen = 'automatico' and r.fecha between v_ini and v_fin;
  update banco_movimientos m set estado = 'pendiente'
  where m.estado = 'conciliado' and m.fecha between v_ini and v_fin
    and not exists (select 1 from conciliacion_enlaces e where e.movimiento_id = m.id);
  update recibos_sistema r set estado = 'pendiente'
  where r.estado = 'conciliado' and r.fecha between v_ini and v_fin
    and not exists (select 1 from conciliacion_enlaces e where e.recibo_id = r.id);

  update banco_movimientos m set categoria = 'traslado_interno', estado = 'no_aplica',
         nota = coalesce(m.nota, 'Traslado entre cuentas propias (detectado automáticamente)')
  where m.fecha between v_ini and v_fin and m.estado = 'pendiente'
    and m.categoria in ('transferencia_paciente', 'otro_ingreso', 'egreso')
    and m.descripcion ilike 'TRANSFERENCIA CTA SUC VIRTUAL%'
    and exists (
      select 1 from banco_movimientos o
      where o.cuenta <> m.cuenta and o.fecha = m.fecha and o.valor = -m.valor
        and o.descripcion ilike 'TRANSFERENCIA CTA SUC VIRTUAL%');

  for v_pago in
    select p.* from v_cierre_pagos_erp p
    where p.sede = 'Fabricato' and p.medio in ('tarjeta_debito', 'tarjeta_credito')
      and p.fecha between p_desde - 1 and p_hasta + 1
      and not exists (
        select 1 from conciliacion_enlaces e
        where e.tipo = 'banco' and (e.cargo_pago_id = p.id or e.saldo_id = p.id))
    order by p.fecha, p.valor desc
  loop
    select m.id into v_mov_id
    from banco_movimientos m
    where m.cuenta = 'bold_fabricato' and m.categoria = 'datafono' and m.estado = 'pendiente'
      and m.valor = v_pago.valor and m.fecha between v_pago.fecha - 1 and v_pago.fecha + 1
      and not exists (select 1 from conciliacion_enlaces e where e.movimiento_id = m.id)
    order by abs(m.fecha - v_pago.fecha), m.fecha, m.created_at
    limit 1;
    if v_mov_id is not null then
      insert into conciliacion_enlaces (tipo, movimiento_id, cargo_pago_id, saldo_id, regla)
      values ('banco', v_mov_id,
              case when v_pago.origen = 'cargo' then v_pago.id end,
              case when v_pago.origen = 'saldo' then v_pago.id end,
              'tarjeta_exacta');
      update banco_movimientos set estado = 'conciliado' where id = v_mov_id;
      n_tarjeta := n_tarjeta + 1;
      v_mov_id := null;
    end if;
  end loop;

  for v_pago in
    select p.* from v_cierre_pagos_erp p
    where p.medio = 'transferencia_debito' and p.fecha between p_desde - 3 and p_hasta + 3
      and not exists (
        select 1 from conciliacion_enlaces e
        where e.tipo = 'banco' and (e.cargo_pago_id = p.id or e.saldo_id = p.id))
    order by p.fecha, p.valor desc
  loop
    select m.id into v_mov_id
    from banco_movimientos m
    where m.categoria = 'transferencia_paciente'
      and m.sede = v_pago.sede
      and m.estado = 'pendiente'
      and m.valor = v_pago.valor
      and m.fecha between v_pago.fecha - 2 and v_pago.fecha + 3
      and not exists (select 1 from conciliacion_enlaces e where e.movimiento_id = m.id)
    order by (m.sede <> v_pago.sede), abs(m.fecha - v_pago.fecha), m.fecha, m.created_at
    limit 1;
    if v_mov_id is not null then
      insert into conciliacion_enlaces (tipo, movimiento_id, cargo_pago_id, saldo_id, regla)
      values ('banco', v_mov_id,
              case when v_pago.origen = 'cargo' then v_pago.id end,
              case when v_pago.origen = 'saldo' then v_pago.id end,
              'exacto');
      update banco_movimientos set estado = 'conciliado' where id = v_mov_id;
      n_exacto := n_exacto + 1;
      v_mov_id := null;
    end if;
  end loop;

  for v_nivel in 0..3 loop
    for v_grupo in
      select p.fecha, min(p.sede) as sede, sum(p.valor) as total,
             array_agg(p.id) as ids, array_agg(p.origen) as origenes,
             (min(p.medio) like 'tarjeta%') as es_tarjeta
      from v_cierre_pagos_erp p
      where p.fecha between p_desde - 3 and p_hasta + 3
        and (p.medio = 'transferencia_debito'
             or (p.sede = 'Fabricato' and p.medio in ('tarjeta_debito', 'tarjeta_credito')))
        and fn_clave_familia(p.paciente, p.paciente_id, v_nivel) is not null
        and not exists (
          select 1 from conciliacion_enlaces e
          where e.tipo = 'banco' and (e.cargo_pago_id = p.id or e.saldo_id = p.id))
      group by p.fecha, (p.medio like 'tarjeta%'), fn_clave_familia(p.paciente, p.paciente_id, v_nivel)
      having count(*) > 1
    loop
      select m.id into v_mov_id
      from banco_movimientos m
      where m.estado = 'pendiente' and m.valor = v_grupo.total
        and m.fecha between v_grupo.fecha - 2 and v_grupo.fecha + 3
        and ((not v_grupo.es_tarjeta and m.categoria = 'transferencia_paciente')
             or (v_grupo.es_tarjeta and m.cuenta = 'bold_fabricato' and m.categoria = 'datafono'))
        and not exists (select 1 from conciliacion_enlaces e where e.movimiento_id = m.id)
      order by (m.sede <> v_grupo.sede), abs(m.fecha - v_grupo.fecha), m.fecha
      limit 1;
      if v_mov_id is not null then
        insert into conciliacion_enlaces (tipo, movimiento_id, cargo_pago_id, saldo_id, regla)
        select 'banco', v_mov_id,
               case when o = 'cargo' then i end,
               case when o = 'saldo' then i end,
               case when v_nivel = 0 then 'agrupado_paciente' else 'agrupado_familia' end
        from unnest(v_grupo.ids, v_grupo.origenes) as u(i, o);
        update banco_movimientos set estado = 'conciliado' where id = v_mov_id;
        n_agrupado := n_agrupado + 1;
        v_mov_id := null;
      end if;
    end loop;
  end loop;

  for v_pago in
    select p.* from v_cierre_pagos_erp p
    where p.medio = 'transferencia_debito' and p.fecha between p_desde - 3 and p_hasta + 3
      and not exists (
        select 1 from conciliacion_enlaces e
        where e.tipo = 'banco' and (e.cargo_pago_id = p.id or e.saldo_id = p.id))
    order by p.fecha, p.valor desc
  loop
    select m.id into v_mov_id
    from banco_movimientos m
    where m.categoria = 'transferencia_paciente'
      and m.estado = 'pendiente'
      and m.valor = v_pago.valor
      and m.fecha between v_pago.fecha - 2 and v_pago.fecha + 3
      and not exists (select 1 from conciliacion_enlaces e where e.movimiento_id = m.id)
    order by (m.sede <> v_pago.sede), abs(m.fecha - v_pago.fecha), m.fecha, m.created_at
    limit 1;
    if v_mov_id is not null then
      insert into conciliacion_enlaces (tipo, movimiento_id, cargo_pago_id, saldo_id, regla)
      values ('banco', v_mov_id,
              case when v_pago.origen = 'cargo' then v_pago.id end,
              case when v_pago.origen = 'saldo' then v_pago.id end,
              'exacto');
      update banco_movimientos set estado = 'conciliado' where id = v_mov_id;
      n_exacto := n_exacto + 1;
      v_mov_id := null;
    end if;
  end loop;

  delete from conciliacion_enlaces e
  using banco_movimientos m
  where e.tipo = 'consignacion' and e.movimiento_id = m.id and e.origen = 'automatico'
    and m.fecha between v_ini and v_fin;
  update banco_movimientos m set estado = 'pendiente'
  where m.categoria = 'consignacion_efectivo' and m.estado = 'conciliado' and m.fecha between v_ini and v_fin
    and not exists (select 1 from conciliacion_enlaces e where e.movimiento_id = m.id);

  for v_grupo in
    select fn_sede_clave(s.nombre) as sede, d.fecha_consignacion as fc,
           array_agg(d.id) as dias_ids,
           sum(coalesce(f.efectivo_neto, 0)) as esperado
    from cierres_diarios d
    join sedes s on s.id = d.sede_id
    left join v_cierre_facturado_vivo f on f.fecha = d.fecha and f.sede = fn_sede_clave(s.nombre)
    where d.consignado and d.fecha_consignacion between v_ini and v_fin
    group by 1, 2
  loop
    for i in 0..2 loop
      if (select coalesce(sum(m.valor), -1) from banco_movimientos m
          where m.sede = v_grupo.sede and m.categoria = 'consignacion_efectivo' and m.estado = 'pendiente'
            and m.fecha = v_grupo.fc + i) = v_grupo.esperado then
        insert into conciliacion_enlaces (tipo, movimiento_id, cierre_diario_id, regla)
        select 'consignacion', m.id, dia, 'consignacion_fecha'
        from banco_movimientos m, unnest(v_grupo.dias_ids) as dia
        where m.sede = v_grupo.sede and m.categoria = 'consignacion_efectivo' and m.estado = 'pendiente'
          and m.fecha = v_grupo.fc + i;
        update banco_movimientos m set estado = 'conciliado'
        where m.sede = v_grupo.sede and m.categoria = 'consignacion_efectivo' and m.estado = 'pendiente'
          and m.fecha = v_grupo.fc + i;
        n_consig := n_consig + 1;
        exit;
      end if;
    end loop;
  end loop;

  for v_pago in
    select p.* from v_cierre_pagos_erp p
    where p.fecha between p_desde and p_hasta
      and not fn_es_sedacion(p.concepto)
      and not exists (
        select 1 from conciliacion_enlaces e
        where e.tipo = 'recibo' and (e.cargo_pago_id = p.id or e.saldo_id = p.id))
    order by p.fecha, p.valor desc
  loop
    select r.id into v_rec_id
    from recibos_sistema r
    where r.fecha between v_pago.fecha - 1 and v_pago.fecha + 1 and r.medio = v_pago.medio
      and r.valor = v_pago.valor and not r.anulado and r.estado = 'pendiente'
      and not exists (select 1 from conciliacion_enlaces e where e.recibo_id = r.id)
      and (r.sede = v_pago.sede or similarity(fn_normalizar_nombre(r.paciente), fn_normalizar_nombre(v_pago.paciente)) >= 0.6)
    order by (r.sede <> v_pago.sede), abs(r.fecha - v_pago.fecha),
             similarity(fn_normalizar_nombre(r.paciente), fn_normalizar_nombre(v_pago.paciente)) desc, r.numero
    limit 1;
    if v_rec_id is not null then
      insert into conciliacion_enlaces (tipo, recibo_id, cargo_pago_id, saldo_id, regla)
      values ('recibo', v_rec_id,
              case when v_pago.origen = 'cargo' then v_pago.id end,
              case when v_pago.origen = 'saldo' then v_pago.id end,
              case when (select r.sede from recibos_sistema r where r.id = v_rec_id) <> v_pago.sede
                   then 'recibo_en_otra_sede' else 'exacto' end);
      update recibos_sistema set estado = 'conciliado' where id = v_rec_id;
      n_recibos := n_recibos + 1;
      v_rec_id := null;
    end if;
  end loop;

  for v_grupo in
    select p.sede, p.fecha, p.medio, p.paciente_id, min(p.paciente) as paciente, sum(p.valor) as total,
           array_agg(p.id) as ids, array_agg(p.origen) as origenes
    from v_cierre_pagos_erp p
    where p.fecha between p_desde and p_hasta and p.paciente_id is not null
      and not exists (
        select 1 from conciliacion_enlaces e
        where e.tipo = 'recibo' and (e.cargo_pago_id = p.id or e.saldo_id = p.id))
    group by 1, 2, 3, 4
    having count(*) > 1
  loop
    select r.id into v_rec_id
    from recibos_sistema r
    where r.sede = v_grupo.sede and r.fecha between v_grupo.fecha - 1 and v_grupo.fecha + 1 and r.medio = v_grupo.medio
      and r.valor = v_grupo.total and not r.anulado and r.estado = 'pendiente'
      and not exists (select 1 from conciliacion_enlaces e where e.recibo_id = r.id)
    order by similarity(fn_normalizar_nombre(r.paciente), fn_normalizar_nombre(v_grupo.paciente)) desc
    limit 1;
    if v_rec_id is not null then
      insert into conciliacion_enlaces (tipo, recibo_id, cargo_pago_id, saldo_id, regla)
      select 'recibo', v_rec_id,
             case when o = 'cargo' then i end,
             case when o = 'saldo' then i end,
             'agrupado_paciente'
      from unnest(v_grupo.ids, v_grupo.origenes) as u(i, o);
      update recibos_sistema set estado = 'conciliado' where id = v_rec_id;
      n_recibos_grupo := n_recibos_grupo + 1;
      v_rec_id := null;
    end if;
  end loop;

  -- Sentido inverso: varios recibos del sistema de facturación (mismo
  -- paciente/fecha/medio/sede) que juntos suman un solo cobro del ERP.
  for v_grupo in
    select r.sede, r.fecha, r.medio, fn_normalizar_nombre(r.paciente) as clave,
           min(r.paciente) as paciente, sum(r.valor) as total,
           array_agg(r.id) as ids
    from recibos_sistema r
    where r.fecha between p_desde - 1 and p_hasta + 1 and not r.anulado and r.estado = 'pendiente'
      and not exists (select 1 from conciliacion_enlaces e where e.recibo_id = r.id)
    group by 1, 2, 3, 4
    having count(*) > 1
  loop
    select p.id, p.origen into v_pago_id, v_pago_origen
    from v_cierre_pagos_erp p
    where p.sede = v_grupo.sede and p.medio = v_grupo.medio
      and p.fecha between v_grupo.fecha - 1 and v_grupo.fecha + 1
      and p.valor = v_grupo.total
      and not fn_es_sedacion(p.concepto)
      and not exists (
        select 1 from conciliacion_enlaces e
        where e.tipo = 'recibo' and (e.cargo_pago_id = p.id or e.saldo_id = p.id))
    order by abs(p.fecha - v_grupo.fecha),
             similarity(fn_normalizar_nombre(p.paciente), v_grupo.clave) desc
    limit 1;
    if v_pago_id is not null then
      insert into conciliacion_enlaces (tipo, recibo_id, cargo_pago_id, saldo_id, regla)
      select 'recibo', rid,
             case when v_pago_origen = 'cargo' then v_pago_id end,
             case when v_pago_origen = 'saldo' then v_pago_id end,
             'agrupado_recibo'
      from unnest(v_grupo.ids) as rid;
      update recibos_sistema set estado = 'conciliado' where id = any(v_grupo.ids);
      n_recibos_grupo_rec := n_recibos_grupo_rec + 1;
      v_pago_id := null;
      v_pago_origen := null;
    end if;
  end loop;

  return jsonb_build_object(
    'tarjeta_bold', n_tarjeta,
    'transferencias_exactas', n_exacto,
    'transferencias_agrupadas', n_agrupado,
    'consignaciones', n_consig,
    'recibos_exactos', n_recibos,
    'recibos_agrupados', n_recibos_grupo,
    'recibos_agrupados_por_recibo', n_recibos_grupo_rec
  );
end;
$function$;
