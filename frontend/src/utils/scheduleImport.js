// Turns spreadsheet rows into regular schedule requests for /api/schedules.php.

export const IMPORT_MAX_ROWS = 500;

// Header names accepted for each column (compared without case, spaces or punctuation).
const COLUMN_ALIASES = {
  user: ['user', 'idorusername', 'username', 'id', 'schoolid', 'employeeid', 'idnumber', 'userid'],
  date: ['date', 'scheduledate', 'startdate', 'from'],
  endDate: ['enddate', 'repeatuntil', 'until', 'to'],
  days: ['days', 'repeatdays', 'weekdays'],
  timeStart: ['timestart', 'starttime', 'start'],
  timeEnd: ['timeend', 'endtime', 'end'],
  grace: ['graceperiod', 'grace', 'graceperiodminutes', 'graceminutes'],
  status: ['status'],
};

export const IMPORT_COLUMNS = [
  { key: 'user', header: 'ID or Username', required: true, example: '2021-00123', help: 'The person’s School ID or Employee ID, or their portal username. The account must be active.' },
  { key: 'date', header: 'Date', required: true, example: '2026-11-24', help: 'The schedule date, e.g. 2026-11-24 or 11/24/2026. For a repeating schedule, the first date.' },
  { key: 'endDate', header: 'End date', required: false, example: '', help: 'Optional. Fill it in to repeat the schedule from Date up to this date.' },
  { key: 'days', header: 'Days', required: false, example: '', help: 'Optional, with End date. Days it repeats, e.g. Mon, Wed, Fri. Empty = every day.' },
  { key: 'timeStart', header: 'Time start', required: true, example: '8:00 AM', help: 'Start time, e.g. 8:00 AM or 08:00.' },
  { key: 'timeEnd', header: 'Time end', required: true, example: '10:00 AM', help: 'End time, after the start, e.g. 10:00 AM or 13:30.' },
  { key: 'grace', header: 'Grace period', required: false, example: '15', help: 'Optional. Minutes, 0 to 120. Empty = the default in Settings.' },
  { key: 'status', header: 'Status', required: false, example: 'Approved', help: 'Optional. Approved or Pending. Empty = Approved. Only approved schedules open the door.' },
];

export const IMPORT_TEMPLATE_ROWS = [
  IMPORT_COLUMNS.map((column) => column.header),
  ['2021-00123', '2026-11-24', '', '', '8:00 AM', '10:00 AM', '15', 'Approved'],
  ['juan.delacruz', '2026-11-23', '2026-12-18', 'Mon, Wed, Fri', '1:00 PM', '3:00 PM', '', 'Approved'],
];

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function key(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function excelSerialToDate(serial) {
  const ms = Math.round((Number(serial) - 25569) * 86400000);
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function validDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "YYYY-MM-DD", or null. Accepts Excel dates, 2026-11-24, 11/24/2026, Nov 24, 2026, 24 Nov 2026. */
export function parseImportDate(value) {
  if (typeof value === 'number') return value > 20000 && value < 80000 ? excelSerialToDate(Math.floor(value)) : null;
  const text = String(value ?? '').trim();
  if (!text) return null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
  if (m && validDate(+m[1], +m[2], +m[3])) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text);
  if (m && validDate(+m[3], +m[1], +m[2])) return `${m[3]}-${pad(m[1])}-${pad(m[2])}`;
  m = /^([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/i.exec(text);
  if (m && MONTHS.includes(m[1].toLowerCase()) && validDate(+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2])) {
    return `${m[3]}-${pad(MONTHS.indexOf(m[1].toLowerCase()) + 1)}-${pad(m[2])}`;
  }
  m = /^(\d{1,2})\s+([a-z]{3})[a-z]*\.?,?\s+(\d{4})$/i.exec(text);
  if (m && MONTHS.includes(m[2].toLowerCase()) && validDate(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1])) {
    return `${m[3]}-${pad(MONTHS.indexOf(m[2].toLowerCase()) + 1)}-${pad(m[1])}`;
  }
  return null;
}

/** "HH:MM", or null. Accepts Excel times, 8:00 AM, 8 AM, 08:00, 13:30. */
export function parseImportTime(value) {
  if (typeof value === 'number') {
    const fraction = value - Math.floor(value);
    const minutes = Math.round(fraction * 1440) % 1440;
    return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
  }
  const text = String(value ?? '').trim().toLowerCase().replace(/\./g, '');
  const m = /^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm|a|p)?$/.exec(text);
  if (!m) return null;
  let hours = Number(m[1]);
  const minutes = Number(m[2] || 0);
  const meridiem = m[3]?.[0];
  if (minutes > 59) return null;
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (meridiem === 'p' ? 12 : 0);
  } else if (hours > 23 || m[2] === undefined) {
    return null;
  }
  return `${pad(hours)}:${pad(minutes)}`;
}

function parseDays(value) {
  const text = String(value ?? '').trim();
  if (!text) return { days: [], error: null };
  const days = [];
  for (const part of text.split(/[\s,;/]+/).filter(Boolean)) {
    const index = DAY_NAMES.findIndex((day) => day.toLowerCase().startsWith(part.toLowerCase().slice(0, 3)) && part.length >= 2);
    if (index < 0) return { days: [], error: `“${part}” is not a day name.` };
    if (!days.includes(DAY_NAMES[index])) days.push(DAY_NAMES[index]);
  }
  return { days, error: null };
}

