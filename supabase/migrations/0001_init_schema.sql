-- ERP Dentilandia — esquema inicial (Capa 1: datos maestros + Operación Diaria)
-- Principio rector (lección del prototipo): cada componente del cobro se registra
-- con su propio medio de pago desde el momento en que se cobra. Nunca se reconstruye
-- después qué medio pagó qué concepto.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ============================================================
-- DATOS MAESTROS
-- ============================================================

create table sedes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  color_acento text not null,
  created_at timestamptz not null default now()
);

create table doctoras (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  color_pastel text not null,
  retencion_voluntaria_activa boolean not null default false,
  retencion_voluntaria_pct numeric(5,2) not null default 3.00,
  activa boolean not null default true,
  created_at timestamptz not null default now()
);

create table pacientes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  telefono text,
  created_at timestamptz not null default now()
);
create index idx_pacientes_nombre_trgm on pacientes using gin (nombre gin_trgm_ops);

create table laboratorios (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  activo boolean not null default true
);

create table precios_config (
  clave text primary key,
  valor numeric(12,2) not null,
  updated_at timestamptz not null default now()
);

-- perfiles: une auth.users con el rol y la sede. El login "por sede" (recepción/consultorio)
-- usa rol='operacion' con sede_id fija; Tomás usa rol='admin' con sede_id null (filtro libre).
create table perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null,
  rol text not null check (rol in ('operacion','admin')),
  sede_id uuid references sedes(id),
  created_at timestamptz not null default now(),
  constraint perfiles_operacion_requiere_sede check (rol <> 'operacion' or sede_id is not null)
);

create or replace function fn_perfil_sede()
returns uuid language sql stable security definer set search_path = public as $$
  select sede_id from perfiles where id = auth.uid();
$$;

create or replace function fn_es_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select rol = 'admin' from perfiles where id = auth.uid()), false);
$$;

-- ============================================================
-- OPERACIÓN DIARIA: visitas, cargos (pago por componente), saldo a favor
-- ============================================================

