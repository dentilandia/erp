-- "Horas extra por atención de paciente" era admin-only, pero quien de
-- verdad registra/finaliza la solicitud es el equipo de operación (recepción/
-- consultorio) que se quedó atendiendo al paciente — reemplaza el aviso por
-- WhatsApp, así que tiene que poder usarlo ese mismo equipo, no solo admin.
create or replace function fn_es_operacion()
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce((select rol = 'operacion' from perfiles where id = auth.uid()), false);
$$;

create policy asistencia_horas_extra_operacion on asistencia_horas_extra
  for all
  using (fn_es_operacion())
  with check (fn_es_operacion());

create policy asistencia_horas_extra_colab_operacion on asistencia_horas_extra_colaboradores
  for all
  using (fn_es_operacion())
  with check (fn_es_operacion());
