import { parseManilaDateTime } from './dateTime.js';

function normalizeEnrollmentText(value) {
  return String(value || '').trim().toLowerCase();
}

export const enrollmentGuideSteps = [
  { key: 'place-first', label: 'Place finger', detail: 'Place the selected finger flat on Sensor A for the first scan.', threshold: 10 },
  { key: 'remove', label: 'Remove finger', detail: 'Wait until Sensor A confirms the finger has been lifted completely.', threshold: 35 },
  { key: 'place-second', label: 'Place same finger again', detail: 'Place the same finger again. Low quality keeps this step open until the scan is good.', threshold: 60 },
  { key: 'create-model', label: 'Creating model', detail: 'Sensor A combines both good scans (RegModel), then Stores the model.', threshold: 80 },
  { key: 'stored', label: 'Stored', detail: 'The fingerprint is stored on Sensor A. A live verification scan will confirm the exact slot.', threshold: 85 },
  { key: 'verify', label: 'Verify enrolled finger', detail: 'Third scan: lift and re-place the same finger. Sensor A compares it with the just-stored slot and only accepts that slot.', threshold: 86 },
  { key: 'download', label: 'Download template', detail: 'Download the exact R307S stored-slot template. This opens only after the verification scan matches.', threshold: 95 },
  { key: 'complete', label: 'Enrollment successful', detail: 'The stored template is saved in the database and on this PC.', threshold: 100 },
];

// Firmware progress for the third (verification) scan is 86-92, reading the
// stored template is 93, and the download handoff is 95. See Enrollment.cpp.
export const VERIFY_PROGRESS_START = 86;
export const DOWNLOAD_PROGRESS_START = 95;

export function isVerificationScanStep(job) {
  const step = normalizeEnrollmentText(job?.current_step);
  return step.includes('verification scan')
    || step.includes('verifying against')
    || step.includes('verification successful')
    || step.includes('third scan');
}

function isTemplateReadStep(job) {
  const step = normalizeEnrollmentText(job?.current_step);
  return step.includes('reading the stored template') || step.includes('reading the exact');
}

export function hasVerifiedEnrollment(job) {
  const status = normalizeEnrollmentText(job?.status);
  if (status !== 'completed' || Number(job?.progress) !== 100
    || typeof job?.finished_at !== 'string' || job.finished_at.trim() === ''
    || !Number.isFinite(parseManilaDateTime(job.finished_at).getTime())) return false;
  const verification = job?.verification;
  const storedSlot = Number(verification?.stored_slot ?? job?.assigned_slot);
  if (!Number.isInteger(storedSlot) || storedSlot <= 0 || storedSlot > 65535) return false;
  if (job.assigned_slot != null && Number(job.assigned_slot) !== storedSlot) return false;
  if (!verification || (verification.fresh_scan_verified !== true && verification.storage_confirmed !== true)) return false;
  const matchedSlot = verification.matched_slot;
  const confidence = verification.confidence;
  const templateBytes = verification.template_bytes;
  return Number.isInteger(matchedSlot) && matchedSlot === storedSlot
    && Number.isInteger(confidence) && confidence > 0 && confidence <= 65535
    && [512, 768, 1024, 1536].includes(templateBytes)
    && typeof verification.template_sha256 === 'string' && /^[a-f0-9]{64}$/.test(verification.template_sha256)
    && typeof verification.verified_at === 'string' && verification.verified_at.trim() !== ''
    && Number.isFinite(parseManilaDateTime(verification.verified_at).getTime())
    && Number.isInteger(verification.fingerprint_id) && verification.fingerprint_id > 0
    && (job.fingerprint_id == null || Number(verification.fingerprint_id) === Number(job.fingerprint_id));
}

export function hasIdentifyMatch(job) {
  const match = job?.identify_match;
  const matchedSlot = Number(match?.matched_slot);
  const confidence = Number(match?.confidence);
  const templateBytes = Number(match?.template_bytes);
  return Boolean(match)
    && (match.fresh_scan_verified === true || match.storage_confirmed === true)
    && Number.isInteger(matchedSlot) && matchedSlot > 0 && matchedSlot <= 65535
    && (!Number.isInteger(confidence) || (confidence > 0 && confidence <= 65535))
    && [512, 768, 1024, 1536].includes(templateBytes)
    && typeof match.template_data_base64 === 'string' && match.template_data_base64.trim() !== ''
    && typeof match.template_sha256 === 'string' && /^[a-f0-9]{64}$/.test(match.template_sha256);
}