create table visitas (
  id uuid primary key default gen_random_uuid(),
  sede_id uuid not null references sedes(id),
  paciente_id uuid not null references pacientes(id),
  doctora_id uuid not null references doctoras(id),
  fecha date not null default current_date,
  estado text not null default 'espera' check (estado in ('espera','consulta','cobrado')),
  tratamiento text,
  proxima_cita date,
  motivo_valor_cero text,
  atendido_por text, -- trazabilidad libre (sin cuenta individual); ver decisión de auth por sede
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_visitas_sede_fecha on visitas (sede_id, fecha);
create index idx_visitas_paciente on visitas (paciente_id);

-- saldos_favor se crea antes de cargo_pagos; el vínculo a su origen se agrega
-- como FK diferida más abajo, una vez existe cargo_pagos (referencia cruzada).
create table saldos_favor (
  id uuid primary key default gen_random_uuid(),
  paciente_id uuid not null references pacientes(id),
  sede_origen_id uuid not null references sedes(id),
  valor numeric(12,2) not null check (valor > 0),
  valor_disponible numeric(12,2) not null check (valor_disponible >= 0),
  medio_origen text not null,
  fecha date not null default current_date,
  cargo_pago_origen_id uuid,
  notas text,
  created_at timestamptz not null default now(),
  constraint saldos_disponible_no_mayor_que_valor check (valor_disponible <= valor)
);
create index idx_saldos_paciente on saldos_favor (paciente_id) where valor_disponible > 0;

-- cargos: cada línea cobrable de una visita. categoria='procedimiento' es lo ÚNICO
-- que cuenta como honorario de doctora (30%) — rx y concepto_administrativo nunca cuentan,
-- aunque se cobren en la misma visita y con saldo a favor (corrección clave del traspaso).
create table cargos (
  id uuid primary key default gen_random_uuid(),
  visita_id uuid not null references visitas(id) on delete cascade,
  sede_id uuid not null references sedes(id),
  doctora_id uuid not null references doctoras(id),
  fecha date not null,
  categoria text not null check (categoria in ('procedimiento','rx','concepto_administrativo')),
  concepto text not null,
  valor numeric(12,2) not null check (valor >= 0),
  registrado_en text not null check (registrado_en in ('recepcion','consultorio')),
  created_at timestamptz not null default now()
);
create index idx_cargos_visita on cargos (visita_id);
create index idx_cargos_sede_fecha_categoria on cargos (sede_id, fecha, categoria);

-- Deriva sede/doctora/fecha desde la visita para que RLS no dependa de lo que
-- envíe el cliente (evita que un cargo quede "mal clasificado" de sede/doctora).
create or replace function fn_heredar_datos_visita()
returns trigger language plpgsql as $$
declare
  v_sede uuid; v_doctora uuid; v_fecha date;
begin
  select sede_id, doctora_id, fecha into v_sede, v_doctora, v_fecha from visitas where id = new.visita_id;
  if v_sede is null then
    raise exception 'visita % no existe', new.visita_id;
  end if;
  new.sede_id := v_sede;
  new.doctora_id := v_doctora;
  new.fecha := v_fecha;
  return new;
end;
$$;

create trigger trg_cargos_heredar_datos
  before insert or update of visita_id on cargos
  for each row execute function fn_heredar_datos_visita();

-- cargo_pagos: el medio de pago asignado a CADA cargo por separado. Un cargo puede
-- tener varias filas (ej. mitad efectivo, mitad saldo a favor).
create table cargo_pagos (
  id uuid primary key default gen_random_uuid(),
  cargo_id uuid not null references cargos(id) on delete cascade,
  sede_id uuid not null references sedes(id),
  medio_pago text not null check (medio_pago in
    ('efectivo','tarjeta_debito','tarjeta_credito','transferencia_debito','addi','sistecredito','saldo_favor')),
  valor numeric(12,2) not null check (valor > 0),
  saldo_id uuid references saldos_favor(id),
  financiacion_pagado boolean,
  financiacion_fecha_pago date,
  created_at timestamptz not null default now(),
  constraint cargo_pagos_saldo_check check (
    (medio_pago = 'saldo_favor' and saldo_id is not null) or
    (medio_pago <> 'saldo_favor' and saldo_id is null)
  )
);
create index idx_cargo_pagos_cargo on cargo_pagos (cargo_id);

alter table saldos_favor
  add constraint fk_saldos_favor_origen foreign key (cargo_pago_origen_id) references cargo_pagos(id);

create or replace function fn_cargo_pagos_heredar_sede()
returns trigger language plpgsql as $$
begin
  select sede_id into new.sede_id from cargos where id = new.cargo_id;
  return new;
end;
$$;

create trigger trg_cargo_pagos_heredar_sede
  before insert or update of cargo_id on cargo_pagos
  for each row execute function fn_cargo_pagos_heredar_sede();

-- Control estructural: nunca se puede consumir más saldo del que existe.
-- SECURITY DEFINER porque el ajuste de valor_disponible en saldos_favor debe poder
-- ocurrir sin depender de que el usuario tenga permiso de UPDATE directo sobre esa tabla
-- (ese permiso directo queda reservado a admin; el flujo normal solo pasa por aquí).
-- SELECT ... FOR UPDATE bloquea la fila del saldo durante la transacción, así que dos
-- cobros concurrentes desde sedes distintas contra el mismo saldo no pueden sobre-consumirlo.
create or replace function fn_cargo_pagos_ajustar_saldo()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_disponible numeric(12,2);
begin
  if old is not null and old.medio_pago = 'saldo_favor' then
    update saldos_favor set valor_disponible = valor_disponible + old.valor where id = old.saldo_id;
  end if;

  if new is not null and new.medio_pago = 'saldo_favor' then
    select valor_disponible into v_disponible from saldos_favor where id = new.saldo_id for update;
    if v_disponible is null then
      raise exception 'Saldo a favor % no existe', new.saldo_id;
    end if;
    if v_disponible < new.valor then
      raise exception 'Saldo a favor insuficiente: disponible % pero se intentó consumir %', v_disponible, new.valor;
    end if;
    update saldos_favor set valor_disponible = valor_disponible - new.valor where id = new.saldo_id;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger trg_cargo_pagos_ajustar_saldo
  before insert or update or delete on cargo_pagos
  for each row execute function fn_cargo_pagos_ajustar_saldo();

-- ============================================================
-- CONSULTORIO: insumos de aparatología (costo compartido 30/70, NO cobrados al paciente
-- por separado) y aparatos enviados a laboratorio.
-- ============================================================

create table insumos_consulta (
  id uuid primary key default gen_random_uuid(),
  visita_id uuid not null references visitas(id) on delete cascade,
  sede_id uuid not null references sedes(id),
  doctora_id uuid not null references doctoras(id),
  fecha date not null,
  tipo text not null check (tipo in ('mascara_facial','traccion_extraoral','elasticos_intraoral')),
  valor_costo numeric(12,2) not null check (valor_costo >= 0),
  created_at timestamptz not null default now()
);
create index idx_insumos_visita on insumos_consulta (visita_id);

create trigger trg_insumos_heredar_datos
  before insert or update of visita_id on insumos_consulta
  for each row execute function fn_heredar_datos_visita();

create table lab_ordenes (
  id uuid primary key default gen_random_uuid(),
  visita_id uuid references visitas(id),
  sede_id uuid not null references sedes(id),
  doctora_id uuid not null references doctoras(id),
  paciente_id uuid not null references pacientes(id),
  laboratorio_id uuid not null references laboratorios(id),
  tipo_servicio text not null check (tipo_servicio in
    ('fabricacion','reparacion','modificacion','readaptacion','reposicion')),
  estado text not null default 'enviado' check (estado in ('enviado','recibido','instalado')),
  fecha_envio date not null default current_date,
  factura_numero text,
  consecutivo text,
  valor_factura numeric(12,2),
  fecha_recibido date,
  fecha_instalado date,
  mes_liquidacion date, -- override manual para facturas que llegaron tarde; si es null se usa el mes de fecha_recibido
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_lab_ordenes_sede_estado on lab_ordenes (sede_id, estado);
create index idx_lab_ordenes_doctora_estado on lab_ordenes (doctora_id, estado);

-- ============================================================
-- CIERRE DIARIO
-- Los totales por medio de pago y por doctora se calculan siempre desde
-- cargo_pagos/cargos (fuente de verdad); esta tabla solo guarda lo que no se puede
-- derivar: otros ingresos manuales, gasto, y el estado de consignación.
-- ============================================================

create table cierres_diarios (
  id uuid primary key default gen_random_uuid(),
  sede_id uuid not null references sedes(id),
  fecha date not null,
  otros_ingresos numeric(12,2) not null default 0,
  gasto numeric(12,2) not null default 0,
  consignado boolean not null default false,
  comprobante_url text,
  fecha_consignacion date,
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sede_id, fecha)
);

-- ============================================================
-- LIQUIDACIONES (esqueleto — se usa desde la fase de Liquidaciones, no en Operación Diaria)
-- ============================================================

create table liquidaciones_doctora (
  id uuid primary key default gen_random_uuid(),
  doctora_id uuid not null references doctoras(id),
  periodo_inicio date not null,
  periodo_fin date not null,
  total_ventas numeric(12,2) not null,
  porcentaje numeric(5,2) not null,
  valor_bruto numeric(12,2) not null,
  total_laboratorios numeric(12,2) not null,
  total_pago numeric(12,2) not null,
  retencion_valor numeric(12,2),
  retencion_tipo text check (retencion_tipo in ('voluntaria','depuracion')),
  retencion_asignada_por uuid references perfiles(id),
  retencion_asignada_fecha timestamptz,
  total_consignado numeric(12,2),
  ibc numeric(12,2) not null,
  estado text not null default 'calculada' check (estado in ('calculada','retencion_asignada','pagada')),
  created_at timestamptz not null default now(),
  unique (doctora_id, periodo_inicio, periodo_fin)
);

-- Append-only por diseño: la retención por depuración se asigna DESPUÉS de calculada
-- la liquidación y debe quedar trazable (quién, cuándo) — nunca se sobreescribe una fila.
create table retenciones_historial (
  id uuid primary key default gen_random_uuid(),
  liquidacion_id uuid not null references liquidaciones_doctora(id) on delete cascade,
  valor numeric(12,2) not null,
  tipo text not null check (tipo in ('voluntaria','depuracion')),
  asignada_por uuid references perfiles(id),
  fecha timestamptz not null default now(),
  nota text
);

-- ============================================================
-- SEED: datos maestros conocidos desde el traspaso
-- ============================================================

insert into sedes (nombre, color_acento) values
  ('Parque Fabricato', '#009F98'),
  ('Clínica Las Américas', '#7B5AA6');

insert into doctoras (nombre, color_pastel) values
  ('Carolina Gomez', '#B08FC7'),
  ('Carolina Mesa', '#7FCBC4'),
  ('Catalina Manes', '#F0C48A'),
  ('Katherina Ramirez', '#E39B9B'),
  ('Laura Velasquez', '#8FBFA8'),
  ('Maria Camila Restrepo', '#A8A0D8'),
  ('Stefania Mesa', '#F0B199'),
  ('Santiago Burgos', '#84B6D6'),
  ('Tatiana Ortiz', '#C9A0BE'),
  ('Valentina Toro', '#9BC97F'),
  ('Leon Agudelo', '#D6B26A'),
  ('Juan Sebastian Montoya', '#8AA6C9');

insert into laboratorios (nombre) values ('Ruby'), ('Orthoki');

insert into precios_config (clave, valor) values
  ('mascara_facial', 45000),
  ('elasticos_intraoral', 18000),
  ('traccion_extraoral', 60000),
  ('rx', 35000);
