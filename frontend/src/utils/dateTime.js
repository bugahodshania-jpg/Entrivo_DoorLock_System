export const MANILA_TIME_ZONE = 'Asia/Manila';

function toDateValue(value) {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  }

  return parseManilaDateTime(value);
}

/**
 * Parse MySQL DATETIME / timestamps as Asia/Manila wall clock when no TZ is present.
 */
export function parseManilaDateTime(value) {
  if (value instanceof Date) {
    return value;
  }

  if (value == null || value === '') {
    return new Date(Number.NaN);
  }

  if (typeof value === 'number') {
    return new Date(value);
  }

  const raw = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  }

  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(normalized);

  if (!hasZone && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(normalized)) {
    return new Date(`${normalized}+08:00`);
  }

  return new Date(normalized);
}

export function formatDateInManila(value, options, locale = 'en-US') {
  return new Intl.DateTimeFormat(locale, {
    timeZone: MANILA_TIME_ZONE,
    ...options,
  }).format(toDateValue(value));
}

export function formatDateTimeInManila(value, locale = 'en-US') {
  if (value == null || value === '') {
    return '—';
  }

  const parsed = parseManilaDateTime(value);

  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }

  return formatDateInManila(
    parsed,
    {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    },
    locale
  );
}

export function getManilaDateStamp(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MANILA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(toDateValue(value));

  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '00';
  const day = parts.find((part) => part.type === 'day')?.value ?? '00';

  return `${year}-${month}-${day}`;
}

export function getManilaDateTimeStamp(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MANILA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(toDateValue(value));

  const lookup = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const hour = lookup.hour === '24' ? '00' : lookup.hour;

  return `${lookup.year}-${lookup.month}-${lookup.day} ${hour}:${lookup.minute}:${lookup.second}`;
}
