import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, X } from 'lucide-react';
import axiosClient from '../api/axiosClient';
import { ActionConfirmProvider, useActionConfirm } from './ActionConfirm';
import entrivoLogo from '../assets/images/entrivo_logo.png';
import {
  canCancelEnrollment,
  enrollmentCancelConfirmMessage,
  findIdentifyMatchJob,
  hasIdentifyMatch,
} from '../utils/fingerprintEnrollment';
import { canDeleteRecords, userHasPrivilege } from '../utils/privileges';
import '../styles/shared/enrollmentIdentifyMatch.css';

const POLL_MS = 800;

function downloadMatchedTemplateFile(job, fingerprintId) {
  const match = job.identify_match;
  const templatePayload = {
    fingerprint_id: fingerprintId || job.fingerprint_id,
    user_id: job.user_id,
    finger_name: job.finger_name,
    enrollment_slot: match.matched_slot,
    template_bytes: match.template_bytes,
    template_sha256: match.template_sha256,
    template_data_base64: match.template_data_base64,
    exported_at: new Date().toISOString(),
  };
  const fileName = `${job.user_name || 'fingerprint'}-${job.finger_name || 'template'}-${templatePayload.fingerprint_id || job.job_id}.json`
    .replace(/[^\w.-]+/g, '_')
    .toLowerCase();
  const blob = new Blob([JSON.stringify({ fingerprint: templatePayload }, null, 2)], {
    type: 'application/json',
  });
  const downloadUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(downloadUrl);
}

