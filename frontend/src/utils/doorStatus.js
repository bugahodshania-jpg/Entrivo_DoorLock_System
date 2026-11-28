// received_at is Manila time from the backend; show it as sent, not re-zoned.
function reportTime(receivedAt) {
  const match = /(\d{2}):(\d{2}):(\d{2})/.exec(String(receivedAt ?? ''));
  if (!match) return '';
  const hour = Number(match[1]);
  return `${hour % 12 || 12}:${match[2]}:${match[3]} ${hour < 12 ? 'AM' : 'PM'}`;
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "2026-11-28 11:43:05" (Manila, as sent) -> "Nov 28, 11:43 AM".
function shortDateTime(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(value ?? ''));
  if (!match) return '';
  const hour = Number(match[4]);
  return `${SHORT_MONTHS[Number(match[2]) - 1]} ${Number(match[3])}, ${hour % 12 || 12}:${match[5]} ${hour < 12 ? 'AM' : 'PM'}`;
}

// The copy covers whole days up to midnight of valid_until, so its last day is the day before.
function lastCoveredDay(validUntil) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(validUntil ?? ''));
  if (!match) return '';
  const day = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) - 1));
  return `${SHORT_MONTHS[day.getUTCMonth()]} ${day.getUTCDate()}`;
}

// The offline schedule copy the door last reported.
//   status: 'unknown' (firmware does not report it), 'none', 'current', 'updating'.
function savedSchedulesView(saved) {
  if (!saved || saved.reported !== true) return { status: 'unknown', savedAt: '', lastDay: '' };
  if (!saved.version) return { status: 'none', savedAt: '', lastDay: '' };
  return {
    status: saved.up_to_date === false ? 'updating' : 'current',
    savedAt: shortDateTime(saved.saved_at),
    lastDay: lastCoveredDay(saved.valid_until),
  };
}

export function doorStatusView(report, elapsedMs = 0) {
  const fresh = report?.online === true && Number.isFinite(report.expires_in_ms)
    && report.expires_in_ms > Math.max(0, elapsedMs);
  const state = fresh && ['locked', 'unlocked'].includes(report.state) ? report.state : 'unknown';
  return {
    deviceId: report?.device_id ?? null,
    deviceName: report?.device_name || 'Door controller',
    state,
    label: state === 'locked' ? 'Locked' : state === 'unlocked' ? 'Unlocked' : 'Unavailable',
    // When the controller last confirmed this state.
    updatedAt: reportTime(report?.received_at),
    // Who unlocked the door (latest granted entry); only while it is unlocked.
    occupant: state === 'unlocked' && report.occupant && typeof report.occupant === 'object' ? report.occupant : null,
    canReadSensor: state === 'locked' && report.can_read_sensor === true,
    // Portal controls: scheduling mode (auto | on | off) and a remote
    // lock/unlock still waiting for the controller.
    scheduleMode: ['auto', 'on', 'off'].includes(report?.controls?.schedule_mode) ? report.controls.schedule_mode : 'auto',
    pendingCommand: report?.controls?.pending_command?.action || null,
    savedSchedules: savedSchedulesView(report?.saved_schedules),
    readBlockedReason: state === 'unlocked'
      ? 'The door is unlocked. Lock the door before reading sensor memory.'
      : state === 'unknown' ? 'Waiting for the controller to confirm the door is locked. Sensor reads are unavailable until then.' : '',
  };
}
