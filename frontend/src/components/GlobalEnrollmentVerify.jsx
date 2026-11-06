import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import axiosClient from '../api/axiosClient';
import entrivoLogo from '../assets/images/entrivo_logo.png';
import '../styles/shared/enrollmentIdentifyMatch.css';

const POLL_MS = 800;

function isLive(verify) {
  return verify && ['pending', 'processing'].includes(String(verify.status || ''));
}

function GlobalEnrollmentVerifyDialog() {
  const [verify, setVerify] = useState(null);
  const [dismissedId, setDismissedId] = useState(null);
  const [enrollmentJobId, setEnrollmentJobId] = useState(null);

  const loadVerify = useCallback(async () => {
    try {
      const response = await axiosClient.get('/api/fingerprint/enrollment_verify.php', {
        params: enrollmentJobId ? { enrollment_job_id: enrollmentJobId } : {},
      });
      const next = response.data?.verify || null;
      setVerify((current) => {
        if (!next) return current && isLive(current) ? current : null;
        if (current && current.verify_job_id === next.verify_job_id
          && current.status === next.status
          && current.current_step === next.current_step) {
          return current;
        }
        return next;
      });
    } catch {
      // Keep the last verify job visible if a poll fails.
    }
  }, [enrollmentJobId]);

  useEffect(() => {
    function onDownloaded(event) {
      const jobId = Number(event.detail?.jobId);
      if (Number.isInteger(jobId) && jobId > 0) setEnrollmentJobId(jobId);
    }
    window.addEventListener('entrivo:enrollment-downloaded', onDownloaded);
    return () => window.removeEventListener('entrivo:enrollment-downloaded', onDownloaded);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      if (cancelled) return;
      await loadVerify();
    }
    poll();
    const timer = window.setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loadVerify]);

  const visible = verify && verify.verify_job_id !== dismissedId ? verify : null;
  if (!visible) return null;

  const identified = visible.identified === true;
  const finished = ['completed', 'failed', 'cancelled'].includes(visible.status);

  return createPortal(
    <div className="fingerprint-identify-match-overlay">
      <section className="fingerprint-identify-match-modal" role="dialog" aria-modal="true" aria-label="Enrollment verification">
        <div className="fingerprint-progress-modal-header">
          <div className="fingerprint-progress-title-wrap">
            <div className="fingerprint-progress-brand-mark" aria-hidden="true">
              <img src={entrivoLogo} alt="" />
            </div>
            <div className="fingerprint-progress-header-copy">
              <h3>{finished ? (identified ? 'Fingerprint identified' : 'Fingerprint not identified') : 'Verify enrollment'}</h3>
              <p>{visible.user_name || 'This user'} · {visible.finger_name || 'Fingerprint'}</p>
            </div>
          </div>
          <button type="button" className="fingerprint-modal-close" onClick={() => setDismissedId(visible.verify_job_id)} aria-label="Close dialog">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="fingerprint-identify-match-body">
          <p>
            {finished
              ? (identified
                ? 'Sensor A identified this enrollment. The result was saved to Access Logs as Verify. The door stayed locked.'
                : (visible.error_message || 'Sensor A did not identify this enrollment. The stored template was kept. The door stayed locked.'))
              : 'Download finished. Place the same finger on Sensor A. This check only identifies the user, slot, and confidence. The door stays locked.'}
          </p>
          <dl className="fingerprint-identify-match-facts">
            <div>
              <dt>User</dt>
              <dd>{visible.user_name || '—'}</dd>
            </div>
            <div>
              <dt>Slot</dt>
              <dd>{visible.matched_slot || visible.target_slot || '—'}</dd>
            </div>
            <div>
              <dt>Confidence</dt>
              <dd>{visible.confidence != null ? visible.confidence : (finished ? '—' : 'Waiting')}</dd>
            </div>
          </dl>
          <p className="fingerprint-identify-match-format-note">{visible.current_step}</p>
        </div>
        <div className="fingerprint-identify-match-actions">
          <button type="button" className="fingerprint-secondary-action" onClick={() => setDismissedId(visible.verify_job_id)}>
            Close
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

export default function GlobalEnrollmentVerify() {
  return <GlobalEnrollmentVerifyDialog />;
}
