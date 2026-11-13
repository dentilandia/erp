/**
 * FACTURAS Y CUENTAS DE COBRO — Dentilandia S.A.S.
 * Registro automático de documentos de compra en el "Control de Facturación" (Google Sheet).
 * Apps Script ligado a la hoja.
 *
 * Dos flujos en cada corrida:
 *  A) FACTURAS ELECTRÓNICAS DIAN (correo con ZIP): lee el XML (UBL 2.1 / AttachedDocument).
 *  B) CUENTAS DE COBRO, NOTAS DE COBRO, RECIBOS y facturas no electrónicas (Word / PDF / foto):
 *     las lee con IA (API de Claude) porque cada proveedor usa su propio formato.
 *     Los anexos del mismo correo (planilla de seguridad social, formato de retefuente, RUT)
 *     se guardan en Drive junto al documento, sin generar fila.
 *
 * Para cada documento: verifica que sea a nombre de Dentilandia y que no esté ya registrado,
 * calcula la retención según ⚙️ Proveedores y ⚙️ Retención, escribe la fila en la pestaña del mes
 * con las fórmulas de siempre (I, K, N, Q, R, S), guarda soportes en Drive y etiqueta el correo.
 *
 * Colores: sin color = factura DIAN (datos exactos del XML); amarillo = cuenta de cobro leída con IA
 * (hay que generar el DS y verificar el valor contra el documento).
 * Pendiente (fases siguientes): notas crédito, pagado, método de pago.
 */

// ===================== CONFIGURACIÓN =====================
const CFG = {
  NIT_DENTILANDIA: '901117356',
  DESDE: '2026/11/01',           // no revisa correos anteriores a esta fecha (AAAA/MM/DD)
  DIAS_BUSQUEDA: 45,             // y como máximo los últimos 45 días
  MAX_POR_CORRIDA: 30,           // hilos de correo con posibles cuentas de cobro por corrida (usan IA)
  MAX_ZIP_POR_CORRIDA: 100,      // hilos con factura electrónica (ZIP) por corrida
  MES_SEGUN: 'RECEPCION',        // 'RECEPCION' (mes en que llega el correo) o 'EMISION' (fecha del documento)
  ESCRIBIR_REPARTICION: true,
  COLOR_XML: null,               // factura electrónica DIAN: sin color (datos exactos del XML)
  COLOR_IA: '#FFF2CC',           // amarillo: cuenta de cobro → generar el DS y verificar valor contra el documento
  COLOR_NUEVO: '#FFF2CC',        // proveedor nuevo en ⚙️ Proveedores
  CORREOS_REPORTE: 'facturaciondentilandia@gmail.com, gerencia@dentilandia.com.co', // reporte diario (separados por coma)
  CARPETA_SOPORTES_ID: '',
  NOMBRE_CARPETA_SOPORTES: 'Soportes facturas de compra',
  HORA_DIARIA: 8,                // corre entre 7:45 y 8:15 a. m.; el reporte llega por correo antes de las 8:30
  IA: {
    MODELO: 'claude-haiku-5-5',  // modelo de Claude para leer cuentas de cobro
    MAX_DOCS_POR_CORRIDA: 25,
    URL: 'https://api.anthropic.com/v1/messages',
  },
  // Un correo se revisa como posible cobro si el asunto, el cuerpo o un adjunto contienen:
  PALABRAS_COBRO: /cobro|cuenta|factura|recibo|honorario|\bcc\b|documentos|nota/i,
  // …y NO es uno de estos:
  EXCLUIR_ASUNTO: /reporte de facturaci[oó]n electr[oó]nica|bit[aá]cora|n[oó]mina electr|rips|resoluci[oó]n|extracto|chat with|chat de soporte|soporte t[eé]cnico|factura electr[oó]nica de venta generad|^\s*((fwd?|rv|re)\s*:\s*)*\d{6,12}\s*;/i,
  // Adjuntos que son anexos (se guardan, no generan fila):
  ANEXOS: /extracto|seguridad|planilla|\bss\b|^ss[\s_-]|pila|retefuente|rete\s?fuente|retenci[oó]n|\brut\b|certificad|aportes|autoliquid|comprobante de pago|soporte de pago/i,
  LABELS: {
    OK: 'Facturas/Registrada',
    DUP: 'Facturas/Ya estaba',
    NC: 'Facturas/Nota credito',
    OTRO: 'Facturas/Otro cliente',
    REVISAR: 'Facturas/Revisar',
    NO_COBRO: 'Facturas/No es cobro',
    MES_ANT: 'Facturas/Mes anterior',
    FE_PDF: 'Facturas/PDF de factura electronica',
  },
  // Carpetas de Drive junto a la hoja (se crean solas). Ahí se suben las facturas que no llegan
  // por correo (WhatsApp, descargas) y los comprobantes de pago (Bancolombia, Bold).
  CARPETA_FACTURAS: '📥 Facturas para registrar',
  CARPETA_PAGOS: '💸 Comprobantes de pago',
  MAX_PAGOS_POR_CORRIDA: 15,
  // ERP Dentilandia (Administración → Facturación): recibe todas las filas de los meses.
  ERP_URL: 'https://ctzyxmarmgmmgfdkdkhu.supabase.co/functions/v1/sync-facturas-compra',
  HOJAS: {
    PROV: '⚙️ Proveedores',
    RET: '⚙️ Retención',
    LOG: '🤖 Registro automático',
    SIM: '🧪 Simulación',
  },
};

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
  'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

// Bases julio 2026 (Decreto 572/2025 vigente de nuevo desde 1-jul-2026; UVT 2026 = $52.374).
const RETENCION_INICIAL = [
  ['Compras generales', 524000, 0.025, 'Automático'],
  ['Servicios generales', 105000, 0.04, 'Automático'],
  ['Servicios de salud (IPS)', 105000, 0.02, 'Automático'],
  ['Arrendamiento inmuebles', 524000, 0.035, 'Automático'],
  ['Honorarios persona jurídica', 0, 0.11, 'Automático'],
  ['Restaurante / hotel', 105000, 0.035, 'Automático'],
  ['Manual (persona natural)', '', '', 'Manual'],
  ['No aplica', '', '', 'No aplica'],
  ['Por definir', '', '', 'Por definir'],
];

// NIT, Nombre en el control, Nombre DIAN, Concepto retención, Categoría, %DCA, %DPF, %GPF, Notas, Correos remitente
const PROVEEDORES_INICIALES = [
  ['1152685817', 'Jeisy Salinas Bermudez', 'JEISY SALINAS BERMUDEZ', 'Servicios generales', 'Otros servicios', '', '', '', 'Sede varía (DCA/DPF): definir en cada fila', ''],
  ['32540403', 'Clara Villa', 'Clara Villa', 'Manual (persona natural)', 'Honorarios', 50, 50, 0, 'Historial: retención calculada a mano (3,5%–4,26%)', ''],
  ['900937939', 'Contigo sedacion', 'CONTIGO SEDACIÓN SAS', 'Servicios de salud (IPS)', 'Costos de venta', 0, 0, 100, '', ''],
  ['901258147', 'Especialistas en sedacion', 'ESPECIALISTAS EN SEDACIÓN SAS', 'Servicios de salud (IPS)', 'Costos de venta', 0, 0, 100, '', ''],
  ['800153993', 'Comcel', 'COMCEL S.A.', 'No aplica', 'Servicios', '', '', '', 'Sede varía según la línea', ''],
  ['900092385', 'Une telecomunicaciones', 'UNE EPM TELECOMUNICACIONES S.A.', 'No aplica', 'Servicios', 50, 50, 0, '', ''],
  ['900276962', 'D1', 'D1 S A S', 'No aplica', 'Diversos', '', '', '', 'Caja menor: sede varía', ''],
  ['890900608', 'Almacenes exito', 'ALMACENES ÉXITO S.A', 'No aplica', 'Diversos', 0, 100, 0, '', ''],
  ['900943243', 'Suramerica comercial', 'SURAMERICA COMERCIAL S.A.S', 'No aplica', 'Diversos', '', '', '', 'Dollarcity, caja menor: sede varía', ''],
  ['800242106', 'Sodimac colombia', 'SODIMAC COLOMBIA S.A.', 'No aplica', 'Diversos', '', '', '', 'Sede varía', ''],
  ['800180330', 'Compañia de alimentos colombianos calco', 'COMPAÑIA DE ALIMENTOS COLOMBIANOS CALCO SA', 'No aplica', 'Diversos', 0, 0, 100, '', ''],
  ['890900943', 'Colombiana de comercio', 'COLOMBIANA DE COMERCIO S.A.', 'No aplica', 'Diversos', '', '', '', '', ''],
  ['890905080', 'Camara de comercio de medellin', 'CAMARA DE COMERCIO DE MEDELLIN PARA ANTIOQUIA', 'No aplica', 'Impuestos', 50, 50, 0, '', ''],
  ['901130638', 'B2chat', 'B2CHAT SAS', 'Por definir', 'Plataformas digitales', 50, 50, 0, 'Historial sin retención: confirmar con contador', ''],
  ['900293377', 'Tm soft', 'TMSOFT S.A.S.', 'Por definir', 'Plataformas digitales', 50, 50, 0, 'Historial sin retención: confirmar con contador', ''],
  ['901216768', 'Adelante soluciones financieras', 'Adelante Soluciones Financieras SAS', 'Por definir', 'Financieros', 50, 50, 0, 'Historial sin retención: confirmar con contador', ''],
  ['800201648', 'Asesorias servicios ecologicos e industriales', 'asesorias servicios ecologicos e industriales s.a.s', 'Servicios generales', 'Otros servicios', 0, 100, 0, '', ''],
  ['901447840', 'Lucao', 'LUCAO SAS', 'Servicios generales', 'Mercadeo', 50, 50, 0, '', ''],
  ['900881454', 'Aire y servicios', 'Aire y Servicio S.A.S.', 'Servicios generales', 'Mnto', 0, 100, 0, '', ''],
  ['900892929', 'Instalaciones y remodelaciones Luis Fernando Bustamante', 'INSTALACIONES Y REMODELACIONES LUIS FERNANDO BUSTAMANTE SAS', 'Servicios generales', 'Otros servicios', 0, 0, 100, '', ''],
  ['1128448543', 'Tejada Villa Ray Steven', 'TEJADA VILLA RAY STEVEN', 'Servicios generales', 'Mnto', '', '', '', 'Sede varía', ''],
  ['901046793', 'Dentales Market', 'DENTALES MARKET S.A.S', 'Compras generales', 'Costos de venta', 50, 50, 0, '', ''],
  ['890913400', 'Dentales antioquia', 'dentales antioquia sas', 'Compras generales', 'Costos de venta', 50, 50, 0, '', ''],
  ['900819079', 'Inversiones solumed', 'INVERSIONES SOLUMED S.A.S.', 'Compras generales', 'Costos de venta', 50, 50, 0, '', ''],
  ['900367339', 'Inversiones sion', 'INVERSIONES SION 2010 S.A.S.', 'Compras generales', 'Mercadeo', 50, 50, 0, '', ''],
  ['900025279', 'Prestige Flooring', 'PRESTIGE FLOORING S.A.S.', 'Compras generales', 'Cuenta2', 0, 0, 100, '', ''],
  ['830069515', 'Orthoprofessional', 'Ortho Professional Dental Ltda.', 'Compras generales', 'Costos de venta', '', '', '', '', ''],
  ['800190461', 'Procesos y desarrollos odontologicos colombianos', 'PROCESOS Y DESARROLLOS ODONTOLOGICOS COLOMBIANOS COLDENTAL SAS', 'Compras generales', 'Costos de venta', '', '', '', '', ''],
  ['900552194', 'ABC dental', 'A B C DENTAL SAS', 'Por definir', 'Costos de venta', 0, 100, 0, 'Historial sin retención (incluso > base): confirmar', ''],
  ['890912872', 'Aldental', 'ALDENTAL S A', 'Por definir', 'Costos de venta', 50, 50, 0, 'Historial sin retención: confirmar', ''],
  ['890922294', 'Protokimica', 'PROTOKIMICA S.A.S.', 'Por definir', 'Costos de venta', 50, 50, 0, 'Historial sin retención: confirmar', ''],
  ['800031358', 'Estrategias', 'ESTRATEGIAS S.A.S.', 'Por definir', 'Costos de venta', 50, 50, 0, '', ''],
  ['901993059', 'Urbia ingenieria', 'URBIA INGENIERIA SAS', 'Por definir', 'Diversos', 0, 0, 100, 'Historial: "se asume retención"', ''],
  ['900199391', 'GHMC', 'GHMC S.A.S.', 'Por definir', 'Diversos', 100, 0, 0, '', ''],
  ['901988514', 'Ferrycolores', 'FERRYCOLORES SAS', 'Por definir', 'Diversos', 0, 0, 100, '', ''],
  ['901331844', 'Ikso SAS', 'IKSO SAS', 'Por definir', 'Diversos', 0, 0, 100, '', ''],
  ['811025918', 'Tecnología e inteligencia en griferia S.A.S', 'TECNOLOGIA E INTELIGENCIA EN GRIFERIAS SAS', 'Por definir', 'Cuenta2', 0, 0, 100, '', ''],
  ['900178348', 'Francorp', 'Francorp S.A.S.', 'Por definir', 'Gastos de personal', '', '', '', '', ''],
  ['901140415', 'La migueria', 'La Migueria SAS', 'Por definir', 'Gastos de personal', 0, 100, 0, '', ''],
  ['900897289', 'Refriaires de la montaña', 'REFRIAIRES DE LA MONTAÑA S.A.S.', 'Servicios generales', 'Mnto', 100, 0, 0, 'Rt servicios 4% ≥ $105.000 (confirmado 10-nov-2026)', ''],
  ['900259734', 'Industrias plasticas medellin', 'IND. PLASTICAS DE MEDELLIN SA', 'Por definir', 'Diversos', 100, 0, 0, '', ''],
  ['890940343', 'Distribucion y Decoracion S.A.S', 'DISTRIBUCION Y DECORACION S.A.S', 'Por definir', 'Diversos', '', '', '', '', ''],
  ['1039447695', 'Santiago Palacio Sosa', 'SANTIAGO PALACIO SOSA', 'Manual (persona natural)', 'Honorarios', 50, 50, 0, '', ''],
  ['32143837', 'Lina Maria Ruiz Blandon', 'LINA MARIA RUIZ BLANDON', 'Manual (persona natural)', 'Honorarios', 50, 50, 0, '', 'contabilidadlinaruiz@gmail.com'],
  ['79908808', 'Ramirez Montoya Carlos Humberto', 'RAMIREZ MONTOYA CARLOS HUMBERTO', 'Manual (persona natural)', 'Honorarios', '', '', '', '', ''],
  ['1040182652', 'Ruby Sulay Ramirez Lopez', 'Ruby Sulay Ramirez Lopez', 'Servicios generales', 'Costos de venta', '', '', '', 'Laboratorio dental. Rt servicios 4% ≥ $105.000 (confirmado 10-nov-2026). Definir sede', ''],
  ['71662972', 'Willian Mauricio Hurtado Cardona', 'WILLIAN MAURICIO HURTADO CARDONA', 'Servicios generales', 'Costos de venta', '', '', '', 'Ortho Kit, laboratorio dental. Rt servicios 4% ≥ $105.000 (confirmado 10-nov-2026). Definir sede', ''],
  ['901281572', 'Bold.co', 'BOLD.CO S.A.S', 'Por definir', 'Financieros', 50, 50, 0, 'Comisiones datáfono: confirmar retención con contador', ''],
  ['811007713', 'Sistecredito', 'Sistecredito S.A.S.', 'Por definir', 'Financieros', 50, 50, 0, 'Factoring: confirmar retención con contador', ''],
  ['43559486', 'Martha Cecilia Agudelo Mesa', 'MARTHA CECILIA AGUDELO MESA', 'Por definir', 'Diversos', 50, 50, 0, '', ''],
  // Cuentas / notas de cobro (identificados por correo remitente; el NIT/cédula se completa al llegar)
  ['', 'Maria Paula Caicedo', '', 'Manual (persona natural)', 'Costos de venta', '', '', '', 'Reparto por sede según producción', 'mpcgbr@gmail.com'],
  ['', 'Carolina Mesa Arango', '', 'Manual (persona natural)', 'Costos de venta', '', '', '', 'Reparto por sede según producción', 'caritom.a07@hotmail.com'],
  ['', 'Carolina Gomez Echavarria', '', 'Manual (persona natural)', 'Costos de venta', '', '', '', 'Reparto por sede según producción', 'caritoge29@hotmail.com'],
  ['', 'Valentina Toro', '', 'Manual (persona natural)', 'Costos de venta', '', '', '', 'Reparto por sede según producción', 'valentorom@gmail.com'],
  ['', 'Katherina Ramirez Palacio', '', 'Manual (persona natural)', 'Costos de venta', 100, 0, 0, 'Historial: 8%', 'kate1567@hotmail.com'],
  ['', 'Tatiana Ortiz Perez', '', 'Manual (persona natural)', 'Costos de venta', '', '', '', 'Reparto por sede según producción', 'tatianaop27@gmail.com'],
  ['', 'Andres Aguirre Salazar', '', 'Manual (persona natural)', 'Costos de venta', 0, 0, 100, 'Sedación óxido nitroso (Calmarte), una cuenta por servicio', 'calmartesedacion@gmail.com'],
  ['', 'Monica Hincapie', '', 'Por definir', 'Mnto', '', '', '', 'Equipos biomédicos: sede según la factura', 'monicahi64@gmail.com'],
  ['', 'Maria Isabel Araque', '', 'Manual (persona natural)', 'Mercadeo', 50, 50, 0, '', 'araquem44@gmail.com'],
  ['', 'Maria Gladys Uribe Yarce', '', 'Por definir', '', '', '', '', '', 'mgladysu@hotmail.com'],
  ['', 'Parque fabricato centro comercial', 'PARQUE FABRICATO CENTRO COMERCIAL PH', 'Por definir', 'Costo local', 0, 100, 0, 'Nota de cobro mensual del local', 'parauco.com'],
];

