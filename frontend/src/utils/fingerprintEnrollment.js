import { parseManilaDateTime } from './dateTime.js';

function normalizeEnrollmentText(value) {
  return String(value || '').trim().toLowerCase();
}

export function hasVerifiedEnrollment(job) {
  const verification = job?.verification;
  if (normalizeEnrollmentText(job?.status) !== 'completed' || Number(job?.progress) !== 100
    || typeof job?.finished_at !== 'string' || job.finished_at.trim() === ''
    || !Number.isFinite(parseManilaDateTime(job.finished_at).getTime())
    || !verification || verification.fresh_scan_verified !== true) return false;
  const storedSlot = verification.stored_slot;
  const matchedSlot = verification.matched_slot;
  const confidence = verification.confidence;
  const templateBytes = verification.template_bytes;
  return Number.isInteger(storedSlot) && storedSlot > 0 && storedSlot <= 65535
    && Number.isInteger(matchedSlot) && matchedSlot === storedSlot
    && job.assigned_slot != null && Number(job.assigned_slot) === storedSlot
    && Number.isInteger(confidence) && confidence > 0 && confidence <= 65535
    && [512, 768, 1024, 1536].includes(templateBytes)
    && typeof verification.template_sha256 === 'string' && /^[a-f0-9]{64}$/.test(verification.template_sha256)
    && typeof verification.verified_at === 'string' && verification.verified_at.trim() !== ''
    && Number.isFinite(parseManilaDateTime(verification.verified_at).getTime())
    && Number.isInteger(verification.fingerprint_id) && verification.fingerprint_id > 0
    && (job.fingerprint_id == null || Number(verification.fingerprint_id) === Number(job.fingerprint_id));
}

export function getEnrollmentResult(job) {
  const status = normalizeEnrollmentText(job?.status);
  if (status !== 'completed' && status !== 'failed' && status !== 'cancelled') return null;

  const name = String(job?.user_name || '').trim();
  const finger = String(job?.finger_name || '').trim();
  const who = name && finger ? `${name}'s ${finger}` : (name || finger || 'This fingerprint');

  if (status === 'completed' && hasVerifiedEnrollment(job)) {
    return {
      tone: 'success',
      title: 'Fingerprint enrolled',
      message: `${who} is confirmed on Sensor A, slot ${job.verification.stored_slot}. You can assign this user's schedule.`,
    };
  }
  if (status === 'completed') {
    return {
      tone: 'error',
      title: 'Enrollment not confirmed',
      message: 'This enrollment closed before the fingerprint backup was confirmed, so it is not ready for schedule access.',
    };
  }
  if (status === 'cancelled') {
    return {
      tone: 'error',
      title: 'Enrollment cancelled',
      message: String(job?.error_message || '').trim() || 'This enrollment was cancelled before the fingerprint was saved.',
    };
  }
  return {
    tone: 'error',
    title: 'Enrollment was not saved',
    message: String(job?.error_message || '').trim() || 'The fingerprint template was not saved. You can start enrollment again.',
  };
}

export function getEnrollmentStatusLabel(job) {
  const status = normalizeEnrollmentText(job?.status);
  if (status === 'completed') return hasVerifiedEnrollment(job) ? 'Verified' : 'Completed (unverified)';
  return status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown';
}

export function hasEnrollmentFinalVerification(job) {
  const step = normalizeEnrollmentText(job?.current_step);
  const error = normalizeEnrollmentText(job?.error_message);
  return hasVerifiedEnrollment(job)
    || step.includes('final verification')
    || step.includes('fingerprint verified at sensor slot')
    || error.includes('final verification');
}

export function getEnrollmentFinalVerificationHint(job) {
  if (normalizeEnrollmentText(job?.status) === 'completed') {
    return hasVerifiedEnrollment(job)
      ? 'The backend confirmed a fresh scan of the saved sensor slot and its matching template backup.'
      : 'This historical completion has no confirmed fresh-scan proof. Update the enrollment to verify the saved fingerprint.';
  }
  if (!hasEnrollmentFinalVerification(job)) return null;
  const step = normalizeEnrollmentText(job?.current_step);
  if (step.includes('remove')) {
    return 'Lift your finger completely off the sensor. Wait for the final scan prompt so the device can check the saved fingerprint with a fresh capture.';
  }
  if (step.includes('final verification passed') || step.includes('fingerprint verified at sensor slot')) {
    return 'The sensor reports that the fresh scan matched the saved fingerprint. Keep Sensor A powered while the backend confirms enrollment.';
  }
  return 'Place the same enrolled finger flat on the sensor for a third scan. Enrollment finishes only after this fresh scan matches the saved fingerprint.';
}

export function getEnrollmentProgressValue(job) {
  if (normalizeEnrollmentText(job?.status) === 'completed') return 100;
  return Math.max(0, Math.min(99, Number(job?.progress) || 0));
}

export function resolveEnrollmentStageKey(job) {
  if (!job) return 'waiting';
  const status = normalizeEnrollmentText(job.status);
  const step = normalizeEnrollmentText(job.current_step);
  const progress = getEnrollmentProgressValue(job);

  if (status === 'completed') return 'complete';
  // Check final verification before generic words such as saved, finger, or template.
  if (hasEnrollmentFinalVerification(job)) return 'verify-fingerprint';
  if (status === 'failed' || status === 'cancelled') {
    if (progress >= 90) return 'save-download';
    if (progress >= 75) return 'create-model';
    if (progress >= 50) return 'place-second';
    return progress >= 5 ? 'claimed' : 'waiting';
  }
  if (step.includes('download') || step.includes('upload') || step.includes('completion') || step.includes('complete')) {
    return 'save-download';
  }
  if (step.includes('save') || step.includes('saving') || step.includes('store') || step.includes('storing')) return 'save-download';
  if (step.includes('creat') || step.includes('generat') || step.includes('model') || step.includes('process') || step.includes('template')) {
    return 'create-model';
  }
  if (step.includes('same finger') || step.includes('again') || step.includes('second') || step.includes('2nd')) {
    return 'place-second';
  }
  if (step.includes('remove') || step.includes('lift')) return 'remove';
  if (step.includes('place') || step.includes('first scan') || step.includes('reader') || step.includes('sensor')) {
    return 'place-first';
  }
  if (step.includes('claim') || step.includes('start')) return 'claimed';
  if (progress >= 90) return 'save-download';
  if (progress >= 80) return 'create-model';
  if (progress >= 50) return 'place-second';
  if (progress >= 35) return 'remove';
  if (progress >= 10) return 'place-first';
  return progress >= 5 || status === 'processing' ? 'claimed' : 'waiting';
}

export function getEnrollmentPickupRemainingSeconds(job, now = Date.now()) {
  if (String(job?.status || '').trim().toLowerCase() !== 'waiting') return null;
  const queuedAt = parseManilaDateTime(job?.updated_at || job?.created_at).getTime();
  if (!Number.isFinite(queuedAt) || !Number.isFinite(now)) return null;

  return Math.max(0, Math.min(180, Math.ceil((queuedAt + 180_000 - now) / 1000)));
}
