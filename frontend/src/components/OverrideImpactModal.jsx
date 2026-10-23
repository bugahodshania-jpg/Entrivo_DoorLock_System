import { AlertTriangle, X } from 'lucide-react';

function scheduleDateLabel(schedule) {
  return schedule.scheduleDateLabel || schedule.scheduleDate || schedule.dateLabel || '';
}

function scheduleTimeLabel(schedule) {
  if (schedule.timeStartLabel && schedule.timeEndLabel) {
    return `${schedule.timeStartLabel} – ${schedule.timeEndLabel}`;
  }

  if (schedule.window) {
    return String(schedule.window).replace(' - ', ' – ');
  }

  return [schedule.timeStart, schedule.timeEnd].filter(Boolean).join(' – ');
}

function scheduleKindLabel(schedule) {
  return schedule.scheduleKind === 'override' ? 'Override schedule' : 'Regular schedule';
}

export default function OverrideImpactModal({
  open,
  affectedSchedules = [],
  notifiedUsers = [],
  isSubmitting = false,
  onCancel,
  onConfirm,
}) {
  if (!open) {
    return null;
  }

  const hasAffected = affectedSchedules.length > 0;

  return (
    <div className="schedules-modal-overlay" onClick={onCancel}>
      <div
        className="schedules-modal schedules-conflict-modal schedules-impact-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="override-impact-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="schedules-modal-header">
          <div>
            <strong id="override-impact-title">Schedules will be affected</strong>
            <p>
              {hasAffected
                ? 'A new Override row will be created. The regular schedule stays in place and will be stamped as overridden.'
                : 'No regular schedule overlaps this window. Continue to create the override as a new row.'}
            </p>
          </div>
          <button type="button" className="schedules-modal-close" onClick={onCancel} aria-label="Close affected schedules">
            <X size={18} />
          </button>
        </div>

        {hasAffected ? (
          <ul className="schedules-impact-list">
            {affectedSchedules.map((schedule) => {
              const dateLabel = scheduleDateLabel(schedule);
              const timeLabel = scheduleTimeLabel(schedule);

              return (
                <li key={schedule.id} className="schedules-impact-card">
                  <div className="schedules-impact-card-head">
                    <AlertTriangle size={18} aria-hidden="true" />
                    <div>
                      <strong>{schedule.ownerName || 'This user'}</strong>
                      <span>{scheduleKindLabel(schedule)}</span>
                    </div>
                  </div>
                  {dateLabel || timeLabel ? (
                    <dl className="schedules-impact-grid">
                      {dateLabel ? (
                        <div>
                          <dt>Date</dt>
                          <dd>{dateLabel}</dd>
                        </div>
                      ) : null}
                      {timeLabel ? (
                        <div>
                          <dt>Window</dt>
                          <dd className="schedules-impact-time">{timeLabel}</dd>
                        </div>
                      ) : null}
                    </dl>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}

        {notifiedUsers.length > 0 ? (
          <p className="schedules-conflict-summary">
            These users will also be notified because their access overlaps this override:{' '}
            {notifiedUsers.map((user) => user.name || user.email).join(', ')}.
          </p>
        ) : null}

        <p className="schedules-conflict-ask">
          Confirm this override, then enter your security password to apply it.
        </p>

        <div className="schedules-form-actions">
          <button type="button" className="schedules-secondary-button" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </button>
          <button type="button" className="schedules-primary-button" onClick={onConfirm} disabled={isSubmitting}>
            {isSubmitting ? 'Creating...' : 'Confirm override'}
          </button>
        </div>
      </div>
    </div>
  );
}