// ===================== MENÚ Y TRIGGERS =====================

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🧾 Facturas de compra')
    .addItem('1. Configuración inicial', 'configuracionInicial')
    .addItem('2. Guardar clave de la API de Claude', 'guardarClaveIA')
    .addItem('3. Simular (no escribe en los meses)', 'simular')
    .addItem('4. Procesar ahora', 'procesarAhora')
    .addItem('5. Completar proveedores desde el historial', 'completarProveedoresDesdeHistorial')
    .addItem('6. Enviar al ERP ahora', 'enviarAlERP')
    .addItem('Crear carpetas de facturas y comprobantes', 'crearCarpetasDrive')
    .addItem('Guardar clave del ERP', 'guardarClaveERP')
    .addSeparator()
    .addItem('Mostrar pestañas de configuración', 'mostrarConfiguracion')
    .addItem('Ocultar pestañas de configuración', 'ocultarConfiguracion')
    .addSeparator()
    .addItem('Activar ejecución diaria', 'activarEjecucionDiaria')
    .addItem('Desactivar ejecución diaria', 'desactivarEjecucionDiaria')
    .addToUi();
}

function configuracionInicial() {
  const ss = SpreadsheetApp.getActive();
  let h = ss.getSheetByName(CFG.HOJAS.RET);
  if (!h) {
    h = ss.insertSheet(CFG.HOJAS.RET);
    h.getRange(1, 1, 1, 4).setValues([['Concepto', 'Base mínima (valor antes de IVA)', 'Tarifa', 'Modo']]);
    h.getRange(2, 1, RETENCION_INICIAL.length, 4).setValues(RETENCION_INICIAL);
    h.getRange('B2:B').setNumberFormat('"$" #,##0');
    h.getRange('C2:C').setNumberFormat('0.0%');
    h.getRange('A1:D1').setFontWeight('bold').setBackground('#D9E2F3');
    h.setFrozenRows(1);
    h.getRange(RETENCION_INICIAL.length + 3, 1).setValue(
      'Modo: Automático = el robot pone la tarifa si el valor antes de IVA ≥ base. Manual = deja la retención en blanco para calcularla (tabla art. 383). ' +
      'No aplica = sin retención. Por definir = deja aviso para que el contador asigne el concepto en ⚙️ Proveedores.');
    h.autoResizeColumns(1, 4);
  }
  const enc = ['NIT / Cédula', 'Nombre en el control', 'Nombre DIAN', 'Concepto retención', 'Categoría (col. T)', '% DCA', '% DPF', '% GPF', 'Notas', 'Correos remitente'];
  let p = ss.getSheetByName(CFG.HOJAS.PROV);
  if (!p) {
    p = ss.insertSheet(CFG.HOJAS.PROV);
    p.getRange(1, 1, 1, enc.length).setValues([enc]).setFontWeight('bold').setBackground('#D9E2F3');
    p.getRange('A2:A').setNumberFormat('@');
    p.getRange(2, 1, PROVEEDORES_INICIALES.length, enc.length).setValues(PROVEEDORES_INICIALES);
    p.setFrozenRows(1);
  } else {
    // Actualización desde la versión anterior: agrega columna de correos y proveedores faltantes.
    p.getRange(1, 1, 1, enc.length).setValues([enc]).setFontWeight('bold').setBackground('#D9E2F3');
    const actuales = p.getDataRange().getValues().slice(1);
    const nits = {}, correos = {};
    actuales.forEach(r => { if (r[0]) nits[soloDigitos_(r[0])] = true; String(r[9] || '').split(/[,;\s]+/).forEach(c => { if (c) correos[c.toLowerCase()] = true; }); });
    const faltan = PROVEEDORES_INICIALES.filter(r => r[0] ? !nits[r[0]] : !correos[r[9].toLowerCase()]);
    if (faltan.length) p.getRange(p.getLastRow() + 1, 1, faltan.length, enc.length).setValues(faltan);
    // Proveedores que estaban "Por definir" y ya tienen concepto confirmado: se actualiza solo el concepto (col. D).
    const definidos = {};
    PROVEEDORES_INICIALES.forEach(r => { if (r[0] && r[3] !== 'Por definir') definidos[r[0]] = r[3]; });
    actuales.forEach((r, i) => {
      const nit = soloDigitos_(r[0]);
      if (definidos[nit] && String(r[3]).trim() === 'Por definir') p.getRange(i + 2, 4).setValue(definidos[nit]);
    });
  }
  const regla = SpreadsheetApp.newDataValidation()
    .requireValueInRange(ss.getSheetByName(CFG.HOJAS.RET).getRange('A2:A30'), true).build();
  p.getRange('D2:D500').setDataValidation(regla);
  p.autoResizeColumns(1, enc.length);
  hojaLog_(ss);
  SpreadsheetApp.getUi().alert('Listo. Las pestañas ⚙️ Retención, ⚙️ Proveedores y 🤖 Registro automático son la configuración ' +
    'y la memoria del robot: no las borre.\n\n' +
    'Siguiente: "5. Completar proveedores desde el historial" (una vez) y luego "3. Simular".');
}

function mostrarConfiguracion() {
  const ss = SpreadsheetApp.getActive();
  [CFG.HOJAS.PROV, CFG.HOJAS.RET, CFG.HOJAS.LOG].forEach(n => { const h = ss.getSheetByName(n); if (h) h.showSheet(); });
  const p = ss.getSheetByName(CFG.HOJAS.PROV);
  if (p) ss.setActiveSheet(p);
}

function ocultarConfiguracion() {
  const ss = SpreadsheetApp.getActive();
  const visibles = ss.getSheets().filter(s => !s.isSheetHidden());
  [CFG.HOJAS.PROV, CFG.HOJAS.RET, CFG.HOJAS.LOG].forEach(n => {
    const h = ss.getSheetByName(n);
    if (h && !h.isSheetHidden() && visibles.length > 1) { if (ss.getActiveSheet().getName() === n) ss.setActiveSheet(visibles.find(s => s.getName() !== n && s.getName().indexOf('⚙️') < 0 && s.getName().indexOf('🤖') < 0) || visibles[0]); h.hideSheet(); }
  });
}

function guardarClaveIA() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Clave de la API de Claude', 'Pegue la clave (empieza por "sk-ant-"). Se guarda en las propiedades del script, no en la hoja.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const k = r.getResponseText().trim();
  if (!/^sk-ant-/.test(k)) { ui.alert('La clave no parece válida (debe empezar por sk-ant-).'); return; }
  PropertiesService.getScriptProperties().setProperty('ANTHROPIC_API_KEY', k);
  ui.alert('Clave guardada. Las cuentas de cobro se leerán con ' + CFG.IA.MODELO + '.');
}

function activarEjecucionDiaria() {
  desactivarEjecucionDiaria();
  ScriptApp.newTrigger('procesarAutomatico').timeBased().inTimezone('America/Bogota')
    .everyDays(1).atHour(CFG.HORA_DIARIA).nearMinute(0).create();
  SpreadsheetApp.getUi().alert('Ejecución diaria activada: todos los días hacia las ' + CFG.HORA_DIARIA + ':00 a. m. (±15 min) con la cuenta ' +
    Session.getEffectiveUser().getEmail() + '. Se leerá el correo de esa cuenta y al terminar llegará un correo con el reporte a ' +
    (CFG.CORREOS_REPORTE || Session.getEffectiveUser().getEmail()) + '.');
}

function desactivarEjecucionDiaria() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'procesarAutomatico')
    .forEach(t => ScriptApp.deleteTrigger(t));
}

function simular() { avisar_(ejecutar_({ simular: true }), true); }
function procesarAhora() {
  const r = ejecutar_({ simular: false });
  r.erp = sincronizarERP_(SpreadsheetApp.getActive());
  avisar_(r, false);
}
function procesarAutomatico() {
  const r = ejecutar_({ simular: false });
  r.erp = sincronizarERP_(SpreadsheetApp.getActive());
  try { enviarReporte_(r); } catch (e) { console.error('No se pudo enviar el reporte: ' + e); }
}

/** Correo con el resumen de la corrida automática. */
function enviarReporte_(r) {
  const para = CFG.CORREOS_REPORTE || Session.getEffectiveUser().getEmail();
  const ss = SpreadsheetApp.getActive();
  const fila = d => '<tr><td>' + [d.estado, d.proveedor, d.numero, d.total ? '$' + Math.round(d.total).toLocaleString('es-CO') : '', d.pestana, d.detalle]
    .map(x => String(x || '').replace(/</g, '&lt;')).join('</td><td>') + '</td></tr>';
  const tabla = (titulo, lista) => !lista.length ? '' : '<h3>' + titulo + ' (' + lista.length + ')</h3>' +
    '<table border="1" cellpadding="4" style="border-collapse:collapse;font-size:12px"><tr><th>Resultado</th><th>Proveedor</th><th>Número</th><th>Total</th><th>Pestaña</th><th>Detalle</th></tr>' +
    lista.map(fila).join('') + '</table>';
  const d = r.detalle || [];
  const cobros = d.filter(x => x.estado === 'Registrada' && x.tipo === 'Cobro');
  const html = '<p>Resumen de la corrida automática del ' + Utilities.formatDate(new Date(), 'America/Bogota', 'dd/MM/yyyy HH:mm') + ':</p><ul>' +
    '<li>Facturas DIAN registradas: <b>' + r.ok + '</b></li><li>Cuentas de cobro registradas (generar DS): <b>' + r.cobros + '</b></li>' +
    '<li>Ya estaban: ' + r.dup + '</li><li>De un mes anterior: ' + r.mesAnt + '</li><li>Notas crédito: ' + r.nc + '</li>' +
    '<li>Pagos aplicados desde comprobantes: <b>' + r.pagos + '</b></li>' +
    '<li>Para revisar: <b>' + r.err + '</b></li></ul>' +
    (r.erp ? '<p>ERP (Administración → Facturación): ' + r.erp.mensaje + '</p>' : '') +
    (r.pendientes ? '<p>⚠ Quedaron correos pendientes: se procesan en la próxima corrida (o use 🧾 → 4. Procesar ahora).</p>' : '') +
    tabla('Cuentas de cobro: generar documento soporte (DS)', cobros) +
    tabla('Para revisar', d.filter(x => x.estado === 'Revisar')) +
    tabla('Pagos aplicados', d.filter(x => x.estado === 'Pago aplicado')) +
    tabla('Registradas', d.filter(x => x.estado === 'Registrada' && x.tipo !== 'Cobro')) +
    tabla('No registradas (ya estaban, mes anterior, notas crédito)', d.filter(x => ['Ya estaba', 'Mes anterior', 'Nota crédito'].indexOf(x.estado) >= 0)) +
    '<p><a href="' + ss.getUrl() + '">Abrir el Control de Facturación</a></p>';
  MailApp.sendEmail({ to: para, subject: '🧾 Facturas de compra: ' + (r.ok + r.cobros) + ' registradas, ' + r.err + ' para revisar', htmlBody: html });
}

