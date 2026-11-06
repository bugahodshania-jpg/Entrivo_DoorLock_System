import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canCancelEnrollment,
  enrollmentCancelConfirmMessage,
  findIdentifyMatchJob,
  findLiveEnrollmentJob,
  getEnrollmentFinalVerificationHint,
  getWeakFingerprintContactHint,
  getEnrollmentPickupRemainingSeconds,
  getEnrollmentProgressValue,
  getEnrollmentResult,
  getEnrollmentRowAction,
  getEnrollmentStatusLabel,
  hasEnrollmentFinalVerification,
  hasIdentifyMatch,
  hasVerifiedEnrollment,
  isEnrollmentCountdownLive,
  resolveEnrollmentStageKey,
} from '../src/utils/fingerprintEnrollment.js';

const waiting = { status: 'waiting', created_at: '2026-10-21 10:00:00', updated_at: '2026-10-21 10:00:00' };

test('waiting enrollment countdown reaches zero at the ten-minute idle deadline', () => {
  assert.equal(getEnrollmentPickupRemainingSeconds(waiting, Date.parse('2026-10-21T02:00:00Z')), 600);
  assert.equal(getEnrollmentPickupRemainingSeconds(waiting, Date.parse('2026-10-21T02:09:59Z')), 1);
  assert.equal(getEnrollmentPickupRemainingSeconds(waiting, Date.parse('2026-10-21T02:09:59.999Z')), 1);
  assert.equal(getEnrollmentPickupRemainingSeconds(waiting, Date.parse('2026-10-21T02:10:00Z')), 0);
  assert.equal(getEnrollmentPickupRemainingSeconds(waiting, Date.parse('2026-10-21T02:13:00Z')), 0);
});

test('retry uses the fresh updated_at timestamp instead of the original creation time', () => {
  const retry = { ...waiting, updated_at: '2026-10-21 10:05:00' };
  assert.equal(getEnrollmentPickupRemainingSeconds(retry, Date.parse('2026-10-21T02:05:00Z')), 600);
  assert.equal(getEnrollmentPickupRemainingSeconds(retry, Date.parse('2026-10-21T02:14:59Z')), 1);
  assert.equal(getEnrollmentPickupRemainingSeconds({ ...retry }, Date.parse('2026-10-21T02:06:00Z')), 540);
});

test('enrollment timestamps use Manila time and fall back to created_at only when updated_at is absent', () => {
  const now = Date.parse('2026-10-21T02:01:00Z');
  assert.equal(getEnrollmentPickupRemainingSeconds({ ...waiting, updated_at: null }, now), 540);
  assert.equal(getEnrollmentPickupRemainingSeconds({ status: 'waiting', created_at: waiting.created_at }, now), 540);
  assert.equal(getEnrollmentPickupRemainingSeconds({ ...waiting, updated_at: '2026-10-21T02:00:00Z' }, now), 540);
});

test('live claimed enrollments share the ten-minute idle countdown and closed jobs do not', () => {
  const now = Date.parse('2026-10-21T02:01:00Z');
  for (const status of ['processing', 'stored_pending_commit', 'needs_reconciliation']) {
    assert.equal(getEnrollmentPickupRemainingSeconds({ ...waiting, status }, now), 540);
  }
  for (const status of ['completed', 'cancelled', 'failed', 'pending', '']) {
    assert.equal(getEnrollmentPickupRemainingSeconds({ ...waiting, status }, now), null);
  }
  assert.equal(getEnrollmentPickupRemainingSeconds(null, now), null);
});

