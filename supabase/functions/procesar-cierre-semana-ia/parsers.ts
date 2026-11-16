// Lectores determinísticos (sin IA) de los soportes del cierre de caja.
//
// Reciben las filas de la primera hoja del archivo (array de arrays, tal
// como las entrega XLSX.utils.sheet_to_json(hoja, { header: 1 })) y devuelven
// cada línea como un registro con una huella estable, para que subir dos
// veces el mismo extracto (o dos lotes que se cruzan) no duplique nada.
//
// Formatos soportados (los que se descargan hoy, nov-2026):
//   - Bancolombia "Extracto" en Excel (Sucursal Virtual Empresas): bloque
//     "Información General" con DESDE/HASTA/NRO CUENTA y luego "Movimientos"
//     con FECHA (d/m) · DESCRIPCIÓN · SUCURSAL · DCTO. · VALOR · SALDO,
//     repitiendo encabezados en cada página.
//   - Bold "Reporte mensual de transacciones" (hoja Consolidado): una fila
//     por cobro con ID TRANSACCIÓN, FECHA, OPERACIÓN, VALOR TOTAL, METODO DE
//     PAGO (Qr_Bold / Tarjeta…), NOMBRE DEL PAGADOR, NOMBRE DEL DATÁFONO.
//   - Recibos de caja del sistema de facturación: se ubican las columnas por
//     el nombre del encabezado (número, fecha, paciente, medio, valor, sede).
//
// Este archivo no importa nada: lo usa el edge function (Deno) y también se
// puede correr con Node para cargar extractos a mano.

export type Fila = unknown[];
export type Cuenta = "bancolombia_americas" | "bancolombia_fabricato" | "bold_fabricato";
export type Sede = "Las Americas" | "Fabricato";
export type Categoria =
  | "transferencia_paciente"
  | "consignacion_efectivo"
  | "datafono"
  | "financiacion"
  | "traslado_interno"
  | "intereses"
  | "comision_impuesto"
  | "egreso"
  | "otro_ingreso";

export interface MovimientoBanco {
  cuenta: Cuenta;
  sede: Sede;
  fecha: string; // YYYY-MM-DD
  valor: number; // + entra, − sale
  valor_bruto: number | null;
  descripcion: string;
  referencia: string | null;
  categoria: Categoria;
  estado: "pendiente" | "no_aplica";
  nota: string | null;
  huella: string;
}

export interface ReciboSistema {
  sede: Sede;
  fecha: string;
  numero: string | null;
  paciente: string | null;
  medio: string;
  valor: number;
  anulado: boolean;
  huella: string;
}

export interface ResultadoLectura {
  fuente: Cuenta | "recibos_sistema";
  desde: string;
  hasta: string;
  movimientos: MovimientoBanco[];
  recibos: ReciboSistema[];
  avisos: string[];
}

// Cuentas Bancolombia de Dentilandia → a qué sede pertenecen.
const CUENTAS_BANCOLOMBIA: Record<string, { cuenta: Cuenta; sede: Sede }> = {
  "33188020149": { cuenta: "bancolombia_americas", sede: "Las Americas" },
  "33100002157": { cuenta: "bancolombia_fabricato", sede: "Fabricato" },
};

const texto = (v: unknown) => (v === null || v === undefined ? "" : String(v)).trim();
const normal = (v: unknown) =>
  texto(v)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();

/** "1,234,567.89" / "-8,301,064.00" / ".15" / 144000 → número. */
export function numero(v: unknown): number {
  if (typeof v === "number") return v;
  const t = texto(v).replace(/\$/g, "").replace(/\s/g, "");
  if (!t) return NaN;
  // Formato colombiano con coma decimal ("1.234,56") — poco común en estos
  // extractos, pero se tolera.
  if (/^-?[\d.]+,\d{1,2}$/.test(t)) return Number(t.replace(/\./g, "").replace(",", "."));
  return Number(t.replace(/,/g, ""));
}

function ymd(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** "2026/10/31", "2026-10-31", "31/10/2026", Date o serial de Excel → YYYY-MM-DD. */
export function fechaISO(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) return ymd(v.getFullYear(), v.getMonth() + 1, v.getDate());
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const dt = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  const t = texto(v);
  let m = t.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return ymd(+m[3], +m[2], +m[1]);
  return null;
}

