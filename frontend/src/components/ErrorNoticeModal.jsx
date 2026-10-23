import { createPortal } from 'react-dom';
import '../styles/shared/actionConfirm.css';

export default function ErrorNoticeModal({
  open,
  title = 'Unable to complete',
  message,
  onClose,
  confirmLabel = 'OK',
}) {
  if (!open || !message) {
    return null;
  }

  return createPortal(
    <div className="action-confirm-backdrop" role="presentation" onClick={onClose}>
      <section
        className="action-confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="error-notice-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="error-notice-title">{title}</h2>
        <p>{message}</p>
        <div className="action-confirm-actions">
          <button type="button" onClick={onClose}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