test('a live countdown replaces Enroll with View Progress and Enroll returns when the wait ends', () => {
  const now = Date.parse('2026-10-21T02:01:00Z');
  const ended = Date.parse('2026-10-21T02:10:00Z');
  const jobs = [{
    job_id: 40,
    user_id: 8,
    finger_name: 'Right Thumb',
    status: 'processing',
    created_at: waiting.created_at,
    updated_at: waiting.updated_at,
  }];
  const fingerprint = { userId: 8, fingerName: 'Right Thumb', status: 'pending' };
  assert.equal(isEnrollmentCountdownLive(jobs[0], now), true);
  assert.equal(findLiveEnrollmentJob(jobs, { userId: 8, fingerName: 'Right Thumb' }, now)?.job_id, 40);
  assert.equal(findLiveEnrollmentJob(jobs, { userId: 8, fingerName: 'Left Index' }, now)?.job_id, 40);
  const live = getEnrollmentRowAction(fingerprint, jobs, now);
  assert.equal(live.kind, 'view-progress');
  assert.equal(live.label, 'View Progress');
  assert.equal(live.job.job_id, 40);
  assert.equal(getEnrollmentRowAction({ ...fingerprint, status: 'active' }, jobs, now).label, 'View Progress');
  assert.equal(isEnrollmentCountdownLive(jobs[0], ended), false);
  const expired = getEnrollmentRowAction(fingerprint, jobs, ended);
  assert.equal(expired.kind, 'enroll');
  assert.equal(expired.label, 'Enroll');
  assert.equal(expired.job, null);
  assert.equal(getEnrollmentRowAction({ ...fingerprint, status: 'active' }, jobs, ended).label, 'Update');
  assert.equal(findLiveEnrollmentJob(jobs, { userId: 8 }, ended), null);
  assert.equal(getEnrollmentRowAction(fingerprint, [{ ...jobs[0], user_id: 9 }], now).label, 'Enroll');
  assert.equal(getEnrollmentRowAction(fingerprint, [{ ...jobs[0], status: 'cancelled' }], now).label, 'Enroll');
});

test('invalid timestamps do not create a deadline and clock differences cannot extend the wait', () => {
  const now = Date.parse('2026-10-21T02:01:00Z');
  assert.equal(getEnrollmentPickupRemainingSeconds({ status: 'waiting' }, now), null);
  assert.equal(getEnrollmentPickupRemainingSeconds({ ...waiting, updated_at: 'invalid' }, now), null);
  assert.equal(getEnrollmentPickupRemainingSeconds(waiting, Number.NaN), null);
  assert.equal(getEnrollmentPickupRemainingSeconds(waiting, Date.parse('2026-10-21T01:59:00Z')), 600);
});

test('a partial finger contact stays on the current enrollment step and shows the hold-still guidance', () => {
  const step = 'Finger contact was too small. Hold the center of the finger flat and still.';
  const firstScan = { status: 'processing', progress: 10, current_step: step };
  const secondScan = { status: 'processing', progress: 60, current_step: step };
  const storedCheck = { status: 'processing', progress: 85, current_step: step };
  assert.equal(resolveEnrollmentStageKey(firstScan), 'place-first');
  assert.equal(resolveEnrollmentStageKey(secondScan), 'place-second');
  assert.equal(hasEnrollmentFinalVerification(storedCheck), false);
  assert.equal(resolveEnrollmentStageKey(storedCheck), 'stored');
  assert.match(getWeakFingerprintContactHint(firstScan), /flat and centered on the sensor/);
  assert.match(getWeakFingerprintContactHint(storedCheck), /flat and centered on the sensor/);
});

test('an unclear first-scan duplicate check asks for removal before recapture', () => {
  const lift = { status: 'processing', progress: 10, current_step: 'First scan check unclear. Remove finger completely' };
  const retry = { status: 'processing', progress: 10, current_step: 'Place the selected finger for first scan retry' };
  assert.equal(resolveEnrollmentStageKey(lift), 'remove');
  assert.equal(resolveEnrollmentStageKey(retry), 'place-first');
});

test('stored Sensor A jobs wait for download after the stored-slot template is confirmed', () => {
  for (const job of [
    { status: 'stored_pending_commit', progress: 85, current_step: 'Stored at slot 34. Reading template.' },
    { status: 'needs_reconciliation', progress: 90, current_step: 'Sensor storage needs reconciliation' },
    { status: 'processing', progress: 85, current_step: 'Stored at slot 34' },
  ]) {
    assert.equal(hasEnrollmentFinalVerification(job), true);
    assert.ok(['stored', 'download'].includes(resolveEnrollmentStageKey(job)));
    assert.ok(getEnrollmentProgressValue(job) >= 80);
  }
  assert.match(getEnrollmentFinalVerificationHint({ status: 'stored_pending_commit' }), /stored this fingerprint.*[Dd]ownload/);
  assert.match(getEnrollmentFinalVerificationHint({ status: 'needs_reconciliation' }), /Retry to start a fresh two-scan enrollment/);
});

