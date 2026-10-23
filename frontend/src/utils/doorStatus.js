export function doorStatusView(report, elapsedMs = 0) {
  const fresh = report?.online === true && Number.isFinite(report.expires_in_ms)
    && report.expires_in_ms > Math.max(0, elapsedMs);
  const state = fresh && ['locked', 'unlocked'].includes(report.state) ? report.state : 'unknown';
  return {
    deviceId: report?.device_id ?? null,
    deviceName: report?.device_name || 'Door controller',
    state,
    label: state === 'locked' ? 'Locked' : state === 'unlocked' ? 'Unlocked' : 'Unavailable',
    canReadSensor: state === 'locked' && report.can_read_sensor === true,
    readBlockedReason: state === 'unlocked'
      ? 'The door is unlocked. Lock the door before reading sensor memory.'
      : state === 'unknown' ? 'Waiting for the controller to confirm the door is locked. Sensor reads are unavailable until then.' : '',
  };
}
