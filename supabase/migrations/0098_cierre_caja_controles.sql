-- ============================================================
-- CIERRE DE CAJA — Controles de auditoría (auditoría nov-2026)
--
-- Corrige los hallazgos de control del módulo:
--   1. "Cuadra" nacía en TRUE por defecto: todo día creado por la IA quedaba
--      cuadrado sin que nadie lo revisara (Fabricato: 33/33 "cuadra" con la IA
--      aprobando solo 10). Ahora nace en FALSE, solo una persona lo puede
--      confirmar, queda quién y cuándo, y si el sistema dice "revisar" la
--      confirmación exige una nota.
--   2. Si después de confirmar cambian los datos del día (un pago editado, un
--      extracto nuevo), el día se reabre solo — huella `resultado_hash`.
--   3. Trazabilidad: cierres_caja, cierres_diarios, gastos, períodos,
--      pendientes y revisión física quedan en cambios_auditoria.
--   4. Pendientes: no se pueden resolver sin una solución escrita ni "en bloque".
--   5. No se aceptan cierres diarios con fecha futura.
--   6. No se pueden crear períodos de documentos que se crucen con otro.
--   7. El cron diario procesa cualquier período reciente (no solo los que
--      empiezan lunes) y libera períodos que quedaron "procesando" colgados.
-- ============================================================

-- ---------- 1 y 2. Confirmación de "Cuadra" ----------
alter table cierres_caja alter column cuadra set default false;

alter table cierres_caja
  add column if not exists cuadra_confirmado_por uuid references auth.users(id),
  add column if not exists cuadra_confirmado_en timestamptz,
  add column if not exists cuadra_nota text,
  add column if not exists cuadra_hash text,              -- huella de los datos al momento de confirmar
  add column if not exists resultado_hash text,           -- huella de los datos del último cálculo
  add column if not exists resultado_ok boolean,          -- veredicto determinístico del sistema (sin IA)
  add column if not exists resultado_detalle jsonb,       -- diferencias por medio y alertas del cálculo
  add column if not exists reabierto_en timestamptz,
  add column if not exists reabierto_motivo text;

create or replace function fn_cierres_caja_confirmar_cuadra()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_era_cuadra boolean := case when tg_op = 'UPDATE' then old.cuadra else false end;
begin
  if new.cuadra and not v_era_cuadra then
    if v_uid is null then
      raise exception 'Solo una persona puede confirmar que un día cuadra (no un proceso automático).';
    end if;
    if coalesce(new.resultado_ok, false) = false
       or coalesce((new.analisis_ia->>'cuadra_sugerido')::boolean, true) = false then
      if length(trim(coalesce(new.cuadra_nota, ''))) < 10 then
        raise exception 'El sistema marcó este día para revisar: escribe en la nota por qué sí cuadra (mínimo 10 caracteres).';
      end if;
    end if;
    new.cuadra_confirmado_por := v_uid;
    new.cuadra_confirmado_en := now();
    new.cuadra_hash := new.resultado_hash;
    new.reabierto_en := null;
    new.reabierto_motivo := null;
  elsif not new.cuadra and v_era_cuadra then
    new.cuadra_confirmado_por := null;
    new.cuadra_confirmado_en := null;
    new.cuadra_hash := null;
  end if;

  -- Reapertura automática: el día estaba confirmado, pero el cálculo nuevo
  -- trae datos distintos a los que vio quien confirmó, y ya no está limpio.
  if tg_op = 'UPDATE' and old.cuadra and new.cuadra
     and new.resultado_hash is distinct from old.resultado_hash
     and new.cuadra_hash is distinct from new.resultado_hash
     and coalesce(new.resultado_ok, false) = false then
    new.cuadra := false;
    new.cuadra_confirmado_por := null;
    new.cuadra_confirmado_en := null;
    new.cuadra_hash := null;
    new.reabierto_en := now();
    new.reabierto_motivo := 'Cambiaron los datos del día después de confirmado y el sistema encontró diferencias.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_cierres_caja_confirmar_cuadra on cierres_caja;
