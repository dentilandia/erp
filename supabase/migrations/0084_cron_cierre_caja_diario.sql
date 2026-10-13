-- Automatiza el disparo diario de procesar-cierre-semana-ia — antes había
-- que entrar y darle clic a "Procesar con IA" cada semana. Ahora, todas las
-- mañanas, se reprocesan la semana actual y la anterior (si tienen al menos
-- un documento subido) para que el análisis esté listo sin que nadie lo
-- pida. El edge function sigue siendo idempotente (upsert), así que
-- reprocesar un día que no cambió no hace daño.
--
-- El secreto que autoriza esta llamada (CIERRE_CAJA_CRON_SECRET) vive en
-- Vault, nunca en este archivo — se creó aparte con vault.create_secret().
-- La anon key sí va literal porque es pública (ya está en el bundle del
-- frontend) — solo sirve para pasar la verificación de JWT del gateway de
-- Supabase, la autorización real la hace el secreto de arriba.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function fn_procesar_cierres_caja_pendientes()
returns void
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_secret text;
  v_semana record;
  v_lunes_actual date := date_trunc('week', now() at time zone 'America/Bogota')::date;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cierre_caja_cron_secret';
  if v_secret is null then
    raise notice 'cierre_caja_cron_secret no está en Vault todavía — se omite esta corrida.';
    return;
  end if;

  for v_semana in
    select id from cierres_caja_semanas
    where semana_inicio in (v_lunes_actual, v_lunes_actual - 7)
      and procesando = false
      and (
        url_datafono_americas is not null or url_datafono_fabricato is not null or
        url_bancolombia is not null or url_bold_fabricato is not null or url_recibos_caja is not null
      )
  loop
    perform net.http_post(
      url := 'https://ctzyxmarmgmmgfdkdkhu.supabase.co/functions/v1/procesar-cierre-semana-ia',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN0enl4bWFybWdtbWdmZGtka2h1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2MjkxNTcsImV4cCI6MjEwMjIwNTE1N30.BPDqnNlzCKN_pu3olvttZnxiwsJXqSaiW_WTubZ8MUw',
        'x-cron-secret', v_secret
      ),
      body := jsonb_build_object('semana_id', v_semana.id)
    );
  end loop;
end;
$$;

select cron.schedule(
  'procesar-cierres-caja-diario',
  '0 11 * * *', -- 11:00 UTC = 6:00am Bogotá
  $$ select fn_procesar_cierres_caja_pendientes(); $$
);
