import { X } from 'lucide-react';

export default function PortalToast({
  title = 'Notice',
  message,
  type = 'success',
  onClose,
}) {
  if (!message) {
    return null;
  }

  return (
    <div className="user-portal-toast-stack" aria-live="polite" aria-atomic="true">
      <div
        className={`user-portal-toast user-portal-toast-${type}`}
        role={type === 'error' ? 'alert' : 'status'}
      >
        <div className="user-portal-toast-copy">
          <strong>{title}</strong>
          <p>{message}</p>
        </div>
        {onClose ? (
          <button
            type="button"
            className="user-portal-toast-close"
            aria-label="Dismiss notice"
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
