import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import '../styles/superAdmin/deleteRequests.css';

export default function DeleteRequestToast({
  message,
  title = 'Notice',
  type = 'success',
  onClose,
}) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!message) {
      return undefined;
    }
    const timeoutId = window.setTimeout(() => onCloseRef.current?.(), 4000);
    return () => window.clearTimeout(timeoutId);
  }, [message]);

  if (!message) {
    return null;
  }

  return (
    <div className="delete-request-toast-stack" aria-live="polite" aria-atomic="true">
      <div
        className={`delete-request-toast delete-request-toast-${type}`}
        role={type === 'error' ? 'alert' : 'status'}
      >
        <div className="delete-request-toast-copy">
          <strong>{title}</strong>
          <p>{message}</p>
        </div>
        {onClose ? (
          <button
            type="button"
            className="delete-request-toast-close"
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
