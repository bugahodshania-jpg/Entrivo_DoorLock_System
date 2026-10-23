import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import '../styles/superAdmin/rfid.css';
import '../styles/superAdmin/accessLogs.css';

function displayLabel(value) {
  return String(value || '').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function AccessLogViewModal({ log, onClose }) {
  const modalRef = useRef(null);
  const closeRef = useRef(null);

  useEffect(() => {
    if (!log) return undefined;
    const trigger = document.querySelector(`[data-access-log-id="${log.id}"] .row-action-menu-button`);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === 'Tab') {
        const buttons = modalRef.current?.querySelectorAll('button:not(:disabled)');
        if (!buttons?.length) return;
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && (document.activeElement === first || !modalRef.current.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !modalRef.current.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, [log, onClose]);

  if (!log) return null;
  const isRfid = String(log.method || '').toLowerCase() === 'rfid';
  const status = String(log.status || '').toLowerCase();
  const groups = [
    {
      title: 'Access Details',
      fields: [
        ['Log ID', log.id], ['Date', log.date], ['Time (Asia/Manila)', log.time],
        ['Method', log.method], ['Access Type', log.accessType],
        ...(isRfid ? [['RFID UID', log.rfidUid || 'Not recorded']] : []),
        ['Status', <span className={`dashboard-log-status access-logs-status-${status}`}>
          {displayLabel(log.status) || 'Not recorded'}
        </span>],
      ],
    },
    {
      title: 'User Details',
      fields: [
        ['Name', log.userName || 'Unknown User'], ['Email', log.userEmail || 'No email'],
        ['Identifier', log.userIdentifier || 'No ID'], ['Role', displayLabel(log.userRole) || 'No role'],
      ],
    },
    {
      title: 'Schedule',
      fields: log.scheduleId == null
        ? [['Schedule', 'No associated schedule', true]]
        : [['Schedule ID', log.scheduleId], ['Schedule Window', log.scheduleWindow || 'Not recorded', true]],
    },
  ];

  return createPortal(
    <div className="pending-registration-review-backdrop" role="presentation" onClick={onClose}>
      <section
        ref={modalRef}
        className="pending-registration-review access-log-view-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="access-log-view-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2 id="access-log-view-title">View Access Log</h2>
            <p>Review the recorded access attempt and its details.</p>
          </div>
          <button ref={closeRef} type="button" aria-label="Close access log view" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="pending-registration-review-body">
          {groups.map((group) => (
            <section className="pending-registration-review-card" key={group.title}>
              <h3>{group.title}</h3>
              <dl>
                {group.fields.map(([label, value, wide]) => (
                  <div key={label} className={wide ? 'is-wide' : undefined}>
                    <dt>{label}</dt>
                    <dd>{value ?? 'Not recorded'}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <footer>
          <button type="button" className="pending-registration-reject" onClick={onClose}>Close</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
