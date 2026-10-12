/**
 * exportExcel — builds a real .xlsx file in the browser and downloads it.
 * No library needed: the workbook XML is packed into an uncompressed ZIP.
 *
 *   downloadXlsx({ filename: 'BD Tracker', sheetName: 'BD', columns, rows })
 *     columns : [{ label: 'Client Name', get: r => r.clientName }]   (or { label, key })
 *     rows    : array of objects
 *
 *   autoColumns(rows, { exclude, labels, order }) → columns built from the row keys
 */

// ── helpers ────────────────────────────────────────────────────────────────
const esc = s => String(s)
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function colName(i) {           // 0 → A, 26 → AA
  let s = ''; i += 1;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

// Turn any cell value into plain text / number
export function cellValue(v) {
  if (v == null) return '';
  if (Array.isArray(v)) {
    return v.map(x => (x && typeof x === 'object')
      ? [x.done ? '✔' : '', x.title || x.label || x.name || '', x.deadline ? `(due ${x.deadline})` : '', x.link || '']
          .filter(Boolean).join(' ')
      : String(x)).join('\n');
  }
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

// camelCase → "Camel Case"
const ACRONYMS = { Poc: 'POC', Spoc: 'SPOC', Eg: 'EG', Ev: 'EV', Pm: 'PM', Nps: 'NPS', Gst: 'GST', Id: 'ID', Sno: 'S No', Pax: 'Pax' };
const titleCase = k => String(k)
  .replace(/^_+/, '')
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/([a-zA-Z])(\d)/g, '$1 $2')
  .replace(/\b\w/g, c => c.toUpperCase())
  .replace(/\b[A-Z][a-z]+\b/g, w => ACRONYMS[w] || w);

export function autoColumns(rows, { exclude = [], labels = {}, order = [] } = {}) {
  const skip = new Set(['id', ...exclude]);
  const keys = [];
  (rows || []).forEach(r => Object.keys(r || {}).forEach(k => {
    if (!skip.has(k) && !k.startsWith('_') && !keys.includes(k)) keys.push(k);
  }));
  keys.sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });
  return keys.map(k => ({ label: labels[k] || titleCase(k), key: k }));
}

// ── sheet XML ──────────────────────────────────────────────────────────────
function sheetXml(columns, rows) {
  const cell = (ref, v, style) => {
    const val = cellValue(v);
    if (typeof val === 'number' && isFinite(val)) return `<c r="${ref}"${style}><v>${val}</v></c>`;
    const s = String(val);
    if (s === '') return '';
    return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${esc(s)}</t></is></c>`;
  };
  const head = `<row r="1">${columns.map((c, i) => cell(`${colName(i)}1`, c.label, ' s="1"')).join('')}</row>`;
  const body = rows.map((r, ri) => {
    const n = ri + 2;
    return `<row r="${n}">${columns.map((c, ci) => {
      let v;
      try { v = c.get ? c.get(r) : r[c.key]; } catch { v = ''; }
      return cell(`${colName(ci)}${n}`, v, ' s="2"');
    }).join('')}</row>`;
  }).join('');
  const widths = columns.map((c, i) => {
    let w = String(c.label).length;
    rows.slice(0, 300).forEach(r => {
      let v; try { v = c.get ? c.get(r) : r[c.key]; } catch { v = ''; }
      const longest = String(cellValue(v)).split('\n').reduce((m, l) => Math.max(m, l.length), 0);
      w = Math.max(w, longest);
    });
    return `<col min="${i + 1}" max="${i + 1}" width="${Math.min(Math.max(w + 2, 8), 60)}" customWidth="1"/>`;
  }).join('');
  const last = `${colName(Math.max(columns.length - 1, 0))}${rows.length + 1}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${widths}</cols>
<sheetData>${head}${body}</sheetData>
<autoFilter ref="A1:${last}"/>
</worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F3A5F"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

// ── tiny ZIP writer (store, no compression) ────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function zip(files) {
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = []; const central = []; let offset = 0;
  files.forEach(({ name, data }) => {
    const nameB = enc.encode(name);
    const dataB = typeof data === 'string' ? enc.encode(data) : data;
    const crc = crc32(dataB);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, 0, true); lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, dataB.length, true); lh.setUint32(22, dataB.length, true);
    lh.setUint16(26, nameB.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), nameB, dataB);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, dosTime, true);
    ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true); ch.setUint32(20, dataB.length, true);
    ch.setUint32(24, dataB.length, true); ch.setUint16(28, nameB.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nameB);
    offset += 30 + nameB.length + dataB.length;
  });
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function buildXlsx({ sheetName = 'Sheet1', columns, rows }) {
  const sheet = esc(String(sheetName).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1');
  return zip([
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${sheet}" sheetId="1" r:id="rId1"/></sheets>
<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${sheet}'!$A$1:$${colName(Math.max(columns.length - 1, 0))}$${rows.length + 1}</definedName></definedNames>
</workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>` },
    { name: 'xl/styles.xml', data: STYLES },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml(columns, rows) },
  ]);
}

export function downloadXlsx({ filename = 'Export', sheetName, columns, rows }) {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const blob = buildXlsx({ sheetName: sheetName || filename, columns, rows });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename} ${stamp}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