test('a later verification error after storage asks for a fresh restart', () => {
  const stored = {
    status: 'needs_reconciliation',
    progress: 90,
    current_step: 'Sensor storage needs reconciliation',
    error_message: 'standard search returned code 0x17',
  };
  assert.equal(hasEnrollmentFinalVerification(stored), true);
  assert.equal(resolveEnrollmentStageKey(stored), 'stored');
  assert.equal(getEnrollmentResult(stored).title, 'Enrollment needs a restart');
});

test('Adafruit two-scan enrollment stores first, then waits for download', () => {
  const steps = [
    [10, 'Place finger for first scan', 'place-first'],
    [20, 'Image taken', 'place-first'],
    [35, 'First scan captured. Remove finger', 'remove'],
    [60, 'Place the same finger for second scan', 'place-second'],
    [70, 'Image taken', 'place-second'],
    [80, 'Creating model for slot 23', 'create-model'],
    [85, 'Stored at slot 23', 'stored'],
    [95, 'Stored at slot 23. Waiting for download.', 'download'],
  ];
  for (const [progress, current_step, stage] of steps) {
    assert.equal(resolveEnrollmentStageKey({ status: 'processing', progress, current_step }), stage);
  }
  const stored = { status: 'stored_pending_commit', progress: 85, current_step: 'Stored at slot 23' };
  assert.equal(resolveEnrollmentStageKey(stored), 'stored');
  assert.match(getEnrollmentFinalVerificationHint(stored), /Download/);
  const completed = { status: 'completed', progress: 100, current_step: 'Enrollment completed' };
  assert.equal(resolveEnrollmentStageKey(completed), 'complete');
});

test('live enrollment stays cancellable through Store and the download handoff', () => {
  assert.equal(canCancelEnrollment({ job_id: 12, status: 'waiting', can_cancel: true }), true);
  assert.equal(canCancelEnrollment({ job_id: 12, status: 'processing', can_cancel: false }), true);
  assert.equal(canCancelEnrollment({ job_id: 12, status: 'stored_pending_commit' }), true);
  assert.equal(canCancelEnrollment({ job_id: 12, status: 'needs_reconciliation' }), true);
  assert.equal(canCancelEnrollment({ job_id: 12, status: 'completed', can_cancel: false }), false);
  assert.equal(canCancelEnrollment({ job_id: 0, status: 'waiting' }), false);
  assert.match(enrollmentCancelConfirmMessage({ status: 'waiting', progress: 10 }), /cancel this enrollment/i);
  assert.match(enrollmentCancelConfirmMessage({ status: 'stored_pending_commit', progress: 95 }), /may already have stored a template.*roll back/);
  assert.match(enrollmentCancelConfirmMessage({
    status: 'processing',
    identify_match: { template_data_base64: 'QQ==' },
  }), /Sensor Memory/);
});

test('a confirmed stored-slot template opens the download handoff without completing enrollment', () => {
  const match = {
    storage_confirmed: true,
    stored_slot: 12,
    matched_slot: 12,
    confidence: 1,
    template_bytes: 768,
    template_sha256: 'ab'.repeat(32),
    template_data_base64: 'QQ==',
    template_data_hex: '41',
  };
  const job = {
    status: 'stored_pending_commit',
    progress: 95,
    current_step: 'Stored at slot 12. Waiting for download.',
    identify_match: match,
  };
  assert.equal(hasIdentifyMatch(job), true);
  assert.equal(hasVerifiedEnrollment(job), false);
  assert.equal(getEnrollmentResult(job), null);
  assert.equal(resolveEnrollmentStageKey(job), 'download');
  assert.equal(getEnrollmentProgressValue(job), 95);
  assert.equal(getEnrollmentStatusLabel(job), 'Stored, waiting for download');
  assert.match(getEnrollmentFinalVerificationHint(job), /Download this exact slot template/);
  assert.equal(hasIdentifyMatch({ ...job, identify_match: { ...match, template_sha256: 'bad' } }), false);
});

test('the newest stored-slot template is the job the global download modal should open', () => {
  const match = {
    storage_confirmed: true,
    stored_slot: 12,
    matched_slot: 12,
    confidence: 1,
    template_bytes: 768,
    template_sha256: 'ab'.repeat(32),
    template_data_base64: 'QQ==',
    template_data_hex: '41',
  };
  const older = {
    job_id: 8,
    status: 'stored_pending_commit',
    updated_at: '2026-11-01 23:00:00',
    identify_match: match,
  };
  const newer = {
    job_id: 9,
    status: 'stored_pending_commit',
    updated_at: '2026-11-01 23:10:00',
    identify_match: { ...match, matched_slot: 14, stored_slot: 14 },
  };
  assert.equal(findIdentifyMatchJob([older, { status: 'processing' }, newer])?.job_id, 9);
  assert.equal(findIdentifyMatchJob([{ status: 'completed' }]), null);
});

