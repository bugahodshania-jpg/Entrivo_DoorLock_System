import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getEnrollmentFinalVerificationHint,
  getEnrollmentPickupRemainingSeconds,
  getEnrollmentProgressValue,
  getEnrollmentResult,
  getEnrollmentStatusLabel,
  hasEnrollmentFinalVerification,
  hasVerifiedEnrollment,
  resolveEnrollmentStageKey,
} from '../src/utils/fingerprintEnrollment.js';

const waiting = { status: 'waiting', created_at: '2026-10-21 10:00:00', updated_at: '2026-10-21 10:00:00' };

test('waiting enrollment countdown reaches zero at the three-minute pickup deadline', () => {
  assert.equal(getEnrollmentPickupRemainingSeconds(waiting, Date.parse('2026-10-21T02:00:00Z')), 180);
  assert.equal(getEnrollmentPickupRemainingSeconds(waiting, Date.parse('2026-10-21T02:02:59Z')), 1);
  assert.equal(getEnrollmentPickupRemainingSeconds(waiting, Date.parse('2026-10-21T02:02:59.999Z')), 1);
  assert.equal(getEnrollmentPickupRemainingSeconds(waiting, Date.parse('2026-10-21T02:03:00Z')), 0);
  assert.equal(getEnrollmentPickupRemainingSeconds(waiting, Date.parse('2026-10-21T02:05:00Z')), 0);
});

test('retry uses the fresh updated_at timestamp instead of the original creation time', () => {
  const retry = { ...waiting, updated_at: '2026-10-21 10:05:00' };
  assert.equal(getEnrollmentPickupRemainingSeconds(retry, Date.parse('2026-10-21T02:05:00Z')), 180);
  assert.equal(getEnrollmentPickupRemainingSeconds(retry, Date.parse('2026-10-21T02:07:59Z')), 1);
  assert.equal(getEnrollmentPickupRemainingSeconds({ ...retry }, Date.parse('2026-10-21T02:06:00Z')), 120);
});

test('enrollment timestamps use Manila time and fall back to created_at only when updated_at is absent', () => {
  const now = Date.parse('2026-10-21T02:01:00Z');
  assert.equal(getEnrollmentPickupRemainingSeconds({ ...waiting, updated_at: null }, now), 120);
  assert.equal(getEnrollmentPickupRemainingSeconds({ status: 'waiting', created_at: waiting.created_at }, now), 120);
  assert.equal(getEnrollmentPickupRemainingSeconds({ ...waiting, updated_at: '2026-10-21T02:00:00Z' }, now), 120);
});

test('claimed, terminal, and unknown enrollment jobs have no pickup countdown', () => {
  const now = Date.parse('2026-10-21T02:01:00Z');
  for (const status of ['processing', 'completed', 'cancelled', 'failed', 'pending', '']) {
    assert.equal(getEnrollmentPickupRemainingSeconds({ ...waiting, status }, now), null);
  }
  assert.equal(getEnrollmentPickupRemainingSeconds(null, now), null);
});

test('invalid timestamps do not create a deadline and clock differences cannot extend the wait', () => {
  const now = Date.parse('2026-10-21T02:01:00Z');
  assert.equal(getEnrollmentPickupRemainingSeconds({ status: 'waiting' }, now), null);
  assert.equal(getEnrollmentPickupRemainingSeconds({ ...waiting, updated_at: 'invalid' }, now), null);
  assert.equal(getEnrollmentPickupRemainingSeconds(waiting, Number.NaN), null);
  assert.equal(getEnrollmentPickupRemainingSeconds(waiting, Date.parse('2026-10-21T01:59:00Z')), 180);
});

test('saved fingerprint verification has its own stage for removal, a third scan, and backend confirmation', () => {
  for (const [progress, currentStep] of [
    [96, 'Remove finger for final verification'],
    [98, 'Place the enrolled finger for final verification'],
    [99, 'Final verification passed at sensor slot 34. Sending completion to backend'],
  ]) {
    const job = { status: 'processing', progress, current_step: currentStep };
    assert.equal(hasEnrollmentFinalVerification(job), true);
    assert.equal(resolveEnrollmentStageKey(job), 'verify-fingerprint');
    assert.equal(getEnrollmentProgressValue(job), progress);
  }
  assert.match(getEnrollmentFinalVerificationHint({ current_step: 'Remove finger for final verification' }), /Lift your finger completely.*fresh capture/);
  assert.match(getEnrollmentFinalVerificationHint({ current_step: 'Place the enrolled finger for final verification' }), /third scan.*matches the saved fingerprint/);
  assert.match(getEnrollmentFinalVerificationHint({ current_step: 'Final verification passed at sensor slot 34. Sending completion to backend' }), /sensor reports.*fresh scan matched.*backend confirms/);
});