function avisar_(r, sim) {
  const msg = (sim ? 'SIMULACIÓN (no se escribió en los meses ni se etiquetaron correos)\n\n' : '') +
    '✓ Facturas DIAN registradas: ' + r.ok + '\n✓ Cuentas/notas de cobro registradas: ' + r.cobros +
    '\n⊘ Ya estaban: ' + r.dup + '\n⊘ De un mes anterior (no se registran): ' + r.mesAnt + '\n↷ Notas crédito: ' + r.nc +
    '\n↷ Descartados (extractos, chats, PDF de facturas electrónicas, otro cliente): ' + r.otro +
    '\n💸 Pagos aplicados (comprobantes): ' + r.pagos +
    '\n⚠ Para revisar: ' + r.err +
    (r.sinClave ? '\n\n⚠ Cuentas de cobro NO procesadas: falta la clave de la API (menú 🧾 → 2).' : '') +
    (r.pendientes ? '\n\nQuedan correos por procesar: vuelva a ejecutar.' : '') +
    (r.erp ? '\n\nERP: ' + r.erp.mensaje : '') +
    '\n\nDetalle en la pestaña ' + (sim ? CFG.HOJAS.SIM : CFG.HOJAS.LOG) + '.';
  SpreadsheetApp.getUi().alert(msg);
}

// ===================== PROCESO PRINCIPAL =====================

function ejecutar_(opts) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Ya hay una ejecución en curso.');
  const t0 = Date.now();
  const res = { ok: 0, cobros: 0, dup: 0, mesAnt: 0, nc: 0, otro: 0, err: 0, pagos: 0, pendientes: false, sinClave: false, detalle: [] };
  try {
    const ss = SpreadsheetApp.getActive();
    if (!ss.getSheetByName(CFG.HOJAS.PROV)) throw new Error('Primero ejecute "1. Configuración inicial".');
    const ctx = {
      ss, simular: opts.simular, t0,
      tablaRet: leerTablaRetencion_(ss),
      proveedores: leerProveedores_(ss),
      registrados: leerRegistro_(ss),
      manuales: leerFilasManuales_(ss),
      pestanas: {}, labels: {}, docsIA: 0,
      sim: opts.simular ? hojaSimulacion_(ss) : null,
      clave: PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY'),
    };
    flujoFacturasZip_(ctx, res);
    if (ctx.clave) {
      flujoCobros_(ctx, res);
      flujoCarpetaFacturas_(ctx, res);
      flujoComprobantesPago_(ctx, res);
    } else res.sinClave = true;
    return res;
  } finally {
    lock.releaseLock();
  }
}

function sinTiempo_(ctx) { return Date.now() - ctx.t0 > 4.5 * 60 * 1000; }

function consultaBase_() {
  const L = CFG.LABELS;
  return Object.keys(L).map(k => '-label:' + L[k].toLowerCase().replace(/[\s/]/g, '-')).join(' ') +
    ' newer_than:' + CFG.DIAS_BUSQUEDA + 'd' + (CFG.DESDE ? ' after:' + CFG.DESDE : '');
}

function contar_(res, r) {
  const f = r.f || {};
  if (['No es cobro', 'Otro cliente', 'Factura electrónica'].indexOf(r.estado) < 0)
    res.detalle.push({ estado: r.estado, tipo: f.tipo, proveedor: f.proveedor || '', numero: f.numero || '', total: f.total || 0, pestana: r.pestana || '', detalle: r.detalle || '' });
  if (r.estado === 'Registrada') { if (r.f && r.f.tipo === 'Cobro') res.cobros++; else res.ok++; }
  else if (r.estado === 'Pago aplicado') res.pagos++;
  else if (r.estado === 'Ya estaba') res.dup++;
  else if (r.estado === 'Nota crédito') res.nc++;
  else if (r.estado === 'Mes anterior') res.mesAnt++;
  else if (r.estado === 'Otro cliente' || r.estado === 'No es cobro' || r.estado === 'Factura electrónica') res.otro++;
  else res.err++;
}

function etiquetarHilo_(ctx, hilo, estado) {
  if (ctx.simular || !estado) return;
  const L = CFG.LABELS;
  const nombre = { 'Registrada': L.OK, 'Ya estaba': L.DUP, 'Nota crédito': L.NC, 'Otro cliente': L.OTRO, 'No es cobro': L.NO_COBRO,
    'Mes anterior': L.MES_ANT, 'Factura electrónica': L.FE_PDF }[estado] || L.REVISAR;
  hilo.addLabel(label_(ctx, nombre));
}

// ---------- Flujo A: facturas electrónicas (ZIP) ----------

function flujoFacturasZip_(ctx, res) {
  const hilos = GmailApp.search('filename:zip ' + consultaBase_(), 0, CFG.MAX_ZIP_POR_CORRIDA);
  if (hilos.length === CFG.MAX_ZIP_POR_CORRIDA) res.pendientes = true;
  const vistos = {};
  for (const hilo of hilos) {
    if (sinTiempo_(ctx)) { res.pendientes = true; break; }
    let estadoHilo = null, huboZip = false;
    for (const msg of hilo.getMessages()) {
      for (const zip of msg.getAttachments().filter(a => /\.zip$/i.test(a.getName()))) {
        let r;
        huboZip = true;
        try { r = procesarZip_(ctx, msg, zip, vistos); } catch (e) { r = { estado: 'Revisar', detalle: String(e && e.message || e) }; }
        if (!r) continue;
        registrarLog_(ctx, r, msg);
        estadoHilo = peorEstado_(estadoHilo, r.estado);
        contar_(res, r);
      }
    }
    etiquetarHilo_(ctx, hilo, estadoHilo || (huboZip ? 'Ya estaba' : 'No es cobro'));
  }
}

function procesarZip_(ctx, msg, zipAtt, vistos) {
  const blobs = Utilities.unzip(zipAtt.copyBlob().setContentType('application/zip'));
  const xmls = blobs.filter(b => /\.xml$/i.test(b.getName()));
  const pdf = blobs.find(b => /\.pdf$/i.test(b.getName())) || null;
  if (!xmls.length) return { estado: 'Revisar', detalle: 'ZIP sin XML: ' + zipAtt.getName() };

  let f = null, errParse = '';
  for (const x of xmls) {
    try { f = parsearXmlFactura(x.getDataAsString('UTF-8')); if (f) break; } catch (e) { errParse = e.message; }
  }
  if (!f) return { estado: 'Revisar', detalle: 'No pude leer la factura del XML. ' + errParse };

  const clave = f.cufe || claveDoc(f);
  if (vistos[clave]) return null;
  vistos[clave] = true;

  if (f.nitCliente && f.nitCliente !== CFG.NIT_DENTILANDIA) return { f, estado: 'Otro cliente', detalle: 'Factura a nombre de NIT ' + f.nitCliente };
  if (f.tipo !== 'Invoice') return { f, estado: 'Nota crédito', detalle: f.tipo + ' ' + f.numero + (f.referencia ? ' (afecta ' + f.referencia + ')' : '') + ': registrar a mano (fase 3)' };

  const prov = ctx.proveedores.porNit[f.nit] || buscarProveedor(ctx.proveedores, f, '') || null;
  return registrarDocumento_(ctx, msg, f, prov, { color: CFG.COLOR_XML, archivos: [pdf].concat(xmls).filter(Boolean), principal: pdf || xmls[0] });
}

// ---------- Flujo B: cuentas / notas / recibos de cobro (IA) ----------

function flujoCobros_(ctx, res) {
  const hilos = GmailApp.search('has:attachment -filename:zip ' + consultaBase_(), 0, CFG.MAX_POR_CORRIDA);
  if (hilos.length === CFG.MAX_POR_CORRIDA) res.pendientes = true;
  const vistosAdj = {}, vistosDoc = {};
  for (const hilo of hilos) {
    if (sinTiempo_(ctx) || ctx.docsIA >= CFG.IA.MAX_DOCS_POR_CORRIDA) { res.pendientes = true; break; }
    let estadoHilo = null, incompleto = false;
    if (hilo.getMessages().some(m => m.getAttachments().some(a => /\.zip$/i.test(a.getName())))) continue; // factura DIAN: va por el flujo A
    for (const msg of hilo.getMessages()) {
      if (incompleto) break;
      const adj = msg.getAttachments({ includeInlineImages: false })
        .filter(a => !vistosAdj[a.getName() + '|' + a.getSize()] && (vistosAdj[a.getName() + '|' + a.getSize()] = true));
      if (!adj.length) continue;
      const cuerpo = msg.getPlainBody() || '';
      const c = clasificarCorreo(msg.getSubject(), cuerpo, adj.map(a => a.getName()));
      const noLegibles = adj.filter(a => /\.(doc|xlsx?|odt|rtf|heic)$/i.test(a.getName()) && !esAnexo(a.getName()));
      if (!c.esCandidato && c.motivo === 'solo anexos' && noLegibles.length) {
        const r = { estado: 'Revisar', detalle: 'Formato que el robot no lee (' + noLegibles.map(a => a.getName()).join(', ') + '): pedir PDF/Word .docx o digitar a mano' };
        registrarLog_(ctx, r, msg); estadoHilo = peorEstado_(estadoHilo, r.estado); contar_(res, r);
        continue;
      }
      if (!c.esCandidato) { estadoHilo = peorEstado_(estadoHilo, 'No es cobro'); continue; }
      const docs = adj.filter(a => esDocumentoLegible_(a) && !esAnexo(a.getName()));
      const anexos = adj.filter(a => esAnexo(a.getName()));
      if (!docs.length) { estadoHilo = peorEstado_(estadoHilo, 'No es cobro'); continue; }
      const remitente = remitenteOriginal(cuerpo, msg.getFrom());
      const contexto = 'Asunto: ' + msg.getSubject() + '\nRemitente original: ' + remitente +
        '\nFecha del correo: ' + isoBogota(msg.getDate()) +
        '\nCuerpo del correo (extracto):\n' + cuerpo.slice(0, 1500);
      let registradosMsg = 0;
      for (const d of docs) {
        if (ctx.docsIA >= CFG.IA.MAX_DOCS_POR_CORRIDA || sinTiempo_(ctx)) { res.pendientes = true; incompleto = true; break; }
        let r;
        try {
          ctx.docsIA++;
          const ia = leerConIA_(ctx, d, contexto);
          const f = cobroDesdeIA(ia, d.getName(), msg.getDate());
          if (f.esFacturaElectronica) { r = { f, estado: 'Factura electrónica', detalle: d.getName() + ': es el PDF de una factura electrónica; se registra desde su XML (correo con ZIP)' }; }
          else if (!f.esCobro) { anexos.push(d); r = { f, estado: 'No es cobro', detalle: d.getName() + ': ' + (ia.observaciones || 'no es documento de cobro') }; }
          else if (vistosDoc[claveDoc(f)]) { r = null; }
          else {
            vistosDoc[claveDoc(f)] = true;
            if (!f.esParaDentilandia) r = { f, estado: 'Otro cliente', detalle: 'Dirigido a: ' + f.cobraA };
            else {
              const prov = buscarProveedor(ctx.proveedores, f, remitente);
              if (prov && !f.nit && prov.nit) f.nit = prov.nit;
              r = registrarDocumento_(ctx, msg, f, prov, { color: CFG.COLOR_IA, archivos: [d], principal: d, correo: emailDe_(remitente) });
              if (r.estado === 'Registrada') registradosMsg++;
            }
          }
        } catch (e) {
          r = { estado: 'Revisar', detalle: d.getName() + ': ' + String(e && e.message || e) };
        }
        if (!r) continue;
        registrarLog_(ctx, r, msg);
        estadoHilo = peorEstado_(estadoHilo, r.estado);
        contar_(res, r);
      }
      if (registradosMsg && anexos.length && !ctx.simular) guardarAnexos_(ctx, msg, anexos);
    }
    // Hilo a medias (se acabó el tiempo o el cupo de IA): sin etiqueta, para terminarlo en la próxima corrida.
    // Hilo sin nada que procesar (p. ej. solo imágenes de firma): "No es cobro", para que no vuelva a ocupar cupo.
    if (!incompleto) etiquetarHilo_(ctx, hilo, estadoHilo || 'No es cobro');
  }
}

function esDocumentoLegible_(a) {
  return /\.(pdf|docx|png|jpe?g|webp)$/i.test(a.getName()) && a.getSize() > 15000 || /\.(pdf|docx)$/i.test(a.getName());
}

function guardarAnexos_(ctx, msg, anexos) {
  try {
    const carpeta = carpetaMes_(ctx, fechaBogota_(msg.getDate()));
    anexos.forEach(a => carpeta.createFile(a.copyBlob().setName('Anexo - ' + a.getName())));
  } catch (e) { /* no crítico */ }
}

/** Llama a la API de Claude y devuelve los campos del documento de cobro. */
function leerConIA_(ctx, adjunto, contexto, herramienta, prompt) {
  herramienta = herramienta || HERRAMIENTA_COBRO;
  prompt = prompt || PROMPT_COBRO;
  const nombre = adjunto.getName();
  let bloque;
  if (/\.pdf$/i.test(nombre)) {
    bloque = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Utilities.base64Encode(adjunto.getBytes()) } };
  } else if (/\.docx$/i.test(nombre)) {
    bloque = { type: 'text', text: 'Contenido del documento Word "' + nombre + '":\n\n' + textoDocx_(adjunto) };
  } else {
    if (adjunto.getSize() > 3.7 * 1024 * 1024) throw new Error('imagen de más de 3,7 MB: la IA no la acepta, digitar a mano');
    const mt = /\.png$/i.test(nombre) ? 'image/png' : /\.webp$/i.test(nombre) ? 'image/webp' : 'image/jpeg';
    bloque = { type: 'image', source: { type: 'base64', media_type: mt, data: Utilities.base64Encode(adjunto.getBytes()) } };
  }
  const payload = {
    model: CFG.IA.MODELO,
    max_tokens: 2048,
    tools: [herramienta],
    tool_choice: { type: 'tool', name: herramienta.name },
    messages: [{ role: 'user', content: [bloque, { type: 'text', text: prompt + '\n\nArchivo: ' + nombre + '\n' + contexto }] }],
  };
  let resp;
  for (let intento = 0; intento < 3; intento++) {
    resp = UrlFetchApp.fetch(CFG.IA.URL, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-api-key': ctx.clave, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify(payload),
    });
    const code = resp.getResponseCode();
    if (code === 200) break;
    if (code === 429 || code >= 500) { Utilities.sleep(3000 * (intento + 1)); continue; }
    throw new Error('API Claude ' + code + ': ' + resp.getContentText().slice(0, 300));
  }
  if (resp.getResponseCode() !== 200) throw new Error('API Claude no respondió (' + resp.getResponseCode() + ')');
  const j = JSON.parse(resp.getContentText());
  if (j.stop_reason === 'refusal') throw new Error('La IA se negó a leer el documento: digitar a mano');
  const tu = (j.content || []).find(c => c.type === 'tool_use');
  if (!tu) throw new Error('La IA no devolvió datos estructurados (' + (j.stop_reason || '?') + ')');
  return tu.input;
}

