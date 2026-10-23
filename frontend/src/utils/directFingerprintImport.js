import { parseManilaDateTime } from './dateTime.js';

const SUPPORTED_TEMPLATE_BYTES = new Set([512, 768, 1024, 1536]);

export function isDirectImportJobActive(job) {
  return ['pending', 'processing'].includes(String(job?.status || '').toLowerCase());
}

export function getDirectImportFormResetDelay(job, now = Date.now()) {
  if (!['cancelled', 'completed'].includes(String(job?.status || '').toLowerCase()) || !Number.isFinite(now)) return null;
  const finishedAt = parseManilaDateTime(job?.finished_at).getTime();
  if (!Number.isFinite(finishedAt)) return 60_000;

  return Math.max(0, Math.min(60_000, finishedAt + 60_000 - now));
}

export function getDirectImportRetryTarget(job) {
  if (String(job?.status || '').toLowerCase() !== 'cancelled') return null;
  const employeeId = typeof job.employee_id === 'string' ? job.employee_id.trim() : '';
  const fingerprintId = Number(job.fingerprint_id);
  const deviceId = Number(job.enrollment_device_id);
  if (!employeeId || !Number.isInteger(fingerprintId) || fingerprintId <= 0 || !Number.isInteger(deviceId) || deviceId <= 0) return null;

  return { employee_id: employeeId, fingerprint_id: fingerprintId, enrollment_device_id: deviceId };
}

export function getDirectImportPickupRemainingSeconds(job, now = Date.now()) {
  if (String(job?.status || '').toLowerCase() !== 'pending') return null;

  const queuedAt = parseManilaDateTime(job?.queued_at).getTime();
  if (!Number.isFinite(queuedAt) || !Number.isFinite(now)) return null;

  return Math.max(0, Math.min(180, Math.ceil((queuedAt + 180_000 - now) / 1000)));
}

export function getDirectImportBlockReason(user, backup) {
  if (!user || !backup) {
    return 'Search for an employee and select a saved fingerprint first.';
  }
  if (String(user.status || '').toLowerCase() !== 'active') {
    return 'This account is inactive. Activate the account before importing a fingerprint.';
  }
  if (user.approval_status && user.approval_status !== 'approved') {
    return 'This account has not been approved for fingerprint access.';
  }
  if (backup.can_import === false) {
    return backup.unavailable_reason || 'This saved fingerprint cannot be imported. Choose another backup or enroll again.';
  }
  const fingerprintId = Number(backup.fingerprint_id);
  const templateBytes = Number(backup.template_bytes);
  if (!Number.isInteger(fingerprintId) || fingerprintId <= 0 || !SUPPORTED_TEMPLATE_BYTES.has(templateBytes)) {
    return 'This fingerprint does not have a valid saved backup. Enroll the fingerprint again.';
  }
  return '';
}

export function getDirectImportJobPresentation(job) {
  const status = String(job?.status || '').toLowerCase();
  const progress = Math.max(0, Math.min(99, Number(job?.progress) || 0));
  const step = String(job?.current_step || job?.progress_step || '').trim();

  if (status === 'completed') {
    const slot = Number(job?.assigned_slot || job?.target_slot);
    return {
      title: 'Import complete',
      detail: `Sensor A confirmed the fingerprint was stored${slot > 0 ? ` in slot ${slot}` : ''}. Door access follows account status and schedules.`,
      progress: 100,
      tone: 'complete',
    };
  }
  if (status === 'failed' || status === 'cancelled') {
    return {
      title: status === 'cancelled' ? 'Import cancelled' : 'Import failed',
      detail: job?.error_message || 'Sensor A did not confirm a successful import. Check the device and its connection, then try again.',
      progress,
      tone: 'failed',
    };
  }
  if (status === 'processing') {
    return {
      title: 'Writing to Sensor A',
      detail: step || 'Sensor A is storing the saved fingerprint. Keep the device powered while it confirms the write.',
      progress,
      tone: 'processing',
    };
  }
  return {
    title: 'Waiting for Sensor A',
    detail: `${step || 'Waiting for Sensor A'}. This import is automatically cancelled if Sensor A does not pick it up within 3 minutes.`,
    progress,
    tone: 'pending',
  };
}
