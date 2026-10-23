import { formatScheduleKindLabel, getScheduleKind } from '../utils/scheduleCalendar';
import { isScheduleOverridden } from '../utils/overrideSchedule';

export default function ScheduleKindBadges({ schedule }) {
  const kind = getScheduleKind(schedule);

  return (
    <div className="schedules-kind-cell">
      <span className={`dashboard-log-status dashboard-log-status-kind-${kind}`}>
        {formatScheduleKindLabel(kind)}
      </span>
      {isScheduleOverridden(schedule) ? (
        <span className="dashboard-log-status dashboard-log-status-overridden">Overridden</span>
      ) : null}
    </div>
  );
}
