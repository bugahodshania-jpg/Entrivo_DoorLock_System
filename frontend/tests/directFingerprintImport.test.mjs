import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getDirectImportBlockReason,
  getDirectImportFormResetDelay,
  getDirectImportJobPresentation,
  getDirectImportPickupRemainingSeconds,
  getDirectImportRetryTarget,
  isDirectImportJobActive,
} from '../src/utils/directFingerprintImport.js';

const activeUser = { user_id: 12, status: 'active', approval_status: 'approved' };
const backup = { fingerprint_id: 17, template_bytes: 512, can_import: true };

test('only an active approved owner and a valid saved fingerprint can be selected for import', () => {
  assert.equal(getDirectImportBlockReason(activeUser, backup), '');
  assert.match(getDirectImportBlockReason(null, backup), /Search for an employee/);
  assert.match(getDirectImportBlockReason({ ...activeUser, status: 'inactive' }, backup), /account is inactive/);
  assert.match(getDirectImportBlockReason({ ...activeUser, approval_status: 'pending' }, backup), /not been approved/);
  assert.match(getDirectImportBlockReason(activeUser, { ...backup, template_bytes: 0 }), /valid saved backup/);
  assert.match(getDirectImportBlockReason(activeUser, { ...backup, fingerprint_id: -1 }), /valid saved backup/);
  assert.equal(getDirectImportBlockReason(activeUser, { ...backup, can_import: false, unavailable_reason: 'Backup is damaged.' }), 'Backup is damaged.');
});

test('saved backups accept complete supported sensor template sizes', () => {
  for (const templateBytes of [512, '512', 768, '768', 1024, '1024', 1536, '1536']) {
    assert.equal(getDirectImportBlockReason(activeUser, { ...backup, template_bytes: templateBytes }), '');
  }
  for (const templateBytes of [undefined, null, '', 0, 128, 256, 511, 513, 640, 767, 769, 1023, 1025, 1535, 1537, 2048, Number.NaN]) {
    assert.match(getDirectImportBlockReason(activeUser, { ...backup, template_bytes: templateBytes }), /valid saved backup/);
  }
  assert.equal(getDirectImportBlockReason(activeUser, { ...backup, template_bytes: 1024, can_import: false, unavailable_reason: 'Backup hash does not match.' }), 'Backup hash does not match.');
});

test('writing at 100 percent is still waiting for confirmed device completion', () => {
  const writing = { status: 'processing', progress: 100 };
  const display = getDirectImportJobPresentation(writing);
  assert.equal(isDirectImportJobActive(writing), true);
  assert.equal(display.title, 'Writing to Sensor A');
  assert.equal(display.progress, 99);
  assert.equal(display.tone, 'processing');
});

test('only completed status reports the confirmed local slot and successful import', () => {
  const completed = { status: 'completed', progress: 95, assigned_slot: 31 };
  assert.equal(isDirectImportJobActive(completed), false);
  assert.equal(getDirectImportJobPresentation(completed).progress, 100);
  assert.match(getDirectImportJobPresentation(completed).detail, /Sensor A confirmed.*slot 31/);
});

test('server timeout and device failure reasons remain visible and polling stops', () => {
  const reason = 'Sensor A did not pick up this import within 3 minutes. Check its connection.';
  for (const status of ['failed', 'cancelled']) {
    const job = { status, error_message: reason, progress: 20 };
    assert.equal(isDirectImportJobActive(job), false);
    assert.equal(getDirectImportJobPresentation(job).detail, reason);
    assert.equal(getDirectImportJobPresentation(job).tone, 'failed');
  }
  assert.equal(isDirectImportJobActive({ status: 'pending' }), true);
});

test('waiting for Sensor A explains automatic cancellation even when the server provides a current step', () => {
  const display = getDirectImportJobPresentation({ status: 'pending', current_step: 'Waiting for Sensor A' });
  assert.match(display.detail, /automatically cancelled.*within 3 minutes/);
});

test('the import countdown reaches zero at three minutes using the Manila queue timestamp', () => {
  const job = { status: 'pending', queued_at: '2026-10-21 10:00:00' };
  assert.equal(getDirectImportPickupRemainingSeconds(job, Date.parse('2026-10-21T02:00:00Z')), 180);
  assert.equal(getDirectImportPickupRemainingSeconds(job, Date.parse('2026-10-21T02:02:59Z')), 1);
  assert.equal(getDirectImportPickupRemainingSeconds(job, Date.parse('2026-10-21T02:02:59.999Z')), 1);
  assert.equal(getDirectImportPickupRemainingSeconds(job, Date.parse('2026-10-21T02:03:00Z')), 0);
  assert.equal(getDirectImportPickupRemainingSeconds(job, Date.parse('2026-10-21T02:04:00Z')), 0);
  assert.equal(getDirectImportPickupRemainingSeconds(job, Date.parse('2026-10-21T01:59:00Z')), 180);
});

