-- Bucket privado para comprobantes de consignación del cierre diario.
-- Ruta de cada objeto: <sede_id>/<fecha>-<nombre-archivo>

insert into storage.buckets (id, name, public)
values ('comprobantes', 'comprobantes', false)
on conflict (id) do nothing;

create policy comprobantes_select on storage.objects
  for select using (
    bucket_id = 'comprobantes'
    and (fn_es_admin() or (storage.foldername(name))[1] = fn_perfil_sede()::text)
  );

create policy comprobantes_insert on storage.objects
  for insert with check (
    bucket_id = 'comprobantes'
    and (fn_es_admin() or (storage.foldername(name))[1] = fn_perfil_sede()::text)
  );

create policy comprobantes_update on storage.objects
  for update using (
    bucket_id = 'comprobantes'
    and (fn_es_admin() or (storage.foldername(name))[1] = fn_perfil_sede()::text)
  );
