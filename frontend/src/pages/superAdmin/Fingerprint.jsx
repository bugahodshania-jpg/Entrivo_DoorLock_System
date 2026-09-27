import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useActionConfirm } from '../../components/ActionConfirm';
import {
  Activity,
  Ban,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock,
  Download,
  Expand,
  Eye,
  Fingerprint as FingerprintIcon,
  IdCard,
  Plus,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import axiosClient from '../../api/axiosClient';
import RowActionMenu from '../../components/RowActionMenu';
import entrivoLogo from '../../assets/images/entrivo_logo.png';
import { formatDateTimeInManila } from '../../utils/dateTime';
import { userHasPrivilege } from '../../utils/privileges';
import '../../styles/superAdmin/dashboard.css';
import '../../styles/superAdmin/users.css';
import '../../styles/superAdmin/fingerprint.css';
import '../../styles/superAdmin/rfid.css';

const fingerprintTableColumns = [
  'User',
  'Employee ID',
  'Role',
  'Finger Name',
  'Enrollment',
  'Enrolled At',
  'Sync Status',
  'Action',
];

const fingerprintTabs = [
  {
    key: 'faculty',
    label: 'Faculty',
    emptyLabel: 'faculty fingerprints',
    identifierLabel: 'Employee ID',
    columns: fingerprintTableColumns,
  },
  {
    key: 'staff',
    label: 'Staff',
    emptyLabel: 'staff fingerprints',
    identifierLabel: 'Employee ID',
    columns: fingerprintTableColumns,
  },
  {
    key: 'admins',
    label: 'Admin',
    emptyLabel: 'admin fingerprints',
    identifierLabel: 'Employee ID',
    columns: fingerprintTableColumns,
  },
  {
    key: 'super_admins',
    label: 'Super Admin',
    emptyLabel: 'super admin fingerprints',
    identifierLabel: 'Employee ID',
    columns: fingerprintTableColumns,
  },
];

const allFingerprintsFilter = {
  key: 'all',
  label: 'All',
  emptyLabel: 'fingerprints',
  identifierLabel: 'Employee ID',
  columns: fingerprintTableColumns,
};

const fingerprintRoleFilterOptions = [allFingerprintsFilter, ...fingerprintTabs];

const fingerprintEnrollmentFilterOptions = [
  { value: 'all', label: 'All enrollments' },
  { value: 'enrolled', label: 'Enrolled' },
  { value: 'not_enrolled', label: 'Not Enrolled' },
];

const fingerprintSyncFilterOptions = [
  { value: 'all', label: 'All sync statuses' },
  { value: 'synced', label: 'Synced' },
  { value: 'not_synced', label: 'Not Synced' },
  { value: 'partial', label: 'Partial' },
  { value: 'failed', label: 'Failed' },
];

const initialFingerprints = {
  faculty: [],
  staff: [],
  admins: [],
};

function getFingerprintsForRoleFilter(filterKey, fingerprintsByRole) {
  if (filterKey === 'all') {
    return [
      ...(fingerprintsByRole.faculty || []),
      ...(fingerprintsByRole.staff || []),
      ...(fingerprintsByRole.admins || []),
    ];
  }

  if (filterKey === 'admins') {
    return (fingerprintsByRole.admins || []).filter((item) => item.role === 'admin');
  }

  if (filterKey === 'super_admins') {
    return (fingerprintsByRole.admins || []).filter((item) => item.role === 'super_admin');
  }

  return fingerprintsByRole[filterKey] || [];
}

function getEnrollmentKey(fingerprint) {
  return String(fingerprint?.status || '').toLowerCase() === 'active' ? 'enrolled' : 'not_enrolled';
}

function getEnrollmentLabel(fingerprint) {
  return getEnrollmentKey(fingerprint) === 'enrolled' ? 'Enrolled' : 'Not Enrolled';
}

function getFingerprintSyncStatusKey(fingerprint) {
  const syncStatus = String(fingerprint?.doorSyncStatus || '')
    .trim()
    .toLowerCase();

  if (syncStatus === 'synced') {
    return 'synced';
  }

  if (syncStatus === 'partial') {
    return 'partial';
  }

  if (syncStatus === 'failed') {
    return 'failed';
  }

  return 'not_synced';
}

function getFingerprintSyncStatusLabel(fingerprint) {
  const labels = {
    synced: 'Synced',
    not_synced: 'Not Synced',
    partial: 'Partial',
    failed: 'Failed',
  };

  return labels[getFingerprintSyncStatusKey(fingerprint)] || 'Not Synced';
}

function filterFingerprintsByEnrollment(fingerprints, enrollmentFilter) {
  if (enrollmentFilter === 'all') {
    return fingerprints;
  }

  return fingerprints.filter((fingerprint) => getEnrollmentKey(fingerprint) === enrollmentFilter);
}

function filterFingerprintsBySync(fingerprints, syncFilter) {
  if (syncFilter === 'all') {
    return fingerprints;
  }

  return fingerprints.filter(
    (fingerprint) => getFingerprintSyncStatusKey(fingerprint) === syncFilter,
  );
}

const fingerNameOptions = [
  'Right Thumb',
  'Right Index',
  'Right Middle',
  'Right Ring',
  'Right Pinky',
  'Left Thumb',
  'Left Index',
  'Left Middle',
  'Left Ring',
  'Left Pinky',
];

const enrollmentStepMilestones = [
  { threshold: 0, label: 'Job created and queued' },
  { threshold: 5, label: 'ESP32 claimed the job' },
  { threshold: 10, label: 'Place finger for first scan' },
  { threshold: 35, label: 'First scan captured - remove finger' },
  { threshold: 50, label: 'Place same finger for second scan' },
  { threshold: 80, label: 'Generating fingerprint model' },
  { threshold: 90, label: 'Saving fingerprint to sensor' },
  { threshold: 95, label: 'Downloading raw template from device' },
  { threshold: 100, label: 'Enrollment complete' },
];

const enrollmentProgressStages = [
  {
    key: 'waiting',
    label: 'Waiting',
    detail: 'Awaiting ESP32 to pick up the job',
    threshold: 0,
    icon: Clock,
  },
  {
    key: 'claimed',
    label: 'Claimed',
    detail: 'ESP32 accepted the job',
    threshold: 5,
    icon: FingerprintIcon,
  },
  {
    key: 'place-first',
    label: 'Place Finger',
    detail: 'First scan - hold finger on sensor',
    threshold: 10,
    icon: FingerprintIcon,
  },
  {
    key: 'remove',
    label: 'Remove Finger',
    detail: 'Lift finger from the reader',
    threshold: 35,
    icon: Check,
  },
  {
    key: 'place-second',
    label: 'Place Again',
    detail: 'Same finger for second scan',
    threshold: 50,
    icon: FingerprintIcon,
  },
  {
    key: 'create-model',
    label: 'Creating Model',
    detail: 'Generating fingerprint model',
    threshold: 80,
    icon: Activity,
  },
  {
    key: 'save-download',
    label: 'Save & Download',
    detail: 'Storing on device, downloading template',
    threshold: 90,
    icon: Save,
  },
  {
    key: 'complete',
    label: 'Complete',
    detail: 'Enrollment template is ready',
    threshold: 100,
    icon: CheckCircle2,
  },
];

const syncProgressStages = [
  {
    key: 'queued',
    label: 'Queued',
    detail: 'Sync job created',
    progress: 25,
    icon: Clock,
  },
  {
    key: 'syncing',
    label: 'Syncing',
    detail: 'Sensor B is writing the template',
    progress: 65,
    icon: RotateCcw,
  },
  {
    key: 'synced',
    label: 'Synced',
    detail: 'Sensor B confirmed completion',
    progress: 100,
    icon: CheckCircle2,
  },
];

function normalizeJobText(value) {
  return String(value || '').trim().toLowerCase();
}

function resolveSyncStageKey(job) {
  const status = normalizeJobText(job?.status);

  if (status === 'synced') {
    return 'synced';
  }

  if (status === 'syncing') {
    return 'syncing';
  }

  return 'queued';
}

function getSyncProgressValue(job) {
  const status = normalizeJobText(job?.status);

  if (status === 'synced' || status === 'failed') {
    return 100;
  }

  if (status === 'syncing') {
    return 65;
  }

  return 25;
}

function getSyncStatusLabel(job) {
  const status = normalizeJobText(job?.status);

  if (status === 'synced') {
    return 'Sync complete';
  }

  if (status === 'failed') {
    return 'Sync failed';
  }

  if (status === 'syncing') {
    return 'Sensor B is syncing';
  }

  return 'Waiting for Sensor B';
}

function getSyncStatusDetail(job, fallbackMessage = '') {
  const status = normalizeJobText(job?.status);

  if (status === 'synced') {
    return 'The fingerprint template is now stored on Sensor B.';
  }

  if (status === 'failed') {
    return job?.error_message || 'Sensor B reported that the template could not be synced.';
  }

  if (status === 'syncing') {
    return 'Sensor B has picked up the job and is writing the fingerprint template to the door sensor.';
  }

  return fallbackMessage || 'The job is queued. Sensor B will pick it up on its next sync poll.';
}

function resolveEnrollmentStageKey(job) {
  if (!job) {
    return 'waiting';
  }

  const status = normalizeJobText(job.status);
  const step = normalizeJobText(job.current_step);
  const progress = Number(job.progress) || 0;

  if (status === 'completed' || step.includes('complete') || progress >= 100) {
    return 'complete';
  }

  if (status === 'failed' || status === 'cancelled') {
    if (progress >= 90) {
      return 'save-download';
    }

    if (progress >= 75) {
      return 'create-model';
    }

    if (progress >= 50) {
      return 'place-second';
    }

    return progress >= 5 ? 'claimed' : 'waiting';
  }

  if (step.includes('download') || step.includes('upload') || step.includes('sending completion')) {
    return 'save-download';
  }

  if (step.includes('save') || step.includes('saved') || step.includes('store') || step.includes('storing')) {
    return 'save-download';
  }

  if (
    step.includes('create') ||
    step.includes('creating') ||
    step.includes('generate') ||
    step.includes('generating') ||
    step.includes('model') ||
    step.includes('process') ||
    step.includes('processing') ||
    step.includes('template')
  ) {
    return 'create-model';
  }

  if (
    step.includes('same finger') ||
    step.includes('again') ||
    step.includes('second') ||
    step.includes('2nd')
  ) {
    return 'place-second';
  }

  if (step.includes('remove') || step.includes('lift')) {
    return 'remove';
  }

  if (step.includes('place') || step.includes('first scan') || step.includes('reader') || step.includes('sensor')) {
    return 'place-first';
  }

  if (step.includes('claim') || step.includes('start') || status === 'processing') {
    return 'claimed';
  }

  const progressMatchedStage = [...enrollmentProgressStages]
    .reverse()
    .find((stage) => progress >= stage.threshold);

  return progressMatchedStage?.key || 'waiting';
}

function formatRoleLabel(role) {
  const normalizedRole = String(role || '').trim();

  if (!normalizedRole) {
    return 'User';
  }

  return normalizedRole
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function formatStatusLabel(status) {
  if (status === 'blocked') {
    return 'Blocked';
  }

  if (status === 'inactive') {
    return 'Inactive';
  }

  if (status === 'active') {
    return 'Active';
  }

  const normalizedStatus = String(status || '').trim();

  if (!normalizedStatus) {
    return 'Unknown';
  }

  return normalizedStatus.charAt(0).toUpperCase() + normalizedStatus.slice(1);
}

function formatEnrolledAtParts(enrolledAt, fingerprint = null) {
  const isEnrolled =
    fingerprint == null
      ? Boolean(String(enrolledAt || '').trim())
      : String(fingerprint?.status || '').toLowerCase() === 'active' ||
        Boolean(fingerprint?.hasTemplateData);

  if (!isEnrolled) {
    return { date: 'Not enrolled', time: '' };
  }

  const text = String(enrolledAt || '').trim();

  if (!text) {
    return { date: 'Not set', time: '' };
  }

  const match = text.match(/^(.+?)\s+(\d{1,2}:\d{2}\s*[AaPp][Mm])$/);

  if (match) {
    return {
      date: match[1].trim(),
      time: match[2].trim().toUpperCase(),
    };
  }

  return { date: text, time: '' };
}

function formatSyncedAtDisplay(syncedAt, doorSyncStatus) {
  const syncKey = String(doorSyncStatus || '')
    .trim()
    .toLowerCase();

  if (syncKey !== 'synced') {
    return 'Not synced yet';
  }

  const text = String(syncedAt || '').trim();
  return text || 'Not set';
}

function formatEnrolledAtDisplay(fingerprint) {
  const parts = formatEnrolledAtParts(
    fingerprint?.enrolledAt || fingerprint?.registeredAt,
    fingerprint,
  );

  if (!parts.time) {
    return parts.date;
  }

  return `${parts.date} ${parts.time}`;
}

function getUserInitials(name) {
  const nameParts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (nameParts.length === 0) {
    return 'U';
  }

  return nameParts
    .slice(0, 2)
    .map((segment) => segment.charAt(0).toUpperCase())
    .join('');
}

function resolveUserPhotoSrc(photoValue) {
  const normalizedPhotoValue = String(photoValue || '').trim();

  if (!normalizedPhotoValue) {
    return '';
  }

  if (
    /^data:image\//i.test(normalizedPhotoValue) ||
    /^blob:/i.test(normalizedPhotoValue) ||
    /^https?:\/\//i.test(normalizedPhotoValue)
  ) {
    return normalizedPhotoValue;
  }

  if (!/^[./]|^\//.test(normalizedPhotoValue)) {
    return '';
  }

  try {
    return new URL(normalizedPhotoValue, axiosClient.defaults.baseURL || window.location.origin).toString();
  } catch {
    return '';
  }
}

function resolveFingerprintImageSrc(...imageValues) {
  for (const imageValue of imageValues) {
    const resolvedSrc = resolveUserPhotoSrc(imageValue);

    if (resolvedSrc) {
      return resolvedSrc;
    }
  }

  return '';
}

function RealisticFingerprintMark() {
  return (
    <svg
      className="fingerprint-realistic-mark"
      viewBox="0 0 240 300"
      role="img"
      aria-label="Fingerprint preview"
    >
      <path d="M120 28c-48 0-86 38-86 86" />
      <path d="M120 28c41 0 76 29 84 68" />
      <path d="M44 144c0-44 33-80 76-80s76 36 76 80" />
      <path d="M62 143c0-34 25-61 58-61s58 27 58 61" />
      <path d="M79 145c0-24 18-44 41-44s41 20 41 44" />
      <path d="M96 146c0-15 10-27 24-27s24 12 24 27" />
      <path d="M111 149c0-6 4-11 9-11s9 5 9 11" />
      <path d="M34 119c0 31 7 50 20 66" />
      <path d="M52 114c0 40 9 65 28 88" />
      <path d="M70 113c0 49 13 79 39 104" />
      <path d="M88 116c0 54 16 87 51 112" />
      <path d="M106 124c0 51 16 82 48 104" />
      <path d="M124 146c0 36 10 62 30 81" />
      <path d="M142 148c0 28 7 48 22 65" />
      <path d="M160 151c0 18 4 33 12 45" />
      <path d="M178 148c0 16 2 28 8 40" />
      <path d="M196 135c3 18 1 36-5 52" />
      <path d="M35 161c8 39 30 71 63 91" />
      <path d="M53 179c14 32 39 56 72 70" />
      <path d="M76 203c18 22 41 36 67 43" />
      <path d="M105 224c18 12 36 18 58 20" />
      <path d="M31 194c18 46 56 78 103 88" />
      <path d="M56 226c25 30 59 47 99 48" />
      <path d="M87 253c25 15 52 20 83 14" />
      <path d="M202 104c5 15 7 31 5 47" />
      <path d="M220 118c2 29-3 55-16 78" />
      <path d="M209 213c-18 33-47 54-84 63" />
      <path d="M38 87c18-42 58-68 104-62" />
      <path d="M58 72c25-27 63-38 100-27" />
      <path d="M83 54c28-13 61-11 88 6" />
    </svg>
  );
}

function formatJobTimestamp(value) {
  if (!value) {
    return 'Not yet';
  }

  const formatted = formatDateTimeInManila(value);
  return formatted === '—' ? value : formatted;
}

function formatTemplateBytes(value) {
  const bytes = Number(value) || 0;

  if (bytes <= 0) {
    return '0 B';
  }

  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${bytes} B`;
}

function buildFingerprintGroups(fingerprints) {
  const groupedFingerprints = [];
  const groupsByUserId = new Map();

  fingerprints.forEach((fingerprint) => {
    const existingGroup = groupsByUserId.get(fingerprint.userId);

    if (existingGroup) {
      existingGroup.fingerprints.push(fingerprint);
      return;
    }

    const newGroup = {
      userId: fingerprint.userId,
      fingerprints: [fingerprint],
    };

    groupsByUserId.set(fingerprint.userId, newGroup);
    groupedFingerprints.push(newGroup);
  });

  return groupedFingerprints.map((group) => ({
    ...group,
    summaryFingerprint: group.fingerprints[0],
    childFingerprints: group.fingerprints.slice(1),
    totalFingerprints: group.fingerprints.length,
  }));
}

export default function Fingerprint({ user: currentUser } = {}) {
  const confirmAction = useActionConfirm();
  const canUpdateFingerprints = userHasPrivilege(currentUser, 'fingerprint_update');
  const roleFilterMenuRef = useRef(null);
  const enrollmentFilterMenuRef = useRef(null);
  const syncFilterMenuRef = useRef(null);
  const [activeTab, setActiveTab] = useState('all');
  const [activeEnrollmentFilter, setActiveEnrollmentFilter] = useState('all');
  const [activeSyncFilter, setActiveSyncFilter] = useState('all');
  const [isRoleFilterMenuOpen, setIsRoleFilterMenuOpen] = useState(false);
  const [isEnrollmentFilterMenuOpen, setIsEnrollmentFilterMenuOpen] = useState(false);
  const [isSyncFilterMenuOpen, setIsSyncFilterMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('fingerprints');
  const [fingerprintsByRole, setFingerprintsByRole] = useState(initialFingerprints);
  const [enrollmentJobs, setEnrollmentJobs] = useState([]);
  const [finishedJobsPage, setFinishedJobsPage] = useState(1);
  const [syncJobs, setSyncJobs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingJobs, setIsLoadingJobs] = useState(true);
  const [isLoadingSyncJobs, setIsLoadingSyncJobs] = useState(true);
  const [activeActionId, setActiveActionId] = useState(null);
  const [activeJobActionId, setActiveJobActionId] = useState(null);
  const [activeSyncActionId, setActiveSyncActionId] = useState(null);
  const [selectedFingerprint, setSelectedFingerprint] = useState(null);
  const [trackedEnrollmentProgress, setTrackedEnrollmentProgress] = useState(null);
  const [selectedFingerName, setSelectedFingerName] = useState(fingerNameOptions[0]);
  const [errorMessage, setErrorMessage] = useState('');
  const [jobErrorMessage, setJobErrorMessage] = useState('');
  const [syncJobErrorMessage, setSyncJobErrorMessage] = useState('');
  const [templateErrorMessage, setTemplateErrorMessage] = useState('');
  const [activeTemplateActionId, setActiveTemplateActionId] = useState(null);
  const [selectedTemplateFingerprint, setSelectedTemplateFingerprint] = useState(null);
  const [selectedTemplateFingerName, setSelectedTemplateFingerName] = useState('');
  const [templateImportValue, setTemplateImportValue] = useState('');
  const [prefillingTemplateId, setPrefillingTemplateId] = useState(null);
  const [pendingAutoUploadContext, setPendingAutoUploadContext] = useState(null);
  const [autoPreparedTemplateFingerprintId, setAutoPreparedTemplateFingerprintId] = useState(null);
  const [revealedTemplateActionIds, setRevealedTemplateActionIds] = useState([]);
  const [syncPromptFingerprint, setSyncPromptFingerprint] = useState(null);
  const [syncStatusFingerprint, setSyncStatusFingerprint] = useState(null);
  const [syncStatusMessage, setSyncStatusMessage] = useState('');
  const [trackedSyncJobId, setTrackedSyncJobId] = useState(null);
  const [toastItems, setToastItems] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEnrollmentMode, setSelectedEnrollmentMode] = useState('update');
  const [expandedUserIds, setExpandedUserIds] = useState([]);
  const [brokenUserPhotoValue, setBrokenUserPhotoValue] = useState('');
  const [isFingerNameMenuOpen, setIsFingerNameMenuOpen] = useState(false);
  const [viewFingerprint, setViewFingerprint] = useState(null);
  const [isViewPhotoExpanded, setIsViewPhotoExpanded] = useState(false);
  const [isDeletingFingerprintId, setIsDeletingFingerprintId] = useState(null);
  const fingerNameMenuRef = useRef(null);

  const loadFingerprints = useCallback(async () => {
    try {
      const response = await axiosClient.get('/api/fingerprint/fingerprint_dashboard.php');

      setFingerprintsByRole({
        ...initialFingerprints,
        faculty: response.data.fingerprints?.faculty || [],
        staff: response.data.fingerprints?.staff || [],
        admins: response.data.fingerprints?.admins || [],
      });
      setErrorMessage('');
    } catch {
      setFingerprintsByRole(initialFingerprints);
      setErrorMessage('Unable to load fingerprint records right now.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFingerprints();
  }, [loadFingerprints]);

  const loadEnrollmentJobs = useCallback(async () => {
    try {
      const response = await axiosClient.get('/api/fingerprint/get_enrollment_jobs.php?limit=300');
      const jobs = response.data.jobs || [];
      setEnrollmentJobs(jobs);
      setJobErrorMessage('');
      return jobs;
    } catch {
      setEnrollmentJobs([]);
      setJobErrorMessage('Unable to load enrollment jobs right now.');
      return [];
    } finally {
      setIsLoadingJobs(false);
    }
  }, []);

  const loadSyncJobs = useCallback(async () => {
    try {
      const response = await axiosClient.get('/api/sensorB/get_sync_jobs.php?limit=25');
      const jobs = response.data.jobs || [];
      setSyncJobs(jobs);
      setSyncJobErrorMessage('');
      return jobs;
    } catch {
      setSyncJobs([]);
      setSyncJobErrorMessage('Unable to load sync jobs right now.');
      return [];
    } finally {
      setIsLoadingSyncJobs(false);
    }
  }, []);

  const loadJobProgress = useCallback(async (jobId) => {
    if (!jobId || jobId <= 0) {
      return;
    }

    try {
      const response = await axiosClient.get('/api/fingerprint/get_enrollment_jobs.php', {
        params: { job_id: jobId },
      });
      const jobs = response.data?.jobs;

      if (!Array.isArray(jobs) || jobs.length === 0) {
        return;
      }

      const updatedJob = jobs[0];

      setEnrollmentJobs((currentJobs) => {
        const existingIndex = currentJobs.findIndex((j) => j.job_id === jobId);

        if (existingIndex === -1) {
          return currentJobs;
        }

        const existingJob = currentJobs[existingIndex];

        if (
          existingJob.progress === updatedJob.progress &&
          existingJob.status === updatedJob.status &&
          existingJob.current_step === updatedJob.current_step
        ) {
          return currentJobs;
        }

        const nextJobs = [...currentJobs];
        nextJobs[existingIndex] = { ...nextJobs[existingIndex], ...updatedJob };
        return nextJobs;
      });
    } catch {
      // Fast poll failures are silent — the slow full refresh catches any misses
    }
  }, []);

  const dismissToast = useCallback((toastId) => {
    setToastItems((currentItems) => currentItems.filter((item) => item.id !== toastId));
  }, []);

  const pushToast = useCallback(
    (message, type = 'success') => {
      const trimmedMessage = String(message || '').trim();

      if (!trimmedMessage) {
        return;
      }

      const toastId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setToastItems((currentItems) => [...currentItems, { id: toastId, message: trimmedMessage, type }]);

      window.setTimeout(() => {
        dismissToast(toastId);
      }, 20000);
    },
    [dismissToast],
  );

  useEffect(() => {
    if (!errorMessage) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setErrorMessage('');
    }, 20000);

    return () => window.clearTimeout(timeoutId);
  }, [errorMessage]);

  useEffect(() => {
    if (!jobErrorMessage) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setJobErrorMessage('');
    }, 20000);

    return () => window.clearTimeout(timeoutId);
  }, [jobErrorMessage]);

  useEffect(() => {
    if (!syncJobErrorMessage) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setSyncJobErrorMessage('');
    }, 20000);

    return () => window.clearTimeout(timeoutId);
  }, [syncJobErrorMessage]);

  useEffect(() => {
    if (!templateErrorMessage) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setTemplateErrorMessage('');
    }, 20000);

    return () => window.clearTimeout(timeoutId);
  }, [templateErrorMessage]);

  useEffect(() => {
    loadEnrollmentJobs();
    loadSyncJobs();
    loadFingerprints();

    const slowInterval = window.setInterval(() => {
      loadEnrollmentJobs();
      loadSyncJobs();
      loadFingerprints();
    }, 5000);

    return () => window.clearInterval(slowInterval);
  }, [loadEnrollmentJobs, loadFingerprints, loadSyncJobs]);

  function getRequestedFingerName(fingerprint) {
    return fingerprint.fingerName && fingerprint.fingerName !== 'Pending Enrollment'
      ? fingerprint.fingerName
      : 'Right Thumb';
  }

  function getExactTemplateFingerName(fingerprint, preferredFingerName = '') {
    const normalizedPreferredFingerName = String(preferredFingerName || '').trim();

    if (normalizedPreferredFingerName) {
      return normalizedPreferredFingerName;
    }

    if (fingerprint?.fingerName && fingerprint.fingerName !== 'Pending Enrollment') {
      return fingerprint.fingerName;
    }

    return getRequestedFingerName(fingerprint);
  }

  function getUserFingerprints(userId) {
    return Object.values(fingerprintsByRole)
      .flat()
      .filter((fingerprint) => fingerprint.userId === userId);
  }

  function getUsedFingerNames(userId, excludedFingerprintId = null) {
    return new Set(
      getUserFingerprints(userId)
        .filter(
          (fingerprint) =>
            fingerprint.id !== excludedFingerprintId &&
            fingerprint.fingerName &&
            fingerprint.fingerName !== 'Pending Enrollment',
        )
        .map((fingerprint) => fingerprint.fingerName),
    );
  }

  function getNextAvailableFingerName(userId, excludedFingerprintId = null) {
    return getAvailableFingerNames(userId, excludedFingerprintId)[0] || fingerNameOptions[0];
  }

  function isFingerNameTakenByAnotherRecord(userId, fingerName, excludedFingerprintId = null) {
    return getUsedFingerNames(userId, excludedFingerprintId).has(fingerName);
  }

  function getAvailableFingerNames(userId, excludedFingerprintId = null) {
    const usedFingerNames = getUsedFingerNames(userId, excludedFingerprintId);

    return fingerNameOptions.filter((fingerName) => !usedFingerNames.has(fingerName));
  }

  async function fetchTemplatePayload(fingerprint) {
    const response = await axiosClient.get(
      `/api/fingerprint/export_template.php?fingerprint_id=${fingerprint.id}`,
    );
    const templatePayload = response.data?.fingerprint;

    if (!templatePayload?.template_data_base64) {
      throw new Error('No template payload returned.');
    }

    return {
      response,
      templatePayload,
      templateJson: JSON.stringify({ fingerprint: templatePayload }, null, 2),
    };
  }

  function buildTemplateFileName(fingerprint, templatePayload) {
    return `${fingerprint.name || 'fingerprint'}-${templatePayload.finger_name || 'template'}-${
      templatePayload.fingerprint_id
    }.json`
      .replace(/[^\w.-]+/g, '_')
      .toLowerCase();
  }

  function downloadTemplateFile(fingerprint, templatePayload, templateJson) {
    const fileName = buildTemplateFileName(fingerprint, templatePayload);
    const blob = new Blob([templateJson], {
      type: 'application/json',
    });
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = downloadUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(downloadUrl);
  }

  async function prefillTemplateUpload(fingerprint, successMessage, shouldDownload = false) {
    setPrefillingTemplateId(fingerprint.id);

    try {
      const { response, templatePayload, templateJson } = await fetchTemplatePayload(fingerprint);

      if (shouldDownload) {
        downloadTemplateFile(fingerprint, templatePayload, templateJson);
      }

      setTemplateImportValue(templateJson);
      pushToast(
        successMessage ||
          response.data?.message ||
          `Stored template loaded automatically for ${fingerprint.name}.`,
        'success',
      );
      setTemplateErrorMessage('');
    } catch (error) {
      setTemplateErrorMessage(
        error.response?.data?.message || error.message || 'Unable to load the stored template.',
      );
    } finally {
      setPrefillingTemplateId(null);
    }
  }

  function closeFingerprintView() {
    setViewFingerprint(null);
    setIsViewPhotoExpanded(false);
  }

  function openFingerprintView(fingerprint) {
    setViewFingerprint(fingerprint);
    setIsViewPhotoExpanded(false);
  }

  async function handleDeleteFingerprint(fingerprint) {
    if (!fingerprint?.id || isDeletingFingerprintId) {
      return;
    }

    if (!canUpdateFingerprints) {
      pushToast(
        'You do not have permission to delete fingerprints. Ask a Super Admin to grant Update Fingerprints access.',
        'error',
      );
      return;
    }

    const confirmed = await confirmAction({
      title: 'Delete fingerprint',
      danger: true,
      message: `Are you sure you want to permanently delete the ${fingerprint.fingerName || 'fingerprint'} record for ${fingerprint.name || 'this user'}? This cannot be undone.`,
    });

    if (!confirmed) {
      return;
    }

    setIsDeletingFingerprintId(fingerprint.id);

    try {
      const response = await axiosClient.post('/api/fingerprint/delete_fingerprint.php', {
        fingerprint_id: fingerprint.id,
        actor_id: currentUser?.id || undefined,
      });

      pushToast(response.data?.message || 'Fingerprint deleted successfully.', 'success');

      if (viewFingerprint?.id === fingerprint.id) {
        closeFingerprintView();
      }

      await loadFingerprints();
      await loadEnrollmentJobs();
    } catch (error) {
      pushToast(
        error.response?.data?.message || 'Unable to delete that fingerprint right now.',
        'error',
      );
    } finally {
      setIsDeletingFingerprintId(null);
    }
  }

  async function openEnrollmentModal(fingerprint, mode = fingerprint.status === 'active' ? 'update' : 'enroll') {
    if (mode === 'update' && !canUpdateFingerprints) {
      pushToast(
        'You do not have permission to update fingerprints. Ask a Super Admin to grant Update Fingerprints access.',
        'error',
      );
      return;
    }
    if (mode !== 'add') {
      const resumed = await openExistingEnrollmentProgress(fingerprint, fingerprint.fingerName, {
        notify: false,
      });
      if (resumed) {
        return;
      }
    }

    const availableFingerNames =
      mode === 'add' ? getAvailableFingerNames(fingerprint.userId) : fingerNameOptions;

    if (mode === 'add' && availableFingerNames.length === 0) {
      pushToast(
        `All supported finger names are already used for ${fingerprint.name}. No extra fingerprint slot is available.`,
        'error',
      );
      return;
    }

    setSelectedFingerprint(fingerprint);
    setSelectedEnrollmentMode(mode);
    setBrokenUserPhotoValue('');
    setIsFingerNameMenuOpen(false);
    setSelectedFingerName(
      mode === 'add'
        ? availableFingerNames[0]
        : getRequestedFingerName(fingerprint),
    );
    setErrorMessage('');
  }

  function closeEnrollmentModal() {
    if (activeActionId) {
      return;
    }

    setSelectedFingerprint(null);
    setSelectedEnrollmentMode('update');
    setSelectedFingerName(fingerNameOptions[0]);
    setBrokenUserPhotoValue('');
    setIsFingerNameMenuOpen(false);
  }

  function closeEnrollmentProgressModal() {
    if (activeJobActionId && activeJobActionId === trackedEnrollmentJob?.job_id) {
      return;
    }

    setTrackedEnrollmentProgress(null);
  }

  async function openExistingEnrollmentProgress(enrollmentTarget, requestedFingerName, { notify = true } = {}) {
    const latestJobs = await loadEnrollmentJobs();
    const matchingJob =
      latestJobs.find(
        (job) =>
          job.user_id === enrollmentTarget.userId &&
          job.finger_name === requestedFingerName &&
          ['waiting', 'processing'].includes(job.status),
      ) ||
      latestJobs.find(
        (job) =>
          job.user_id === enrollmentTarget.userId &&
          ['waiting', 'processing'].includes(job.status),
      );

    if (!matchingJob) {
      return false;
    }

    setTrackedEnrollmentProgress({
      jobId: Number(matchingJob.job_id) || null,
      userId: enrollmentTarget.userId,
      userName: enrollmentTarget.name,
      fingerName: matchingJob.finger_name || requestedFingerName,
      deviceId: Number(matchingJob.enrollment_device_id) || 1,
      mode: selectedEnrollmentMode,
    });
    setPendingAutoUploadContext({
      jobId: Number(matchingJob.job_id) || null,
      userId: enrollmentTarget.userId,
      fingerprintId: selectedEnrollmentMode === 'add' ? null : enrollmentTarget.id,
      fingerName: matchingJob.finger_name || requestedFingerName,
      mode: selectedEnrollmentMode,
    });
    setErrorMessage('');
    setSelectedFingerprint(null);
    setSelectedEnrollmentMode('update');
    setSelectedFingerName(fingerNameOptions[0]);
    if (notify) {
      pushToast(
        `An enrollment job is already active for ${enrollmentTarget.name}. Opened the live progress modal for that existing job.`,
        'success',
      );
    }

    return true;
  }

  async function handleEnrollmentAction() {
    if (!selectedFingerprint) {
      return;
    }

    if (selectedEnrollmentMode === 'update' && !canUpdateFingerprints) {
      setErrorMessage(
        'You do not have permission to update fingerprints. Ask a Super Admin to grant Update Fingerprints access.',
      );
      return;
    }

    const confirmed = await confirmAction({
      title: selectedEnrollmentMode === 'update' ? 'Update fingerprint' : 'Add fingerprint',
      message:
        selectedEnrollmentMode === 'update'
          ? 'Are you sure you want to update this fingerprint?'
          : 'Are you sure you want to add this fingerprint?',
    });
    if (!confirmed) {
      return;
    }

    const enrollmentTarget = selectedFingerprint;
    const requestedFingerName = selectedFingerName.trim() || getRequestedFingerName(enrollmentTarget);
    const isAddAction = selectedEnrollmentMode === 'add';

    if (
      isFingerNameTakenByAnotherRecord(
        enrollmentTarget.userId,
        requestedFingerName,
        isAddAction ? null : enrollmentTarget.id,
      )
    ) {
      setErrorMessage(
        isAddAction
          ? 'That finger is already registered for this user. Choose another finger to add.'
          : 'That finger already belongs to another fingerprint record for this user.',
      );
      return;
    }

    setActiveActionId(enrollmentTarget.id);
    setErrorMessage('');

    try {
      const response = await axiosClient.post('/api/fingerprint/start_enrollment.php', {
        user_id: enrollmentTarget.userId,
        finger_name: requestedFingerName,
        device_id: 1,
        actor_id: currentUser?.id || undefined,
        ...(isAddAction ? {} : { fingerprint_id: enrollmentTarget.id }),
      });

      pushToast(
        `${
          response.data?.message ||
          `${
            isAddAction ? 'New fingerprint enrollment' : 'Fingerprint update enrollment'
          } created for ${enrollmentTarget.name}.`
        } The enrollment progress is now open. Upload will open automatically after the live enrollment finishes.`,
        'success',
      );
      setTrackedEnrollmentProgress({
        jobId: Number(response.data?.job_id) || null,
        userId: enrollmentTarget.userId,
        userName: enrollmentTarget.name,
        fingerName: requestedFingerName,
        deviceId: 1,
        mode: selectedEnrollmentMode,
      });
      setJobErrorMessage('');
      setTemplateErrorMessage('');
      setPendingAutoUploadContext({
        jobId: Number(response.data?.job_id) || null,
        userId: enrollmentTarget.userId,
        fingerprintId: isAddAction ? null : enrollmentTarget.id,
        fingerName: requestedFingerName,
        mode: selectedEnrollmentMode,
      });
      setSelectedFingerprint(null);
      setSelectedEnrollmentMode('update');
      setSelectedFingerName(fingerNameOptions[0]);
      await loadEnrollmentJobs();
      await loadFingerprints();
    } catch (error) {
      const backendMessage = error.response?.data?.message || '';

      if (backendMessage === 'User already has a pending enrollment.') {
        const openedExistingProgress = await openExistingEnrollmentProgress(
          enrollmentTarget,
          requestedFingerName,
        );

        if (openedExistingProgress) {
          return;
        }
      }

      setErrorMessage(
        backendMessage || 'Unable to start fingerprint enrollment right now.',
      );
    } finally {
      setActiveActionId(null);
    }
  }

  async function handleRetryJob(job) {
    const confirmed = await confirmAction({
      title: 'Retry enrollment',
      message: 'Are you sure you want to retry this enrollment?',
    });
    if (!confirmed) {
      return;
    }

    setActiveJobActionId(job.job_id);

    try {
      const response = await axiosClient.post('/api/fingerprint/retry_job.php', {
        job_id: job.job_id,
      });

      pushToast(response.data?.message || `Enrollment job #${job.job_id} queued again.`, 'success');
      await loadEnrollmentJobs();
    } catch (error) {
      pushToast(error.response?.data?.message || 'Unable to retry that enrollment job.', 'error');
    } finally {
      setActiveJobActionId(null);
    }
  }

  async function handleCancelJob(job) {
    const confirmed = await confirmAction({
      title: 'Cancel enrollment',
      message: 'Are you sure you want to cancel this enrollment?',
      danger: true,
    });
    if (!confirmed) {
      return;
    }

    setActiveJobActionId(job.job_id);

    try {
      const response = await axiosClient.post('/api/fingerprint/cancel_job.php', {
        job_id: job.job_id,
        reason: 'Cancelled by admin from the fingerprint dashboard.',
      });

      pushToast(response.data?.message || `Enrollment job #${job.job_id} cancelled.`, 'success');
      await loadEnrollmentJobs();
    } catch (error) {
      pushToast(error.response?.data?.message || 'Unable to cancel that enrollment job.', 'error');
    } finally {
      setActiveJobActionId(null);
    }
  }

  async function handleQueueTemplateSync(fingerprint, { showStatusModal = false } = {}) {
    if (!fingerprint) {
      return;
    }

    const confirmed = await confirmAction({
      title: 'Sync fingerprint',
      message: 'Are you sure you want to sync this fingerprint?',
    });
    if (!confirmed) {
      return;
    }

    setActiveSyncActionId(fingerprint.id);
    setSyncStatusMessage('');
    setTrackedSyncJobId(null);

    try {
      const response = await axiosClient.post('/api/sensorB/queue_template_sync.php', {
        fingerprint_id: fingerprint.id,
      });

      const message = response.data?.message || 'Template sync queued for Sensor B.';
      const queuedJobId = response.data?.job?.queue_id || response.data?.job?.id || null;
      pushToast(message, 'success');
      setSyncStatusMessage(message);
      setTrackedSyncJobId(queuedJobId);

      if (showStatusModal) {
        setSyncStatusFingerprint(fingerprint);
      }

      setFingerprintsByRole((current) => {
        const next = {};

        Object.entries(current).forEach(([roleKey, roleFingerprints]) => {
          next[roleKey] = roleFingerprints.map((item) =>
            item.id === fingerprint.id
              ? { ...item, doorSyncStatus: response.data?.fingerprint?.door_sync_status || 'pending' }
              : item,
          );
        });

        return next;
      });

      await loadSyncJobs();
      await loadFingerprints();
    } catch (error) {
      const message = error.response?.data?.message || 'Unable to queue template sync for Sensor B.';
      pushToast(message, 'error');
      setSyncStatusMessage(message);
      setTrackedSyncJobId(null);

      if (showStatusModal) {
        setSyncStatusFingerprint(fingerprint);
      }
    } finally {
      setActiveSyncActionId(null);
    }
  }

  async function handleRetrySyncJob(job) {
    const confirmed = await confirmAction({
      title: 'Retry sync',
      message: 'Are you sure you want to retry this sync?',
    });
    if (!confirmed) {
      return;
    }

    setActiveSyncActionId(`sync-job-${job.queue_id}`);

    try {
      const response = await axiosClient.post('/api/sensorB/retry_sync_job.php', {
        queue_id: job.queue_id,
      });

      pushToast(response.data?.message || `Sync job #${job.queue_id} queued again.`, 'success');
      await loadSyncJobs();
      await loadFingerprints();
    } catch (error) {
      pushToast(error.response?.data?.message || 'Unable to retry that sync job.', 'error');
    } finally {
      setActiveSyncActionId(null);
    }
  }

  async function handleCancelSyncJob(job) {
    const confirmed = await confirmAction({
      title: 'Cancel sync',
      message: 'Are you sure you want to cancel this sync?',
      danger: true,
    });
    if (!confirmed) {
      return;
    }

    setActiveSyncActionId(`cancel-sync-job-${job.queue_id}`);

    try {
      const response = await axiosClient.post('/api/sensorB/cancel_sync_job.php', {
        queue_id: job.queue_id,
      });

      pushToast(response.data?.message || `Sync job #${job.queue_id} cancelled.`, 'success');
      await loadSyncJobs();
      await loadFingerprints();
    } catch (error) {
      pushToast(error.response?.data?.message || 'Unable to cancel that sync job.', 'error');
    } finally {
      setActiveSyncActionId(null);
    }
  }

  async function openTemplateUploadModal(fingerprint) {
    setSelectedTemplateFingerprint(fingerprint);
    setSelectedTemplateFingerName(getExactTemplateFingerName(fingerprint));
    setTemplateImportValue('');
    setTemplateErrorMessage('');

    if (!fingerprint.hasTemplateData) {
      return;
    }

    await prefillTemplateUpload(fingerprint);
  }

  function closeTemplateUploadModal() {
    if (
      activeTemplateActionId === `upload-${selectedTemplateFingerprint?.id}` ||
      prefillingTemplateId === selectedTemplateFingerprint?.id
    ) {
      return;
    }

    if (
      selectedTemplateFingerprint &&
      autoPreparedTemplateFingerprintId === selectedTemplateFingerprint.id
    ) {
      setRevealedTemplateActionIds((currentIds) =>
        currentIds.includes(selectedTemplateFingerprint.id)
          ? currentIds
          : [...currentIds, selectedTemplateFingerprint.id],
      );
    }

    setSelectedTemplateFingerprint(null);
    setSelectedTemplateFingerName('');
    setTemplateImportValue('');
    setAutoPreparedTemplateFingerprintId(null);
  }

  async function handleTemplateFileChange(event) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      const content = await file.text();
      setTemplateImportValue(content);
      pushToast(`Loaded template file: ${file.name}`, 'success');
      setTemplateErrorMessage('');
    } catch {
      setTemplateErrorMessage('Unable to read the selected template file.');
    } finally {
      event.target.value = '';
    }
  }

  async function handleUploadTemplate() {
    if (!selectedTemplateFingerprint) {
      return;
    }

    if (!canUpdateFingerprints) {
      setTemplateErrorMessage(
        'You do not have permission to update fingerprints. Ask a Super Admin to grant Update Fingerprints access.',
      );
      return;
    }

    const confirmed = await confirmAction({
      title: 'Upload fingerprint',
      message: 'Are you sure you want to upload this fingerprint template?',
    });
    if (!confirmed) {
      return;
    }

    const uploadedFingerprint = selectedTemplateFingerprint;
    const trimmedPayload = templateImportValue.trim();

    if (!trimmedPayload) {
      setTemplateErrorMessage('Paste a base64 template or load an exported JSON file first.');
      return;
    }

    let parsedPayload = null;
    let templateDataBase64 = '';

    try {
      parsedPayload = JSON.parse(trimmedPayload);
    } catch {
      parsedPayload = null;
    }

    const fingerprintPayload = parsedPayload?.fingerprint || parsedPayload;

    if (fingerprintPayload && typeof fingerprintPayload === 'object') {
      templateDataBase64 = String(fingerprintPayload.template_data_base64 || '').trim();
    }

    if (!templateDataBase64) {
      templateDataBase64 = trimmedPayload.replace(/\s+/g, '');
    }

    if (!templateDataBase64) {
      setTemplateErrorMessage('The template payload does not contain any base64 fingerprint data.');
      return;
    }

    setActiveTemplateActionId(`upload-${selectedTemplateFingerprint.id}`);
    setTemplateErrorMessage('');

    try {
      const response = await axiosClient.post('/api/fingerprint/upload_template.php', {
        fingerprint_id: uploadedFingerprint.id,
        actor_id: currentUser?.id || undefined,
        finger_name:
          fingerprintPayload?.finger_name ||
          getExactTemplateFingerName(uploadedFingerprint, selectedTemplateFingerName),
        enrollment_device_id:
          Number(fingerprintPayload?.enrollment_device_id) ||
          uploadedFingerprint.enrollmentDeviceId ||
          1,
        enrollment_slot:
          Number(fingerprintPayload?.enrollment_slot) ||
          uploadedFingerprint.enrollmentSlot ||
          null,
        shared_door_slot:
          Number(fingerprintPayload?.shared_door_slot) ||
          uploadedFingerprint.sharedDoorSlot ||
          null,
        template_data_base64: templateDataBase64,
      });

      pushToast(response.data?.message || `Template uploaded for ${uploadedFingerprint.name}.`, 'success');
      setSelectedTemplateFingerprint(null);
      setTemplateImportValue('');
      setTrackedEnrollmentProgress(null);
      setAutoPreparedTemplateFingerprintId(null);
      setRevealedTemplateActionIds((currentIds) =>
        currentIds.filter((fingerprintId) => fingerprintId !== uploadedFingerprint.id),
      );
      await loadFingerprints();
      await loadEnrollmentJobs();
      setSyncPromptFingerprint(uploadedFingerprint);
    } catch (error) {
      setTemplateErrorMessage(
        error.response?.data?.message || 'Unable to upload that template right now.',
      );
    } finally {
      setActiveTemplateActionId(null);
    }
  }

  const activeTabConfig =
    fingerprintRoleFilterOptions.find((tab) => tab.key === activeTab) || allFingerprintsFilter;
  const activeEnrollmentFilterConfig =
    fingerprintEnrollmentFilterOptions.find((option) => option.value === activeEnrollmentFilter) ||
    fingerprintEnrollmentFilterOptions[0];
  const activeSyncFilterConfig =
    fingerprintSyncFilterOptions.find((option) => option.value === activeSyncFilter) ||
    fingerprintSyncFilterOptions[0];
  const activeFingerprints = useMemo(
    () => getFingerprintsForRoleFilter(activeTabConfig.key, fingerprintsByRole),
    [activeTabConfig.key, fingerprintsByRole],
  );
  const enrollmentFilteredFingerprints = useMemo(
    () => filterFingerprintsByEnrollment(activeFingerprints, activeEnrollmentFilter),
    [activeFingerprints, activeEnrollmentFilter],
  );
  const syncFilteredFingerprints = useMemo(
    () => filterFingerprintsBySync(enrollmentFilteredFingerprints, activeSyncFilter),
    [enrollmentFilteredFingerprints, activeSyncFilter],
  );
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const visibleFingerprints = useMemo(() => {
    if (!normalizedSearchQuery) {
      return syncFilteredFingerprints;
    }

    return syncFilteredFingerprints.filter((fingerprint) =>
      [
        fingerprint.name,
        fingerprint.email,
        fingerprint.identifier,
        fingerprint.role,
        fingerprint.fingerName,
        fingerprint.enrolledAt,
        fingerprint.registeredAt,
        getEnrollmentLabel(fingerprint),
        getFingerprintSyncStatusLabel(fingerprint),
        fingerprint.userStatus,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearchQuery)),
    );
  }, [syncFilteredFingerprints, normalizedSearchQuery]);
  const groupedVisibleFingerprints = useMemo(
    () => buildFingerprintGroups(visibleFingerprints),
    [visibleFingerprints],
  );
  const visibleUserCount = groupedVisibleFingerprints.length;
  const roleFilterCounts = useMemo(() => {
    const counts = {};

    fingerprintRoleFilterOptions.forEach((option) => {
      const fingerprints = getFingerprintsForRoleFilter(option.key, fingerprintsByRole);
      const uniqueUsers = new Set(fingerprints.map((item) => item.userId));
      counts[option.key] = uniqueUsers.size;
    });

    return counts;
  }, [fingerprintsByRole]);
  const enrollmentFilterCounts = useMemo(() => {
    const counts = { all: activeFingerprints.length };

    fingerprintEnrollmentFilterOptions.forEach((option) => {
      if (option.value === 'all') {
        return;
      }

      counts[option.value] = filterFingerprintsByEnrollment(activeFingerprints, option.value).length;
    });

    return counts;
  }, [activeFingerprints]);
  const syncFilterCounts = useMemo(() => {
    const counts = { all: enrollmentFilteredFingerprints.length };

    fingerprintSyncFilterOptions.forEach((option) => {
      if (option.value === 'all') {
        return;
      }

      counts[option.value] = filterFingerprintsBySync(
        enrollmentFilteredFingerprints,
        option.value,
      ).length;
    });

    return counts;
  }, [enrollmentFilteredFingerprints]);
  const totalEnrolledUsers = useMemo(() => {
    const uniqueUsers = new Set(Object.values(fingerprintsByRole).flat().map((item) => item.userId));
    return uniqueUsers.size;
  }, [fingerprintsByRole]);
  const successfullyEnrolledUsers = useMemo(() => {
    const uniqueUsers = new Set(
      Object.values(fingerprintsByRole)
        .flat()
        .filter((item) => item.status === 'active')
        .map((item) => item.userId),
    );

    return uniqueUsers.size;
  }, [fingerprintsByRole]);
  const totalActiveFingerprints = useMemo(() => {
    return Object.values(fingerprintsByRole)
      .flat()
      .filter((item) => item.status === 'active').length;
  }, [fingerprintsByRole]);
  const trackedEnrollmentJob = useMemo(() => {
    if (!trackedEnrollmentProgress) {
      return null;
    }

    if (trackedEnrollmentProgress.jobId) {
      return (
        enrollmentJobs.find((job) => job.job_id === trackedEnrollmentProgress.jobId) || null
      );
    }

    return (
      enrollmentJobs.find(
        (job) =>
          job.user_id === trackedEnrollmentProgress.userId &&
          job.finger_name === trackedEnrollmentProgress.fingerName,
      ) || null
    );
  }, [enrollmentJobs, trackedEnrollmentProgress]);
  const trackedEnrollmentDisplayJob = useMemo(() => {
    if (!trackedEnrollmentProgress) {
      return null;
    }

    return (
      trackedEnrollmentJob || {
        job_id: trackedEnrollmentProgress.jobId || 0,
        user_name: trackedEnrollmentProgress.userName,
        finger_name: trackedEnrollmentProgress.fingerName,
        enrollment_device_id: trackedEnrollmentProgress.deviceId,
        assigned_slot: null,
        status: 'waiting',
        progress: 0,
        current_step: 'Waiting for ESP32',
        updated_at: null,
        has_template_data: false,
        template_bytes: 0,
        error_message: '',
        can_retry: false,
        can_cancel: false,
      }
    );
  }, [trackedEnrollmentJob, trackedEnrollmentProgress]);
  const trackedEnrollmentFingerprint = useMemo(() => {
    if (!trackedEnrollmentDisplayJob) {
      return null;
    }

    return (
      Object.values(fingerprintsByRole)
        .flat()
        .find((fingerprint) => {
          if (
            trackedEnrollmentDisplayJob.fingerprint_id &&
            fingerprint.id === trackedEnrollmentDisplayJob.fingerprint_id
          ) {
            return true;
          }

          return (
            fingerprint.userId === trackedEnrollmentDisplayJob.user_id &&
            fingerprint.fingerName === trackedEnrollmentDisplayJob.finger_name
          );
        }) || null
    );
  }, [fingerprintsByRole, trackedEnrollmentDisplayJob]);
  const trackedEnrollmentInitials = useMemo(
    () => getUserInitials(trackedEnrollmentFingerprint?.name || trackedEnrollmentDisplayJob?.user_name),
    [trackedEnrollmentDisplayJob, trackedEnrollmentFingerprint],
  );
  const trackedEnrollmentPhotoSrc = useMemo(
    () => resolveUserPhotoSrc(trackedEnrollmentFingerprint?.userPhoto),
    [trackedEnrollmentFingerprint],
  );
  const trackedEnrollmentFingerprintImageSrc = useMemo(
    () =>
      resolveFingerprintImageSrc(
        trackedEnrollmentDisplayJob?.fingerprint_image_url,
        trackedEnrollmentDisplayJob?.fingerprintImageUrl,
        trackedEnrollmentDisplayJob?.fingerprint_image,
        trackedEnrollmentDisplayJob?.fingerprintImage,
        trackedEnrollmentDisplayJob?.fingerprint_photo,
        trackedEnrollmentDisplayJob?.fingerprintPhoto,
        trackedEnrollmentFingerprint?.fingerprintImageUrl,
        trackedEnrollmentFingerprint?.fingerprintImage,
        trackedEnrollmentFingerprint?.fingerprintPhoto,
      ),
    [trackedEnrollmentDisplayJob, trackedEnrollmentFingerprint],
  );
  const isCompletedEnrollmentJob = useCallback((job) => job?.status === 'completed', []);
  const getEnrollmentTemplateStatus = useCallback((job) => {
    if (!job) {
      return 'Not uploaded yet';
    }

    if (job.status === 'completed') {
      return job.has_template_data
        ? `Stored (${formatTemplateBytes(job.template_bytes)})`
        : 'Completing template refresh...';
    }

    if (job.status === 'failed' || job.status === 'cancelled') {
      return job.error_message || 'Enrollment stopped before the template was saved.';
    }

    return 'Waiting for the active enrollment job to finish';
  }, []);
  const getEnrollmentInstruction = useCallback((job) => {
    if (!job) {
      return 'Waiting for enrollment activity';
    }

    if (job.current_step) {
      return job.current_step;
    }

    return job.status === 'waiting'
      ? 'Waiting for ESP32'
      : 'Follow the ESP32 station prompt';
  }, []);
  const getEnrollmentInstructionHint = useCallback((job) => {
    if (!job) {
      return 'Start an enrollment job to see the guided fingerprint steps here.';
    }

    const normalizedStep = String(job.current_step || '').toLowerCase();

    if (normalizedStep.includes('remove')) {
      return 'Lift the same finger completely off the sensor, then wait for the next prompt. Do not touch the sensor until instructed.';
    }

    if (
      normalizedStep.includes('same finger') ||
      normalizedStep.includes('again') ||
      normalizedStep.includes('second scan')
    ) {
      return 'Use the exact same finger you used for the first scan. Press it flat and centered on the scanner.';
    }

    if (normalizedStep.includes('place')) {
      return 'Press the selected finger flat on the sensor until the device confirms the scan. Hold steady - do not move or lift during capture.';
    }

    if (normalizedStep.includes('download')) {
      return 'The system is retrieving the raw template from the sensor. Do not remove power or disconnect the station.';
    }

    if (normalizedStep.includes('save') || normalizedStep.includes('store')) {
      return 'Writing the fingerprint model to the sensor\'s memory. Keep the station powered on.';
    }

    if (normalizedStep.includes('model') || normalizedStep.includes('create')) {
      return 'The device is comparing both scans to build a fingerprint model. This takes a few seconds.';
    }

    if (normalizedStep.includes('upload') || normalizedStep.includes('template')) {
      return 'Keep the station ready while the system saves, exports, and prepares the template.';
    }

    if (normalizedStep.includes('process')) {
      return 'Hold on while the enrollment station builds and verifies the fingerprint template.';
    }

    if (job.status === 'completed') {
      return 'The fingerprint template is ready. Review the upload form to finish syncing it.';
    }

    if (job.status === 'failed' || job.status === 'cancelled') {
      return job.error_message || 'This enrollment stopped before the template could be saved.';
    }

    if (normalizedStep.includes('claim')) {
      return 'The enrollment station has claimed the job and is preparing the sensor for scanning.';
    }

    if (job.status === 'waiting') {
      return 'Waiting for the ESP32 enrollment station to pick up this job from the queue.';
    }

    return 'Follow the live instruction shown here to complete the enrollment in the correct order.';
  }, []);
  const getEnrollmentInstructionTone = useCallback((job) => {
    if (!job) {
      return 'idle';
    }

    const normalizedStep = String(job.current_step || '').toLowerCase();

    if (job.status === 'failed' || job.status === 'cancelled') {
      return 'danger';
    }

    if (job.status === 'completed' || normalizedStep.includes('complete')) {
      return 'success';
    }

    if (
      normalizedStep.includes('place') ||
      normalizedStep.includes('scan')
    ) {
      return 'active';
    }

    if (normalizedStep.includes('remove')) {
      return 'warning';
    }

    if (
      normalizedStep.includes('model') ||
      normalizedStep.includes('create') ||
      normalizedStep.includes('save') ||
      normalizedStep.includes('store') ||
      normalizedStep.includes('download') ||
      normalizedStep.includes('process')
    ) {
      return 'active';
    }

    return 'idle';
  }, []);
  const getFingerprintActionLabel = (fingerprint) => (
    fingerprint.status === 'active' ? 'Update' : 'Enroll'
  );
  const shouldShowAddFingerprintAction = useCallback(
    (fingerprint) => fingerprint.status === 'active',
    [],
  );
  const shouldHideTemplateActions = useCallback(
    (fingerprint) => !revealedTemplateActionIds.includes(fingerprint.id),
    [revealedTemplateActionIds],
  );
  const toggleExpandedUser = useCallback((userId) => {
    setExpandedUserIds((currentUserIds) =>
      currentUserIds.includes(userId)
        ? currentUserIds.filter((currentUserId) => currentUserId !== userId)
        : [...currentUserIds, userId],
    );
  }, []);
  const isUserExpanded = useCallback(
    (userId) => expandedUserIds.includes(userId),
    [expandedUserIds],
  );
  const summaryCards = [
    {
      label: 'Users Enrolled',
      value: totalEnrolledUsers,
      detail: 'Faculty, staff, and admins',
      icon: Users,
    },
    {
      label: 'Successfully Enrolled',
      value: successfullyEnrolledUsers,
      detail: 'Users with completed enrollment',
      icon: FingerprintIcon,
    },
    {
      label: 'Active Fingerprints',
      value: totalActiveFingerprints,
      detail: 'Enabled fingerprint entries',
      icon: CheckCircle2,
    },
  ];
  const liveJobCount = useMemo(
    () => enrollmentJobs.filter((job) => ['waiting', 'processing'].includes(job.status)).length,
    [enrollmentJobs],
  );
  const completedJobCount = useMemo(
    () => enrollmentJobs.filter((job) => job.status === 'completed').length,
    [enrollmentJobs],
  );
  const jobSummaryCards = [
    {
      label: 'Live Jobs',
      value: liveJobCount,
      detail: 'Waiting or processing right now',
      icon: Activity,
    },
    {
      label: 'Recent Completed',
      value: completedJobCount,
      detail: 'Finished jobs in the live panel',
      icon: CheckCircle2,
    },
  ];
  const liveSyncJobCount = useMemo(
    () => syncJobs.filter((job) => ['pending', 'syncing'].includes(job.status)).length,
    [syncJobs],
  );
  const syncedJobCount = useMemo(
    () => syncJobs.filter((job) => job.status === 'synced').length,
    [syncJobs],
  );
  const failedSyncJobCount = useMemo(
    () => syncJobs.filter((job) => job.status === 'failed').length,
    [syncJobs],
  );
  const syncJobSummaryCards = [
    {
      label: 'Pending Sync',
      value: liveSyncJobCount,
      detail: 'Waiting or syncing on Sensor B',
      icon: RotateCcw,
    },
    {
      label: 'Synced',
      value: syncedJobCount,
      detail: 'Templates acknowledged by Sensor B',
      icon: CheckCircle2,
    },
    {
      label: 'Failed',
      value: failedSyncJobCount,
      detail: 'Jobs that can be retried',
      icon: CircleAlert,
    },
  ];
  const liveJobs = useMemo(
    () => enrollmentJobs.filter((job) => job.is_live ?? ['waiting', 'processing'].includes(job.status)),
    [enrollmentJobs],
  );
  const spotlightJob = useMemo(
    () => liveJobs.find((job) => job.status === 'processing') || liveJobs[0] || null,
    [liveJobs],
  );
  useEffect(() => {
    const trackedId = trackedEnrollmentProgress?.jobId || spotlightJob?.job_id;

    if (!trackedId || trackedId <= 0) {
      return;
    }

    const fastInterval = window.setInterval(() => {
      loadJobProgress(trackedId);
    }, 400);

    return () => window.clearInterval(fastInterval);
  }, [loadJobProgress, trackedEnrollmentProgress, spotlightJob]);
  const spotlightInstruction = useMemo(
    () => getEnrollmentInstruction(spotlightJob),
    [getEnrollmentInstruction, spotlightJob],
  );
  const spotlightInstructionHint = useMemo(
    () => getEnrollmentInstructionHint(spotlightJob),
    [getEnrollmentInstructionHint, spotlightJob],
  );
  const spotlightInstructionTone = useMemo(
    () => getEnrollmentInstructionTone(spotlightJob),
    [getEnrollmentInstructionTone, spotlightJob],
  );
  const spotlightMilestones = useMemo(() => {
    const progress = Number(spotlightJob?.progress) || 0;
    const currentStep = String(spotlightJob?.current_step || '').trim();

    const completed = [];
    let current = null;

    for (let i = 0; i < enrollmentStepMilestones.length; i++) {
      const milestone = enrollmentStepMilestones[i];
      if (progress >= milestone.threshold) {
        if (i < enrollmentStepMilestones.length - 1) {
          completed.push(milestone);
        }
      } else {
        current = {
          ...milestone,
          exactStep: currentStep || milestone.label,
        };
        break;
      }
    }

    if (!current && progress >= 100) {
      current = {
        threshold: 100,
        label: currentStep || 'Enrollment complete',
        exactStep: currentStep || 'Enrollment complete',
      };
    }

    return { completed, current };
  }, [spotlightJob]);
  const trackedEnrollmentInstruction = useMemo(
    () => getEnrollmentInstruction(trackedEnrollmentDisplayJob),
    [getEnrollmentInstruction, trackedEnrollmentDisplayJob],
  );
  const trackedEnrollmentInstructionHint = useMemo(
    () => getEnrollmentInstructionHint(trackedEnrollmentDisplayJob),
    [getEnrollmentInstructionHint, trackedEnrollmentDisplayJob],
  );
  const trackedEnrollmentInstructionTone = useMemo(
    () => getEnrollmentInstructionTone(trackedEnrollmentDisplayJob),
    [getEnrollmentInstructionTone, trackedEnrollmentDisplayJob],
  );
  const trackedEnrollmentStageKey = useMemo(
    () => resolveEnrollmentStageKey(trackedEnrollmentDisplayJob),
    [trackedEnrollmentDisplayJob],
  );
  const trackedEnrollmentStageIndex = useMemo(
    () => Math.max(
      0,
      enrollmentProgressStages.findIndex((stage) => stage.key === trackedEnrollmentStageKey),
    ),
    [trackedEnrollmentStageKey],
  );
  const activeSyncStatusJob = useMemo(() => {
    if (!syncStatusFingerprint) {
      return null;
    }

    const fingerprintId = Number(syncStatusFingerprint.id);
    const trackedJob = trackedSyncJobId
      ? syncJobs.find((job) => Number(job.queue_id || job.id) === Number(trackedSyncJobId))
      : null;

    if (trackedJob) {
      return trackedJob;
    }

    return (
      syncJobs.find(
        (job) =>
          Number(job.fingerprint_id) === fingerprintId &&
          ['pending', 'syncing'].includes(normalizeJobText(job.status)),
      ) ||
      syncJobs.find((job) => Number(job.fingerprint_id) === fingerprintId) ||
      null
    );
  }, [syncJobs, syncStatusFingerprint, trackedSyncJobId]);
  const activeSyncStageKey = useMemo(
    () => resolveSyncStageKey(activeSyncStatusJob),
    [activeSyncStatusJob],
  );
  const activeSyncStageIndex = useMemo(
    () => Math.max(0, syncProgressStages.findIndex((stage) => stage.key === activeSyncStageKey)),
    [activeSyncStageKey],
  );
  const activeSyncProgress = useMemo(
    () => getSyncProgressValue(activeSyncStatusJob),
    [activeSyncStatusJob],
  );
  const activeSyncStatusLabel = useMemo(
    () => getSyncStatusLabel(activeSyncStatusJob),
    [activeSyncStatusJob],
  );
  const activeSyncStatusDetail = useMemo(
    () => getSyncStatusDetail(activeSyncStatusJob, syncStatusMessage),
    [activeSyncStatusJob, syncStatusMessage],
  );
  const isActiveSyncClosed = useMemo(
    () => ['synced', 'failed'].includes(normalizeJobText(activeSyncStatusJob?.status)),
    [activeSyncStatusJob],
  );
  useEffect(() => {
    if (!syncStatusFingerprint || isActiveSyncClosed) {
      return undefined;
    }

    const fastSyncInterval = window.setInterval(() => {
      loadSyncJobs();
      loadFingerprints();
    }, 1200);

    return () => window.clearInterval(fastSyncInterval);
  }, [isActiveSyncClosed, loadFingerprints, loadSyncJobs, syncStatusFingerprint]);
  const trackedEnrollmentMilestones = useMemo(() => {
    const progress = Number(trackedEnrollmentDisplayJob?.progress) || 0;
    const currentStep = String(trackedEnrollmentDisplayJob?.current_step || '').trim();

    const completed = [];
    let current = null;
    let remaining = [];

    for (let i = 0; i < enrollmentStepMilestones.length; i++) {
      const milestone = enrollmentStepMilestones[i];
      if (progress >= milestone.threshold) {
        if (i < enrollmentStepMilestones.length - 1) {
          completed.push(milestone);
        }
      } else {
        current = current || {
          ...milestone,
          exactStep: currentStep || milestone.label,
        };
        remaining = enrollmentStepMilestones.slice(i);
        break;
      }
    }

    if (!current && progress >= 100) {
      current = {
        threshold: 100,
        label: currentStep || 'Enrollment complete',
        exactStep: currentStep || 'Enrollment complete',
      };
    }

    return { completed, current, remaining };
  }, [trackedEnrollmentDisplayJob]);
  const finishedEnrollmentJobs = useMemo(
    () => enrollmentJobs.filter((job) => job.is_closed ?? ['completed', 'failed', 'cancelled'].includes(job.status)),
    [enrollmentJobs],
  );
  const enrollmentRowsPerPage = 10;
  const finishedJobsPageCount = Math.max(1, Math.ceil(finishedEnrollmentJobs.length / enrollmentRowsPerPage));
  const safeFinishedJobsPage = Math.min(finishedJobsPage, finishedJobsPageCount);
  const pagedFinishedJobs = finishedEnrollmentJobs.slice(
    (safeFinishedJobsPage - 1) * enrollmentRowsPerPage,
    safeFinishedJobsPage * enrollmentRowsPerPage,
  );
  const closedJobs = useMemo(
    () =>
      enrollmentJobs
        .filter((job) => (job.is_closed ?? ['completed', 'failed', 'cancelled'].includes(job.status)))
        .slice(0, 4),
    [enrollmentJobs],
  );
  const enrollmentModalCopy = useMemo(() => {
    if (selectedEnrollmentMode === 'add') {
      return {
        title: 'Add Another Fingerprint',
        subtitle:
          'Review the user details and choose an unused finger before creating a new enrollment job.',
        fingerLabel: 'Finger To Add',
        actionLabel: 'Ready for New Enrollment',
        helperText:
          'Only unused finger names stay selectable so the system does not create a duplicate fingerprint record for this user.',
      };
    }

    if (selectedEnrollmentMode === 'update') {
      return {
        title: 'Update Fingerprint',
        subtitle:
          'Confirm the user information and select the exact finger record that should be refreshed.',
        fingerLabel: 'Finger To Update',
        actionLabel: 'Ready for Update',
        helperText:
          'Used finger names from other records are locked to prevent overwriting the wrong fingerprint entry.',
      };
    }

    return {
      title: 'Start Fingerprint Enrollment',
      subtitle: 'Review the user details before creating the enrollment job.',
      fingerLabel: 'Finger To Enroll',
      actionLabel: 'Ready for Enrollment',
      helperText:
        'Select the exact finger before starting so the enrollment job and template mapping stay correct.',
    };
  }, [selectedEnrollmentMode]);
  const selectedFingerprintInitials = useMemo(
    () => getUserInitials(selectedFingerprint?.name),
    [selectedFingerprint],
  );
  const selectedFingerprintPhotoSrc = useMemo(() => {
    if (!selectedFingerprint) {
      return '';
    }

    if (String(selectedFingerprint.userPhoto || '').trim() === brokenUserPhotoValue) {
      return '';
    }

    return resolveUserPhotoSrc(selectedFingerprint.userPhoto);
  }, [brokenUserPhotoValue, selectedFingerprint]);
  const unavailableFingerNames = useMemo(() => {
    if (!selectedFingerprint) {
      return new Set();
    }

    return getUsedFingerNames(
      selectedFingerprint.userId,
      selectedEnrollmentMode === 'add' ? null : selectedFingerprint.id,
    );
  }, [fingerprintsByRole, selectedEnrollmentMode, selectedFingerprint]);
  const availableFingerCount = useMemo(() => {
    if (!selectedFingerprint) {
      return fingerNameOptions.length;
    }

    return getAvailableFingerNames(
      selectedFingerprint.userId,
      selectedEnrollmentMode === 'add' ? null : selectedFingerprint.id,
    ).length;
  }, [fingerprintsByRole, selectedEnrollmentMode, selectedFingerprint]);

  useEffect(() => {
    const visibleUserIds = new Set(groupedVisibleFingerprints.map((group) => group.userId));

    setExpandedUserIds((currentUserIds) =>
      currentUserIds.filter((userId) => visibleUserIds.has(userId)),
    );
  }, [groupedVisibleFingerprints]);

  useEffect(() => {
    if (!isFingerNameMenuOpen) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (fingerNameMenuRef.current?.contains(event.target)) {
        return;
      }

      setIsFingerNameMenuOpen(false);
    }

    function handleEscape(event) {
      if (event.key === 'Escape') {
        setIsFingerNameMenuOpen(false);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isFingerNameMenuOpen]);

  useEffect(() => {
    if (!isRoleFilterMenuOpen && !isEnrollmentFilterMenuOpen && !isSyncFilterMenuOpen) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (isRoleFilterMenuOpen && !roleFilterMenuRef.current?.contains(event.target)) {
        setIsRoleFilterMenuOpen(false);
      }

      if (
        isEnrollmentFilterMenuOpen &&
        !enrollmentFilterMenuRef.current?.contains(event.target)
      ) {
        setIsEnrollmentFilterMenuOpen(false);
      }

      if (isSyncFilterMenuOpen && !syncFilterMenuRef.current?.contains(event.target)) {
        setIsSyncFilterMenuOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setIsRoleFilterMenuOpen(false);
        setIsEnrollmentFilterMenuOpen(false);
        setIsSyncFilterMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isRoleFilterMenuOpen, isEnrollmentFilterMenuOpen, isSyncFilterMenuOpen]);

  useEffect(() => {
    if (!pendingAutoUploadContext) {
      return;
    }

    if (!trackedEnrollmentJob) {
      return;
    }

    if (trackedEnrollmentJob.status !== 'completed') {
      return;
    }

    const matchedFingerprint = Object.values(fingerprintsByRole)
      .flat()
      .find((fingerprint) => {
        if (
          pendingAutoUploadContext.fingerprintId &&
          fingerprint.id === pendingAutoUploadContext.fingerprintId
        ) {
          return true;
        }

        if (trackedEnrollmentJob.fingerprint_id && fingerprint.id === trackedEnrollmentJob.fingerprint_id) {
          return true;
        }

        return (
          fingerprint.userId === pendingAutoUploadContext.userId &&
          fingerprint.fingerName === pendingAutoUploadContext.fingerName
        );
      });

    if (!matchedFingerprint?.hasTemplateData) {
      return;
    }

    setPendingAutoUploadContext(null);
    setActiveSection('fingerprints');
    setTrackedEnrollmentProgress(null);
    setSelectedTemplateFingerprint(matchedFingerprint);
    setSelectedTemplateFingerName(
      getExactTemplateFingerName(matchedFingerprint, pendingAutoUploadContext.fingerName),
    );
    setTemplateImportValue('');
    setTemplateErrorMessage('');
    setAutoPreparedTemplateFingerprintId(matchedFingerprint.id);
    setRevealedTemplateActionIds((currentIds) =>
      currentIds.filter((fingerprintId) => fingerprintId !== matchedFingerprint.id),
    );

    void prefillTemplateUpload(
      matchedFingerprint,
      `Enrollment completed for ${matchedFingerprint.name}. The export file was saved and the Upload form was loaded automatically.`,
      true,
    );
  }, [fingerprintsByRole, pendingAutoUploadContext, trackedEnrollmentJob]);

  function renderFingerprintTableRow(
    fingerprint,
    {
      rowKey = fingerprint.id,
      isParentRow = false,
      isChildRow = false,
      additionalFingerprintCount = 0,
      expanded = false,
    } = {},
  ) {
    const isExpandable = isParentRow && additionalFingerprintCount > 0;
    const isSensorBSyncPending =
      fingerprint.hasTemplateData &&
      String(fingerprint.doorSyncStatus || '')
        .trim()
        .toLowerCase() === 'pending';
    const enrolledAtParts = formatEnrolledAtParts(
      fingerprint.enrolledAt || fingerprint.registeredAt,
      fingerprint,
    );

    return (
      <tr
        key={rowKey}
        className={[
          isParentRow ? 'fingerprint-summary-row' : '',
          isChildRow ? 'fingerprint-child-row' : '',
          isExpandable ? 'fingerprint-expandable-row' : '',
          expanded ? 'is-expanded' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={isExpandable ? () => toggleExpandedUser(fingerprint.userId) : undefined}
      >
        <td>
          <div className="fingerprint-user-cell">
            <div className="fingerprint-user-copy">
              <strong>{fingerprint.name}</strong>
              <span>{fingerprint.email}</span>
              {isExpandable && (
                <small>
                  {additionalFingerprintCount} more fingerprint
                  {additionalFingerprintCount > 1 ? 's' : ''}{' '}
                  {expanded ? 'shown below' : 'hidden below'}
                </small>
              )}
            </div>
          </div>
        </td>
        <td>
          <strong>{fingerprint.identifier}</strong>
        </td>
        <td>
          <strong>{formatRoleLabel(fingerprint.role)}</strong>
          <span
            className={`dashboard-log-status manage-users-status-${fingerprint.userStatus}`}
          >
            {formatStatusLabel(fingerprint.userStatus)}
          </span>
        </td>
        <td>
          <strong>{fingerprint.fingerName}</strong>
          <span>
            {fingerprint.hasTemplateData
              ? `Raw template ready - ${formatTemplateBytes(fingerprint.templateBytes)}`
              : 'Raw template not stored yet'}
          </span>
        </td>
        <td>
          <span
            className={`dashboard-log-status fingerprint-enrollment-${getEnrollmentKey(fingerprint)}`}
          >
            {getEnrollmentLabel(fingerprint)}
          </span>
        </td>
        <td>
          <strong>{enrolledAtParts.date}</strong>
          {enrolledAtParts.time ? <span>{enrolledAtParts.time}</span> : null}
        </td>
        <td>
          <span
            className={`dashboard-log-status fingerprint-sync-${getFingerprintSyncStatusKey(fingerprint)}`}
          >
            {getFingerprintSyncStatusLabel(fingerprint)}
          </span>
        </td>
        <td>
          <RowActionMenu
            label={`Actions for ${fingerprint.name}`}
            items={[
              {
                label: 'View',
                icon: Eye,
                onClick: () => openFingerprintView(fingerprint),
              },
              {
                label: activeActionId === fingerprint.id ? 'Starting...' : getFingerprintActionLabel(fingerprint),
                icon: FingerprintIcon,
                disabled: activeActionId === fingerprint.id,
                hidden: fingerprint.status === 'active' && !canUpdateFingerprints,
                onClick: () => openEnrollmentModal(fingerprint),
              },
              {
                label: activeSyncActionId === fingerprint.id ? 'Syncing...' : 'Sync',
                icon: RotateCcw,
                hidden: !isSensorBSyncPending,
                disabled: activeSyncActionId === fingerprint.id,
                onClick: () => handleQueueTemplateSync(fingerprint, { showStatusModal: true }),
              },
              {
                label: 'New fingerprint',
                icon: Plus,
                hidden: !shouldShowAddFingerprintAction(fingerprint),
                disabled: activeActionId === fingerprint.id,
                onClick: () => openEnrollmentModal(fingerprint, 'add'),
              },
              {
                label: prefillingTemplateId === fingerprint.id ? 'Loading...' : 'Upload',
                icon: Upload,
                hidden: shouldHideTemplateActions(fingerprint) || !canUpdateFingerprints,
                disabled:
                  activeTemplateActionId === `upload-${fingerprint.id}` ||
                  prefillingTemplateId === fingerprint.id,
                onClick: () => openTemplateUploadModal(fingerprint),
              },
              {
                label: isDeletingFingerprintId === fingerprint.id ? 'Deleting...' : 'Delete',
                icon: Trash2,
                danger: true,
                hidden: !canUpdateFingerprints,
                disabled: isDeletingFingerprintId === fingerprint.id,
                onClick: () => handleDeleteFingerprint(fingerprint),
              },
            ]}
          />
        </td>
      </tr>
    );
  }

  const renderEnrollmentJobsTable = (jobs, emptyLabel) => (
    <div className="dashboard-recent-table-wrap fingerprint-jobs-wrap">
      <table className="dashboard-recent-table fingerprint-jobs-table">
        <thead>
          <tr>
            <th>User</th>
            <th>Finger</th>
            <th>Progress</th>
            <th>Current Step</th>
            <th>Status</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {isLoadingJobs && (
            <tr>
              <td className="dashboard-recent-empty" colSpan={6}>
                Loading enrollment jobs...
              </td>
            </tr>
          )}
          {!isLoadingJobs && jobs.length === 0 && !jobErrorMessage && (
            <tr>
              <td className="dashboard-recent-empty" colSpan={6}>
                {emptyLabel}
              </td>
            </tr>
          )}
          {!isLoadingJobs &&
            jobs.map((job) => (
              <tr key={job.job_id}>
                <td className="fingerprint-job-user">
                  <strong>{job.user_name}</strong>
                  <span>{job.email || `User #${job.user_id}`}</span>
                </td>
                <td className="fingerprint-job-finger">
                  <strong>{job.finger_name}</strong>
                  <span>Device {job.enrollment_device_id ?? 'N/A'} - Slot {job.assigned_slot ?? 'N/A'}</span>
                </td>
                <td className="fingerprint-job-progress-cell">
                  <div className="fingerprint-job-progress" aria-label={`Progress ${job.progress}%`}>
                    <div
                      className="fingerprint-job-progress-bar"
                      style={{ width: `${Math.max(0, Math.min(100, job.progress || 0))}%` }}
                    />
                  </div>
                  <span>{job.progress}%</span>
                </td>
                <td className="fingerprint-job-step">
                  <strong>{job.current_step || 'Waiting for ESP32'}</strong>
                  <span>
                    {job.has_template_data
                      ? `Template saved (${job.template_bytes} bytes)`
                      : job.error_message || 'Template not uploaded yet'}
                  </span>
                </td>
                <td className="fingerprint-job-status-cell">
                  <span className={`dashboard-log-status dashboard-log-status-${job.status}`}>
                    {job.status}
                  </span>
                </td>
                <td className="fingerprint-job-updated">{formatJobTimestamp(job.updated_at)}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );

  const renderEnrollmentJobsPagination = (page, pageCount, total, setPage, label) => {
    if (isLoadingJobs || total === 0) {
      return null;
    }

    const start = (page - 1) * enrollmentRowsPerPage + 1;
    const end = Math.min(page * enrollmentRowsPerPage, total);

    return (
      <div className="fingerprint-jobs-pagination" aria-label={label}>
        <p>
          Showing {start}-{end} of {total}
        </p>
        <div className="fingerprint-jobs-pagination-controls">
          <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}>
            Previous
          </button>
          <span>
            Page {page} of {pageCount}
          </span>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
            disabled={page === pageCount}
          >
            Next
          </button>
        </div>
      </div>
    );
  };

  const viewFingerprintGroups = useMemo(() => {
    if (!viewFingerprint) {
      return [];
    }

    const enrolledAtDisplay = formatEnrolledAtDisplay(viewFingerprint);
    const syncedAtDisplay = formatSyncedAtDisplay(
      viewFingerprint.syncedAt,
      viewFingerprint.doorSyncStatus,
    );

    return [
      {
        title: 'Personal',
        fields: [
          ['Full name', viewFingerprint.name, true],
          ['Email', viewFingerprint.email],
          ['Employee ID', viewFingerprint.identifier],
          ['Role', formatRoleLabel(viewFingerprint.role)],
          ['User status', formatStatusLabel(viewFingerprint.userStatus)],
          ['Department', viewFingerprint.officeDepartment || 'Not assigned'],
          ['Position', viewFingerprint.workPosition || 'Not assigned'],
        ],
      },
      {
        title: 'Fingerprint',
        fields: [
          ['Finger name', viewFingerprint.fingerName],
          ['Enrollment', getEnrollmentLabel(viewFingerprint)],
          ['Enrolled at', enrolledAtDisplay],
          ['Sync status', getFingerprintSyncStatusLabel(viewFingerprint)],
          ['Synced at', syncedAtDisplay],
          [
            'Enrollment device / slot',
            `Device ${viewFingerprint.enrollmentDeviceId ?? 'N/A'} / Slot ${
              viewFingerprint.enrollmentSlot ?? 'N/A'
            }`,
          ],
          [
            'Shared door slot',
            viewFingerprint.sharedDoorSlot ? String(viewFingerprint.sharedDoorSlot) : 'Not assigned',
          ],
          [
            'Template',
            viewFingerprint.hasTemplateData
              ? `Ready (${formatTemplateBytes(viewFingerprint.templateBytes)})`
              : 'Not stored yet',
          ],
        ],
      },
    ];
  }, [viewFingerprint]);

  const viewFingerprintPhotoSrc = useMemo(() => {
    if (!viewFingerprint?.userPhoto) {
      return '';
    }

    return resolveUserPhotoSrc(viewFingerprint.userPhoto);
  }, [viewFingerprint]);

  return (
    <>
    <main className="admin-dashboard fingerprint-page" aria-label="Fingerprint records">
      {toastItems.length > 0 && (
        <div className="fingerprint-toast-stack" aria-live="polite" aria-atomic="true">
          {toastItems.map((toast) => (
            <article
              className={`fingerprint-toast fingerprint-toast-${toast.type}`}
              key={toast.id}
              role={toast.type === 'error' ? 'alert' : 'status'}
            >
              <div className="fingerprint-toast-copy">
                <strong>{toast.type === 'error' ? 'Enrollment Notice' : 'Fingerprint Notice'}</strong>
                <p>{toast.message}</p>
              </div>
              <button
                type="button"
                className="fingerprint-toast-close"
                onClick={() => dismissToast(toast.id)}
                aria-label="Dismiss message"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </article>
          ))}
        </div>
      )}

      {activeSection === 'fingerprints' && (
        <>
          <section className="manage-users-summary-grid fingerprint-summary-grid" aria-label="Fingerprint summary">
            {summaryCards.map(({ label, value, detail, icon: Icon }) => (
              <article className="dashboard-summary-card fingerprint-summary-card" key={label}>
                <div className="dashboard-summary-icon" aria-hidden="true">
                  <Icon size={28} strokeWidth={2.4} />
                </div>
                <div className="dashboard-summary-copy">
                  <span className="dashboard-summary-label">{label}</span>
                  <strong>{isLoading ? '--' : value}</strong>
                  <small>{detail}</small>
                </div>
              </article>
            ))}
          </section>

          <section className="dashboard-recent-card fingerprint-card">
            <div className="dashboard-panel-header">
              <div>
                <span>{activeTabConfig.label} Fingerprints</span>
                <p>Enrollment and active account status for fingerprint access.</p>
              </div>
              <div className="fingerprint-header-actions">
                <div className="fingerprint-job-link-row">
                  <button
                    type="button"
                    className="fingerprint-jobs-button"
                    onClick={() => setActiveSection('jobs')}
                  >
                    [Enrollment Jobs]
                  </button>
                  <button
                    type="button"
                    className="fingerprint-jobs-button"
                    onClick={() => setActiveSection('sync-jobs')}
                  >
                    [Sync Jobs]
                  </button>
                </div>
                <label className="fingerprint-search" aria-label="Search fingerprints">
                  <Search size={16} aria-hidden="true" />
                  <input
                    type="search"
                    placeholder={
                      activeTabConfig.key === 'all'
                        ? 'Search fingerprints...'
                        : `Search ${activeTabConfig.label.toLowerCase()} fingerprints...`
                    }
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                  />
                </label>
              </div>
            </div>

            <div className="manage-users-role-filter fingerprint-table-filters">
              <div
                className="manage-users-role-tabs"
                ref={roleFilterMenuRef}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) {
                    setIsRoleFilterMenuOpen(false);
                  }
                }}
              >
                <button
                  type="button"
                  className={`manage-users-role-tab-trigger${isRoleFilterMenuOpen ? ' is-open' : ''}`}
                  aria-haspopup="listbox"
                  aria-expanded={isRoleFilterMenuOpen}
                  aria-controls="fingerprint-role-filter-menu"
                  aria-label={`Role filter: ${activeTabConfig.label}`}
                  disabled={isLoading}
                  onClick={() => {
                    setIsRoleFilterMenuOpen((open) => !open);
                    setIsEnrollmentFilterMenuOpen(false);
                    setIsSyncFilterMenuOpen(false);
                  }}
                >
                  <span className="manage-users-role-tab-trigger-label">{activeTabConfig.label}</span>
                  <span className="manage-users-role-tab-count">
                    {isLoading ? '--' : roleFilterCounts[activeTabConfig.key] || 0}
                  </span>
                  <ChevronDown className="manage-users-role-tab-chevron" size={14} aria-hidden="true" />
                </button>

                {isRoleFilterMenuOpen ? (
                  <div
                    id="fingerprint-role-filter-menu"
                    className="manage-users-role-tab-menu"
                    role="listbox"
                    aria-label="Filter fingerprints by role"
                  >
                    {fingerprintRoleFilterOptions.map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        role="option"
                        className={`manage-users-role-tab-option${
                          activeTab === option.key ? ' is-active' : ''
                        }`}
                        aria-selected={activeTab === option.key}
                        onClick={() => {
                          setActiveTab(option.key);
                          setIsRoleFilterMenuOpen(false);
                        }}
                      >
                        <Check className="manage-users-role-tab-check" size={15} aria-hidden="true" />
                        <span className="manage-users-role-tab-option-label">{option.label}</span>
                        <span className="manage-users-role-tab-count">
                          {isLoading ? '--' : roleFilterCounts[option.key] || 0}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div
                className="manage-users-role-tabs manage-users-status-filter"
                ref={enrollmentFilterMenuRef}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) {
                    setIsEnrollmentFilterMenuOpen(false);
                  }
                }}
              >
                <button
                  type="button"
                  className={`manage-users-role-tab-trigger${
                    isEnrollmentFilterMenuOpen ? ' is-open' : ''
                  }`}
                  aria-haspopup="listbox"
                  aria-expanded={isEnrollmentFilterMenuOpen}
                  aria-controls="fingerprint-enrollment-filter-menu"
                  aria-label={`Enrollment filter: ${activeEnrollmentFilterConfig.label}`}
                  disabled={isLoading}
                  onClick={() => {
                    setIsEnrollmentFilterMenuOpen((open) => !open);
                    setIsRoleFilterMenuOpen(false);
                    setIsSyncFilterMenuOpen(false);
                  }}
                >
                  <span className="manage-users-role-tab-trigger-label">
                    {activeEnrollmentFilterConfig.label}
                  </span>
                  <span className="manage-users-role-tab-count">
                    {isLoading ? '--' : enrollmentFilterCounts[activeEnrollmentFilterConfig.value] || 0}
                  </span>
                  <ChevronDown className="manage-users-role-tab-chevron" size={14} aria-hidden="true" />
                </button>

                {isEnrollmentFilterMenuOpen ? (
                  <div
                    id="fingerprint-enrollment-filter-menu"
                    className="manage-users-role-tab-menu"
                    role="listbox"
                    aria-label="Filter by enrollment status"
                  >
                    {fingerprintEnrollmentFilterOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        role="option"
                        className={`manage-users-role-tab-option${
                          activeEnrollmentFilter === option.value ? ' is-active' : ''
                        }`}
                        aria-selected={activeEnrollmentFilter === option.value}
                        onClick={() => {
                          setActiveEnrollmentFilter(option.value);
                          setIsEnrollmentFilterMenuOpen(false);
                        }}
                      >
                        <Check className="manage-users-role-tab-check" size={15} aria-hidden="true" />
                        <span className="manage-users-role-tab-option-label">{option.label}</span>
                        <span className="manage-users-role-tab-count">
                          {isLoading ? '--' : enrollmentFilterCounts[option.value] || 0}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div
                className="manage-users-role-tabs manage-users-status-filter"
                ref={syncFilterMenuRef}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) {
                    setIsSyncFilterMenuOpen(false);
                  }
                }}
              >
                <button
                  type="button"
                  className={`manage-users-role-tab-trigger${isSyncFilterMenuOpen ? ' is-open' : ''}`}
                  aria-haspopup="listbox"
                  aria-expanded={isSyncFilterMenuOpen}
                  aria-controls="fingerprint-sync-filter-menu"
                  aria-label={`Sync status filter: ${activeSyncFilterConfig.label}`}
                  disabled={isLoading}
                  onClick={() => {
                    setIsSyncFilterMenuOpen((open) => !open);
                    setIsRoleFilterMenuOpen(false);
                    setIsEnrollmentFilterMenuOpen(false);
                  }}
                >
                  <span className="manage-users-role-tab-trigger-label">
                    {activeSyncFilterConfig.label}
                  </span>
                  <span className="manage-users-role-tab-count">
                    {isLoading ? '--' : syncFilterCounts[activeSyncFilterConfig.value] || 0}
                  </span>
                  <ChevronDown className="manage-users-role-tab-chevron" size={14} aria-hidden="true" />
                </button>

                {isSyncFilterMenuOpen ? (
                  <div
                    id="fingerprint-sync-filter-menu"
                    className="manage-users-role-tab-menu"
                    role="listbox"
                    aria-label="Filter by sync status"
                  >
                    {fingerprintSyncFilterOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        role="option"
                        className={`manage-users-role-tab-option${
                          activeSyncFilter === option.value ? ' is-active' : ''
                        }`}
                        aria-selected={activeSyncFilter === option.value}
                        onClick={() => {
                          setActiveSyncFilter(option.value);
                          setIsSyncFilterMenuOpen(false);
                        }}
                      >
                        <Check className="manage-users-role-tab-check" size={15} aria-hidden="true" />
                        <span className="manage-users-role-tab-option-label">{option.label}</span>
                        <span className="manage-users-role-tab-count">
                          {isLoading ? '--' : syncFilterCounts[option.value] || 0}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="dashboard-recent-table-wrap fingerprint-table-wrap">
              {templateErrorMessage && (
                <p className="fingerprint-inline-message fingerprint-inline-message-error" role="alert">
                  {templateErrorMessage}
                </p>
              )}
              <table className="dashboard-recent-table fingerprint-table">
                <thead>
                  <tr>
                    {activeTabConfig.columns.map((column) => (
                      <th key={column}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {isLoading && (
                    <tr>
                      <td className="dashboard-recent-empty" colSpan={activeTabConfig.columns.length}>
                        Loading {activeTabConfig.emptyLabel}...
                      </td>
                    </tr>
                  )}

                  {!isLoading && errorMessage && (
                    <tr>
                      <td className="dashboard-recent-empty" colSpan={activeTabConfig.columns.length}>
                        {errorMessage}
                      </td>
                    </tr>
                  )}

                  {!isLoading && !errorMessage && visibleFingerprints.length === 0 && (
                    <tr>
                      <td className="dashboard-recent-empty" colSpan={activeTabConfig.columns.length}>
                        {normalizedSearchQuery
                          ? `No ${activeTabConfig.emptyLabel} match your search.`
                          : activeEnrollmentFilter !== 'all' || activeSyncFilter !== 'all'
                            ? `No ${activeTabConfig.emptyLabel} match the selected filters.`
                            : `No ${activeTabConfig.emptyLabel} found.`}
                      </td>
                    </tr>
                  )}

                  {!isLoading &&
                    !errorMessage &&
                    groupedVisibleFingerprints.map((group) => {
                      const expanded = isUserExpanded(group.userId);

                      return (
                        <Fragment key={`group-${group.userId}`}>
                          {renderFingerprintTableRow(group.summaryFingerprint, {
                            rowKey: `summary-${group.summaryFingerprint.id}`,
                            isParentRow: true,
                            additionalFingerprintCount: group.childFingerprints.length,
                            expanded,
                          })}
                          {expanded &&
                            group.childFingerprints.map((fingerprint) =>
                              renderFingerprintTableRow(fingerprint, {
                                rowKey: `child-${fingerprint.id}`,
                                isChildRow: true,
                              }),
                            )}
                        </Fragment>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {activeSection === 'jobs' && (
        <>
        <section className="dashboard-recent-card fingerprint-card fingerprint-jobs-card">
          <div className="dashboard-panel-header">
            <div>
              <span>Enrollment Jobs</span>
              <p>Live queue, device progress, retry, and cancel controls for fingerprint enrollment.</p>
            </div>
            <button
              type="button"
              className="fingerprint-back-button"
              onClick={() => setActiveSection('fingerprints')}
            >
              Back to Fingerprints
            </button>
          </div>

          <section className="fingerprint-job-summary" aria-label="Enrollment job summary">
            {jobSummaryCards.map(({ label, value, detail, icon: Icon }) => (
              <article className="dashboard-summary-card fingerprint-job-summary-card" key={label}>
                <div className="dashboard-summary-icon" aria-hidden="true">
                  <Icon size={22} strokeWidth={2.4} />
                </div>
                <div className="dashboard-summary-copy">
                  <span className="dashboard-summary-label">{label}</span>
                  <strong>{isLoadingJobs ? '--' : value}</strong>
                  <small>{detail}</small>
                </div>
              </article>
            ))}
          </section>

          <section className="fingerprint-live-panel" aria-label="Live enrollment status panel">
            <article className="fingerprint-live-spotlight">
              <div className="fingerprint-live-heading">
                <span>Current Device Status</span>
                <p>
                  {spotlightJob
                    ? 'The job the enrollment station is handling now.'
                    : 'The enrollment station is idle right now.'}
                </p>
              </div>

              {spotlightJob ? (
                <div className="fingerprint-live-spotlight-body">
                  <div className="fingerprint-device-status-head">
                    <div>
                      <strong>{spotlightJob.user_name}</strong>
                      <div className="fingerprint-device-status-meta">
                        <span>{spotlightJob.finger_name}</span>
                        <span>Device {spotlightJob.enrollment_device_id ?? 'N/A'}</span>
                        <span>Slot {spotlightJob.assigned_slot ?? 'Pending'}</span>
                      </div>
                    </div>
                    <span className={`dashboard-log-status dashboard-log-status-${spotlightJob.status} fingerprint-device-status-pill`}>
                      {spotlightJob.status}
                    </span>
                  </div>

                  <div className="fingerprint-device-status-progress">
                    <div className="fingerprint-live-progress">
                      <div
                        className="fingerprint-live-progress-bar"
                        style={{ width: `${Math.max(0, Math.min(100, spotlightJob.progress || 0))}%` }}
                      />
                    </div>
                    <strong>{spotlightJob.progress}%</strong>
                  </div>

                  <div
                    className={`fingerprint-enrollment-guide fingerprint-enrollment-guide-${spotlightInstructionTone}`}
                  >
                    <span className="fingerprint-enrollment-guide-label">
                      <FingerprintIcon size={16} aria-hidden="true" />
                      Enrollment Guide
                    </span>
                    <strong>{spotlightInstruction}</strong>
                    <p>{spotlightInstructionHint}</p>
                  </div>

                  {spotlightMilestones.completed.length > 0 && (
                    <div className="fingerprint-step-log" aria-label="Completed enrollment steps">
                      <span className="fingerprint-step-log-label">
                        <Clock size={13} aria-hidden="true" />
                        Step History
                      </span>
                      <div className="fingerprint-step-log-list">
                        {spotlightMilestones.completed.map((milestone, idx) => (
                          <div className="fingerprint-step-log-item fingerprint-step-log-complete" key={idx}>
                            <Check size={12} aria-hidden="true" />
                            <span>{milestone.label}</span>
                          </div>
                        ))}
                        {spotlightMilestones.current && (
                          <div className="fingerprint-step-log-item fingerprint-step-log-current">
                            <Activity size={12} aria-hidden="true" />
                            <span>{spotlightMilestones.current.exactStep}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="fingerprint-live-copy-grid">
                    <div>
                      <span>Current Step</span>
                      <strong>{spotlightJob.current_step || 'Waiting for ESP32'}</strong>
                    </div>
                    <div>
                      <span>Progress</span>
                      <strong>{spotlightJob.progress}%</strong>
                    </div>
                    <div>
                      <span>Updated</span>
                      <strong>{formatJobTimestamp(spotlightJob.updated_at)}</strong>
                    </div>
                    <div>
                      <span>Template</span>
                      <strong>
                        {getEnrollmentTemplateStatus(spotlightJob)}
                      </strong>
                    </div>
                  </div>

                  {(spotlightJob.can_retry || spotlightJob.can_cancel) && (
                    <div className="fingerprint-action-group fingerprint-live-actions">
                      {spotlightJob.can_retry && !isCompletedEnrollmentJob(spotlightJob) && (
                        <button
                          type="button"
                          className="fingerprint-secondary-action"
                          onClick={() => handleRetryJob(spotlightJob)}
                          disabled={activeJobActionId === spotlightJob.job_id}
                        >
                          <RotateCcw size={14} aria-hidden="true" />
                          {activeJobActionId === spotlightJob.job_id ? 'Working...' : 'Retry'}
                        </button>
                      )}
                      {spotlightJob.can_cancel && (
                        <button
                          type="button"
                          className="fingerprint-secondary-action fingerprint-danger-action"
                          onClick={() => handleCancelJob(spotlightJob)}
                          disabled={activeJobActionId === spotlightJob.job_id}
                        >
                          <Ban size={14} aria-hidden="true" />
                          {activeJobActionId === spotlightJob.job_id ? 'Working...' : 'Cancel'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="fingerprint-live-empty">
                  <strong>No job is being processed right now.</strong>
                  <span>Start a new enrollment or wait for the ESP32 station to claim the next job.</span>
                </div>
              )}
            </article>

            <div className="fingerprint-live-sidepanels">
              <article className="fingerprint-live-list-card">
                <div className="fingerprint-live-heading">
                  <span>Recent Results</span>
                  <p>Completed, failed, and cancelled jobs.</p>
                </div>

                {closedJobs.length === 0 ? (
                  <div className="fingerprint-live-empty compact">
                    <strong>No finished jobs yet.</strong>
                    <span>Finished jobs will appear here once the station starts working.</span>
                  </div>
                ) : (
                  <div className="fingerprint-live-list">
                    {closedJobs.map((job) => (
                      <article className="fingerprint-live-list-item" key={job.job_id}>
                        <div>
                          <strong>{job.user_name}</strong>
                          <span>{job.current_step || job.error_message || 'Closed job'}</span>
                        </div>
                        <div>
                          <span className={`dashboard-log-status dashboard-log-status-${job.status}`}>
                            {job.status}
                          </span>
                          <small>{formatJobTimestamp(job.finished_at || job.updated_at)}</small>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </article>
            </div>
          </section>

          {jobErrorMessage && (
            <p className="fingerprint-inline-message fingerprint-inline-message-error" role="alert">
              {jobErrorMessage}
            </p>
          )}
        </section>

        <section className="dashboard-recent-card fingerprint-card fingerprint-jobs-card fingerprint-jobs-table-card">
          <div className="dashboard-panel-header">
            <div>
              <span>Finished Enrollment Jobs</span>
              <p>Completed, failed, and cancelled enrollment jobs.</p>
            </div>
          </div>
          {renderEnrollmentJobsTable(pagedFinishedJobs, 'No finished enrollment jobs.')}
          {renderEnrollmentJobsPagination(
            safeFinishedJobsPage,
            finishedJobsPageCount,
            finishedEnrollmentJobs.length,
            setFinishedJobsPage,
            'Finished enrollment jobs pagination',
          )}
        </section>
        </>
      )}

      {activeSection === 'sync-jobs' && (
        <section className="dashboard-recent-card fingerprint-card fingerprint-jobs-card">
          <div className="dashboard-panel-header fingerprint-sync-header">
            <div>
              <span>Sync Jobs</span>
              <p>Sensor B template queue, delivery attempts, retry controls, and sync results.</p>
            </div>
            <button
              type="button"
              className="fingerprint-back-button"
              onClick={() => setActiveSection('fingerprints')}
            >
              Back to Fingerprints
            </button>
          </div>

          <div className="fingerprint-sync-overview">
            <section className="fingerprint-job-summary fingerprint-sync-summary" aria-label="Sync job summary">
              {syncJobSummaryCards.map(({ label, value, detail, icon: Icon }) => (
                <article className="dashboard-summary-card fingerprint-job-summary-card" key={label}>
                  <div className="dashboard-summary-icon" aria-hidden="true">
                    <Icon size={22} strokeWidth={2.4} />
                  </div>
                  <div className="dashboard-summary-copy">
                    <span className="dashboard-summary-label">{label}</span>
                    <strong>{isLoadingSyncJobs ? '--' : value}</strong>
                    <small>{detail}</small>
                  </div>
                </article>
              ))}
            </section>
            <aside className="fingerprint-sync-note" aria-label="Sync queue note">
              <strong>Queue Control</strong>
              <span>Pending jobs can be cancelled before Sensor B claims them. Failed jobs stay available for retry.</span>
            </aside>
          </div>

          <div className="dashboard-recent-table-wrap fingerprint-jobs-wrap">
            {syncJobErrorMessage && (
              <p className="fingerprint-inline-message fingerprint-inline-message-error" role="alert">
                {syncJobErrorMessage}
              </p>
            )}

            <table className="dashboard-recent-table fingerprint-jobs-table fingerprint-sync-table">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Person</th>
                  <th>Template</th>
                  <th>Device</th>
                  <th>Status</th>
                  <th>Attempts</th>
                  <th>Timeline</th>
                  <th>Message</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoadingSyncJobs && (
                  <tr>
                    <td className="dashboard-recent-empty" colSpan={9}>
                      Loading sync jobs...
                    </td>
                  </tr>
                )}

                {!isLoadingSyncJobs && syncJobs.length === 0 && !syncJobErrorMessage && (
                  <tr>
                    <td className="dashboard-recent-empty" colSpan={9}>
                      No sync jobs found.
                    </td>
                  </tr>
                )}

                {!isLoadingSyncJobs &&
                  syncJobs.map((job) => (
                    <tr key={job.queue_id}>
                      <td className="fingerprint-job-identity">
                        <strong>Queue #{job.queue_id}</strong>
                        <span>Fingerprint #{job.fingerprint_id}</span>
                      </td>
                      <td className="fingerprint-job-user">
                        <strong>{job.user_name}</strong>
                        <span>{job.email || `User #${job.user_id}`}</span>
                      </td>
                      <td className="fingerprint-job-finger">
                        <strong>{job.finger_name || 'N/A'}</strong>
                        <span>Door slot {job.shared_door_slot ?? 'N/A'}</span>
                      </td>
                      <td className="fingerprint-job-step">
                        <strong>{job.device_name || 'Sensor B'}</strong>
                        <span>{job.device_code || `Device #${job.device_id}`}</span>
                      </td>
                      <td className="fingerprint-job-status-cell">
                        <span className={`dashboard-log-status dashboard-log-status-${job.status}`}>
                          {job.status === 'pending' ? 'Pending' : job.status}
                        </span>
                      </td>
                      <td className="fingerprint-job-updated">{job.attempts}</td>
                      <td className="fingerprint-job-timeline">
                        <span>Queued {formatJobTimestamp(job.queued_at)}</span>
                        <span>
                          {job.synced_at
                            ? `Synced ${formatJobTimestamp(job.synced_at)}`
                            : job.processing_at
                              ? `Claimed ${formatJobTimestamp(job.processing_at)}`
                              : 'Not claimed yet'}
                        </span>
                      </td>
                      <td className="fingerprint-job-step">
                        <span>{job.error_message || 'None'}</span>
                      </td>
                      <td className="fingerprint-sync-actions-cell">
                        {job.status === 'pending' || job.can_retry ? (
                          <RowActionMenu
                            label={`Actions for queue ${job.queue_id}`}
                            items={[
                              {
                                label: activeSyncActionId === `sync-job-${job.queue_id}` ? 'Working...' : 'Retry',
                                icon: RotateCcw,
                                hidden: !job.can_retry,
                                disabled: activeSyncActionId === `sync-job-${job.queue_id}`,
                                onClick: () => handleRetrySyncJob(job),
                              },
                              {
                                label: activeSyncActionId === `cancel-sync-job-${job.queue_id}` ? 'Cancelling...' : 'Cancel',
                                icon: X,
                                danger: true,
                                hidden: job.status !== 'pending',
                                disabled: activeSyncActionId === `cancel-sync-job-${job.queue_id}`,
                                onClick: () => handleCancelSyncJob(job),
                              },
                            ]}
                          />
                        ) : (
                          <span>{job.status === 'syncing' ? 'Processing on Sensor B' : 'No action'}</span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {selectedFingerprint && (
        <div className="fingerprint-modal-overlay" onClick={closeEnrollmentModal}>
          <section
            className="fingerprint-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`${
              selectedEnrollmentMode === 'add'
                ? 'Add fingerprint for'
                : selectedEnrollmentMode === 'update'
                ? 'Update fingerprint for'
                : 'Enroll fingerprint for'
            } ${selectedFingerprint.name}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="fingerprint-modal-header">
              <div>
                <h3>{enrollmentModalCopy.title}</h3>
                <p>{enrollmentModalCopy.subtitle}</p>
              </div>
              <button
                type="button"
                className="fingerprint-modal-close"
                onClick={closeEnrollmentModal}
                aria-label="Close dialog"
                disabled={activeActionId === selectedFingerprint.id}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="fingerprint-enrollment-profile-card">
              <div className="fingerprint-enrollment-profile-media">
                <div className="fingerprint-enrollment-avatar-shell">
                  {selectedFingerprintPhotoSrc ? (
                    <img
                      src={selectedFingerprintPhotoSrc}
                      alt={`${selectedFingerprint.name} profile`}
                      onError={() =>
                        setBrokenUserPhotoValue(String(selectedFingerprint.userPhoto || '__missing__'))
                      }
                    />
                  ) : (
                    <span>{selectedFingerprintInitials}</span>
                  )}
                </div>
              </div>

              <div className="fingerprint-enrollment-profile-copy">
                <div className="fingerprint-enrollment-profile-heading">
                  <div>
                    <h4>{selectedFingerprint.name}</h4>
                    <div className="fingerprint-enrollment-pill-row">
                      <span className="fingerprint-enrollment-pill">
                        <BriefcaseBusiness size={14} aria-hidden="true" />
                        {formatRoleLabel(selectedFingerprint.role)}
                      </span>
                      <span
                        className={`fingerprint-enrollment-pill fingerprint-enrollment-pill-status fingerprint-enrollment-pill-status-${selectedFingerprint.userStatus}`}
                      >
                        <ShieldCheck size={14} aria-hidden="true" />
                        {formatStatusLabel(selectedFingerprint.userStatus)}
                      </span>
                    </div>
                  </div>
                  <FingerprintIcon
                    className="fingerprint-enrollment-watermark"
                    size={64}
                    aria-hidden="true"
                  />
                </div>

                <div className="fingerprint-enrollment-detail-list">
                  <div className="fingerprint-enrollment-detail-row">
                    <span>
                      <IdCard size={15} aria-hidden="true" />
                      Employee ID
                    </span>
                    <strong>{selectedFingerprint.identifier}</strong>
                  </div>
                  <div className="fingerprint-enrollment-detail-row">
                    <span>
                      <FingerprintIcon size={15} aria-hidden="true" />
                      {enrollmentModalCopy.fingerLabel}
                    </span>
                    <strong>{selectedFingerName}</strong>
                  </div>
                  <div className="fingerprint-enrollment-detail-row">
                    <span>
                      <UserRound size={15} aria-hidden="true" />
                      User ID
                    </span>
                    <strong>{selectedFingerprint.userId}</strong>
                  </div>
                  <div className="fingerprint-enrollment-detail-row">
                    <span>
                      <ShieldCheck size={15} aria-hidden="true" />
                      Record Status
                    </span>
                    <strong>{formatStatusLabel(selectedFingerprint.status)}</strong>
                  </div>
                </div>
              </div>
            </div>

            <div className="fingerprint-modal-form-section fingerprint-enrollment-form-section">
              <label className="fingerprint-modal-field fingerprint-enrollment-select-card">
                <span>{enrollmentModalCopy.fingerLabel}</span>
                <div className="fingerprint-enrollment-select-shell" ref={fingerNameMenuRef}>
                  <button
                    type="button"
                    className={`fingerprint-enrollment-select-wrap ${isFingerNameMenuOpen ? 'is-open' : ''}`}
                    onClick={() => setIsFingerNameMenuOpen((currentValue) => !currentValue)}
                    disabled={activeActionId === selectedFingerprint.id}
                    aria-haspopup="listbox"
                    aria-expanded={isFingerNameMenuOpen}
                    aria-label={enrollmentModalCopy.fingerLabel}
                  >
                    <FingerprintIcon size={18} aria-hidden="true" />
                    <span className="fingerprint-enrollment-selected-text">{selectedFingerName}</span>
                    <ChevronDown size={18} aria-hidden="true" />
                  </button>

                  {isFingerNameMenuOpen && (
                    <div className="fingerprint-enrollment-option-list" role="listbox" aria-label="Finger name options">
                      {fingerNameOptions.map((fingerOption) => {
                        const isUnavailable =
                          fingerOption !== selectedFingerName && unavailableFingerNames.has(fingerOption);

                        return (
                          <button
                            type="button"
                            className={`fingerprint-enrollment-option ${fingerOption === selectedFingerName ? 'is-selected' : ''}`}
                            key={fingerOption}
                            onClick={() => {
                              if (isUnavailable) {
                                return;
                              }

                              setSelectedFingerName(fingerOption);
                              setIsFingerNameMenuOpen(false);
                            }}
                            disabled={isUnavailable}
                            role="option"
                            aria-selected={fingerOption === selectedFingerName}
                          >
                            <span className="fingerprint-enrollment-option-label">{fingerOption}</span>
                            <span className="fingerprint-enrollment-option-meta">
                              {fingerOption === selectedFingerName && <Check size={15} aria-hidden="true" />}
                              {isUnavailable && <small>Already used</small>}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </label>

              <div className="fingerprint-enrollment-safety-note">
                <CircleAlert size={18} aria-hidden="true" />
                <div>
                  <strong>Safer selection</strong>
                  <p>
                    {enrollmentModalCopy.helperText} {availableFingerCount} of {fingerNameOptions.length}{' '}
                    supported finger names remain available for this user.
                  </p>
                </div>
              </div>
            </div>

            {errorMessage && (
              <p className="fingerprint-inline-message fingerprint-inline-message-error" role="alert">
                {errorMessage}
              </p>
            )}

            <div className="fingerprint-modal-actions fingerprint-enrollment-modal-actions">
              <button
                type="button"
                className="fingerprint-primary-action fingerprint-enrollment-submit"
                onClick={handleEnrollmentAction}
                disabled={activeActionId === selectedFingerprint.id}
              >
                <FingerprintIcon size={15} aria-hidden="true" />
                {activeActionId === selectedFingerprint.id
                  ? 'Starting...'
                  : enrollmentModalCopy.actionLabel}
              </button>
            </div>
          </section>
        </div>
      )}

      {trackedEnrollmentProgress && trackedEnrollmentDisplayJob && (
        <div className="fingerprint-modal-overlay" onClick={closeEnrollmentProgressModal}>
          <section
            className="fingerprint-modal fingerprint-progress-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Enrollment progress for ${trackedEnrollmentDisplayJob.user_name}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="fingerprint-modal-header fingerprint-progress-modal-header">
              <div className="fingerprint-progress-title-wrap">
                <div className="fingerprint-progress-brand-mark" aria-hidden="true">
                  <img src={entrivoLogo} alt="" />
                </div>
                <div className="fingerprint-progress-header-copy">
                  <h3>Fingerprint Enrollment</h3>
                  <p>Enroll and manage fingerprints for secure access</p>
                </div>
              </div>
              <div className="fingerprint-progress-header-actions">
                <div className="fingerprint-progress-device-pill">
                  <span aria-hidden="true" />
                  <strong>Device: ESP32 (R307S)</strong>
                  <em>{formatStatusLabel(trackedEnrollmentDisplayJob.status)}</em>
                </div>
                <button
                  type="button"
                  className="fingerprint-modal-close"
                  onClick={closeEnrollmentProgressModal}
                  aria-label="Close dialog"
                  disabled={activeJobActionId === trackedEnrollmentDisplayJob.job_id}
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="fingerprint-live-spotlight-body fingerprint-progress-modal-body">
              <aside className="fingerprint-progress-user-panel" aria-label="Enrollment user information">
                <span className="fingerprint-progress-section-label">
                  <UserRound size={14} aria-hidden="true" />
                  User Information
                </span>
                <div className="fingerprint-progress-profile">
                  <div className="fingerprint-progress-profile-photo">
                    {trackedEnrollmentPhotoSrc ? (
                      <img src={trackedEnrollmentPhotoSrc} alt={`${trackedEnrollmentDisplayJob.user_name} profile`} />
                    ) : (
                      <span>{trackedEnrollmentInitials}</span>
                    )}
                  </div>
                  <strong>{trackedEnrollmentDisplayJob.user_name}</strong>
                  <span>
                    {trackedEnrollmentFingerprint?.identifier || `User #${trackedEnrollmentDisplayJob.user_id || 'N/A'}`}
                  </span>
                </div>
                <div className="fingerprint-progress-info-list">
                  <div>
                    <BriefcaseBusiness size={14} aria-hidden="true" />
                    <span>Role</span>
                    <strong>{formatRoleLabel(trackedEnrollmentFingerprint?.role)}</strong>
                  </div>
                  <div>
                    <IdCard size={14} aria-hidden="true" />
                    <span>Finger to Enroll</span>
                    <strong>{trackedEnrollmentDisplayJob.finger_name}</strong>
                  </div>
                  <div>
                    <FingerprintIcon size={14} aria-hidden="true" />
                    <span>Device/Slot</span>
                    <strong>
                      Device {trackedEnrollmentDisplayJob.enrollment_device_id ?? trackedEnrollmentProgress.deviceId ?? 'N/A'} / Slot{' '}
                      {trackedEnrollmentDisplayJob.assigned_slot ??
                        trackedEnrollmentFingerprint?.sharedDoorSlot ??
                        trackedEnrollmentFingerprint?.enrollmentSlot ??
                        'Pending'}
                    </strong>
                  </div>
                  <div>
                    <Clock size={14} aria-hidden="true" />
                    <span>Last Updated</span>
                    <strong>{formatJobTimestamp(trackedEnrollmentDisplayJob.updated_at)}</strong>
                  </div>
                </div>
              </aside>

              <div className="fingerprint-progress-workspace">
                <section className="fingerprint-progress-section-card">
                  <div className="fingerprint-progress-content-heading">
                    <span>Enrollment Progress</span>
                  </div>

                  <div className="fingerprint-progress-stepper" aria-label="Detailed enrollment status progress">
                    {enrollmentProgressStages.map((stage, stageIndex) => {
                      const StageIcon = stage.icon;
                      const isComplete = stageIndex < trackedEnrollmentStageIndex;
                      const isCurrent = stageIndex === trackedEnrollmentStageIndex;
                      const stageState = isComplete ? 'complete' : isCurrent ? 'current' : 'pending';

                      return (
                        <div
                          className={`fingerprint-progress-step fingerprint-progress-step-${stageState}`}
                          key={stage.key}
                        >
                          <div className="fingerprint-progress-step-marker">
                            <span>{stageIndex + 1}</span>
                          </div>
                          <div className="fingerprint-progress-step-icon" aria-hidden="true">
                            {isComplete ? <Check size={14} /> : <StageIcon size={14} />}
                          </div>
                          <div className="fingerprint-progress-step-copy">
                            <strong>{stage.label}</strong>
                            <span>{stage.detail}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                <div className="fingerprint-progress-scan-grid">
                  <div className={`fingerprint-progress-scan-card fingerprint-progress-scan-card-${trackedEnrollmentInstructionTone}`}>
                    <span className="fingerprint-progress-card-label">
                      <Activity size={14} aria-hidden="true" />
                      Real-Time Status
                    </span>
                    <div className="fingerprint-progress-print" aria-hidden="true">
                      {trackedEnrollmentFingerprintImageSrc ? (
                        <img
                          src={trackedEnrollmentFingerprintImageSrc}
                          alt=""
                          className="fingerprint-progress-print-image"
                        />
                      ) : (
                        <RealisticFingerprintMark />
                      )}
                    </div>
                    <span className="fingerprint-progress-quality">
                      <CheckCircle2 size={16} aria-hidden="true" />
                      {trackedEnrollmentInstruction}
                    </span>
                    <p className="fingerprint-progress-card-note">{trackedEnrollmentInstructionHint}</p>
                    <div className="fingerprint-progress-scan-footer">
                      <div className="fingerprint-progress-guide-meta">
                        <span>{Math.max(0, Math.min(100, trackedEnrollmentDisplayJob.progress || 0))}% Complete</span>
                        <span>Step {trackedEnrollmentStageIndex + 1} of {enrollmentProgressStages.length}</span>
                      </div>
                      <div className="fingerprint-live-progress">
                        <div
                          className="fingerprint-live-progress-bar"
                          style={{
                            width: `${Math.max(0, Math.min(100, trackedEnrollmentDisplayJob.progress || 0))}%`,
                          }}
                        />
                      </div>
                      <div className="fingerprint-progress-inline-tip">
                        <ShieldCheck size={15} aria-hidden="true" />
                        <strong>Tip</strong>
                        <span>Ensure the finger is clean and dry for better recognition.</span>
                      </div>
                    </div>
                  </div>

                </div>

                <div className="fingerprint-progress-footer-note">
                  <CircleAlert size={18} aria-hidden="true" />
                  <div>
                    <strong>About R307S Sensor</strong>
                    <span>
                      The R307S is an optical fingerprint sensor with high accuracy and fast recognition. Ensure
                      proper finger placement for best results.
                    </span>
                  </div>
                  <small><FingerprintIcon size={15} aria-hidden="true" /> High Accuracy</small>
                  <small><Clock size={15} aria-hidden="true" /> Fast Recognition</small>
                  <small><ShieldCheck size={15} aria-hidden="true" /> Secure Template Storage</small>
                </div>
              </div>
            </div>

            {(trackedEnrollmentDisplayJob.can_retry && !isCompletedEnrollmentJob(trackedEnrollmentDisplayJob)) ||
            trackedEnrollmentDisplayJob.can_cancel ? (
              <div className="fingerprint-modal-actions fingerprint-progress-modal-actions">
                {trackedEnrollmentDisplayJob.can_retry &&
                  !isCompletedEnrollmentJob(trackedEnrollmentDisplayJob) && (
                <button
                  type="button"
                  className="fingerprint-secondary-action"
                  onClick={() => handleRetryJob(trackedEnrollmentDisplayJob)}
                  disabled={activeJobActionId === trackedEnrollmentDisplayJob.job_id}
                >
                  <RotateCcw size={14} aria-hidden="true" />
                  {activeJobActionId === trackedEnrollmentDisplayJob.job_id ? 'Working...' : 'Retry'}
                </button>
              )}
              {trackedEnrollmentDisplayJob.can_cancel && (
                <button
                  type="button"
                  className="fingerprint-secondary-action fingerprint-danger-action"
                  onClick={() => handleCancelJob(trackedEnrollmentDisplayJob)}
                  disabled={activeJobActionId === trackedEnrollmentDisplayJob.job_id}
                >
                  <Ban size={14} aria-hidden="true" />
                  {activeJobActionId === trackedEnrollmentDisplayJob.job_id ? 'Working...' : 'Cancel'}
                </button>
                )}
              </div>
            ) : null}
          </section>
        </div>
      )}

      {selectedTemplateFingerprint && (
        <div className="fingerprint-modal-overlay" onClick={closeTemplateUploadModal}>
          <section
            className="fingerprint-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Upload template for ${selectedTemplateFingerprint.name}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="fingerprint-modal-header">
              <div>
                <h3>Upload Raw Template</h3>
                <p>
                  Paste a base64 template or load an exported JSON template file for{' '}
                  {selectedTemplateFingerprint.name}.
                </p>
              </div>
              <button
                type="button"
                className="fingerprint-modal-close"
                onClick={closeTemplateUploadModal}
                aria-label="Close dialog"
                disabled={
                  activeTemplateActionId === `upload-${selectedTemplateFingerprint.id}` ||
                  prefillingTemplateId === selectedTemplateFingerprint.id
                }
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="fingerprint-modal-grid">
              <div className="fingerprint-modal-item">
                <span>User</span>
                <strong>{selectedTemplateFingerprint.name}</strong>
              </div>
              <div className="fingerprint-modal-item">
                <span>Finger</span>
                <strong>{selectedTemplateFingerName}</strong>
              </div>
              <div className="fingerprint-modal-item">
                <span>Current Slot</span>
                <strong>{selectedTemplateFingerprint.sharedDoorSlot || selectedTemplateFingerprint.enrollmentSlot || 'Not assigned'}</strong>
              </div>
              <div className="fingerprint-modal-item">
                <span>Template Status</span>
                <strong>
                  {selectedTemplateFingerprint.hasTemplateData
                    ? `Stored (${formatTemplateBytes(selectedTemplateFingerprint.templateBytes)})`
                    : 'No raw template stored yet'}
                </strong>
              </div>
            </div>

            <label className="fingerprint-template-file-input">
              <span>Load exported template file</span>
              <input
                type="file"
                accept=".json,.txt"
                onChange={handleTemplateFileChange}
                disabled={prefillingTemplateId === selectedTemplateFingerprint.id}
              />
            </label>

            <label className="fingerprint-template-textarea">
              <span>Base64 or exported JSON payload</span>
              <textarea
                value={templateImportValue}
                onChange={(event) => setTemplateImportValue(event.target.value)}
                placeholder="Paste the template_data_base64 value or the full exported JSON payload here."
                rows={10}
                disabled={prefillingTemplateId === selectedTemplateFingerprint.id}
              />
            </label>

            {templateErrorMessage && (
              <p className="fingerprint-inline-message fingerprint-inline-message-error" role="alert">
                {templateErrorMessage}
              </p>
            )}

            <div className="fingerprint-modal-actions">
              <button
                type="button"
                className="fingerprint-secondary-action"
                onClick={closeTemplateUploadModal}
                disabled={
                  activeTemplateActionId === `upload-${selectedTemplateFingerprint.id}` ||
                  prefillingTemplateId === selectedTemplateFingerprint.id
                }
              >
                Cancel
              </button>
              <button
                type="button"
                className="fingerprint-primary-action"
                onClick={handleUploadTemplate}
                disabled={
                  activeTemplateActionId === `upload-${selectedTemplateFingerprint.id}` ||
                  prefillingTemplateId === selectedTemplateFingerprint.id
                }
              >
                <Upload size={15} aria-hidden="true" />
                {prefillingTemplateId === selectedTemplateFingerprint.id
                  ? 'Loading...'
                  : activeTemplateActionId === `upload-${selectedTemplateFingerprint.id}`
                  ? 'Uploading...'
                  : 'Store Template'}
              </button>
            </div>
          </section>
        </div>
      )}

      {syncPromptFingerprint && (
        <div
          className="fingerprint-modal-overlay"
          onClick={() => setSyncPromptFingerprint(null)}
        >
          <section
            className="fingerprint-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Sync fingerprint for ${syncPromptFingerprint.name} to Sensor B`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="fingerprint-modal-header">
              <div>
                <h3>Sync to Sensor B?</h3>
                <p>
                  The raw fingerprint template has been stored successfully. Do you want to sync it
                  to Sensor B (Door Controller) now?
                </p>
              </div>
              <button
                type="button"
                className="fingerprint-modal-close"
                onClick={() => setSyncPromptFingerprint(null)}
                aria-label="Close dialog"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="fingerprint-modal-grid">
              <div className="fingerprint-modal-item">
                <span>User</span>
                <strong>{syncPromptFingerprint.name}</strong>
              </div>
              <div className="fingerprint-modal-item">
                <span>Finger</span>
                <strong>{syncPromptFingerprint.fingerName || 'N/A'}</strong>
              </div>
            </div>

            <div className="fingerprint-modal-actions">
              <button
                type="button"
                className="fingerprint-secondary-action"
                onClick={() => {
                  setSyncPromptFingerprint(null);
                }}
              >
                Skip for now
              </button>
              <button
                type="button"
                className="fingerprint-primary-action"
                onClick={() => {
                  const fingerprintToSync = syncPromptFingerprint;
                  setSyncPromptFingerprint(null);
                  handleQueueTemplateSync(fingerprintToSync, { showStatusModal: true });
                }}
                disabled={activeSyncActionId === syncPromptFingerprint.id}
              >
                {activeSyncActionId === syncPromptFingerprint.id ? 'Queueing...' : 'Sync now'}
              </button>
            </div>
          </section>
        </div>
      )}

      {syncStatusFingerprint && (
        <div
          className="fingerprint-modal-overlay"
          onClick={() => {
            setSyncStatusFingerprint(null);
            setTrackedSyncJobId(null);
          }}
        >
          <section
            className="fingerprint-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Syncing status for ${syncStatusFingerprint.name}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="fingerprint-modal-header">
              <div>
                <h3>Sensor B Sync</h3>
                <p>
                  {syncStatusMessage.toLowerCase().includes('unable')
                    ? 'Sensor B sync could not be queued. Review the message below and try again.'
                    : 'This modal follows the Sensor B queue in real time while the door controller picks up and writes the template.'}
                </p>
              </div>
              <button
                type="button"
                className="fingerprint-modal-close"
                onClick={() => {
                  setSyncStatusFingerprint(null);
                  setTrackedSyncJobId(null);
                }}
                aria-label="Close dialog"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="fingerprint-modal-grid">
              <div className="fingerprint-modal-item">
                <span>User</span>
                <strong>{syncStatusFingerprint.name}</strong>
              </div>
              <div className="fingerprint-modal-item">
                <span>Finger</span>
                <strong>{syncStatusFingerprint.fingerName || 'N/A'}</strong>
              </div>
            </div>

            <div className="fingerprint-modal-form-section fingerprint-sync-progress-panel">
              <div className="fingerprint-sync-progress-header">
                <span>{activeSyncStatusLabel}</span>
                <strong>
                  {activeSyncStatusJob?.queue_id
                    ? `Queue #${activeSyncStatusJob.queue_id}`
                    : 'Queue pending'}
                </strong>
              </div>

              <div
                className={`fingerprint-live-progress fingerprint-sync-progress-${normalizeJobText(activeSyncStatusJob?.status) || 'pending'}`}
                aria-label={`Sensor B sync progress ${activeSyncProgress}%`}
              >
                <div className="fingerprint-live-progress-bar" style={{ width: `${activeSyncProgress}%` }} />
              </div>

              <div className="fingerprint-sync-stepper" aria-label="Sensor B sync status steps">
                {syncProgressStages.map((stage, stageIndex) => {
                  const StageIcon = stage.icon;
                  const isFailed = normalizeJobText(activeSyncStatusJob?.status) === 'failed';
                  const isComplete = !isFailed && stageIndex < activeSyncStageIndex;
                  const isCurrent = !isFailed && stageIndex === activeSyncStageIndex;
                  const stageState = isComplete ? 'complete' : isCurrent ? 'current' : 'pending';

                  return (
                    <div
                      className={`fingerprint-sync-step fingerprint-sync-step-${stageState}`}
                      key={stage.key}
                    >
                      <div className="fingerprint-sync-step-marker">
                        {isComplete ? <Check size={14} aria-hidden="true" /> : <StageIcon size={14} aria-hidden="true" />}
                      </div>
                      <div>
                        <strong>{stage.label}</strong>
                        <span>{stage.detail}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="fingerprint-sync-live-detail">
                {normalizeJobText(activeSyncStatusJob?.status) === 'failed' ? (
                  <CircleAlert size={18} aria-hidden="true" />
                ) : normalizeJobText(activeSyncStatusJob?.status) === 'synced' ? (
                  <CheckCircle2 size={18} aria-hidden="true" />
                ) : (
                  <Activity size={18} aria-hidden="true" />
                )}
                <p>{activeSyncStatusDetail}</p>
              </div>
            </div>

            <div className="fingerprint-modal-actions">
              <button
                type="button"
                className="fingerprint-secondary-action"
                onClick={() => {
                  setSyncStatusFingerprint(null);
                  setTrackedSyncJobId(null);
                }}
              >
                Close
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
    {viewFingerprint
      ? createPortal(
          <div
            className="pending-registration-review-backdrop"
            role="presentation"
            onClick={closeFingerprintView}
          >
            <section
              className="pending-registration-review"
              role="dialog"
              aria-modal="true"
              aria-labelledby="fingerprint-view-title"
              onClick={(event) => event.stopPropagation()}
            >
              <header>
                <div>
                  <h2 id="fingerprint-view-title">View Fingerprint</h2>
                  <p>Review this fingerprint record and sync details.</p>
                </div>
                <button type="button" aria-label="Close fingerprint view" onClick={closeFingerprintView}>
                  <X size={16} aria-hidden="true" />
                </button>
              </header>

              <div className="pending-registration-review-body">
                <div className="pending-registration-review-identity">
                  <div className="pending-registration-review-photo">
                    {viewFingerprintPhotoSrc ? (
                      <>
                        <img src={viewFingerprintPhotoSrc} alt={`${viewFingerprint.name} photo`} />
                        <button
                          type="button"
                          className="pending-registration-photo-expand"
                          aria-label="Expand photo"
                          onClick={() => setIsViewPhotoExpanded(true)}
                        >
                          <Expand size={14} aria-hidden="true" />
                        </button>
                      </>
                    ) : (
                      <p className="pending-registration-review-photo-empty">No photo</p>
                    )}
                  </div>
                  {viewFingerprintGroups[0] ? (
                    <section className="pending-registration-review-card">
                      <h3>{viewFingerprintGroups[0].title}</h3>
                      <dl>
                        {viewFingerprintGroups[0].fields.map(([label, value, isWide]) => (
                          <div key={label} className={isWide ? 'is-wide' : undefined}>
                            <dt>{label}</dt>
                            <dd>{value || '—'}</dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  ) : null}
                </div>
                {viewFingerprintGroups.slice(1).map((group) => (
                  <section className="pending-registration-review-card" key={group.title}>
                    <h3>{group.title}</h3>
                    <dl>
                      {group.fields.map(([label, value, isWide]) => (
                        <div key={label} className={isWide ? 'is-wide' : undefined}>
                          <dt>{label}</dt>
                          <dd>{value || '—'}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ))}
              </div>

              <footer>
                <button type="button" className="pending-registration-reject" onClick={closeFingerprintView}>
                  Close
                </button>
              </footer>
            </section>
          </div>,
          document.body,
        )
      : null}
    {isViewPhotoExpanded && viewFingerprintPhotoSrc
      ? createPortal(
          <div
            className="pending-registration-photo-lightbox"
            role="presentation"
            onClick={() => setIsViewPhotoExpanded(false)}
          >
            <button
              type="button"
              aria-label="Close expanded photo"
              onClick={() => setIsViewPhotoExpanded(false)}
            >
              <X size={16} aria-hidden="true" />
            </button>
            <img
              src={viewFingerprintPhotoSrc}
              alt={`${viewFingerprint?.name || 'User'} photo`}
              onClick={(event) => event.stopPropagation()}
            />
          </div>,
          document.body,
        )
      : null}
    </>
  );
}