export function getEnrollmentResult(job) {
  const status = normalizeEnrollmentText(job?.status);
  // stored_pending_commit stays live until Super Admin downloads the stored-slot template.
  if (!['completed', 'failed', 'cancelled', 'needs_reconciliation'].includes(status)) {
    return null;
  }

  const name = String(job?.user_name || '').trim();
  const finger = String(job?.finger_name || '').trim();
  const who = name && finger ? `${name}'s ${finger}` : (name || finger || 'This fingerprint');

  if (status === 'completed' && hasVerifiedEnrollment(job)) {
    const slot = job.verification?.stored_slot || job.assigned_slot;
    const deviceId = Number(job?.enrollment_device_id) || 1;
    return {
      tone: 'success',
      title: 'Fingerprint Enrollment Successful',
      message: `${who} has been successfully enrolled, independently verified, and saved to both the R307S fingerprint sensor and the database. Sensor: R307S Device ${deviceId} | Slot: ${slot} | Status: Active`,
    };
  }
  if (status === 'completed') {
    return {
      tone: 'error',
      title: 'Enrollment not confirmed',
      message: 'This enrollment closed before the stored-slot template was downloaded, so the door cannot use it yet. Update the fingerprint and download the stored template.',
    };
  }
  if (status === 'needs_reconciliation') {
    return {
      tone: 'warning',
      title: 'Enrollment needs a restart',
      message: String(job?.error_message || '').trim()
        || 'This enrollment did not finish cleanly. Retry to start a fresh two-scan enrollment. Any incomplete sensor template should be cleared.',
    };
  }
  if (status === 'cancelled') {
    return {
      tone: 'error',
      title: 'Enrollment cancelled',
      message: String(job?.error_message || '').trim() || 'This enrollment was cancelled and rolled back. Start enrollment again.',
    };
  }
  return {
    tone: 'error',
    title: 'Enrollment was not saved',
    message: String(job?.error_message || '').trim() || 'The fingerprint was not stored successfully. Download stayed closed. Start enrollment again.',
  };
}

export function getEnrollmentStatusLabel(job) {
  const status = normalizeEnrollmentText(job?.status);
  if (status === 'completed') return hasVerifiedEnrollment(job) ? 'Verified' : 'Completed (unverified)';
  if (status === 'stored_pending_commit') return hasIdentifyMatch(job) ? 'Stored, waiting for download' : 'Stored on Sensor A';
  if (status === 'needs_reconciliation') return 'Needs recovery';
  return status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown';
}

export function isWeakFingerprintContact(job) {
  const step = normalizeEnrollmentText(job?.current_step);
  return step.includes('too small')
    || step.includes('low quality')
    || step.includes('image quality too low')
    || step.includes('could not extract features')
    || step.includes('finger moved')
    || step.includes('reposition the finger')
    || step.includes('hold the center of the finger')
    || step.includes('cover more of the sensor');
}

export function getWeakFingerprintContactHint(job) {
  if (!isWeakFingerprintContact(job)) return null;
  return 'Scan quality is not good enough yet. Keep this finger flat and centered on the sensor. This step stays open until a good capture is taken.';
}

export function hasEnrollmentFinalVerification(job) {
  const status = normalizeEnrollmentText(job?.status);
  const step = normalizeEnrollmentText(job?.current_step);
  return status === 'stored_pending_commit' || status === 'needs_reconciliation'
    || hasVerifiedEnrollment(job)
    || step.includes('stored on sensor')
    || step.includes('confirming')
    || step.includes('committing')
    || step.includes('final verification')
    || step.includes('verification scan')
    || step.includes('verifying against')
    || step.includes('verification successful')
    || step.includes('waiting for download')
    || step.includes('stored at slot')
    || step.includes('reading template')
    || step.includes('search matched')
    || step.includes('fingerprint verified at sensor slot')
    || step.includes('completing without extra verification');
}

