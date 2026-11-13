import test from 'node:test';
import assert from 'node:assert/strict';
import { doorStatusView } from '../src/utils/doorStatus.js';

const report = (state = 'locked') => ({
  device_id: 1, device_name: 'Enrollment Station', state, online: true,
  can_read_sensor: state === 'locked', expires_in_ms: 15000,
});

test('only a recent explicitly confirmed locked state enables reads', () => {
  assert.equal(doorStatusView(report(), 14999).canReadSensor, true);
  const unlocked = doorStatusView(report('unlocked'));
  assert.equal(unlocked.label, 'Unlocked');
  assert.equal(unlocked.canReadSensor, false);
  assert.match(unlocked.readBlockedReason, /Lock the door/);
  assert.equal(doorStatusView({ ...report(), can_read_sensor: false }).canReadSensor, false);
});

test('expiry, a missing report, and offline status never show a locked door', () => {
  for (const result of [doorStatusView(report(), 15000), doorStatusView(null),
    doorStatusView({ ...report(), online: false }), doorStatusView({ ...report(), expires_in_ms: undefined }),
    doorStatusView({ ...report(), state: 'invalid' })]) {
    assert.equal(result.label, 'Unavailable');
    assert.equal(result.canReadSensor, false);
  }
});

test('elapsed time includes time spent fetching a snapshot', () => {
  const result = doorStatusView({ ...report(), expires_in_ms: 250 }, 300);
  assert.equal(result.canReadSensor, false);
  assert.equal(result.state, 'unknown');
});

test('the time of the last controller report is shown as Manila time, without re-zoning', () => {
  const at = (received_at) => doorStatusView({ ...report(), received_at }).updatedAt;
  assert.equal(at('2026-11-11 22:08:29.343000'), '10:08:29 PM');
  assert.equal(at('2026-11-11 00:05:01'), '12:05:01 AM');
  assert.equal(at('2026-11-11 12:00:00'), '12:00:00 PM');
  assert.equal(at(null), '');
  assert.equal(doorStatusView(null).updatedAt, '');
});

test('the door controller WiFi icon is connected, weak or offline', () => {
  const wifi = (rssi, overrides = {}) => doorStatusView({ ...report(), wifi_rssi: rssi, ...overrides });
  assert.equal(wifi(-55).wifi, 'connected');
  assert.equal(wifi(-55).wifiRssi, -55);
  assert.equal(wifi(-70).wifi, 'connected');
  assert.equal(wifi(-71).wifi, 'weak');
  assert.equal(wifi(null).wifi, 'connected', 'older firmware sends no strength: reporting means connected');
  assert.equal(wifi(-55, { online: false }).wifi, 'offline');
  assert.equal(doorStatusView({ ...report(), wifi_rssi: -55 }, 20000).wifi, 'offline', 'an expired report is offline');
  assert.equal(doorStatusView(null).wifi, 'offline');
  assert.equal(doorStatusView(null).wifiRssi, null);
});

test('the WiFi icon goes not connected after its own 20 s window, while the door state keeps 45 s', () => {
  const door = { ...report(), wifi_rssi: -55, expires_in_ms: 25000, wifi_expires_in_ms: 1000 };
  assert.equal(doorStatusView(door, 500).wifi, 'connected');
  const later = doorStatusView(door, 2000);
  assert.equal(later.wifi, 'offline', 'the WiFi window has passed');
  assert.equal(later.wifiRssi, null);
  assert.equal(later.state, 'locked', 'the door state is still within its own window');
});