function textoDocx_(blob) {
  const partes = Utilities.unzip(blob.copyBlob().setContentType('application/zip'));
  const doc = partes.find(p => p.getName() === 'word/document.xml');
  if (!doc) throw new Error('Word sin contenido legible');
  return docxXmlATexto(doc.getDataAsString('UTF-8'));
}

const PROMPT_COBRO = [
  'Eres auxiliar contable de DENTILANDIA S.A.S. (NIT 901.117.356-9), clínica odontológica pediátrica en Medellín/Bello',
  'con dos sedes: "Las Américas" (DCA, Torre Médica Las Américas, Medellín) y "Fabricato" (DPF, Parque Fabricato, Bello).',
  'Te paso un adjunto que llegó al correo de facturación. Usa la herramienta registrar_cobro para extraer sus datos.',
  'Reglas:',
  '- Es documento de cobro si es una cuenta de cobro, nota de cobro, recibo de cobro, documento equivalente o factura NO electrónica que cobra a Dentilandia.',
  '- NO son documentos de cobro: planillas o comprobantes de seguridad social, formatos de retención en la fuente, RUT, certificados, extractos bancarios, chats o capturas de soporte, cotizaciones.',
  '- Si es una FACTURA ELECTRÓNICA validada por la DIAN (tiene CUFE o código QR de la DIAN), marca es_factura_electronica = true y llena igual los demás datos.',
  '- valor_total es el valor BRUTO cobrado. Si el documento ya descuenta una retención u otro valor, reporta el bruto y explica el descuento en observaciones.',
  '- Si el valor está dividido por sede, llena valores_por_sede. Si no se menciona la sede, déjalo vacío. Si dice "Bello" o "Fabricato" es DPF; "Américas" es DCA.',
  '- Fechas en formato AAAA-MM-DD. Si el documento solo dice el mes (ej. "octubre 2026"), usa el último día de ese mes.',
  '- No inventes datos: si algo no aparece, deja el texto vacío o el número en 0, y anota la duda en observaciones.',
].join('\n');

const HERRAMIENTA_COBRO = {
  name: 'registrar_cobro',
  description: 'Registra los datos de un documento de cobro dirigido a Dentilandia.',
  input_schema: {
    type: 'object',
    properties: {
      es_documento_de_cobro: { type: 'boolean' },
      es_factura_electronica: { type: 'boolean', description: 'true si es factura electrónica DIAN (tiene CUFE o QR de la DIAN)' },
      tipo_documento: { type: 'string', enum: ['cuenta de cobro', 'nota de cobro', 'recibo de cobro', 'factura no electronica', 'documento equivalente', 'otro'] },
      cobra_a: { type: 'string', description: 'A quién va dirigido el cobro (nombre y NIT si aparece)' },
      proveedor_nombre: { type: 'string', description: 'Quién cobra (persona o empresa)' },
      proveedor_identificacion: { type: 'string', description: 'NIT o cédula de quien cobra, solo dígitos sin dígito de verificación' },
      numero_documento: { type: 'string', description: 'Número o consecutivo del documento, tal como aparece; vacío si no tiene' },
      fecha_documento: { type: 'string', description: 'AAAA-MM-DD' },
      fecha_vencimiento: { type: 'string', description: 'AAAA-MM-DD o vacío' },
      valor_antes_iva: { type: 'number' },
      iva: { type: 'number' },
      valor_total: { type: 'number' },
      concepto: { type: 'string', description: 'Concepto breve (máx. 100 caracteres)' },
      valores_por_sede: {
        type: 'array',
        items: { type: 'object', properties: { sede: { type: 'string', enum: ['DCA', 'DPF', 'Otra'] }, valor: { type: 'number' } }, required: ['sede', 'valor'] },
      },
      observaciones: { type: 'string', description: 'Dudas, descuentos aplicados, datos ilegibles' },
    },
    required: ['es_documento_de_cobro', 'es_factura_electronica', 'tipo_documento', 'cobra_a', 'proveedor_nombre', 'numero_documento', 'fecha_documento', 'valor_total'],
  },
};

// ---------- Registro común (facturas y cobros) ----------

