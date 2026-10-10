import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  CalendarRange,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  Eye,
  Maximize2,
  Minimize2,
  ShieldAlert,
  X,
} from 'lucide-react';
import axiosClient from '../../api/axiosClient';
import ExportFormatModal from '../../components/ExportFormatModal';
import RowActionMenu from '../../components/RowActionMenu';
import WeeklyScheduleGrid from '../../components/WeeklyScheduleGrid';
import { useActionConfirm } from '../../components/ActionConfirm';
import PortalToast from '../../components/PortalToast';
import { formatDateInManila, getManilaDateStamp } from '../../utils/dateTime';
import { buildTablePdf, downloadFile } from '../../utils/exportFiles';
import {
  buildCalendarPdf,
  buildScheduleCsv,
  buildWeeklyPdf,
  compareSchedulesChronologically,
  formatScheduleKindLabel,
  formatScheduleStatusLabel,
  getScheduleKind,
  getScheduleTimeLabel,
  getWeekStartStamp,
  parseDateStamp,
  shiftDateStamp,
  toDateStamp,
} from '../../utils/scheduleCalendar';
import '../../styles/superAdmin/dashboard.css';
import '../../styles/superAdmin/schedules.css';
import '../../styles/superAdmin/accessLogs.css';
import '../../styles/superAdmin/users.css';
import '../../styles/superAdmin/rfid.css';
import '../../styles/user/userPortal.css';

const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const dayHeaders = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const statusFilterOptions = [
  { value: 'all', label: 'All statuses' },
  { value: 'approved', label: 'Approved' },
  { value: 'pending', label: 'Pending' },
  { value: 'overridden', label: 'Overridden' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'expired', label: 'Expired' },
];

const viewFilterOptions = [
  { value: 'today', label: "Today's Schedule" },
  { value: 'all', label: 'All Schedule' },
];

const emptyOverrideForm = {
  scheduleDate: '',
  timeStart: '08:00',
  timeEnd: '17:00',
  reason: '',
};

