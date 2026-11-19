// The door controller plays its reminder (twice) this many minutes before a
// schedule ends, while the room is in use. Entering in the last 15 minutes
// plays no reminder. Matches REMINDER_LEAD_S in the door firmware.
export const REMINDER_LEAD_MINUTES = 15;

function toMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function formatMinutes(total) {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const suffix = hours >= 12 ? 'PM' : 'AM';
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

/**
 * When the 15-minute reminder plays for a schedule ("HH:MM[:SS]" times).
 * Returns { label, time } where time is null when there is no reminder.
 */
export function getScheduleReminder(timeStart, timeEnd) {
  const start = toMinutes(timeStart);
  const end = toMinutes(timeEnd);
  if (start === null || end === null || end <= start) return { label: '—', time: null };
  const at = end - REMINDER_LEAD_MINUTES;
  if (at <= start) return { label: 'None (15 minutes or shorter)', time: null };
  const time = formatMinutes(at);
  return { label: time, time };
}
