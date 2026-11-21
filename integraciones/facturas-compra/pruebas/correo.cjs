// Buzón de facturación desde el 9 de noviembre: ningún correo debe quedar sin etiqueta.
'use strict';
const vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert');
const { crearEntorno, Blob } = require('./gas_mock.cjs');

const xml = (nit, nombre, num, fecha, total) => `<?xml version="1.0"?><Invoice xmlns:cbc="x" xmlns:cac="y"><cbc:ID>${num}</cbc:ID><cbc:UUID>CUFE-${num}</cbc:UUID><cbc:IssueDate>${fecha}</cbc:IssueDate>
<cac:AccountingSupplierParty><cac:Party><cac:PartyTaxScheme><cbc:RegistrationName>${nombre}</cbc:RegistrationName><cbc:CompanyID>${nit}</cbc:CompanyID></cac:PartyTaxScheme></cac:Party></cac:AccountingSupplierParty>
<cac:AccountingCustomerParty><cac:Party><cac:PartyTaxScheme><cbc:CompanyID>901117356</cbc:CompanyID></cac:PartyTaxScheme></cac:Party></cac:AccountingCustomerParty>
<cac:LegalMonetaryTotal><cbc:PayableAmount>${total}</cbc:PayableAmount></cac:LegalMonetaryTotal><cac:InvoiceLine><cac:Item><cbc:Description>Servicio</cbc:Description></cac:Item></cac:InvoiceLine></Invoice>`;
const zip = (nit, nombre, num, fecha, total) => new Blob('ZIP', 'ad' + num + '.zip', 'application/zip',
  [new Blob(xml(nit, nombre, num, fecha, total), 'ad' + num + '.xml', 'text/xml'), new Blob('PDF', 'ad' + num + '.pdf', 'application/pdf')]);
const d = s => new Date(s);
const fe = (nit, nombre, num, fecha, llega, extra) => Object.assign({ messages: [{ subject: `Fwd: ${nit};${nombre};${num};01;${nombre}`, date: d(llega), attachments: [zip(nit, nombre, num, fecha, 100000)] }] }, extra || {});

const correos = [
  fe('32540403', 'Clara Villa', 'FE868', '2026-11-05', '2026-11-09T19:35:00Z', { labels: ['Facturas/Registrada'] }), // ya procesado
  fe('1039447695', 'SANTIAGO PALACIO SOSA', 'AFE818', '2026-11-11', '2026-11-13T03:10:00Z'),
  fe('890913400', 'dentales antioquia sas', 'ECR64923', '2026-11-13', '2026-11-13T14:27:00Z'),
  fe('900937939', 'CONTIGO SEDACIÓN SAS', 'FE6777', '2026-11-13', '2026-11-16T15:58:00Z'),
  fe('32540403', 'Clara Villa', 'FE873', '2026-11-14', '2026-11-16T15:59:00Z'),
  fe('32540403', 'Clara Villa', 'FE874', '2026-11-14', '2026-11-16T15:59:30Z'),
  // ZIP con extensión en mayúsculas
  { messages: [{ subject: 'Fwd: 890900608;ALMACENES EXITO;VB76108973;01', date: d('2026-11-14T12:00:00Z'), attachments: [Object.assign(zip('890900608', 'ALMACENES EXITO S.A', 'VB76108973', '2026-11-14', 47500), { name: 'ADVB.ZIP' })] }] },
  // reenviado como adjunto
  { messages: [{ subject: 'Fwd: factura proveedor X', date: d('2026-11-12T12:00:00Z'), attachments: [new Blob('EML', 'Factura proveedor X.eml', 'message/rfc822')] }] },
  // correo que hace fallar a Gmail: no debe detener la corrida
  { messages: [{ subject: 'Fwd: 900111222;PROVEEDOR ROTO;R1;01', date: d('2026-11-10T12:00:00Z'), falla: true, attachments: [zip('900111222', 'PROVEEDOR ROTO', 'R1', '2026-11-10', 1000)] }] },
  // cuenta de cobro en Word
  { messages: [{ subject: 'Cuenta de cobro noviembre', date: d('2026-11-15T12:00:00Z'), body: 'Adjunto cuenta de cobro', attachments: [new Blob('x'.repeat(30000), 'Cuenta de cobro Natalia.pdf', 'application/pdf')] }] },
];
// muchos correos viejos con adjuntos (más de 100) para probar la paginación
for (let i = 0; i < 130; i++) correos.push({ labels: ['Facturas/No es cobro'], messages: [{ subject: 'Boletín ' + i, date: d('2026-11-02T12:00:00Z'), attachments: [new Blob('x', 'img' + i + '.png', 'image/png')] }] });

const IA = { 'Cuenta de cobro Natalia.pdf': { es_documento_de_cobro: true, es_factura_electronica: false, tipo_documento: 'cuenta de cobro', cobra_a: 'Dentilandia', proveedor_nombre: 'Natalia Madrid Matallana', proveedor_identificacion: '1037631584', numero_documento: '2', fecha_documento: '2026-11-15', valor_total: 300000 } };
const env = crearEntorno({ correos, ia: a => { if (!IA[a]) throw new Error('IA sin respuesta: ' + a); return IA[a]; } });
const { g, ss, props, hilosGmail } = env;
const ctx = Object.assign({ module: {} }, g); vm.createContext(ctx);
vm.runInContext(fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'FacturasCompra.gs'), 'utf8'), ctx);
const F = ctx.module.exports;
const ret = ss.insertSheet('⚙️ Retención'); F.RETENCION_INICIAL.forEach((r, i) => ret.getRange(i + 2, 1, 1, 4).setValues([r]));
const prov = ss.insertSheet('⚙️ Proveedores'); prov.getRange(1, 1, 1, 10).setValues([['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']]);
F.PROVEEDORES_INICIALES.forEach((r, i) => prov.getRange(i + 2, 1, 1, 10).setValues([r]));
ss.insertSheet('🤖 Registro automático');
const nov = ss.insertSheet('Noviembre 2026'); nov.getRange('C1').setValue('FACTURAS NOVIEMBRE');
props.ANTHROPIC_API_KEY = 'sk-ant-x';

ctx.procesarAhora();
console.log(env.enviados.alerts[0]);
const sinEtiqueta = hilosGmail.filter(h => !h.getLabels().some(l => /^Facturas\//.test(l.getName())));
console.log('\nCorreos sin etiqueta después de la corrida:', sinEtiqueta.length);
hilosGmail.slice(0, 10).forEach(h => console.log('-', h.getMessages()[0].getSubject().slice(0, 50), '→', h.getLabels().map(l => l.getName()).join(', ')));
const filas = nov.getRange(3, 2, nov.getLastRow() - 2, 2).getValues().map(r => r[1]);
console.log('\nRegistradas en Noviembre 2026:', filas.join(', '));
assert.equal(sinEtiqueta.length, 0, 'quedaron correos sin etiqueta');
['AFE818', 'ECR64923', 'FE6777', 'FE873', 'FE874', 'VB76108973', '2'].forEach(n => assert(filas.indexOf(n) >= 0, 'no se registró ' + n));
assert(filas.indexOf('FE868') < 0, 'reprocesó un correo ya etiquetado');
assert(/Revisar/.test(hilosGmail[7].getLabels()[0].getName()), 'el reenvío como adjunto no quedó en Revisar');
assert(/Revisar/.test(hilosGmail[8].getLabels()[0].getName()), 'el correo que falla no quedó en Revisar');
console.log('\n✓ Ningún correo quedó sin procesar ni sin etiqueta');