export function getEnrollmentFinalVerificationHint(job) {
  const status = normalizeEnrollmentText(job?.status);
  if (status === 'completed') {
    return hasVerifiedEnrollment(job)
      ? 'Sensor A storage and the database mapping are confirmed. Sensor B sync is tracked separately.'
      : 'This historical completion has no confirmed Sensor A mapping. Update the enrollment to verify the saved fingerprint.';
  }
  const step = normalizeEnrollmentText(job?.current_step);
  // Third-scan live verification phase (progress 96-99).
  if (step.includes('verification scan') || step.includes('verifying against')
    || step.includes('verification successful')) {
    if (step.includes('did not match')) {
      return 'That scan did not match the new slot yet. Lift the finger, then place the SAME finger flat and centered, the way you did for scans 1 and 2.';
    }
    if (step.includes('remove finger')) {
      return 'Lift your finger completely off the sensor. The verification scan must use a fresh capture, not the previous scan.';
    }
    if (step.includes('place the enrolled finger') || step.includes('on verification scan') || step.includes('for verification scan') || step.includes('during verification scan')) {
      return 'Place the SAME finger you just enrolled. Sensor A will search its full library and only accept the slot it just stored.';
    }
    if (step.includes('verifying against')) {
      return 'Sensor A is comparing this scan with the newly stored slot (1:1 match), then with the library if needed. Only the newly enrolled slot is accepted.';
    }
    if (step.includes('verification successful')) {
      return 'Verification passed. Sensor A confirmed the enrolled slot. The stored template is being prepared for download.';
    }
    return 'Sensor A is verifying the enrolled finger with a fresh scan. Keep the finger still until the result is shown.';
  }
  if (status === 'stored_pending_commit') {
    if (hasIdentifyMatch(job)) {
      return 'Sensor A stored this fingerprint and the verification scan matched the enrolled slot. Download this exact slot template to save it.';
    }
    if (step.includes('reading template') || step.includes('identified slot')) {
      return 'Sensor A is reading the stored slot so the download window can open.';
    }
    return 'Sensor A stored this fingerprint. Wait for the stored-slot template, then download it. The door can use it only after Download.';
  }
  if (status === 'needs_reconciliation') {
    return 'This enrollment did not finish. Use Retry to start a fresh two-scan enrollment. Clear any leftover slot in Sensor Memory if it still shows occupied.';
  }
  if (!hasEnrollmentFinalVerification(job)) return null;
  if (hasIdentifyMatch(job) || step.includes('waiting for download') || step.includes('stored at slot')) {
    return 'Sensor A stored this fingerprint. Download this exact slot template to save it in the database and on this PC.';
  }
  if (step.includes('reading template') || step.includes('identified slot')) {
    return 'Sensor A is reading the stored slot so the download window can open.';
  }
  if (step.includes('remove') || step.includes('lift')) {
    return 'Lift your finger completely off the sensor before the next confirmed step.';
  }
  return 'Sensor A stored this fingerprint. Download the stored-slot template to finish enrollment.';
}

export function getEnrollmentProgressValue(job) {
  const status = normalizeEnrollmentText(job?.status);
  if (status === 'completed') return 100;
  if (hasIdentifyMatch(job)) return Math.max(95, Math.min(99, Number(job?.progress) || 95));
  if (status === 'stored_pending_commit' || status === 'needs_reconciliation') {
    // 85 = stored, 86-93 = third scan + template read, never above 94 until
    // the stored-slot template is confirmed for download.
    return Math.max(80, Math.min(94, Number(job?.progress) || 85));
  }
  return Math.max(0, Math.min(99, Number(job?.progress) || 0));
}

export function resolveEnrollmentStageKey(job) {
  if (!job) return 'waiting';
  const status = normalizeEnrollmentText(job.status);
  const step = normalizeEnrollmentText(job.current_step);
  const progress = getEnrollmentProgressValue(job);

  if (status === 'completed') return 'complete';
  if (hasIdentifyMatch(job) || step.includes('waiting for download') || isTemplateReadStep(job)) return 'download';
  // The third scan reports "... verification scan ..." steps. Status may
  // already be stored_pending_commit here (Store happened before the third
  // scan), so the step text decides, not the status.
  if (isVerificationScanStep(job)) return 'verify';
  const rawProgress = Math.max(0, Math.min(99, Number(job?.progress) || 0));
  if (['processing', 'stored_pending_commit'].includes(status)
    && rawProgress >= VERIFY_PROGRESS_START && rawProgress < DOWNLOAD_PROGRESS_START
    && !step.includes('stored at slot')) {
    return 'verify';
  }
  if (isWeakFingerprintContact(job)) {
    if (rawProgress >= VERIFY_PROGRESS_START) return 'verify';
    if (progress >= 85) return 'stored';
    if (progress >= 50) return 'place-second';
    if (progress >= 10) return 'place-first';
  }
  if (status === 'stored_pending_commit') return 'stored';
  if (status === 'needs_reconciliation' || status === 'failed' || status === 'cancelled') {
    if (progress >= 85) return 'stored';
    if (progress >= 80) return 'create-model';
    if (progress >= 50) return 'place-second';
    return progress >= 5 ? 'claimed' : 'waiting';
  }
  if (step.includes('stored')) return 'stored';
  if (step.includes('creating model') || step.includes('generat') || step.includes('model') || step.includes('storing on sensor')) {
    return 'create-model';
  }
  if (step.includes('image taken') && progress >= 50) return 'place-second';
  if (step.includes('same finger') || step.includes('again') || step.includes('second') || step.includes('2nd')) {
    return 'place-second';
  }
  if (step.includes('remove') || step.includes('lift')) return 'remove';
  if (step.includes('place') || step.includes('first scan') || step.includes('image taken') || step.includes('reader') || step.includes('sensor')) {
    return 'place-first';
  }
  if (step.includes('claim') || step.includes('start')) return 'claimed';
  if (progress >= 85) return 'stored';
  if (progress >= 80) return 'create-model';
  if (progress >= 50) return 'place-second';
  if (progress >= 35) return 'remove';
  if (progress >= 10) return 'place-first';
  return progress >= 5 || status === 'processing' ? 'claimed' : 'waiting';
}

