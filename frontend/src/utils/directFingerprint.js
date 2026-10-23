import { parseManilaDateTime } from './dateTime.js';

export const SENSOR_A_DEVICE_ID = 1;

export function isEnrolledOnSensorA(fingerprint) {
  const slot = Number(fingerprint?.enrollmentSlot);

  return String(fingerprint?.status || '').trim().toLowerCase() === 'active'
    && Number(fingerprint?.enrollmentDeviceId) === SENSOR_A_DEVICE_ID
    && Number.isInteger(slot)
    && slot > 0;
}

export function hasVerifiedSensorAEnrollment(fingerprint) {
  if (!isEnrolledOnSensorA(fingerprint) || fingerprint?.enrollmentVerified !== true) return false;
  const proof = fingerprint.enrollmentVerification;
  const slot = Number(fingerprint.enrollmentSlot);

  return proof?.fresh_scan_verified === true
    && Number.isInteger(proof.stored_slot) && proof.stored_slot === slot
    && Number.isInteger(proof.matched_slot) && proof.matched_slot === slot
    && Number.isInteger(proof.confidence) && proof.confidence > 0 && proof.confidence <= 65535
    && [512, 768, 1024, 1536].includes(proof.template_bytes)
    && proof.template_bytes === Number(fingerprint.templateBytes)
    && fingerprint.hasTemplateData === true
    && typeof proof.template_sha256 === 'string' && /^[a-f0-9]{64}$/.test(proof.template_sha256)
    && typeof proof.verified_at === 'string' && proof.verified_at.trim() !== ''
    && Number.isFinite(parseManilaDateTime(proof.verified_at).getTime());
}

export function getSensorAEnrollmentKey(fingerprint) {
  if (hasVerifiedSensorAEnrollment(fingerprint)) return 'enrolled';
  return isEnrolledOnSensorA(fingerprint) ? 'unverified' : 'not_enrolled';
}

export function getSensorAEnrollmentLabel(fingerprint) {
  if (hasVerifiedSensorAEnrollment(fingerprint)) return 'Verified on Sensor A';
  return isEnrolledOnSensorA(fingerprint) ? 'Stored (unverified)' : 'Not enrolled on Sensor A';
}