export function detectarFormato(filas: Fila[]): "bancolombia" | "bancolombia_csv" | "bold" | "bold_cuenta" | "recibos" | null {
  const primeras = filas.slice(0, 40).map((f) => f.map(normal).join("|"));
  // CSV de Bancolombia (descarga estándar, sin encabezado): 331-880201-49, 331, , 20261114, , 90000.00, 4027, PAGO QR ...
  if (filas.slice(0, 5).some((f) => /^\d{3}-\d{6}-\d{2}$/.test(texto(f[0])) && /^\d{8}$/.test(texto(f[3])))) return "bancolombia_csv";
  // Extracto de cuenta Bold: FECHA · IDENTIFICADOR · DESCRIPCION · VALOR · SALDO
  if (primeras.some((f) => f.startsWith("FECHA|IDENTIFICADOR|DESCRIPCION|VALOR"))) return "bold_cuenta";
  if (primeras.some((f) => f.includes("NRO CUENTA")) && primeras.some((f) => f.startsWith("MOVIMIENTOS"))) return "bancolombia";
  if (primeras.some((f) => f.includes("ID TRANSACCION") && f.includes("METODO DE PAGO"))) return "bold";
  if (primeras.some((f) => /RECIBO|NUMERO DE DOCUMENTO|DOCUMENTO/.test(f) && /FECHA/.test(f))) return "recibos";
  return null;
}

// ---------------------------------------------------------------- Bancolombia
function categoriaBancolombia(desc: string, valor: number, sede: Sede): { categoria: Categoria; estado: "pendiente" | "no_aplica"; nota: string | null } {
  const d = normal(desc);
  if (valor < 0) {
    if (/IMPTO|4X1000|IVA|COMISION|CUOTA MANEJO|SERVICIO PAGO|GMF/.test(d)) return { categoria: "comision_impuesto", estado: "no_aplica", nota: null };
    return { categoria: "egreso", estado: "no_aplica", nota: null };
  }
  if (/CONSIGNACION/.test(d)) return { categoria: "consignacion_efectivo", estado: "pendiente", nota: null };
  if (/(DESDE|DE) CTA\s+\d{8,}|DENTILANDIA/.test(d)) {
    return { categoria: "traslado_interno", estado: "no_aplica", nota: "Movimiento entre cuentas propias" };
  }
  if (/INTERES/.test(d)) return { categoria: "intereses", estado: "no_aplica", nota: null };
  if (/INV VIRT|INVERSION|CDT/.test(d)) {
    return { categoria: "traslado_interno", estado: "no_aplica", nota: "Movimiento de inversión virtual propia" };
  }
  if (/ABONO NETO|REDEBAN|CREDIBANCO/.test(d)) {
    // Liquidaciones del datáfono Redeban: llegan netas y agrupadas por
    // franquicia, no se pueden cruzar cobro por cobro — la tarjeta de Las
    // Américas se valida contra la tirilla Redeban del día.
    return { categoria: "datafono", estado: "no_aplica", nota: "Liquidación neta del datáfono (Redeban)" };
  }
  if (/ADELANTE SOLUC|ADDI|SISTECREDITO|SISTECR/.test(d)) {
    return { categoria: "financiacion", estado: "pendiente", nota: "Desembolso de financiación (Addi/Sistecrédito)" };
  }
  if (/PAGO QR|NEQUI|TRANSFERENCIA|TRANSF|INTERBANC|DAVIPLATA|PSE|BRE-B|BREB|LLAVE/.test(d)) {
    return { categoria: "transferencia_paciente", estado: "pendiente", nota: null };
  }
  return { categoria: "otro_ingreso", estado: "pendiente", nota: null };
}