create trigger trg_cierres_caja_confirmar_cuadra
  before insert or update on cierres_caja
  for each row execute function fn_cierres_caja_confirmar_cuadra();

-- (Antes de activar la trazabilidad, para no llenar el historial con este marcado.)
alter table cierres_pendientes_estado add column if not exists resuelto_en_bloque boolean not null default false;

-- Marca (sin reabrir) los 670 pendientes cerrados en bloque sin usuario, para
-- que la pantalla los distinga de los resueltos con una explicación real.
update cierres_pendientes_estado
set resuelto_en_bloque = true
where resuelto and (resuelto_por is null or solucion ilike 'Resuelto en bloque%');

-- ---------- 3. Trazabilidad ----------
-- Tablas con id uuid: se reutiliza fn_registrar_cambio (0092).
do $$
declare t text;
begin
  foreach t in array array['cierres_caja', 'cierres_diarios', 'cierres_diarios_gastos', 'cierres_caja_semanas'] loop
    execute format('drop trigger if exists trg_auditoria_%1$s on public.%1$s', t);
    execute format(
      'create trigger trg_auditoria_%1$s after insert or update or delete on public.%1$s
         for each row execute function public.fn_registrar_cambio()', t);
  end loop;
end $$;

-- Tablas con llave de texto/compuesta: el registro_id es un uuid derivado de
-- la llave (md5), así se puede consultar el historial de un mismo pendiente.
create or replace function fn_registrar_cambio_llave()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fila jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_llave text := '';
  v_col text;
  v_usuario_id uuid := auth.uid();
  v_usuario_nombre text;
begin
  foreach v_col in array tg_argv loop
    v_llave := v_llave || coalesce(v_fila->>v_col, '') || '|';
  end loop;
  select nombre into v_usuario_nombre from perfiles where id = v_usuario_id;
  insert into cambios_auditoria (tabla, registro_id, operacion, valores_anteriores, valores_nuevos, usuario_id, usuario_nombre)
  values (
    tg_table_name,
    md5(tg_table_name || ':' || v_llave)::uuid,
    lower(tg_op),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end,
    v_usuario_id,
    v_usuario_nombre
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_auditoria_cierres_pendientes_estado on cierres_pendientes_estado;
create trigger trg_auditoria_cierres_pendientes_estado
  after insert or update or delete on cierres_pendientes_estado
  for each row execute function fn_registrar_cambio_llave('clave');

drop trigger if exists trg_auditoria_cierres_revision_fisica on cierres_revision_fisica;
create trigger trg_auditoria_cierres_revision_fisica
  after insert or update or delete on cierres_revision_fisica
  for each row execute function fn_registrar_cambio_llave('fecha', 'sede');

-- ---------- 4. Pendientes: resolver exige solución escrita y usuario ----------

create or replace function fn_pendientes_validar_resolucion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.resuelto and (tg_op = 'INSERT' or not old.resuelto) then
    if auth.uid() is null then
      raise exception 'Un pendiente solo lo puede resolver una persona.';
    end if;
    if length(trim(coalesce(new.solucion, ''))) < 10 or new.solucion ilike 'Resuelto en bloque%' then
      raise exception 'Escribe cómo se resolvió este pendiente (mínimo 10 caracteres, no se permite resolver en bloque).';
    end if;
    new.resuelto_por := auth.uid();
    new.resuelto_en := now();
    new.resuelto_en_bloque := false;
  elsif not new.resuelto then
    new.resuelto_por := null;
    new.resuelto_en := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pendientes_validar_resolucion on cierres_pendientes_estado;
create trigger trg_pendientes_validar_resolucion
  before insert or update on cierres_pendientes_estado
  for each row execute function fn_pendientes_validar_resolucion();

-- ---------- 5. Cierres diarios con fecha futura ----------
create or replace function fn_cierres_diarios_sin_fecha_futura()
returns trigger
language plpgsql
as $$
begin
  if new.fecha > (now() at time zone 'America/Bogota')::date then
    raise exception 'No se puede registrar un cierre diario con fecha futura (%).', new.fecha;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cierres_diarios_sin_fecha_futura on cierres_diarios;
create trigger trg_cierres_diarios_sin_fecha_futura
  before insert or update of fecha on cierres_diarios
  for each row execute function fn_cierres_diarios_sin_fecha_futura();

-- ---------- 6. Períodos de documentos sin cruces ----------
create or replace function fn_cierres_caja_semanas_sin_cruce()
returns trigger
language plpgsql
as $$
declare
  v_fin date := coalesce(new.semana_fin, new.semana_inicio + 6);
  v_otro record;
begin
  if tg_op = 'UPDATE'
     and new.semana_inicio is not distinct from old.semana_inicio
     and new.semana_fin is not distinct from old.semana_fin then
    return new;
  end if;
  if v_fin < new.semana_inicio then
    raise exception 'La fecha final del período no puede ser anterior a la inicial.';
  end if;
  select semana_inicio, coalesce(semana_fin, semana_inicio + 6) as fin into v_otro
  from cierres_caja_semanas
  where id <> new.id
    and daterange(semana_inicio, coalesce(semana_fin, semana_inicio + 6), '[]')
        && daterange(new.semana_inicio, v_fin, '[]')
  limit 1;
  if found then
    raise exception 'Este período se cruza con otro ya creado (% a %). Cada día debe pertenecer a un solo período.',
      v_otro.semana_inicio, v_otro.fin;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cierres_caja_semanas_sin_cruce on cierres_caja_semanas;
create trigger trg_cierres_caja_semanas_sin_cruce
  before insert or update on cierres_caja_semanas
  for each row execute function fn_cierres_caja_semanas_sin_cruce();

-- ---------- 7. Cron diario ----------
alter table cierres_caja_semanas add column if not exists procesando_desde timestamptz;

create or replace function fn_procesar_cierres_caja_pendientes()
returns void
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_secret text;
  v_semana record;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cierre_caja_cron_secret';
  if v_secret is null then
    raise notice 'cierre_caja_cron_secret no está en Vault todavía — se omite esta corrida.';
    return;
  end if;

  -- Un período que quedó "procesando" más de 20 minutos se cayó a mitad de
  -- camino (timeout del edge function): se libera para que se reintente.
  update cierres_caja_semanas
  set procesando = false, error_ia = coalesce(error_ia, 'El procesamiento anterior no terminó (se liberó automáticamente).')
  where procesando and coalesce(procesando_desde, procesado_en, created_at) < now() - interval '20 minutes';

  for v_semana in
    select id from cierres_caja_semanas
    where coalesce(semana_fin, semana_inicio + 6) >= v_hoy - 21
      and semana_inicio <= v_hoy
      and procesando = false
      and (
        url_datafono_americas is not null or url_datafono_fabricato is not null or
        url_bancolombia is not null or url_bancolombia_fabricato is not null or
        url_bold_fabricato is not null or url_recibos_caja is not null
      )
  loop
    perform net.http_post(
      url := 'https://ctzyxmarmgmmgfdkdkhu.supabase.co/functions/v1/procesar-cierre-semana-ia',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN0enl4bWFybWdtbWdmZGtka2h1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2MjkxNTcsImV4cCI6MjEwMjIwNTE1N30.BPDqnNlzCKN_pu3olvttZnxiwsJXqSaiW_WTubZ8MUw',
        'x-cron-secret', v_secret
      ),
      body := jsonb_build_object('semana_id', v_semana.id),
      timeout_milliseconds := 150000
    );
  end loop;
end;
$$;