function registrarDocumento_(ctx, msg, f, prov, op) {
  const dup = buscarDuplicado(f, ctx.registrados, ctx.manuales, ctx.proveedores.porNit, prov);
  if (dup) return { f, estado: dup.charAt(0) === '⚠' ? 'Revisar' : 'Ya estaba', detalle: dup };

  const fechaMes = CFG.MES_SEGUN === 'EMISION' ? (fechaLocal_(f.fecha) || fechaBogota_(msg.getDate())) : fechaBogota_(msg.getDate());
  const nombrePestana = MESES[fechaMes.getMonth()] + ' ' + fechaMes.getFullYear();
  const mesAnt = esDeMesAnterior(f.fecha, fechaMes);
  if (mesAnt) return { f, estado: 'Mes anterior', detalle: 'Documento de ' + mesAnt + ', llegó en ' + nombrePestana + ': solo se registra el mes corriente (si corresponde, digitarlo a mano)' };

  const ret = calcularRetencion(prov, f, ctx.tablaRet);
  const notas = construirNotas(f, prov, ret);

  if (ctx.simular) {
    // Misma fila que iría al mes (columnas A–U idénticas), en la pestaña 🧪 Simulación.
    const filaSim = escribirFila_(ctx, ctx.sim, f, prov, ret, notas, '', f.tipo === 'Cobro' ? CFG.COLOR_IA : CFG.COLOR_XML);
    ctx.sim.getRange(filaSim, 22, 1, 4).setValues([[nombrePestana, f.tipo === 'Cobro' ? f.tipoDoc : 'Factura DIAN', f.nit || '', msg.getSubject()]]);
    recordar_(ctx, f, prov, nombrePestana, filaSim);
    return { f, estado: 'Registrada', pestana: nombrePestana + ' (simulado)', fila: filaSim, detalle: notas.join(' · ') };
  }

  let link = '';
  try {
    const carpeta = carpetaMes_(ctx, fechaMes);
    const base = ((f.numero || 'SN') + ' - ' + nombreControl(f, prov)).replace(/[\\/:*?"<>|]/g, '-');
    op.archivos.forEach((b, i) => {
      const ext = (b.getName().match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
      const archivo = carpeta.createFile(b.copyBlob().setName(base + (op.archivos.length > 1 && b !== op.principal ? '.' + i : '') + ext));
      if (b === op.principal) link = archivo.getUrl();
    });
  } catch (e) {
    notas.push('⚠ no se pudo guardar el soporte en Drive: ' + e.message);
  }

  if (!prov) prov = agregarProveedorNuevo_(ctx, f, op.correo);
  else if (!prov.nit && f.nit) completarNit_(ctx, prov, f.nit);
  const fila = escribirFila_(ctx, pestanaMes_(ctx, nombrePestana), f, prov, ret, notas, link, op.color);
  recordar_(ctx, f, prov, nombrePestana, fila);
  return { f, estado: 'Registrada', pestana: nombrePestana, fila, link, detalle: notas.join(' · ') };
}

/** Memoria de la corrida: evita registrar dos veces el mismo documento (p. ej. ZIP + PDF del mismo proveedor). */
function recordar_(ctx, f, prov, pestana, fila) {
  ctx.registrados.claves[claveDoc(f)] = true;
  if (f.cufe) ctx.registrados.cufes[f.cufe] = true;
  ctx.manuales.push({ num: normNum(f.numero), toks: tokens(nombreControl(f, prov) + ' ' + f.proveedor), valor: f.subtotal, total: f.total, fecha: f.fecha, pestana, fila });
}

// ===================== ESCRITURA EN LA PESTAÑA DEL MES =====================

function escribirFila_(ctx, sh, f, prov, ret, notas, link, color) {
  const r = siguienteFila_(sh);
  if (r > 3) {
    // Mismo formato y lista desplegable de "Método" que la fila 3 (por si la fila no venía preparada).
    const modelo = sh.getRange(3, 1, 1, 21), destino = sh.getRange(r, 1, 1, 21);
    modelo.copyTo(destino, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    modelo.copyTo(destino, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
  }
  const rep = CFG.ESCRIBIR_REPARTICION ? repartoFinal(f, prov) : null;
  const celdaRep = v => !rep ? '' : v === 0 ? 0 : v === 100 ? '=+I' + r : '=+I' + r + '*' + v + '%';
  if (!rep) notas.push('definir repartición DCA/DPF/GPF');
  const marca = (f.tipo === 'Cobro' ? '🤖 IA (' + f.tipoDoc + ': generar DS, verificar valor) ' :
    f.tipo === 'FEPDF' ? '🤖 PDF (factura electrónica leída con IA: verificar valor) ' : '🤖 ') +
    Utilities.formatDate(new Date(), 'America/Bogota', 'dd/MM');

  const valores = [[
    nombreControl(f, prov),                 // B Proveedor
    String(f.numero || '-'),                // C Número Dcto
    f.tipo === 'Cobro' ? 'Pendiente' : '-', // D DS (las cuentas de cobro requieren documento soporte)
    fechaLocal_(f.fecha),                   // E Fecha
    fechaLocal_(f.vencimiento),             // F Vencimiento
    f.subtotal,                             // G Valor antes de IVA
    f.iva || 0,                             // H IVA
    '=+G' + r + '+H' + r,                   // I Valor total
    ret.tarifa !== null ? ret.tarifa : (ret.pendiente ? '' : 0), // J Rt(%): en blanco solo si falta definirla
    '=+G' + r + '*J' + r,                   // K Rt($)
    0, 0,                                   // L ICA, M NC
    '=+I' + r + '-K' + r + '-L' + r + '-M' + r, // N Valor a pagar
    '', '',                                 // O Pagado, P Método (fases siguientes)
    celdaRep(rep && rep[0]), celdaRep(rep && rep[1]), celdaRep(rep && rep[2]), // Q R S
    (prov && CFG.ESCRIBIR_REPARTICION) ? (prov.categoria || '') : '',        // T
    marca + (notas.length ? ' · ' + notas.join(' · ') : ''),                 // U
  ]];
  sh.getRange(r, 2, 1, 20).setValues(valores);
  const num = SpreadsheetApp.newRichTextValue().setText(String(f.numero || '-'));
  sh.getRange(r, 3).setRichTextValue(link ? num.setLinkUrl(link).build() : num.build());
  sh.getRange(r, 5, 1, 2).setNumberFormat('d/m/yyyy');
  sh.getRange(r, 7, 1, 3).setNumberFormat('"$" #,##0');
  sh.getRange(r, 11, 1, 4).setNumberFormat('"$" #,##0');
  sh.getRange(r, 10).setNumberFormat('0.0%');
  sh.getRange(r, 2, 1, 20).setBackground(color || null);
  sh.getRange(r, 1).setBackground(null);
  const a = sh.getRange(r, 1);
  if (a.getValue() === '' || a.getValue() === null) a.setValue(maxConsecutivo_(sh, r) + 1);
  return r;
}

function siguienteFila_(sh) {
  const n = Math.max(sh.getLastRow(), 3);
  const B = sh.getRange(3, 2, n - 2, 1).getValues();
  const Q = sh.getRange(3, 17, n - 2, 1).getFormulas();
  for (let i = 0; i < B.length; i++) {
    if (/SUM\(/i.test(Q[i][0])) { sh.insertRowBefore(i + 3); return i + 3; }
    if (String(B[i][0]).trim() === '') return i + 3;
  }
  return n + 1;
}

function maxConsecutivo_(sh, hasta) {
  if (hasta <= 3) return 0;
  return sh.getRange(3, 1, hasta - 3, 1).getValues().reduce((m, x) => (typeof x[0] === 'number' && x[0] > m ? x[0] : m), 0);
}

function pestanaMes_(ctx, nombre) {
  if (ctx.pestanas[nombre]) return ctx.pestanas[nombre];
  const ss = ctx.ss;
  let sh = ss.getSheetByName(nombre);
  if (!sh) {
    const c = copiarPlantillaMes_(ss, nombre);
    sh = c.sh;
    const titulo = String(sh.getRange('C1').getValue());
    const viejo = new RegExp(c.plantilla.getName().split(' ')[0], 'i');
    sh.getRange('C1').setValue(titulo.replace(viejo, nombre.split(' ')[0].toUpperCase()).replace(/\b20\d\d\b/, nombre.split(' ')[1]));
  }
  ctx.pestanas[nombre] = sh;
  return sh;
}

/** Copia la última pestaña de mes (formatos, anchos, lista de métodos de pago) y la deja vacía desde la fila 3. */
function copiarPlantillaMes_(ss, nombre) {
  const meses = ss.getSheets().map(s => ({ s, k: claveMes_(s.getName()) })).filter(x => x.k).sort((a, b) => a.k - b.k);
  if (!meses.length) throw new Error('No encontré ninguna pestaña de mes para usar como plantilla.');
  const plantilla = meses[meses.length - 1].s;
  const sh = plantilla.copyTo(ss).setName(nombre);
  try { ss.setActiveSheet(sh); ss.moveActiveSheet(plantilla.getIndex() + 1); } catch (e) { /* posición no crítica */ }
  // Vacía las filas de datos pero conserva la fila de totales (la que tiene SUM en Q) y lo que haya debajo.
  const n = Math.max(sh.getLastRow() - 2, 1);
  const q = sh.getRange(3, 17, n, 1).getFormulas();
  let fin = q.findIndex(x => /SUM\(/i.test(x[0]));
  fin = fin < 0 ? sh.getMaxRows() - 2 : fin;
  if (fin > 0) sh.getRange(3, 1, fin, 21).clearContent().setBackground(null);
  return { sh, plantilla };
}

function claveMes_(nombre) {
  const m = String(nombre).match(/^(\S+)\s+(20\d\d)$/);
  if (!m) return null;
  const i = MESES.indexOf(m[1]);
  return i < 0 ? null : Number(m[2]) * 100 + i + 1;
}

// ===================== CARPETAS DE DRIVE: FACTURAS Y COMPROBANTES =====================

/** Carpeta junto a la hoja (o en el Drive de quien ejecuta, si no ve la carpeta de la hoja). */
function carpetaHermana_(ctx, nombre) {
  ctx.hermanas = ctx.hermanas || {};
  if (ctx.hermanas[nombre]) return ctx.hermanas[nombre];
  const padres = DriveApp.getFileById(ctx.ss.getId()).getParents();
  const padre = padres.hasNext() ? padres.next() : DriveApp.getRootFolder();
  const it = padre.getFoldersByName(nombre);
  return (ctx.hermanas[nombre] = it.hasNext() ? it.next() : padre.createFolder(nombre));
}
function subcarpeta_(carpeta, nombre) {
  const it = carpeta.getFoldersByName(nombre);
  return it.hasNext() ? it.next() : carpeta.createFolder(nombre);
}
/** Deja el archivo en Procesados (o Revisar) con el resultado al comienzo del nombre. */
function archivar_(ctx, carpeta, file, estado) {
  if (ctx.simular) return;
  const destino = subcarpeta_(carpeta, estado === 'Revisar' ? 'Revisar' : 'Procesados');
  file.setName('[' + estado + '] ' + file.getName().replace(/^\[[^\]]*\]\s*/, ''));
  file.moveTo(destino);
}
/** Un archivo de Drive con la misma forma que un adjunto de Gmail (lo que usan leerConIA_ y textoDocx_). */
function adjuntoDeArchivo_(file) {
  const blob = file.getBlob();
  return { getName: () => file.getName(), getBytes: () => blob.getBytes(), getSize: () => file.getSize(), copyBlob: () => blob.copyBlob() };
}
/** Un archivo de Drive con la forma de un mensaje de Gmail (lo que usan registrarDocumento_ y registrarLog_). */
function mensajeDeArchivo_(file) {
  return { getDate: () => file.getDateCreated(), getSubject: () => '📥 Drive: ' + file.getName(), getThread: () => ({ getId: () => '' }), url: file.getUrl() };
}
function archivosSueltos_(carpeta) {
  const out = [], it = carpeta.getFiles();
  while (it.hasNext()) out.push(it.next());
  return out.sort((a, b) => a.getDateCreated() - b.getDateCreated());
}

function crearCarpetasDrive() {
  const ctx = { ss: SpreadsheetApp.getActive() };
  const f = carpetaHermana_(ctx, CFG.CARPETA_FACTURAS), p = carpetaHermana_(ctx, CFG.CARPETA_PAGOS);
  SpreadsheetApp.getUi().alert('Carpetas listas (junto a esta hoja en Drive):\n\n' + f.getName() + '\n' + f.getUrl() + '\n\n' + p.getName() + '\n' + p.getUrl() +
    '\n\nCompártalas con quien vaya a subir archivos. El robot las revisa en cada corrida.');
}

/** Flujo C: facturas y cuentas de cobro subidas a mano a "📥 Facturas para registrar". */
function flujoCarpetaFacturas_(ctx, res) {
  const carpeta = carpetaHermana_(ctx, CFG.CARPETA_FACTURAS);
  for (const file of archivosSueltos_(carpeta)) {
    if (sinTiempo_(ctx) || ctx.docsIA >= CFG.IA.MAX_DOCS_POR_CORRIDA) { res.pendientes = true; return; }
    const msg = mensajeDeArchivo_(file);
    let r;
    try {
      if (/\.zip$/i.test(file.getName())) {
        r = procesarZip_(ctx, msg, adjuntoDeArchivo_(file), {}) || { estado: 'Ya estaba', detalle: 'ZIP repetido' };
      } else if (/\.(pdf|docx|png|jpe?g|webp)$/i.test(file.getName())) {
        ctx.docsIA++;
        const ia = leerConIA_(ctx, adjuntoDeArchivo_(file), 'Origen: subido a Drive (WhatsApp o descarga).\nNombre del archivo: ' + file.getName());
        const f = cobroDesdeIA(ia, file.getName(), file.getDateCreated());
        if (f.esFacturaElectronica) { f.tipo = 'FEPDF'; f.tipoDoc = 'factura electrónica (PDF)'; }
        if (!f.esCobro && !f.esFacturaElectronica) r = { f, estado: 'No es cobro', detalle: file.getName() + ': ' + (ia.observaciones || 'no es documento de cobro') };
        else if (!f.esParaDentilandia) r = { f, estado: 'Otro cliente', detalle: 'Dirigido a: ' + f.cobraA };
        else {
          const prov = buscarProveedor(ctx.proveedores, f, '');
          if (prov && !f.nit && prov.nit) f.nit = prov.nit;
          const blob = file.getBlob();
          r = registrarDocumento_(ctx, msg, f, prov, { color: f.tipo === 'Cobro' ? CFG.COLOR_IA : CFG.COLOR_XML, archivos: [blob], principal: blob });
        }
      } else {
        r = { estado: 'Revisar', detalle: file.getName() + ': formato que el robot no lee (use PDF, ZIP, Word .docx o foto)' };
      }
    } catch (e) {
      r = { estado: 'Revisar', detalle: file.getName() + ': ' + String(e && e.message || e) };
    }
    r.detalle = '📥 ' + (r.detalle || file.getName());
    registrarLog_(ctx, r, msg);
    contar_(res, r);
    archivar_(ctx, carpeta, file, r.estado);
  }
}

const PROMPT_PAGO = [
  'Eres auxiliar contable de DENTILANDIA S.A.S. Te paso un comprobante de un pago que hizo Dentilandia a un proveedor',
  '(captura o PDF de Bancolombia, Bold, Nequi u otra plataforma). Usa la herramienta registrar_pago para extraer sus datos.',
  '- valor es el valor transferido, en pesos, sin decimales de formato.',
  '- beneficiario es quien RECIBE el pago (destino), no Dentilandia.',
  '- Si no es un comprobante de pago (por ejemplo una factura), marca es_comprobante_de_pago = false.',
  '- No inventes datos: deja vacío lo que no aparezca.',
].join('\n');

const HERRAMIENTA_PAGO = {
  name: 'registrar_pago',
  description: 'Registra los datos de un comprobante de pago hecho por Dentilandia.',
  input_schema: {
    type: 'object',
    properties: {
      es_comprobante_de_pago: { type: 'boolean' },
      plataforma: { type: 'string', enum: ['Bancolombia', 'Bold', 'Nequi', 'Daviplata', 'Otra'] },
      fecha: { type: 'string', description: 'AAAA-MM-DD' },
      valor: { type: 'number' },
      beneficiario_nombre: { type: 'string' },
      beneficiario_documento: { type: 'string', description: 'NIT o cédula, solo dígitos, si aparece' },
      cuenta_destino: { type: 'string' },
      referencia: { type: 'string', description: 'Número de comprobante o referencia de la transacción' },
      descripcion: { type: 'string', description: 'Descripción o concepto escrito en el pago, si lo hay' },
    },
    required: ['es_comprobante_de_pago', 'plataforma', 'fecha', 'valor', 'beneficiario_nombre'],
  },
};

/** Facturas sin marcar como pagadas, de todas las pestañas de mes. */
function facturasPendientesDePago_(ss) {
  const out = [];
  ss.getSheets().forEach(s => {
    if (!claveMes_(s.getName()) || s.getLastRow() < 3) return;
    s.getRange(3, 1, s.getLastRow() - 2, 16).getValues().forEach((r, i) => {
      const proveedor = String(r[1] || '').trim();
      if (!proveedor || String(r[14] || '').trim()) return;
      const valor = Number(r[13]) || 0;
      if (valor <= 0) return;
      out.push({ hoja: s, pestana: s.getName(), fila: i + 3, proveedor, numero: String(r[2] || ''), valor,
        fecha: Object.prototype.toString.call(r[4]) === '[object Date]' ? isoBogota(new Date(r[4].getTime() + 12 * 3600 * 1000)) : '' });
    });
  });
  return out;
}

/** Flujo D: comprobantes de pago en "💸 Comprobantes de pago" → marca Pagado y Método en las facturas. */
function flujoComprobantesPago_(ctx, res) {
  const carpeta = carpetaHermana_(ctx, CFG.CARPETA_PAGOS);
  const archivos = archivosSueltos_(carpeta);
  if (!archivos.length) return;
  const pendientes = facturasPendientesDePago_(ctx.ss);
  let n = 0;
  for (const file of archivos) {
    if (sinTiempo_(ctx) || n >= CFG.MAX_PAGOS_POR_CORRIDA) { res.pendientes = true; return; }
    n++;
    const msg = mensajeDeArchivo_(file);
    let r;
    try {
      if (!/\.(pdf|png|jpe?g|webp)$/i.test(file.getName())) throw new Error('formato que el robot no lee (use foto o PDF)');
      const ia = leerConIA_(ctx, adjuntoDeArchivo_(file), 'Nombre del archivo: ' + file.getName(), HERRAMIENTA_PAGO, PROMPT_PAGO);
      if (!ia.es_comprobante_de_pago) throw new Error('no parece un comprobante de pago');
      const pista = pistaDeNombrePago(file.getName());
      const prov = buscarProveedor(ctx.proveedores, { nit: soloDigitos_(ia.beneficiario_documento), proveedor: pista.proveedor || ia.beneficiario_nombre || '' }, '');
      const pago = { valor: Number(ia.valor) || 0, fecha: ia.fecha || '', nombres: [pista.proveedor, ia.beneficiario_nombre, prov && prov.nombre].filter(Boolean) };
      const m = emparejarPago(pago, pendientes, pista.numeros);
      const resumen = (ia.plataforma || 'Pago') + ' ' + (pago.fecha ? pago.fecha.slice(8, 10) + '/' + pago.fecha.slice(5, 7) : '') + ' $' + Math.round(pago.valor).toLocaleString('es-CO') +
        (ia.referencia ? ' ref ' + ia.referencia : '');
      const f = { proveedor: (prov && prov.nombre) || ia.beneficiario_nombre || pista.proveedor || '', numero: m.filas ? m.filas.map(x => x.numero).join(', ') : pista.numeros.join(', '), total: pago.valor, fecha: pago.fecha };
      if (m.error) {
        r = { f, estado: 'Revisar', detalle: '💸 ' + resumen + ': ' + m.error };
      } else {
        if (!ctx.simular) {
          const metodo = 'Transferencia';
          m.filas.forEach(x => {
            const o = SpreadsheetApp.newRichTextValue().setText('x').setLinkUrl(file.getUrl()).build();
            x.hoja.getRange(x.fila, 15).setRichTextValue(o);
            x.hoja.getRange(x.fila, 16).setValue(metodo);
            const u = x.hoja.getRange(x.fila, 21);
            u.setValue(String(u.getValue() || '') + ' · 💸 Pagado: ' + resumen);
          });
        }
        m.filas.forEach(x => { const i = pendientes.indexOf(x); if (i >= 0) pendientes.splice(i, 1); });
        r = { f, estado: 'Pago aplicado', iria: 'Marcaría Pagado', pestana: m.filas.map(x => x.pestana + ' fila ' + x.fila).join(', '),
          detalle: '💸 ' + resumen + ' → ' + m.filas.length + ' factura(s): ' + m.filas.map(x => x.numero + ' (' + x.pestana + ')').join(', ') + (m.motivo ? ' · ' + m.motivo : '') };
      }
    } catch (e) {
      r = { estado: 'Revisar', detalle: '💸 ' + file.getName() + ': ' + String(e && e.message || e) };
    }
    registrarLog_(ctx, r, msg);
    contar_(res, r);
    archivar_(ctx, carpeta, file, r.estado === 'Pago aplicado' ? 'Aplicado' : 'Revisar');
  }
}

/**
 * Lo que dice el nombre del comprobante: "Proveedor - facturas - lo que sea".
 * Ej.: "Ruby Ramirez - 8369 8370 8373.jpg" → proveedor "Ruby Ramirez", números ["8369","8370","8373"].
 */
function pistaDeNombrePago(nombre) {
  const base = String(nombre || '').replace(/\.[a-z0-9]+$/i, '').replace(/^\[[^\]]*\]\s*/, '');
  const partes = base.split(/\s+-\s+/);
  if (partes.length < 2) return { proveedor: '', numeros: [] };
  const numeros = (partes[1].match(/[A-Za-z]*\d{2,}[\w-]*/g) || []).map(x => normNum(x));
  return { proveedor: partes[0].trim(), numeros };
}

/**
 * Empareja un pago con facturas pendientes. Devuelve { filas, motivo } o { error }.
 * 1) Si el nombre del archivo trae números de factura, usa esos.
 * 2) Si no: una sola factura del proveedor por ese valor, todas sus pendientes, o las más antiguas que sumen el valor.
 */
function emparejarPago(pago, pendientes, numeros) {
  const cerca = (a, b) => Math.abs(a - b) <= Math.max(100, Math.abs(b) * 0.002);
  const fmt = v => '$' + Math.round(v).toLocaleString('es-CO');
  const toksPago = pago.nombres.map(nm => Array.from(new Set(tokens(nm).filter(t => t.length >= 3))));
  const esDelProveedor = x => {
    const t = tokens(x.proveedor).filter(y => y.length >= 3);
    return toksPago.some(tp => { const c = tp.filter(y => t.indexOf(y) >= 0).length; return tp.length && c >= Math.min(2, tp.length, t.length || 1); });
  };
  const suma = fs => fs.reduce((a, x) => a + x.valor, 0);
  if (numeros && numeros.length) {
    const filas = [];
    for (const num of numeros) {
      const c = pendientes.filter(x => numIgual(normNum(x.numero), num) && (!toksPago.some(t => t.length) || esDelProveedor(x)));
      if (c.length !== 1) return { error: c.length ? 'la factura ' + num + ' aparece ' + c.length + ' veces sin pagar' : 'no encontré la factura ' + num + ' sin pagar' + (toksPago.some(t => t.length) ? ' de ese proveedor' : '') };
      filas.push(c[0]);
    }
    if (pago.valor > 0 && !cerca(suma(filas), pago.valor)) return { error: 'las facturas del nombre suman ' + fmt(suma(filas)) + ' y el pago es de ' + fmt(pago.valor) };
    return { filas, motivo: 'facturas indicadas en el nombre del archivo' };
  }
  if (!toksPago.some(t => t.length)) return { error: 'no se pudo identificar el proveedor: ponga el nombre del proveedor y las facturas en el nombre del archivo' };
  const delProv = pendientes.filter(esDelProveedor).sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
  if (!delProv.length) return { error: 'no hay facturas sin pagar de ' + pago.nombres[0] };
  if (!(pago.valor > 0)) return { error: 'no se pudo leer el valor del pago' };
  const exactas = delProv.filter(x => cerca(x.valor, pago.valor));
  if (exactas.length === 1) return { filas: exactas, motivo: 'única factura por ese valor' };
  if (exactas.length > 1) return { error: exactas.length + ' facturas por ' + fmt(pago.valor) + ' (' + exactas.map(x => x.numero).join(', ') + '): indique cuál en el nombre del archivo' };
  if (cerca(suma(delProv), pago.valor)) return { filas: delProv, motivo: 'todas las pendientes del proveedor' };
  let acum = 0;
  for (let i = 0; i < delProv.length; i++) {
    acum += delProv[i].valor;
    if (cerca(acum, pago.valor)) return { filas: delProv.slice(0, i + 1), motivo: 'las ' + (i + 1) + ' más antiguas del proveedor' };
    if (acum > pago.valor) break;
  }
  return { error: 'el valor ' + fmt(pago.valor) + ' no cuadra con las ' + delProv.length + ' facturas pendientes de ' + delProv[0].proveedor + ' (suman ' + fmt(suma(delProv)) + '): indique las facturas en el nombre del archivo' };
}

// ===================== ENVÍO AL ERP =====================

function guardarClaveERP() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Clave del ERP', 'Cópiela en el ERP: Administración → Facturación → "Conexión con la hoja". Se guarda en las propiedades del script, no en la hoja.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const k = r.getResponseText().trim();
  if (!/^[a-f0-9]{40,}$/i.test(k)) { ui.alert('La clave no parece válida: debe ser la que muestra el ERP (solo letras a–f y números).'); return; }
  PropertiesService.getScriptProperties().setProperty('ERP_SYNC_KEY', k);
  const res = sincronizarERP_(SpreadsheetApp.getActive());
  ui.alert('Clave guardada.\n\n' + res.mensaje);
}

function enviarAlERP() {
  SpreadsheetApp.getUi().alert(sincronizarERP_(SpreadsheetApp.getActive()).mensaje);
}

/** Envía todas las filas de todas las pestañas de mes al ERP (reemplaza lo que había). */
function sincronizarERP_(ss) {
  const clave = PropertiesService.getScriptProperties().getProperty('ERP_SYNC_KEY');
  if (!clave) return { ok: false, mensaje: 'no enviado: falta la clave del ERP (menú 🧾 → Guardar clave del ERP).' };
  try {
    const pestanas = [], filas = [];
    ss.getSheets().forEach(s => {
      const k = claveMes_(s.getName());
      if (!k) return;
      pestanas.push(s.getName());
      if (s.getLastRow() < 3) return;
      s.getRange(3, 1, s.getLastRow() - 2, 21).getValues().forEach((r, i) => {
        const f = filaParaERP(r, s.getName(), k, i + 3);
        if (f) filas.push(f);
      });
    });
    const resp = UrlFetchApp.fetch(CFG.ERP_URL, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-sync-key': clave },
      payload: JSON.stringify({ pestanas, filas }),
    });
    const j = JSON.parse(resp.getContentText() || '{}');
    if (resp.getResponseCode() !== 200) return { ok: false, mensaje: 'no enviado: ' + (j.error || ('error ' + resp.getResponseCode())) };
    return { ok: true, mensaje: '✓ ' + j.filas + ' filas de ' + pestanas.length + ' meses actualizadas.' };
  } catch (e) {
    return { ok: false, mensaje: 'no enviado: ' + (e && e.message || e) };
  }
}

/** Convierte una fila A–U de una pestaña de mes en el registro que guarda el ERP. */
function filaParaERP(r, pestana, claveMes, fila) {
  const proveedor = String(r[1] || '').replace(/\s+/g, ' ').trim();
  if (!proveedor || /^(total|subtotal)\b/i.test(proveedor)) return null;
  const num = v => {
    if (typeof v === 'number') return v;
    const t = String(v || '').replace(/[^\d,.-]/g, '');
    if (!t) return 0;
    return Number(t.replace(/\./g, '').replace(',', '.')) || 0;
  };
  const fecha = v => {
    if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) return isoBogota(new Date(v.getTime() + 12 * 3600 * 1000));
    const m = String(v || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    return m ? m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2) : '';
  };
  let rt = r[9] === '' || r[9] === null ? null : num(r[9]);
  if (rt !== null && rt > 1) rt = rt / 100;
  const obs = String(r[20] || '');
  const texto = v => { const t = String(v === null || v === undefined ? '' : v).trim(); return t === '-' ? '' : t; };
  const pagado = String(r[14] || '').trim();
  return {
    pestana, fila,
    mes: Math.floor(claveMes / 100) + '-' + ('0' + (claveMes % 100)).slice(-2) + '-01',
    proveedor, numero: texto(r[2]), ds: texto(r[3]),
    fecha: fecha(r[4]), vencimiento: fecha(r[5]),
    valor_antes_iva: num(r[6]), iva: num(r[7]), total: num(r[8]) || num(r[6]) + num(r[7]),
    rt_pct: rt, rt_valor: num(r[10]), ica: num(r[11]), nc: num(r[12]), valor_pagar: num(r[13]),
    pagado: !!pagado && !/^no$/i.test(pagado), metodo_pago: texto(r[15]),
    dca: num(r[16]), dpf: num(r[17]), gpf: num(r[18]),
    categoria: texto(r[19]), observaciones: obs.slice(0, 500),
    origen: /^🤖 IA/.test(obs) ? 'robot_cobro' : /^🤖/.test(obs) ? 'robot_dian' : 'manual',
  };
}

// ===================== APRENDER DEL HISTORIAL =====================

/**
 * Lee todas las pestañas de mes y completa ⚙️ Proveedores con lo que se ha hecho a mano:
 * retención usada, categoría (col. T) y repartición DCA/DPF/GPF.
 * No borra ni cambia lo que ya está escrito: solo agrega proveedores y llena celdas vacías
 * (y el concepto, si estaba "Por definir" y el historial muestra una retención clara).
 */
function completarProveedoresDesdeHistorial() {
  const ss = SpreadsheetApp.getActive();
  const p = ss.getSheetByName(CFG.HOJAS.PROV);
  if (!p) throw new Error('Primero ejecute "1. Configuración inicial".');
  const filas = [];
  ss.getSheets().forEach(s => {
    if (!claveMes_(s.getName()) || s.getLastRow() < 3) return;
    s.getRange(3, 1, s.getLastRow() - 2, 21).getValues().forEach(r => {
      filas.push({ nombre: r[1], g: r[6], i: r[8], j: r[9], q: r[16], r: r[17], s: r[18], t: r[19], mes: s.getName() });
    });
  });
  const hist = agruparHistorial(filas);
  const actuales = p.getRange(2, 1, Math.max(p.getLastRow() - 1, 1), 10).getValues();
  const res = cruzarHistorialConProveedores(hist, actuales);
  res.cambios.forEach(c => p.getRange(c.fila, c.col).setValue(c.valor));
  if (res.nuevas.length) {
    const desde = p.getLastRow() + 1;
    p.getRange(desde, 1, res.nuevas.length, 1).setNumberFormat('@');
    p.getRange(desde, 1, res.nuevas.length, 10).setValues(res.nuevas);
  }
  p.autoResizeColumns(1, 4);
  ss.setActiveSheet(p);
  SpreadsheetApp.getUi().alert('Historial leído: ' + filas.filter(f => String(f.nombre).trim()).length + ' filas de ' + hist.length + ' proveedores.\n\n' +
    '✓ Proveedores nuevos agregados: ' + res.nuevas.length + '\n✓ Celdas completadas en proveedores existentes: ' + res.cambios.length + '\n\n' +
    'Revise en ⚙️ Proveedores los que quedaron "Por definir" (columna D): son los que en el historial nunca tuvieron retención ' +
    'aunque superaron la base. La columna Notas (I) dice qué encontró en el historial.');
}

/** Agrupa las filas del historial por proveedor (nombre normalizado). */
function agruparHistorial(filas) {
  const g = {};
  const num = v => typeof v === 'number' ? v : Number(String(v || '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
  filas.forEach(f => {
    const nombre = String(f.nombre || '').replace(/\s+/g, ' ').trim();
    if (!nombre || /^(total|subtotal|proveedor)\b/i.test(nombre)) return;
    const toks = Array.from(new Set(tokens(nombre).filter(t => t.length >= 3))).sort();
    const k = toks.join(' ') || nombre.toLowerCase();
    const x = g[k] = g[k] || { clave: k, nombres: {}, n: 0, tasas: {}, maxG: 0, maxGsin: 0, repartos: {}, nRep: 0, categorias: {} };
    x.n++;
    x.nombres[nombre] = (x.nombres[nombre] || 0) + 1;
    const G = num(f.g), I = num(f.i) || G;
    let j = num(f.j); if (j > 1) j = j / 100;
    j = Math.round(j * 10000) / 10000;
    x.tasas[j] = (x.tasas[j] || 0) + 1;
    if (G > x.maxG) x.maxG = G;
    if (!j && G > x.maxGsin) x.maxGsin = G;
    const q = num(f.q), r = num(f.r), s = num(f.s);
    if (I > 0 && q + r + s > 0) {
      const rep = [q, r, s].map(v => Math.round(v / I * 100)).join('/');
      x.repartos[rep] = (x.repartos[rep] || 0) + 1; x.nRep++;
    }
    const t = String(f.t || '').trim();
    if (t) x.categorias[t] = (x.categorias[t] || 0) + 1;
  });
  const moda = o => Object.keys(o).sort((a, b) => o[b] - o[a])[0];
  return Object.keys(g).map(k => {
    const x = g[k];
    x.nombre = moda(x.nombres);
    x.categoria = moda(x.categorias) || '';
    const rep = moda(x.repartos);
    x.reparto = rep && x.repartos[rep] >= Math.max(1, x.nRep * 0.6) && rep.split('/').reduce((a, v) => a + Number(v), 0) >= 99 ? rep.split('/').map(Number) : null;
    x.sedeVaria = x.nRep > 1 && !x.reparto;
    const c = conceptoDesdeHistorial(x);
    x.concepto = c.concepto; x.nota = c.nota;
    return x;
  });
}

/** Concepto de retención según las tarifas usadas a mano en el historial. */
function conceptoDesdeHistorial(x) {
  const pesos = v => '$' + Math.round(v).toLocaleString('es-CO');
  const conTasa = Object.keys(x.tasas).filter(t => Number(t) > 0).sort((a, b) => x.tasas[b] - x.tasas[a]);
  const nSin = x.tasas[0] || 0;
  const resumen = 'Historial: ' + x.n + ' fila(s)' + (conTasa.length ? ', Rt ' + conTasa.map(t => (Number(t) * 100).toLocaleString('es-CO') + '% ×' + x.tasas[t]).join(', ') : '') +
    (nSin ? ', sin Rt ×' + nSin : '') + ', valor máx. ' + pesos(x.maxG);
  if (!conTasa.length) {
    if (x.maxG < 105000) return { concepto: 'No aplica', nota: resumen + ' (siempre bajo la base: revisar si compra más)' };
    return { concepto: 'Por definir', nota: resumen + ' (nunca se le retuvo aunque superó la base: confirmar con contador)' };
  }
  const t = Number(conTasa[0]);
  const mapa = { 0.025: 'Compras generales', 0.04: 'Servicios generales', 0.02: 'Servicios de salud (IPS)', 0.11: 'Honorarios persona jurídica' };
  if (mapa[t]) return { concepto: mapa[t], nota: resumen };
  if (t === 0.035) {
    if (/arriend|local|canon|admin/i.test(x.categoria)) return { concepto: 'Arrendamiento inmuebles', nota: resumen };
    if (/restaur|hotel|aliment/i.test(x.categoria)) return { concepto: 'Restaurante / hotel', nota: resumen };
    return { concepto: 'Por definir', nota: resumen + ' (3,5%: ¿arrendamiento o restaurante?)' };
  }
  return { concepto: 'Manual (persona natural)', nota: resumen + ' (tarifa no estándar: cálculo manual)' };
}

/**
 * Cruza el historial con ⚙️ Proveedores. Devuelve las celdas a completar en filas existentes
 * (nunca sobrescribe) y las filas nuevas a agregar.
 */
function cruzarHistorialConProveedores(hist, actuales) {
  const cambios = [], nuevas = [];
  const vacio = v => v === '' || v === null || v === undefined;
  const sigDe = n => Array.from(new Set(tokens(n).filter(t => t.length >= 3)));
  const existentes = actuales.map((r, i) => ({ r, fila: i + 2, sigs: [sigDe(r[1]), sigDe(r[2])] })).filter(e => e.r[0] || e.r[1]);
  const parecido = (a, b) => {
    if (!a.length || !b.length) return 0;
    const comun = a.filter(t => b.indexOf(t) >= 0).length;
    if (comun < Math.min(2, a.length, b.length)) return 0;
    return comun / Math.max(a.length, b.length);
  };
  hist.forEach(h => {
    const sh = h.clave.split(' ');
    let mejor = null, max = 0.6 - 1e-9;
    existentes.forEach(e => e.sigs.forEach(s => { const p = parecido(sh, s); if (p > max) { max = p; mejor = e; } }));
    const rep = h.reparto || ['', '', ''];
    if (mejor && mejor.fila < 0) return; // variante de un proveedor que se acaba de agregar
    if (mejor) {
      const r = mejor.r;
      const poner = (col, valor) => { if (vacio(r[col - 1]) && !vacio(valor)) { cambios.push({ fila: mejor.fila, col, valor }); r[col - 1] = valor; } };
      if (String(r[3]).trim() === 'Por definir' && ['Por definir', 'No aplica'].indexOf(h.concepto) < 0) cambios.push({ fila: mejor.fila, col: 4, valor: h.concepto });
      poner(5, h.categoria);
      if (vacio(r[5]) && vacio(r[6]) && vacio(r[7]) && h.reparto) { poner(6, rep[0]); poner(7, rep[1]); poner(8, rep[2]); }
      if (String(r[8]).indexOf('Historial:') < 0) cambios.push({ fila: mejor.fila, col: 9, valor: (r[8] ? r[8] + ' · ' : '') + h.nota + (h.sedeVaria ? ' · sede varía' : '') });
      return;
    }
    nuevas.push(['', h.nombre, '', h.concepto, h.categoria, rep[0], rep[1], rep[2], h.nota + (h.sedeVaria ? ' · sede varía' : ''), '']);
    existentes.push({ r: nuevas[nuevas.length - 1], fila: -1, sigs: [sh, []] });
  });
  return { cambios, nuevas };
}

// ===================== LECTURAS DE CONFIGURACIÓN =====================

function leerTablaRetencion_(ss) {
  const t = {};
  ss.getSheetByName(CFG.HOJAS.RET).getDataRange().getValues().slice(1).forEach(r => {
    if (r[0]) t[String(r[0]).trim()] = { base: Number(r[1]) || 0, tarifa: r[2] === '' ? null : Number(r[2]), modo: String(r[3]).trim() };
  });
  return t;
}

function leerProveedores_(ss) {
  return indexarProveedores(ss.getSheetByName(CFG.HOJAS.PROV).getDataRange().getValues().slice(1));
}

function agregarProveedorNuevo_(ctx, f, correo) {
  if (f.nit) correo = '';
  const h = ctx.ss.getSheetByName(CFG.HOJAS.PROV);
  const concepto = f.personaNatural ? 'Manual (persona natural)' : 'Por definir';
  h.appendRow([f.nit || '', nombreControl(f, null), f.proveedor, concepto, '', '', '', '',
    'Nuevo (' + Utilities.formatDate(new Date(), 'America/Bogota', 'dd/MM/yyyy') + '): completar concepto, categoría y repartición', correo || '']);
  h.getRange(h.getLastRow(), 1, 1, 10).setBackground(CFG.COLOR_NUEVO);
  const p = { nit: f.nit || '', nombre: nombreControl(f, null), concepto, categoria: '', dca: '', dpf: '', gpf: '', correos: correo ? [correo] : [] };
  if (p.nit) ctx.proveedores.porNit[p.nit] = p;
  if (correo) ctx.proveedores.porCorreo[correo.toLowerCase()] = p;
  ctx.proveedores.lista.push(p);
  return p;
}

/** El proveedor se reconoció por nombre: guarda su NIT en ⚙️ Proveedores para la próxima vez. */
function completarNit_(ctx, prov, nit) {
  try {
    const h = ctx.ss.getSheetByName(CFG.HOJAS.PROV);
    const v = h.getRange(2, 1, h.getLastRow() - 1, 2).getValues();
    const i = v.findIndex(r => !String(r[0]).trim() && String(r[1]).trim() === prov.nombre);
    if (i >= 0) h.getRange(i + 2, 1).setNumberFormat('@').setValue(nit);
    prov.nit = nit;
    ctx.proveedores.porNit[nit] = prov;
  } catch (e) { /* no crítico */ }
}

function leerRegistro_(ss) {
  const h = hojaLog_(ss);
  const out = { cufes: {}, claves: {} };
  if (h.getLastRow() < 2) return out;
  h.getRange(2, 1, h.getLastRow() - 1, 13).getValues().forEach(r => {
    if (r[1] !== 'Registrada') return;
    if (r[9]) out.cufes[r[9]] = true;
    if (r[12]) out.claves[r[12]] = true;
  });
  return out;
}

function leerFilasManuales_(ss) {
  const out = [];
  ss.getSheets().forEach(s => {
    if (!claveMes_(s.getName()) || s.getLastRow() < 3) return;
    s.getRange(3, 2, s.getLastRow() - 2, 6).getValues().forEach((r, i) => {
      if (!r[0]) return;
      const fecha = r[3] instanceof Date ? Utilities.formatDate(r[3], 'America/Bogota', 'yyyy-MM-dd') : '';
      out.push({ num: (r[1] === '' || r[1] === '-') ? '' : normNum(r[1]), toks: tokens(r[0]), valor: Number(r[5]) || 0, fecha, pestana: s.getName(), fila: i + 3 });
    });
  });
  return out;
}

// ===================== LOG / SIMULACIÓN / DRIVE / GMAIL =====================

function hojaLog_(ss) {
  let h = ss.getSheetByName(CFG.HOJAS.LOG);
  const enc = ['Procesado', 'Resultado', 'Pestaña', 'Fila', 'Proveedor', 'NIT / CC', 'Número', 'Fecha documento', 'Total', 'CUFE', 'Detalle', 'Correo', 'Clave'];
  if (!h) {
    h = ss.insertSheet(CFG.HOJAS.LOG);
    h.setFrozenRows(1);
  }
  h.getRange(1, 1, 1, enc.length).setValues([enc]).setFontWeight('bold').setBackground('#D9E2F3');
  return h;
}

/** 🧪 Simulación = copia exacta de la pestaña del mes (columnas A–U), más V–Y con datos de control. */
function hojaSimulacion_(ss) {
  const vieja = ss.getSheetByName(CFG.HOJAS.SIM);
  if (vieja) ss.deleteSheet(vieja);
  const sh = copiarPlantillaMes_(ss, CFG.HOJAS.SIM).sh;
  sh.getRange('C1').setValue('🧪 SIMULACIÓN: así quedarían las filas en la pestaña del mes. NO es el registro oficial ' +
    '(no se guardó nada en Drive ni se etiquetaron correos). Filas grises = documentos que NO se registrarían y por qué.');
  sh.getRange(2, 22, 1, 4).setValues([['Iría a pestaña', 'Tipo', 'NIT / CC', 'Asunto del correo']])
    .setFontWeight('bold').setBackground('#D9E2F3').setWrap(true);
  sh.setTabColor('#999999');
  return sh;
}

function registrarLog_(ctx, r, msg) {
  const f = r.f || {};
  if (ctx.simular) {
    if (r.estado === 'Registrada') return;
    const sh = ctx.sim, fila = siguienteFila_(sh);
    sh.getRange(fila, 2, 1, 2).setValues([[f.proveedor || '(no se pudo leer)', String(f.numero || '')]]);
    if (f.total) sh.getRange(fila, 9).setValue(f.total);
    sh.getRange(fila, 21).setValue((r.estado === 'Revisar' ? '⚠ ' : r.estado === 'Pago aplicado' ? '💸 ' : '⊘ ') + r.estado + ': ' + (r.detalle || ''));
    sh.getRange(fila, 22, 1, 4).setValues([[r.iria || 'No se registra', f.tipo === 'Cobro' ? f.tipoDoc : (f.tipo ? 'Factura DIAN' : ''), f.nit || '', msg.getSubject()]]);
    sh.getRange(fila, 2, 1, 20).setBackground('#E7E6E6');
    return;
  }
  ctx.hojaLog = ctx.hojaLog || hojaLog_(ctx.ss);
  ctx.hojaLog.appendRow([new Date(), r.estado, r.pestana || '', r.fila || '', f.proveedor || '', f.nit || '', f.numero || '',
    f.fecha ? fechaLocal_(f.fecha) : '', f.total || '', f.cufe || '', r.detalle || '',
    msg.url || ('https://mail.google.com/mail/u/0/#all/' + msg.getThread().getId()), f.proveedor ? claveDoc(f) : '']);
}

function carpetaMes_(ctx, fecha) {
  if (!ctx.carpetaRaiz) {
    if (CFG.CARPETA_SOPORTES_ID) ctx.carpetaRaiz = DriveApp.getFolderById(CFG.CARPETA_SOPORTES_ID);
    else {
      const padres = DriveApp.getFileById(ctx.ss.getId()).getParents();
      // Si la cuenta que ejecuta no tiene acceso a la carpeta de la hoja, usa su propio Drive.
      const padre = padres.hasNext() ? padres.next() : DriveApp.getRootFolder();
      const it = padre.getFoldersByName(CFG.NOMBRE_CARPETA_SOPORTES);
      ctx.carpetaRaiz = it.hasNext() ? it.next() : padre.createFolder(CFG.NOMBRE_CARPETA_SOPORTES);
    }
  }
  const nombre = Utilities.formatDate(fecha, 'America/Bogota', 'yyyy-MM');
  ctx.carpetas = ctx.carpetas || {};
  if (!ctx.carpetas[nombre]) {
    const it = ctx.carpetaRaiz.getFoldersByName(nombre);
    ctx.carpetas[nombre] = it.hasNext() ? it.next() : ctx.carpetaRaiz.createFolder(nombre);
  }
  return ctx.carpetas[nombre];
}

function label_(ctx, nombre) {
  if (!ctx.labels[nombre]) ctx.labels[nombre] = GmailApp.getUserLabelByName(nombre) || GmailApp.createLabel(nombre);
  return ctx.labels[nombre];
}

function fechaLocal_(iso) {
  if (!iso) return '';
  if (iso instanceof Date) return iso;
  const m = String(iso).match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : '';
}

/** Fecha (día) en hora de Bogotá, a mediodía: no depende de la zona horaria del proyecto. */
function fechaBogota_(d) { return fechaLocal_(isoBogota(d)); }

function emailDe_(s) { const m = String(s || '').match(/[\w.+-]+@[\w.-]+\.\w+/); return m ? m[0].toLowerCase() : ''; }

// ===================== LÓGICA PURA (probada fuera de Apps Script) =====================

/** Lee una factura electrónica DIAN (Invoice, CreditNote o AttachedDocument que la envuelve). */
function parsearXmlFactura(xmlText) {
  let x = String(xmlText).replace(/^\uFEFF/, '');
  if (/<(?:[\w-]+:)?AttachedDocument[\s>]/.test(x.slice(0, 3000))) {
    const interno = extraerDocumentoInterno_(x);
    if (!interno) throw new Error('AttachedDocument sin factura embebida');
    x = interno;
  }
  x = x.replace(/<(\/?)[A-Za-z_][\w.-]*:/g, '<$1');
  const raiz = x.match(/<(Invoice|CreditNote|DebitNote)[\s>]/);
  if (!raiz) return null;
  const tipo = raiz[1];
  x = x.replace(/<UBLExtensions[\s>][\s\S]*?<\/UBLExtensions>/g, '');
  const tagLinea = tipo + 'Line';
  const lineas = todosBloques_(x, tagLinea);
  const doc = x.replace(new RegExp('<' + tagLinea + '[\\s>][\\s\\S]*?<\\/' + tagLinea + '>', 'g'), '');

  const sup = bloque_(doc, 'AccountingSupplierParty');
  const cli = bloque_(doc, 'AccountingCustomerParty');
  const nitDe = p => soloDigitos_(valor_(bloque_(p, 'PartyTaxScheme'), 'CompanyID') || valor_(bloque_(p, 'PartyLegalEntity'), 'CompanyID') || valor_(bloque_(p, 'PartyIdentification'), 'ID'));
  const proveedor = valor_(bloque_(sup, 'PartyTaxScheme'), 'RegistrationName') || valor_(bloque_(sup, 'PartyLegalEntity'), 'RegistrationName') || valor_(bloque_(sup, 'PartyName'), 'Name') || 'Desconocido';

  const tot = bloque_(doc, 'LegalMonetaryTotal') || bloque_(doc, 'RequestedMonetaryTotal');
  const n = t => num_(valor_(tot, t));
  let iva = 0, otrosImp = 0;
  todosBloques_(doc, 'TaxTotal').forEach(b => {
    const monto = num_(valor_(b, 'TaxAmount'));
    const esquema = valor_(bloque_(b, 'TaxScheme'), 'ID');
    if (esquema === '01' || esquema === '04' || esquema === '') iva += monto; else otrosImp += monto;
  });
  iva = red2_(iva);
  const pagar = n('PayableAmount') || n('TaxInclusiveAmount');

  let concepto = '';
  if (lineas.length) {
    const it = bloque_(lineas[0], 'Item');
    concepto = valor_(it, 'Description') || valor_(it, 'Name') || '';
    if (lineas.length > 1) concepto += ' (+' + (lineas.length - 1) + ' ítems)';
  }
  const fecha = valor_(doc, 'IssueDate');
  const venc = valor_(doc, 'DueDate') || valor_(bloque_(doc, 'PaymentMeans'), 'PaymentDueDate') || fecha;

  return {
    tipo,
    numero: valor_(doc, 'ID'),
    cufe: valor_(doc, 'UUID'),
    fecha, vencimiento: venc,
    proveedor: proveedor.replace(/\s+/g, ' ').trim(),
    nit: nitDe(sup),
    personaNatural: valor_(sup, 'AdditionalAccountID') === '2',
    nitCliente: nitDe(cli),
    subtotal: red2_(pagar - iva), iva, total: red2_(pagar),
    baseLineas: n('LineExtensionAmount'), descuentos: n('AllowanceTotalAmount'), cargos: n('ChargeTotalAmount'), otrosImpuestos: red2_(otrosImp),
    moneda: valor_(doc, 'DocumentCurrencyCode') || 'COP',
    concepto: concepto.replace(/\s+/g, ' ').trim(),
    referencia: tipo !== 'Invoice' ? valor_(bloque_(doc, 'BillingReference'), 'ID') : '',
  };
}

function extraerDocumentoInterno_(x) {
  const esDoc = s => /<(?:[\w-]+:)?(Invoice|CreditNote|DebitNote)[\s>]/.test(s.slice(0, 5000));
  for (const c of (x.match(/<!\[CDATA\[[\s\S]*?\]\]>/g) || [])) {
    const s = c.slice(9, -3).trim();
    if (esDoc(s)) return s;
  }
  const re = /<(?:[\w-]+:)?Description(?:\s[^>]*)?>([^<]*)<\/(?:[\w-]+:)?Description>/g;
  let m;
  while ((m = re.exec(x)) !== null) {
    const s = decodificar_(m[1]).trim();
    if (esDoc(s)) return s;
  }
  return null;
}

function bloque_(xml, tag) {
  if (!xml) return '';
  const m = xml.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + tag + '>'));
  return m ? m[1] : '';
}
function todosBloques_(xml, tag) {
  if (!xml) return [];
  const re = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + tag + '>', 'g');
  const out = []; let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}
function valor_(xml, tag) {
  if (!xml) return '';
  const m = xml.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([^<]*)<\\/' + tag + '>'));
  return m ? decodificar_(m[1]).trim() : '';
}
function decodificar_(s) {
  return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/&amp;/g, '&');
}
function num_(v) { const n = parseFloat(String(v || '').replace(',', '.')); return isNaN(n) ? 0 : n; }
function red2_(n) { return Math.round(n * 100) / 100; }
function soloDigitos_(s) { return String(s || '').replace(/\D/g, ''); }