test('only backend completed status finishes enrollment, regardless of progress or step wording', () => {
  for (const status of ['processing', 'failed', 'cancelled']) {
    const job = { status, progress: 100, current_step: 'Enrollment completed' };
    assert.notEqual(resolveEnrollmentStageKey(job), 'complete');
    assert.equal(getEnrollmentProgressValue(job), 99);
  }
  const completed = { status: 'completed', progress: 99, current_step: 'Enrollment completed after final verification' };
  assert.equal(resolveEnrollmentStageKey(completed), 'complete');
  assert.equal(getEnrollmentProgressValue(completed), 100);
  assert.equal(hasEnrollmentFinalVerification(completed), true);
});

test('legacy enrollment stages stay mapped to the Adafruit two-scan sequence', () => {
  for (const [progress, currentStep, expectedStage] of [
    [10, 'Place finger for first scan', 'place-first'],
    [35, 'First scan captured. Remove finger', 'remove'],
    [60, 'Place the same finger for second scan', 'place-second'],
    [80, 'Generating fingerprint model', 'create-model'],
    [85, 'Stored at slot 12', 'stored'],
    [95, 'Stored at slot 12. Waiting for download.', 'download'],
  ]) {
    const job = { status: 'processing', progress, current_step: currentStep };
    assert.equal(resolveEnrollmentStageKey(job), expectedStage);
  }
  const legacyCompleted = { status: 'completed', progress: 100, current_step: 'Enrollment completed' };
  assert.equal(resolveEnrollmentStageKey(legacyCompleted), 'complete');
  assert.equal(hasEnrollmentFinalVerification(legacyCompleted), false);
  assert.equal(getEnrollmentProgressValue({ status: 'processing', progress: 98 }), 98);
});

const verifiedJob = {
  status: 'completed', progress: 100, finished_at: '2026-10-22 10:00:00', assigned_slot: 34, fingerprint_id: 8,
  verification: {
    fresh_scan_verified: false, storage_confirmed: true, stored_slot: 34, matched_slot: 34, confidence: 120,
    template_bytes: 768, template_sha256: 'ab'.repeat(32),
    verified_at: '2026-10-22 10:00:00', fingerprint_id: 8,
  },
};

test('verified enrollment requires backend completion and matching stored-slot proof', () => {
  assert.equal(hasVerifiedEnrollment(verifiedJob), true);
  assert.equal(getEnrollmentStatusLabel(verifiedJob), 'Verified');
  assert.match(getEnrollmentFinalVerificationHint(verifiedJob), /Sensor A storage and the database mapping are confirmed/);
  for (const status of ['waiting', 'processing', 'failed', 'cancelled']) {
    const job = { ...verifiedJob, status };
    assert.equal(hasVerifiedEnrollment(job), false);
    assert.equal(getEnrollmentProgressValue(job), 99);
  }
  for (const patch of [
    { storage_confirmed: false }, { matched_slot: 35 }, { stored_slot: 0 },
    { confidence: 0 }, { confidence: null }, { confidence: 1.5 }, { confidence: 65536 }, { template_bytes: 511 },
    { template_sha256: 'bad-hash' }, { verified_at: '' }, { verified_at: 'invalid-date' }, { fingerprint_id: 9 },
    { stored_slot: true }, { matched_slot: '34' }, { fingerprint_id: null },
  ]) {
    assert.equal(hasVerifiedEnrollment({ ...verifiedJob, verification: { ...verifiedJob.verification, ...patch } }), false);
  }
  assert.equal(hasVerifiedEnrollment({ ...verifiedJob, assigned_slot: 35 }), false);
  assert.equal(hasVerifiedEnrollment({ ...verifiedJob, progress: 99 }), false);
  assert.equal(hasVerifiedEnrollment({ ...verifiedJob, progress: 20 }), false);
  assert.equal(hasVerifiedEnrollment({ ...verifiedJob, progress: '100' }), true);
  assert.equal(hasVerifiedEnrollment({ ...verifiedJob, finished_at: null }), false);
  assert.equal(hasVerifiedEnrollment({ ...verifiedJob, finished_at: 'invalid-date' }), false);
  assert.equal(hasVerifiedEnrollment({ ...verifiedJob, assigned_slot: 65536, verification: { ...verifiedJob.verification, stored_slot: 65536, matched_slot: 65536 } }), false);
});