test('verification failure keeps its stage after the backend replaces the current step', () => {
  const failed = {
    status: 'failed',
    progress: 98,
    current_step: 'Enrollment failed',
    error_message: 'Final verification failed: No stored fingerprint matched the fresh scan (0x09).',
  };
  assert.equal(hasEnrollmentFinalVerification(failed), true);
  assert.equal(resolveEnrollmentStageKey(failed), 'verify-fingerprint');
  assert.equal(resolveEnrollmentStageKey({ ...failed, current_step: 'Final verification complete', progress: 100 }), 'verify-fingerprint');
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

test('legacy enrollment stages and completion remain available without a third scan marker', () => {
  for (const [progress, currentStep, expectedStage] of [
    [10, 'Place finger for first scan', 'place-first'],
    [35, 'First scan captured. Remove finger', 'remove'],
    [60, 'Place the same finger for second scan', 'place-second'],
    [80, 'Generating fingerprint model', 'create-model'],
    [90, 'Saving fingerprint to sensor', 'save-download'],
    [95, 'Fingerprint saved. Downloading template for verification', 'save-download'],
    [98, 'Sending completion to backend', 'save-download'],
  ]) {
    const job = { status: 'processing', progress, current_step: currentStep };
    assert.equal(resolveEnrollmentStageKey(job), expectedStage);
    assert.equal(hasEnrollmentFinalVerification(job), false);
    assert.equal(getEnrollmentFinalVerificationHint(job), null);
  }
  const legacyCompleted = { status: 'completed', progress: 100, current_step: 'Enrollment completed' };
  assert.equal(resolveEnrollmentStageKey(legacyCompleted), 'complete');
  assert.equal(hasEnrollmentFinalVerification(legacyCompleted), false);
  assert.equal(getEnrollmentProgressValue({ status: 'processing', progress: 98 }), 98);
});

const verifiedJob = {
  status: 'completed', progress: 100, finished_at: '2026-10-22 10:00:00', assigned_slot: 34, fingerprint_id: 8,
  verification: {
    fresh_scan_verified: true, stored_slot: 34, matched_slot: 34, confidence: 120,
    template_bytes: 768, template_sha256: 'ab'.repeat(32),
    verified_at: '2026-10-22 10:00:00', fingerprint_id: 8,
  },
};

test('verified enrollment requires backend completion and matching durable fresh-scan proof', () => {
  assert.equal(hasVerifiedEnrollment(verifiedJob), true);
  assert.equal(getEnrollmentStatusLabel(verifiedJob), 'Verified');
  assert.match(getEnrollmentFinalVerificationHint(verifiedJob), /backend confirmed.*fresh scan.*matching template backup/);
  for (const status of ['waiting', 'processing', 'failed', 'cancelled']) {
    const job = { ...verifiedJob, status };
    assert.equal(hasVerifiedEnrollment(job), false);
    assert.equal(getEnrollmentProgressValue(job), 99);
  }
  for (const patch of [
    { fresh_scan_verified: false }, { matched_slot: 35 }, { stored_slot: 0 },
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
  assert.equal(success.title, 'Fingerprint enrolled');
  assert.match(success.message, /Juan Delacruz's Right Ring is confirmed on Sensor A, slot 34/);
  assert.match(success.message, /assign this user's schedule/);

  const failed = getEnrollmentResult({
    status: 'failed',
    error_message: 'The new sensor template was removed. This attempt was not saved.',
  });
  assert.equal(failed.tone, 'error');
  assert.equal(failed.title, 'Enrollment was not saved');
  assert.match(failed.message, /template was removed/);

  const cancelled = getEnrollmentResult({ status: 'cancelled', error_message: '' });
  assert.equal(cancelled.title, 'Enrollment cancelled');
  assert.match(cancelled.message, /cancelled before the fingerprint was saved/);

  const unverified = getEnrollmentResult({ status: 'completed', progress: 100, current_step: 'Enrollment completed' });
  assert.equal(unverified.title, 'Enrollment not confirmed');
  assert.match(unverified.message, /not ready for schedule access/);

  for (const status of ['waiting', 'processing', '']) {
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
  assert.match(getEnrollmentFinalVerificationHint(legacyJob), /historical completion.*no confirmed fresh-scan proof/);
});