export function leerBancolombia(filas: Fila[]): ResultadoLectura {
  const avisos: string[] = [];
  let desde: string | null = null;
  let hasta: string | null = null;
  let nroCuenta = "";
  for (let i = 0; i < filas.length - 1 && !nroCuenta; i++) {
    const enc = filas[i].map(normal);
    const iDesde = enc.indexOf("DESDE");
    const iCuenta = enc.indexOf("NRO CUENTA");
    if (iDesde >= 0 && iCuenta >= 0) {
      const val = filas[i + 1];
      desde = fechaISO(val[iDesde]);
      hasta = fechaISO(val[enc.indexOf("HASTA")]);
      nroCuenta = texto(val[iCuenta]).replace(/\D/g, "");
    }
  }
  const info = CUENTAS_BANCOLOMBIA[nroCuenta];
  if (!info) throw new Error(`Extracto Bancolombia de una cuenta no reconocida (${nroCuenta || "sin número"}).`);
  if (!desde || !hasta) throw new Error("El extracto Bancolombia no trae el período (DESDE/HASTA).");
  const [anioHasta, mesHasta] = hasta.split("-").map(Number);

  const movimientos: MovimientoBanco[] = [];
  const ordinales = new Map<string, number>();
  let enMovimientos = false;
  let iFecha = 0, iDesc = 1, iSuc = 2, iDcto = 3, iValor = 4;
  for (const f of filas) {
    const n = f.map(normal);
    if (n[0] === "FECHA" && n.includes("VALOR")) {
      enMovimientos = true;
      iFecha = 0;
      iDesc = n.findIndex((c) => c.startsWith("DESCRIPCION"));
      iSuc = n.indexOf("SUCURSAL");
      iDcto = n.findIndex((c) => c.startsWith("DCTO"));
      iValor = n.indexOf("VALOR");
      continue;
    }
    if (n.some((c) => c.includes("FIN ESTADO DE CUENTA"))) break;
    if (!enMovimientos) continue;
    const m = texto(f[iFecha]).match(/^(\d{1,2})\/(\d{1,2})$/);
    if (!m) continue; // encabezados de página repetidos, filas vacías
    const dia = +m[1], mes = +m[2];
    const anio = mes > mesHasta ? anioHasta - 1 : anioHasta;
    const valor = numero(f[iValor]);
    if (!isFinite(valor)) {
      avisos.push(`Fila sin valor legible: ${f.map(texto).join(" | ")}`);
      continue;
    }
    const descripcion = texto(f[iDesc]);
    const fecha = ymd(anio, mes, dia);
    const cat = categoriaBancolombia(descripcion, valor, info.sede);
    movimientos.push({
      cuenta: info.cuenta,
      sede: info.sede,
      fecha,
      valor,
      valor_bruto: null,
      descripcion: [descripcion, iSuc >= 0 ? texto(f[iSuc]) : ""].filter(Boolean).join(" · "),
      referencia: iDcto >= 0 ? texto(f[iDcto]) || null : null,
      ...cat,
      huella: huellaBancolombia(info.cuenta, fecha, valor, descripcion, ordinales),
    });
  }
  if (movimientos.length === 0) avisos.push("El extracto no trae movimientos.");
  return { fuente: info.cuenta, desde, hasta, movimientos, recibos: [], avisos };
}


/** Huella de una línea Bancolombia, igual en el Excel mensual y en el CSV
 *  diario: cuenta + fecha + valor + descripción + n.º de repetición de esa
 *  misma línea ese día (dos QR iguales del mismo valor el mismo día). */
function huellaBancolombia(cuenta: Cuenta, fecha: string, valor: number, descripcion: string, ordinales: Map<string, number>) {
  const base = `${cuenta}|${fecha}|${valor.toFixed(2)}|${normal(descripcion).replace(/[^A-Z0-9 ]/g, "")}`;
  const n = (ordinales.get(base) ?? 0) + 1;
  ordinales.set(base, n);
  return `${base}|${n}`;
}

/** CSV estándar de Bancolombia (sin encabezado). Columnas: cuenta, oficina,
 *  —, fecha AAAAMMDD, —, valor, código, descripción, … */