export function getEnrollmentGuide(job) {
  const stage = resolveEnrollmentStageKey(job);
  const index = Math.max(0, enrollmentGuideSteps.findIndex((step) => step.key === stage));
  const current = enrollmentGuideSteps[Math.min(index, enrollmentGuideSteps.length - 1)];
  return {
    stage,
    stepNumber: ['waiting', 'claimed'].includes(stage) ? 1 : Math.min(index + 1, enrollmentGuideSteps.length),
    stepCount: enrollmentGuideSteps.length,
    title: current.label,
    detail: current.detail,
    progress: getEnrollmentProgressValue(job),
  };
}

export function isLiveEnrollmentJob(job) {
  return Boolean(job?.is_live) || ['waiting', 'processing', 'stored_pending_commit', 'needs_reconciliation'].includes(normalizeEnrollmentText(job?.status));
}

export function canCancelEnrollment(job) {
  const jobId = Number(job?.job_id);
  if (!Number.isInteger(jobId) || jobId <= 0) {
    return false;
  }
  if (job?.can_cancel === true) {
    return true;
  }
  return isLiveEnrollmentJob(job);
}

export function enrollmentCancelConfirmMessage(job) {
  const status = normalizeEnrollmentText(job?.status);
  const late = ['stored_pending_commit', 'needs_reconciliation'].includes(status)
    || Number(job?.progress) >= 85
    || Boolean(job?.identify_match);
  if (late) {
    return 'Cancel this enrollment even though Sensor A may already have stored a template? The database job will roll back and the slot will be marked for cleanup; clear it from Sensor Memory if it still shows occupied. You will need to start enrollment again.';
  }
  return 'Cancel this enrollment? Incomplete progress will be rolled back and you can start again.';
}

export const ENROLLMENT_STALE_TIMEOUT_SECONDS = 600;

export function getEnrollmentPickupRemainingSeconds(job, now = Date.now()) {
  if (!['waiting', 'processing', 'stored_pending_commit', 'needs_reconciliation']
    .includes(String(job?.status || '').trim().toLowerCase())) return null;
  const queuedAt = parseManilaDateTime(job?.updated_at || job?.created_at).getTime();
  if (!Number.isFinite(queuedAt) || !Number.isFinite(now)) return null;

  return Math.max(0, Math.min(
    ENROLLMENT_STALE_TIMEOUT_SECONDS,
    Math.ceil((queuedAt + ENROLLMENT_STALE_TIMEOUT_SECONDS * 1000 - now) / 1000),
  ));
}

export function isEnrollmentCountdownLive(job, now = Date.now()) {
  const remaining = getEnrollmentPickupRemainingSeconds(job, now);
  return remaining !== null && remaining > 0;
}

export function findLiveEnrollmentJob(jobs, { userId, fingerName } = {}, now = Date.now()) {
  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid <= 0) return null;
  const live = (Array.isArray(jobs) ? jobs : []).filter((job) =>
    Number(job?.user_id) === uid && isEnrollmentCountdownLive(job, now)
  );
  const requested = String(fingerName || '').trim();
  if (requested && requested.toLowerCase() !== 'pending enrollment') {
    const named = live.find((job) => String(job?.finger_name || '').trim() === requested);
    if (named) return named;
  }
  return live[0] || null;
}

export function findIdentifyMatchJob(jobs) {
  const matches = (Array.isArray(jobs) ? jobs : []).filter((job) => hasIdentifyMatch(job));
  if (!matches.length) return null;
  return matches.sort((left, right) => {
    const rightTime = parseManilaDateTime(right?.updated_at || right?.created_at).getTime();
    const leftTime = parseManilaDateTime(left?.updated_at || left?.created_at).getTime();
    const safeRight = Number.isFinite(rightTime) ? rightTime : 0;
    const safeLeft = Number.isFinite(leftTime) ? leftTime : 0;
    return safeRight - safeLeft || Number(right?.job_id || 0) - Number(left?.job_id || 0);
  })[0];
}

export function getEnrollmentRowAction(fingerprint, jobs, now = Date.now()) {
  const job = findLiveEnrollmentJob(jobs, {
    userId: fingerprint?.userId,
    fingerName: fingerprint?.fingerName,
  }, now);
  if (job) return { kind: 'view-progress', label: 'View Progress', job };
  const isUpdate = fingerprint?.status === 'active';
  return { kind: isUpdate ? 'update' : 'enroll', label: isUpdate ? 'Update' : 'Enroll', job: null };
}