function GlobalEnrollmentIdentifyMatchDialog({ user }) {
  const confirmAction = useActionConfirm();
  const [job, setJob] = useState(null);
  const [dismissedJobId, setDismissedJobId] = useState(null);
  const [templateFormat, setTemplateFormat] = useState('hex');
  const [isDownloading, setIsDownloading] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const loadMatchedJob = useCallback(async () => {
    try {
      const response = await axiosClient.get('/api/fingerprint/get_enrollment_jobs.php', {
        params: { limit: 50 },
      });
      const nextJob = findIdentifyMatchJob(response.data?.jobs);
      setJob((current) => {
        if (!nextJob) return null;
        if (
          current
          && current.job_id === nextJob.job_id
          && JSON.stringify(current.identify_match) === JSON.stringify(nextJob.identify_match)
        ) {
          return current;
        }
        return nextJob;
      });
    } catch {
      // Keep the last matched job visible if a poll fails.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      if (cancelled) return;
      await loadMatchedJob();
    }
    poll();
    const timer = window.setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loadMatchedJob]);

  useEffect(() => {
    if (job?.job_id && job.job_id !== dismissedJobId) {
      setErrorMessage('');
    }
  }, [dismissedJobId, job?.job_id]);

  useEffect(() => {
    function onCancelled(event) {
      const jobId = Number(event.detail?.jobId);
      if (!Number.isInteger(jobId) || jobId <= 0 || job?.job_id !== jobId) {
        return;
      }
      setDismissedJobId(jobId);
      setJob(null);
    }
    window.addEventListener('entrivo:enrollment-cancelled', onCancelled);
    return () => window.removeEventListener('entrivo:enrollment-cancelled', onCancelled);
  }, [job?.job_id]);

  const visibleJob = job && hasIdentifyMatch(job) && job.job_id !== dismissedJobId ? job : null;
  if (!visibleJob) {
    return null;
  }

  const busy = isDownloading || isCancelling;
  const canCancel = userHasPrivilege(user, 'fingerprint_update') && canCancelEnrollment(visibleJob);

  async function handleDownload() {
    if (!canDeleteRecords(user)) {
      setErrorMessage('Only a Super Admin can download the stored-slot template into the database and a PC backup.');
      return;
    }
    setIsDownloading(true);
    setErrorMessage('');
    try {
      const response = await axiosClient.post('/api/fingerprint/commit_enrollment_download.php', {
        job_id: visibleJob.job_id,
        actor_id: user?.id || undefined,
      });
      if (!response.data?.success) {
        throw new Error(response.data?.message || 'Unable to save the stored fingerprint template.');
      }
      downloadMatchedTemplateFile(visibleJob, response.data?.fingerprint?.fingerprint_id);
      window.dispatchEvent(new CustomEvent('entrivo:enrollment-downloaded', {
        detail: { jobId: visibleJob.job_id },
      }));
      setDismissedJobId(visibleJob.job_id);
      setJob(null);
    } catch (error) {
      setErrorMessage(error.response?.data?.message || error.message || 'Unable to download the stored template.');
    } finally {
      setIsDownloading(false);
    }
  }

  async function handleCancel() {
    if (!canCancel) {
      setErrorMessage('You do not have permission to cancel this enrollment.');
      return;
    }
    const confirmed = await confirmAction({
      title: 'Cancel enrollment',
      message: enrollmentCancelConfirmMessage(visibleJob),
      danger: true,
    });
    if (!confirmed) {
      return;
    }
    setIsCancelling(true);
    setErrorMessage('');
    try {
      const response = await axiosClient.post('/api/fingerprint/cancel_job.php', {
        job_id: visibleJob.job_id,
        reason: 'Cancelled by admin from the stored-template dialog.',
        actor_id: user?.id || undefined,
      });
      if (!response.data?.success) {
        throw new Error(response.data?.message || 'Unable to cancel that enrollment job.');
      }
      window.dispatchEvent(new CustomEvent('entrivo:enrollment-cancelled', {
        detail: { jobId: visibleJob.job_id },
      }));
      setDismissedJobId(visibleJob.job_id);
      setJob(null);
    } catch (error) {
      setErrorMessage(error.response?.data?.message || error.message || 'Unable to cancel that enrollment job.');
    } finally {
      setIsCancelling(false);
    }
  }

  return createPortal(
    <div className="fingerprint-identify-match-overlay">
      <section
        className="fingerprint-identify-match-modal"
        role="dialog"
        aria-modal="true"
                aria-label={`Stored template for ${visibleJob.user_name || 'this user'}`}
      >
        <div className="fingerprint-progress-modal-header">
          <div className="fingerprint-progress-title-wrap">
            <div className="fingerprint-progress-brand-mark" aria-hidden="true">
              <img src={entrivoLogo} alt="" />
            </div>
            <div className="fingerprint-progress-header-copy">
              <h3>Stored at slot {visibleJob.identify_match.matched_slot || visibleJob.assigned_slot}</h3>
              <p>
                {visibleJob.user_name || 'This user'}
                {' · '}
                {visibleJob.finger_name || 'Fingerprint'}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="fingerprint-modal-close"
            onClick={() => setDismissedJobId(visibleJob.job_id)}
            aria-label="Close dialog"
            disabled={busy}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="fingerprint-identify-match-body">
          <p>Sensor A successfully stored this fingerprint. Download uses the exact R307S template from that slot. If Store had failed, this window would not open and enrollment would need a restart.</p>
          {errorMessage ? <p className="fingerprint-identify-match-error">{errorMessage}</p> : null}
          <dl className="fingerprint-identify-match-facts">
            <div>
              <dt>Stored slot</dt>
              <dd>{visibleJob.identify_match.matched_slot || visibleJob.assigned_slot}</dd>
            </div>
            <div>
              <dt>Template size</dt>
              <dd>{visibleJob.identify_match.template_bytes} bytes</dd>
            </div>
            <div>
              <dt>SHA-256</dt>
              <dd title={visibleJob.identify_match.template_sha256}>{String(visibleJob.identify_match.template_sha256 || '').slice(0, 12)}…</dd>
            </div>
          </dl>
          <label className="fingerprint-identify-match-format" htmlFor="global-identify-template-format">
            View stored bytes as
            <select
              id="global-identify-template-format"
              value={templateFormat}
              onChange={(event) => setTemplateFormat(event.target.value)}
              disabled={busy}
            >
              <option value="hex">Hex</option>
              <option value="base64">Base64</option>
            </select>
          </label>
          <textarea
            aria-label={`Stored Sensor A template in ${templateFormat}`}
            value={templateFormat === 'hex'
              ? visibleJob.identify_match.template_data_hex || ''
              : visibleJob.identify_match.template_data_base64}
            readOnly
            rows={8}
            spellCheck={false}
          />
          <p className="fingerprint-identify-match-format-note">Hex and Base64 are two encodings of the same stored slot. Download always saves the JSON backup.</p>
        </div>
        <div className="fingerprint-identify-match-actions">
          {canDeleteRecords(user) ? (
            <button type="button" className="fingerprint-primary-action" onClick={handleDownload} disabled={busy}>
              <Download size={14} aria-hidden="true" />
              {isDownloading ? 'Downloading...' : 'Download'}
            </button>
          ) : (
            <p>A Super Admin must download this stored-slot template to finish enrollment.</p>
          )}
          {canCancel ? (
            <button
              type="button"
              className="fingerprint-secondary-action fingerprint-danger-action"
              onClick={handleCancel}
              disabled={busy}
            >
              {isCancelling ? 'Cancelling...' : 'Cancel'}
            </button>
          ) : null}
          <button
            type="button"
            className="fingerprint-secondary-action"
            onClick={() => setDismissedJobId(visibleJob.job_id)}
            disabled={busy}
          >
            Close
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

export default function GlobalEnrollmentIdentifyMatch({ user }) {
  return (
    <ActionConfirmProvider user={user}>
      <GlobalEnrollmentIdentifyMatchDialog user={user} />
    </ActionConfirmProvider>
  );
}