export function leerBancolombiaCSV(filas: Fila[]): ResultadoLectura {
  const avisos: string[] = [];
  const movimientos: MovimientoBanco[] = [];
  const ordinales = new Map<string, number>();
  let info: { cuenta: Cuenta; sede: Sede } | undefined;
  let minF: string | null = null, maxF: string | null = null;
  // El CSV viene del más reciente al más antiguo: se recorre al revés para
  // que el n.º de repetición coincida con el del Excel (orden cronológico).
  for (const f of [...filas].reverse()) {
    const cuentaTxt = texto(f[0]).replace(/\D/g, "");
    const m = texto(f[3]).match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!cuentaTxt || !m) continue;
    info = info ?? CUENTAS_BANCOLOMBIA[cuentaTxt];
    if (!info) throw new Error(`CSV de Bancolombia de una cuenta no reconocida (${cuentaTxt}).`);
    const fecha = ymd(+m[1], +m[2], +m[3]);
    const valor = numero(f[5]);
    if (!isFinite(valor)) {
      avisos.push(`Fila sin valor legible: ${f.map(texto).join(" | ")}`);
      continue;
    }
    const descripcion = texto(f[7]);
    minF = !minF || fecha < minF ? fecha : minF;
    maxF = !maxF || fecha > maxF ? fecha : maxF;
    movimientos.push({
      cuenta: info.cuenta,
      sede: info.sede,
      fecha,
      valor,
      valor_bruto: null,
      descripcion,
      referencia: texto(f[6]) || null,
      ...categoriaBancolombia(descripcion, valor, info.sede),
      huella: huellaBancolombia(info.cuenta, fecha, valor, descripcion, ordinales),
    });
  }
  if (!info || !minF || !maxF) throw new Error("El CSV de Bancolombia no trae movimientos.");
  // Sin encabezado de período: la cobertura es del primer al último día con
  // movimientos (conservador — nunca se acusa un faltante fuera de ese rango).
  return { fuente: info.cuenta, desde: minF, hasta: maxF, movimientos, recibos: [], avisos };
}

/** Extracto de cuenta Bold (CSV): aquí llegan las transferencias por llaves
 *  Bre-B y QR a la cuenta, que NO salen en el reporte de transacciones del
 *  datáfono, y las liquidaciones diarias del datáfono ("TRANSFERENCIA BOLD"). */
export function leerBoldCuenta(filas: Fila[]): ResultadoLectura {
  const avisos: string[] = [];
  const iEnc = filas.findIndex((f) => normal(f[0]) === "FECHA" && normal(f[1]) === "IDENTIFICADOR");
  const movimientos: MovimientoBanco[] = [];
  let minF: string | null = null, maxF: string | null = null;
  for (const f of filas.slice(iEnc + 1)) {
    const fecha = fechaISO(f[0]);
    const valor = numero(f[3]);
    if (!fecha || !isFinite(valor)) continue;
    const id = texto(f[1]);
    const descripcion = texto(f[2]);
    const d = normal(descripcion);
    minF = !minF || fecha < minF ? fecha : minF;
    maxF = !maxF || fecha > maxF ? fecha : maxF;
    let cat: { categoria: Categoria; estado: "pendiente" | "no_aplica"; nota: string | null };
    if (/DENTILANDIA/.test(d)) cat = { categoria: "traslado_interno", estado: "no_aplica", nota: "Traslado entre cuentas propias" };
    else if (valor < 0) cat = /GMF|COMISION|RETEFUENTE|IVA/.test(d)
      ? { categoria: "comision_impuesto", estado: "no_aplica", nota: null }
      : { categoria: "egreso", estado: "no_aplica", nota: null };
    else if (/INTERES/.test(d)) cat = { categoria: "intereses", estado: "no_aplica", nota: null };
    else if (/REEMBOLSO/.test(d)) cat = { categoria: "egreso", estado: "no_aplica", nota: "Reembolso de un envío propio" };
    else if (/TRANSFERENCIA BOLD/.test(d)) cat = { categoria: "datafono", estado: "no_aplica", nota: "Liquidación neta del datáfono Bold" };
    else if (/LLAVE|QR|TRANSFERENCIA ACH DE|PSE|NEQUI/.test(d)) cat = { categoria: "transferencia_paciente", estado: "pendiente", nota: null };
    else cat = { categoria: "otro_ingreso", estado: "pendiente", nota: null };
    movimientos.push({
      cuenta: "bold_fabricato",
      sede: "Fabricato",
      fecha,
      valor,
      valor_bruto: null,
      descripcion,
      referencia: id || null,
      ...cat,
      huella: `boldcta|${id}|${normal(descripcion)}|${valor.toFixed(2)}`,
    });
  }
  if (!minF || !maxF) throw new Error("El extracto de cuenta Bold no trae movimientos.");
  return { fuente: "bold_fabricato", desde: minF, hasta: maxF, movimientos, recibos: [], avisos };
}

