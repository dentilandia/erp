-- ============================================================
-- CIERRE DE CAJA — Conciliación línea por línea (auditoría nov-2026)
--
-- Antes: la IA leía los extractos y devolvía UN total por día, comparado
-- contra una "foto" de totales (cierres_diarios.totales_por_medio) que se
-- quedaba vieja o con datos de otro día, y restando una columna de gasto que
-- ya no se usa. No se podía saber qué transferencia puntual faltaba.
--
-- Ahora:
--   * El facturado se calcula EN VIVO desde los pagos del ERP (mismo criterio
--     que Cierre diario) y los gastos salen de cierres_diarios_gastos.
--   * Cada línea de los extractos (Bancolombia, Bold) y cada recibo del
--     sistema de facturación (Oral Drive) se guarda como un registro propio,
--     sin duplicarse aunque dos lotes de documentos se crucen (huella única).
--   * fn_conciliar_cierre() cruza con reglas fijas, sin IA:
--       - transferencia del ERP  ↔ abono en banco (mismo valor, ±días)
--       - varias transferencias de un mismo paciente/día ↔ un solo abono
--       - efectivo consignado (por fecha de consignación) ↔ consignaciones
--       - pago del ERP ↔ recibo de caja del sistema de facturación
--   * fn_actualizar_cierres_caja() escribe el resultado por día×sede en
--     cierres_caja (resultado_ok, resultado_detalle) sin tocar la
--     confirmación humana de "Cuadra".
--   * Vistas v_conc_* = las listas de trabajo: abonos sin identificar,
--     transferencias sin abono, consignaciones, efectivo sin consignar,
--     recibos no generados, recibos sin pago y recibos duplicados.
-- ============================================================

create or replace function fn_sede_clave(p_nombre text)
returns text
language sql
immutable
as $$
  select case when p_nombre ilike '%fabricato%' then 'Fabricato' else 'Las Americas' end
$$;

