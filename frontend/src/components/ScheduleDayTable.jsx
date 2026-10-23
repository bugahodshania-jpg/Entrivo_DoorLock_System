import ScheduleKindBadges from './ScheduleKindBadges';
import { formatScheduleStatusLabel, getScheduleDateParts, getScheduleTimeParts } from '../utils/scheduleCalendar';

export default function ScheduleDayTable({ children }) {
  return (
    <div className="schedules-calendar-day-table">
      <div className="schedules-calendar-day-head">
        <span>User</span>
        <span>Date</span>
        <span>Time</span>
        <span>Type</span>
        <span>Status</span>
        <span className="schedules-calendar-day-actions-label">Actions</span>
      </div>
      {children}
    </div>
  );
}

export function ScheduleDayRow({
  schedule,
  name,
  dateLabel,
  timeLabel,
  timeStartLabel,
  timeEndLabel,
  actions,
}) {
  const status = String(schedule?.status || '').trim().toLowerCase();
  const dateParts = getScheduleDateParts(schedule?.scheduleDate || schedule?.dateValue || dateLabel);
  const timeParts = getScheduleTimeParts({
    ...schedule,
    timeStartLabel: timeStartLabel || schedule?.timeStartLabel,
    timeEndLabel: timeEndLabel || schedule?.timeEndLabel,
    time: timeLabel || schedule?.time,
  });
  const startLabel = timeParts.start;
  const endLabel = timeParts.end;

  return (
    <div className="schedules-calendar-day-row">
      <strong className="schedules-calendar-day-name">{name}</strong>
      <span className="schedules-calendar-day-date" data-label="Date">
        {dateParts.date ? (
          <>
            <strong>{dateParts.date}</strong>
            {dateParts.weekday ? <span>{dateParts.weekday}</span> : null}
          </>
        ) : (
          dateLabel || '—'
        )}
      </span>
      <span className="schedules-calendar-day-time" data-label="Time">
        {startLabel && endLabel ? (
          <>
            <strong>{startLabel}</strong>
            <span>{endLabel}</span>
          </>
        ) : (
          timeLabel || '—'
        )}
      </span>
      <div className="schedules-calendar-day-type" data-label="Type">
        <ScheduleKindBadges schedule={schedule} />
      </div>
      <div className="schedules-calendar-day-status" data-label="Status">
        <span className={`dashboard-log-status dashboard-log-status-${status || 'pending'}`}>
          {formatScheduleStatusLabel(schedule?.status)}
        </span>
      </div>
      <div className="schedules-calendar-day-actions">{actions}</div>
    </div>
  );
}
