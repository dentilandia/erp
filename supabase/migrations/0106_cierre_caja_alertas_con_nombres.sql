-- Las alertas del cruce línea por línea solo traían "N transferencia(s), $X" —
-- Tomás tiene que entrar a "Conciliación bancaria" para saber de quién son.
-- Los pacientes/conceptos ya están en las vistas de conciliación (v_conc_*);
-- se agregan a cada alerta como "lineas" para verlos directo en el detalle del
-- día, sin tener que reprocesar nada (se recalcula aparte con
-- fn_actualizar_cierres_caja sobre lo que ya está cargado).
create or replace function fn_actualizar_cierres_caja(p_desde date, p_hasta date)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_alertas jsonb;
  v_det jsonb;
  v_cubre_transf boolean;
  v_cubre_consig boolean;
  v_cubre_recibos boolean;
  v_sin_abono_n int; v_sin_abono_v numeric; v_sin_abono_lineas jsonb;
  v_abonos_n int; v_abonos_v numeric; v_abonos_lineas jsonb;
  v_rec_ng_n int; v_rec_ng_v numeric; v_rec_ng_lineas jsonb;
  v_rec_sp_n int; v_rec_sp_v numeric; v_rec_dup int; v_rec_sp_lineas jsonb;
  v_consig record;
  v_dataf numeric;
  v_dif_tarjeta numeric;
  v_tj_sin_n int; v_tj_sin_v numeric; v_tj_sin_lineas jsonb;
  v_ok boolean;
  n int := 0;
