// Simulador mínimo de Apps Script (Sheets, Drive, Gmail, UrlFetch) para correr FacturasCompra.gs completo en Node.
'use strict';
const colNum = s => s.split('').reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0);
const isDate = v => Object.prototype.toString.call(v) === '[object Date]';

class Sheet {
  constructor(ss, name) { this.ss = ss; this.name = name; this.cells = {}; this.validations = {}; this.hidden = false; }
  key(r, c) { return r + ',' + c; }
  raw(r, c) { const x = this.cells[this.key(r, c)]; return x === undefined ? '' : x; }
  put(r, c, v) {
    const val = this.validations[this.key(r, c)];
    if (val && v !== '' && val.indexOf(v) < 0) throw new Error('Los datos que ingresaste en la celda ' + r + ',' + c + ' infringen las reglas de validación');
    this.cells[this.key(r, c)] = v;
  }
  evalCell(r, c, depth) {
    const v = this.raw(r, c);
    if (typeof v !== 'string' || v[0] !== '=') return v;
    if (depth > 20) throw new Error('ciclo');
    let e = v.slice(1).replace(/(\d+(?:\.\d+)?)%/g, '($1/100)').replace(/\b([A-Z]{1,2})(\d+)\b/g, (_, L, n) => {
      const x = this.evalCell(Number(n), colNum(L), depth + 1); return '(' + (Number(x) || 0) + ')';
    });
    if (/SUM/i.test(e)) return 0;
    // eslint-disable-next-line no-eval
    return eval(e);
  }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  getLastRow() { let m = 0; Object.keys(this.cells).forEach(k => { const [r, c] = k.split(',').map(Number); if (this.cells[k] !== '' && r > m) m = r; }); return m; }
  getMaxRows() { return Math.max(1000, this.getLastRow()); }
  getRange(a, b, nr, nc) {
    if (typeof a === 'string') {
      const m = a.match(/^([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/);
      const c1 = colNum(m[1]), r1 = Number(m[2] || 1), c2 = m[3] ? colNum(m[3]) : c1, r2 = m[4] ? Number(m[4]) : (m[2] ? r1 : 1000);
      return new Range(this, r1, c1, r2 - r1 + 1, c2 - c1 + 1);
    }
    return new Range(this, a, b, nr || 1, nc || 1);
  }
  getDataRange() { const lr = Math.max(1, this.getLastRow()); let lc = 1; Object.keys(this.cells).forEach(k => { const c = Number(k.split(',')[1]); if (c > lc) lc = c; }); return this.getRange(1, 1, lr, lc); }
  insertRowBefore(r) {
    const nc = {}; Object.keys(this.cells).forEach(k => { const [rr, c] = k.split(',').map(Number); nc[(rr >= r ? rr + 1 : rr) + ',' + c] = this.cells[k]; }); this.cells = nc; return this;
  }
  appendRow(vals) { const r = this.getLastRow() + 1; vals.forEach((v, i) => this.put(r, i + 1, typeof v === 'string' && v[0] === "'" ? v.slice(1) : v)); return this; }
  setFrozenRows() { return this; } autoResizeColumns() { return this; } setTabColor() { return this; }
  hideSheet() { this.hidden = true; return this; } showSheet() { this.hidden = false; return this; } isSheetHidden() { return this.hidden; }
  getIndex() { return this.ss.sheets.indexOf(this) + 1; }
  copyTo(ss) { const s = new Sheet(ss, 'Copia de ' + this.name); s.cells = Object.assign({}, this.cells); s.validations = Object.assign({}, this.validations); ss.sheets.push(s); return s; }
}

class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  each(fn) { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) fn(this.r + i, this.c + j, i, j); }
  getValues() { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.sh.evalCell(this.r + i, this.c + j, 0)); out.push(row); } return out; }
  getFormulas() { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) { const v = this.sh.raw(this.r + i, this.c + j); row.push(typeof v === 'string' && v[0] === '=' ? v : ''); } out.push(row); } return out; }
  getValue() { return this.sh.evalCell(this.r, this.c, 0); }
  setValues(v) { if (v.length !== this.nr || v[0].length !== this.nc) throw new Error('Tamaño de datos ' + v.length + 'x' + v[0].length + ' no coincide con el rango ' + this.nr + 'x' + this.nc); this.each((r, c, i, j) => this.sh.put(r, c, v[i][j])); return this; }
  setValue(v) { this.each((r, c) => this.sh.put(r, c, typeof v === 'string' && v[0] === "'" ? v.slice(1) : v)); return this; }
  setRichTextValue(rt) { this.each((r, c) => this.sh.put(r, c, rt.text)); this.sh.links = this.sh.links || {}; this.sh.links[this.r + ',' + this.c] = rt.link; return this; }
  clearContent() { this.each((r, c) => { delete this.sh.cells[r + ',' + c]; }); return this; }
  clearDataValidations() { this.each((r, c) => { delete this.sh.validations[r + ',' + c]; }); return this; }
  setDataValidation(v) { if (v && v.lista) this.each((r, c) => { this.sh.validations[r + ',' + c] = v.lista; }); return this; }
  copyTo(dest, tipo) { if (tipo === 'VALIDATION') for (let j = 0; j < this.nc; j++) { const v = this.sh.validations[this.r + ',' + (this.c + j)]; if (v) dest.sh.validations[dest.r + ',' + (dest.c + j)] = v; } return this; }
  setBackground() { return this; } setNumberFormat() { return this; } setFontWeight() { return this; } setNote() { return this; } setWrap() { return this; }
}

