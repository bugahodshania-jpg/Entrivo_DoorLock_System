// received_at is Manila time from the backend; show it as sent, not re-zoned.
function reportTime(receivedAt) {
  const match = /(\d{2}):(\d{2}):(\d{2})/.exec(String(receivedAt ?? ''));
  if (!match) return '';
  const hour = Number(match[1]);
  return `${hour % 12 || 12}:${match[2]}:${match[3]} ${hour < 12 ? 'AM' : 'PM'}`;
}

// Below this the controller's link is unreliable (slow or dropped requests).
export const WEAK_WIFI_DBM = -70;

// connected / weak / offline. A stale or missing report means the controller
// is not reaching the backend, which is "not connected" from the portal's view.
// The WiFi icon has its own, shorter window (wifi_expires_in_ms, 20 s) than
// the door state (45 s); an older backend without it falls back to the door's.
function wifiFresh(report, doorFresh, elapsedMs) {
  if (!doorFresh) return false;
  if (!Number.isFinite(report?.wifi_expires_in_ms)) return true;
  return report.wifi_expires_in_ms > Math.max(0, elapsedMs);
}

function wifiStatus(fresh, rssi) {
  if (!fresh) return 'offline';
  return Number.isFinite(rssi) && rssi < WEAK_WIFI_DBM ? 'weak' : 'connected';
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
    wifi: wifiStatus(wifiFresh(report, fresh, elapsedMs), report?.wifi_rssi),
    wifiRssi: wifiFresh(report, fresh, elapsedMs) && Number.isFinite(report?.wifi_rssi) ? report.wifi_rssi : null,
    canReadSensor: state === 'locked' && report.can_read_sensor === true,
    readBlockedReason: state === 'unlocked'
      ? 'The door is unlocked. Lock the door before reading sensor memory.'
      : state === 'unknown' ? 'Waiting for the controller to confirm the door is locked. Sensor reads are unavailable until then.' : '',
  };
}
