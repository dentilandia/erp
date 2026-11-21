// Corrida completa de "4. Procesar ahora" con los casos reales del 12-13 de noviembre.
'use strict';
const vm = require('vm'), fs = require('fs'), assert = require('assert');
const { crearEntorno, Blob, DFile } = require('./gas_mock.cjs');

const IA = {
  '116819955552.pdf': { es_documento_de_cobro: false, es_factura_electronica: true, tipo_documento: 'otro', cobra_a: 'LUZ MARINA GOMEZ CC 43123456',
    proveedor_nombre: 'Empresas Públicas De Medellín E.S.P.', proveedor_identificacion: '890904996', numero_documento: 'DEE66162386',
    fecha_documento: '2026-11-05', fecha_vencimiento: '2026-11-20', valor_antes_iva: 350000, iva: 0, valor_total: 350000, concepto: 'Energía y acueducto local' },
  'Autoliquidaciones_1086282405_Consolidado.pdf': { es_documento_de_cobro: false, es_factura_electronica: false, tipo_documento: 'otro', cobra_a: '',
    proveedor_nombre: 'LEON DAVID AGUDELO RENDON', numero_documento: '', fecha_documento: '2026-11-01', valor_total: 0, observaciones: 'Planilla de seguridad social' },
  'CUENTA COBRO - DENTILANDIA.pdf': { es_documento_de_cobro: true, es_factura_electronica: false, tipo_documento: 'cuenta de cobro', cobra_a: 'Dentilandia S.A.S.',
    proveedor_nombre: 'Leon David Agudelo Rendon', proveedor_identificacion: '1086282405', numero_documento: '04', fecha_documento: '2026-10-31', valor_total: 900000 },
  'Clara Villa - 859 860 861 840.jpg': { es_comprobante_de_pago: true, plataforma: 'Bancolombia', fecha: '2026-11-12', valor: 400000, beneficiario_nombre: 'Clara Villa', medio: 'transferencia', referencia: 'A1' },
  'Miguel Munoz - 001.jpeg': { es_comprobante_de_pago: true, plataforma: 'Bancolombia', fecha: '2026-11-12', valor: 160000, beneficiario_nombre: 'Miguel Angel Munoz', medio: 'transferencia' },
  'EPM - Todas las facturas.jpeg': { es_comprobante_de_pago: true, plataforma: 'Bancolombia', fecha: '2026-11-12', valor: 350000, beneficiario_nombre: 'EPM', medio: 'transferencia' },
  'B2chat - BCH73867 - tarjeta.png': { es_comprobante_de_pago: true, plataforma: 'Otra', fecha: '2026-11-12', valor: 632677, beneficiario_nombre: 'B2CHAT SAS', medio: 'tarjeta_credito' },
};
const llamadasIA = [];
const env = crearEntorno({ ia: (archivo, tool) => { llamadasIA.push(archivo + ' → ' + tool); if (!IA[archivo]) throw new Error('IA sin respuesta para ' + archivo); return IA[archivo]; } });
const { g, ss, carpetaHoja, props, enviados } = env;
const ctx = Object.assign({ module: {} }, g); vm.createContext(ctx);
vm.runInContext(fs.readFileSync(process.argv[2] || require('path').join(__dirname, '..', 'FacturasCompra.gs'), 'utf8'), ctx);
const F = ctx.module.exports;

// ---------- Hoja
const ret = ss.insertSheet('⚙️ Retención');
ret.getRange(1, 1, 1, 4).setValues([['Concepto', 'Base', 'Tarifa', 'Modo']]);
F.RETENCION_INICIAL.forEach((r, i) => ret.getRange(i + 2, 1, 1, 4).setValues([r]));
const prov = ss.insertSheet('⚙️ Proveedores');
prov.getRange(1, 1, 1, 11).setValues([['NIT', 'Nombre', 'DIAN', 'Concepto', 'Categoría', 'DCA', 'DPF', 'GPF', 'Notas', 'Correos', 'Pago automático']]);
const filasProv = F.PROVEEDORES_INICIALES.map(r => r.concat(['']))
  .concat([['', 'Epm', '', 'No aplica', 'Servicios publicos', 0, 100, 0, 'Historial', '', '']]); // categoría del historial que NO está en la lista de la col. T
filasProv.forEach((r, i) => prov.getRange(i + 2, 1, 1, 11).setValues([r]));
ss.insertSheet('🤖 Registro automático').getRange(1, 1, 1, 13).setValues([['Procesado', 'Resultado', 'Pestaña', 'Fila', 'Proveedor', 'NIT', 'Número', 'Fecha', 'Total', 'CUFE', 'Detalle', 'Correo', 'Clave']]);

