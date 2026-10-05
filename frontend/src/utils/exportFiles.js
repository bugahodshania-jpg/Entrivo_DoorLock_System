export const PDF_PAGE_WIDTH = 841.89;
export const PDF_PAGE_HEIGHT = 595.28;

/** The built-in PDF fonts only cover Latin-1, so map common typographic characters and drop the rest. */
export function toPdfSafeText(value) {
  return String(value ?? '')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/[^\x00-\xFF]/g, '?');
}

export function escapePdfText(value) {
  return toPdfSafeText(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

export function wrapPdfText(value, fontSize, maxWidth) {
  const maxChars = Math.max(1, Math.floor(maxWidth / (fontSize * 0.5)));
  const words = String(value ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((word) => {
      if (word.length <= maxChars) {
        return [word];
      }

      const chunks = [];
      for (let index = 0; index < word.length; index += maxChars) {
        chunks.push(word.slice(index, index + maxChars));
      }
      return chunks;
    });
  const lines = [];
  let current = '';

  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length * fontSize * 0.5 <= maxWidth) {
      current = next;
      return;
    }

    if (current) {
      lines.push(current);
    }
    current = word;
  });

  if (current) {
    lines.push(current);
  }

  return lines.length > 0 ? lines : [''];
}

export function createPdfDrawing() {
  const commands = [];

  return {
    commands,
    fillRect(x, y, width, height, [red, green, blue]) {
      commands.push(`${red} ${green} ${blue} rg`, `${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re`, 'f');
    },
    strokeRect(x, y, width, height) {
      commands.push('0.90 0.93 0.91 RG', '0.6 w', `${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re`, 'S');
    },
    line(x1, y1, x2, y2, gray = '0.90 0.93 0.91') {
      commands.push(`${gray} RG`, '0.5 w', `${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l`, 'S');
    },
    text(value, x, y, font, size, [red, green, blue]) {
      commands.push('BT', `/${font} ${size} Tf`, `${red} ${green} ${blue} rg`, `1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm`, `(${escapePdfText(value)}) Tj`, 'ET');
    },
  };
}