/** Texto plano de word/document.xml (para cuentas de cobro en Word). */
function docxXmlATexto(xml) {
  return decodificar_(String(xml)
    .replace(/<w:tab\/>/g, '\t').replace(/<w:br\/>/g, '\n').replace(/<\/w:p>/g, '\n').replace(/<\/w:tc>/g, '\t')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 20000);
}

/** ¿El correo puede traer un documento de cobro? (filtro barato antes de usar IA) */
function clasificarCorreo(asunto, cuerpo, nombresAdjuntos) {
  const a = String(asunto || '');
  if (CFG.EXCLUIR_ASUNTO.test(a)) return { esCandidato: false, motivo: 'asunto excluido' };
  const texto = a + ' ' + String(cuerpo || '').slice(0, 3000) + ' ' + nombresAdjuntos.join(' ');
  if (!CFG.PALABRAS_COBRO.test(texto)) return { esCandidato: false, motivo: 'sin palabras de cobro' };
  if (nombresAdjuntos.every(n => esAnexo(n) || !/\.(pdf|docx|png|jpe?g|webp)$/i.test(n))) return { esCandidato: false, motivo: 'solo anexos' };
  return { esCandidato: true };
}

function esAnexo(nombre) { return CFG.ANEXOS.test(String(nombre || '').replace(/\.[^.]+$/, '')); }