// ----------------------------------------------------------------------- Bold
export function leerBold(filas: Fila[], nombreArchivo = ""): ResultadoLectura {
  const avisos: string[] = [];
  const iEnc = filas.findIndex((f) => f.map(normal).includes("ID TRANSACCION"));
  if (iEnc < 0) throw new Error("El reporte de Bold no trae la columna ID TRANSACCIÓN.");
  const enc = filas[iEnc].map(normal);
  const col = (nombre: string) => enc.indexOf(nombre);
  const c = {
    id: col("ID TRANSACCION"),
    fecha: col("FECHA"),
    operacion: col("OPERACION"),
    total: col("VALOR TOTAL"),
    deposito: col("DEPOSITO EN SALDO DE VENTAS"),
    metodo: col("METODO DE PAGO"),
    pagador: col("NOMBRE DEL PAGADOR"),
    datafono: col("NOMBRE DEL DATAFONO"),
    franquicia: col("FRANQUICIA"),
    tarjeta: col("TARJETA"),
    autorizacion: col("CODIGO AUTORIZACION"),
  };
  const movimientos: MovimientoBanco[] = [];
  let minF: string | null = null, maxF: string | null = null;
  for (const f of filas.slice(iEnc + 1)) {
    const id = texto(f[c.id]);
    if (!id) continue;
    if (normal(f[c.operacion]) !== "COBRO EXITOSO") continue; // rechazados / no realizados no movieron plata
    const fecha = fechaISO(f[c.fecha]);
    if (!fecha) {
      avisos.push(`Cobro ${id} sin fecha legible.`);
      continue;
    }
    minF = !minF || fecha < minF ? fecha : minF;
    maxF = !maxF || fecha > maxF ? fecha : maxF;
    const metodo = texto(f[c.metodo]);
    const esQR = /QR|PSE|TRANSFER|LLAVE|NEQUI/i.test(metodo);
    const bruto = numero(f[c.total]);
    const detalle = esQR
      ? [metodo, texto(f[c.pagador])].filter(Boolean).join(" · ")
      : [metodo, texto(f[c.franquicia]), texto(f[c.tarjeta]), c.autorizacion >= 0 ? `aut. ${texto(f[c.autorizacion])}` : ""]
          .filter(Boolean)
          .join(" · ");
    movimientos.push({
      cuenta: "bold_fabricato",
      sede: "Fabricato",
      fecha,
      // Se concilia contra el valor cobrado al paciente (bruto): es el que
      // registra el ERP. El neto depositado queda en la nota.
      valor: bruto,
      valor_bruto: bruto,
      descripcion: detalle,
      referencia: id,
      categoria: esQR ? "transferencia_paciente" : "datafono",
      estado: "pendiente",
      nota: c.deposito >= 0 ? `Neto depositado por Bold: ${numero(f[c.deposito])}` : null,
      huella: `bold|${id}`,
    });
  }
  // El reporte es mensual: cubre el mes completo aunque el último día no haya cobros.
  const mesArchivo = nombreArchivo.match(/(\d{4})-(\d{2})/);
  let desde = minF, hasta = maxF;
  if (mesArchivo) {
    const y = +mesArchivo[1], m = +mesArchivo[2];
    desde = ymd(y, m, 1);
    hasta = ymd(y, m, new Date(Date.UTC(y, m, 0)).getUTCDate());
  }
  if (!desde || !hasta) throw new Error("El reporte de Bold no trae cobros exitosos.");
  return { fuente: "bold_fabricato", desde, hasta, movimientos, recibos: [], avisos };
}

// ---------------------------------------------------- Recibos (facturación)
const MEDIOS: [RegExp, string][] = [
  [/EFECTIVO|CONTADO/, "efectivo"],
  [/CREDITO|CREDIT/, "tarjeta_credito"],
  [/DEBITO|DATAFONO|TARJETA/, "tarjeta_debito"],
  [/TRANSFER|NEQUI|QR|CONSIGNACION|BANCOLOMBIA|DAVIPLATA|BOLD/, "transferencia_debito"],
  [/ADDI/, "addi"],
  [/SISTECREDITO|SISTE/, "sistecredito"],
];

