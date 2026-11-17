/**
 * importExcel — reads the first sheet of an .xlsx (or a .csv) in the browser.
 * No library needed: the ZIP is unpacked with the built-in DecompressionStream.
 *
 *   const { header, rows } = await readSheet(file)
 *     header : ['EG ID', 'company', …]          (first row with 2+ filled cells)
 *     rows   : [['EG.ID 041', 'Pidilite', …], …]  (blank rows dropped; numbers stay numbers)
 */

const u16 = (v, o) => v.getUint16(o, true);
const u32 = (v, o) => v.getUint32(o, true);

async function inflate(bytes, method) {
  if (method === 0) return bytes;
  if (method !== 8) throw new Error('Unsupported compression in this Excel file');
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot read .xlsx — use Chrome/Edge, or save the file as .csv');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** name → { method, data(compressed) } for every entry of the ZIP */
function zipEntries(buf) {
  const v = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) {
    if (u32(v, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid .xlsx file');
  const count = u16(v, eocd + 10);
  let p = u32(v, eocd + 16);
  const dec = new TextDecoder();
  const out = {};
  for (let n = 0; n < count; n++) {
    if (u32(v, p) !== 0x02014b50) break;
    const method = u16(v, p + 10), comp = u32(v, p + 20);
    const nameLen = u16(v, p + 28), extraLen = u16(v, p + 30), commLen = u16(v, p + 32);
    const local = u32(v, p + 42);
    const name = dec.decode(new Uint8Array(buf, p + 46, nameLen));
    const start = local + 30 + u16(v, local + 26) + u16(v, local + 28);
    out[name] = { method, data: new Uint8Array(buf, start, comp) };
    p += 46 + nameLen + extraLen + commLen;
  }
  return out;
}

const xml = s => new DOMParser().parseFromString(s, 'application/xml');
const all = (node, tag) => Array.from(node.getElementsByTagNameNS('*', tag));
const colIdx = ref => {
  const letters = String(ref).replace(/[^A-Z]/gi, '').toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

async function readXlsx(buf) {
  const z = zipEntries(buf);
  const text = async name => {
    const e = z[name] || z[Object.keys(z).find(k => k.toLowerCase() === name.toLowerCase())];
    return e ? new TextDecoder().decode(await inflate(e.data, e.method)) : null;
  };

  // First sheet's file, via workbook.xml + its rels
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = await text('xl/workbook.xml');
  const rels = await text('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const first = all(xml(wb), 'sheet')[0];
    const rid = first?.getAttribute('r:id') || first?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const rel = all(xml(rels), 'Relationship').find(r => r.getAttribute('Id') === rid);
    if (rel) {
      const t = rel.getAttribute('Target');
      sheetPath = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
    }
  }

  const shared = [];
  const ss = await text('xl/sharedStrings.xml');
  if (ss) {
    for (const si of all(xml(ss), 'si')) {
      shared.push(all(si, 't').filter(t => t.parentNode?.localName !== 'rPh').map(t => t.textContent).join(''));
    }
  }

  const sheet = await text(sheetPath);
  if (!sheet) throw new Error('No worksheet found in this file');
  const grid = [];
  for (const row of all(xml(sheet), 'row')) {
    const r = [];
    let next = 0;
    for (const c of all(row, 'c')) {
      const ref = c.getAttribute('r');
      const i = ref ? colIdx(ref) : next;
      next = i + 1;
      const t = c.getAttribute('t');
      const v = all(c, 'v')[0]?.textContent;
      let val = '';
      if (t === 's') val = shared[Number(v)] ?? '';
      else if (t === 'inlineStr') val = all(c, 't').map(x => x.textContent).join('');
      else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
      else if (t === 'str' || t === 'e') val = v ?? '';
      else if (v != null && v !== '') val = Number(v);
      r[i] = val;
    }
    grid.push(Array.from(r, x => x ?? ''));
  }
  return grid;
}

function readCsv(textIn) {
  const text = textIn.replace(/^﻿/, '');
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const filled = v => String(v ?? '').trim() !== '';

export async function readSheet(file) {
  const name = (file?.name || '').toLowerCase();
  let grid;
  if (name.endsWith('.csv')) grid = readCsv(await file.text());
  else if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) grid = await readXlsx(await file.arrayBuffer());
  else throw new Error('Upload an .xlsx or .csv file (old .xls is not supported — re-save as .xlsx)');

  const h = grid.findIndex(r => r.filter(filled).length >= 2);
  if (h < 0) return { header: [], rows: [] };
  const header = grid[h].map(x => String(x ?? '').trim());
  const rows = grid.slice(h + 1).filter(r => r.some(filled));
  return { header, rows };
}

/** Excel serial / dd-mm-yyyy / yyyy-mm-dd / "12 Nov 2026" → 'YYYY-MM-DD'; '' if blank; null if unreadable */
export function toISODate(v) {
  if (v == null || String(v).trim() === '') return '';
  const p = n => String(n).padStart(2, '0');
  if (typeof v === 'number' || /^\d{4,5}(\.\d+)?$/.test(String(v).trim())) {
    const d = new Date(Math.round((Number(v) - 25569) * 86400000));
    return isNaN(d) ? null : `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${p(m[2])}-${p(m[3])}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);       // Indian order: day first
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    if (+m[2] > 12 || +m[1] > 31) return null;
    return `${y}-${p(m[2])}-${p(m[1])}`;
  }
  const d = new Date(s);
  return isNaN(d) ? null : `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
