import { createPdfDrawing, escapePdfText, finishPdf, wrapPdfText } from './exportFiles';

export const weekdayOptions = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function getScheduleTimeLabel(schedule) {
  if (schedule.timeStartLabel && schedule.timeEndLabel) {
    return `${schedule.timeStartLabel} - ${schedule.timeEndLabel}`;
  }

  return schedule.window || '';
}

export function formatScheduleStatusLabel(status) {
  const value = String(status || '').trim().toLowerCase();

  if (!value) {
    return 'Unknown';
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatScheduleKindLabel(kind) {
  return String(kind || '').toLowerCase() === 'override' ? 'Override' : 'Regular';
}

export function getScheduleKind(schedule) {
  return String(schedule?.scheduleKind || schedule?.schedule_kind || 'regular').toLowerCase() === 'override'
    ? 'override'
    : 'regular';
}

export const WEEK_SLOT_MINUTES = 30;
export const WEEK_SLOT_HEIGHT = 30;
export const WEEK_SLOT_COUNT = (24 * 60) / WEEK_SLOT_MINUTES;
export const WEEK_DEFAULT_SCROLL_MINUTES = 7 * 60;

export function toDateStamp(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function parseDateStamp(dateStr) {
  const [year, month, day] = String(dateStr || '').split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

export function getWeekStartStamp(dateStr) {
  const date = parseDateStamp(dateStr);
  const mondayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - mondayOffset);
  return toDateStamp(date);
}

export function shiftDateStamp(dateStr, dayDelta) {
  const date = parseDateStamp(dateStr);
  date.setDate(date.getDate() + dayDelta);
  return toDateStamp(date);
}

export function parseTimeToMinutes(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})/);

  if (!match) {
    return null;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

export function formatMinutesLabel(totalMinutes) {
  const hours24 = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;

  return `${hours12}:${String(minutes).padStart(2, '0')} ${hours24 < 12 ? 'AM' : 'PM'}`;
}

/** Places a day's schedules into side-by-side lanes so overlapping blocks never cover each other. */
export function layoutWeekDayEvents(entries) {
  const events = entries
    .map((schedule) => {
      const start = parseTimeToMinutes(schedule.timeStart);
      let end = parseTimeToMinutes(schedule.timeEnd);

      if (start === null) {
        return null;
      }

      if (end === null || end <= start) {
        end = Math.min(24 * 60, start + WEEK_SLOT_MINUTES);
      }

      return { schedule, start, end };
    })
    .filter(Boolean)
    .sort((left, right) => left.start - right.start || right.end - left.end);

  const positioned = [];
  let cluster = [];
  let clusterEnd = -1;

  const flushCluster = () => {
    const laneEnds = [];

    cluster.forEach((event) => {
      let lane = laneEnds.findIndex((laneEnd) => laneEnd <= event.start);

      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(event.end);
      } else {
        laneEnds[lane] = event.end;
      }

      event.lane = lane;
    });

    cluster.forEach((event) => positioned.push({ ...event, lanes: laneEnds.length }));
    cluster = [];
    clusterEnd = -1;
  };

  events.forEach((event) => {
    if (cluster.length > 0 && event.start >= clusterEnd) {
      flushCluster();
    }

    cluster.push(event);
    clusterEnd = Math.max(clusterEnd, event.end);
  });

  if (cluster.length > 0) {
    flushCluster();
  }

  return positioned;
}

export function getWeekEventTone(schedule) {
  if (['cancelled', 'expired'].includes(String(schedule.status || '').toLowerCase())) {
    return 'is-cancelled';
  }

  return getScheduleKind(schedule) === 'override' ? 'is-override' : 'is-regular';
}

export function buildCalendarPdf({ title, note, dayHeaders, cells }) {
  const pageWidth = 841.89;
  const pageHeight = 595.28;
  const margin = 28;
  const commands = [];
  const fillRect = (x, y, width, height, [red, green, blue]) => {
    commands.push(`${red} ${green} ${blue} rg`, `${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re`, 'f');
  };
  const strokeRect = (x, y, width, height) => {
    commands.push('0.90 0.93 0.91 RG', '0.6 w', `${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re`, 'S');
  };
  const drawText = (text, x, y, font, size, [red, green, blue]) => {
    commands.push('BT', `/${font} ${size} Tf`, `${red} ${green} ${blue} rg`, `1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm`, `(${escapePdfText(text)}) Tj`, 'ET');
  };

  drawText(title, margin, pageHeight - 36, 'F2', 16, ['0.07', '0.15', '0.12']);
  drawText(note, margin, pageHeight - 52, 'F1', 9, ['0.36', '0.40', '0.45']);

  const gridTop = pageHeight - 68;
  const gridBottom = 24;
  const gridWidth = pageWidth - margin * 2;
  const columnWidth = gridWidth / 7;
  const headerHeight = 18;
  const weekCount = Math.ceil(cells.length / 7);
  const rowHeight = (gridTop - gridBottom - headerHeight) / weekCount;
  const tones = {
    today: ['0.72', '0.85', '0.78'],
    past: ['0.95', '0.96', '0.95'],
    upcoming: ['1.00', '0.94', '0.82'],
  };

  dayHeaders.forEach((label, index) => {
    const x = margin + index * columnWidth;
    const y = gridTop - headerHeight;
    fillRect(x, y, columnWidth, headerHeight, ['1', '1', '1']);
    strokeRect(x, y, columnWidth, headerHeight);
    drawText(label, x + columnWidth / 2 - label.length * 2.2, y + 6, 'F2', 9, ['0.48', '0.53', '0.51']);
  });

  cells.forEach((cell, index) => {
    const column = index % 7;
    const row = Math.floor(index / 7);
    const x = margin + column * columnWidth;
    const y = gridTop - headerHeight - (row + 1) * rowHeight;
    fillRect(x, y, columnWidth, rowHeight, tones[cell?.tone] || ['1', '1', '1']);
    strokeRect(x, y, columnWidth, rowHeight);

    if (!cell) {
      return;
    }

    let textY = y + rowHeight - 14;
    drawText(String(cell.day), x + 6, textY, 'F2', 11, ['0.07', '0.15', '0.12']);
    textY -= 12;

    cell.events.forEach((eventLines) => {
      eventLines.forEach((line, lineIndex) => {
        wrapPdfText(line.text, line.size, columnWidth - 12).forEach((part) => {
          if (textY < y + 4) {
            return;
          }
          drawText(part, x + 6, textY, lineIndex === 0 ? 'F2' : 'F1', line.size, line.color);
          textY -= line.size + 1;
        });
      });
      textY -= 3;
    });
  });

  return finishPdf(commands);
}

export const WEEK_PDF_TONES = {
  'is-regular': ['0.18', '0.37', '0.18'],
  'is-override': ['0.65', '0.40', '0.10'],
  'is-cancelled': ['0.60', '0.65', '0.69'],
};

export function buildWeeklyPdf({ title, note, days }) {
  const pageWidth = 841.89;
  const pageHeight = 595.28;
  const margin = 28;
  const pdf = createPdfDrawing();
  const dark = ['0.07', '0.15', '0.12'];
  const muted = ['0.42', '0.46', '0.50'];
  const white = ['1', '1', '1'];
  const dayLayouts = days.map((day) => ({ ...day, events: layoutWeekDayEvents(day.entries) }));
  const allEvents = dayLayouts.flatMap((day) => day.events);

  const earliestPrintedHour = 6;
  let startHour = earliestPrintedHour;
  let endHour = 18;

  if (allEvents.length > 0) {
    startHour = Math.min(
      earliestPrintedHour,
      Math.max(0, Math.floor(Math.min(...allEvents.map((event) => event.start)) / 60)),
    );
    endHour = Math.min(24, Math.ceil(Math.max(...allEvents.map((event) => event.end)) / 60));
    endHour = Math.max(endHour, startHour + 4);
  }

  pdf.text(title, margin, pageHeight - 36, 'F2', 16, dark);
  pdf.text(note, margin, pageHeight - 52, 'F1', 9, ['0.36', '0.40', '0.45']);

  const gridTop = pageHeight - 68;
  const gridBottom = 24;
  const timeColumnWidth = 54;
  const headerHeight = 30;
  const dayWidth = (pageWidth - margin * 2 - timeColumnWidth) / 7;
  const bodyTop = gridTop - headerHeight;
  const slotCount = (endHour - startHour) * 2;
  const slotHeight = (bodyTop - gridBottom) / slotCount;
  const minutesToY = (minutes) => bodyTop - ((minutes - startHour * 60) / 30) * slotHeight;

  dayLayouts.forEach((day, index) => {
    const x = margin + timeColumnWidth + index * dayWidth;
    pdf.fillRect(x, bodyTop, dayWidth, headerHeight, day.isToday ? ['0.93', '0.96', '0.94'] : white);
    const color = day.isToday ? ['0.05', '0.29', '0.18'] : muted;
    pdf.text(day.weekdayLabel, x + dayWidth / 2 - day.weekdayLabel.length * 2.4, bodyTop + 18, 'F2', 8, color);
    const dayNumber = String(day.dayNumber);
    pdf.text(dayNumber, x + dayWidth / 2 - dayNumber.length * 3, bodyTop + 6, 'F2', 10, day.isToday ? color : dark);
  });

  for (let slot = 0; slot <= slotCount; slot += 1) {
    const y = bodyTop - slot * slotHeight;
    const minutes = startHour * 60 + slot * 30;
    pdf.line(margin + timeColumnWidth, y, pageWidth - margin, y, slot % 2 === 0 ? '0.84 0.88 0.86' : '0.93 0.95 0.94');

    if (slot < slotCount) {
      const label = formatMinutesLabel(minutes);
      pdf.text(label, margin + timeColumnWidth - 6 - label.length * 3.1, y - 3, 'F1', 6.5, muted);
    }
  }

  for (let column = 0; column <= 7; column += 1) {
    const x = margin + timeColumnWidth + column * dayWidth;
    pdf.line(x, gridTop, x, gridBottom, '0.84 0.88 0.86');
  }

  pdf.line(margin + timeColumnWidth, gridTop, pageWidth - margin, gridTop, '0.84 0.88 0.86');

  dayLayouts.forEach((day, index) => {
    const columnX = margin + timeColumnWidth + index * dayWidth;

    day.events.forEach(({ schedule, start, end, lane, lanes }) => {
      const visibleStart = Math.max(start, startHour * 60);
      const visibleEnd = Math.min(end, endHour * 60);
      const laneWidth = dayWidth / lanes;
      const x = columnX + lane * laneWidth + 1.5;
      const width = laneWidth - 3;
      const top = minutesToY(visibleStart) - 1;
      const bottom = minutesToY(visibleEnd) + 1;

      pdf.fillRect(x, bottom, width, top - bottom, WEEK_PDF_TONES[getWeekEventTone(schedule)]);

      const lines = [
        { text: schedule.ownerName, font: 'F2', size: 7 },
        { text: getScheduleTimeLabel(schedule) || `${formatMinutesLabel(start)} - ${formatMinutesLabel(end)}`, font: 'F1', size: 6 },
        { text: `${formatScheduleKindLabel(getScheduleKind(schedule))} - ${formatScheduleStatusLabel(schedule.status)}`, font: 'F1', size: 6 },
      ];
      let textY = top - 9;

      lines.forEach((line) => {
        wrapPdfText(line.text, line.size, width - 6).forEach((part) => {
          if (textY < bottom + 2) {
            return;
          }

          pdf.text(part, x + 3, textY, line.font, line.size, white);
          textY -= line.size + 2;
        });
      });
    });
  });

  return finishPdf(pdf.commands);
}

export function compareSchedulesChronologically(left, right) {
  const timeValue = (value) => parseTimeToMinutes(value) ?? Number.MAX_SAFE_INTEGER;

  return (
    String(left.scheduleDate || '').localeCompare(String(right.scheduleDate || '')) ||
    timeValue(left.timeStart) - timeValue(right.timeStart) ||
    timeValue(left.timeEnd) - timeValue(right.timeEnd) ||
    String(left.ownerName || '').localeCompare(String(right.ownerName || ''))
  );
}

export function buildScheduleCsv(schedules) {
  const headers = ['Date', 'Day', 'Start Time', 'End Time', 'User', 'Identifier', 'Type', 'Status', 'Schedule ID'];
  const rows = [...schedules].sort(compareSchedulesChronologically).map((schedule) => {
    const start = parseTimeToMinutes(schedule.timeStart);
    const end = parseTimeToMinutes(schedule.timeEnd);

    return [
      schedule.scheduleDate,
      weekdayOptions[(parseDateStamp(schedule.scheduleDate).getDay() + 6) % 7],
      schedule.timeStartLabel || (start !== null ? formatMinutesLabel(start) : ''),
      schedule.timeEndLabel || (end !== null ? formatMinutesLabel(end) : ''),
      schedule.ownerName,
      schedule.ownerIdentifier,
      formatScheduleKindLabel(getScheduleKind(schedule)),
      formatScheduleStatusLabel(schedule.status),
      schedule.id,
    ];
  });

  return [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
}
