import { useEffect, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import axiosClient from '../api/axiosClient';
import '../styles/superAdmin/deleteRequests.css';

export default function DeleteRequestModal({
  open,
  actorId,
  targetType,
  targetId,
  targetLabel,
  detail = '',
  onClose,
  onSubmitted,
}) {
  const [reason, setReason] = useState('');
  const [proof, setProof] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    setReason('');
    setProof(null);
    setPreviewUrl('');
    setError('');
    setIsSubmitting(false);

    function onKeyDown(event) {
      if (event.key === 'Escape' && !isSubmitting) {
        onClose?.();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!proof) {
      setPreviewUrl('');
      return undefined;
    }

    const url = URL.createObjectURL(proof);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [proof]);

  if (!open) {
    return null;
  }

  function chooseProof(file) {
    setError('');
    if (!file) {
      setProof(null);
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      setError('Upload a PNG, JPG, WEBP, or GIF screenshot.');
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setError('The screenshot must be 4 MB or smaller.');
      return;
    }
    setProof(file);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const trimmed = reason.trim();
    if (trimmed.length < 8) {
      setError('Enter a reason of at least 8 characters.');
      return;
    }
    if (!proof) {
      setError('Attach a screenshot that shows why this should be deleted.');
      return;
    }

    const body = new FormData();
    body.append('actorId', String(actorId || ''));
    body.append('targetType', targetType);
    body.append('targetId', String(targetId));
    body.append('targetLabel', targetLabel);
    body.append('reason', trimmed);
    body.append('proof', proof);

    setIsSubmitting(true);
    setError('');
    try {
      const response = await axiosClient.post('/api/delete_requests.php', body);
      onSubmitted?.(response.data?.message || 'Delete request sent for Super Admin review.');
      onClose?.();
    } catch (requestError) {
      setError(requestError?.response?.data?.message || 'Unable to send the delete request.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="delete-request-backdrop" role="presentation" onClick={() => !isSubmitting && onClose?.()}>
      <form
        className="delete-request-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-request-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <header>
          <div>
            <h2 id="delete-request-title">Request deletion</h2>
            <p>This stays in place until a Super Admin approves it.</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} disabled={isSubmitting}>
            <X size={16} />
          </button>
        </header>

        <div className="delete-request-subject">
          <strong>{targetLabel}</strong>
          {detail ? <span>{detail}</span> : null}
        </div>

        <label className="delete-request-field">
          <span>Reason</span>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Explain why this record should be removed."
            rows={4}
            maxLength={1000}
            required
          />
        </label>

        <div className="delete-request-field">
          <span>Proof screenshot</span>
          <label className="delete-request-proof">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(event) => chooseProof(event.target.files?.[0] || null)}
            />
            {previewUrl ? (
              <img src={previewUrl} alt="Selected proof screenshot" />
            ) : (
              <span className="delete-request-proof-empty">
                <ImagePlus size={18} />
                Upload a screenshot
              </span>
            )}
          </label>
        </div>

        {error ? <p className="delete-request-error">{error}</p> : null}

        <footer>
          <button type="button" className="delete-request-cancel" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </button>
          <button type="submit" className="delete-request-submit" disabled={isSubmitting}>
            {isSubmitting ? 'Sending...' : 'Send request'}
          </button>
        </footer>
      </form>
    </div>
  );
}