export function leerRecibos(filas: Fila[]): ResultadoLectura {
  const avisos: string[] = [];
  const iEnc = filas.findIndex((f) => {
    const n = f.map(normal).join("|");
    return /FECHA/.test(n) && /(NUMERO|DOCUMENTO|RECIBO)/.test(n);
  });
  if (iEnc < 0) throw new Error("No se encontró el encabezado del reporte de recibos.");
  const enc = filas[iEnc].map(normal);
  const buscar = (...pat: RegExp[]) => enc.findIndex((h) => pat.some((p) => p.test(h)));
  const c = {
    numero: buscar(/^NUMERO/, /RECIBO/, /CONSECUTIVO/),
    fecha: buscar(/^FECHA/),
    paciente: buscar(/PACIENTE/, /CLIENTE/, /TERCERO/, /NOMBRE/),
    medio: buscar(/MEDIO/, /FORMA DE PAGO/, /METODO/),
    valor: buscar(/^VALOR/, /^TOTAL/, /MONTO/),
    sede: buscar(/SEDE/, /SUCURSAL/, /BODEGA/, /CENTRO/),
    estado: buscar(/ESTADO/, /ANULAD/),
  };
  const faltan = Object.entries({ fecha: c.fecha, valor: c.valor, medio: c.medio }).filter(([, i]) => i < 0).map(([k]) => k);
  if (faltan.length > 0 && filas.slice(iEnc + 1).every((f) => f.every((c) => texto(c) === ""))) {
    throw new Error("El reporte de recibos llegó VACÍO (solo encabezados). En el sistema de facturación hay que filtrar el rango de fechas antes de exportar.");
  }
  if (faltan.length > 0) {
    throw new Error(
      `El reporte de recibos no trae las columnas: ${faltan.join(", ")}. Encabezados encontrados: ${filas[iEnc].map(texto).join(", ")}.`,
    );
  }
  const recibos: ReciboSistema[] = [];
  let minF: string | null = null, maxF: string | null = null;
  for (const f of filas.slice(iEnc + 1)) {
    const fecha = fechaISO(f[c.fecha]);
    const valor = numero(f[c.valor]);
    if (!fecha || !isFinite(valor)) continue;
    const medioTxt = normal(f[c.medio]);
    const medio = MEDIOS.find(([re]) => re.test(medioTxt))?.[1];
    if (!medio) {
      avisos.push(`Recibo con medio de pago no reconocido ("${texto(f[c.medio])}").`);
      continue;
    }
    const sedeTxt = c.sede >= 0 ? normal(f[c.sede]) : "";
    const sede: Sede = /FABRICATO|BELLO/.test(sedeTxt) ? "Fabricato" : "Las Americas";
    if (c.sede < 0) avisos.push("El reporte no trae sede: se asumió Las Américas.");
    const numeroRecibo = c.numero >= 0 ? texto(f[c.numero]) || null : null;
    minF = !minF || fecha < minF ? fecha : minF;
    maxF = !maxF || fecha > maxF ? fecha : maxF;
    recibos.push({
      sede,
      fecha,
      numero: numeroRecibo,
      paciente: c.paciente >= 0 ? texto(f[c.paciente]) || null : null,
      medio,
      valor,
      anulado: c.estado >= 0 && /ANULAD/.test(normal(f[c.estado])),
      huella: `recibo|${sede}|${numeroRecibo ?? `${fecha}|${medio}|${valor}|${normal(f[c.paciente])}`}`,
    });
  }
  if (recibos.length === 0 || !minF || !maxF) {
    throw new Error("El reporte de recibos de caja llegó vacío (solo trae encabezados). Descárgalo de nuevo con el rango de fechas.");
  }
  return { fuente: "recibos_sistema", desde: minF, hasta: maxF, movimientos: [], recibos, avisos: [...new Set(avisos)] };
}

export function leerDocumento(filas: Fila[], nombreArchivo: string): ResultadoLectura {
  const formato = detectarFormato(filas);
  if (formato === "bancolombia") return leerBancolombia(filas);
  if (formato === "bancolombia_csv") return leerBancolombiaCSV(filas);
  if (formato === "bold_cuenta") return leerBoldCuenta(filas);
  if (formato === "bold") return leerBold(filas, nombreArchivo);
  if (formato === "recibos") return leerRecibos(filas);
  throw new Error(
    `No se reconoce el formato de "${nombreArchivo}". Sube el extracto de Bancolombia (Excel o CSV), el extracto de cuenta o el reporte de transacciones de Bold, o el reporte de recibos de caja.`,
  );
}
