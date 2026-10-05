import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarCheck, Clock, UserRound } from 'lucide-react';
import {
  WEEK_DEFAULT_SCROLL_MINUTES,
  WEEK_SLOT_COUNT,
  WEEK_SLOT_HEIGHT,
  WEEK_SLOT_MINUTES,
  formatMinutesLabel,
  formatScheduleKindLabel,
  formatScheduleStatusLabel,
  getScheduleKind,
  getScheduleTimeLabel,
  getWeekEventTone,
  layoutWeekDayEvents,
} from '../utils/scheduleCalendar';

export default function WeeklyScheduleGrid({ days, onSelectSchedule }) {
  const scrollRef = useRef(null);
  const [hoveredRange, setHoveredRange] = useState(null);
  const weekKey = days[0]?.dateStr || '';
  const dayLayouts = useMemo(
    () => days.map((day) => ({ ...day, events: layoutWeekDayEvents(day.entries) })),
    [days],
  );

  useEffect(() => {
    const container = scrollRef.current;

    if (!container) {
      return;
    }

    const earliestStart = dayLayouts.reduce(
      (earliest, day) => day.events.reduce((dayEarliest, event) => Math.min(dayEarliest, event.start), earliest),
      Number.POSITIVE_INFINITY,
    );
    const targetMinutes = Number.isFinite(earliestStart)
      ? Math.max(0, earliestStart - WEEK_SLOT_MINUTES)
      : WEEK_DEFAULT_SCROLL_MINUTES;

    container.scrollTop = (targetMinutes / WEEK_SLOT_MINUTES) * WEEK_SLOT_HEIGHT;
    // Only re-anchor when the visible week changes, not on every data refresh.
  }, [weekKey]);

  return (
    <div className="schedules-week" ref={scrollRef}>
      <div className="schedules-week-head">
        <div className="schedules-week-corner" aria-hidden="true" />
        {dayLayouts.map((day) => (
          <div key={day.dateStr} className={`schedules-week-day-head${day.isToday ? ' is-today' : ''}`}>
            <span>{day.weekdayLabel}</span>
            <strong>{day.dayNumber}</strong>
          </div>
        ))}
      </div>

      <div className="schedules-week-body" style={{ height: WEEK_SLOT_COUNT * WEEK_SLOT_HEIGHT }}>
        <div className="schedules-week-times" aria-hidden="true">
          {Array.from({ length: WEEK_SLOT_COUNT - 1 }, (_, index) => {
            const minutes = (index + 1) * WEEK_SLOT_MINUTES;
            const isInRange =
              hoveredRange && minutes >= hoveredRange.start && minutes <= hoveredRange.end;

            return (
              <span
                key={minutes}
                className={isInRange ? 'is-highlighted' : undefined}
                style={{ top: (index + 1) * WEEK_SLOT_HEIGHT }}
              >
                {formatMinutesLabel(minutes)}
              </span>
            );
          })}
        </div>

        {hoveredRange ? (
          <div
            className="schedules-week-hover-band"
            aria-hidden="true"
            style={{
              top: (hoveredRange.start / WEEK_SLOT_MINUTES) * WEEK_SLOT_HEIGHT,
              height: ((hoveredRange.end - hoveredRange.start) / WEEK_SLOT_MINUTES) * WEEK_SLOT_HEIGHT,
            }}
          />
        ) : null}

        {dayLayouts.map((day) => (
          <div
            key={day.dateStr}
            className={`schedules-week-column${day.isToday ? ' is-today' : ''}`}
            aria-label={`${day.weekdayLabel} ${day.dayNumber}`}
          >
            {day.events.map(({ schedule, start, end, lane, lanes }) => {
              const timeLabel = getScheduleTimeLabel(schedule) || `${formatMinutesLabel(start)} - ${formatMinutesLabel(end)}`;

              return (
                <button
                  type="button"
                  key={schedule.id}
                  className={`schedules-week-event ${getWeekEventTone(schedule)}`}
                  style={{
                    top: (start / WEEK_SLOT_MINUTES) * WEEK_SLOT_HEIGHT + 1,
                    height: Math.max(((end - start) / WEEK_SLOT_MINUTES) * WEEK_SLOT_HEIGHT - 2, 24),
                    left: `calc(${(lane * 100) / lanes}% + 3px)`,
                    width: `calc(${100 / lanes}% - 6px)`,
                  }}
                  title={`${schedule.ownerName} • ${timeLabel}`}
                  onClick={() => onSelectSchedule(schedule)}
                  onMouseEnter={() => setHoveredRange({ start, end })}
                  onMouseLeave={() => setHoveredRange(null)}
                  onFocus={() => setHoveredRange({ start, end })}
                  onBlur={() => setHoveredRange(null)}
                >
                  <span className="schedules-week-event-line is-title">
                    <UserRound size={13} aria-hidden="true" />
                    <strong>{schedule.ownerName}</strong>
                  </span>
                  <span className="schedules-week-event-line">
                    <Clock size={13} aria-hidden="true" />
                    {timeLabel}
                  </span>
                  <span className="schedules-week-event-line">
                    <CalendarCheck size={13} aria-hidden="true" />
                    {formatScheduleKindLabel(getScheduleKind(schedule))} - {formatScheduleStatusLabel(schedule.status)}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
