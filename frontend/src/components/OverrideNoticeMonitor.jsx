import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CalendarClock } from 'lucide-react';
import useOverrideNotifications from '../hooks/useOverrideNotifications';
import { formatDateInManila, getManilaDateStamp, parseManilaDateTime } from '../utils/dateTime';
import '../styles/shared/actionConfirm.css';
import '../styles/shared/overrideNotice.css';

function windowLabel(startValue, endValue) {
  const start = parseManilaDateTime(startValue);
  const end = parseManilaDateTime(endValue);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 'See My Schedule for details.';

  const dateOptions = { month: 'short', day: 'numeric', year: 'numeric' };
  const timeOptions = { hour: 'numeric', minute: '2-digit', hour12: true };
  const startLabel = `${formatDateInManila(start, dateOptions)} · ${formatDateInManila(start, timeOptions)}`;
  const endLabel = getManilaDateStamp(start) === getManilaDateStamp(end)
    ? formatDateInManila(end, timeOptions)
    : `${formatDateInManila(end, dateOptions)} · ${formatDateInManila(end, timeOptions)}`;
  return `${startLabel} – ${endLabel}`;
}

export function OverrideNoticeModal({ notification, pendingCount, acknowledge, isAcknowledging, error }) {
  const modalRef = useRef(null);
  const buttonRef = useRef(null);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const appRoot = document.getElementById('root');
    const previousInert = appRoot?.inert;
    if (appRoot) appRoot.inert = true;
    document.body.style.overflow = 'hidden';
    buttonRef.current?.focus();

    function keepFocus(event) {
      if (event.key === 'Escape') {
        // Reviewing a notice is explicit; Escape must not dismiss a page behind it.
        event.stopImmediatePropagation();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = [...(modalRef.current?.querySelectorAll('button:not(:disabled), a[href], [tabindex="0"]') || [])];
      if (!controls.length) {
        event.preventDefault();
        modalRef.current?.focus();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !modalRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !modalRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', keepFocus, true);
    return () => {
      document.removeEventListener('keydown', keepFocus, true);
      document.body.style.overflow = previousOverflow;
      if (appRoot) appRoot.inert = previousInert;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [notification.id]);

  const affectedTimes = [...new Set((notification.affectedSchedules || []).map((schedule) =>
    windowLabel(schedule.overlapStart, schedule.overlapEnd),
  ))];

  return createPortal(
    <div className="action-confirm-backdrop override-notice-backdrop" role="presentation">
      <section
        className="action-confirm-modal override-notice-modal"
        ref={modalRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="override-notice-title"
        aria-describedby="override-notice-description"
        tabIndex={-1}
      >
        <div className="override-notice-heading">
          <span className="override-notice-icon" aria-hidden="true"><CalendarClock size={22} /></span>
          <div>
            <h2 id="override-notice-title">Schedule override</h2>
            <span className="override-notice-subtitle">Schedule update · Philippine time</span>
          </div>
        </div>
        <p id="override-notice-description">
          Your schedule has been affected because <strong>{notification.requesterName}</strong> was granted temporary access to the room.
          Review this notice before continuing to monitor your dashboard.
        </p>
        <dl className="override-notice-details">
          <div>
            <dt>Override time</dt>
            <dd>{windowLabel(notification.overrideStart, notification.overrideEnd)}</dd>
          </div>
          {affectedTimes.length ? (
            <div>
              <dt>Your affected time</dt>
              <dd>{affectedTimes.map((label) => <span key={label}>{label}</span>)}</dd>
            </div>
          ) : null}
          <div>
            <dt>Reason</dt>
            <dd className="override-notice-reason" tabIndex={0}>{notification.reason || 'No reason provided.'}</dd>
          </div>
        </dl>
        {error ? <p className="action-confirm-error" role="alert">{error}</p> : null}
        <div className="action-confirm-actions override-notice-actions">
          {pendingCount > 1 ? <small>{pendingCount} notices to review</small> : null}
          <button
            ref={buttonRef}
            type="button"
            disabled={isAcknowledging}
            onClick={() => { void acknowledge(notification.id); }}
          >
            {isAcknowledging ? 'Saving…' : 'Understood'}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

export default function OverrideNoticeMonitor({ user }) {
  const { notifications, acknowledge, isAcknowledging, error } = useOverrideNotifications(user?.id);
  if (!notifications.length) return null;

  return (
    <OverrideNoticeModal
      key={notifications[0].id}
      notification={notifications[0]}
      pendingCount={notifications.length}
      acknowledge={acknowledge}
      isAcknowledging={isAcknowledging}
      error={error}
    />
  );
}