/** Remitente original de un correo reenviado ("De: Nombre <correo>"), o el remitente directo. */
function remitenteOriginal(cuerpo, from) {
  const re = /(?:^|\n)\s*\*?(?:De|From):\*?\s*([^\n]*<[^>\n]+>|[\w.+-]+@[\w.-]+\.\w+)/g;
  let m;
  while ((m = re.exec(String(cuerpo || ''))) !== null) {
    if (!/dentilandia/i.test(m[1])) return m[1].trim();
  }
  return String(from || '');
}

/** Convierte la respuesta de la IA en el mismo objeto que produce una factura DIAN. */
function cobroDesdeIA(ia, nombreArchivo, fechaCorreo) {
  const total = red2_(Number(ia.valor_total) || 0);
  const iva = red2_(Number(ia.iva) || 0);
  const id = soloDigitos_(ia.proveedor_identificacion);
  const cobraA = String(ia.cobra_a || '');
  const esParaDentilandia = !cobraA || /dentilandia|901\.?117\.?356/i.test(cobraA) || !/\b(s\.?\s?a\.?\s?s|ltda|nit)\b|\d{6,}/i.test(cobraA);
  let numero = String(ia.numero_documento || '').trim().replace(/^(n[oº°]\.?|#|numero|número)\s*/i, '');
  if (!numero) { const m = String(nombreArchivo || '').match(/#\s*([\w-]*\d[\w-]*)/); if (m) numero = m[1]; }
  const fechaIso = /^\d{4}-\d{2}-\d{2}$/.test(ia.fecha_documento || '') ? ia.fecha_documento :
    (fechaCorreo ? isoBogota(fechaCorreo) : '');
  let reparto = null;
  const vs = Array.isArray(ia.valores_por_sede) ? ia.valores_por_sede.filter(v => Number(v.valor) > 0) : [];
  if (vs.length && total > 0) {
    const sum = s => vs.filter(v => v.sede === s).reduce((a, v) => a + Number(v.valor), 0);
    const dca = sum('DCA'), dpf = sum('DPF');
    if (Math.abs(dca + dpf - total) <= Math.max(1, total * 0.005)) {
      const pDca = Math.round(dca / total * 1000) / 10;
      reparto = [pDca, Math.round((100 - pDca) * 10) / 10, 0];
    }
  }
  return {
    tipo: 'Cobro',
    tipoDoc: ia.tipo_documento || 'cuenta de cobro',
    esCobro: !!ia.es_documento_de_cobro && total > 0,
    esFacturaElectronica: !!ia.es_factura_electronica,
    esParaDentilandia, cobraA,
    numero, cufe: '',
    fecha: fechaIso,
    vencimiento: /^\d{4}-\d{2}-\d{2}$/.test(ia.fecha_vencimiento || '') ? ia.fecha_vencimiento : fechaIso,
    proveedor: String(ia.proveedor_nombre || 'Desconocido').replace(/\s+/g, ' ').trim(),
    nit: id,
    personaNatural: !(id.length === 9 && /^[89]/.test(id)),
    subtotal: red2_(Number(ia.valor_antes_iva) > 0 ? Number(ia.valor_antes_iva) : total - iva),
    iva, total,
    descuentos: 0, otrosImpuestos: 0, moneda: 'COP',
    concepto: String(ia.concepto || '').slice(0, 100),
    observacionesIA: String(ia.observaciones || ''),
    reparto,
  };
}

/** Índices de ⚙️ Proveedores: por NIT, por correo/dominio y lista para buscar por nombre. */
function indexarProveedores(filas) {
  const out = { porNit: {}, porCorreo: {}, lista: [] };
  filas.forEach(r => {
    const p = { nit: soloDigitos_(r[0]), nombre: String(r[1] || '').trim(), nombreDian: String(r[2] || '').trim(), concepto: String(r[3] || '').trim(),
      categoria: String(r[4] || '').trim(), dca: r[5], dpf: r[6], gpf: r[7], correos: String(r[9] || '').toLowerCase().split(/[,;\s]+/).filter(Boolean) };
    if (!p.nit && !p.nombre) return;
    if (p.nit) out.porNit[p.nit] = p;
    p.correos.forEach(c => { out.porCorreo[c] = p; });
    out.lista.push(p);
  });
  return out;
}

/** Proveedor de un documento de cobro: NIT/cédula → correo o dominio del remitente → nombre. */
function buscarProveedor(idx, f, remitente) {
  if (f.nit && idx.porNit[f.nit]) return idx.porNit[f.nit];
  const correo = (String(remitente || '').match(/[\w.+-]+@[\w.-]+\.\w+/) || [''])[0].toLowerCase();
  // Por correo solo si el documento no trae otra identificación: un mismo remitente puede
  // enviar cuentas de cobro de varias personas en un solo correo.
  const mismaPersona = p => p && (!f.nit || !p.nit || p.nit === f.nit);
  if (correo) {
    if (mismaPersona(idx.porCorreo[correo])) return idx.porCorreo[correo];
    const dominio = correo.split('@')[1];
    if (mismaPersona(idx.porCorreo[dominio]) && !/gmail|hotmail|outlook|yahoo/.test(dominio)) return idx.porCorreo[dominio];
  }
  const t = tokens(f.proveedor).filter(x => x.length >= 3);
  let mejor = null, max = 0;
  idx.lista.forEach(p => {
    [p.nombre, p.nombreDian].forEach(n => {
      const sig = Array.from(new Set(tokens(n).filter(x => x.length >= 3)));
      const comun = sig.filter(x => t.indexOf(x) >= 0).length;
      // Al menos 2 palabras en común (o 1 si el nombre tiene una sola) y que cubran la mayor parte del nombre.
      if (!sig.length || comun < Math.min(2, sig.length) || comun / sig.length < 0.6) return;
      const puntaje = comun + comun / sig.length;
      if (puntaje > max) { max = puntaje; mejor = p; }
    });
  });
  return mejor;
}

/** Repartición final en % [DCA, DPF, GPF]: la del documento si viene, si no la del proveedor. */
function repartoFinal(f, prov) {
  if (f.reparto) return f.reparto;
  if (!prov) return null;
  const v = [prov.dca, prov.dpf, prov.gpf].map(x => (x === '' || x === null || x === undefined) ? null : Number(x));
  if (v.some(x => x === null || isNaN(x)) || Math.abs(v[0] + v[1] + v[2] - 100) > 0.5) return null;
  return v;
}

/** Retención según el concepto del proveedor y la tabla ⚙️ Retención. */
function calcularRetencion(prov, f, tabla) {
  if (!prov || !prov.concepto) {
    return { tarifa: null, pendiente: true, nota: f.personaNatural ? '⚠ proveedor nuevo (persona natural): calcular retención' : '⚠ proveedor nuevo: definir retención en ⚙️ Proveedores' };
  }
  const c = tabla[prov.concepto];
  if (!c) return { tarifa: null, pendiente: true, nota: '⚠ concepto "' + prov.concepto + '" no existe en ⚙️ Retención' };
  if (c.modo === 'No aplica') return { tarifa: null, nota: '' };
  if (c.modo === 'Manual') return { tarifa: null, pendiente: true, nota: '⚠ calcular retención a mano (persona natural)' };
  if (c.modo === 'Por definir') return { tarifa: null, pendiente: true, nota: '⚠ retención por definir (ver ⚙️ Proveedores)' };
  if (f.subtotal >= c.base) return { tarifa: c.tarifa, nota: 'Rt ' + prov.concepto.toLowerCase() + ' ' + (c.tarifa * 100).toFixed(1).replace('.0', '') + '%' };
  return { tarifa: null, nota: '' };
}

function construirNotas(f, prov, ret) {
  const n = [];
  if (ret.nota) n.push(ret.nota);
  if (f.descuentos > 0) n.push('incluye descuento $' + Math.round(f.descuentos).toLocaleString('es-CO'));
  if (f.otrosImpuestos > 0) n.push('otros impuestos $' + Math.round(f.otrosImpuestos).toLocaleString('es-CO') + ' incluidos en G');
  if (f.moneda && f.moneda !== 'COP') n.push('⚠ moneda ' + f.moneda);
  if (f.observacionesIA) n.push('IA: ' + f.observacionesIA.slice(0, 120));
  if (f.concepto) n.push(f.concepto.slice(0, 80));
  return n;
}

function nombreControl(f, prov) {
  if (prov && prov.nombre) return prov.nombre;
  const t = String(f.proveedor || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return t.replace(/(^|\s)\S/g, s => s.toUpperCase());
}

const STOP_ = { sas: 1, s: 1, a: 1, sa: 1, ltda: 1, de: 1, la: 1, el: 1, y: 1, del: 1, colombia: 1, sociedad: 1, por: 1, acciones: 1, simplificada: 1, e: 1, las: 1, los: 1, co: 1 };
function tokens(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9ñ ]/g, ' ').split(/\s+/).filter(t => t.length > 1 && !STOP_[t]);
}
function normNum(v) {
  if (typeof v === 'number') return String(Math.round(v));
  return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+(?=\d)/, '');
}

/** Mismo número aunque uno tenga prefijo de letras (FE5166 = 5166). Exige al menos 3 dígitos. */
function numIgual(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const da = a.replace(/^[A-Z]+/, ''), db = b.replace(/^[A-Z]+/, '');
  return /^\d{3,}$/.test(da) && da === db;
}

/** Clave única de un documento: identificación (o nombre) + número (o fecha+valor si no tiene número). */
function claveDoc(f) {
  const id = f.nit || tokens(f.proveedor).slice(0, 3).join('-');
  const num = normNum(f.numero);
  return id + '|' + (num || ('SN-' + f.fecha + '-' + Math.round(f.total || 0)));
}

/**
 * ¿Ya está registrado? Devuelve null, un motivo, o un motivo que empieza por ⚠ si parece
 * una versión corregida (mismo número, valor distinto) que alguien debe revisar.
 */
function buscarDuplicado(f, registrados, manuales, porNit, prov) {
  if (f.cufe && registrados.cufes[f.cufe]) return 'CUFE ya registrado';
  if (registrados.claves[claveDoc(f)]) return 'Ya registrado por el robot';
  const nn = normNum(f.numero);
  const misToks = tokens(f.proveedor).concat(prov ? tokens(prov.nombre) : []).concat(porNit && porNit[f.nit] ? tokens(porNit[f.nit].nombre) : []);
  for (const m of manuales) {
    const sig = Array.from(new Set(m.toks.filter(t => t.length >= 3)));
    const comun = sig.filter(t => misToks.indexOf(t) >= 0);
    if (!comun.length || comun.length < Math.min(2, sig.length)) continue;
    if (nn && numIgual(m.num, nn)) {
      const cerca = (a, b) => Math.abs(a - b) <= Math.max(2, Math.abs(b) * 0.002);
      const coincide = [f.subtotal, f.total].some(v => cerca(m.valor, v)) || (m.total && cerca(m.total, f.total));
      if (m.valor > 0 && f.subtotal > 0 && !coincide) {
        return '⚠ mismo número con valor distinto ($' + Math.round(m.valor).toLocaleString('es-CO') + ' en ' + m.pestana + ' fila ' + m.fila +
          ' vs $' + Math.round(f.subtotal).toLocaleString('es-CO') + '): ¿documento corregido?';
      }
      return 'Ya digitada en ' + m.pestana + ', fila ' + m.fila;
    }
    if (!nn && m.fecha && m.fecha === f.fecha && Math.abs(m.valor - f.subtotal) <= 1) return 'Ya digitada (sin número, misma fecha y valor) en ' + m.pestana + ', fila ' + m.fila;
  }
  return null;
}

/** AAAA-MM-DD de un instante, en hora de Bogotá (UTC-5, sin horario de verano). */
function isoBogota(d) { return new Date(d.getTime() - 5 * 3600 * 1000).toISOString().slice(0, 10); }

/** Si la fecha del documento es de un mes anterior al de la pestaña, devuelve "Octubre 2026"; si no, null. */
function esDeMesAnterior(fechaIso, fechaMes) {
  const m = String(fechaIso || '').match(/^(\d{4})-(\d{2})/);
  if (!m || !fechaMes) return null;
  const doc = Number(m[1]) * 12 + Number(m[2]) - 1, tab = fechaMes.getFullYear() * 12 + fechaMes.getMonth();
  return doc < tab ? MESES[Number(m[2]) - 1] + ' ' + m[1] : null;
}

function peorEstado_(a, b) {
  const orden = ['No es cobro', 'Factura electrónica', 'Otro cliente', 'Ya estaba', 'Mes anterior', 'Nota crédito', 'Registrada', 'Revisar'];
  if (!a) return b;
  return orden.indexOf(b) > orden.indexOf(a) ? b : a;
}

if (typeof module !== 'undefined') {
  module.exports = { parsearXmlFactura, calcularRetencion, buscarDuplicado, construirNotas, nombreControl, normNum, tokens, claveDoc,
    docxXmlATexto, clasificarCorreo, esDeMesAnterior, esAnexo, remitenteOriginal, cobroDesdeIA, indexarProveedores, buscarProveedor, repartoFinal,
    RETENCION_INICIAL, PROVEEDORES_INICIALES, HERRAMIENTA_COBRO, claveMes_, peorEstado_, numIgual, isoBogota, agruparHistorial, conceptoDesdeHistorial, cruzarHistorialConProveedores, filaParaERP, pistaDeNombrePago, emparejarPago };
}