class Spreadsheet {
  constructor() { this.sheets = []; this.active = null; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  getSheets() { return this.sheets.slice(); }
  insertSheet(n) { const s = new Sheet(this, n); this.sheets.push(s); return s; }
  deleteSheet(s) { this.sheets.splice(this.sheets.indexOf(s), 1); }
  setActiveSheet(s) { this.active = s; return s; } getActiveSheet() { return this.active || this.sheets[0]; } moveActiveSheet() {}
  getId() { return 'SS'; } getUrl() { return 'https://docs.google.com/spreadsheets/d/SS'; }
}

// ---------- Drive
let idSeq = 0;
class Blob {
  constructor(bytes, name, mime) { this.bytes = bytes; this.name = name; this.mime = mime; }
  getName() { return this.name; } setName(n) { this.name = n; return this; }
  getBytes() { return this.bytes; } copyBlob() { return new Blob(this.bytes, this.name, this.mime); }
  setContentType(t) { this.mime = t; return this; } getDataAsString() { return String(this.bytes); }
}
class DFile {
  constructor(folder, blob, created) { this.id = 'F' + (++idSeq); this.folder = folder; this.name = blob.name; this.blob = blob; this.created = created || new Date(); }
  getName() { return this.name; } setName(n) { this.name = n; return this; }
  getBlob() { return new Blob(this.blob.bytes, this.name, this.blob.mime); }
  getMimeType() { return this.blob.mime; } getSize() { return String(this.blob.bytes).length; }
  getDateCreated() { return this.created; } getUrl() { return 'https://drive/' + this.id; } getId() { return this.id; }
  moveTo(f) { this.folder.files.splice(this.folder.files.indexOf(this), 1); f.files.push(this); this.folder = f; return this; }
  makeCopy(name, f) { const c = new DFile(f, new Blob(this.blob.bytes, name, this.blob.mime)); f.files.push(c); return c; }
  getParents() { return iter([this.folder]); }
}
class Folder {
  constructor(name, parent) { this.name = name; this.parent = parent; this.files = []; this.folders = []; this.id = 'D' + (++idSeq); }
  getName() { return this.name; } getUrl() { return 'https://drive/folder/' + this.id; }
  getFoldersByName(n) { return iter(this.folders.filter(f => f.name === n)); }
  createFolder(n) { const f = new Folder(n, this); this.folders.push(f); return f; }
  createFile(blob) { const f = new DFile(this, blob); this.files.push(f); return f; }
  getFiles() { return iter(this.files.slice()); }
  find(path) { return path.split('/').reduce((f, n) => f && f.folders.find(x => x.name === n), this); }
}
function iter(arr) { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; }

function crearEntorno(opts) {
  const ss = new Spreadsheet();
  const raiz = new Folder('Mi unidad', null);
  const carpetaHoja = raiz.createFolder('Contabilidad');
  const archivoHoja = new DFile(carpetaHoja, new Blob('', 'Control', 'sheet'));
  const props = {}; const enviados = { erp: [], mails: [], alerts: [] };
  const g = {
    console,
    SpreadsheetApp: {
      getActive: () => ss,
      getUi: () => ({ alert: m => enviados.alerts.push(m), createMenu: () => { const o = { addItem: () => o, addSeparator: () => o, addToUi: () => o }; return o; }, ButtonSet: {}, Button: {} }),
      newRichTextValue: () => { const b = { text: '', link: '', setText(t) { b.text = t; return b; }, setLinkUrl(l) { b.link = l; return b; }, build() { return { text: b.text, link: b.link }; } }; return b; },
      newDataValidation: () => { const b = { requireValueInRange() { return b; }, build() { return {}; } }; return b; },
      CopyPasteType: { PASTE_FORMAT: 'FORMAT', PASTE_DATA_VALIDATION: 'VALIDATION' },
    },
    DriveApp: {
      getFileById: () => archivoHoja,
      getFolderById: () => { throw new Error('no'); },
      getRootFolder: () => raiz,
    },
    GmailApp: { search: () => [], getUserLabelByName: () => null, createLabel: n => ({ n }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'facturacion@ejemplo.com' }) },
    MailApp: { sendEmail: m => enviados.mails.push(m) },
    ScriptApp: { getProjectTriggers: () => [], deleteTrigger: () => {}, newTrigger: () => null },
    Utilities: {
      formatDate: (d, tz, f) => {
        const b = new Date(d.getTime() - 5 * 3600e3); const p = n => String(n).padStart(2, '0');
        return f.replace('yyyy', b.getUTCFullYear()).replace('MM', p(b.getUTCMonth() + 1)).replace('dd', p(b.getUTCDate())).replace('HH', p(b.getUTCHours())).replace('mm', p(b.getUTCMinutes()));
      },
      base64Encode: () => 'BASE64', sleep: () => {}, unzip: b => (b.contenido || []),
    },
    UrlFetchApp: {
      fetch: (url, o) => {
        if (/anthropic/.test(url)) {
          const p = JSON.parse(o.payload);
          const texto = p.messages[0].content[1].text;
          const archivo = (texto.match(/Archivo: (.*)/) || [])[1] || '';
          const resp = opts.ia(archivo, p.tools[0].name);
          if (resp instanceof Error) return { getResponseCode: () => 400, getContentText: () => resp.message };
          return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ stop_reason: 'tool_use', content: [{ type: 'tool_use', input: resp }] }) };
        }
        if (/sync-facturas-compra/.test(url)) {
          const body = JSON.parse(o.payload); enviados.erp.push(body);
          return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ ok: true, filas: body.filas.length }) };
        }
        throw new Error('URL inesperada ' + url);
      },
    },
  };
  return { g, ss, raiz, carpetaHoja, props, enviados, Blob, DFile };
}

module.exports = { crearEntorno, Blob, DFile };
