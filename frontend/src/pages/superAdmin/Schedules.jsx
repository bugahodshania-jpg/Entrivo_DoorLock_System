import { CalendarDays, CalendarPlus, CalendarRange, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download, Eye, History, Maximize2, Minimize2, Pencil, ShieldAlert, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import axiosClient from '../../api/axiosClient';
import ExportFormatModal from '../../components/ExportFormatModal';
import RowActionMenu from '../../components/RowActionMenu';
import WeeklyScheduleGrid from '../../components/WeeklyScheduleGrid';
import { useActionConfirm } from '../../components/ActionConfirm';
import ErrorNoticeModal from '../../components/ErrorNoticeModal';
import DeleteRequestModal from '../../components/DeleteRequestModal';
import DeleteRequestToast from '../../components/DeleteRequestToast';
import OverrideImpactModal from '../../components/OverrideImpactModal';
import ScheduleConflictModal from '../../components/ScheduleConflictModal';
import ScheduleKindBadges from '../../components/ScheduleKindBadges';
import ScheduleDayTable, { ScheduleDayRow } from '../../components/ScheduleDayTable';
import TableEmptyState from '../../components/TableEmptyState';
import { formatDateInManila, getManilaDateStamp, getManilaDateTimeStamp, parseManilaDateTime } from '../../utils/dateTime';
import { buildTablePdf, downloadFile } from '../../utils/exportFiles';
import {
  buildCalendarPdf,
  buildScheduleCsv,
  buildWeeklyPdf,
  compareSchedulesChronologically,
  formatMinutesLabel,
  expandScheduleDates,
  findScheduleConflicts,
  formatScheduleKindLabel,
  formatScheduleStatusLabel,
  getScheduleKind,
  getScheduleDateParts,
  getScheduleTimeLabel,
  getScheduleTimeParts,
  getWeekStartStamp,
  parseDateStamp,
  parseTimeToMinutes,
  shiftDateStamp,
  toDateStamp,
  weekdayOptions,
} from '../../utils/scheduleCalendar';
import { getDefaultGracePeriodMinutes } from '../../utils/systemSettings';
import { portalHref, userHasPrivilege } from '../../utils/privileges';
import {
  canCreateOverrideFromSchedule,
  mergeOverrideCreateIntoList,
} from '../../utils/overrideSchedule';
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
  { value: 'approved', label: 'Approved' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const scheduleStatusFilterOptions = [
  { value: 'all', label: 'All statuses' },
  ...regularScheduleStatusOptions,
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
  reason: '',
};

const scheduleTableTabs = [
  { value: 'today', label: "Today's schedules" },
  { value: 'incoming', label: 'Incoming schedules' },
  { value: 'all', label: 'All schedules' },
  { value: 'recent', label: 'Recently added' },
  { value: 'past', label: 'Past schedules' },
];

function readScheduleListQuery() {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get('tab');
  const status = params.get('status');
  const kind = params.get('kind');

  return {
    tab: scheduleTableTabs.some((option) => option.value === tab) ? tab : 'today',
    status: scheduleStatusFilterOptions.some((option) => option.value === status) ? status : 'all',
    kind: scheduleKindFilterOptions.some((option) => option.value === kind) ? kind : 'all',
    addOverride: params.get('add') === 'override',
  };
}

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
      <span className="schedules-calendar-event-meta">
        {schedule.scheduleDateLabel || formatScheduleDate(schedule.scheduleDate)}
      </span>
      {timeLabel ? <span className="schedules-calendar-event-meta">{timeLabel}</span> : null}
      <ScheduleKindBadges schedule={schedule} />
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
  const dateParts = getScheduleDateParts(schedule);
  const timeParts = getScheduleTimeParts(schedule);

  return {
    dateLabel: [dateParts.date, dateParts.weekday].filter(Boolean).join(', '),
    dateValueLabel: dateParts.date,
    weekdayLabel: dateParts.weekday,
    timeStartLabel: timeParts.start,
    timeEndLabel: timeParts.end,
    timeLabel: getScheduleTimeLabel(schedule),
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
  const [pendingOverrides, setPendingOverrides] = useState([]);
  const [pendingOverrideCount, setPendingOverrideCount] = useState(0);
  const [isPendingOverridesLoading, setIsPendingOverridesLoading] = useState(true);
  const [pendingOverridesError, setPendingOverridesError] = useState('');
  const canViewOverrideRequests = userHasPrivilege(user, 'pending_overrides');
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
  const [lockOverrideCreate, setLockOverrideCreate] = useState(false);
  const [lockOverrideUser, setLockOverrideUser] = useState(false);
  const [affectedSchedule, setAffectedSchedule] = useState(null);
  const [impactInfo, setImpactInfo] = useState(null);
  const [formState, setFormState] = useState(initialFormState);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userSuggestionsOpen, setUserSuggestionsOpen] = useState(false);
  const [highlightedUserIndex, setHighlightedUserIndex] = useState(0);
  const userSuggestionListRef = useRef(null);
  const [viewSchedule, setViewSchedule] = useState(null);
  const [editingSchedule, setEditingSchedule] = useState(null);
  const [deleteSchedule, setDeleteSchedule] = useState(null);
  const [deleteRequest, setDeleteRequest] = useState(null);
  const [deleteNotice, setDeleteNotice] = useState('');
  const [scheduleNotice, setScheduleNotice] = useState('');
  const [historySchedule, setHistorySchedule] = useState(null);
  const [historyEntries, setHistoryEntries] = useState([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [conflictInfo, setConflictInfo] = useState(null);
  const [pendingPayload, setPendingPayload] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [activeScheduleTab, setActiveScheduleTab] = useState(() => readScheduleListQuery().tab);
  const [isScheduleTabMenuOpen, setIsScheduleTabMenuOpen] = useState(false);
  const [activeStatusFilter, setActiveStatusFilter] = useState(() => readScheduleListQuery().status);
  const [isStatusFilterMenuOpen, setIsStatusFilterMenuOpen] = useState(false);
  const [activeKindFilter, setActiveKindFilter] = useState(() => readScheduleListQuery().kind);
  const [isKindFilterMenuOpen, setIsKindFilterMenuOpen] = useState(false);
  const scheduleTabMenuRef = useRef(null);
  const statusFilterMenuRef = useRef(null);
  const kindFilterMenuRef = useRef(null);
  const openOverrideCreateOnMount = useRef(readScheduleListQuery().addOverride);

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

  useEffect(() => {
    if (!canViewOverrideRequests) {
      return undefined;
    }

    let isActive = true;

    async function loadPendingOverrides() {
      setIsPendingOverridesLoading(true);

      try {
        const response = await axiosClient.get('/api/pending_overrides.php', {
          params: { status: 'pending' },
        });

        if (!isActive) {
          return;
        }

        const requests = (response.data.overrides || []).filter((request) => request.state === 'pending');
        setPendingOverrides(requests.slice(0, 5));
        setPendingOverrideCount(Number(response.data.counts?.pending ?? requests.length));
        setPendingOverridesError('');
      } catch {
        if (isActive) {
          setPendingOverrides([]);
          setPendingOverrideCount(0);
          setPendingOverridesError('Unable to load pending requests right now.');
        }
      } finally {
        if (isActive) {
          setIsPendingOverridesLoading(false);
        }
      }
    }

    loadPendingOverrides();

    return () => {
      isActive = false;
    };
  }, [canViewOverrideRequests]);

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
      const identifier = normalizeLookupValue(item.identifier);
      const name = normalizeLookupValue(
        item.name || [item.firstName, item.lastName].filter(Boolean).join(' ') || item.username,
      );

      return identifier.includes(normalizedUserSearchQuery) || name.includes(normalizedUserSearchQuery);
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
  const showUserSuggestions = userSuggestionsOpen && Boolean(normalizedUserSearchQuery) && !exactMatchedUser;

  useEffect(() => {
    const activeOption = userSuggestionListRef.current?.querySelector('.is-active');
    activeOption?.scrollIntoView({ block: 'nearest' });
  }, [highlightedUserIndex, showUserSuggestions]);

  function selectSuggestedUser(item) {
    if (!item) {
      return;
    }

    setUserSearchQuery(item.identifier);
    updateField('userId', String(item.id));
    setFormError('');
    setUserSuggestionsOpen(false);
  }

  function handleUserSearchChange(event) {
    const value = event.target.value;
    setUserSearchQuery(value);
    setHighlightedUserIndex(0);
    setUserSuggestionsOpen(true);

    if (selectedUser && normalizeLookupValue(selectedUser.identifier) !== normalizeLookupValue(value)) {
      updateField('userId', '');
    }
  }

  function handleUserSearchKeyDown(event) {
    if (event.key === 'Escape') {
      setUserSuggestionsOpen(false);
      return;
    }

    if (!showUserSuggestions || suggestedUsers.length === 0) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedUserIndex((index) => (index + 1) % suggestedUsers.length);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedUserIndex((index) => (index - 1 + suggestedUsers.length) % suggestedUsers.length);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      selectSuggestedUser(suggestedUsers[highlightedUserIndex]);
    }
  }

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

  const columns = ['ID', 'User', 'Date', 'Time', 'Type', 'Status', 'Created', 'Actions'];
  const todayStamp = useMemo(() => getManilaDateStamp(), []);
  const nowStamp = useMemo(() => getManilaDateTimeStamp(), [schedules]);
  const schedulesForActiveTab = useMemo(() => {
    const byScheduleTime = (list) => [...list].sort(compareSchedulesChronologically);

    if (activeScheduleTab === 'incoming') {
      return byScheduleTime(schedules.filter((schedule) => isIncomingSchedule(schedule, nowStamp)));
    }

    if (activeScheduleTab === 'today') {
      return byScheduleTime(schedules.filter((schedule) => getPrimaryScheduleDate(schedule) === todayStamp));
    }

    if (activeScheduleTab === 'past') {
      return byScheduleTime(schedules.filter((schedule) => {
        const scheduleDate = getPrimaryScheduleDate(schedule);
        return scheduleDate && scheduleDate < todayStamp;
      }));
    }

    if (activeScheduleTab === 'recent') {
      return byScheduleTime(schedules.filter((schedule) => isRecentlyAddedSchedule(schedule)));
    }

    return byScheduleTime(schedules);
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
        regularScheduleStatusOptions.map((option) => [
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
    const params = new URLSearchParams();

    if (activeScheduleTab !== 'today') {
      params.set('tab', activeScheduleTab);
    }

    if (activeStatusFilter !== 'all') {
      params.set('status', activeStatusFilter);
    }

    if (activeKindFilter !== 'all') {
      params.set('kind', activeKindFilter);
    }

    const nextSearch = params.toString();
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}`;
    const currentUrl = `${window.location.pathname}${window.location.search}`;

    if (nextUrl !== currentUrl) {
      window.history.replaceState({}, '', nextUrl);
    }
  }, [activeKindFilter, activeScheduleTab, activeStatusFilter]);

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
    if (!isModalOpen && !editingSchedule && !viewSchedule && !deleteSchedule && !historySchedule && !conflictInfo && !impactInfo) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setIsModalOpen(false);
        setLockedScheduleDate('');
        setLockOverrideCreate(false);
        setLockOverrideUser(false);
        setAffectedSchedule(null);
        setEditingSchedule(null);
        setViewSchedule(null);
        setDeleteSchedule(null);
        setHistorySchedule(null);
        setHistoryEntries([]);
        setHistoryError('');
        setConflictInfo(null);
        setImpactInfo(null);
        setPendingPayload(null);
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isModalOpen, editingSchedule, viewSchedule, deleteSchedule, historySchedule, conflictInfo, impactInfo]);

  useEffect(() => {
    if (!isModalOpen && !editingSchedule) {
      return;
    }

    if (lockOverrideUser) {
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
  }, [exactMatchedUser, formState.userId, isModalOpen, editingSchedule, lockOverrideUser, normalizedUserSearchQuery]);

  function openModal(scheduleDate = '', options = {}) {
    const isOverrideCreate = options.preset === 'override';

    setFormState({
      ...initialFormState,
      scheduleType: 'single',
      scheduleKind: isOverrideCreate ? 'override' : 'regular',
      scheduleDate,
      status: isOverrideCreate ? 'approved' : 'pending',
      gracePeriodMinutes: getDefaultGracePeriodMinutes(),
    });
    setLockedScheduleDate(scheduleDate);
    setLockOverrideCreate(isOverrideCreate);
    setLockOverrideUser(false);
    setAffectedSchedule(null);
    setImpactInfo(null);
    setFormError('');
    setUserSearchQuery('');
    setIsModalOpen(true);
  }

  function openOverrideFromSchedule(schedule) {
    setFormState({
      ...initialFormState,
      userId: '',
      scheduleType: 'single',
      scheduleKind: 'override',
      scheduleDate: schedule.scheduleDate || '',
      timeStart: String(schedule.timeStart || '').slice(0, 5),
      timeEnd: String(schedule.timeEnd || '').slice(0, 5),
      gracePeriodMinutes: Number.isFinite(Number(schedule.gracePeriodMinutes))
        ? Number(schedule.gracePeriodMinutes)
        : getDefaultGracePeriodMinutes(),
      status: 'approved',
      reason: '',
    });
    setLockedScheduleDate('');
    setLockOverrideCreate(true);
    setLockOverrideUser(false);
    setAffectedSchedule(schedule);
    setImpactInfo(null);
    setFormError('');
    setUserSearchQuery('');
    setIsModalOpen(true);
  }

  function closeAllModals() {
    setIsModalOpen(false);
    setLockedScheduleDate('');
    setLockOverrideCreate(false);
    setLockOverrideUser(false);
    setAffectedSchedule(null);
    setEditingSchedule(null);
    setViewSchedule(null);
    setDeleteSchedule(null);
    setHistorySchedule(null);
    setHistoryEntries([]);
    setHistoryError('');
    setConflictInfo(null);
    setImpactInfo(null);
    setPendingPayload(null);
    setFormState(initialFormState);
    setFormError('');
    setUserSearchQuery('');
  }

  useEffect(() => {
    if (!openOverrideCreateOnMount.current) {
      return;
    }

    openOverrideCreateOnMount.current = false;
    openModal('', { preset: 'override' });
  }, []);

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
      const kindLabel = getScheduleKind(schedule) === 'override' ? 'Override schedule' : 'Schedule';
      setDeleteRequest({
        targetType: 'schedule',
        targetId: schedule.id,
        targetLabel: `${kindLabel} #${schedule.id} · ${schedule.ownerName || 'User'}`,
        detail: [schedule.scheduleDateLabel || schedule.scheduleDate, getScheduleTimeLabel(schedule)].filter(Boolean).join(' · '),
      });
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
      setScheduleNotice('Schedule deleted.');
      setDeleteSchedule(null);
    } catch {
      setFormError('Unable to delete schedule.');
    }
  }

  async function handleConfirmOverrideImpact() {
    if (!pendingPayload) {
      setImpactInfo(null);
      return;
    }

    const confirmed = await confirmAction({
      step: 'password',
      title: 'Security Verification',
      message: 'Enter your password to confirm this override.',
      danger: true,
    });
    if (!confirmed) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await axiosClient.post('/api/schedules.php', {
        ...pendingPayload,
        confirmOverrideImpact: true,
      });
      const data = response.data;

      if (data.schedule) {
        setSchedules((previous) => mergeOverrideCreateIntoList(previous, data));
        setCurrentPage(1);
        setScheduleNotice('Override schedule created.');
      }

      closeAllModals();
    } catch (error) {
      setFormError(error?.response?.data?.message || 'Unable to create the override schedule.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function updateField(key, value) {
    setFormState((previous) => {
      if (key === 'scheduleKind') {
        return {
          ...previous,
          scheduleKind: value,
          status: value === 'override' ? 'approved' : previous.status === 'approved' && previous.scheduleKind === 'override'
            ? 'pending'
            : previous.status,
          scheduleType: value === 'override' ? 'single' : previous.scheduleType,
          scheduleDate: value === 'override' ? (previous.scheduleDate || previous.startDate || '') : previous.scheduleDate,
        };
      }

      return { ...previous, [key]: value };
    });
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

      if (formState.timeEnd <= formState.timeStart) {
        setFormError('End time must be after the start time.');
        return;
      }

      const editConflict = findScheduleConflicts(schedules, {
        userId: editingSchedule.userId,
        scheduleKind: getScheduleKind(editingSchedule),
        timeStart: formState.timeStart,
        timeEnd: formState.timeEnd,
        dates: formState.scheduleDate ? [formState.scheduleDate] : [],
        excludeId: editingSchedule.id,
      });
      if (editConflict.conflicts.length > 0) {
        setConflictInfo({
          conflicts: editConflict.conflicts,
          conflictDetails: editConflict.conflictDetails,
          message: getScheduleKind(editingSchedule) === 'override'
            ? 'An approved override can share a time with one regular schedule. It cannot overlap another override.'
            : 'A regular schedule cannot share this date and time. Another schedule already occupies this window.',
        });
        setPendingPayload(null);
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
        const data = response.data;

        if (data.hasConflicts) {
          setConflictInfo({
            conflicts: data.conflicts || [],
            conflictDetails: data.conflictDetails || [],
            message: data.message || 'A regular schedule cannot share this date and time. Another schedule already occupies this window.',
          });
          setPendingPayload(null);
          return;
        }

        const updated = data.schedule;

        if (updated) {
          setSchedules((previous) =>
            previous.map((s) => (s.id === updated.id ? updated : s)),
          );
        }

        setScheduleNotice('Schedule updated.');
        closeAllModals();
      } catch {
        setFormError('Unable to update schedule.');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    const isOverrideCreate = lockOverrideCreate || formState.scheduleKind === 'override';
    const scheduleUserId = Number(formState.userId || activeSelectedUser?.id || 0);

    if (!scheduleUserId) {
      setFormError(
        isOverrideCreate
          ? 'Select the requester who needs temporary access to the room.'
          : 'Enter a valid Employee ID or School ID for this schedule.',
      );
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

    const isRecurring = !isOverrideCreate && formState.scheduleType === 'recurring';
    const payload = {
      userId: scheduleUserId,
      scheduleType: isOverrideCreate ? 'single' : formState.scheduleType,
      scheduleKind: isOverrideCreate ? 'override' : formState.scheduleKind,
      scheduleDate: isRecurring ? null : formState.scheduleDate,
      startDate: isRecurring ? formState.startDate : null,
      endDate: isRecurring ? formState.endDate : null,
      repeatType: isRecurring ? formState.repeatType : 'none',
      repeatDays: isRecurring ? formState.repeatDays : null,
      timeStart: formState.timeStart,
      timeEnd: formState.timeEnd,
      gracePeriodMinutes: Number(formState.gracePeriodMinutes),
      status: isOverrideCreate ? 'approved' : formState.status,
      reason: isOverrideCreate ? formState.reason : undefined,
      requesterName: isOverrideCreate ? getUserDisplayName(activeSelectedUser) : undefined,
      sourceScheduleId: isOverrideCreate ? affectedSchedule?.id || undefined : undefined,
      createdBy: user?.id ?? null,
      createdByName: getActorDisplayName(user),
      approvedBy: (isOverrideCreate || formState.status === 'approved') ? (user?.id ?? null) : null,
    };

    const createConflict = findScheduleConflicts(schedules, {
      userId: scheduleUserId,
      scheduleKind: isOverrideCreate ? 'override' : 'regular',
      timeStart: formState.timeStart,
      timeEnd: formState.timeEnd,
      dates: expandScheduleDates({
        scheduleType: isOverrideCreate ? 'single' : formState.scheduleType,
        scheduleDate: formState.scheduleDate,
        startDate: formState.startDate,
        endDate: formState.endDate,
        repeatType: formState.repeatType,
        repeatDays: formState.repeatDays,
      }),
    });

    if (createConflict.conflicts.length > 0) {
      setConflictInfo({
        conflicts: createConflict.conflicts,
        conflictDetails: createConflict.conflictDetails,
        message: isOverrideCreate
          ? 'An approved override can share a time with one regular schedule. It cannot overlap another override.'
          : 'A regular schedule cannot share this date and time. Another schedule already occupies this window.',
      });
      setPendingPayload(null);
      return;
    }

    if (!isOverrideCreate) {
      const confirmed = await confirmAction({
        title: 'Add schedule',
        message: 'Are you sure you want to add this schedule?',
      });
      if (!confirmed) {
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const response = await axiosClient.post('/api/schedules.php', payload);
      const data = response.data;

      if (data.needsOverrideConfirmation) {
        setImpactInfo({
          affectedSchedules: data.affectedSchedules || [],
          notifiedUsers: data.notifiedUsers || [],
        });
        setPendingPayload(payload);
        return;
      }

      if (isOverrideCreate && data.schedule) {
        setSchedules((previous) => mergeOverrideCreateIntoList(previous, data));
        setCurrentPage(1);
        setScheduleNotice('Override schedule created.');
        closeAllModals();
        return;
      }

      if (data.isBatch) {
        const createdSchedules = data.schedules || [];

        if (createdSchedules.length > 0) {
          setSchedules((previous) => [...createdSchedules, ...previous]);
          setCurrentPage(1);
          setScheduleNotice(
            createdSchedules.length === 1
              ? 'Schedule created.'
              : `${createdSchedules.length} schedules created.`,
          );
        }
      } else if (data.hasConflicts) {
        setConflictInfo({
          conflicts: data.conflicts || [],
          conflictDetails: data.conflictDetails || [],
          message: data.message || 'A regular schedule cannot share this date and time. Another schedule already occupies this window.',
        });
        setPendingPayload(null);
        return;
      } else {
        const created = data.schedule;
        if (created) {
          setSchedules((previous) => [created, ...previous]);
          setCurrentPage(1);
          setScheduleNotice('Schedule created.');
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
          schedule.status === 'approved' &&
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
      note: 'Approved regular and override schedules.',
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
      note: 'Approved regular and override schedules.',
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
            <button type="button" className="dashboard-export-button" onClick={() => setExportTarget('table')}>
              <Download size={15} aria-hidden="true" />
              Export
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

              {!isLoading && filteredSchedules.length === 0 && (
                <tr>
                  <td className="dashboard-recent-empty" colSpan={columns.length}>
                    <TableEmptyState description="Try another schedule view or adjust your filters.">
                      {activeStatusFilter !== 'all'
                        ? `No ${activeStatusFilterConfig.label.toLowerCase()} schedules found.`
                        : null}
                      {activeStatusFilter === 'all' && activeScheduleTab === 'all' && 'No schedules found.'}
                      {activeStatusFilter === 'all' && activeScheduleTab === 'today' && 'No schedules found for today.'}
                      {activeStatusFilter === 'all' && activeScheduleTab === 'incoming' && 'No incoming schedules found.'}
                      {activeStatusFilter === 'all' && activeScheduleTab === 'recent' && 'No recently added schedules found.'}
                      {activeStatusFilter === 'all' && activeScheduleTab === 'past' && 'No past schedules found.'}
                    </TableEmptyState>
                  </td>
                </tr>
              )}

              {!isLoading &&
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
                        <strong>{scheduleWindow.dateValueLabel || scheduleWindow.dateLabel || '—'}</strong>
                        {scheduleWindow.weekdayLabel ? <span>{scheduleWindow.weekdayLabel}</span> : null}
                      </div>
                    </td>
                    <td>
                      <div className="schedules-window-cell">
                        {scheduleWindow.timeStartLabel && scheduleWindow.timeEndLabel ? (
                          <>
                            <strong>{scheduleWindow.timeStartLabel}</strong>
                            <span>{scheduleWindow.timeEndLabel}</span>
                          </>
                        ) : (
                          <strong>{scheduleWindow.timeLabel || '—'}</strong>
                        )}
                      </div>
                    </td>
                    <td>
                      <ScheduleKindBadges schedule={schedule} />
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
                          { label: 'Override', icon: ShieldAlert, hidden: !canCreateOverrideFromSchedule(schedule), onClick: () => openOverrideFromSchedule(schedule) },
                          { label: 'Edit', icon: Pencil, onClick: () => handleEdit(schedule) },
                          { label: 'History', icon: History, onClick: () => handleHistory(schedule) },
                          { label: 'Delete', icon: Trash2, danger: true, onClick: () => handleDelete(schedule) },
                        ]}
                      />
                    </td>
                  </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {!isLoading && filteredSchedules.length > 0 && (
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

      <aside className="schedules-sidebar" aria-label="Schedule calendar and pending overrides">
      <section className="schedules-calendar-card" aria-label="Schedule calendar">
        <div className="schedules-calendar">
          {isCalendarExpanded && (!focusedCell || isWeekView) && (
            <div className="schedules-calendar-export-row">
              <button type="button" className="dashboard-export-button" onClick={() => setExportTarget('calendar')}>
                <Download size={15} aria-hidden="true" />
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
                <ScheduleDayTable>
                  {focusedCell.entries.map((schedule) => (
                    <ScheduleDayRow
                      key={schedule.id}
                      schedule={schedule}
                      name={schedule.ownerName}
                      dateLabel={schedule.scheduleDateLabel || formatScheduleDate(schedule.scheduleDate)}
                      timeStartLabel={schedule.timeStartLabel}
                      timeEndLabel={schedule.timeEndLabel}
                      timeLabel={getScheduleTimeLabel(schedule)}
                      actions={
                        <RowActionMenu
                          label={`Actions for ${schedule.userName || 'schedule'}`}
                          items={[
                            { label: 'View', icon: Eye, onClick: () => handleView(schedule) },
                            { label: 'Override', icon: ShieldAlert, hidden: !canCreateOverrideFromSchedule(schedule), onClick: () => openOverrideFromSchedule(schedule) },
                            { label: 'Edit', icon: Pencil, onClick: () => handleEdit(schedule) },
                            { label: 'Delete', icon: Trash2, danger: true, onClick: () => handleDelete(schedule) },
                          ]}
                        />
                      }
                    />
                  ))}
                </ScheduleDayTable>
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
      </section>
      {!isCalendarExpanded && canViewOverrideRequests && (
        <section
          className="schedules-pending-overrides-card"
          aria-labelledby="schedules-pending-overrides-heading"
          aria-busy={isPendingOverridesLoading}
        >
          <div className="schedules-pending-overrides-header">
            <h2 id="schedules-pending-overrides-heading">Pending override requests</h2>
            {!isPendingOverridesLoading && !pendingOverridesError && (
              <span className="schedules-pending-overrides-count" aria-label={`${pendingOverrideCount} pending requests`}>
                {pendingOverrideCount}
              </span>
            )}
          </div>
          <div aria-live="polite">
            {isPendingOverridesLoading ? (
              <p className="schedules-pending-overrides-message">Loading pending requests...</p>
            ) : pendingOverridesError ? (
              <p className="schedules-pending-overrides-message">{pendingOverridesError}</p>
            ) : pendingOverrides.length ? (
              <ul className="schedules-pending-overrides-list">
                {pendingOverrides.map((request) => (
                  <li className="schedules-pending-overrides-row" key={request.id}>
                    <strong title={request.name}>{request.name}</strong>
                    <span title={`${request.dateLabel} · ${request.timeLabel}`}>
                      {request.dateLabel} · {request.timeLabel}
                    </span>
                    <p title={request.reason}>{request.reason}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="schedules-pending-overrides-message">No pending override requests.</p>
            )}
          </div>
          <a className="schedules-pending-overrides-view-all" href={portalHref('/pending-overrides')}>
            View all
          </a>
        </section>
      )}
      </aside>
      </div>
      {isModalOpen && (
        <div className="schedules-modal-overlay" onClick={closeAllModals}>
          <div className="schedules-modal" onClick={(e) => e.stopPropagation()}>
            <div className="schedules-modal-header">
              <div>
                <strong>
                  {lockOverrideCreate || formState.scheduleKind === 'override'
                    ? 'Create Override Schedule'
                    : 'Create Schedule'}
                </strong>
                <p>
                    {lockOverrideCreate || formState.scheduleKind === 'override'
                      ? 'Choose the requester who needs temporary room access. The regular schedule stays as its own row.'
                      : 'Set up a new access schedule for a user.'}
                </p>
              </div>
              <button type="button" className="schedules-modal-close" onClick={closeAllModals}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="schedules-form-grid">
                {lockOverrideCreate || formState.scheduleKind === 'override' ? (
                  affectedSchedule ? (
                    <section className="schedules-summary-card">
                      <dl className="schedules-summary-grid">
                        <div>
                          <dt>Affected schedule</dt>
                          <dd>{affectedSchedule.ownerName}</dd>
                        </div>
                        <div>
                          <dt>Window</dt>
                          <dd>{getScheduleWindowLabel(affectedSchedule) || 'See the date and time below'}</dd>
                        </div>
                      </dl>
                      <p className="schedules-summary-note">
                        This regular schedule stays in place and will be stamped as overridden.
                      </p>
                    </section>
                  ) : (
                    <p className="schedules-field-hint">
                      Choose who is requesting temporary access to the room. Their override is added as a new row.
                    </p>
                  )
                ) : null}
                <div className="schedules-field schedules-user-picker">
                  <label htmlFor="schedule-user-search">
                    {lockOverrideCreate || formState.scheduleKind === 'override'
                      ? 'Requester'
                      : 'User ID / School ID'}
                  </label>
                  {lockOverrideCreate || formState.scheduleKind === 'override' ? (
                    <p className="schedules-field-hint">Person requesting temporary access to the room or door.</p>
                  ) : null}
                  <input
                    id="schedule-user-search"
                    type="text"
                    role="combobox"
                    placeholder={
                      lockOverrideCreate || formState.scheduleKind === 'override'
                        ? 'Search requester by name or ID'
                        : 'Search by name or ID'
                    }
                    value={userSearchQuery}
                    aria-autocomplete="list"
                    aria-expanded={showUserSuggestions}
                    aria-controls="schedule-user-suggestions"
                    aria-activedescendant={
                      showUserSuggestions && suggestedUsers[highlightedUserIndex]
                        ? `schedule-user-option-${suggestedUsers[highlightedUserIndex].id}`
                        : undefined
                    }
                    onChange={handleUserSearchChange}
                    onFocus={() => setUserSuggestionsOpen(true)}
                    onBlur={() => setUserSuggestionsOpen(false)}
                    onKeyDown={handleUserSearchKeyDown}
                    autoComplete="off"
                    disabled={lockOverrideUser}
                  />
                  {showUserSuggestions && (
                    <ul
                      id="schedule-user-suggestions"
                      className="schedules-user-suggestions"
                      role="listbox"
                      aria-label={
                      lockOverrideCreate || formState.scheduleKind === 'override'
                        ? 'Matching requesters'
                        : 'Matching users'
                    }
                      ref={userSuggestionListRef}
                      onMouseDown={(event) => event.preventDefault()}
                    >
                      {suggestedUsers.length === 0 ? (
                        <li className="schedules-user-suggestion-empty">No matching users.</li>
                      ) : suggestedUsers.map((item, index) => (
                        <li key={item.id} role="presentation">
                          <button
                            type="button"
                            id={`schedule-user-option-${item.id}`}
                            role="option"
                            aria-selected={index === highlightedUserIndex}
                            className={`schedules-user-suggestion${index === highlightedUserIndex ? ' is-active' : ''}`}
                            onMouseEnter={() => setHighlightedUserIndex(index)}
                            onClick={() => selectSuggestedUser(item)}
                          >
                            <span>
                              <span className="schedules-user-suggestion-name">{getUserDisplayName(item)}</span>
                              <span className="schedules-user-suggestion-id">{item.identifier}</span>
                            </span>
                            <span className="schedules-user-suggestion-role">
                              {item.groupLabel === 'Students' ? 'Student' : item.groupLabel === 'Admins' ? 'Admin' : item.groupLabel}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {activeSelectedUser && (
                    <div className="schedules-user-details">
                      <div>
                        <span className="schedules-user-details-label">
                          {lockOverrideCreate || formState.scheduleKind === 'override' ? 'Requester' : 'Name'}
                        </span>
                        <span className="schedules-user-details-value">{getUserDisplayName(activeSelectedUser)}</span>
                      </div>
                      <div>
                        <span className="schedules-user-details-label">{activeSelectedUser.identifierLabel}</span>
                        <span className="schedules-user-details-value">{activeSelectedUser.identifier}</span>
                      </div>
                      <div>
                        <span className="schedules-user-details-label">Department</span>
                        <span className="schedules-user-details-value">{getUserDepartment(activeSelectedUser)}</span>
                      </div>
                      <div>
                        <span className="schedules-user-details-label">Position</span>
                        <span className="schedules-user-details-value">{getUserPosition(activeSelectedUser)}</span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="schedules-form-row schedules-form-row-3">
                  <div className="schedules-field">
                    <label>Schedule Type</label>
                    <select
                      value={formState.scheduleType}
                      onChange={(e) => { const v = e.target.value; updateField('scheduleType', v); resetRecurringFields(v); }}
                      disabled={Boolean(lockedScheduleDate) || lockOverrideCreate || formState.scheduleKind === 'override'}
                    >
                      <option value="single">Single</option>
                      {!lockedScheduleDate && !lockOverrideCreate && formState.scheduleKind !== 'override' ? <option value="recurring">Recurring</option> : null}
                    </select>
                  </div>
                  <div className="schedules-field">
                    <label>Type</label>
                    <select
                      value={formState.scheduleKind}
                      onChange={(e) => updateField('scheduleKind', e.target.value)}
                      disabled={lockOverrideCreate}
                    >
                      <option value="regular">Regular</option>
                      <option value="override">Override</option>
                    </select>
                  </div>
                  <div className="schedules-field">
                    <label>Status</label>
                    <select
                      value={formState.status}
                      onChange={(e) => updateField('status', e.target.value)}
                      disabled={lockOverrideCreate || formState.scheduleKind === 'override'}
                    >
                      {regularScheduleStatusOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {formState.scheduleType === 'single' && !(lockOverrideCreate || formState.scheduleKind === 'override') && (
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

                {formState.scheduleType === 'single' && (lockOverrideCreate || formState.scheduleKind === 'override') ? (
                  <div className="schedules-form-row schedules-form-row-3">
                    <div className="schedules-field">
                      <label>Schedule Date</label>
                      <input
                        type="date"
                        value={formState.scheduleDate}
                        onChange={(e) => updateField('scheduleDate', e.target.value)}
                        disabled={Boolean(lockedScheduleDate)}
                      />
                    </div>
                    <div className="schedules-field">
                      <label>Time Start</label>
                      <input type="time" value={formState.timeStart} onChange={(e) => updateField('timeStart', e.target.value)} />
                    </div>
                    <div className="schedules-field">
                      <label>Time End</label>
                      <input type="time" value={formState.timeEnd} onChange={(e) => updateField('timeEnd', e.target.value)} />
                    </div>
                  </div>
                ) : (
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
                )}

                {lockOverrideCreate || formState.scheduleKind === 'override' ? (
                  <div className="schedules-field">
                    <label htmlFor="schedule-override-reason">Reason</label>
                    <textarea
                      id="schedule-override-reason"
                      rows={3}
                      value={formState.reason}
                      onChange={(event) => updateField('reason', event.target.value)}
                      placeholder="Why this requester needs temporary access (optional)"
                    />
                  </div>
                ) : null}

              </div>

              <div className="schedules-form-actions">
                <button type="button" className="schedules-secondary-button" onClick={closeAllModals}>Cancel</button>
                <button type="submit" className="schedules-primary-button" disabled={isSubmitting}>
                  {isSubmitting
                    ? 'Creating...'
                    : lockOverrideCreate || formState.scheduleKind === 'override'
                      ? 'Create Override'
                      : 'Create Schedule'}
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
                <h3>{getScheduleKind(viewSchedule) === 'override' ? 'Requester' : 'User'}</h3>
                <dl>
                  <div>
                    <dt>{getScheduleKind(viewSchedule) === 'override' ? 'Requester' : 'Name'}</dt>
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
                      <ScheduleKindBadges schedule={viewSchedule} />
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

              {!isHistoryLoading && historyEntries.length === 0 && (
                <p className="schedules-history-empty">No edit history found for this schedule.</p>
              )}

              {!isHistoryLoading && historyEntries.map((entry) => (
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

      <DeleteRequestModal
        open={Boolean(deleteRequest)}
        actorId={user?.id}
        targetType={deleteRequest?.targetType}
        targetId={deleteRequest?.targetId}
        targetLabel={deleteRequest?.targetLabel || ''}
        detail={deleteRequest?.detail || ''}
        onClose={() => setDeleteRequest(null)}
        onSubmitted={(message) => {
          setDeleteNotice(message);
          window.setTimeout(() => setDeleteNotice(''), 4000);
        }}
      />
      <DeleteRequestToast message={deleteNotice} title="Delete request" onClose={() => setDeleteNotice('')} />
      <DeleteRequestToast message={scheduleNotice} title="Schedule" onClose={() => setScheduleNotice('')} />
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

      <OverrideImpactModal
        open={Boolean(impactInfo)}
        affectedSchedules={impactInfo?.affectedSchedules || []}
        notifiedUsers={impactInfo?.notifiedUsers || []}
        isSubmitting={isSubmitting}
        onCancel={() => {
          setImpactInfo(null);
          setPendingPayload(null);
        }}
        onConfirm={() => {
          void handleConfirmOverrideImpact();
        }}
      />

      {conflictInfo && (
        <ScheduleConflictModal
          open
          message={conflictInfo.message || 'This date and time are already occupied.'}
          details={conflictInfo.conflictDetails || []}
          onClose={() => {
            setConflictInfo(null);
            setPendingPayload(null);
          }}
        />
      )}
      <ErrorNoticeModal
        open={Boolean(errorMessage)}
        message={errorMessage}
        onClose={() => setErrorMessage('')}
      />
      <ErrorNoticeModal
        open={Boolean(formError)}
        message={formError}
        onClose={() => setFormError('')}
      />
      <ErrorNoticeModal
        open={Boolean(historyError)}
        message={historyError}
        onClose={() => setHistoryError('')}
      />
    </main>
  );
}