create or replace function fn_normalizar_nombre(p text)
returns text
language sql
immutable
as $$
  select trim(regexp_replace(lower(translate(coalesce(p, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), '[^a-z0-9]+', ' ', 'g'))
$$;

-- ---------- Pagos del ERP (fuente única) ----------
-- Mismo criterio que Cierre diario: todo cargo_pago menos los pagados con
-- saldo a favor (ese dinero ya se contó el día que entró), más los saldos a
-- favor creados ese día (anticipos), menos los ajustes manuales.
create or replace view v_cierre_pagos_erp
with (security_invoker = true) as
select
  'cargo'::text as origen,
  p.id,
  c.fecha,
  fn_sede_clave(s.nombre) as sede,
  p.medio_pago as medio,
  p.valor,
  v.paciente_id,
  pa.nombre as paciente,
  c.concepto
from cargo_pagos p
join cargos c on c.id = p.cargo_id
join sedes s on s.id = c.sede_id
left join visitas v on v.id = c.visita_id
left join pacientes pa on pa.id = v.paciente_id
where p.medio_pago <> 'saldo_favor'
union all
select
  'saldo'::text,
  sf.id,
  sf.fecha,
  fn_sede_clave(s.nombre),
  sf.medio_origen,
  sf.valor,
  sf.paciente_id,
  pa.nombre,
  'Anticipo / saldo a favor'
from saldos_favor sf
join sedes s on s.id = sf.sede_origen_id
left join pacientes pa on pa.id = sf.paciente_id
where sf.medio_origen not in ('ajuste_manual', 'saldo_favor');

-- ---------- Facturado vivo por día×sede ----------
create or replace view v_cierre_facturado_vivo
with (security_invoker = true) as
with por_dia as (
  select fecha, sede,
    coalesce(sum(valor) filter (where medio = 'efectivo'), 0) as efectivo_bruto,
    coalesce(sum(valor) filter (where medio in ('tarjeta_debito', 'tarjeta_credito')), 0) as tarjeta,
    coalesce(sum(valor) filter (where medio = 'transferencia_debito'), 0) as transferencia,
    coalesce(sum(valor) filter (where medio = 'addi'), 0) as addi,
    coalesce(sum(valor) filter (where medio = 'sistecredito'), 0) as sistecredito
  from v_cierre_pagos_erp
  group by 1, 2
), gastos as (
  select g.fecha, fn_sede_clave(s.nombre) as sede, sum(g.valor) as gastos
  from cierres_diarios_gastos g join sedes s on s.id = g.sede_id
  group by 1, 2
)
select
  coalesce(p.fecha, g.fecha) as fecha,
  coalesce(p.sede, g.sede) as sede,
  coalesce(p.efectivo_bruto, 0) as efectivo_bruto,
  coalesce(g.gastos, 0) as gastos,
  coalesce(p.efectivo_bruto, 0) - coalesce(g.gastos, 0) as efectivo_neto,
  coalesce(p.tarjeta, 0) as tarjeta,
  coalesce(p.transferencia, 0) as transferencia,
  coalesce(p.addi, 0) as addi,
  coalesce(p.sistecredito, 0) as sistecredito,
  coalesce(p.efectivo_bruto, 0) - coalesce(g.gastos, 0) + coalesce(p.tarjeta, 0) + coalesce(p.transferencia, 0)
    + coalesce(p.addi, 0) + coalesce(p.sistecredito, 0) as total
from por_dia p
full join gastos g on g.fecha = p.fecha and g.sede = p.sede;

-- ---------- Qué documentos cubren qué fechas ----------
-- Sin esto no se puede distinguir "la transferencia no llegó al banco" de
-- "todavía no se subió el extracto de ese día".
create table if not exists cierre_fuentes_cargadas (
  id uuid primary key default gen_random_uuid(),
  fuente text not null check (fuente in ('bancolombia_americas', 'bancolombia_fabricato', 'bold_fabricato', 'recibos_sistema')),
  desde date not null,
  hasta date not null,
  archivo text not null,
  filas integer not null,
  semana_id uuid references cierres_caja_semanas(id) on delete set null,
  cargado_en timestamptz not null default now(),
  check (hasta >= desde),
  unique (fuente, archivo)
);

-- ---------- Movimientos bancarios (una fila por línea del extracto) ----------
create table if not exists banco_movimientos (
  id uuid primary key default gen_random_uuid(),
  cuenta text not null check (cuenta in ('bancolombia_americas', 'bancolombia_fabricato', 'bold_fabricato')),
  sede text not null check (sede in ('Las Americas', 'Fabricato')),
  fecha date not null,
  valor numeric(14,2) not null,              -- + entra a la cuenta, − sale
  valor_bruto numeric(14,2),                 -- Bold: valor antes de comisión, si el extracto lo trae
  descripcion text,
  referencia text,
  categoria text not null check (categoria in (
    'transferencia_paciente', 'consignacion_efectivo', 'datafono', 'financiacion', 'traslado_interno',
    'intereses', 'comision_impuesto', 'egreso', 'otro_ingreso'
  )),
  huella text not null unique,               -- evita duplicar la misma línea si se sube dos veces
  archivo text,
  semana_id uuid references cierres_caja_semanas(id) on delete set null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'conciliado', 'identificado', 'no_aplica')),
  nota text,
  resuelto_por uuid references auth.users(id),
  resuelto_en timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_banco_mov_sede_fecha on banco_movimientos (sede, fecha);
create index if not exists idx_banco_mov_estado on banco_movimientos (estado) where estado = 'pendiente';

-- ---------- Recibos de caja del sistema de facturación (Oral Drive) ----------
create table if not exists recibos_sistema (
  id uuid primary key default gen_random_uuid(),
  sede text not null check (sede in ('Las Americas', 'Fabricato')),
  fecha date not null,
  numero text,
  paciente text,
  responsable text,                          -- acudiente (quien suele aparecer en el QR del banco)
  medio text not null,                       -- normalizado a los medios del ERP
  valor numeric(14,2) not null,
  anulado boolean not null default false,
  huella text not null unique,
  archivo text,
  semana_id uuid references cierres_caja_semanas(id) on delete set null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'conciliado', 'identificado', 'no_aplica')),
  nota text,
  resuelto_por uuid references auth.users(id),
  resuelto_en timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_recibos_sistema_sede_fecha on recibos_sistema (sede, fecha);