const METODOS = ['Efectivo', 'Transferencia', 'Nota credito', 'Consignacion', 'Tarjeta de credito', 'Efectivo GPF'];
const CATEGORIAS = ['Costos de venta', 'Diversos', 'Honorarios', 'Mnto', 'Plataformas digitales', 'Financieros', 'Otros servicios', 'Servicios'];
function mes(nombre, filas) {
  const sh = ss.insertSheet(nombre);
  sh.getRange('C1').setValue('FACTURAS MES ' + nombre.toUpperCase());
  sh.getRange(2, 1, 1, 21).setValues([['#', 'Proveedor', 'Numero', 'DS', 'Fecha', 'Venc', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'Pagado', 'Metodo', 'DCA', 'DPF', 'GPF', 'Distribucion', 'obs']]);
  for (let r = 3; r <= 60; r++) { sh.validations[r + ',16'] = METODOS; sh.validations[r + ',20'] = CATEGORIAS; }
  filas.forEach((f, i) => {
    const r = i + 3;
    sh.getRange(r, 1, 1, 21).setValues([[i + 1, f[0], f[1], '-', new Date(f[2] + 'T05:00:00Z'), '', f[3], 0, '=+G' + r + '+H' + r, f[4] === null ? '' : f[4], '=+G' + r + '*J' + r, 0, 0,
      '=+I' + r + '-K' + r + '-L' + r + '-M' + r, f[5] || '', f[6] || '', '', '', '', 'Honorarios', '']]);
  });
  return sh;
}
const jun = mes('Junio 2026', [['Empresas Publicas de Medellin', 'VIEJA1', '2026-06-05', 350000, 0]]);
const oct = mes('Octubre 2026', [['Clara Villa', '859', '2026-10-05', 100000, 0], ['Clara Villa', '860', '2026-10-06', 100000, 0],
  ['Clara Villa', '861', '2026-10-07', 100000, 0], ['Clara Villa', '840', '2026-10-01', 100000, 0], ['Santiago Palacio Sosa', '11', '2026-10-20', 894510, 0]]);
const nov = mes('Noviembre 2026', [['Natalia Madrid Matallana', '1', '2026-11-04', 298200, null, 'x', 'Transferencia'],
  ['Miguel Ángel Muñoz Ramírez', '001', '2026-11-09', 160000, null], ['B2chat', 'BCH73867', '2026-11-05', 632677, null]]);

// ---------- Drive: las dos carpetas con lo que subieron
const entrada = carpetaHoja.createFolder('📥 Facturas para registrar');
const pagos = carpetaHoja.createFolder('💸 Comprobantes de pago');
const subir = (carpeta, nombre, mime) => carpeta.files.push(new DFile(carpeta, new Blob('x'.repeat(50000), nombre, mime), new Date('2026-11-13T04:00:00Z')));
subir(entrada, 'CUENTA COBRO - DENTILANDIA.pdf', 'application/pdf');
subir(entrada, 'Autoliquidaciones_1086282405_Consolidado.pdf', 'application/pdf');
subir(entrada, '116819955552.pdf', 'application/pdf');
subir(pagos, 'Clara Villa - 859 860 861 840', 'image/jpeg'); // sin extensión
subir(pagos, 'Miguel Munoz - 001.jpeg', 'image/jpeg');
subir(pagos, 'EPM - Todas las facturas.jpeg', 'image/jpeg');
subir(pagos, 'B2chat - BCH73867 - tarjeta.png', 'image/png');

props.ANTHROPIC_API_KEY = 'sk-ant-x';
props.ERP_SYNC_KEY = 'a'.repeat(64);

// ---------- Corrida
if (process.env.SIM) {
  ctx.simular();
  const sim = ss.getSheetByName('🧪 Simulación');
  console.log('\n=== Simulación ===');
  sim.getRange(3, 1, sim.getLastRow() - 2, 25).getValues().forEach(r => r[1] && console.log('-', r[1], r[2], '|', String(r[20]).slice(0, 90), '|', r[21]));
  assert.equal(entrada.files.length, 3, 'la simulación movió archivos de 📥'); assert.equal(pagos.files.length, 4, 'la simulación movió comprobantes');
  assert(!nov.getRange(4, 15).getValue(), 'la simulación marcó pagado');
  assert.equal(enviados.erp.length, 0, 'la simulación envió al ERP');
  console.log('✓ simulación sin efectos');
}
ctx.procesarAhora();
const antes = nov.getLastRow();
ctx.procesarAhora();
assert.equal(nov.getLastRow(), antes, 'la segunda corrida agregó filas');
console.log('✓ segunda corrida sin duplicados');

