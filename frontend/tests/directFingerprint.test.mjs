import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getSensorAEnrollmentKey,
  getSensorAEnrollmentLabel,
  hasVerifiedSensorAEnrollment,
  isEnrolledOnSensorA,
} from '../src/utils/directFingerprint.js';

const enrolled = { status: 'active', enrollmentDeviceId: 1, enrollmentSlot: 12 };

test('a legacy Sensor A mapping stays stored but does not claim verified enrollment', () => {
  assert.equal(isEnrolledOnSensorA({ ...enrolled, hasTemplateData: false, doorSyncStatus: 'not_synced' }), true);
  assert.equal(isEnrolledOnSensorA({ ...enrolled, enrollmentDeviceId: '1', enrollmentSlot: '12' }), true);
  assert.equal(hasVerifiedSensorAEnrollment(enrolled), false);
  assert.equal(getSensorAEnrollmentKey(enrolled), 'unverified');
  assert.equal(getSensorAEnrollmentLabel(enrolled), 'Stored (unverified)');
});

const verified = {
  ...enrolled,
  enrollmentVerified: true,
  hasTemplateData: true,
  templateBytes: 768,
  enrollmentVerification: {
    fresh_scan_verified: true,
    stored_slot: 12,
    matched_slot: 12,
    confidence: 87,
    template_bytes: 768,
    template_sha256: 'a'.repeat(64),
    verified_at: '2026-10-22 20:00:00',
  },
};

test('verified Sensor A enrollment requires backend confirmation and proof for the current slot and backup', () => {
  assert.equal(hasVerifiedSensorAEnrollment(verified), true);
  assert.equal(getSensorAEnrollmentKey(verified), 'enrolled');
  assert.equal(getSensorAEnrollmentLabel(verified), 'Verified on Sensor A');
  for (const change of [
    { enrollmentVerified: false }, { enrollmentVerified: 'true' },
    { hasTemplateData: false }, { templateBytes: 512 }, { status: 'inactive' },
    { enrollmentSlot: 13 }, { enrollmentDeviceId: 2 }, { enrollmentVerification: null },
  ]) {
    assert.equal(hasVerifiedSensorAEnrollment({ ...verified, ...change }), false);
  }
});

test('incomplete, mismatched or malformed sensor proof never produces a verified badge', () => {
  for (const change of [
    { fresh_scan_verified: false }, { fresh_scan_verified: 'true' },
    { stored_slot: 13 }, { matched_slot: 13 }, { matched_slot: '12' },
    { confidence: 0 }, { confidence: -1 }, { confidence: 65536 }, { confidence: 87.5 },
    { template_bytes: 769 }, { template_bytes: 512 },
    { template_sha256: 'not-a-digest' }, { verified_at: '' }, { verified_at: 'invalid' },
  ]) {
    assert.equal(hasVerifiedSensorAEnrollment({
      ...verified, enrollmentVerification: { ...verified.enrollmentVerification, ...change },
    }), false);
  }
});

test('an active synced record on another device is not reported as enrolled on Sensor A', () => {
  const otherDevice = { ...enrolled, enrollmentDeviceId: 2, doorSyncStatus: 'synced' };
  assert.equal(isEnrolledOnSensorA(otherDevice), false);
  assert.equal(getSensorAEnrollmentLabel(otherDevice), 'Not enrolled on Sensor A');
});

test('missing, inactive, and unassigned Sensor A records need enrollment', () => {
  for (const fingerprint of [
    null,
    { ...enrolled, status: 'inactive' },
    { ...enrolled, enrollmentDeviceId: null },
    { ...enrolled, enrollmentSlot: null },
    { ...enrolled, enrollmentSlot: 0 },
    { ...enrolled, enrollmentSlot: -1 },
    { ...enrolled, enrollmentSlot: 1.5 },
  ]) {
    assert.equal(isEnrolledOnSensorA(fingerprint), false);
    assert.equal(getSensorAEnrollmentKey(fingerprint), 'not_enrolled');
  }
});