function formatScheduleDate(dateValue) {
  if (!dateValue) {
    return '—';
  }

  return formatDateInManila(dateValue, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getCalendarCellClass(cell) {
  if (!cell) {
    return 'schedules-calendar-cell schedules-calendar-empty';
  }

  const tone = cell.hasSchedule
    ? cell.isToday
      ? ' schedules-calendar-green'
      : cell.isPast
        ? ' schedules-calendar-past'
        : ' schedules-calendar-has'
    : '';

  return `schedules-calendar-cell${cell.isToday ? ' is-today' : ''}${tone}`;
}

const TABLE_PDF_COLUMNS = [
  { label: 'Date', width: 220 },
  { label: 'Time', width: 200 },
  { label: 'Type', width: 120 },
  { label: 'Status', width: 120 },
  { label: 'Grace', width: 125 },
];

function formatScheduleTypeLabel(type) {
  const value = String(type || '').trim().toLowerCase();

  if (!value) {
    return '—';
  }

  if (value === 'single') {
    return 'One-time';
  }

  if (value === 'recurring') {
    return 'Recurring';
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getScheduleViewWindow(schedule) {
  return {
    dateLabel:
      schedule.dateLabel ||
      formatScheduleDate(schedule.dateValue || schedule.scheduleDate || schedule.startDate),
    timeLabel: schedule.time || '—',
  };
}

function getSelfName(user) {
  return (
    [user?.first_name, user?.middle_name, user?.last_name, user?.extension_name]
      .filter(Boolean)
      .join(' ')
      .trim() ||
    user?.username ||
    'You'
  );
}

function toCalendarEntry(schedule, dateKey, selfName) {
  return {
    ...schedule,
    scheduleDate: dateKey,
    scheduleKind: String(schedule.status || '').toLowerCase() === 'overridden' ? 'override' : 'regular',
    window: schedule.time || '',
    ownerName: schedule.isMine ? selfName : schedule.ownerName || 'Other faculty',
  };
}

function UserCalendarEvent({ schedule }) {
  const ownerLabel = schedule.isMine
    ? 'You'
    : schedule.ownerName || 'Other faculty';
  const status = String(schedule.status || '').toLowerCase();
  const occupancyLabel = schedule.isMine
    ? 'Yours'
    : status === 'overridden'
      ? 'Override'
      : 'Occupied';

  return (
    <div
      className={`schedules-calendar-event${schedule.isMine ? ' is-mine' : ' is-other'}`}
    >
      <strong>{ownerLabel}</strong>
      <span>{schedule.time || 'No time set'}</span>
      <span>
        {formatScheduleStatusLabel(schedule.status)} · {occupancyLabel}
      </span>
    </div>
  );
}

export default function MySchedule({ user }) {
  const confirmAction = useActionConfirm();
  const todayStr = getManilaDateStamp();
  const viewFilterMenuRef = useRef(null);
  const statusFilterMenuRef = useRef(null);
  const [schedules, setSchedules] = useState([]);
  const [calendarSchedules, setCalendarSchedules] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [viewFilter, setViewFilter] = useState('today');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isViewFilterMenuOpen, setIsViewFilterMenuOpen] = useState(false);
  const [isStatusFilterMenuOpen, setIsStatusFilterMenuOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [calOffset, setCalOffset] = useState(0);
  const [isCalendarExpanded, setIsCalendarExpanded] = useState(false);
  const [focusedCalendarDate, setFocusedCalendarDate] = useState('');
  const [openMoreDate, setOpenMoreDate] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [isOverrideModalOpen, setIsOverrideModalOpen] = useState(false);
  const [overrideForm, setOverrideForm] = useState(emptyOverrideForm);
  const [overrideError, setOverrideError] = useState('');
  const [overrideNotice, setOverrideNotice] = useState(null);
  const [isOverrideSubmitting, setIsOverrideSubmitting] = useState(false);
  const [viewSchedule, setViewSchedule] = useState(null);
  const [calendarView, setCalendarView] = useState('month');
  const [weekStartDate, setWeekStartDate] = useState('');
  const [exportTarget, setExportTarget] = useState(null);
  const isWeekView = isCalendarExpanded && calendarView === 'week';
  const selfName = getSelfName(user);
  const rowsPerPage = 7;

  useEffect(() => {
    if (!user?.id) {
      return undefined;
    }

    let isActive = true;

    async function loadSchedules() {
      try {
        const response = await axiosClient.get('/api/user_portal.php', {
          params: { action: 'schedules', user_id: user.id },
        });

        if (!isActive) {
          return;
        }

        setSchedules(response.data.schedules || []);
        setCalendarSchedules(response.data.calendarSchedules || []);
        setErrorMessage('');
      } catch {
        if (isActive) {
          setSchedules([]);
          setCalendarSchedules([]);
          setErrorMessage('Unable to load schedules right now.');
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    loadSchedules();

    return () => {
      isActive = false;
    };
  }, [user?.id]);

  useEffect(() => {
    setCurrentPage(1);
  }, [viewFilter, statusFilter, dateFrom, dateTo]);

  useEffect(() => {
    if (!viewSchedule) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setViewSchedule(null);
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [viewSchedule]);

  useEffect(() => {
    if (!isViewFilterMenuOpen && !isStatusFilterMenuOpen) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (isViewFilterMenuOpen && !viewFilterMenuRef.current?.contains(event.target)) {
        setIsViewFilterMenuOpen(false);
      }

      if (
        isStatusFilterMenuOpen &&
        !statusFilterMenuRef.current?.contains(event.target)
      ) {
        setIsStatusFilterMenuOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setIsViewFilterMenuOpen(false);
        setIsStatusFilterMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isViewFilterMenuOpen, isStatusFilterMenuOpen]);

  const filteredSchedules = useMemo(() => {
    return schedules.filter((schedule) => {
      const dateValue = schedule.dateValue || '';

      if (viewFilter === 'today' && dateValue !== todayStr) {
        return false;
      }

      if (statusFilter !== 'all' && String(schedule.status).toLowerCase() !== statusFilter) {
        return false;
      }

      if (dateFrom && dateValue && dateValue < dateFrom) {
        return false;
      }

      if (dateTo && dateValue && dateValue > dateTo) {
        return false;
      }

      return true;
    });
  }, [dateFrom, dateTo, schedules, statusFilter, todayStr, viewFilter]);

  const viewFilterCounts = useMemo(() => {
    const statusScoped =
      statusFilter === 'all'
        ? schedules
        : schedules.filter(
            (schedule) => String(schedule.status || '').toLowerCase() === statusFilter,
          );

    const dateScoped = statusScoped.filter((schedule) => {
      const dateValue = schedule.dateValue || '';
      if (dateFrom && dateValue && dateValue < dateFrom) {
        return false;
      }
      if (dateTo && dateValue && dateValue > dateTo) {
        return false;
      }
      return true;
    });

    return {
      today: dateScoped.filter((schedule) => schedule.dateValue === todayStr).length,
      all: dateScoped.length,
    };
  }, [dateFrom, dateTo, schedules, statusFilter, todayStr]);

  const statusFilterCounts = useMemo(() => {
    const viewScoped =
      viewFilter === 'today'
        ? schedules.filter((schedule) => schedule.dateValue === todayStr)
        : schedules;

    const dateScoped = viewScoped.filter((schedule) => {
      const dateValue = schedule.dateValue || '';
      if (dateFrom && dateValue && dateValue < dateFrom) {
        return false;
      }
      if (dateTo && dateValue && dateValue > dateTo) {
        return false;
      }
      return true;
    });

    const counts = { all: dateScoped.length };
    statusFilterOptions.forEach((option) => {
      if (option.value === 'all') {
        return;
      }
      counts[option.value] = dateScoped.filter(
        (schedule) => String(schedule.status || '').toLowerCase() === option.value,
      ).length;
    });
    return counts;
  }, [dateFrom, dateTo, schedules, todayStr, viewFilter]);

  const activeViewFilterConfig =
    viewFilterOptions.find((option) => option.value === viewFilter) || viewFilterOptions[0];
  const activeStatusFilterConfig =
    statusFilterOptions.find((option) => option.value === statusFilter) || statusFilterOptions[0];

  const schedulesByDate = useMemo(() => {
    const grouped = new Map();
    const seenIds = new Set();

    const pushEntry = (schedule) => {
      const dateKey = String(schedule.dateValue || schedule.scheduleDate || '').slice(0, 10);
      const status = String(schedule.status || '').toLowerCase();

      if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
        return;
      }

      if (status !== 'approved' && status !== 'overridden') {
        return;
      }

      const entryId = schedule.id ?? `${dateKey}-${schedule.timeStart || schedule.time}-${schedule.userId || 'self'}`;
      if (seenIds.has(entryId)) {
        return;
      }
      seenIds.add(entryId);

      const entries = grouped.get(dateKey) || [];
      entries.push(toCalendarEntry(schedule, dateKey, selfName));
      grouped.set(dateKey, entries);
    };

    // Shared occupancy calendar (all faculty approved schedules).
    calendarSchedules.forEach(pushEntry);

    // Always include this faculty member's own schedules so the calendar never goes blank
    // if the shared payload is missing or filtered out.
    schedules.forEach((schedule) => {
      pushEntry({
        ...schedule,
        userId: user?.id,
        isMine: true,
      });
    });

    grouped.forEach((entries) => {
      entries.sort((left, right) => {
        const timeCompare = String(left.timeStart || left.time || '').localeCompare(
          String(right.timeStart || right.time || ''),
        );

        if (timeCompare !== 0) {
          return timeCompare;
        }

        if (Boolean(left.isMine) === Boolean(right.isMine)) {
          return String(left.ownerName || '').localeCompare(String(right.ownerName || ''));
        }

        return left.isMine ? -1 : 1;
      });
    });

    return grouped;
  }, [calendarSchedules, schedules, selfName, user?.id]);

  const calYear = useMemo(() => {
    const date = new Date(`${todayStr}T00:00:00`);
    date.setMonth(date.getMonth() + calOffset);
    return date.getFullYear();
  }, [calOffset, todayStr]);

  const calMonth = useMemo(() => {
    const date = new Date(`${todayStr}T00:00:00`);
    date.setMonth(date.getMonth() + calOffset);
    return date.getMonth();
  }, [calOffset, todayStr]);

  const calendarGrid = useMemo(() => {
    const firstDay = new Date(calYear, calMonth, 1).getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const cells = [];
    const startOffset = firstDay === 0 ? 6 : firstDay - 1;

    for (let index = 0; index < startOffset; index += 1) {
      cells.push(null);
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const entries = schedulesByDate.get(dateStr) || [];
      cells.push({
        day,
        dateStr,
        isToday: dateStr === todayStr,
        isPast: dateStr < todayStr,
        hasSchedule: entries.length > 0,
        entries,
      });
    }

    return cells;
  }, [calMonth, calYear, schedulesByDate, todayStr]);

  const focusedCell = useMemo(
    () => calendarGrid.find((cell) => cell?.dateStr === focusedCalendarDate) || null,
    [calendarGrid, focusedCalendarDate],
  );

  const weekDays = useMemo(() => {
    if (!weekStartDate) {
      return [];
    }

    return dayHeaders.map((label, index) => {
      const dateStr = shiftDateStamp(weekStartDate, index);

      return {
        dateStr,
        weekdayLabel: label.toUpperCase(),
        dayNumber: Number(dateStr.slice(8, 10)),
        isToday: dateStr === todayStr,
        entries: (schedulesByDate.get(dateStr) || []).map((schedule) =>
          schedule.isMine ? { ...schedule, ownerName: 'You' } : schedule,
        ),
      };
    });
  }, [weekStartDate, schedulesByDate, todayStr]);

  const weekRangeLabel = useMemo(() => {
    if (weekDays.length === 0) {
      return '';
    }

    const first = parseDateStamp(weekDays[0].dateStr);
    const last = parseDateStamp(weekDays[weekDays.length - 1].dateStr);
    const shortMonth = (date) => monthNames[date.getMonth()].slice(0, 3);
    const firstLabel = `${shortMonth(first)} ${first.getDate()}${first.getFullYear() !== last.getFullYear() ? `, ${first.getFullYear()}` : ''}`;

    return `${firstLabel} - ${shortMonth(last)} ${last.getDate()}, ${last.getFullYear()}`;
  }, [weekDays]);

  const tableFilterSummary = [
    activeViewFilterConfig.label,
    activeStatusFilterConfig.label,
    dateFrom || dateTo ? `${dateFrom || 'Any'} to ${dateTo || 'Any'}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const totalPages = Math.max(1, Math.ceil(filteredSchedules.length / rowsPerPage));
  const pageRows = filteredSchedules.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);

  useEffect(() => {
    if (!overrideNotice) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setOverrideNotice(null), 8000);
    return () => window.clearTimeout(timeoutId);
  }, [overrideNotice]);

  function openOverrideModal(preferredDate = '') {
    const scheduleDate =
      preferredDate && /^\d{4}-\d{2}-\d{2}$/.test(preferredDate) ? preferredDate : todayStr;

    setOverrideForm({
      ...emptyOverrideForm,
      scheduleDate,
    });
    setOverrideError('');
    setIsOverrideModalOpen(true);
  }

  function closeOverrideModal() {
    if (isOverrideSubmitting) {
      return;
    }

    setIsOverrideModalOpen(false);
    setOverrideError('');
  }

  function handleView(schedule) {
    setViewSchedule(schedule);
  }

  function closeViewModal() {
    setViewSchedule(null);
  }

  function updateOverrideField(field, value) {
    setOverrideForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function handleOverrideSubmit(event) {
    event.preventDefault();

    if (!user?.id || isOverrideSubmitting) {
      return;
    }

    const scheduleDate = String(overrideForm.scheduleDate || '').trim();
    const timeStart = String(overrideForm.timeStart || '').trim();
    const timeEnd = String(overrideForm.timeEnd || '').trim();
    const reason = String(overrideForm.reason || '').trim();

    if (!scheduleDate) {
      setOverrideError('Schedule date is required.');
      return;
    }

    if (!timeStart || !timeEnd) {
      setOverrideError('Time start and time end are required.');
      return;
    }

    if (timeEnd <= timeStart) {
      setOverrideError('Time end must be after time start.');
      return;
    }

    if (!reason) {
      setOverrideError('A reason is required for the override request.');
      return;
    }

    const confirmed = await confirmAction({
      title: 'Submit override request',
      message: 'Are you sure you want to submit this override request for review?',
    });

    if (!confirmed) {
      return;
    }

    setIsOverrideSubmitting(true);
    setOverrideError('');

    try {
      const response = await axiosClient.post('/api/user_portal.php', {
        action: 'request_override',
        user_id: user.id,
        scheduleDate,
        timeStart,
        timeEnd,
        reason,
      });

      setOverrideNotice({
        type: 'success',
        title: 'Override Notice',
        message: response.data.message || 'Override request submitted and is pending review.',
      });
      setIsOverrideModalOpen(false);
      setOverrideForm(emptyOverrideForm);
    } catch (error) {
      setOverrideError(
        error.response?.data?.message || 'Unable to submit the override request right now.',
      );
    } finally {
      setIsOverrideSubmitting(false);
    }
  }

  function shiftFocusedDate(dayDelta) {
    if (!focusedCalendarDate) {
      return;
    }

    const [year, month, day] = focusedCalendarDate.split('-').map(Number);
    const nextDate = new Date(year, month - 1, day + dayDelta);
    const dateStr = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`;
    const monthDelta = (nextDate.getFullYear() - calYear) * 12 + (nextDate.getMonth() - calMonth);

    if (monthDelta !== 0) {
      setCalOffset((current) => current + monthDelta);
    }

    setOpenMoreDate('');
    setFocusedCalendarDate(dateStr);
  }

  function openWeeklyView() {
    const [todayYear, todayMonth] = todayStr.split('-').map(Number);
    const isViewingCurrentMonth = calYear === todayYear && calMonth === todayMonth - 1;
    const anchorDate = isViewingCurrentMonth ? todayStr : toDateStamp(new Date(calYear, calMonth, 1));

    setWeekStartDate(getWeekStartStamp(anchorDate));
    setFocusedCalendarDate('');
    setOpenMoreDate('');
    setCalendarView('week');
  }

  function openMonthlyView() {
    if (weekStartDate) {
      const middleOfWeek = parseDateStamp(shiftDateStamp(weekStartDate, 3));
      const [todayYear, todayMonth] = todayStr.split('-').map(Number);
      setCalOffset((middleOfWeek.getFullYear() - todayYear) * 12 + (middleOfWeek.getMonth() - (todayMonth - 1)));
    }

    setCalendarView('month');
  }

  function getTableExportFileName(extension) {
    const parts = ['my-schedules', viewFilter];

    if (statusFilter !== 'all') {
      parts.push(statusFilter);
    }

    parts.push(todayStr);
    return `${parts.join('-')}.${extension}`;
  }

  function exportTableCsv() {
    const headers = ['Date', 'Time', 'Type', 'Status', 'Grace (min)', 'Schedule ID'];
    const rows = filteredSchedules.map((schedule) => [
      schedule.dateValue,
      schedule.time,
      formatScheduleTypeLabel(schedule.scheduleType),
      formatScheduleStatusLabel(schedule.status),
      schedule.gracePeriodMinutes,
      schedule.id,
    ]);
    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');

    downloadFile(csvContent, 'text/csv;charset=utf-8;', getTableExportFileName('csv'));
  }

  function exportTablePdf() {
    const rows = filteredSchedules.map((schedule) => [
      schedule.dateLabel || formatScheduleDate(schedule.dateValue),
      schedule.time || '—',
      formatScheduleTypeLabel(schedule.scheduleType),
      formatScheduleStatusLabel(schedule.status),
      Number.isFinite(Number(schedule.gracePeriodMinutes)) ? `${schedule.gracePeriodMinutes} min` : '—',
    ]);
    const pdf = buildTablePdf({
      title: `My Schedules: ${selfName}`,
      note: `Filters: ${tableFilterSummary} | ${rows.length} schedule${rows.length === 1 ? '' : 's'}`,
      columns: TABLE_PDF_COLUMNS,
      rows,
      emphasizeColumn: 0,
      emptyMessage: 'No schedules match the selected filters.',
    });

    downloadFile(pdf, 'application/pdf', getTableExportFileName('pdf'));
  }

  function getExportableSchedules(isInRange) {
    const entries = [];

    schedulesByDate.forEach((dayEntries, dateStr) => {
      if (isInRange(dateStr)) {
        entries.push(...dayEntries);
      }
    });

    return entries.sort(compareSchedulesChronologically);
  }

  function isInDisplayedMonth(dateStr) {
    const [year, month] = dateStr.split('-').map(Number);
    return year === calYear && month === calMonth + 1;
  }

  function isInDisplayedWeek(dateStr) {
    return weekDays.length > 0 && dateStr >= weekDays[0].dateStr && dateStr <= weekDays[weekDays.length - 1].dateStr;
  }

  function getWeekFileStamp() {
    return weekDays.length > 0 ? `${weekDays[0].dateStr}-to-${weekDays[weekDays.length - 1].dateStr}` : 'week';
  }

  function exportMonthlyCsv() {
    downloadFile(
      buildScheduleCsv(getExportableSchedules(isInDisplayedMonth)),
      'text/csv;charset=utf-8;',
      `my-monthly-schedule-${monthNames[calMonth]}-${calYear}.csv`,
    );
  }

  function exportWeeklyCsv() {
    downloadFile(
      buildScheduleCsv(getExportableSchedules(isInDisplayedWeek)),
      'text/csv;charset=utf-8;',
      `my-weekly-schedule-${getWeekFileStamp()}.csv`,
    );
  }

  function exportWeeklyPdf() {
    const weekSchedules = getExportableSchedules(isInDisplayedWeek);
    const pdf = buildWeeklyPdf({
      title: `Weekly Schedule: ${weekRangeLabel}`,
      note: 'Approved and overridden schedules, including other faculty occupancy.',
      days: weekDays.map((day) => ({
        ...day,
        entries: weekSchedules.filter((schedule) => schedule.scheduleDate === day.dateStr),
      })),
    });

    downloadFile(pdf, 'application/pdf', `my-weekly-schedule-${getWeekFileStamp()}.pdf`);
  }

  function exportMonthlyPdf() {
    const cells = calendarGrid.map((cell) => {
      if (!cell) {
        return null;
      }

      return {
        day: cell.day,
        tone: cell.entries.length === 0 ? '' : cell.isToday ? 'today' : cell.isPast ? 'past' : 'upcoming',
        events: cell.entries.map((schedule) => [
          { text: schedule.ownerName, size: 8, color: ['0.25', '0.29', '0.33'] },
          { text: getScheduleTimeLabel(schedule), size: 7, color: ['0.36', '0.40', '0.45'] },
          {
            text: `${formatScheduleKindLabel(getScheduleKind(schedule))} - ${formatScheduleStatusLabel(schedule.status)}`,
            size: 7,
            color: ['0.36', '0.40', '0.45'],
          },
        ].filter((line) => line.text)),
      };
    });
    const pdf = buildCalendarPdf({
      title: `${monthNames[calMonth]} ${calYear}`,
      note: 'Approved and overridden schedules, including other faculty occupancy.',
      dayHeaders,
      cells,
    });

    downloadFile(pdf, 'application/pdf', `my-monthly-schedule-${monthNames[calMonth]}-${calYear}.pdf`);
  }

  function handleExportFormat(format) {
    if (exportTarget === 'table') {
      if (format === 'csv') {
        exportTableCsv();
      } else {
        exportTablePdf();
      }
    } else if (isWeekView) {
      if (format === 'csv') {
        exportWeeklyCsv();
      } else {
        exportWeeklyPdf();
      }
    } else if (format === 'csv') {
      exportMonthlyCsv();
    } else {
      exportMonthlyPdf();
    }

    setExportTarget(null);
  }

  return (
    <main className="admin-dashboard schedules-page user-portal-page" aria-label="My schedule">
      <div className={`schedules-layout${isCalendarExpanded ? ' is-calendar-expanded' : ''}`}>
        <section className="dashboard-recent-card schedules-card">
          <div className="dashboard-panel-header">
            <div>
              <span>My Schedule</span>
              <p>View-only list of your assigned schedules. Request an override if you need temporary access.</p>
            </div>
            <div className="schedules-header-actions">
              <button type="button" className="schedules-csv-button" onClick={() => setExportTarget('table')}>
                <Download size={14} />
                Export
              </button>
              <button
                type="button"
                className="settings-primary-button user-schedule-override-link"
                onClick={() => openOverrideModal(focusedCalendarDate || todayStr)}
              >
                <ShieldAlert size={15} aria-hidden="true" />
                Request Override
              </button>
            </div>
          </div>

          {overrideNotice ? (
            <PortalToast
              title={overrideNotice.title || 'Notice'}
              message={overrideNotice.message}
              type={overrideNotice.type || 'success'}
              onClose={() => setOverrideNotice(null)}
            />
          ) : null}

          <div className="schedules-table-filters user-schedule-filters">
            <div
              className="schedules-table-tabs schedules-status-filter"
              ref={viewFilterMenuRef}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  setIsViewFilterMenuOpen(false);
                }
              }}
            >
              <button
                type="button"
                className={`schedules-table-tab-trigger${isViewFilterMenuOpen ? ' is-open' : ''}`}
                aria-haspopup="listbox"
                aria-expanded={isViewFilterMenuOpen}
                aria-controls="my-schedule-view-filter-menu"
                aria-label={`Schedule view filter: ${activeViewFilterConfig.label}`}
                onClick={() => {
                  setIsViewFilterMenuOpen((open) => !open);
                  setIsStatusFilterMenuOpen(false);
                }}
              >
                <span className="schedules-table-tab-trigger-label">
                  {activeViewFilterConfig.label}
                </span>
                <span className="schedules-table-tab-count">
                  {viewFilterCounts[activeViewFilterConfig.value] ?? 0}
                </span>
                <ChevronDown className="schedules-table-tab-chevron" size={14} aria-hidden="true" />
              </button>

              {isViewFilterMenuOpen ? (
                <div
                  id="my-schedule-view-filter-menu"
                  className="schedules-table-tab-menu"
                  role="listbox"
                  aria-label="Schedule view filters"
                >
                  {viewFilterOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      className={`schedules-table-tab-option${viewFilter === option.value ? ' is-active' : ''}`}
                      aria-selected={viewFilter === option.value}
                      onClick={() => {
                        setViewFilter(option.value);
                        setIsViewFilterMenuOpen(false);
                      }}
                    >
                      <Check className="schedules-table-tab-check" size={15} aria-hidden="true" />
                      <span className="schedules-table-tab-option-label">{option.label}</span>
                      <span className="schedules-table-tab-count">
                        {viewFilterCounts[option.value] ?? 0}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div
              className="schedules-table-tabs schedules-status-filter"
              ref={statusFilterMenuRef}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  setIsStatusFilterMenuOpen(false);
                }
              }}
            >
              <button
                type="button"
                className={`schedules-table-tab-trigger${isStatusFilterMenuOpen ? ' is-open' : ''}`}
                aria-haspopup="listbox"
                aria-expanded={isStatusFilterMenuOpen}
                aria-controls="my-schedule-status-filter-menu"
                aria-label={`Status filter: ${activeStatusFilterConfig.label}`}
                onClick={() => {
                  setIsStatusFilterMenuOpen((open) => !open);
                  setIsViewFilterMenuOpen(false);
                }}
              >
                <span className="schedules-table-tab-trigger-label">
                  {activeStatusFilterConfig.label}
                </span>
                <span className="schedules-table-tab-count">
                  {statusFilterCounts[activeStatusFilterConfig.value] ?? 0}
                </span>
                <ChevronDown className="schedules-table-tab-chevron" size={14} aria-hidden="true" />
              </button>

              {isStatusFilterMenuOpen ? (
                <div
                  id="my-schedule-status-filter-menu"
                  className="schedules-table-tab-menu"
                  role="listbox"
                  aria-label="Schedule status filters"
                >
                  {statusFilterOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      className={`schedules-table-tab-option${statusFilter === option.value ? ' is-active' : ''}`}
                      aria-selected={statusFilter === option.value}
                      onClick={() => {
                        setStatusFilter(option.value);
                        setIsStatusFilterMenuOpen(false);
                      }}
                    >
                      <Check className="schedules-table-tab-check" size={15} aria-hidden="true" />
                      <span className="schedules-table-tab-option-label">{option.label}</span>
                      <span className="schedules-table-tab-count">
                        {statusFilterCounts[option.value] ?? 0}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="access-logs-dates user-schedule-dates">
              <label>
                <span>From</span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                />
              </label>
              <span className="access-logs-dates-divider" aria-hidden="true" />
              <label>
                <span>To</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                />
              </label>
              {dateFrom || dateTo ? (
                <button
                  type="button"
                  className="access-logs-clear"
                  onClick={() => {
                    setDateFrom('');
                    setDateTo('');
                  }}
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>

          <div className="dashboard-recent-table-wrap">
            <table className="dashboard-recent-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Grace</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td className="dashboard-recent-empty" colSpan="5">
                      Loading schedules…
                    </td>
                  </tr>
                ) : errorMessage ? (
                  <tr>
                    <td className="dashboard-recent-empty" colSpan="5">
                      {errorMessage}
                    </td>
                  </tr>
                ) : pageRows.length ? (
                  pageRows.map((schedule) => (
                    <tr key={schedule.id}>
                      <td>{schedule.dateLabel || formatScheduleDate(schedule.dateValue)}</td>
                      <td>{schedule.time}</td>
                      <td>{schedule.scheduleType || '—'}</td>
                      <td>
                        <span className={`dashboard-log-status dashboard-log-status-${schedule.status}`}>
                          {schedule.status}
                        </span>
                      </td>
                      <td>{schedule.gracePeriodMinutes} min</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="dashboard-recent-empty" colSpan="5">
                      No schedules match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="activity-logs-pagination">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
            >
              Previous
            </button>
            <span>
              Page {currentPage} of {totalPages}
            </span>
            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
            >
              Next
            </button>
          </div>
        </section>

        <aside className="schedules-calendar-card">
          <div className="schedules-calendar">
            {isCalendarExpanded && (!focusedCell || isWeekView) ? (
              <div className="schedules-calendar-export-row">
                <button
                  type="button"
                  className="schedules-calendar-export"
                  onClick={() => setExportTarget('calendar')}
                >
                  <Download size={14} />
                  Export schedule
                </button>
                <button
                  type="button"
                  className="schedules-calendar-export schedules-calendar-view-toggle"
                  aria-pressed={isWeekView}
                  onClick={isWeekView ? openMonthlyView : openWeeklyView}
                >
                  {isWeekView ? <CalendarDays size={14} /> : <CalendarRange size={14} />}
                  {isWeekView ? 'Monthly Calendar' : 'Weekly Schedule'}
                </button>
                <button
                  type="button"
                  className="schedules-calendar-export schedules-calendar-minimize"
                  aria-label="Minimize calendar"
                  onClick={() => {
                    setIsCalendarExpanded(false);
                    setCalendarView('month');
                    setFocusedCalendarDate('');
                    setOpenMoreDate('');
                  }}
                >
                  <Minimize2 size={14} />
                </button>
              </div>
            ) : null}

            {isCalendarExpanded && focusedCell && !isWeekView ? (
              <div className="schedules-calendar-export-row">
                <button
                  type="button"
                  className="schedules-calendar-export"
                  onClick={() => openOverrideModal(focusedCell.dateStr)}
                >
                  <ShieldAlert size={14} />
                  Request Override
                </button>
                <button
                  type="button"
                  className="schedules-calendar-export schedules-calendar-minimize"
                  aria-label="Back to month view"
                  onClick={() => {
                    setFocusedCalendarDate('');
                    setOpenMoreDate('');
                  }}
                >
                  <Minimize2 size={14} />
                </button>
              </div>
            ) : null}

            <div className="schedules-calendar-header">
              {isWeekView ? (
                <>
                  <button
                    type="button"
                    className="schedules-calendar-nav"
                    aria-label="Previous week"
                    onClick={() => setWeekStartDate((current) => shiftDateStamp(current, -7))}
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span>{weekRangeLabel}</span>
                  <button
                    type="button"
                    className="schedules-calendar-nav"
                    aria-label="Next week"
                    onClick={() => setWeekStartDate((current) => shiftDateStamp(current, 7))}
                  >
                    <ChevronRight size={14} />
                  </button>
                </>
              ) : isCalendarExpanded && focusedCell ? (
                <>
                  <button
                    type="button"
                    className="schedules-calendar-nav"
                    aria-label="Previous date"
                    onClick={() => shiftFocusedDate(-1)}
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span>{formatScheduleDate(focusedCell.dateStr)}</span>
                  <button
                    type="button"
                    className="schedules-calendar-nav"
                    aria-label="Next date"
                    onClick={() => shiftFocusedDate(1)}
                  >
                    <ChevronRight size={14} />
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="schedules-calendar-nav"
                    onClick={() => {
                      setOpenMoreDate('');
                      setCalOffset((value) => value - 1);
                    }}
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span>
                    {monthNames[calMonth]} {calYear}
                  </span>
                  <button
                    type="button"
                    className="schedules-calendar-nav"
                    onClick={() => {
                      setOpenMoreDate('');
                      setCalOffset((value) => value + 1);
                    }}
                  >
                    <ChevronRight size={14} />
                  </button>
                </>
              )}
            </div>

            {isWeekView ? (
              <WeeklyScheduleGrid days={weekDays} onSelectSchedule={handleView} />
            ) : isCalendarExpanded && focusedCell ? (
              <div className={`${getCalendarCellClass(focusedCell)} schedules-calendar-day-box`}>
                <div className="schedules-calendar-day-heading">
                  <span className="schedules-calendar-day-number">{focusedCell.day}</span>
                  {focusedCell.isToday ? (
                    <span className="schedules-calendar-today-mark">
                      <span className="schedules-calendar-today-dot" aria-hidden="true" />
                      Today
                    </span>
                  ) : null}
                </div>
                {focusedCell.entries.length > 0 ? (
                  <div className="schedules-calendar-day-table">
                    {focusedCell.entries.map((schedule) => (
                      <div className="schedules-calendar-day-row" key={schedule.id}>
                        <UserCalendarEvent schedule={schedule} />
                        <RowActionMenu
                          label={`Actions for ${schedule.ownerName || 'schedule'}`}
                          items={[
                            {
                              label: 'View',
                              icon: Eye,
                              onClick: () => handleView(schedule),
                            },
                          ]}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p>No approved schedules on this day — looks vacant for an override request.</p>
                )}
              </div>
            ) : (
              <div className="schedules-calendar-grid">
                {dayHeaders.map((header) => (
                  <div key={header} className="schedules-calendar-day-header">
                    {header}
                  </div>
                ))}
                {calendarGrid.map((cell, index) => (
                  <div key={cell?.dateStr || `empty-${index}`} className={getCalendarCellClass(cell)}>
                    {cell ? (
                      <>
                        <span className="schedules-calendar-day-number">{cell.day}</span>
                        {isCalendarExpanded ? (
                          <button
                            type="button"
                            className="schedules-calendar-day-open"
                            aria-label={`Open ${formatScheduleDate(cell.dateStr)}`}
                            onClick={() => {
                              setOpenMoreDate('');
                              setFocusedCalendarDate(cell.dateStr);
                            }}
                          >
                            <Maximize2 size={13} />
                          </button>
                        ) : null}
                        {cell.isToday && !isCalendarExpanded ? (
                          <span className="schedules-calendar-today-dot" aria-label="Today" />
                        ) : null}
                        {cell.isToday && isCalendarExpanded ? (
                          <span className="schedules-calendar-today-mark">
                            <span className="schedules-calendar-today-dot" aria-hidden="true" />
                            Today
                          </span>
                        ) : null}
                        {!isCalendarExpanded && cell.entries.length > 0 ? (
                          <button
                            type="button"
                            className="schedules-calendar-day-open"
                            onClick={() => {
                              setIsCalendarExpanded(true);
                              setOpenMoreDate('');
                              setFocusedCalendarDate(cell.dateStr);
                            }}
                          >
                            {cell.entries.length} schedule{cell.entries.length === 1 ? '' : 's'}
                          </button>
                        ) : null}
                        {isCalendarExpanded && cell.entries.length > 0 ? (
                          <>
                            <UserCalendarEvent schedule={cell.entries[0]} />
                            {cell.entries.length > 1 ? (
                              <>
                                {openMoreDate === cell.dateStr
                                  ? cell.entries.slice(1).map((schedule) => (
                                      <UserCalendarEvent key={schedule.id} schedule={schedule} />
                                    ))
                                  : null}
                                <button
                                  type="button"
                                  className="schedules-calendar-more"
                                  aria-expanded={openMoreDate === cell.dateStr}
                                  onClick={() =>
                                    setOpenMoreDate((current) =>
                                      current === cell.dateStr ? '' : cell.dateStr,
                                    )
                                  }
                                >
                                  {openMoreDate === cell.dateStr ? (
                                    <ChevronUp size={14} aria-hidden="true" />
                                  ) : (
                                    <ChevronDown size={14} aria-hidden="true" />
                                  )}
                                  {openMoreDate === cell.dateStr
                                    ? 'Show less'
                                    : `${cell.entries.length - 1} more schedule${
                                        cell.entries.length - 1 === 1 ? '' : 's'
                                      }...`}
                                </button>
                              </>
                            ) : null}
                          </>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                ))}
              </div>
            )}

            <div className="schedules-calendar-legend">
              {isWeekView ? (
                <>
                  <span>
                    <span className="schedules-legend-dot schedules-legend-week-regular" /> Regular
                  </span>
                  <span>
                    <span className="schedules-legend-dot schedules-legend-week-override" /> Override
                  </span>
                  <span>
                    <span className="schedules-legend-dot schedules-legend-week-cancelled" /> Cancelled
                  </span>
                </>
              ) : (
                <>
                  <span>
                    <span className="schedules-legend-dot schedules-legend-past" /> Past
                  </span>
                  <span>
                    <span className="schedules-legend-dot schedules-legend-green" /> Today
                  </span>
                  <span>
                    <span className="schedules-legend-dot schedules-legend-upcoming" /> Upcoming
                  </span>
                </>
              )}
              <button
                type="button"
                className="schedules-calendar-expand"
                aria-pressed={isCalendarExpanded}
                aria-label={
                  isCalendarExpanded && focusedCalendarDate
                    ? 'Back to month'
                    : isCalendarExpanded
                      ? 'Shrink calendar'
                      : 'Expand calendar'
                }
                onClick={() => {
                  if (isCalendarExpanded && focusedCalendarDate && !isWeekView) {
                    setFocusedCalendarDate('');
                    return;
                  }

                  setIsCalendarExpanded((expanded) => !expanded);
                  setCalendarView('month');
                  setFocusedCalendarDate('');
                  setOpenMoreDate('');
                }}
              >
                {isCalendarExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
            </div>
          </div>
        </aside>
      </div>

      {viewSchedule ? (
        <div
          className="pending-registration-review-backdrop schedules-view-backdrop"
          role="presentation"
          onClick={closeViewModal}
        >
          <section
            className="pending-registration-review schedules-view-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-schedule-view-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h2 id="user-schedule-view-title">Schedule Details</h2>
                <p>Schedule #{viewSchedule.id}</p>
              </div>
              <button type="button" aria-label="Close schedule details" onClick={closeViewModal}>
                <X size={16} aria-hidden="true" />
              </button>
            </header>

            <div className="pending-registration-review-body">
              <section className="pending-registration-review-card">
                <h3>User</h3>
                <dl>
                  <div>
                    <dt>Name</dt>
                    <dd>
                      {viewSchedule.isMine
                        ? 'You'
                        : viewSchedule.ownerName || '—'}
                    </dd>
                  </div>
                  <div>
                    <dt>Identifier</dt>
                    <dd>{viewSchedule.ownerIdentifier || '—'}</dd>
                  </div>
                </dl>
              </section>

              <section className="pending-registration-review-card">
                <h3>Schedule</h3>
                <dl>
                  <div>
                    <dt>Type</dt>
                    <dd>{formatScheduleTypeLabel(viewSchedule.scheduleType)}</dd>
                  </div>
                  <div>
                    <dt>Grace period</dt>
                    <dd>
                      {Number.isFinite(Number(viewSchedule.gracePeriodMinutes))
                        ? `${viewSchedule.gracePeriodMinutes} min`
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt>Schedule date</dt>
                    <dd>{getScheduleViewWindow(viewSchedule).dateLabel || '—'}</dd>
                  </div>
                  <div>
                    <dt>Schedule time</dt>
                    <dd>{getScheduleViewWindow(viewSchedule).timeLabel || '—'}</dd>
                  </div>
                </dl>
              </section>

              <section className="pending-registration-review-card">
                <h3>Status</h3>
                <dl>
                  <div>
                    <dt>Status</dt>
                    <dd>
                      <span
                        className={`dashboard-log-status dashboard-log-status-${viewSchedule.status}`}
                      >
                        {formatScheduleStatusLabel(viewSchedule.status)}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>Occupancy</dt>
                    <dd>{viewSchedule.isMine ? 'Yours' : 'Occupied'}</dd>
                  </div>
                </dl>
              </section>
            </div>

            <footer>
              <button type="button" className="pending-registration-reject" onClick={closeViewModal}>
                Close
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      <ExportFormatModal
        open={Boolean(exportTarget)}
        title={exportTarget === 'table' ? 'Export My Schedules' : 'Export Schedule'}
        subtitle={
          exportTarget === 'table'
            ? `${tableFilterSummary} (${filteredSchedules.length} schedule${filteredSchedules.length === 1 ? '' : 's'})`
            : isWeekView
              ? `Weekly schedule for ${weekRangeLabel}`
              : `Monthly calendar for ${monthNames[calMonth]} ${calYear}`
        }
        prompt={
          exportTarget === 'table'
            ? 'Only the schedules matching the current table filters will be exported. Choose the file format.'
            : 'Approved and overridden schedules on the calendar will be exported. Choose the file format.'
        }
        pdfHint={
          exportTarget === 'table'
            ? 'Printable schedules table'
            : isWeekView
              ? 'Printable weekly time grid'
              : 'Printable monthly calendar'
        }
        onSelect={handleExportFormat}
        onClose={() => setExportTarget(null)}
      />

      {isOverrideModalOpen ? (
        <div
          className="schedules-modal-overlay"
          role="presentation"
          onClick={closeOverrideModal}
        >
          <div
            className="schedules-modal user-override-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-override-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="schedules-modal-header">
              <div>
                <strong id="user-override-modal-title">Request Override</strong>
                <p>Request a single-day access window. Recurring overrides are not supported.</p>
              </div>
              <button
                type="button"
                className="schedules-modal-close"
                aria-label="Close request override"
                onClick={closeOverrideModal}
                disabled={isOverrideSubmitting}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={handleOverrideSubmit}>
              <div className="schedules-form-grid">
                <div className="schedules-form-row">
                  <div className="schedules-field">
                    <label htmlFor="user-override-type">Schedule Type</label>
                    <input
                      id="user-override-type"
                      type="text"
                      value="Single"
                      readOnly
                      disabled
                    />
                  </div>
                  <div className="schedules-field">
                    <label htmlFor="user-override-date">Schedule Date</label>
                    <input
                      id="user-override-date"
                      type="date"
                      value={overrideForm.scheduleDate}
                      onChange={(event) => updateOverrideField('scheduleDate', event.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="schedules-form-row">
                  <div className="schedules-field">
                    <label htmlFor="user-override-time-start">Time Start</label>
                    <input
                      id="user-override-time-start"
                      type="time"
                      value={overrideForm.timeStart}
                      onChange={(event) => updateOverrideField('timeStart', event.target.value)}
                      required
                    />
                  </div>
                  <div className="schedules-field">
                    <label htmlFor="user-override-time-end">Time End</label>
                    <input
                      id="user-override-time-end"
                      type="time"
                      value={overrideForm.timeEnd}
                      onChange={(event) => updateOverrideField('timeEnd', event.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="schedules-field">
                  <label htmlFor="user-override-reason">Reason</label>
                  <textarea
                    id="user-override-reason"
                    rows={3}
                    value={overrideForm.reason}
                    onChange={(event) => updateOverrideField('reason', event.target.value)}
                    placeholder="Explain why you need temporary access..."
                    required
                  />
                </div>
              </div>

              {overrideError ? <p className="schedules-form-error">{overrideError}</p> : null}

              <div className="schedules-form-actions">
                <button
                  type="button"
                  className="schedules-secondary-button"
                  onClick={closeOverrideModal}
                  disabled={isOverrideSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="schedules-primary-button"
                  disabled={isOverrideSubmitting}
                >
                  {isOverrideSubmitting ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </main>
  );
}
