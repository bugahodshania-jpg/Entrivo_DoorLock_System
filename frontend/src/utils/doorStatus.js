// received_at is Manila time from the backend; show it as sent, not re-zoned.
function reportTime(receivedAt) {
  const match = /(\d{2}):(\d{2}):(\d{2})/.exec(String(receivedAt ?? ''));
  if (!match) return '';
  const hour = Number(match[1]);
  return `${hour % 12 || 12}:${match[2]}:${match[3]} ${hour < 12 ? 'AM' : 'PM'}`;
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
    readBlockedReason: state === 'unlocked'
      ? 'The door is unlocked. Lock the door before reading sensor memory.'
      : state === 'unknown' ? 'Waiting for the controller to confirm the door is locked. Sensor reads are unavailable until then.' : '',
  };
}
