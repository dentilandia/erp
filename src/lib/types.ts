export type Rol = "operacion" | "admin";

export interface Perfil {
  id: string;
  nombre: string;
  rol: Rol;
  sede_id: string | null;
}

export interface Sede {
  id: string;
  nombre: string;
  color_acento: string;
}

export interface Doctora {
  id: string;
  nombre: string;
  color_pastel: string;
  retencion_voluntaria_activa: boolean;
  retencion_voluntaria_pct: number;
  activa: boolean;
}

export interface Paciente {
  id: string;
  nombre: string;
  telefono: string | null;
}

export type EstadoVisita = "espera" | "consulta" | "cobrado";

export interface Visita {
  id: string;
  sede_id: string;
  paciente_id: string;
  doctora_id: string;
  fecha: string;
  estado: EstadoVisita;
  tratamiento: string | null;
  proxima_cita: string | null;
  motivo_valor_cero: string | null;
  remision_especialidad: string | null;
  atendido_por: string | null;
  created_at: string;
  updated_at: string;
}

export type CategoriaCargo = "procedimiento" | "rx" | "concepto_administrativo";
export type RegistradoEn = "recepcion" | "consultorio";

export interface Cargo {
  id: string;
  visita_id: string;
  sede_id: string;
  doctora_id: string;
  fecha: string;
  categoria: CategoriaCargo;
  concepto: string;
  valor: number;
  registrado_en: RegistradoEn;
  created_at: string;
}

export type MedioPago =
  | "efectivo"
  | "tarjeta_debito"
  | "tarjeta_credito"
  | "transferencia_debito"
  | "addi"
  | "sistecredito"
  | "saldo_favor";

export const MEDIOS_PAGO: { value: MedioPago; label: string }[] = [
  { value: "efectivo", label: "Efectivo" },
  { value: "tarjeta_debito", label: "Tarjeta Débito" },
  { value: "tarjeta_credito", label: "Tarjeta Crédito" },
  { value: "transferencia_debito", label: "Transferencia Débito" },
  { value: "addi", label: "Addi" },
  { value: "sistecredito", label: "Sistecrédito" },
  { value: "saldo_favor", label: "Saldo a favor" },
];

export interface CargoPago {
  id: string;
  cargo_id: string;
  sede_id: string;
  medio_pago: MedioPago;
  valor: number;
  saldo_id: string | null;
  financiacion_pagado: boolean | null;
  financiacion_fecha_pago: string | null;
  comprobante_financiacion_url: string | null;
  created_at: string;
}

export interface SaldoFavor {
  id: string;
  paciente_id: string;
  sede_origen_id: string;
  valor: number;
  valor_disponible: number;
  medio_origen: string;
  fecha: string;
  cargo_pago_origen_id: string | null;
  notas: string | null;
}

export const CONCEPTOS_ADMINISTRATIVOS = [
  "Anticipo sedación intravenosa",
  "Sedación intravenosa",
  "Anticipo sedación óxido nitroso",
  "Sedación óxido nitroso",
  "GUM",
  "Caja aparato",
  "Llave de aparato",
];

export const TIPOS_INSUMO_CONSULTA: { value: string; label: string }[] = [
  { value: "mascara_facial", label: "Máscara facial" },
  { value: "elasticos_intraoral", label: "Elásticos intraoral" },
  { value: "traccion_extraoral", label: "Tracción extra oral" },
];

export const TIPOS_SERVICIO_LAB: { value: string; label: string }[] = [
  { value: "fabricacion", label: "Fabricación" },
  { value: "reparacion", label: "Reparación" },
  { value: "modificacion", label: "Modificación" },
  { value: "readaptacion", label: "Readaptación" },
  { value: "reposicion", label: "Reposición" },
];

export interface Laboratorio {
  id: string;
  nombre: string;
  activo: boolean;
}

export type EstadoLab = "enviado" | "recibido" | "instalado";

export interface LabOrden {
  id: string;
  visita_id: string | null;
  sede_id: string;
  doctora_id: string;
  paciente_id: string;
  laboratorio_id: string;
  tipo_servicio: string;
  estado: EstadoLab;
  fecha_envio: string;
  factura_numero: string | null;
  consecutivo: string | null;
  valor_factura: number | null;
  fecha_recibido: string | null;
  fecha_instalado: string | null;
  mes_liquidacion: string | null;
}

export interface CierreDiario {
  id: string;
  sede_id: string;
  fecha: string;
  otros_ingresos: number;
  gasto: number;
  consignado: boolean;
  comprobante_url: string | null;
  fecha_consignacion: string | null;
  entregado_admin: boolean;
  fecha_entrega_admin: string | null;
  notas: string | null;
}

export interface ErrorCruzado {
  tipo: string;
  paciente: string;
  valor: number;
  sede_recibo: string;
}

export interface TransfPendiente {
  paciente: string;
  valor: number;
}

export interface DupElec {
  paciente: string;
  valor: number;
  medio: string;
  nota: string;
}

export interface AddiDetalle {
  paciente: string;
  valor: number;
  medio: string;
  nota?: string;
}

export interface CierreCaja {
  id: string;
  fecha: string;
  sede: string;
  tarjeta_fact: number;
  transf_fact: number;
  efvo_fact: number;
  addi: number;
  total: number;
  arqueo: number | null;
  dataf_spro: number | null;
  dataf_qr: number | null;
  monto_cruzado: number;
  dif_dataf_bruta: number | null;
  dif_dataf_neta: number | null;
  dataf_explicado: boolean;
  transf_directa: number;
  dif_efvo: number;
  cuadra: boolean;
  transf_por_verificar: boolean;
  transf_sin_banco: boolean;
  dataf_sin_docs: boolean;
  urgente_transf: boolean;
  gasto: number | null;
  fuente_dataf: string | null;
  fuente_transf: string | null;
  dataf_explicacion: string | null;
  nota_dataf_extra: string | null;
  nota_transf_extra: string | null;
  nota_banco_extra: string | null;
  nota_limitacion: string | null;
  nota_cuenta2: string | null;
  consignacion_cuenta2: boolean;
  nota_consignacion_pendiente: string | null;
  errores: ErrorCruzado[];
  transfs: TransfPendiente[];
  dups_elec: DupElec[];
  addi_detalle: AddiDetalle[];
  url_recibos_caja: string | null;
  url_movimientos_banco: string | null;
  url_tirilla_datafono: string | null;
  url_reporte_datafono: string | null;
  analisis_ia: AnalisisIA | null;
}

export interface AnalisisIA {
  efectivo_real: number | null;
  datafono_real: number | null;
  banco_consignado: number | null;
  diferencia_efectivo: number | null;
  diferencia_datafono: number | null;
  cuadra_sugerido: boolean;
  resumen: string;
  generado_en: string;
}
