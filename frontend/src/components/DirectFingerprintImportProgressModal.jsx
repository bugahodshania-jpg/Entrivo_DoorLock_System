import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, Clock, Database, Fingerprint, X } from 'lucide-react';
import { getDirectImportJobPresentation, getDirectImportPickupRemainingSeconds, isDirectImportJobActive } from '../utils/directFingerprintImport';
import '../styles/superAdmin/directFingerprintImport.css';

function ImportPickupCountdown({ job }) {
  const [, setTick] = useState(0);
  const remaining = getDirectImportPickupRemainingSeconds(job);
  const status = job?.status;
  const queuedAt = job?.queued_at;

  useEffect(() => {
    const pendingJob = { status, queued_at: queuedAt };
    const seconds = getDirectImportPickupRemainingSeconds(pendingJob);
    if (seconds === null || seconds === 0) return undefined;

    const intervalId = window.setInterval(() => {
      setTick(tick => tick + 1);
      if (getDirectImportPickupRemainingSeconds(pendingJob) === 0) window.clearInterval(intervalId);
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [queuedAt, status]);

  if (remaining === null) return null;
  const minutes = String(Math.floor(remaining / 60)).padStart(2, '0');
  const seconds = String(remaining % 60).padStart(2, '0');
  return <p className="fingerprint-import-countdown" role="timer">
    {remaining > 0
      ? `Automatic cancellation in ${minutes}:${seconds} if Sensor A does not respond.`
      : 'Three-minute wait ended. Checking Sensor A status...'}
  </p>;
}

export default function DirectFingerprintImportProgressModal({
  job, canImport, isRetryDisabled, isQueueing, isCancelling,
  actionError, pollError, onCancel, onRetry, onClose, onStartOver,
}) {
  const dialogRef = useRef(null);
  const activeJob = isDirectImportJobActive(job);
  const status = String(job.status || '').toLowerCase();
  const display = getDirectImportJobPresentation(job);
  const busy = isQueueing || isCancelling;
  const ProgressIcon = display.tone === 'complete' ? CheckCircle2
    : display.tone === 'failed' ? CircleAlert
      : display.tone === 'processing' ? Fingerprint : Clock;

  useEffect(() => {
    if (!dialogRef.current?.contains(document.activeElement)) dialogRef.current?.focus();
  }, [job.job_id, status]);

  function handleKeyDown(event) {
    if (event.key === 'Escape' && !busy) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
    if (event.key !== 'Tab') return;
    const controls = dialogRef.current.querySelectorAll('button:not([disabled]), [tabindex]:not([tabindex="-1"])');
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first) {
      event.preventDefault();
      return;
    }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) {
      event.preventDefault();
      first.focus();
    }
  }

  return <div className="fingerprint-modal-overlay fingerprint-import-progress-overlay">
    <section ref={dialogRef} className="fingerprint-modal fingerprint-import-progress-modal" role="dialog" aria-modal="true" aria-labelledby="direct-import-progress-title" aria-describedby="direct-import-progress-description" tabIndex={-1} onKeyDown={handleKeyDown}>
      <div className="fingerprint-modal-header">
        <div>
          <h3 id="direct-import-progress-title">Fingerprint import</h3>
          <p>Sensor A · Job #{job.job_id}</p>
        </div>
        <button type="button" className="fingerprint-modal-close" onClick={onClose} disabled={busy} aria-label="Close import progress">
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <section className={`fingerprint-import-progress is-${display.tone}`} aria-label="Sensor A import progress">
        <div className="fingerprint-import-progress-heading">
          <div><ProgressIcon size={18} aria-hidden="true" /><strong role="status">{display.title}</strong></div>
        </div>
        <p id="direct-import-progress-description">{display.detail}</p>
        <ImportPickupCountdown job={job} />
        <div className="fingerprint-live-progress" role="progressbar" aria-label="Fingerprint import" aria-valuenow={display.progress} aria-valuemin={0} aria-valuemax={100}>
          <div className="fingerprint-live-progress-bar" style={{ width: `${display.progress}%` }} />
        </div>
        <p className="fingerprint-import-progress-meta">{[job.user_name, job.employee_id, job.finger_name].filter(Boolean).join(' · ')}</p>
        {activeJob && <p className="fingerprint-import-progress-meta">You can close this window. The import continues, and you can reopen Import from database to see its progress.</p>}
        {['cancelled', 'completed'].includes(status) && <p className="fingerprint-import-progress-meta">This form resets automatically 1 minute after the import is cancelled or completed.</p>}
      </section>

      {pollError && <p className="fingerprint-import-notice fingerprint-import-notice-error" role="alert"><CircleAlert size={17} aria-hidden="true" />{pollError}</p>}
      {actionError && <p className="fingerprint-import-notice fingerprint-import-notice-error" role="alert"><CircleAlert size={17} aria-hidden="true" />{actionError}</p>}

      <div className="fingerprint-modal-actions">
        {activeJob && canImport && <button type="button" className="fingerprint-secondary-action fingerprint-danger-action" onClick={onCancel} disabled={busy}>
          <X size={15} aria-hidden="true" />
          {isCancelling ? 'Cancelling...' : 'Cancel Import'}
        </button>}
        {status === 'cancelled' && <button type="button" className="fingerprint-primary-action" onClick={onRetry} disabled={!canImport || isRetryDisabled || busy}>
          <Database size={15} aria-hidden="true" />
          {isQueueing ? 'Retrying...' : 'Retry'}
        </button>}
        {!activeJob && status !== 'cancelled' && <button type="button" className="fingerprint-secondary-action" onClick={onStartOver} disabled={busy}>Back to search</button>}
      </div>
    </section>
  </div>;
}