test('a finished enrollment produces one success or error result for the modal', () => {
  const verified = {
    ...verifiedJob,
    user_name: 'Juan Delacruz',
    finger_name: 'Right Ring',
  };
  const success = getEnrollmentResult(verified);
  assert.equal(success.tone, 'success');
  assert.equal(success.title, 'Fingerprint Enrollment Successful');
  assert.match(success.message, /Juan Delacruz's Right Ring has been successfully enrolled, independently verified, and saved to both the R307S fingerprint sensor and the database/);
  assert.match(success.message, /Sensor: R307S Device 1 \| Slot: 34 \| Status: Active/);

  const failed = getEnrollmentResult({
    status: 'failed',
    error_message: 'The new sensor template was removed. This attempt was not saved.',
  });
  assert.equal(failed.tone, 'error');
  assert.equal(failed.title, 'Enrollment was not saved');
  assert.match(failed.message, /template was removed/);

  const cancelled = getEnrollmentResult({ status: 'cancelled', error_message: '' });
  assert.equal(cancelled.title, 'Enrollment cancelled');
  assert.match(cancelled.message, /cancelled and rolled back/);

  const unverified = getEnrollmentResult({ status: 'completed', progress: 100, current_step: 'Enrollment completed' });
  assert.equal(unverified.title, 'Enrollment not confirmed');
  assert.match(unverified.message, /door cannot use it/);

  for (const status of ['waiting', 'processing', 'stored_pending_commit', '']) {
    assert.equal(getEnrollmentResult({ status, error_message: 'still working' }), null);
  }
  assert.equal(getEnrollmentResult(null), null);
});

test('historical completion and final-verification wording never become verified without stored proof', () => {
  for (const job of [
    { status: 'completed', progress: 100, current_step: 'Enrollment completed' },
    { status: 'completed', progress: 100, current_step: 'Final verification passed', verification: null },
    { status: 'active', assigned_slot: 34, has_template_data: true },
  ]) {
    assert.equal(hasVerifiedEnrollment(job), false);
  }
  const legacyJob = { status: 'completed', progress: 100, assigned_slot: 34 };
  assert.equal(getEnrollmentStatusLabel(legacyJob), 'Completed (unverified)');
  assert.equal(getEnrollmentProgressValue(legacyJob), 100);
  assert.equal(resolveEnrollmentStageKey(legacyJob), 'complete');
  assert.match(getEnrollmentFinalVerificationHint(legacyJob), /historical completion.*no confirmed Sensor A mapping/);
});

test('storage-confirmed completions with a slot-bound hash are verified without a live Search', () => {
  const incomplete = {
    status: 'completed',
    progress: 100,
    finished_at: '2026-10-22 10:00:00',
    assigned_slot: 8,
    fingerprint_id: 4,
    verification: {
      storage_confirmed: true,
      stored_slot: 8,
      fingerprint_id: 4,
      verified_at: '2026-10-22 10:00:00',
    },
  };
  assert.equal(hasVerifiedEnrollment(incomplete), false);
  assert.equal(getEnrollmentStatusLabel(incomplete), 'Completed (unverified)');
  const stored = {
    ...incomplete,
    verification: {
      storage_confirmed: true,
      stored_slot: 8,
      matched_slot: 8,
      confidence: 1,
      template_bytes: 768,
      template_sha256: 'ab'.repeat(32),
      fingerprint_id: 4,
      verified_at: '2026-10-22 10:00:00',
    },
  };
  assert.equal(hasVerifiedEnrollment(stored), true);
  assert.equal(getEnrollmentStatusLabel(stored), 'Verified');
  const saved = getEnrollmentResult(stored);
  assert.equal(saved.title, 'Fingerprint Enrollment Successful');
  const pending = getEnrollmentResult({
    status: 'stored_pending_commit',
    progress: 92,
    current_step: 'Stored at slot 8. Waiting for download.',
  });
  assert.equal(pending, null);
});