-- ---------- Enlaces (qué pago del ERP quedó cruzado con qué) ----------
create table if not exists conciliacion_enlaces (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('banco', 'recibo', 'consignacion')),
  movimiento_id uuid references banco_movimientos(id) on delete cascade,
  recibo_id uuid references recibos_sistema(id) on delete cascade,
  cargo_pago_id uuid references cargo_pagos(id) on delete cascade,
  saldo_id uuid references saldos_favor(id) on delete cascade,
  cierre_diario_id uuid references cierres_diarios(id) on delete cascade,
  regla text not null,                       -- 'exacto', 'agrupado_paciente', 'consignacion_fecha', 'manual'
  origen text not null default 'automatico' check (origen in ('automatico', 'manual')),
  creado_por uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check ((tipo = 'banco' and movimiento_id is not null and num_nonnulls(cargo_pago_id, saldo_id) = 1)
      or (tipo = 'recibo' and recibo_id is not null and num_nonnulls(cargo_pago_id, saldo_id) = 1)
      or (tipo = 'consignacion' and movimiento_id is not null and cierre_diario_id is not null))
);
-- Un pago del ERP se cruza con UN abono y UN recibo como máximo.
create unique index if not exists uq_enlace_banco_cargo on conciliacion_enlaces (cargo_pago_id) where tipo = 'banco';
create unique index if not exists uq_enlace_banco_saldo on conciliacion_enlaces (saldo_id) where tipo = 'banco';
create unique index if not exists uq_enlace_recibo_cargo on conciliacion_enlaces (cargo_pago_id) where tipo = 'recibo';
create unique index if not exists uq_enlace_recibo_saldo on conciliacion_enlaces (saldo_id) where tipo = 'recibo';
create unique index if not exists uq_enlace_consig on conciliacion_enlaces (movimiento_id, cierre_diario_id) where tipo = 'consignacion';
create index if not exists idx_enlaces_mov on conciliacion_enlaces (movimiento_id);
create index if not exists idx_enlaces_recibo on conciliacion_enlaces (recibo_id);

-- RLS: solo administración (igual que cierres_caja).
alter table cierre_fuentes_cargadas enable row level security;
alter table banco_movimientos enable row level security;
alter table recibos_sistema enable row level security;
alter table conciliacion_enlaces enable row level security;
create policy cierre_fuentes_admin on cierre_fuentes_cargadas for all using (fn_es_admin()) with check (fn_es_admin());
create policy banco_movimientos_admin on banco_movimientos for all using (fn_es_admin()) with check (fn_es_admin());
create policy recibos_sistema_admin on recibos_sistema for all using (fn_es_admin()) with check (fn_es_admin());
create policy conciliacion_enlaces_admin on conciliacion_enlaces for all using (fn_es_admin()) with check (fn_es_admin());

-- Trazabilidad de cambios manuales (identificar un abono, enlazar a mano...).
create trigger trg_auditoria_banco_movimientos after update or delete on banco_movimientos
  for each row execute function fn_registrar_cambio();
create trigger trg_auditoria_recibos_sistema after update or delete on recibos_sistema
  for each row execute function fn_registrar_cambio();
-- De los enlaces solo interesan los manuales (los automáticos se rehacen en cada corrida).
create trigger trg_auditoria_enlaces_manual_ins after insert on conciliacion_enlaces
  for each row when (new.origen = 'manual') execute function fn_registrar_cambio();
create trigger trg_auditoria_enlaces_manual_del after delete on conciliacion_enlaces
  for each row when (old.origen = 'manual') execute function fn_registrar_cambio();

