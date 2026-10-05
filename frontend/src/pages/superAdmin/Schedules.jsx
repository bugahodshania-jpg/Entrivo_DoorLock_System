import { CalendarDays, CalendarPlus, CalendarRange, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download, Eye, History, Maximize2, Minimize2, Pencil, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import axiosClient from '../../api/axiosClient';
import ExportFormatModal from '../../components/ExportFormatModal';
import RowActionMenu from '../../components/RowActionMenu';
import WeeklyScheduleGrid from '../../components/WeeklyScheduleGrid';
import { useActionConfirm } from '../../components/ActionConfirm';
import { formatDateInManila, getManilaDateStamp, getManilaDateTimeStamp, parseManilaDateTime } from '../../utils/dateTime';
import { buildTablePdf, downloadFile } from '../../utils/exportFiles';
import {
  buildCalendarPdf,
  buildScheduleCsv,
  buildWeeklyPdf,
  compareSchedulesChronologically,
  formatMinutesLabel,
  formatScheduleKindLabel,
  formatScheduleStatusLabel,
  getScheduleKind,
  getScheduleTimeLabel,
  getWeekStartStamp,
  parseDateStamp,
  parseTimeToMinutes,
  shiftDateStamp,
  toDateStamp,
  weekdayOptions,
} from '../../utils/scheduleCalendar';
import { getDefaultGracePeriodMinutes } from '../../utils/systemSettings';
import '../../styles/superAdmin/dashboard.css';
import '../../styles/superAdmin/schedules.css';
import '../../styles/superAdmin/rfid.css';

/** Statuses used by regular (non-override) schedules. */
const regularScheduleStatusOptions = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

/** Statuses used when editing an override schedule. */
const overrideScheduleStatusOptions = [
  { value: 'overridden', label: 'Overridden' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const scheduleStatusFilterOptions = [
  { value: 'all', label: 'All statuses' },
  ...regularScheduleStatusOptions,
  { value: 'overridden', label: 'Overridden' },
];

const scheduleKindFilterOptions = [
  { value: 'all', label: 'All types' },
  { value: 'regular', label: 'Regular' },
  { value: 'override', label: 'Override' },
];

const initialFormState = {
  userId: '',
  scheduleType: 'single',
  scheduleKind: 'regular',
  scheduleDate: '',
  startDate: '',
  endDate: '',
  repeatType: 'daily',
  repeatDays: [],
  timeStart: '',
  timeEnd: '',
  gracePeriodMinutes: 15,
  status: 'pending',
};

const scheduleTableTabs = [
  { value: 'today', label: "Today's schedules" },
  { value: 'incoming', label: 'Incoming schedules' },
  { value: 'all', label: 'All schedules' },
  { value: 'recent', label: 'Recently added' },
  { value: 'past', label: 'Past schedules' },
];

function normalizeLookupValue(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function formatScheduleDate(dateValue) {
  if (!dateValue) {
    return '';
  }

  const [year, month, day] = String(dateValue).split('-').map(Number);

  if (!year || !month || !day) {
    return dateValue;
  }

  return formatDateInManila(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getPrimaryScheduleDate(schedule) {
  return schedule.scheduleDate || schedule.startDate || '';
}

function getScheduleStartStamp(schedule) {
  const date = getPrimaryScheduleDate(schedule);
  const time = String(schedule.timeStart || '').trim();

  if (!date || !time) {
    return '';
  }

  return `${date} ${time.length === 5 ? `${time}:00` : time}`;
}

function isIncomingSchedule(schedule, nowStamp) {
  const startStamp = getScheduleStartStamp(schedule);

  if (!startStamp || startStamp <= nowStamp) {
    return false;
  }

  return !['completed', 'cancelled', 'expired'].includes(schedule.status);
}

function getRecentSortValue(schedule) {
  const createdAt = parseManilaDateTime(schedule.createdAtValue || '');
  const createdTimestamp = createdAt.getTime();

  if (!Number.isNaN(createdTimestamp)) {
    return createdTimestamp;
  }

  return Number(schedule.id) || 0;
}

function isRecentlyAddedSchedule(schedule, now = Date.now()) {
  const createdTimestamp = getRecentSortValue(schedule);

  if (!createdTimestamp) {
    return false;
  }

  const age = now - createdTimestamp;
  return age >= 0 && age <= 24 * 60 * 60 * 1000;
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

function getStatusOptionsForSchedule(schedule) {
  return getScheduleKind(schedule) === 'override'
    ? overrideScheduleStatusOptions
    : regularScheduleStatusOptions;
}

function formatScheduleTypeLabel(type) {
  const value = String(type || '').trim();

  if (!value) {
    return '—';
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function CalendarEvent({ schedule }) {
  const timeLabel = getScheduleTimeLabel(schedule);

  return (
    <div className="schedules-calendar-event">
      <strong>{schedule.ownerName}</strong>
      <span>{schedule.scheduleDateLabel || formatScheduleDate(schedule.scheduleDate)}</span>
      {timeLabel ? <span>{timeLabel}</span> : null}
    </div>
  );
}

const TABLE_PDF_COLUMNS = [
  { label: 'ID', width: 36 },
  { label: 'User', width: 150 },
  { label: 'Identifier', width: 95 },
  { label: 'Schedule Date', width: 150 },
  { label: 'Time', width: 115 },
  { label: 'Type', width: 60 },
  { label: 'Status', width: 75 },
  { label: 'Created', width: 104 },
];

function getScheduleWindowLabel(schedule) {
  const dateLabel = formatScheduleDate(schedule.scheduleDate || schedule.startDate);
  const timeLabel = getScheduleTimeLabel(schedule);

  return [dateLabel, timeLabel].filter(Boolean).join(' | ');
}

function getScheduleWindowParts(schedule) {
  return {
    dateLabel: formatScheduleDate(schedule.scheduleDate || schedule.startDate),
    timeLabel:
      schedule.timeStartLabel && schedule.timeEndLabel
        ? `${schedule.timeStartLabel} - ${schedule.timeEndLabel}`
        : schedule.window,
  };
}

function getCreatedAtParts(schedule) {
  const parsed = parseManilaDateTime(schedule.createdAtValue || '');

  if (!Number.isNaN(parsed.getTime())) {
    return {
      dateLabel: formatDateInManila(parsed, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
      timeLabel: formatDateInManila(parsed, {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }),
    };
  }

  const label = String(schedule.createdAt || '').trim();
  const match = label.match(/^(.*\d{4})\s+(\d{1,2}:\d{2}\s*[AP]M)$/i);

  if (match) {
    return { dateLabel: match[1], timeLabel: match[2] };
  }

  return { dateLabel: label, timeLabel: '' };
}

export default function Schedules({ user }) {
  const confirmAction = useActionConfirm();
  const rowsPerPage = 7;
  const [schedules, setSchedules] = useState([]);
  const [usersByRole, setUsersByRole] = useState({
    faculty: [],
    staff: [],
    admins: [],
    students: [],
  });
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [lockedScheduleDate, setLockedScheduleDate] = useState('');
  const [formState, setFormState] = useState(initialFormState);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [viewSchedule, setViewSchedule] = useState(null);
  const [editingSchedule, setEditingSchedule] = useState(null);
  const [deleteSchedule, setDeleteSchedule] = useState(null);
  const [historySchedule, setHistorySchedule] = useState(null);
  const [historyEntries, setHistoryEntries] = useState([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [conflictInfo, setConflictInfo] = useState(null);
  const [pendingPayload, setPendingPayload] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [activeScheduleTab, setActiveScheduleTab] = useState('today');
  const [isScheduleTabMenuOpen, setIsScheduleTabMenuOpen] = useState(false);
  const [activeStatusFilter, setActiveStatusFilter] = useState('all');
  const [isStatusFilterMenuOpen, setIsStatusFilterMenuOpen] = useState(false);
  const [activeKindFilter, setActiveKindFilter] = useState('all');
  const [isKindFilterMenuOpen, setIsKindFilterMenuOpen] = useState(false);
  const scheduleTabMenuRef = useRef(null);
  const statusFilterMenuRef = useRef(null);
  const kindFilterMenuRef = useRef(null);

  useEffect(() => {
    let isActive = true;

    async function loadSchedulesPage() {
      try {
        const [scheduleResponse, userResponse] = await Promise.all([
          axiosClient.get('/api/schedules.php'),
          axiosClient.get('/api/user.php'),
        ]);

        if (!isActive) {
          return;
        }

        setSchedules(scheduleResponse.data.schedules || []);
        setUsersByRole({
          faculty: userResponse.data.users?.faculty || [],
          staff: userResponse.data.users?.staff || [],
          admins: userResponse.data.users?.admins || [],
          students: userResponse.data.users?.students || [],
        });
        setErrorMessage('');
      } catch {
        if (isActive) {
          setSchedules([]);
          setUsersByRole({
            faculty: [],
            staff: [],
            admins: [],
            students: [],
          });
          setErrorMessage('Unable to load schedules right now.');
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    loadSchedulesPage();

    return () => {
      isActive = false;
    };
  }, []);

  const userSelectGroups = useMemo(() => {
    return [
      { label: 'Students', identifierLabel: 'School ID', value: usersByRole.students },
      { label: 'Faculty', identifierLabel: 'Employee ID', value: usersByRole.faculty },
      { label: 'Staff', identifierLabel: 'Employee ID', value: usersByRole.staff },
      { label: 'Admins', identifierLabel: 'Employee ID', value: usersByRole.admins },
    ];
  }, [usersByRole]);

  const allUsers = useMemo(() => {
    return userSelectGroups.flatMap((group) =>
      group.value.map((item) => ({
        ...item,
        groupLabel: group.label,
        identifierLabel: group.identifierLabel,
      })),
    );
  }, [userSelectGroups]);

  const schedulableUsers = useMemo(() => {
    return allUsers;
  }, [allUsers]);

  const normalizedUserSearchQuery = normalizeLookupValue(userSearchQuery);

  const filteredUsers = useMemo(() => {
    if (!normalizedUserSearchQuery) {
      return [];
    }

    return schedulableUsers.filter((item) => {
      return normalizeLookupValue(item.identifier).includes(normalizedUserSearchQuery);
    });
  }, [normalizedUserSearchQuery, schedulableUsers]);

  const exactMatchedUser = useMemo(() => {
    return (
      filteredUsers.find(
        (item) => normalizeLookupValue(item.identifier) === normalizedUserSearchQuery,
      ) || null
    );
  }, [filteredUsers, normalizedUserSearchQuery]);

  const suggestedUsers = useMemo(() => {
    if (exactMatchedUser) {
      return [];
    }

    return filteredUsers;
  }, [exactMatchedUser, filteredUsers]);

  const selectedUser = useMemo(() => {
    return schedulableUsers.find((item) => String(item.id) === String(formState.userId)) || null;
  }, [formState.userId, schedulableUsers]);

  const activeSelectedUser = selectedUser || exactMatchedUser;

  function getUserDisplayName(selected) {
    if (!selected) {
      return '';
    }

    return selected.name || [selected.firstName, selected.lastName].filter(Boolean).join(' ') || selected.username || 'Unknown User';
  }

  function getUserDepartment(selected) {
    if (!selected) {
      return '';
    }

    return selected.groupLabel === 'Students'
      ? selected.programDepartment || selected.college || 'Not assigned'
      : selected.officeDepartment || 'Not assigned';
  }

  function getUserPosition(selected) {
    if (!selected) {
      return '';
    }

    if (selected.groupLabel === 'Students') {
      return [selected.yearLevel, selected.section].filter(Boolean).join(' / ') || 'Student';
    }

    return selected.workPosition || selected.role?.replace('_', ' ') || 'Not assigned';
  }

  function getActorDisplayName(actor) {
    if (!actor) {
      return 'System';
    }

    const fullName = [
      actor.first_name,
      actor.middle_name,
      actor.last_name,
      actor.extension_name,
    ].filter(Boolean).join(' ');

    return fullName || actor.name || actor.username || actor.email || 'System';
  }

  const columns = ['Sched ID', 'User', 'Schedule Window', 'Type', 'Status', 'Created', 'Actions'];
  const todayStamp = useMemo(() => getManilaDateStamp(), []);
  const nowStamp = useMemo(() => getManilaDateTimeStamp(), [schedules]);
  const schedulesForActiveTab = useMemo(() => {
    if (activeScheduleTab === 'incoming') {
      return schedules
        .filter((schedule) => isIncomingSchedule(schedule, nowStamp))
        .sort((left, right) => getScheduleStartStamp(left).localeCompare(getScheduleStartStamp(right)));
    }

    if (activeScheduleTab === 'today') {
      return schedules
        .filter((schedule) => getPrimaryScheduleDate(schedule) === todayStamp)
        .sort((left, right) => {
          if (left.timeStart === right.timeStart) {
            return (Number(right.id) || 0) - (Number(left.id) || 0);
          }

          return String(left.timeStart || '').localeCompare(String(right.timeStart || ''));
        });
    }

    if (activeScheduleTab === 'past') {
      return schedules
        .filter((schedule) => {
          const scheduleDate = getPrimaryScheduleDate(schedule);
          return scheduleDate && scheduleDate < todayStamp;
        })
        .sort((left, right) => {
          const dateCompare = String(getPrimaryScheduleDate(right)).localeCompare(String(getPrimaryScheduleDate(left)));

          if (dateCompare !== 0) {
            return dateCompare;
          }

          return (Number(right.id) || 0) - (Number(left.id) || 0);
        });
    }

    if (activeScheduleTab === 'recent') {
      return schedules
        .filter((schedule) => isRecentlyAddedSchedule(schedule))
        .sort((left, right) => getRecentSortValue(right) - getRecentSortValue(left));
    }

    return schedules;
  }, [activeScheduleTab, nowStamp, schedules, todayStamp]);
  const filteredSchedules = useMemo(() => {
    return schedulesForActiveTab.filter((schedule) => {
      if (activeKindFilter !== 'all' && getScheduleKind(schedule) !== activeKindFilter) {
        return false;
      }

      if (activeStatusFilter !== 'all' && schedule.status !== activeStatusFilter) {
        return false;
      }

      return true;
    });
  }, [activeKindFilter, activeStatusFilter, schedulesForActiveTab]);
  const scheduleTabCounts = useMemo(() => {
    return {
      all: schedules.length,
      today: schedules.filter((schedule) => getPrimaryScheduleDate(schedule) === todayStamp).length,
      incoming: schedules.filter((schedule) => isIncomingSchedule(schedule, nowStamp)).length,
      recent: schedules.filter((schedule) => isRecentlyAddedSchedule(schedule)).length,
      past: schedules.filter((schedule) => {
        const scheduleDate = getPrimaryScheduleDate(schedule);
        return scheduleDate && scheduleDate < todayStamp;
      }).length,
    };
  }, [nowStamp, schedules, todayStamp]);
  const statusFilterCounts = useMemo(() => {
    const kindScoped = schedulesForActiveTab.filter((schedule) => {
      if (activeKindFilter === 'all') {
        return true;
      }

      return getScheduleKind(schedule) === activeKindFilter;
    });

    return {
      all: kindScoped.length,
      ...Object.fromEntries(
        [...regularScheduleStatusOptions, { value: 'overridden', label: 'Overridden' }].map((option) => [
          option.value,
          kindScoped.filter((schedule) => schedule.status === option.value).length,
        ]),
      ),
    };
  }, [activeKindFilter, schedulesForActiveTab]);
  const kindFilterCounts = useMemo(
    () => ({
      all: schedulesForActiveTab.length,
      regular: schedulesForActiveTab.filter((schedule) => getScheduleKind(schedule) === 'regular').length,
      override: schedulesForActiveTab.filter((schedule) => getScheduleKind(schedule) === 'override').length,
    }),
    [schedulesForActiveTab],
  );
  const activeScheduleTabConfig =
    scheduleTableTabs.find((tab) => tab.value === activeScheduleTab) || scheduleTableTabs[0];
  const activeStatusFilterConfig =
    scheduleStatusFilterOptions.find((option) => option.value === activeStatusFilter) ||
    scheduleStatusFilterOptions[0];
  const activeKindFilterConfig =
    scheduleKindFilterOptions.find((option) => option.value === activeKindFilter) ||
    scheduleKindFilterOptions[0];
  const totalPages = Math.max(1, Math.ceil(filteredSchedules.length / rowsPerPage));
  const paginatedSchedules = useMemo(() => {
    const startIndex = (currentPage - 1) * rowsPerPage;
    return filteredSchedules.slice(startIndex, startIndex + rowsPerPage);
  }, [currentPage, filteredSchedules, rowsPerPage]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeScheduleTab, activeStatusFilter, activeKindFilter]);

  useEffect(() => {
    if (!isScheduleTabMenuOpen && !isStatusFilterMenuOpen && !isKindFilterMenuOpen) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (isScheduleTabMenuOpen && !scheduleTabMenuRef.current?.contains(event.target)) {
        setIsScheduleTabMenuOpen(false);
      }

      if (isStatusFilterMenuOpen && !statusFilterMenuRef.current?.contains(event.target)) {
        setIsStatusFilterMenuOpen(false);
      }

      if (isKindFilterMenuOpen && !kindFilterMenuRef.current?.contains(event.target)) {
        setIsKindFilterMenuOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setIsScheduleTabMenuOpen(false);
        setIsStatusFilterMenuOpen(false);
        setIsKindFilterMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isScheduleTabMenuOpen, isStatusFilterMenuOpen, isKindFilterMenuOpen]);

  useEffect(() => {
    if (!isModalOpen && !editingSchedule && !viewSchedule && !deleteSchedule && !historySchedule && !conflictInfo) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setIsModalOpen(false);
        setEditingSchedule(null);
        setViewSchedule(null);
        setDeleteSchedule(null);
        setHistorySchedule(null);
        setHistoryEntries([]);
        setHistoryError('');
        setConflictInfo(null);
        setPendingPayload(null);
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isModalOpen, editingSchedule, viewSchedule, deleteSchedule, historySchedule, conflictInfo]);

  useEffect(() => {
    if (!isModalOpen && !editingSchedule) {
      return;
    }

    if (!normalizedUserSearchQuery) {
      if (formState.userId && !editingSchedule) {
        updateField('userId', '');
      }

      return;
    }

    if (exactMatchedUser && String(formState.userId) !== String(exactMatchedUser.id)) {
      updateField('userId', String(exactMatchedUser.id));
      setFormError('');
      return;
    }

    if (!exactMatchedUser && formState.userId) {
      updateField('userId', '');
    }
  }, [exactMatchedUser, formState.userId, isModalOpen, editingSchedule, normalizedUserSearchQuery]);

  function openModal(scheduleDate = '') {
    setFormState({
      ...initialFormState,
      scheduleType: 'single',
      scheduleDate,
      gracePeriodMinutes: getDefaultGracePeriodMinutes(),
    });
    setLockedScheduleDate(scheduleDate);
    setFormError('');
    setUserSearchQuery('');
    setIsModalOpen(true);
  }

  function closeAllModals() {
    setIsModalOpen(false);
    setLockedScheduleDate('');
    setEditingSchedule(null);
    setViewSchedule(null);
    setDeleteSchedule(null);
    setHistorySchedule(null);
    setHistoryEntries([]);
    setHistoryError('');
    setConflictInfo(null);
    setPendingPayload(null);
    setFormState(initialFormState);
    setFormError('');
    setUserSearchQuery('');
  }

  function handleView(schedule) {
    setViewSchedule(schedule);
  }

  function handleEdit(schedule) {
    setEditingSchedule(schedule);
    setFormState({
      userId: String(schedule.userId),
      scheduleType: schedule.scheduleType,
      scheduleDate: schedule.scheduleDate || '',
      startDate: schedule.startDate || '',
      endDate: schedule.endDate || '',
      repeatType: schedule.repeatType !== 'none' ? schedule.repeatType : 'daily',
      repeatDays: schedule.repeatDays || [],
      timeStart: schedule.timeStart || '',
      timeEnd: schedule.timeEnd || '',
      gracePeriodMinutes: Number.isFinite(Number(schedule.gracePeriodMinutes))
        ? Number(schedule.gracePeriodMinutes)
        : getDefaultGracePeriodMinutes(),
      status: schedule.status || 'pending',
    });
    setUserSearchQuery(schedule.ownerIdentifier || '');
    setFormError('');
  }

  function handleDelete(schedule) {
    if (user?.role === 'admin') {
      return;
    }

    setDeleteSchedule(schedule);
  }

  async function handleHistory(schedule) {
    setHistorySchedule(schedule);
    setHistoryEntries([]);
    setHistoryError('');
    setIsHistoryLoading(true);

    try {
      const response = await axiosClient.get(`/api/schedules.php?history=1&id=${schedule.id}`);
      setHistoryEntries(response.data.history || []);
    } catch {
      setHistoryError('Unable to load schedule history.');
    } finally {
      setIsHistoryLoading(false);
    }
  }

  async function confirmDelete() {
    if (!deleteSchedule || user?.role === 'admin') {
      return;
    }

    const confirmed = await confirmAction({
      step: 'password',
      title: 'Security Verification',
      message: 'Enter your password to confirm this action.',
      danger: true,
    });
    if (!confirmed) {
      return;
    }

    try {
      await axiosClient.delete(
        `/api/schedules.php?id=${deleteSchedule.id}&actor_id=${encodeURIComponent(user?.id || '')}`,
      );
      setSchedules((previous) => previous.filter((s) => s.id !== deleteSchedule.id));
      setDeleteSchedule(null);
    } catch {
      setFormError('Unable to delete schedule.');
    }
  }

  async function handleConfirmOverlap() {
    if (!pendingPayload) {
      closeAllModals();
      return;
    }

    if ((conflictInfo?.validCount ?? 0) === 0) {
      setConflictInfo(null);
      setPendingPayload(null);
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await axiosClient.post('/api/schedules.php', { ...pendingPayload, confirmOverlap: true });
      const data = response.data;

      if (data.isBatch) {
        const createdSchedules = data.schedules || [];
        const conflicts = data.conflicts || [];

        if (createdSchedules.length > 0) {
          setSchedules((previous) => [...createdSchedules, ...previous]);
          setCurrentPage(1);
        }

        if (conflicts.length > 0) {
          setFormError(conflicts.length + ' date(s) were skipped due to conflicts.');
        }
      } else if (data.schedule) {
        setSchedules((previous) => [data.schedule, ...previous]);
        setCurrentPage(1);
      }

      closeAllModals();
    } catch {
      setFormError('Unable to create schedules.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function updateField(key, value) {
    setFormState((previous) => ({ ...previous, [key]: value }));
  }

  function toggleRepeatDay(day) {
    setFormState((previous) => {
      const isSelected = previous.repeatDays.includes(day);
      return {
        ...previous,
        repeatDays: isSelected
          ? previous.repeatDays.filter((item) => item !== day)
          : [...previous.repeatDays, day],
      };
    });
  }

  function resetRecurringFields(nextType) {
    if (nextType === 'single') {
      setFormState((previous) => ({
        ...previous,
        startDate: '',
        endDate: '',
        repeatType: 'daily',
        repeatDays: [],
      }));
    } else {
      setFormState((previous) => ({
        ...previous,
        scheduleDate: '',
      }));
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError('');

    if (editingSchedule) {
      if (!formState.timeStart || !formState.timeEnd) {
        setFormError('Provide a start and end time.');
        return;
      }

      const confirmed = await confirmAction({
        title: 'Update schedule',
        message: 'Are you sure you want to update this schedule?',
      });
      if (!confirmed) {
        return;
      }

      setIsSubmitting(true);

      try {
        const payload = {
          id: editingSchedule.id,
          scheduleDate: formState.scheduleDate || null,
          timeStart: formState.timeStart,
          timeEnd: formState.timeEnd,
          gracePeriodMinutes: Number(formState.gracePeriodMinutes),
          status: formState.status,
          updatedBy: user?.id ?? null,
          updatedByName: getActorDisplayName(user),
          approvedBy: formState.status === 'approved' ? (user?.id ?? null) : null,
        };

        const response = await axiosClient.put('/api/schedules.php', payload);
        const updated = response.data.schedule;

        if (updated) {
          setSchedules((previous) =>
            previous.map((s) => (s.id === updated.id ? updated : s)),
          );
        }

        closeAllModals();
      } catch {
        setFormError('Unable to update schedule.');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    const scheduleUserId = Number(formState.userId || activeSelectedUser?.id || 0);

    if (!scheduleUserId) {
      setFormError('Enter a valid Employee ID or School ID for this schedule.');
      return;
    }

    if (!formState.timeStart || !formState.timeEnd) {
      setFormError('Provide a start and end time.');
      return;
    }

    if (formState.timeEnd <= formState.timeStart) {
      setFormError('End time must be after the start time.');
      return;
    }

    if (formState.scheduleType === 'single' && !formState.scheduleDate) {
      setFormError('Provide a schedule date.');
      return;
    }

    if (formState.scheduleType === 'recurring' && (!formState.startDate || !formState.endDate)) {
      setFormError('Provide a start date and end date.');
      return;
    }

    if (formState.scheduleType === 'recurring' && formState.repeatType === 'weekly_selected' && formState.repeatDays.length === 0) {
      setFormError('Select at least one repeat day.');
      return;
    }

    const confirmed = await confirmAction({
      title: 'Add schedule',
      message: 'Are you sure you want to add this schedule?',
    });
    if (!confirmed) {
      return;
    }

    setIsSubmitting(true);

    try {
      const isRecurring = formState.scheduleType === 'recurring';
      const payload = {
        userId: scheduleUserId,
        scheduleType: formState.scheduleType,
        scheduleKind: formState.scheduleKind,
        scheduleDate: isRecurring ? null : formState.scheduleDate,
        startDate: isRecurring ? formState.startDate : null,
        endDate: isRecurring ? formState.endDate : null,
        repeatType: isRecurring ? formState.repeatType : 'none',
        repeatDays: isRecurring ? formState.repeatDays : null,
        timeStart: formState.timeStart,
        timeEnd: formState.timeEnd,
        gracePeriodMinutes: Number(formState.gracePeriodMinutes),
        status: formState.status,
        createdBy: user?.id ?? null,
        approvedBy: formState.status === 'approved' ? (user?.id ?? null) : null,
      };

      const response = await axiosClient.post('/api/schedules.php', payload);
      const data = response.data;

      if (data.isBatch) {
        const createdSchedules = data.schedules || [];
        const conflicts = data.conflicts || [];

        if (createdSchedules.length > 0) {
          setSchedules((previous) => [...createdSchedules, ...previous]);
          setCurrentPage(1);
        }

        if (conflicts.length > 0) {
          setConflictInfo({ conflicts, createdCount: createdSchedules.length });
          setPendingPayload(null);
          return;
        }
      } else if (data.hasConflicts) {
        setConflictInfo({
          conflicts: data.conflicts || [],
          conflictDetails: data.conflictDetails || [],
          validCount: (data.validDates || []).length,
        });
        setPendingPayload(payload);
        return;
      } else {
        const created = data.schedule;
        if (created) {
          setSchedules((previous) => [created, ...previous]);
          setCurrentPage(1);
        }
      }

      closeAllModals();
    } catch (error) {
      setFormError(error?.response?.data?.message || 'Unable to create schedule right now.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const [calOffset, setCalOffset] = useState(0);
  const [isCalendarExpanded, setIsCalendarExpanded] = useState(false);
  const [focusedCalendarDate, setFocusedCalendarDate] = useState('');
  const [openMoreDate, setOpenMoreDate] = useState('');
  const [calendarView, setCalendarView] = useState('month');
  const [weekStartDate, setWeekStartDate] = useState('');
  const [exportTarget, setExportTarget] = useState(null);
  const isWeekView = isCalendarExpanded && calendarView === 'week';
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const schedulesByDate = useMemo(() => {
    const grouped = new Map();

    schedules.forEach((schedule) => {
      if (!schedule.scheduleDate || schedule.status === 'pending') {
        return;
      }

      const entries = grouped.get(schedule.scheduleDate) || [];
      entries.push(schedule);
      grouped.set(schedule.scheduleDate, entries);
    });

    grouped.forEach((entries) => {
      entries.sort((left, right) => String(left.timeStart || '').localeCompare(String(right.timeStart || '')));
    });

    return grouped;
  }, [schedules]);

  const todayStr = useMemo(() => getManilaDateStamp(), []);

  const calYear = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + calOffset);
    return d.getFullYear();
  }, [calOffset]);

  const calMonth = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + calOffset);
    return d.getMonth();
  }, [calOffset]);

  const calendarGrid = useMemo(() => {
    const firstDay = new Date(calYear, calMonth, 1).getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const cells = [];
    const startOffset = firstDay === 0 ? 6 : firstDay - 1;

    for (let i = 0; i < startOffset; i++) {
      cells.push(null);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const cellDate = new Date(calYear, calMonth, d);
      cellDate.setHours(0, 0, 0, 0);
      const isPast = cellDate < today;
      const isToday = dateStr === todayStr;
      const entries = schedulesByDate.get(dateStr) || [];
      const hasSchedule = entries.length > 0;
      cells.push({ day: d, dateStr, isPast, isToday, hasSchedule, entries });
    }

    return cells;
  }, [calYear, calMonth, schedulesByDate, today, todayStr]);

  const focusedCell = useMemo(
    () => calendarGrid.find((cell) => cell?.dateStr === focusedCalendarDate) || null,
    [calendarGrid, focusedCalendarDate],
  );

  function shiftFocusedDate(dayDelta) {
    const [year, month, day] = focusedCalendarDate.split('-').map(Number);
    const nextDate = new Date(year, month - 1, day + dayDelta);
    const dateStr = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`;
    const monthDelta = (nextDate.getFullYear() - calYear) * 12 + (nextDate.getMonth() - calMonth);

    if (monthDelta !== 0) {
      setCalOffset((current) => current + monthDelta);
    }

    setFocusedCalendarDate(dateStr);
  }

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const dayHeaders = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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
        entries: schedulesByDate.get(dateStr) || [],
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

  function openWeeklyView() {
    const now = new Date();
    const isViewingCurrentMonth = calYear === now.getFullYear() && calMonth === now.getMonth();
    const anchorDate = isViewingCurrentMonth ? todayStr : toDateStamp(new Date(calYear, calMonth, 1));

    setWeekStartDate(getWeekStartStamp(anchorDate));
    setFocusedCalendarDate('');
    setOpenMoreDate('');
    setCalendarView('week');
  }

  function openMonthlyView() {
    if (weekStartDate) {
      const middleOfWeek = parseDateStamp(shiftDateStamp(weekStartDate, 3));
      const now = new Date();
      setCalOffset((middleOfWeek.getFullYear() - now.getFullYear()) * 12 + (middleOfWeek.getMonth() - now.getMonth()));
    }

    setCalendarView('month');
  }

  const tableFilterSummary = [
    activeScheduleTabConfig.label,
    activeKindFilterConfig.label,
    activeStatusFilterConfig.label,
  ].join(' · ');

  function getTableExportFileName(extension) {
    const parts = ['schedules', activeScheduleTab];

    if (activeKindFilter !== 'all') {
      parts.push(activeKindFilter);
    }

    if (activeStatusFilter !== 'all') {
      parts.push(activeStatusFilter);
    }

    parts.push(todayStr);
    return `${parts.join('-')}.${extension}`;
  }

  function exportTableCsv() {
    const headers = ['Schedule ID', 'User', 'Identifier', 'Schedule Type', 'Kind', 'Schedule Date', 'Start Time', 'End Time', 'Status', 'Created'];
    const rows = filteredSchedules.map((schedule) => {
      const start = parseTimeToMinutes(schedule.timeStart);
      const end = parseTimeToMinutes(schedule.timeEnd);

      return [
        schedule.id,
        schedule.ownerName,
        schedule.ownerIdentifier,
        formatScheduleTypeLabel(schedule.scheduleType),
        formatScheduleKindLabel(getScheduleKind(schedule)),
        getPrimaryScheduleDate(schedule),
        schedule.timeStartLabel || (start !== null ? formatMinutesLabel(start) : ''),
        schedule.timeEndLabel || (end !== null ? formatMinutesLabel(end) : ''),
        formatScheduleStatusLabel(schedule.status),
        schedule.createdAt,
      ];
    });
    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');

    downloadFile(csvContent, 'text/csv;charset=utf-8;', getTableExportFileName('csv'));
  }

  function exportTablePdf() {
    const rows = filteredSchedules.map((schedule) => {
      const windowParts = getScheduleWindowParts(schedule);
      const createdParts = getCreatedAtParts(schedule);

      return [
        String(schedule.id),
        schedule.ownerName,
        schedule.ownerIdentifier,
        windowParts.dateLabel,
        windowParts.timeLabel,
        formatScheduleKindLabel(getScheduleKind(schedule)),
        formatScheduleStatusLabel(schedule.status),
        [createdParts.dateLabel, createdParts.timeLabel].filter(Boolean).join(' '),
      ];
    });
    const pdf = buildTablePdf({
      title: 'Schedules',
      note: `Filters: ${tableFilterSummary} | ${rows.length} schedule${rows.length === 1 ? '' : 's'}`,
      columns: TABLE_PDF_COLUMNS,
      rows,
      emphasizeColumn: 1,
      emptyMessage: 'No schedules match the selected filters.',
    });

    downloadFile(pdf, 'application/pdf', getTableExportFileName('pdf'));
  }

  function getExportableSchedules(isInRange) {
    return schedules
      .filter(
        (schedule) =>
          schedule.scheduleDate &&
          (schedule.status === 'approved' || schedule.status === 'overridden') &&
          isInRange(schedule.scheduleDate),
      )
      .sort(compareSchedulesChronologically);
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
      `monthly-schedule-${monthNames[calMonth]}-${calYear}.csv`,
    );
  }

  function exportWeeklyCsv() {
    downloadFile(
      buildScheduleCsv(getExportableSchedules(isInDisplayedWeek)),
      'text/csv;charset=utf-8;',
      `weekly-schedule-${getWeekFileStamp()}.csv`,
    );
  }

  function exportWeeklyPdf() {
    const weekSchedules = getExportableSchedules(isInDisplayedWeek);
    const pdf = buildWeeklyPdf({
      title: `Weekly Schedule: ${weekRangeLabel}`,
      note: 'Approved and overridden schedules.',
      days: weekDays.map((day) => ({
        ...day,
        entries: weekSchedules.filter((schedule) => schedule.scheduleDate === day.dateStr),
      })),
    });

    downloadFile(pdf, 'application/pdf', `weekly-schedule-${getWeekFileStamp()}.pdf`);
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

  function exportMonthlyPdf() {
    const title = `${monthNames[calMonth]} ${calYear}`;
    const schedulesByDate = new Map();

    getExportableSchedules(isInDisplayedMonth).forEach((schedule) => {
      const entries = schedulesByDate.get(schedule.scheduleDate) || [];
      entries.push(schedule);
      schedulesByDate.set(schedule.scheduleDate, entries);
    });

    const cells = calendarGrid.map((cell) => {
      if (!cell) {
        return null;
      }

      const entries = schedulesByDate.get(cell.dateStr) || [];

      return {
        day: cell.day,
        tone: entries.length === 0 ? '' : cell.isToday ? 'today' : cell.isPast ? 'past' : 'upcoming',
        events: entries.map((schedule) => [
          { text: schedule.ownerName, size: 8, color: ['0.25', '0.29', '0.33'] },
          { text: schedule.scheduleDateLabel || formatScheduleDate(schedule.scheduleDate), size: 7, color: ['0.36', '0.40', '0.45'] },
          { text: getScheduleTimeLabel(schedule), size: 7, color: ['0.36', '0.40', '0.45'] },
        ].filter((line) => line.text)),
      };
    });
    const pdf = buildCalendarPdf({
      title,
      note: 'Approved and overridden schedules.',
      dayHeaders,
      cells,
    });

    downloadFile(pdf, 'application/pdf', `monthly-schedule-${monthNames[calMonth]}-${calYear}.pdf`);
  }

  return (
    <main className="admin-dashboard schedules-page" aria-label="Schedules">
      <div className={`schedules-layout${isCalendarExpanded ? ' is-calendar-expanded' : ''}`}>
      <section className="dashboard-recent-card schedules-card">
        <div className="dashboard-panel-header">
          <div>
            <span>Schedules</span>
            <p>Manage access schedules created for users.</p>
          </div>
          <div className="schedules-header-actions">
            <button type="button" className="schedules-csv-button" onClick={() => setExportTarget('table')}>
              <Download size={14} />
              Download
            </button>
            <button type="button" className="dashboard-schedule-button schedules-add-button" onClick={() => openModal()}>
              <CalendarPlus size={16} aria-hidden="true" />
              Add Schedule
            </button>
          </div>
        </div>

        <div className="schedules-table-filters">
          <div
            className="schedules-table-tabs"
            ref={scheduleTabMenuRef}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                setIsScheduleTabMenuOpen(false);
              }
            }}
          >
            <button
              type="button"
              className={`schedules-table-tab-trigger${isScheduleTabMenuOpen ? ' is-open' : ''}`}
              aria-haspopup="listbox"
              aria-expanded={isScheduleTabMenuOpen}
              aria-controls="schedule-filter-menu"
              aria-label={`Schedule filter: ${activeScheduleTabConfig.label}`}
              onClick={() => {
                setIsScheduleTabMenuOpen((open) => !open);
                setIsStatusFilterMenuOpen(false);
                setIsKindFilterMenuOpen(false);
              }}
            >
              <span className="schedules-table-tab-trigger-label">{activeScheduleTabConfig.label}</span>
              <span className="schedules-table-tab-count">{scheduleTabCounts[activeScheduleTabConfig.value]}</span>
              <ChevronDown className="schedules-table-tab-chevron" size={14} aria-hidden="true" />
            </button>

            {isScheduleTabMenuOpen ? (
              <div
                id="schedule-filter-menu"
                className="schedules-table-tab-menu"
                role="listbox"
                aria-label="Schedule table filters"
              >
                {scheduleTableTabs.map((tab) => (
                  <button
                    key={tab.value}
                    type="button"
                    role="option"
                    className={`schedules-table-tab-option${activeScheduleTab === tab.value ? ' is-active' : ''}`}
                    aria-selected={activeScheduleTab === tab.value}
                    onClick={() => {
                      setActiveScheduleTab(tab.value);
                      setIsScheduleTabMenuOpen(false);
                    }}
                  >
                    <Check className="schedules-table-tab-check" size={15} aria-hidden="true" />
                    <span className="schedules-table-tab-option-label">{tab.label}</span>
                    <span className="schedules-table-tab-count">{scheduleTabCounts[tab.value]}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div
            className="schedules-table-tabs schedules-status-filter"
            ref={kindFilterMenuRef}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                setIsKindFilterMenuOpen(false);
              }
            }}
          >
            <button
              type="button"
              className={`schedules-table-tab-trigger${isKindFilterMenuOpen ? ' is-open' : ''}`}
              aria-haspopup="listbox"
              aria-expanded={isKindFilterMenuOpen}
              aria-controls="schedule-kind-filter-menu"
              aria-label={`Type filter: ${activeKindFilterConfig.label}`}
              onClick={() => {
                setIsKindFilterMenuOpen((open) => !open);
                setIsScheduleTabMenuOpen(false);
                setIsStatusFilterMenuOpen(false);
              }}
            >
              <span className="schedules-table-tab-trigger-label">{activeKindFilterConfig.label}</span>
              <span className="schedules-table-tab-count">{kindFilterCounts[activeKindFilterConfig.value]}</span>
              <ChevronDown className="schedules-table-tab-chevron" size={14} aria-hidden="true" />
            </button>

            {isKindFilterMenuOpen ? (
              <div
                id="schedule-kind-filter-menu"
                className="schedules-table-tab-menu"
                role="listbox"
                aria-label="Schedule type filters"
              >
                {scheduleKindFilterOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    className={`schedules-table-tab-option${activeKindFilter === option.value ? ' is-active' : ''}`}
                    aria-selected={activeKindFilter === option.value}
                    onClick={() => {
                      setActiveKindFilter(option.value);
                      setIsKindFilterMenuOpen(false);
                    }}
                  >
                    <Check className="schedules-table-tab-check" size={15} aria-hidden="true" />
                    <span className="schedules-table-tab-option-label">{option.label}</span>
                    <span className="schedules-table-tab-count">{kindFilterCounts[option.value]}</span>
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
              aria-controls="schedule-status-filter-menu"
              aria-label={`Status filter: ${activeStatusFilterConfig.label}`}
              onClick={() => {
                setIsStatusFilterMenuOpen((open) => !open);
                setIsScheduleTabMenuOpen(false);
                setIsKindFilterMenuOpen(false);
              }}
            >
              <span className="schedules-table-tab-trigger-label">{activeStatusFilterConfig.label}</span>
              <span className="schedules-table-tab-count">{statusFilterCounts[activeStatusFilterConfig.value]}</span>
              <ChevronDown className="schedules-table-tab-chevron" size={14} aria-hidden="true" />
            </button>

            {isStatusFilterMenuOpen ? (
              <div
                id="schedule-status-filter-menu"
                className="schedules-table-tab-menu"
                role="listbox"
                aria-label="Schedule status filters"
              >
                {scheduleStatusFilterOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    className={`schedules-table-tab-option${activeStatusFilter === option.value ? ' is-active' : ''}`}
                    aria-selected={activeStatusFilter === option.value}
                    onClick={() => {
                      setActiveStatusFilter(option.value);
                      setIsStatusFilterMenuOpen(false);
                    }}
                  >
                    <Check className="schedules-table-tab-check" size={15} aria-hidden="true" />
                    <span className="schedules-table-tab-option-label">{option.label}</span>
                    <span className="schedules-table-tab-count">{statusFilterCounts[option.value]}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="dashboard-recent-table-wrap schedules-table-wrap">
          <table className="dashboard-recent-table schedules-table">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td className="dashboard-recent-empty" colSpan={columns.length}>
                    Loading schedules...
                  </td>
                </tr>
              )}

              {!isLoading && errorMessage && (
                <tr>
                  <td className="dashboard-recent-empty" colSpan={columns.length}>
                    {errorMessage}
                  </td>
                </tr>
              )}

              {!isLoading && !errorMessage && filteredSchedules.length === 0 && (
                <tr>
                  <td className="dashboard-recent-empty" colSpan={columns.length}>
                    {activeStatusFilter !== 'all'
                      ? `No ${activeStatusFilterConfig.label.toLowerCase()} schedules found.`
                      : null}
                    {activeStatusFilter === 'all' && activeScheduleTab === 'all' && 'No schedules found.'}
                    {activeStatusFilter === 'all' && activeScheduleTab === 'today' && 'No schedules found for today.'}
                    {activeStatusFilter === 'all' && activeScheduleTab === 'incoming' && 'No incoming schedules found.'}
                    {activeStatusFilter === 'all' && activeScheduleTab === 'recent' && 'No recently added schedules found.'}
                    {activeStatusFilter === 'all' && activeScheduleTab === 'past' && 'No past schedules found.'}
                  </td>
                </tr>
              )}

              {!isLoading &&
                !errorMessage &&
                paginatedSchedules.map((schedule) => {
                  const scheduleWindow = getScheduleWindowParts(schedule);
                  const createdAtParts = getCreatedAtParts(schedule);

                  return (
                  <tr key={schedule.id}>
                    <td>{schedule.id}</td>
                    <td>
                      <strong>{schedule.ownerName}</strong>
                      <span>{schedule.ownerIdentifier}</span>
                    </td>
                    <td>
                      <div className="schedules-window-cell">
                        <strong>{scheduleWindow.dateLabel}</strong>
                        <span>{scheduleWindow.timeLabel}</span>
                      </div>
                    </td>
                    <td>
                      <span
                        className={`dashboard-log-status dashboard-log-status-kind-${getScheduleKind(schedule)}`}
                      >
                        {formatScheduleKindLabel(getScheduleKind(schedule))}
                      </span>
                    </td>
                    <td>
                      <span className={`dashboard-log-status dashboard-log-status-${schedule.status}`}>
                        {formatScheduleStatusLabel(schedule.status)}
                      </span>
                    </td>
                    <td>
                      <div className="schedules-window-cell">
                        <strong>{createdAtParts.dateLabel}</strong>
                        {createdAtParts.timeLabel ? <span>{createdAtParts.timeLabel}</span> : null}
                      </div>
                    </td>
                    <td>
                      <RowActionMenu
                        label={`Actions for schedule ${schedule.id}`}
                        items={[
                          { label: 'View', icon: Eye, onClick: () => handleView(schedule) },
                          { label: 'Edit', icon: Pencil, onClick: () => handleEdit(schedule) },
                          { label: 'History', icon: History, onClick: () => handleHistory(schedule) },
                          { label: 'Delete', icon: Trash2, danger: true, hidden: user?.role === 'admin', onClick: () => handleDelete(schedule) },
                        ]}
                      />
                    </td>
                  </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {!isLoading && !errorMessage && filteredSchedules.length > 0 && (
          <div className="schedules-pagination" aria-label="Schedules pagination">
            <p>
              Showing {(currentPage - 1) * rowsPerPage + 1}-
              {Math.min(currentPage * rowsPerPage, filteredSchedules.length)} of {filteredSchedules.length}
            </p>
            <div className="schedules-pagination-controls">
              <button
                type="button"
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </button>
              <span>
                Page {currentPage} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                disabled={currentPage === totalPages}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </section>

      <aside className="schedules-calendar-card">
        <div className="schedules-calendar">
          {isCalendarExpanded && (!focusedCell || isWeekView) && (
            <div className="schedules-calendar-export-row">
              <button type="button" className="schedules-calendar-export" onClick={() => setExportTarget('calendar')}>
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
          )}
          {isCalendarExpanded && focusedCell && !isWeekView ? (
            <div className="schedules-calendar-export-row">
              <button
                type="button"
                className="schedules-calendar-export"
                onClick={() => openModal(focusedCell.dateStr)}
              >
                <CalendarPlus size={14} />
                Add Schedule
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
                    setCalOffset((p) => p - 1);
                  }}
                >
                  <ChevronLeft size={14} />
                </button>
                <span>{monthNames[calMonth]} {calYear}</span>
                <button
                  type="button"
                  className="schedules-calendar-nav"
                  onClick={() => {
                    setOpenMoreDate('');
                    setCalOffset((p) => p + 1);
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
              {focusedCell.entries.length > 0 && (
                <div className="schedules-calendar-day-table">
                  {focusedCell.entries.map((schedule) => (
                    <div className="schedules-calendar-day-row" key={schedule.id}>
                      <CalendarEvent schedule={schedule} />
                      <RowActionMenu
                        label={`Actions for ${schedule.userName || 'schedule'}`}
                        items={[
                          { label: 'View', icon: Eye, onClick: () => handleView(schedule) },
                          { label: 'Edit', icon: Pencil, onClick: () => handleEdit(schedule) },
                          { label: 'Delete', icon: Trash2, danger: true, hidden: user?.role === 'admin', onClick: () => handleDelete(schedule) },
                        ]}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
          <div className="schedules-calendar-grid">
            {dayHeaders.map((h) => (
              <div key={h} className="schedules-calendar-day-header">{h}</div>
            ))}
            {calendarGrid.map((cell, i) => (
              <div
                key={i}
                className={getCalendarCellClass(cell)}
              >
                {cell ? (
                  <>
                    <span className="schedules-calendar-day-number">{cell.day}</span>
                    {isCalendarExpanded && (
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
                    )}
                    {cell.isToday && !isCalendarExpanded && (
                      <span className="schedules-calendar-today-dot" aria-label="Today" />
                    )}
                    {cell.isToday && isCalendarExpanded && (
                      <span className="schedules-calendar-today-mark">
                        <span className="schedules-calendar-today-dot" aria-hidden="true" />
                        Today
                      </span>
                    )}
                    {isCalendarExpanded && cell.entries.length > 0 && (
                      <>
                        <CalendarEvent schedule={cell.entries[0]} />
                        {cell.entries.length > 1 && (
                          <>
                            {openMoreDate === cell.dateStr && cell.entries.slice(1).map((schedule) => (
                              <CalendarEvent key={schedule.id} schedule={schedule} />
                            ))}
                            <button
                              type="button"
                              className="schedules-calendar-more"
                              aria-expanded={openMoreDate === cell.dateStr}
                              onClick={() => setOpenMoreDate((current) => (current === cell.dateStr ? '' : cell.dateStr))}
                            >
                              {openMoreDate === cell.dateStr ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                              {openMoreDate === cell.dateStr
                                ? 'Show less'
                                : `${cell.entries.length - 1} more schedule${cell.entries.length - 1 === 1 ? '' : 's'}...`}
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </>
                ) : (
                  ''
                )}
              </div>
            ))}
          </div>
          )}
          <div className="schedules-calendar-legend">
            {isWeekView ? (
              <>
                <span><span className="schedules-legend-dot schedules-legend-week-regular"></span> Regular</span>
                <span><span className="schedules-legend-dot schedules-legend-week-override"></span> Override</span>
                <span><span className="schedules-legend-dot schedules-legend-week-cancelled"></span> Cancelled</span>
              </>
            ) : (
              <>
                <span><span className="schedules-legend-dot schedules-legend-past"></span> Past</span>
                <span><span className="schedules-legend-dot schedules-legend-green"></span> Today</span>
                <span><span className="schedules-legend-dot schedules-legend-upcoming"></span> Upcoming</span>
              </>
            )}
            <button
              type="button"
              className="schedules-calendar-expand"
              aria-pressed={isCalendarExpanded}
              aria-label={isCalendarExpanded && focusedCalendarDate ? 'Back to month' : isCalendarExpanded ? 'Shrink calendar' : 'Expand calendar'}
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
      {isModalOpen && (
        <div className="schedules-modal-overlay" onClick={closeAllModals}>
          <div className="schedules-modal" onClick={(e) => e.stopPropagation()}>
            <div className="schedules-modal-header">
              <div>
                <strong>Create Schedule</strong>
                <p>Set up a new access schedule for a user.</p>
              </div>
              <button type="button" className="schedules-modal-close" onClick={closeAllModals}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="schedules-form-grid">
                <div className="schedules-field">
                  <label>User ID / School ID</label>
                  <input
                    type="text"
                    placeholder="Search by identifier..."
                    value={userSearchQuery}
                    onChange={(e) => setUserSearchQuery(e.target.value)}
                    autoComplete="off"
                  />
                  {suggestedUsers.length > 0 && (
                    <ul style={{ background: '#fff', border: '1px solid #dfe8e3', borderRadius: 4, listStyle: 'none', margin: '4px 0 0', maxHeight: 180, overflowY: 'auto', padding: 0 }}>
                      {suggestedUsers.map((item) => (
                        <li key={item.id} style={{ cursor: 'pointer', fontSize: 13, padding: '8px 12px' }}
                          onClick={() => { setUserSearchQuery(item.identifier); updateField('userId', String(item.id)); setFormError(''); }}>
                          {getUserDisplayName(item)} — {item.identifier}
                        </li>
                      ))}
                    </ul>
                  )}
                  {activeSelectedUser && (
                    <div className="schedules-user-details">
                      <span><strong>Name:</strong> {getUserDisplayName(activeSelectedUser)}</span>
                      <span><strong>{activeSelectedUser.identifierLabel}:</strong> {activeSelectedUser.identifier}</span>
                      <span><strong>Dept:</strong> {getUserDepartment(activeSelectedUser)}</span>
                      <span><strong>Position:</strong> {getUserPosition(activeSelectedUser)}</span>
                    </div>
                  )}
                </div>

                <div className="schedules-form-row">
                  <div className="schedules-field">
                    <label>Schedule Type</label>
                    <select
                      value={formState.scheduleType}
                      onChange={(e) => { const v = e.target.value; updateField('scheduleType', v); resetRecurringFields(v); }}
                      disabled={Boolean(lockedScheduleDate)}
                    >
                      <option value="single">Single</option>
                      {!lockedScheduleDate ? <option value="recurring">Recurring</option> : null}
                    </select>
                  </div>
                  <div className="schedules-field">
                    <label>Type</label>
                    <select
                      value={formState.scheduleKind}
                      onChange={(e) => updateField('scheduleKind', e.target.value)}
                    >
                      <option value="regular">Regular</option>
                      <option value="override">Override</option>
                    </select>
                  </div>
                  <div className="schedules-field">
                    <label>Status</label>
                    <select value={formState.status} onChange={(e) => updateField('status', e.target.value)}>
                      {regularScheduleStatusOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {formState.scheduleType === 'single' && (
                  <div className="schedules-field">
                    <label>Schedule Date</label>
                    <input
                      type="date"
                      value={formState.scheduleDate}
                      onChange={(e) => updateField('scheduleDate', e.target.value)}
                      disabled={Boolean(lockedScheduleDate)}
                    />
                  </div>
                )}

                {formState.scheduleType === 'recurring' && (
                  <>
                    <div className="schedules-form-row">
                      <div className="schedules-field">
                        <label>Start Date</label>
                        <input type="date" value={formState.startDate} onChange={(e) => updateField('startDate', e.target.value)} />
                      </div>
                      <div className="schedules-field">
                        <label>End Date</label>
                        <input type="date" value={formState.endDate} onChange={(e) => updateField('endDate', e.target.value)} />
                      </div>
                    </div>
                    <div className="schedules-field">
                      <label>Repeat Type</label>
                      <select value={formState.repeatType} onChange={(e) => updateField('repeatType', e.target.value)}>
                        <option value="daily">Daily</option>
                        <option value="weekly_selected">Weekly Selected</option>
                      </select>
                    </div>
                    {formState.repeatType === 'weekly_selected' && (
                      <div className="schedules-field">
                        <label>Repeat Days</label>
                        <div className="schedules-days">
                          {weekdayOptions.map((day) => (
                            <label key={day}>
                              <input type="checkbox" checked={formState.repeatDays.includes(day)} onChange={() => toggleRepeatDay(day)} />
                              {day}
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

                <div className="schedules-form-row">
                  <div className="schedules-field">
                    <label>Time Start</label>
                    <input type="time" value={formState.timeStart} onChange={(e) => updateField('timeStart', e.target.value)} />
                  </div>
                  <div className="schedules-field">
                    <label>Time End</label>
                    <input type="time" value={formState.timeEnd} onChange={(e) => updateField('timeEnd', e.target.value)} />
                  </div>
                </div>

              </div>

              {formError && <p className="schedules-form-error">{formError}</p>}

              <div className="schedules-form-actions">
                <button type="button" className="schedules-secondary-button" onClick={closeAllModals}>Cancel</button>
                <button type="submit" className="schedules-primary-button" disabled={isSubmitting}>
                  {isSubmitting ? 'Creating...' : 'Create Schedule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingSchedule && (
        <div
          className="pending-registration-review-backdrop schedules-view-backdrop"
          role="presentation"
          onClick={closeAllModals}
        >
          <form
            className="pending-registration-review schedules-edit-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="schedule-edit-title"
            onClick={(event) => event.stopPropagation()}
            onSubmit={handleSubmit}
          >
            <header>
              <div>
                <h2 id="schedule-edit-title">Edit Schedule</h2>
                <p>Update schedule #{editingSchedule.id}</p>
              </div>
              <button type="button" aria-label="Close edit schedule" onClick={closeAllModals} disabled={isSubmitting}>
                <X size={16} aria-hidden="true" />
              </button>
            </header>

            <div className="pending-registration-review-body">
              <section className="pending-registration-review-card">
                <h3>User</h3>
                <dl>
                  <div>
                    <dt>Name</dt>
                    <dd>{activeSelectedUser ? getUserDisplayName(activeSelectedUser) : editingSchedule.ownerName || '—'}</dd>
                  </div>
                  <div>
                    <dt>{activeSelectedUser?.identifierLabel || 'Identifier'}</dt>
                    <dd>
                      {activeSelectedUser?.identifier || editingSchedule.ownerIdentifier || '—'}
                    </dd>
                  </div>
                </dl>
              </section>

              <section className="pending-registration-review-card">
                <h3>Schedule</h3>
                <dl>
                  <div className="is-wide schedules-edit-field">
                    <dt>Schedule date</dt>
                    <dd>
                      <input
                        type="date"
                        value={formState.scheduleDate}
                        onChange={(e) => updateField('scheduleDate', e.target.value)}
                        required
                      />
                    </dd>
                  </div>
                  <div className="schedules-edit-field">
                    <dt>Time start</dt>
                    <dd>
                      <input
                        type="time"
                        value={formState.timeStart}
                        onChange={(e) => updateField('timeStart', e.target.value)}
                        required
                      />
                    </dd>
                  </div>
                  <div className="schedules-edit-field">
                    <dt>Time end</dt>
                    <dd>
                      <input
                        type="time"
                        value={formState.timeEnd}
                        onChange={(e) => updateField('timeEnd', e.target.value)}
                        required
                      />
                    </dd>
                  </div>
                  <div className="is-wide schedules-edit-field">
                    <dt>Status</dt>
                    <dd>
                      <select
                        value={formState.status}
                        onChange={(e) => updateField('status', e.target.value)}
                        required
                      >
                        {getStatusOptionsForSchedule(editingSchedule).map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </dd>
                  </div>
                </dl>
              </section>

              {formError ? <p className="pending-registration-error" role="alert">{formError}</p> : null}
            </div>

            <footer>
              <button
                type="button"
                className="pending-registration-reject"
                onClick={closeAllModals}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button type="submit" className="pending-registration-approve" disabled={isSubmitting}>
                {isSubmitting ? 'Saving...' : 'Save Changes'}
              </button>
            </footer>
          </form>
        </div>
      )}

      {viewSchedule && (
        <div
          className="pending-registration-review-backdrop schedules-view-backdrop"
          role="presentation"
          onClick={closeAllModals}
        >
          <section
            className="pending-registration-review schedules-view-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="schedule-view-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h2 id="schedule-view-title">Schedule Details</h2>
                <p>Schedule #{viewSchedule.id}</p>
              </div>
              <button type="button" aria-label="Close schedule details" onClick={closeAllModals}>
                <X size={16} aria-hidden="true" />
              </button>
            </header>

            <div className="pending-registration-review-body">
              <section className="pending-registration-review-card">
                <h3>User</h3>
                <dl>
                  <div>
                    <dt>Name</dt>
                    <dd>{viewSchedule.ownerName || '—'}</dd>
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
                    <dd>{getScheduleWindowParts(viewSchedule).dateLabel || '—'}</dd>
                  </div>
                  <div>
                    <dt>Schedule time</dt>
                    <dd>{getScheduleWindowParts(viewSchedule).timeLabel || '—'}</dd>
                  </div>
                </dl>
              </section>

              <section className="pending-registration-review-card">
                <h3>Status</h3>
                <dl>
                  <div>
                    <dt>Type</dt>
                    <dd>
                      <span
                        className={`dashboard-log-status dashboard-log-status-kind-${getScheduleKind(viewSchedule)}`}
                      >
                        {formatScheduleKindLabel(getScheduleKind(viewSchedule))}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>
                      <span className={`dashboard-log-status dashboard-log-status-${viewSchedule.status}`}>
                        {formatScheduleStatusLabel(viewSchedule.status)}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>Created at</dt>
                    <dd>{viewSchedule.createdAt || '—'}</dd>
                  </div>
                </dl>
              </section>
            </div>

            <footer>
              <button type="button" className="pending-registration-reject" onClick={closeAllModals}>
                Close
              </button>
            </footer>
          </section>
        </div>
      )}

      {historySchedule && (
        <div className="schedules-modal-overlay" onClick={closeAllModals}>
          <div className="schedules-modal schedules-history-modal" onClick={(e) => e.stopPropagation()}>
            <div className="schedules-modal-header">
              <div>
                <strong>Schedule History</strong>
                <p>Changes made to schedule #{historySchedule.id}</p>
              </div>
              <button type="button" className="schedules-modal-close" onClick={closeAllModals}>
                <X size={18} />
              </button>
            </div>

            <div className="schedules-history-summary">
              <strong>{historySchedule.ownerName}</strong>
              <span>{getScheduleWindowLabel(historySchedule)}</span>
            </div>

            <div className="schedules-history-list">
              {isHistoryLoading && <p className="schedules-history-empty">Loading history...</p>}

              {!isHistoryLoading && historyError && (
                <p className="schedules-history-empty">{historyError}</p>
              )}

              {!isHistoryLoading && !historyError && historyEntries.length === 0 && (
                <p className="schedules-history-empty">No edit history found for this schedule.</p>
              )}

              {!isHistoryLoading && !historyError && historyEntries.map((entry) => (
                <article className="schedules-history-item" key={entry.id}>
                  <div className="schedules-history-item-header">
                    <strong>{entry.editedByName || 'System'}</strong>
                    <span>{entry.editedAt}</span>
                  </div>
                  <div className="schedules-history-changes">
                    {entry.changes.map((change, index) => (
                      <div className="schedules-history-change" key={`${entry.id}-${change.field}-${index}`}>
                        <strong>{change.field}</strong>
                        <span>From: {change.before}</span>
                        <span>To: {change.after}</span>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>

            <div className="schedules-form-actions">
              <button type="button" className="schedules-secondary-button" onClick={closeAllModals}>Close</button>
            </div>
          </div>
        </div>
      )}

      <ExportFormatModal
        open={Boolean(exportTarget)}
        title={exportTarget === 'table' ? 'Export Schedules' : 'Export Schedule'}
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
            : 'Choose the file format to export.'
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

      {deleteSchedule && (
        <div className="schedules-modal-overlay" onClick={closeAllModals}>
          <div className="schedules-modal schedules-delete-modal" onClick={(e) => e.stopPropagation()}>
            <div className="schedules-modal-header">
              <div>
                <strong>Delete Schedule</strong>
                <p>Schedule #{deleteSchedule.id}</p>
              </div>
              <button type="button" className="schedules-modal-close" onClick={closeAllModals}>
                <X size={18} />
              </button>
            </div>
            <p className="schedules-delete-warning">
              Are you sure you want to delete this schedule for <strong>{deleteSchedule.ownerName}</strong>?
            </p>
            <div className="schedules-form-actions">
              <button type="button" className="schedules-secondary-button" onClick={closeAllModals}>Cancel</button>
              <button type="button" className="schedules-delete-button" onClick={confirmDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {conflictInfo && (
        <div className="schedules-modal-overlay" onClick={() => { setConflictInfo(null); setPendingPayload(null); }}>
          <div className="schedules-modal schedules-conflict-modal" onClick={(e) => e.stopPropagation()}>
            <div className="schedules-modal-header">
              <div>
                <strong>Time Conflicts Detected</strong>
                <p>Some dates overlap with existing schedules</p>
              </div>
              <button type="button" className="schedules-modal-close" onClick={() => { setConflictInfo(null); setPendingPayload(null); }}>
                <X size={18} />
              </button>
            </div>
            <p className="schedules-conflict-summary">
              {conflictInfo.createdCount !== undefined
                ? `${conflictInfo.createdCount} of ${conflictInfo.createdCount + conflictInfo.conflicts.length} schedule(s) were created. The rest were skipped due to conflicts.`
                : conflictInfo.validCount > 0
                  ? `${conflictInfo.validCount} of ${conflictInfo.validCount + conflictInfo.conflicts.length} schedule(s) can be created. Conflicting date(s) will be skipped.`
                  : 'This time conflicts with an existing schedule for the same person. Change the time before saving.'}
            </p>
            {conflictInfo.conflictDetails?.length > 0 ? (
              <ul className="schedules-conflict-list">
                {conflictInfo.conflictDetails.map((item, index) => (
                  <li key={`${item.scheduleDate}-${item.timeStartLabel}-${index}`}>
                    {item.ownerName} already has {item.timeStartLabel} – {item.timeEndLabel} on {formatScheduleDate(item.scheduleDate)}
                  </li>
                ))}
              </ul>
            ) : conflictInfo.conflicts.length > 0 ? (
              <ul className="schedules-conflict-list">
                {conflictInfo.conflicts.map((date, i) => <li key={i}>{formatScheduleDate(date)}</li>)}
              </ul>
            ) : null}
            <p className="schedules-conflict-ask">
              {conflictInfo.validCount > 0
                ? 'Continue and create only the non-conflicting schedules?'
                : 'Cancel and choose a time that does not overlap.'}
            </p>
            <div className="schedules-form-actions">
              <button type="button" className="schedules-secondary-button" onClick={() => { setConflictInfo(null); setPendingPayload(null); }}>Cancel</button>
              <button type="button" className="schedules-primary-button" onClick={handleConfirmOverlap} disabled={isSubmitting || conflictInfo.validCount === 0}>
                {isSubmitting ? 'Creating...' : 'Create Non-conflicting Schedules'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
