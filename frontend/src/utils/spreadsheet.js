// Minimal spreadsheet reading (.xlsx first sheet, .csv) and .xlsx writing,
// without a third-party library. Cells come back as strings or numbers;
// Excel stores dates and times as numbers (days since 1899-12-30).

const textDecoder = new TextDecoder('utf-8');

function u16(view, offset) { return view.getUint16(offset, true); }
function u32(view, offset) { return view.getUint32(offset, true); }

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot open Excel files. Update the browser, or save the sheet as CSV and import that.');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Reads a ZIP archive: { [path]: () => Promise<string> }. */
function readZip(buffer) {
  const view = new DataView(buffer);
  let end = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i -= 1) {
    if (u32(view, i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('This file is not a valid .xlsx workbook.');
  const count = u16(view, end + 10);
  let offset = u32(view, end + 16);
  const entries = {};
  for (let n = 0; n < count; n += 1) {
    if (u32(view, offset) !== 0x02014b50) throw new Error('This .xlsx workbook is damaged.');
    const method = u16(view, offset + 10);
    const compressedSize = u32(view, offset + 20);
    const nameLength = u16(view, offset + 28);
    const extraLength = u16(view, offset + 30);
    const commentLength = u16(view, offset + 32);
    const localOffset = u32(view, offset + 42);
    const name = textDecoder.decode(new Uint8Array(buffer, offset + 46, nameLength));
    entries[name] = async () => {
      const dataStart = localOffset + 30 + u16(view, localOffset + 26) + u16(view, localOffset + 28);
      const data = new Uint8Array(buffer, dataStart, compressedSize);
      if (method === 0) return textDecoder.decode(data);
      if (method === 8) return textDecoder.decode(await inflateRaw(data));
      throw new Error('This .xlsx workbook uses an unsupported compression.');
    };
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function parseXml(text) {
  return new DOMParser().parseFromString(text, 'application/xml');
}

function byTag(node, tag) {
  return Array.from(node.getElementsByTagNameNS('*', tag));
}

function columnIndex(ref) {
  const letters = /^[A-Z]+/.exec(ref || '')?.[0] || 'A';
  return [...letters].reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

async function readXlsx(buffer) {
  const zip = readZip(buffer);
  const read = async (path) => (zip[path] ? zip[path]() : null);

  // First sheet, in workbook order.
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const workbook = await read('xl/workbook.xml');
  const rels = await read('xl/_rels/workbook.xml.rels');
  if (workbook && rels) {
    const firstSheet = byTag(parseXml(workbook), 'sheet')[0];
    const relId = firstSheet?.getAttribute('r:id')
      || firstSheet?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const target = byTag(parseXml(rels), 'Relationship').find((rel) => rel.getAttribute('Id') === relId)?.getAttribute('Target');
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  }
  const sheet = await read(sheetPath);
  if (!sheet) throw new Error('The workbook has no sheet to import.');

  const sharedText = await read('xl/sharedStrings.xml');
  const shared = sharedText
    ? byTag(parseXml(sharedText), 'si').map((si) => byTag(si, 't').map((t) => t.textContent).join(''))
    : [];

  return byTag(parseXml(sheet), 'row').map((row) => {
    const values = [];
    byTag(row, 'c').forEach((cell) => {
      const type = cell.getAttribute('t');
      const raw = byTag(cell, 'v')[0]?.textContent ?? '';
      let value;
      if (type === 's') value = shared[Number(raw)] ?? '';
      else if (type === 'inlineStr') value = byTag(cell, 't').map((t) => t.textContent).join('');
      else if (type === 'str' || type === 'e') value = raw;
      else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
      else value = raw === '' ? '' : Number(raw);
      values[columnIndex(cell.getAttribute('r'))] = value;
    });
    return Array.from(values, (value) => value ?? '');
  });
}

function readCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const source = text.replace(/^﻿/, '');
  const delimiter = (source.split('\n')[0].match(/;/g) || []).length > (source.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += char;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Rows of the first sheet as arrays of cell values. */
export async function readSpreadsheet(file) {
  const name = String(file?.name || '').toLowerCase();
  if (name.endsWith('.csv')) return readCsv(await file.text());
  if (name.endsWith('.xlsx')) return readXlsx(await file.arrayBuffer());
  if (name.endsWith('.xls')) throw new Error('Old .xls files cannot be read. In Excel, choose File > Save As > Excel Workbook (.xlsx).');
  throw new Error('Choose an Excel workbook (.xlsx) or a CSV file.');
}

// ── writing a small .xlsx (stored, uncompressed) ──────────────────────────

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStored(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  files.forEach(({ name, content }) => {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(8, 0, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    chunks.push(new Uint8Array(local.buffer), nameBytes, data);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, nameBytes.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  });
  const centralSize = central.reduce((total, part) => total + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function escapeXml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** A one-sheet .xlsx of text cells; the first row is bold. */
export function createXlsx(rows, { sheetName = 'Sheet1', columnWidths = [] } = {}) {
  const letter = (index) => {
    let name = '';
    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
    return name;
  };
  const cols = columnWidths.length
    ? `<cols>${columnWidths.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>`
    : '';
  const sheetRows = rows.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => (
    `<c r="${letter(c)}${r + 1}" t="inlineStr"${r === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`
  )).join('')}</row>`).join('');
  return zipStored([
    { name: '[Content_Types].xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name: '_rels/.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'xl/styles.xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>' },
    { name: 'xl/worksheets/sheet1.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${sheetRows}</sheetData></worksheet>` },
  ]);
}
