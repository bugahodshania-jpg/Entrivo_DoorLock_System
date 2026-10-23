import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import axiosClient from '../api/axiosClient';
import { useActionConfirm } from './ActionConfirm';
import ErrorNoticeModal from './ErrorNoticeModal';
import OverrideImpactModal from './OverrideImpactModal';
import ScheduleConflictModal from './ScheduleConflictModal';
import { getDefaultGracePeriodMinutes } from '../utils/systemSettings';
import '../styles/superAdmin/schedules.css';

const regularScheduleStatusOptions = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const initialFormState = {
  userId: '',
  scheduleType: 'single',
  scheduleKind: 'regular',
  scheduleDate: '',
  timeStart: '',
  timeEnd: '',
  gracePeriodMinutes: 15,
  status: 'pending',
  reason: '',
};

function normalizeLookupValue(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function getStoredActor() {
  try {
    const raw =
      window.localStorage.getItem('entrivo_user') ||
      window.sessionStorage.getItem('entrivo_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function getActorId() {
  return getStoredActor()?.id;
}

function getActorDisplayName() {
  const actor = getStoredActor();
  if (!actor) {
    return '';
  }

  const fullName = [actor.first_name, actor.middle_name, actor.last_name, actor.extension_name]
    .filter(Boolean)
    .join(' ');

  return fullName || actor.name || actor.username || actor.email || '';
}

function getUserDisplayName(selected) {
  if (!selected) {
    return '';
  }

  return (
    selected.name ||
    [selected.firstName, selected.lastName].filter(Boolean).join(' ') ||
    selected.username ||
    'Unknown User'
  );
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

export default function ScheduleCreateModal({
  open,
  onClose,
  onCreated,
  preset = 'regular',
}) {
  const confirmAction = useActionConfirm();
  const isOverrideCreate = preset === 'override';
  const userSuggestionListRef = useRef(null);
  const [usersByRole, setUsersByRole] = useState({
    faculty: [],
    staff: [],
    admins: [],
    students: [],
  });
  const [formState, setFormState] = useState(initialFormState);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userSuggestionsOpen, setUserSuggestionsOpen] = useState(false);
  const [highlightedUserIndex, setHighlightedUserIndex] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [conflictInfo, setConflictInfo] = useState(null);
  const [impactInfo, setImpactInfo] = useState(null);
  const [pendingPayload, setPendingPayload] = useState(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    let isActive = true;

    setFormState({
      ...initialFormState,
      scheduleType: 'single',
      scheduleKind: isOverrideCreate ? 'override' : 'regular',
      status: isOverrideCreate ? 'approved' : 'pending',
      gracePeriodMinutes: getDefaultGracePeriodMinutes(),
    });
    setUserSearchQuery('');
    setFormError('');
    setConflictInfo(null);
    setImpactInfo(null);
    setPendingPayload(null);

    async function loadUsers() {
      try {
        const response = await axiosClient.get('/api/user.php');
        if (!isActive) {
          return;
        }

        setUsersByRole({
          faculty: response.data.users?.faculty || [],
          staff: response.data.users?.staff || [],
          admins: response.data.users?.admins || [],
          students: response.data.users?.students || [],
        });
      } catch {
        if (isActive) {
          setUsersByRole({
            faculty: [],
            staff: [],
            admins: [],
            students: [],
          });
        }
      }
    }

    loadUsers();

    return () => {
      isActive = false;
    };
  }, [isOverrideCreate, open]);

  const allUsers = useMemo(() => {
    const groups = [
      { label: 'Students', identifierLabel: 'School ID', value: usersByRole.students },
      { label: 'Faculty', identifierLabel: 'Employee ID', value: usersByRole.faculty },
      { label: 'Staff', identifierLabel: 'Employee ID', value: usersByRole.staff },
      { label: 'Admins', identifierLabel: 'Employee ID', value: usersByRole.admins },
    ];

    return groups.flatMap((group) =>
      group.value.map((item) => ({
        ...item,
        groupLabel: group.label,
        identifierLabel: group.identifierLabel,
      })),
    );
  }, [usersByRole]);

  const normalizedUserSearchQuery = normalizeLookupValue(userSearchQuery);

  const filteredUsers = useMemo(() => {
    if (!normalizedUserSearchQuery) {
      return [];
    }

    return allUsers.filter((item) => {
      const identifier = normalizeLookupValue(item.identifier);
      const name = normalizeLookupValue(
        item.name || [item.firstName, item.lastName].filter(Boolean).join(' ') || item.username,
      );

      return identifier.includes(normalizedUserSearchQuery) || name.includes(normalizedUserSearchQuery);
    });
  }, [allUsers, normalizedUserSearchQuery]);

  const exactMatchedUser = useMemo(
    () =>
      filteredUsers.find(
        (item) => normalizeLookupValue(item.identifier) === normalizedUserSearchQuery,
      ) || null,
    [filteredUsers, normalizedUserSearchQuery],
  );

  const suggestedUsers = useMemo(
    () => (exactMatchedUser ? [] : filteredUsers),
    [exactMatchedUser, filteredUsers],
  );

  const selectedUser = useMemo(
    () => allUsers.find((item) => String(item.id) === String(formState.userId)) || null,
    [allUsers, formState.userId],
  );

  const activeSelectedUser = selectedUser || exactMatchedUser;
  const showUserSuggestions =
    userSuggestionsOpen && Boolean(normalizedUserSearchQuery) && !exactMatchedUser;

  useEffect(() => {
    if (!open || !exactMatchedUser) {
      return;
    }

    if (String(formState.userId) !== String(exactMatchedUser.id)) {
      setFormState((previous) => ({ ...previous, userId: String(exactMatchedUser.id) }));
      setFormError('');
    }
  }, [exactMatchedUser, formState.userId, open]);

  useEffect(() => {
    const activeOption = userSuggestionListRef.current?.querySelector('.is-active');
    activeOption?.scrollIntoView({ block: 'nearest' });
  }, [highlightedUserIndex, showUserSuggestions]);

  function updateField(key, value) {
    setFormState((previous) => ({ ...previous, [key]: value }));
  }

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

  async function createSchedule(payload, { closeOnSuccess = true } = {}) {
    const response = await axiosClient.post('/api/schedules.php', payload);
    const data = response.data;

    if (data.needsOverrideConfirmation) {
      setConflictInfo(null);
      setPendingPayload(payload);
      setImpactInfo({
        affectedSchedules: data.affectedSchedules || [],
        notifiedUsers: data.notifiedUsers || [],
      });
      return false;
    }

    if (data.hasConflicts) {
      setConflictInfo({
        conflicts: data.conflicts || [],
        conflictDetails: data.conflictDetails || [],
        validCount: (data.validDates || []).length,
      });
      setPendingPayload(payload);
      return false;
    }

    if (data.schedule) {
      onCreated?.(data.schedule, data);
    }

    if (closeOnSuccess) {
      onClose?.();
    }

    return true;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError('');

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

    if (!formState.scheduleDate) {
      setFormError('Provide a schedule date.');
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

    const actorId = getActorId();
    const payload = {
      userId: scheduleUserId,
      scheduleType: 'single',
      scheduleKind: formState.scheduleKind,
      scheduleDate: formState.scheduleDate,
      startDate: null,
      endDate: null,
      repeatType: 'none',
      repeatDays: null,
      timeStart: formState.timeStart,
      timeEnd: formState.timeEnd,
      gracePeriodMinutes: Number(formState.gracePeriodMinutes),
      status: formState.status,
      reason: isOverrideCreate ? formState.reason : undefined,
      requesterName: isOverrideCreate ? getUserDisplayName(activeSelectedUser) : undefined,
      createdBy: actorId ?? null,
      createdByName: getActorDisplayName(),
      approvedBy: formState.status === 'approved' ? actorId ?? null : null,
    };

    setIsSubmitting(true);

    try {
      await createSchedule(payload);
    } catch (error) {
      setFormError(error?.response?.data?.message || 'Unable to create schedule right now.');
    } finally {
      setIsSubmitting(false);
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
        onCreated?.(data.schedule, data);
      }
      setImpactInfo(null);
      setPendingPayload(null);
      onClose?.();
    } catch (error) {
      setFormError(error?.response?.data?.message || 'Unable to create the override schedule.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!open) {
    return null;
  }

  return (
    <>
      <div className="schedules-modal-overlay" onClick={onClose}>
        <div className="schedules-modal" onClick={(event) => event.stopPropagation()}>
          <div className="schedules-modal-header">
            <div>
              <strong>{isOverrideCreate ? 'Create Override Schedule' : 'Create Schedule'}</strong>
              <p>
                {isOverrideCreate
                  ? 'Choose the requester who needs temporary room access. The regular schedule stays as its own row.'
                  : 'Set up a new access schedule for a user.'}
              </p>
            </div>
            <button type="button" className="schedules-modal-close" onClick={onClose}>
              <X size={18} />
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="schedules-form-grid">
              <div className="schedules-field schedules-user-picker">
                <label htmlFor="override-schedule-user-search">
                  {isOverrideCreate ? 'Requester' : 'User ID / School ID'}
                </label>
                {isOverrideCreate ? (
                  <p className="schedules-field-hint">Person requesting temporary access to the room or door.</p>
                ) : null}
                <input
                  id="override-schedule-user-search"
                  type="text"
                  role="combobox"
                  placeholder={isOverrideCreate ? 'Search requester by name or ID' : 'Search by name or ID'}
                  value={userSearchQuery}
                  aria-autocomplete="list"
                  aria-expanded={showUserSuggestions}
                  aria-controls="override-schedule-user-suggestions"
                  onChange={handleUserSearchChange}
                  onFocus={() => setUserSuggestionsOpen(true)}
                  onBlur={() => setUserSuggestionsOpen(false)}
                  onKeyDown={handleUserSearchKeyDown}
                  autoComplete="off"
                />
                {showUserSuggestions ? (
                  <ul
                    id="override-schedule-user-suggestions"
                    className="schedules-user-suggestions"
                    role="listbox"
                    aria-label={isOverrideCreate ? 'Matching requesters' : 'Matching users'}
                    ref={userSuggestionListRef}
                    onMouseDown={(event) => event.preventDefault()}
                  >
                    {suggestedUsers.length === 0 ? (
                      <li className="schedules-user-suggestion-empty">No matching users.</li>
                    ) : (
                      suggestedUsers.map((item, index) => (
                        <li key={item.id} role="presentation">
                          <button
                            type="button"
                            role="option"
                            aria-selected={index === highlightedUserIndex}
                            className={`schedules-user-suggestion${
                              index === highlightedUserIndex ? ' is-active' : ''
                            }`}
                            onMouseEnter={() => setHighlightedUserIndex(index)}
                            onClick={() => selectSuggestedUser(item)}
                          >
                            <span>
                              <span className="schedules-user-suggestion-name">
                                {getUserDisplayName(item)}
                              </span>
                              <span className="schedules-user-suggestion-id">{item.identifier}</span>
                            </span>
                            <span className="schedules-user-suggestion-role">
                              {item.groupLabel === 'Students'
                                ? 'Student'
                                : item.groupLabel === 'Admins'
                                  ? 'Admin'
                                  : item.groupLabel}
                            </span>
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                ) : null}
                {activeSelectedUser ? (
                  <div className="schedules-user-details">
                    <div>
                      <span className="schedules-user-details-label">{isOverrideCreate ? 'Requester' : 'Name'}</span>
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
                ) : null}
              </div>

              <div className="schedules-form-row schedules-form-row-3">
                <div className="schedules-field">
                  <label>Schedule Type</label>
                  <select value="single" disabled>
                    <option value="single">Single</option>
                  </select>
                </div>
                <div className="schedules-field">
                  <label>Type</label>
                  <select
                    value={formState.scheduleKind}
                    onChange={(event) => updateField('scheduleKind', event.target.value)}
                    disabled={isOverrideCreate}
                  >
                    <option value="regular">Regular</option>
                    <option value="override">Override</option>
                  </select>
                </div>
                <div className="schedules-field">
                  <label>Status</label>
                  <select
                    value={formState.status}
                    onChange={(event) => updateField('status', event.target.value)}
                    disabled={isOverrideCreate}
                  >
                    {regularScheduleStatusOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="schedules-form-row schedules-form-row-3">
                <div className="schedules-field">
                  <label>Schedule Date</label>
                  <input
                    type="date"
                    value={formState.scheduleDate}
                    onChange={(event) => updateField('scheduleDate', event.target.value)}
                  />
                </div>
                <div className="schedules-field">
                  <label>Time Start</label>
                  <input
                    type="time"
                    value={formState.timeStart}
                    onChange={(event) => updateField('timeStart', event.target.value)}
                  />
                </div>
                <div className="schedules-field">
                  <label>Time End</label>
                  <input
                    type="time"
                    value={formState.timeEnd}
                    onChange={(event) => updateField('timeEnd', event.target.value)}
                  />
                </div>
              </div>

              {isOverrideCreate ? (
                <div className="schedules-field">
                  <label htmlFor="override-schedule-reason">Reason</label>
                  <textarea
                    id="override-schedule-reason"
                    rows={3}
                    value={formState.reason}
                    onChange={(event) => updateField('reason', event.target.value)}
                    placeholder="Why this requester needs temporary access (optional)"
                  />
                </div>
              ) : null}
            </div>

            <div className="schedules-form-actions">
              <button type="button" className="schedules-secondary-button" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="schedules-primary-button" disabled={isSubmitting}>
                {isSubmitting
                  ? 'Creating...'
                  : isOverrideCreate
                    ? 'Create Override'
                    : 'Create Schedule'}
              </button>
            </div>
          </form>
        </div>
      </div>

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

      {conflictInfo ? (
        <ScheduleConflictModal
          open
          message={conflictInfo.message || 'An approved override can share a time with one regular schedule. It cannot overlap another override.'}
          details={conflictInfo.conflictDetails || []}
          onClose={() => {
            setConflictInfo(null);
            setPendingPayload(null);
          }}
        />
      ) : null}

      <ErrorNoticeModal
        open={Boolean(formError)}
        message={formError}
        onClose={() => setFormError('')}
      />
    </>
  );
}