-- Marcar algo como "identificado" a mano exige explicación y queda a nombre de quien lo hizo.
create or replace function fn_conciliacion_validar_identificado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado = 'identificado' and old.estado is distinct from 'identificado' then
    if auth.uid() is null then
      raise exception 'Solo una persona puede marcar un movimiento como identificado.';
    end if;
    if length(trim(coalesce(new.nota, ''))) < 10 then
      raise exception 'Explica a qué corresponde (mínimo 10 caracteres).';
    end if;
    new.resuelto_por := auth.uid();
    new.resuelto_en := now();
  elsif new.estado = 'pendiente' then
    new.resuelto_por := null;
    new.resuelto_en := null;
  end if;
  return new;
end;
$$;
create trigger trg_banco_mov_identificado before update on banco_movimientos
  for each row execute function fn_conciliacion_validar_identificado();
create trigger trg_recibos_identificado before update on recibos_sistema
  for each row execute function fn_conciliacion_validar_identificado();

-- Clave para agrupar cobros que el acudiente paga en una sola transferencia:
-- nivel 0 = mismo paciente, 1 = mismos dos apellidos (hermanos), 2 = primer
-- apellido, 3 = segundo apellido. En odontopediatría es lo normal que un papá
-- pague a dos hijos con un solo QR (ej. 130.000 + 164.000 = 294.000).
create or replace function fn_clave_familia(p_nombre text, p_paciente uuid, p_nivel int)
returns text
language plpgsql
immutable
as $$
declare
  t text[] := regexp_split_to_array(fn_normalizar_nombre(p_nombre), ' ');
  n int := coalesce(array_length(t, 1), 0);
  ap1 text; ap2 text;
begin
  if n >= 3 then ap1 := t[n - 1]; ap2 := t[n];
  elsif n >= 1 then ap1 := t[n];
  end if;
  return case p_nivel
    when 0 then case when p_paciente is not null then 'pac:' || p_paciente end
    when 1 then case when ap2 is not null then 'ap12:' || ap1 || ' ' || ap2 end
    when 2 then case when ap1 is not null then 'ap1:' || ap1 end
    when 3 then case when ap2 is not null then 'ap2:' || ap2 end
  end;
end;
$$;