begin
  if auth.uid() is not null and not fn_es_admin() then
    raise exception 'Solo un administrador puede recalcular el cierre.';
  end if;

  for r in
    with dias as (
      select fecha, sede from v_cierre_facturado_vivo where fecha between p_desde and p_hasta and (total <> 0 or gastos <> 0)
      union
      select d.fecha, fn_sede_clave(s.nombre) from cierres_diarios d join sedes s on s.id = d.sede_id
        where d.fecha between p_desde and p_hasta
      union
      select fecha, sede from cierres_caja where fecha between p_desde and p_hasta
    )
    select dd.fecha, dd.sede,
      coalesce(f.efectivo_neto, 0) as efectivo_neto, coalesce(f.gastos, 0) as gastos,
      coalesce(f.tarjeta, 0) as tarjeta, coalesce(f.transferencia, 0) as transferencia,
      coalesce(f.addi, 0) + coalesce(f.sistecredito, 0) as addi, coalesce(f.total, 0) as total,
      cd.id as cierre_diario_id, cd.consignado, coalesce(cd.entregado_admin, false) as entregado_admin, cd.fecha_consignacion, cd.bold_cierre_turnos, cd.tirilla_datafono_url,
      cc.dataf_spro as dataf_spro_actual
    from dias dd
    left join v_cierre_facturado_vivo f on f.fecha = dd.fecha and f.sede = dd.sede
    left join sedes s on fn_sede_clave(s.nombre) = dd.sede
    left join cierres_diarios cd on cd.sede_id = s.id and cd.fecha = dd.fecha
    left join cierres_caja cc on cc.fecha = dd.fecha and cc.sede = dd.sede
  loop
    v_alertas := '[]'::jsonb;

    v_cubre_transf := fn_fuente_cubre(fn_cuenta_transferencias(r.sede), r.fecha);
    select count(*), coalesce(sum(valor), 0) into v_sin_abono_n, v_sin_abono_v
    from v_conc_transferencias_sin_abono t where t.fecha = r.fecha and t.sede = r.sede;
    select coalesce(jsonb_agg(jsonb_build_object('paciente', t.paciente, 'concepto', t.concepto, 'valor', t.valor) order by t.valor desc), '[]'::jsonb)
      into v_sin_abono_lineas
    from v_conc_transferencias_sin_abono t where t.fecha = r.fecha and t.sede = r.sede;
    select count(*), coalesce(sum(valor), 0) into v_abonos_n, v_abonos_v
    from banco_movimientos m
    where m.sede = r.sede and m.fecha = r.fecha and m.estado = 'pendiente' and m.valor > 0
      and (m.categoria in ('transferencia_paciente', 'otro_ingreso')
           or (m.categoria = 'datafono' and m.cuenta = 'bold_fabricato'));
    select coalesce(jsonb_agg(jsonb_build_object('descripcion', m.descripcion, 'valor', m.valor) order by m.valor desc), '[]'::jsonb)
      into v_abonos_lineas
    from banco_movimientos m
    where m.sede = r.sede and m.fecha = r.fecha and m.estado = 'pendiente' and m.valor > 0
      and (m.categoria in ('transferencia_paciente', 'otro_ingreso')
           or (m.categoria = 'datafono' and m.cuenta = 'bold_fabricato'));
    if r.transferencia > 0 and not v_cubre_transf then
      v_alertas := v_alertas || jsonb_build_object('tipo', 'Falta extracto', 'detalle',
        'No hay extracto de ' || fn_cuenta_transferencias(r.sede) || ' que cubra este día', 'valor', r.transferencia);
    end if;
    if v_sin_abono_n > 0 then
      v_alertas := v_alertas || jsonb_build_object('tipo', 'Transferencia sin abono', 'detalle',
        v_sin_abono_n || ' transferencia(s) registradas en el ERP que no aparecen en el banco', 'valor', v_sin_abono_v,
        'lineas', v_sin_abono_lineas);
    end if;
    if v_abonos_n > 0 then
      v_alertas := v_alertas || jsonb_build_object('tipo', 'Abono sin identificar', 'detalle',
        v_abonos_n || ' abono(s) en el banco sin pago del ERP que los respalde', 'valor', v_abonos_v,
        'lineas', v_abonos_lineas);
    end if;

    v_cubre_consig := null;
    if r.efectivo_neto > 0 then
      if coalesce(r.consignado, false) then
        select * into v_consig from v_conc_consignaciones c
        where c.sede = r.sede and c.fecha_consignacion = r.fecha_consignacion;
        v_cubre_consig := coalesce(v_consig.extracto_cubre, false);
        if not v_cubre_consig then
          v_alertas := v_alertas || jsonb_build_object('tipo', 'Falta extracto', 'detalle',
            'No hay extracto de ' || fn_cuenta_consignaciones(r.sede) || ' del ' || r.fecha_consignacion
            || ' para confirmar la consignación', 'valor', r.efectivo_neto);
        elsif not coalesce(v_consig.conciliado, false) then
          v_alertas := v_alertas || jsonb_build_object('tipo', 'Consignación no encontrada', 'detalle',
            'Consignado el ' || r.fecha_consignacion || ': se esperaban ' || v_consig.esperado
            || ' (días ' || array_to_string(v_consig.dias, ', ') || ') y el banco muestra '
            || v_consig.consignado_banco_3dias || ' en consignaciones de esos 3 días', 'valor', v_consig.esperado);
        end if;
      elsif r.entregado_admin then
        null;
      elsif r.fecha < v_hoy - 3 then
        v_alertas := v_alertas || jsonb_build_object('tipo', 'Efectivo sin consignar', 'detalle',
          'El día no está marcado como consignado en Cierre diario', 'valor', r.efectivo_neto);
      end if;
    end if;

    if r.sede = 'Fabricato' then
      v_dataf := case when jsonb_array_length(coalesce(r.bold_cierre_turnos, '[]'::jsonb)) > 0
                      then (select sum((t->>'valor')::numeric) from jsonb_array_elements(r.bold_cierre_turnos) t) end;
    else
      v_dataf := case when r.tirilla_datafono_url is not null then r.dataf_spro_actual end;
    end if;
    v_dif_tarjeta := case when v_dataf is null then null else r.tarjeta - v_dataf end;
    select count(*), coalesce(sum(valor), 0) into v_tj_sin_n, v_tj_sin_v
    from v_conc_tarjeta_sin_datafono t where t.fecha = r.fecha and t.sede = r.sede;
    select coalesce(jsonb_agg(jsonb_build_object('paciente', t.paciente, 'concepto', t.concepto, 'valor', t.valor) order by t.valor desc), '[]'::jsonb)
      into v_tj_sin_lineas
    from v_conc_tarjeta_sin_datafono t where t.fecha = r.fecha and t.sede = r.sede;
    if v_tj_sin_n > 0 then
      v_alertas := v_alertas || jsonb_build_object('tipo', 'Tarjeta sin cobro en datáfono', 'detalle',
        v_tj_sin_n || ' pago(s) con tarjeta en el ERP que no aparecen en el reporte de Bold', 'valor', v_tj_sin_v,
        'lineas', v_tj_sin_lineas);
    end if;
    if r.tarjeta > 0 and v_dataf is null then
      v_alertas := v_alertas || jsonb_build_object('tipo', 'Falta datáfono', 'detalle',
        case when r.sede = 'Fabricato' then 'No llegó el cierre de turnos de Bold' else 'Falta la tirilla Redeban (o aún no se ha leído)' end,
        'valor', r.tarjeta);
    elsif v_dif_tarjeta is not null and abs(v_dif_tarjeta) >= 1 then
      v_alertas := v_alertas || jsonb_build_object('tipo', 'Diferencia datáfono', 'detalle',
        'ERP ' || r.tarjeta || ' vs datáfono ' || v_dataf, 'valor', v_dif_tarjeta);
    end if;

    v_cubre_recibos := fn_fuente_cubre('recibos_sistema', r.fecha);
    select count(*), coalesce(sum(valor), 0) into v_rec_ng_n, v_rec_ng_v
    from v_conc_recibos_no_generados x where x.fecha = r.fecha and x.sede = r.sede;
    select coalesce(jsonb_agg(jsonb_build_object('paciente', x.paciente, 'concepto', x.concepto, 'valor', x.valor) order by x.valor desc), '[]'::jsonb)
      into v_rec_ng_lineas
    from v_conc_recibos_no_generados x where x.fecha = r.fecha and x.sede = r.sede;
    select count(*), coalesce(sum(valor), 0), count(*) filter (where posible_duplicado)
      into v_rec_sp_n, v_rec_sp_v, v_rec_dup
    from v_conc_recibos_sin_pago x where x.fecha = r.fecha and x.sede = r.sede;
    select coalesce(jsonb_agg(jsonb_build_object('paciente', x.paciente, 'numero', x.numero, 'valor', x.valor, 'posible_duplicado', x.posible_duplicado) order by x.valor desc), '[]'::jsonb)
      into v_rec_sp_lineas
    from v_conc_recibos_sin_pago x where x.fecha = r.fecha and x.sede = r.sede;
    if r.total > 0 and not v_cubre_recibos then
      v_alertas := v_alertas || jsonb_build_object('tipo', 'Falta reporte de recibos', 'detalle',
        'No hay reporte de recibos de caja del sistema de facturación que cubra este día', 'valor', r.total);
    end if;
    if v_rec_ng_n > 0 then
      v_alertas := v_alertas || jsonb_build_object('tipo', 'Recibo no generado', 'detalle',
        v_rec_ng_n || ' pago(s) del ERP sin recibo de caja en el sistema de facturación', 'valor', v_rec_ng_v,
        'lineas', v_rec_ng_lineas);
    end if;
    if v_rec_sp_n > 0 then
      v_alertas := v_alertas || jsonb_build_object('tipo',
        case when v_rec_dup > 0 then 'Recibo duplicado' else 'Recibo sin pago en ERP' end, 'detalle',
        v_rec_sp_n || ' recibo(s) del sistema de facturación sin pago en el ERP'
          || case when v_rec_dup > 0 then ' (' || v_rec_dup || ' posible(s) duplicado(s))' else '' end,
        'valor', v_rec_sp_v, 'lineas', v_rec_sp_lineas);
    end if;

    v_ok := jsonb_array_length(v_alertas) = 0;
    v_det := jsonb_build_object(
      'facturado', jsonb_build_object('efectivo_neto', r.efectivo_neto, 'gastos', r.gastos, 'tarjeta', r.tarjeta,
                                      'transferencia', r.transferencia, 'addi_sistecredito', r.addi, 'total', r.total),
      'cobertura', jsonb_build_object('transferencias', v_cubre_transf, 'consignacion', v_cubre_consig, 'recibos', v_cubre_recibos),
      'tarjeta', jsonb_build_object('datafono', v_dataf, 'diferencia', v_dif_tarjeta,
                                    'sin_cobro_datafono', v_tj_sin_n, 'sin_cobro_datafono_valor', v_tj_sin_v),
      'transferencias', jsonb_build_object('sin_abono', v_sin_abono_n, 'sin_abono_valor', v_sin_abono_v,
                                           'abonos_sin_identificar', v_abonos_n, 'abonos_sin_identificar_valor', v_abonos_v),
      'recibos', jsonb_build_object('no_generados', v_rec_ng_n, 'no_generados_valor', v_rec_ng_v,
                                    'sin_pago', v_rec_sp_n, 'sin_pago_valor', v_rec_sp_v, 'duplicados', v_rec_dup),
      'alertas', v_alertas
    );

    insert into cierres_caja (fecha, sede, efvo_fact, tarjeta_fact, transf_fact, addi, total, gasto,
                              dataf_spro, dif_dataf_bruta, dataf_sin_docs, transf_sin_banco,
                              resultado_ok, resultado_detalle, resultado_hash)
    values (r.fecha, r.sede, r.efectivo_neto, r.tarjeta, r.transferencia, r.addi, r.total, r.gastos,
            v_dataf, v_dif_tarjeta, (r.tarjeta > 0 and v_dataf is null), v_sin_abono_n > 0,
            v_ok, v_det, md5(v_det::text))
    on conflict (fecha, sede) do update set
      efvo_fact = excluded.efvo_fact,
      tarjeta_fact = excluded.tarjeta_fact,
      transf_fact = excluded.transf_fact,
      addi = excluded.addi,
      total = excluded.total,
      gasto = excluded.gasto,
      dataf_spro = excluded.dataf_spro,
      dif_dataf_bruta = excluded.dif_dataf_bruta,
      dataf_sin_docs = excluded.dataf_sin_docs,
      transf_sin_banco = excluded.transf_sin_banco,
      resultado_ok = excluded.resultado_ok,
      resultado_detalle = excluded.resultado_detalle,
      resultado_hash = excluded.resultado_hash;
    n := n + 1;
  end loop;
  return n;
end;
$function$;
