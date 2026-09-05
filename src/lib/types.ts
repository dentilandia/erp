export type Rol = "operacion" | "admin";

export interface Perfil {
  id: string;
  nombre: string;
  rol: Rol;
  sede_id: string | null;
  puede_caja_menor: boolean;
}

export interface Sede {
  id: string;
  nombre: string;
  color_acento: string;
  ip_permitida: string | null;
}

/** Control de asistencia — marca de llegada/salida con foto, restringida a
 *  la IP pública de la sede (se valida en el edge function marcar-asistencia,
 *  esta tabla no admite insert directo desde el cliente). */
export type TipoAsistencia = "llegada" | "salida_almuerzo" | "entrada_almuerzo" | "salida";

export const TIPOS_ASISTENCIA: { value: TipoAsistencia; label: string }[] = [
  { value: "llegada", label: "Llegada" },
  { value: "salida_almuerzo", label: "Salida a almuerzo" },
  { value: "entrada_almuerzo", label: "Regreso de almuerzo" },
  { value: "salida", label: "Salida (fin de jornada)" },
];

export interface AsistenciaRegistro {
  id: string;
  perfil_id: string;
  sede_id: string | null;
  tipo: TipoAsistencia;
  foto_path: string | null;
  ip: string | null;
  marcado_en: string;
}

/** Frase mostrada al marcar llegada (motivadora) o salida final
 *  (agradecimiento/felicitación) — rota una nueva cada día. */
export interface FraseMotivacional {
  id: string;
  tipo: "llegada" | "salida";
  texto: string;
  orden: number;
  activa: boolean;
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
  observacion: string | null;
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
  motivo: string | null;
  notas: string | null;
}

/** Para qué es el saldo a favor — sedación (anticipo o pago completo por
 *  adelantado) ya no se cobra como concepto administrativo, se registra acá
 *  y se consume después como medio de pago "Saldo a favor" del cargo real. */
export const MOTIVOS_SALDO_FAVOR = [
  "Anticipo sedación",
  "Pago sedación",
  "Laboratorio aparato",
  "Tratamiento odontológico",
];

// "Sedación intravenosa" y "Sedación óxido nitroso" son el cobro real del
// procedimiento (el saldo restante tras aplicar el anticipo, si lo hubo) —
// el nombre exacto tiene que coincidir con CONCEPTOS_SEDACION en
// Liquidaciones.tsx para que ese reporte los encuentre. El anticipo/pago
// adelantado sigue siendo saldo a favor (motivo "Anticipo sedación"/"Pago
// sedación"), no un concepto administrativo — solo el cobro del día del
// procedimiento pasa por aquí.
export const CONCEPTOS_ADMINISTRATIVOS = [
  "GUM",
  "Caja aparato",
  "Llave de aparato",
  "Sedación intravenosa",
  "Sedación óxido nitroso",
];

export const TIPOS_INSUMO_CONSULTA: { value: string; label: string }[] = [
  { value: "mascara_facial", label: "Máscara facial" },
  { value: "elasticos_intraoral", label: "Elásticos intraoral" },
  { value: "traccion_extraoral", label: "Tracción extra oral" },
];

/** Los 4 insumos con inventario propio (con alerta de stock bajo). */
export const TIPOS_INVENTARIO: { value: string; label: string }[] = [
  { value: "mascara_facial", label: "Máscara facial" },
  { value: "elasticos_intraoral", label: "Elásticos intraoral" },
  { value: "gum", label: "GUM" },
  { value: "boton_traccion", label: "Botón de tracción" },
];

export interface InventarioStock {
  id: string;
  sede_id: string;
  tipo: string;
  cantidad: number;
  umbral_alerta: number;
}

/** Insumos generales (hotelería/bodega) — catálogo de ~170 ítems por
 *  categoría, con conteo por sede y por período (réplica del Excel). */
export interface InsumoGeneralCatalogo {
  id: string;
  categoria: string;
  nombre: string;
  orden: number;
  activo: boolean;
}

export interface InsumoGeneralPeriodo {
  id: string;
  sede_id: string;
  etiqueta: string;
  fecha_inicio: string;
  fecha_fin: string | null;
  cerrado: boolean;
}

export interface InsumoGeneralMovimiento {
  id: string;
  periodo_id: string;
  catalogo_id: string;
  inventario_inicial: number;
  entrega1: number;
  entrega2: number;
  salidas: number;
  entradas: number;
  pedido: number;
}

/** Salida formal de la bodega operativa de una sede (hacia consultorio/uso
 *  clínico) — la registra la propia sede, a diferencia de InsumoGeneralEntrega
 *  que es de la bodega administrativa hacia la sede y la registra admin. */
export interface InsumoGeneralSalida {
  id: string;
  sede_id: string;
  periodo_id: string;
  catalogo_id: string;
  cantidad: number;
  fecha: string;
  motivo: string | null;
  created_at: string;
}

/** Bodega administrativa central (una sola, no por sede) — donde llega lo
 *  que se compra. Desde ahí administración le entrega formalmente a cada
 *  sede (InsumoGeneralEntrega), lo que suma como "entradas" del período
 *  activo de esa sede y queda como histórico real de consumo. */
export interface InsumoGeneralBodegaAdmin {
  id: string;
  catalogo_id: string;
  cantidad: number;
  updated_at: string;
}

export interface InsumoGeneralEntrega {
  id: string;
  catalogo_id: string;
  sede_id: string;
  periodo_id: string;
  cantidad: number;
  fecha: string;
  created_at: string;
}

/** Caja menor por sede — acceso restringido a admin y a quien tenga
 *  perfiles.puede_caja_menor en esa sede. */
export interface CajaMenorPeriodo {
  id: string;
  sede_id: string;
  mes: string;
  monto_asignado: number;
  reembolsado: boolean;
  fecha_reembolso: string | null;
}

export interface CajaMenorMovimiento {
  id: string;
  periodo_id: string;
  fecha: string;
  factura_numero: string | null;
  nit_cedula: string | null;
  pagado_a: string;
  concepto: string;
  valor_factura: number;
  iva: number;
}

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
  doctora_instala_id: string | null;
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

export interface Interconsulta {
  id: string;
  visita_id: string | null;
  sede_id: string;
  paciente_id: string;
  doctora_id: string;
  especialidad: string;
  fecha: string;
  respuesta: string | null;
  evolucion_doctora: boolean;
  fin_interconsulta: boolean;
}

export interface CierreDiario {
  id: string;
  sede_id: string;
  fecha: string;
  otros_ingresos: number;
  gasto: number;
  gasto_concepto: string | null;
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