-- ============================================================
-- Motor de conciliación (determinístico)
-- ============================================================
create or replace function fn_conciliar_cierre(p_desde date, p_hasta date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pago record;
  v_grupo record;
  v_mov_id uuid;
  v_rec_id uuid;
  v_ini date := p_desde - 5;
  v_fin date := p_hasta + 5;
  n_exacto int := 0;
  n_tarjeta int := 0;
  n_agrupado int := 0;
  v_nivel int;
  n_consig int := 0;
  n_recibos int := 0;
  n_recibos_grupo int := 0;
begin
  if auth.uid() is not null and not fn_es_admin() then
    raise exception 'Solo un administrador puede conciliar.';
  end if;

  -- 0. Se rehacen los cruces automáticos de la ventana (un pago editado o un
  --    extracto nuevo pueden cambiar el resultado). Los manuales se respetan.
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

  -- 0b. Traslados entre las cuentas propias (ej. Fabricato → Las Américas por
  --     sucursal virtual): misma fecha y valor, uno sale y otro entra. No son
  --     plata de pacientes y no deben aparecer como abonos sin identificar.
  update banco_movimientos m set categoria = 'traslado_interno', estado = 'no_aplica',
         nota = coalesce(m.nota, 'Traslado entre cuentas propias (detectado automáticamente)')
  where m.fecha between v_ini and v_fin and m.estado = 'pendiente'
    and m.categoria in ('transferencia_paciente', 'otro_ingreso', 'egreso')
    and m.descripcion ilike 'TRANSFERENCIA CTA SUC VIRTUAL%'
    and exists (
      select 1 from banco_movimientos o
      where o.cuenta <> m.cuenta and o.fecha = m.fecha and o.valor = -m.valor
        and o.descripcion ilike 'TRANSFERENCIA CTA SUC VIRTUAL%');

  -- 0c. Tarjeta en Fabricato, transacción por transacción: el reporte de Bold
  --     trae cada cobro con su valor bruto, así que cada pago con tarjeta del
  --     ERP se cruza con un cobro de datáfono del mismo día y valor.
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

  -- 1. Transferencia del ERP ↔ abono: mismo valor exacto, el abono entre 2
  --    días antes y 3 días después del pago (recepción a veces registra el
  --    pago o genera el recibo al día siguiente); gana el más cercano.
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
    -- Los QR de Bancolombia de ambas sedes llegan a la misma cuenta: se
    -- acepta cualquier cuenta, prefiriendo la de la propia sede.
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

  -- 2. Un abono = varios cobros del mismo día del mismo paciente o de
  --    hermanos (transferencias contra cualquier cuenta; tarjeta de Fabricato
  --    contra los cobros de Bold).
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

  -- 3. Efectivo consignado ↔ consignaciones. Los días que Operación marcó
  --    consignados con la misma fecha de consignación se suman; se busca que
  --    las consignaciones de esa sede ese día (o el siguiente hábil) sumen lo
  --    mismo. Si cuadra, todas quedan conciliadas contra esos días.
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

  -- 4. Pago del ERP ↔ recibo del sistema de facturación: misma sede, mismo
  --    día, mismo medio y valor; entre varios candidatos gana el de nombre de
  --    paciente más parecido.
  for v_pago in
    select p.* from v_cierre_pagos_erp p
    where p.fecha between p_desde and p_hasta
      and not exists (
        select 1 from conciliacion_enlaces e
        where e.tipo = 'recibo' and (e.cargo_pago_id = p.id or e.saldo_id = p.id))
    order by p.fecha, p.valor desc
  loop
    select r.id into v_rec_id
    from recibos_sistema r
    where r.sede = v_pago.sede and r.fecha between v_pago.fecha - 1 and v_pago.fecha + 1 and r.medio = v_pago.medio
      and r.valor = v_pago.valor and not r.anulado and r.estado = 'pendiente'
      and not exists (select 1 from conciliacion_enlaces e where e.recibo_id = r.id)
    order by abs(r.fecha - v_pago.fecha), similarity(fn_normalizar_nombre(r.paciente), fn_normalizar_nombre(v_pago.paciente)) desc, r.numero
    limit 1;
    if v_rec_id is not null then
      insert into conciliacion_enlaces (tipo, recibo_id, cargo_pago_id, saldo_id, regla)
      values ('recibo', v_rec_id,
              case when v_pago.origen = 'cargo' then v_pago.id end,
              case when v_pago.origen = 'saldo' then v_pago.id end,
              'exacto');
      update recibos_sistema set estado = 'conciliado' where id = v_rec_id;
      n_recibos := n_recibos + 1;
      v_rec_id := null;
    end if;
  end loop;

  -- 5. Un recibo que agrupa varios pagos del mismo paciente, día y medio.
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

  return jsonb_build_object(
    'tarjeta_bold', n_tarjeta,
    'transferencias_exactas', n_exacto,
    'transferencias_agrupadas', n_agrupado,
    'consignaciones', n_consig,
    'recibos_exactos', n_recibos,
    'recibos_agrupados', n_recibos_grupo
  );
end;
$$;

-- ============================================================
-- Listas de trabajo (lo que una persona debe revisar)
-- ============================================================
create or replace function fn_fuente_cubre(p_fuente text, p_fecha date)
returns boolean
language sql
stable
as $$
  select exists (select 1 from cierre_fuentes_cargadas f where f.fuente = p_fuente and p_fecha between f.desde and f.hasta)
$$;

create or replace function fn_cuenta_transferencias(p_sede text)
returns text
language sql
immutable
as $$
  select case when p_sede = 'Fabricato' then 'bold_fabricato' else 'bancolombia_americas' end
$$;

create or replace function fn_cuenta_consignaciones(p_sede text)
returns text
language sql
immutable
as $$
  select case when p_sede = 'Fabricato' then 'bancolombia_fabricato' else 'bancolombia_americas' end
$$;

-- Plata que entró al banco y no se sabe de qué paciente/recibo es.
create or replace view v_conc_abonos_sin_identificar
with (security_invoker = true) as
select m.id, m.fecha, m.sede, m.cuenta, m.categoria, m.valor, m.descripcion, m.referencia, m.archivo,
       (current_date - m.fecha) as dias_abierto
from banco_movimientos m
where m.estado = 'pendiente' and m.valor > 0
  and (m.categoria in ('transferencia_paciente', 'consignacion_efectivo', 'financiacion', 'otro_ingreso')
       or (m.categoria = 'datafono' and m.cuenta = 'bold_fabricato'));

-- Pagos con tarjeta de Fabricato que no aparecen como cobro en el reporte de Bold.
create or replace view v_conc_tarjeta_sin_datafono
with (security_invoker = true) as
select p.origen, p.id, p.fecha, p.sede, p.medio, p.valor, p.paciente, p.concepto
from v_cierre_pagos_erp p
where p.sede = 'Fabricato' and p.medio in ('tarjeta_debito', 'tarjeta_credito')
  and fn_fuente_cubre('bold_fabricato', p.fecha)
  and not exists (select 1 from conciliacion_enlaces e where e.tipo = 'banco' and (e.cargo_pago_id = p.id or e.saldo_id = p.id));

-- Transferencias registradas en el ERP que NO aparecen en el banco (solo se
-- reportan cuando ya hay extracto que cubre esa fecha + 3 días de gracia).
create or replace view v_conc_transferencias_sin_abono
with (security_invoker = true) as
select p.origen, p.id, p.fecha, p.sede, p.valor, p.paciente, p.concepto
from v_cierre_pagos_erp p
where p.medio = 'transferencia_debito'
  -- Una transferencia puede llegar a Bancolombia (QR de ambas sedes) o a Bold:
  -- solo se acusa "sin abono" si ambos extractos cubren el día y 3 días más.
  and fn_fuente_cubre('bancolombia_americas', p.fecha) and fn_fuente_cubre('bold_fabricato', p.fecha)
  and fn_fuente_cubre('bancolombia_americas', least(p.fecha + 3, current_date - 1))
  and fn_fuente_cubre('bold_fabricato', least(p.fecha + 3, current_date - 1))
  and not exists (select 1 from conciliacion_enlaces e where e.tipo = 'banco' and (e.cargo_pago_id = p.id or e.saldo_id = p.id));

-- Consignaciones: lo que Operación dice que consignó vs lo que llegó.
create or replace view v_conc_consignaciones
with (security_invoker = true) as
with grupos as (
  select fn_sede_clave(s.nombre) as sede, d.fecha_consignacion as fecha_consignacion,
         array_agg(d.fecha order by d.fecha) as dias, sum(coalesce(f.efectivo_neto, 0)) as esperado,
         bool_or(exists (select 1 from conciliacion_enlaces e where e.tipo = 'consignacion' and e.cierre_diario_id = d.id)) as conciliado
  from cierres_diarios d
  join sedes s on s.id = d.sede_id
  left join v_cierre_facturado_vivo f on f.fecha = d.fecha and f.sede = fn_sede_clave(s.nombre)
  where d.consignado and d.fecha_consignacion is not null
  group by 1, 2
)
select g.*,
  fn_fuente_cubre(fn_cuenta_consignaciones(g.sede), g.fecha_consignacion) as extracto_cubre,
  (select coalesce(sum(m.valor), 0) from banco_movimientos m
     where m.sede = g.sede and m.categoria = 'consignacion_efectivo'
       and m.fecha between g.fecha_consignacion and g.fecha_consignacion + 2) as consignado_banco_3dias
from grupos g;

-- Días con efectivo que Operación no ha marcado como consignado (> 3 días).
create or replace view v_conc_efectivo_sin_consignar
with (security_invoker = true) as
select f.fecha, f.sede, f.efectivo_neto, (current_date - f.fecha) as dias, d.entregado_admin
from v_cierre_facturado_vivo f
join sedes s on fn_sede_clave(s.nombre) = f.sede
left join cierres_diarios d on d.sede_id = s.id and d.fecha = f.fecha
where f.efectivo_neto > 0
  and coalesce(d.consignado, false) = false
  and coalesce(d.entregado_admin, false) = false
  and f.fecha < current_date - 3;

-- Efectivo que Operación entregó a administración en vez de consignarlo:
-- no es una alerta del día, pero hay que saber cuánto está en manos de
-- administración y desde cuándo.
create or replace view v_conc_efectivo_en_administracion
with (security_invoker = true) as
select f.fecha, f.sede, f.efectivo_neto, d.fecha_entrega_admin, (current_date - f.fecha) as dias
from v_cierre_facturado_vivo f
join sedes s on fn_sede_clave(s.nombre) = f.sede
join cierres_diarios d on d.sede_id = s.id and d.fecha = f.fecha
where f.efectivo_neto > 0 and d.entregado_admin and not d.consignado;

-- Recibos no generados: pago en el ERP sin recibo en el sistema de facturación.
create or replace view v_conc_recibos_no_generados
with (security_invoker = true) as
select p.origen, p.id, p.fecha, p.sede, p.medio, p.valor, p.paciente, p.concepto
from v_cierre_pagos_erp p
where fn_fuente_cubre('recibos_sistema', p.fecha)
  and not exists (select 1 from conciliacion_enlaces e where e.tipo = 'recibo' and (e.cargo_pago_id = p.id or e.saldo_id = p.id));

-- Recibos del sistema de facturación sin pago en el ERP; si hay otro recibo
-- igual (sede, día, paciente, medio, valor) ya cruzado, es un posible duplicado.
create or replace view v_conc_recibos_sin_pago
with (security_invoker = true) as
select r.id, r.fecha, r.sede, r.numero, r.paciente, r.medio, r.valor, r.archivo,
  exists (
    select 1 from recibos_sistema r2
    where r2.id <> r.id and r2.sede = r.sede and r2.fecha = r.fecha and r2.medio = r.medio
      and r2.valor = r.valor and not r2.anulado
      and fn_normalizar_nombre(r2.paciente) = fn_normalizar_nombre(r.paciente)
  ) as posible_duplicado
from recibos_sistema r
where r.estado = 'pendiente' and not r.anulado;

-- ============================================================
-- Resultado por día×sede → cierres_caja
-- ============================================================
create or replace function fn_actualizar_cierres_caja(p_desde date, p_hasta date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_alertas jsonb;
  v_det jsonb;
  v_cubre_transf boolean;
  v_cubre_consig boolean;
  v_cubre_recibos boolean;
  v_sin_abono_n int; v_sin_abono_v numeric;
  v_abonos_n int; v_abonos_v numeric;
  v_rec_ng_n int; v_rec_ng_v numeric;
  v_rec_sp_n int; v_rec_sp_v numeric; v_rec_dup int;
  v_consig record;
  v_dataf numeric;
  v_dif_tarjeta numeric;
  v_tj_sin_n int; v_tj_sin_v numeric;
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

    -- Transferencias
    v_cubre_transf := fn_fuente_cubre(fn_cuenta_transferencias(r.sede), r.fecha);
    select count(*), coalesce(sum(valor), 0) into v_sin_abono_n, v_sin_abono_v
    from v_conc_transferencias_sin_abono t where t.fecha = r.fecha and t.sede = r.sede;
    select count(*), coalesce(sum(valor), 0) into v_abonos_n, v_abonos_v
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
        v_sin_abono_n || ' transferencia(s) registradas en el ERP que no aparecen en el banco', 'valor', v_sin_abono_v);
    end if;
    if v_abonos_n > 0 then
      v_alertas := v_alertas || jsonb_build_object('tipo', 'Abono sin identificar', 'detalle',
        v_abonos_n || ' abono(s) en el banco sin pago del ERP que los respalde', 'valor', v_abonos_v);
    end if;

    -- Efectivo / consignación
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
        null; -- entregado a administración: se sigue en v_conc_efectivo_en_administracion
      elsif r.fecha < v_hoy - 3 then
        v_alertas := v_alertas || jsonb_build_object('tipo', 'Efectivo sin consignar', 'detalle',
          'El día no está marcado como consignado en Cierre diario', 'valor', r.efectivo_neto);
      end if;
    end if;

    -- Tarjeta: Fabricato = suma de turnos Bold (correo); Las Américas = tirilla Redeban leída.
    if r.sede = 'Fabricato' then
      v_dataf := case when jsonb_array_length(coalesce(r.bold_cierre_turnos, '[]'::jsonb)) > 0
                      then (select sum((t->>'valor')::numeric) from jsonb_array_elements(r.bold_cierre_turnos) t) end;
    else
      v_dataf := case when r.tirilla_datafono_url is not null then r.dataf_spro_actual end;
    end if;
    v_dif_tarjeta := case when v_dataf is null then null else r.tarjeta - v_dataf end;
    select count(*), coalesce(sum(valor), 0) into v_tj_sin_n, v_tj_sin_v
    from v_conc_tarjeta_sin_datafono t where t.fecha = r.fecha and t.sede = r.sede;
    if v_tj_sin_n > 0 then
      v_alertas := v_alertas || jsonb_build_object('tipo', 'Tarjeta sin cobro en datáfono', 'detalle',
        v_tj_sin_n || ' pago(s) con tarjeta en el ERP que no aparecen en el reporte de Bold', 'valor', v_tj_sin_v);
    end if;
    if r.tarjeta > 0 and v_dataf is null then
      v_alertas := v_alertas || jsonb_build_object('tipo', 'Falta datáfono', 'detalle',
        case when r.sede = 'Fabricato' then 'No llegó el cierre de turnos de Bold' else 'Falta la tirilla Redeban (o aún no se ha leído)' end,
        'valor', r.tarjeta);
    elsif v_dif_tarjeta is not null and abs(v_dif_tarjeta) >= 1 then
      v_alertas := v_alertas || jsonb_build_object('tipo', 'Diferencia datáfono', 'detalle',
        'ERP ' || r.tarjeta || ' vs datáfono ' || v_dataf, 'valor', v_dif_tarjeta);
    end if;

    -- Recibos del sistema de facturación
    v_cubre_recibos := fn_fuente_cubre('recibos_sistema', r.fecha);
    select count(*), coalesce(sum(valor), 0) into v_rec_ng_n, v_rec_ng_v
    from v_conc_recibos_no_generados x where x.fecha = r.fecha and x.sede = r.sede;
    select count(*), coalesce(sum(valor), 0), count(*) filter (where posible_duplicado)
      into v_rec_sp_n, v_rec_sp_v, v_rec_dup
    from v_conc_recibos_sin_pago x where x.fecha = r.fecha and x.sede = r.sede;
    if r.total > 0 and not v_cubre_recibos then
      v_alertas := v_alertas || jsonb_build_object('tipo', 'Falta reporte de recibos', 'detalle',
        'No hay reporte de recibos de caja del sistema de facturación que cubra este día', 'valor', r.total);
    end if;
    if v_rec_ng_n > 0 then
      v_alertas := v_alertas || jsonb_build_object('tipo', 'Recibo no generado', 'detalle',
        v_rec_ng_n || ' pago(s) del ERP sin recibo de caja en el sistema de facturación', 'valor', v_rec_ng_v);
    end if;
    if v_rec_sp_n > 0 then
      v_alertas := v_alertas || jsonb_build_object('tipo',
        case when v_rec_dup > 0 then 'Recibo duplicado' else 'Recibo sin pago en ERP' end, 'detalle',
        v_rec_sp_n || ' recibo(s) del sistema de facturación sin pago en el ERP'
          || case when v_rec_dup > 0 then ' (' || v_rec_dup || ' posible(s) duplicado(s))' else '' end,
        'valor', v_rec_sp_v);
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
$$;

-- El cliente (pantalla de administración) puede disparar el recálculo.
grant execute on function fn_conciliar_cierre(date, date) to authenticated;
grant execute on function fn_actualizar_cierres_caja(date, date) to authenticated;