/** Accepts one page of drawing commands, or an array of pages for a multi-page document. */
export function finishPdf(commandsOrPages) {
  const pages = Array.isArray(commandsOrPages[0]) ? commandsOrPages : [commandsOrPages];
  const pageObjectNumber = (index) => 5 + index * 2;
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    `2 0 obj\n<< /Type /Pages /Kids [${pages.map((_, index) => `${pageObjectNumber(index)} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj\n`,
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n',
  ];

  pages.forEach((commands, index) => {
    const pageNumber = pageObjectNumber(index);
    const stream = commands.join('\n');
    objects.push(
      `${pageNumber} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageNumber + 1} 0 R >>\nendobj\n`,
      `${pageNumber + 1} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`,
    );
  });
  let body = '%PDF-1.4\n';
  const offsets = [0];

  objects.forEach((object) => {
    offsets.push(body.length);
    body += object;
  });

  const xrefStart = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return body;
}

/**
 * Builds a paginated landscape table. Column widths are relative weights scaled to the page;
 * `emphasizeColumn` is the index of the column printed in bold (usually the name column).
 */
export function buildTablePdf({ title, note, columns, rows, emphasizeColumn = -1, emptyMessage = 'No records match the selected filters.' }) {
  const margin = 28;
  const fontSize = 8;
  const lineHeight = 10;
  const cellPadding = 5;
  const headerHeight = 20;
  const bottomLimit = 36;
  const tableWidth = PDF_PAGE_WIDTH - margin * 2;
  const dark = ['0.07', '0.15', '0.12'];
  const muted = ['0.36', '0.40', '0.45'];
  const body = ['0.25', '0.29', '0.33'];
  const totalWeight = columns.reduce((sum, column) => sum + (column.width || 1), 0);
  const widths = columns.map((column) => ((column.width || 1) / totalWeight) * tableWidth);
  const pages = [];
  let pdf;
  let y;

  const drawHeaderRow = () => {
    pdf.fillRect(margin, y - headerHeight, tableWidth, headerHeight, ['0.05', '0.29', '0.18']);
    let x = margin;
    columns.forEach((column, index) => {
      const label = wrapPdfText(column.label, fontSize, widths[index] - cellPadding * 2)[0];
      pdf.text(label, x + cellPadding, y - 13, 'F2', fontSize, ['1', '1', '1']);
      x += widths[index];
    });
    y -= headerHeight;
  };

  const startPage = () => {
    pdf = createPdfDrawing();
    pages.push(pdf);
    y = PDF_PAGE_HEIGHT - 36;

    if (pages.length === 1) {
      pdf.text(title, margin, y, 'F2', 16, dark);
      const noteLines = wrapPdfText(note, 9, tableWidth);
      noteLines.forEach((line, index) => {
        pdf.text(line, margin, y - 16 - index * 12, 'F1', 9, muted);
      });
      y -= 20 + noteLines.length * 12;
    } else {
      pdf.text(`${title} (continued)`, margin, y, 'F2', 11, dark);
      y -= 16;
    }

    drawHeaderRow();
  };

  startPage();

  if (rows.length === 0) {
    pdf.text(emptyMessage, margin + cellPadding, y - 16, 'F1', 9, muted);
  }

  rows.forEach((row, rowIndex) => {
    const cellLines = columns.map((_, columnIndex) =>
      wrapPdfText(row[columnIndex] ?? '', fontSize, widths[columnIndex] - cellPadding * 2),
    );
    const rowHeight = Math.max(...cellLines.map((lines) => lines.length)) * lineHeight + cellPadding * 2;

    if (y - rowHeight < bottomLimit) {
      startPage();
    }

    if (rowIndex % 2 === 1) {
      pdf.fillRect(margin, y - rowHeight, tableWidth, rowHeight, ['0.97', '0.98', '0.97']);
    }

    pdf.line(margin, y - rowHeight, PDF_PAGE_WIDTH - margin, y - rowHeight);

    let x = margin;
    cellLines.forEach((lines, columnIndex) => {
      const isEmphasized = columnIndex === emphasizeColumn;
      lines.forEach((line, lineIndex) => {
        pdf.text(
          line,
          x + cellPadding,
          y - cellPadding - fontSize - lineIndex * lineHeight + 1,
          isEmphasized ? 'F2' : 'F1',
          fontSize,
          isEmphasized ? dark : body,
        );
      });
      x += widths[columnIndex];
    });

    y -= rowHeight;
  });

  pages.forEach((page, index) => {
    const label = `Page ${index + 1} of ${pages.length}`;
    page.text(label, PDF_PAGE_WIDTH - margin - label.length * 4, 18, 'F1', 8, muted);
  });

  return finishPdf(pages.map((page) => page.commands));
}

export function downloadFile(content, mimeType, fileName) {
  // PDF text is Latin-1, one byte per character, so the stream lengths written in the file stay correct.
  const payload = mimeType === 'application/pdf'
    ? Uint8Array.from(content, (character) => character.charCodeAt(0) & 0xff)
    : content;
  const blob = new Blob([payload], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function escapeCsvValue(value) {
  const text = value == null ? '' : String(value);
  const escaped = text.replace(/"/g, '""');

  return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
}

export function toCsv(rows) {
  return rows.map((row) => row.map(escapeCsvValue).join(',')).join('\r\n');
}

/** One-line summary printed under a PDF title: count plus whichever filters are active. */
export function buildExportNote(count, noun, filters = []) {
  const generated = new Date().toLocaleString('en-US', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const countLabel = `${count} ${noun}${count === 1 ? '' : 's'}`;

  return [`Generated ${generated}`, countLabel, ...filters.filter(Boolean)].join(' | ');
}

/**
 * Downloads the same table as CSV or PDF. `fileBaseName` has no extension;
 * `pdf` supplies the title, note and column widths for the PDF version.
 */
export function exportTable(format, { headers, rows, fileBaseName, pdf }) {
  if (format === 'pdf') {
    const content = buildTablePdf({
      title: pdf.title,
      note: pdf.note,
      columns: headers.map((label, index) => ({ label, width: pdf.widths?.[index] })),
      rows,
      emphasizeColumn: pdf.emphasizeColumn,
      emptyMessage: pdf.emptyMessage,
    });
    downloadFile(content, 'application/pdf', `${fileBaseName}.pdf`);
    return;
  }

  downloadFile(`\uFEFF${toCsv([headers, ...rows])}`, 'text/csv;charset=utf-8;', `${fileBaseName}.csv`);
}
