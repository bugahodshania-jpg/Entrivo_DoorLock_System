import { X } from 'lucide-react';
import { formatDateInManila } from '../utils/dateTime';
import { formatScheduleKindLabel } from '../utils/scheduleCalendar';

function conflictDateParts(value) {
  const text = String(value || '').slice(0, 10);
  const [year, month, day] = text.split('-').map(Number);

  if (!year || !month || !day) {
    return { weekday: '', date: text };
  }

  const stamp = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  return {
    weekday: formatDateInManila(stamp, { weekday: 'long' }),
    date: formatDateInManila(stamp, { month: 'short', day: 'numeric', year: 'numeric' }),
  };
}

function conflictTimeLabel(item) {
  if (item.timeStartLabel && item.timeEndLabel) {
    return `${item.timeStartLabel} – ${item.timeEndLabel}`;
  }

  if (item.window) {
    return String(item.window).replace(' - ', ' – ');
  }

  return [item.timeStart, item.timeEnd].filter(Boolean).join(' – ');
}

export default function ScheduleConflictModal({ open, message, details = [], onClose }) {
  if (!open) {
    return null;
  }

  return (
    <div className="schedules-modal-overlay" onClick={onClose}>
      <div
        className="schedules-modal schedules-conflict-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-conflict-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="schedules-modal-header">
          <div>
            <strong id="schedule-conflict-title">Cannot create this schedule</strong>
            <p>This time is already occupied.</p>
          </div>
          <button type="button" className="schedules-modal-close" onClick={onClose} aria-label="Close schedule conflict">
            <X size={18} />
          </button>
        </div>

        <p className="schedules-conflict-message">{message}</p>

        {details.length > 0 ? (
          <>
            <p className="schedules-conflict-kicker">
              {details.length === 1 ? 'Affected schedule' : 'Affected schedules'}
            </p>
            <ul className="schedules-conflict-list">
              {details.map((item, index) => {
                const dateParts = conflictDateParts(item.scheduleDate || item.scheduleDateLabel);
                const timeLabel = conflictTimeLabel(item);
                const kind = String(item.scheduleKind || item.schedule_kind || 'regular').toLowerCase();

                return (
                  <li className="schedules-conflict-card" key={`${item.scheduleDate}-${item.ownerName}-${timeLabel}-${index}`}>
                    <div className="schedules-conflict-card-head">
                      <strong>{item.ownerName || 'Scheduled user'}</strong>
                      <span className={`schedules-conflict-kind is-${kind}`}>
                        {formatScheduleKindLabel(kind)}
                      </span>
                    </div>
                    <dl className="schedules-conflict-grid">
                      <div>
                        <dt>Date</dt>
                        <dd>
                          <strong>{dateParts.date || 'Not recorded'}</strong>
                          {dateParts.weekday ? <span>{dateParts.weekday}</span> : null}
                        </dd>
                      </div>
                      <div>
                        <dt>Time</dt>
                        <dd className="schedules-conflict-time">{timeLabel || 'Not recorded'}</dd>
                      </div>
                    </dl>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}

        <div className="schedules-form-actions">
          <button type="button" className="schedules-primary-button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