// ---------- Resultado
const filasDe = sh => sh.getRange(3, 1, sh.getLastRow() - 2, 21).getValues();
const log = ss.getSheetByName('🤖 Registro automático').getDataRange().getValues().slice(1);
console.log('\n=== Aviso final ===\n' + enviados.alerts.join('\n---\n'));
console.log('\n=== Registro automático ===');
log.forEach(r => console.log('-', r[1], '|', r[2], '|', r[4], r[6], '|', String(r[10]).slice(0, 150)));
console.log('\n=== Noviembre 2026 ===');
filasDe(nov).forEach(r => console.log('-', r[1], r[2], '| D', r[3], '| I', r[8], '| N', r[13], '| O', r[14], '| P', r[15], '| T', r[19], '|', String(r[20]).slice(0, 110)));
console.log('\n=== Octubre 2026 (Clara) ===');
filasDe(oct).forEach(r => console.log('-', r[1], r[2], '| O', r[14], '| P', r[15]));
console.log('\n=== Junio 2026 ===');
filasDe(jun).forEach(r => console.log('-', r[1], r[2], '| O', r[14]));
const listar = (f, pre) => { f.files.forEach(x => console.log(pre + x.name)); f.folders.forEach(s => { console.log(pre + '📁 ' + s.name); listar(s, pre + '   '); }); };
console.log('\n=== Drive ==='); listar(carpetaHoja, '');
console.log('\n=== ERP ===', enviados.erp.length ? enviados.erp[0].filas.length + ' filas, pestañas: ' + enviados.erp[0].pestanas.join(', ') : 'nada');
console.log('Llamadas a la IA:', llamadasIA.length);

// ---------- Verificaciones
const n = filasDe(nov), o = filasDe(oct), j = filasDe(jun);
const epm = n.find(r => /DEE66162386/.test(r[2]));
assert(epm, 'EPM no quedó registrada');
assert(/a nombre de LUZ MARINA/.test(epm[20]), 'EPM sin la nota de a nombre de quién');
assert.equal(epm[14], 'x', 'EPM no quedó pagada con el comprobante');
assert(/revisar Categoría\/Método/.test(epm[20]), 'la categoría fuera de la lista no dejó aviso');
const miguel = n.find(r => r[2] === '001'); assert.equal(miguel[14], 'x'); assert.equal(miguel[15], 'Transferencia');
const b2 = n.find(r => r[2] === 'BCH73867'); assert.equal(b2[14], 'x'); assert.equal(b2[15], 'Tarjeta de credito');
o.filter(r => r[1] === 'Clara Villa').forEach(r => assert.equal(r[14], 'x', 'Clara ' + r[2] + ' no quedó pagada'));
assert.equal(j[0][14], '', 'marcó como pagada una factura de junio (fuera de la ventana de 3 meses)');
assert(!n.some(r => /^04$/.test(String(r[2]))), 'León (octubre) no debía registrarse en noviembre');
const pap = carpetaHoja.find('Soportes facturas de compra/2026-11');
assert(pap.files.some(f => /^Empresas Públicas De Medellín.* - DEE66162386 - Factura\.pdf$/.test(f.name) || /^Epm - DEE66162386 - Factura\.pdf$/.test(f.name)), 'falta la factura de EPM en la papelería');
assert(pap.files.some(f => / - Anexo - Autoliquidaciones/.test(f.name)), 'falta la planilla en la papelería');
assert(pap.files.some(f => / - Pago\.jpe?g$/.test(f.name) && /DEE66162386/.test(f.name)), 'falta el comprobante de EPM en la papelería');
assert(carpetaHoja.find('Soportes facturas de compra/2026-10').files.some(f => /Clara Villa - 859 860 861 840 - Pago\.jpg$/.test(f.name)), 'falta el comprobante de Clara en la papelería de octubre');
assert.equal(entrada.files.length, 0); assert.equal(pagos.files.length, 0);
assert.equal(enviados.erp.length, 2); assert.equal(enviados.erp[1].filas.length, enviados.erp[0].filas.length, "el ERP recibió filas distintas en la segunda corrida");
const erpEpm = enviados.erp[0].filas.find(f => f.numero === 'DEE66162386'); assert(erpEpm && erpEpm.pagado === true && erpEpm.mes === '2026-11-01');
console.log('\n✓ Todas las verificaciones pasaron');
