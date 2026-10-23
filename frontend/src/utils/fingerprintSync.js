import { parseManilaDateTime } from './dateTime.js';

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

export function getSyncJobStatus(job) {
  const status = normalize(job?.status);
  const cancelled = job?.is_cancelled === true || job?.is_cancelled === 1 || job?.is_cancelled === '1';

  if (status === 'cancelled' || (status === 'failed' && cancelled)) {
    return 'cancelled';
  }

  return status;
}

export function getSyncPickupRemainingSeconds(job, now = Date.now()) {
  if (getSyncJobStatus(job) !== 'pending') {
    return null;
  }

  const queuedAt = parseManilaDateTime(job?.queued_at).getTime();

  if (!Number.isFinite(queuedAt) || !Number.isFinite(now)) {
    return null;
  }

  const seconds = Math.ceil((queuedAt + 5 * 60 * 1000 - now) / 1000);
  return Math.max(0, Math.min(5 * 60, seconds));
}

export function isSyncPickupTimeoutCancellation(job) {
  return getSyncJobStatus(job) === 'cancelled' && normalize(job?.cancellation_reason) === 'pickup_timeout';
}

export function getSyncCancellationReason(job) {
  const reason = String(job?.error_message || '').trim();

  if (reason) {
    return reason;
  }

  if (!isSyncPickupTimeoutCancellation(job)) {
    return 'This sync was cancelled before it completed.';
  }

  if (job?.controller_issue === 'not_registered') {
    return 'No door controller is registered for this sync. It was cancelled after waiting 5 minutes. Register and activate a door controller, then retry the sync.';
  }

  if (job?.controller_issue === 'inactive') {
    return 'The door controller is inactive and did not pick up this sync within 5 minutes. Activate the controller and check its connection, then retry the sync.';
  }

  return 'No door controller picked up this sync within 5 minutes. The controller may be disconnected or unreachable. Check its power, network connection, and active status, then retry the sync.';
}

export function getSyncCancellationEventKey(job) {
  const queueId = job?.queue_id || job?.id;
  // Retrying a job reuses its queue ID, but starts a new queued_at timestamp.
  const attempt = job?.queued_at || job?.cancelled_at || job?.updated_at;

  return queueId && attempt ? `${queueId}:${attempt}` : '';
}

export function getUnseenSyncPickupTimeouts(jobs, seenKeys) {
  const seen = new Set(seenKeys);

  return jobs.filter((job) => {
    const key = getSyncCancellationEventKey(job);

    if (!isSyncPickupTimeoutCancellation(job) || !key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

export function getSyncCancellationNoticeMessage(jobs) {
  if (jobs.length === 1) {
    const job = jobs[0];
    const person = [job.user_name, job.finger_name].filter(Boolean).join(' · ');
    return `Queue #${job.queue_id || job.id}${person ? ` (${person})` : ''}: ${getSyncCancellationReason(job)}`;
  }

  const queues = jobs.map((job) => `#${job.queue_id || job.id}`).join(', ');
  const reasons = [...new Set(jobs.map(getSyncCancellationReason))];
  return `${jobs.length} sync jobs were cancelled (queues ${queues}). ${reasons.join(' ')} Review Sync Jobs for each affected fingerprint.`;
}