function findHeader(rows) {
  for (let r = 0; r < Math.min(rows.length, 10); r += 1) {
    const map = {};
    rows[r].forEach((cell, index) => {
      const name = key(cell);
      Object.entries(COLUMN_ALIASES).forEach(([column, aliases]) => {
        if (map[column] === undefined && aliases.includes(name)) map[column] = index;
      });
    });
    if (map.user !== undefined && map.date !== undefined && map.timeStart !== undefined && map.timeEnd !== undefined) {
      return { headerRow: r, map };
    }
  }
  return null;
}

function displayValue(value, parsed) {
  if (parsed) return parsed;
  return String(value ?? '').trim();
}

/**
 * Checks every row. users: the page's user list (id, username, identifier,
 * status, name). Returns { rows, error }; each row has errors[] and, when
 * valid, a payload for POST /api/schedules.php.
 */
export function buildScheduleImport(sheetRows, users, { defaultGrace = 15, actor = null } = {}) {
  const header = findHeader(sheetRows);
  if (!header) {
    return { rows: [], error: 'The first rows need the column headers ID or Username, Date, Time start and Time end. Download the template to see the layout.' };
  }
  const byIdentifier = new Map();
  const byUsername = new Map();
  users.forEach((user) => {
    if (user.identifier && user.identifier !== 'Not assigned') byIdentifier.set(key(user.identifier), user);
    if (user.username) byUsername.set(String(user.username).trim().toLowerCase(), user);
  });

  const dataRows = sheetRows.slice(header.headerRow + 1)
    .map((cells, index) => ({ cells, line: header.headerRow + index + 2 }))
    .filter(({ cells }) => cells.some((cell) => String(cell ?? '').trim() !== ''));
  if (dataRows.length === 0) return { rows: [], error: 'The sheet has headers but no schedule rows.' };
  if (dataRows.length > IMPORT_MAX_ROWS) {
    return { rows: [], error: `The sheet has ${dataRows.length} rows. Import at most ${IMPORT_MAX_ROWS} at a time.` };
  }

  const cell = (cells, column) => (header.map[column] === undefined ? '' : cells[header.map[column]]);
  const rows = dataRows.map(({ cells, line }) => {
    const errors = [];
    const userText = String(cell(cells, 'user') ?? '').trim();
    const user = byIdentifier.get(key(userText)) || byUsername.get(userText.toLowerCase());
    if (!userText) errors.push('ID or Username is empty.');
    else if (!user) errors.push(`No account has the ID or username “${userText}”.`);
    else if (user.status && user.status !== 'active') errors.push(`${user.name || user.username}’s account is not fully active (${user.status}).`);

    const date = parseImportDate(cell(cells, 'date'));
    if (!date) errors.push('Date is missing or not a date.');
    const endText = cell(cells, 'endDate');
    const endDate = String(endText ?? '').trim() === '' ? null : parseImportDate(endText);
    if (String(endText ?? '').trim() !== '' && !endDate) errors.push('End date is not a date.');
    if (date && endDate && endDate < date) errors.push('End date is before Date.');
    const { days, error: dayError } = parseDays(cell(cells, 'days'));
    if (dayError) errors.push(dayError);
    if (days.length && !endDate) errors.push('Days needs an End date.');

    const timeStart = parseImportTime(cell(cells, 'timeStart'));
    const timeEnd = parseImportTime(cell(cells, 'timeEnd'));
    if (!timeStart) errors.push('Time start is missing or not a time.');
    if (!timeEnd) errors.push('Time end is missing or not a time.');
    if (timeStart && timeEnd && timeEnd <= timeStart) errors.push('Time end must be after Time start.');

    const graceText = String(cell(cells, 'grace') ?? '').trim();
    const grace = graceText === '' ? defaultGrace : Number(graceText);
    if (!Number.isInteger(grace) || grace < 0 || grace > 120) errors.push('Grace period must be a whole number from 0 to 120.');

    const statusText = key(cell(cells, 'status'));
    const status = statusText === '' ? 'approved' : statusText;
    if (!['approved', 'pending'].includes(status)) errors.push('Status must be Approved or Pending.');

    const recurring = Boolean(endDate && endDate !== date);
    const payload = errors.length ? null : {
      userId: user.id,
      scheduleType: recurring ? 'recurring' : 'single',
      scheduleKind: 'regular',
      scheduleDate: recurring ? null : date,
      startDate: recurring ? date : null,
      endDate: recurring ? endDate : null,
      repeatType: recurring ? (days.length ? 'weekly_selected' : 'daily') : 'none',
      repeatDays: recurring && days.length ? days : null,
      timeStart,
      timeEnd,
      gracePeriodMinutes: grace,
      status,
      createdBy: actor?.id ?? null,
      approvedBy: status === 'approved' ? (actor?.id ?? null) : null,
    };
    return {
      line,
      user: user ? (user.name || user.username) : userText || '—',
      identifier: user?.identifier || userText,
      dateLabel: recurring
        ? `${date} to ${endDate}${days.length ? ` (${days.map((day) => day.slice(0, 3)).join(', ')})` : ' (every day)'}`
        : displayValue(cell(cells, 'date'), date),
      timeLabel: `${displayValue(cell(cells, 'timeStart'), timeStart)} – ${displayValue(cell(cells, 'timeEnd'), timeEnd)}`,
      status: status === 'pending' ? 'Pending' : 'Approved',
      errors,
      payload,
    };
  });
  return { rows, error: null };
}