test('reopening the import keeps its deadline while retrying starts a fresh wait', () => {
  const job = { status: 'pending', queued_at: '2026-10-21 10:00:00' };
  const now = Date.parse('2026-10-21T02:02:00Z');
  assert.equal(getDirectImportPickupRemainingSeconds({ ...job }, now), 60);
  assert.equal(getDirectImportPickupRemainingSeconds({ ...job, queued_at: '2026-10-21 10:02:00' }, now), 180);
});

test('claimed, finished, and unloaded imports have no pickup countdown', () => {
  const now = Date.parse('2026-10-21T02:01:00Z');
  for (const status of ['processing', 'completed', 'failed', 'cancelled']) {
    assert.equal(getDirectImportPickupRemainingSeconds({ status, queued_at: '2026-10-21 10:00:00' }, now), null);
  }
  assert.equal(getDirectImportPickupRemainingSeconds({ status: 'pending' }, now), null);
  assert.equal(getDirectImportPickupRemainingSeconds({ status: 'pending', queued_at: 'invalid' }, now), null);
  assert.equal(getDirectImportPickupRemainingSeconds({ status: 'pending', queued_at: '2026-10-21 10:00:00' }, Number.NaN), null);
});

test('a cancelled import can retry its original employee, fingerprint, and sensor without a lookup', () => {
  const cancelled = {
    job_id: 42,
    status: 'cancelled',
    employee_id: ' 000001-000001 ',
    fingerprint_id: '17',
    enrollment_device_id: '2',
    assigned_slot: 31,
    template_data_base64: 'must-not-be-sent',
  };
  assert.deepEqual(getDirectImportRetryTarget(cancelled), {
    employee_id: '000001-000001',
    fingerprint_id: 17,
    enrollment_device_id: 2,
  });
  assert.equal('job_id' in getDirectImportRetryTarget(cancelled), false);
});

test('retry is limited to cancelled imports with complete valid target metadata', () => {
  const cancelled = { status: 'cancelled', employee_id: '00123', fingerprint_id: 17, enrollment_device_id: 1 };
  for (const status of ['pending', 'processing', 'completed', 'failed', '']) {
    assert.equal(getDirectImportRetryTarget({ ...cancelled, status }), null);
  }
  for (const field of ['fingerprint_id', 'enrollment_device_id']) {
    for (const value of [undefined, null, '', 0, -1, 1.5, 'invalid', Number.NaN]) {
      assert.equal(getDirectImportRetryTarget({ ...cancelled, [field]: value }), null);
    }
  }
  for (const employeeId of [undefined, null, '', '  ', 123]) {
    assert.equal(getDirectImportRetryTarget({ ...cancelled, employee_id: employeeId }), null);
  }
  assert.equal(getDirectImportRetryTarget(null), null);
  assert.equal(getDirectImportRetryTarget(undefined), null);
});

test('cancelled and completed imports return to the blank form one minute after finishing', () => {
  for (const status of ['cancelled', 'completed', 'CANCELLED', 'COMPLETED']) {
    const job = { status, finished_at: '2026-10-21 10:00:00' };
    assert.equal(getDirectImportFormResetDelay(job, Date.parse('2026-10-21T02:00:00Z')), 60_000);
    assert.equal(getDirectImportFormResetDelay(job, Date.parse('2026-10-21T02:00:59Z')), 1000);
    assert.equal(getDirectImportFormResetDelay(job, Date.parse('2026-10-21T02:00:59.999Z')), 1);
    assert.equal(getDirectImportFormResetDelay(job, Date.parse('2026-10-21T02:01:00Z')), 0);
    assert.equal(getDirectImportFormResetDelay(job, Date.parse('2026-10-21T02:05:00Z')), 0);
  }
});

test('active and failed imports do not automatically reset the form', () => {
  const now = Date.parse('2026-10-21T02:05:00Z');
  for (const status of ['pending', 'processing', 'failed', '']) {
    assert.equal(getDirectImportFormResetDelay({ status, finished_at: '2026-10-21 10:00:00' }, now), null);
  }
  assert.equal(getDirectImportFormResetDelay(null, now), null);
  assert.equal(getDirectImportFormResetDelay(undefined, now), null);
});

test('reopening a finished import preserves its original reset deadline', () => {
  const job = { job_id: 42, status: 'completed', finished_at: '2026-10-21 10:00:00' };
  const now = Date.parse('2026-10-21T02:00:40Z');
  assert.equal(getDirectImportFormResetDelay({ ...job }, now), 20_000);
  assert.equal(getDirectImportFormResetDelay({ ...job, finished_at: '2026-10-21T02:00:00Z' }, now), 20_000);
});

test('missing finish times fall back to one minute and clock differences never extend that wait', () => {
  const now = Date.parse('2026-10-21T02:00:00Z');
  for (const finishedAt of [undefined, null, '', 'invalid']) {
    assert.equal(getDirectImportFormResetDelay({ status: 'cancelled', finished_at: finishedAt }, now), 60_000);
  }
  assert.equal(getDirectImportFormResetDelay({ status: 'completed', finished_at: '2026-10-21 10:10:00' }, now), 60_000);
  assert.equal(getDirectImportFormResetDelay({ status: 'completed', finished_at: '2026-10-21 10:00:00' }, Number.NaN), null);
});
