import { cloneElement, isValidElement, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Ban,
  Check,
  ChevronDown,
  Download,
  Expand,
  Eye,
  EyeOff,
  GraduationCap,
  KeyRound,
  Pencil,
  Search,
  Shield,
  Trash2,
  Unlock,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import axiosClient from '../../api/axiosClient';
import { useActionConfirm } from '../../components/ActionConfirm';
import ErrorNoticeModal from '../../components/ErrorNoticeModal';
import ExportFormatModal from '../../components/ExportFormatModal';
import RowActionMenu from '../../components/RowActionMenu';
import TableEmptyState from '../../components/TableEmptyState';
import RegisterUser from './RegisterUser';
import { getManilaDateStamp } from '../../utils/dateTime';
import { buildExportNote, exportTable } from '../../utils/exportFiles';
import DeleteRequestModal from '../../components/DeleteRequestModal';
import DeleteRequestToast from '../../components/DeleteRequestToast';
import { ROLE_PRIVILEGE_DEFAULTS, canDeleteRecords, userHasPrivilege } from '../../utils/privileges';
import { normalizeIssuedId, schoolEmailDomain, suffixOptions } from '../../utils/schoolProfileOptions';
import '../../styles/superAdmin/dashboard.css';
import '../../styles/superAdmin/users.css';
import '../../styles/superAdmin/rfid.css';

function getPasswordRuleChecks(password) {
  return {
    length: password.length >= 8,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    number: /\d/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  };
}

function getPasswordStrengthError(password) {
  if (!password) {
    return 'New password is required.';
  }

  if (password.length > 72) {
    return 'Password must be 72 characters or fewer.';
  }

  const checks = getPasswordRuleChecks(password);

  if (!checks.length) {
    return 'Password must be at least 8 characters.';
  }

  if (!checks.upper) {
    return 'Password must include an uppercase letter.';
  }

  if (!checks.lower) {
    return 'Password must include a lowercase letter.';
  }

  if (!checks.number) {
    return 'Password must include a number.';
  }

  if (!checks.special) {
    return 'Password must include a special character.';
  }

  return '';
}

const emptyPasswordFieldErrors = {
  newPassword: '',
  confirmPassword: '',
};

const employeeColumns = [
  'User',
  'Employee ID',
  'Department',
  'Position',
  'Role',
  'Status',
  'Access Setup',
  'Action',
];

const userTabs = [
  {
    key: 'faculty',
    label: 'Faculty Users',
    emptyLabel: 'faculty users',
    identifierLabel: 'Employee ID',
    columns: employeeColumns,
  },
  {
    key: 'staff',
    label: 'Staff',
    emptyLabel: 'staff users',
    identifierLabel: 'Employee ID',
    columns: employeeColumns,
  },
  {
    key: 'admins',
    label: 'Admin',
    emptyLabel: 'admin users',
    identifierLabel: 'Employee ID',
    columns: employeeColumns,
    roleMatch: 'admin',
  },
  {
    key: 'super_admins',
    label: 'Super Admin',
    emptyLabel: 'super admin users',
    identifierLabel: 'Employee ID',
    columns: employeeColumns,
    roleMatch: 'super_admin',
  },
  {
    key: 'students',
    label: 'Student',
    emptyLabel: 'student users',
    identifierLabel: 'School ID',
    columns: ['User', 'School ID', 'Program', 'Year / Section', 'Role', 'Status', 'Access Setup', 'Action'],
  },
];

const allUsersFilter = {
  key: 'all',
  label: 'All Accounts',
  emptyLabel: 'users',
  identifierLabel: 'ID',
  columns: [
    'User',
    'ID',
    'Department / Program',
    'Position / Year',
    'Role',
    'Status',
    'Access Setup',
    'Action',
  ],
};

const roleFilterOptions = [allUsersFilter, ...userTabs];

const initialUsers = {
  faculty: [],
  staff: [],
  admins: [],
  students: [],
};

function omitSuperAdminUsers(usersByRole) {
  return {
    ...usersByRole,
    admins: (usersByRole.admins || []).filter((user) => user.role !== 'super_admin'),
  };
}

function getUsersForRoleFilter(filterKey, usersByRole) {
  if (filterKey === 'all') {
    return [
      ...(usersByRole.faculty || []),
      ...(usersByRole.staff || []),
      ...(usersByRole.admins || []),
      ...(usersByRole.students || []),
    ];
  }

  if (filterKey === 'admins') {
    return (usersByRole.admins || []).filter((user) => user.role === 'admin');
  }

  if (filterKey === 'super_admins') {
    return (usersByRole.admins || []).filter((user) => user.role === 'super_admin');
  }

  return usersByRole[filterKey] || [];
}

function formatAccessSetup(user, { isStudent = false } = {}) {
  const rfidLabel = user.rfidStatus === 'unassigned' ? 'No RFID' : `${user.rfidStatus} RFID`;

  if (isStudent) {
    return {
      rfid: rfidLabel,
      fingerprint: null,
      primary: rfidLabel,
      secondary: null,
    };
  }

  const fingerprintLabel =
    user.fingerprintCount > 0
      ? `${user.fingerprintCount} fingerprint${user.fingerprintCount > 1 ? 's' : ''}`
      : 'No fingerprint';

  return {
    rfid: rfidLabel,
    fingerprint: fingerprintLabel,
    primary: fingerprintLabel,
    secondary: rfidLabel,
  };
}

function formatRoleLabel(role) {
  const normalized = String(role || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');

  const labels = {
    faculty: 'Faculty',
    staff: 'Staff',
    admin: 'Admin',
    super_admin: 'Super Admin',
    student: 'Student',
  };

  if (labels[normalized]) {
    return labels[normalized];
  }

  return normalized
    ? normalized.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
    : 'Unknown';
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

  if (status === 'pending_login') {
    return 'Pending login';
  }

  return status || 'Unknown';
}

function isBlockedStatus(status) {
  return status === 'blocked';
}

const statusFilterOptions = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'pending_login', label: 'Pending login' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'blocked', label: 'Blocked' },
];

function filterUsersByStatus(users, statusFilter) {
  if (statusFilter === 'all') {
    return users;
  }

  return users.filter((user) => user.status === statusFilter);
}

function countOccupiedSuperAdminSlots(usersByRole, excludeUserId = null) {
  const admins = usersByRole?.admins || [];

  return admins.filter((user) => {
    if (user.role !== 'super_admin') {
      return false;
    }

    if (excludeUserId != null && Number(user.id) === Number(excludeUserId)) {
      return false;
    }

    // Active and inactive (standby) both occupy a Super Admin slot; blocked does not.
    return !isBlockedStatus(user.status);
  }).length;
}

const collegeProgramOptions = [
  {
    college: '(CEIT) College of Engineering and Information Technology',
    programs: [
      '(BSIT) Bachelor of Science in Information Technology',
      '(BSEE) Bachelor of Science in Electrical Engineering',
      '(BSCpE) Bachelor of Science in Computer Engineering',
    ],
  },
  {
    college: '(CTHM) College of Tourism and Hospitality Management',
    programs: [
      '(BSHM) Bachelor of Science in Hospitality Management',
      '(BSTM) Bachelor of Science in Tourism Management',
    ],
  },
  {
    college: '(CITTE) College of Industrial and Technical Teacher Education',
    programs: [
      '(BSIndTech) - Architectural Drafting Technology',
      '(BSIndTech) - Automotive Technology',
      '(BSIndTech) - Civil Technology',
      '(BSIndTech) - (BSIndTech)',
      '(BSIndTech) - Electronics Technology',
      '(BTVTED) Bachelor of Technical Vocational Teacher Education',
    ],
  },
  {
    college: '(CBA) College of Business and Accountancy',
    programs: [
      '(BSA) Bachelor of Science in Accountancy',
      '(BSMA) Bachelor of Science in Management Accounting',
      '(BSOA) Bachelor of Science in Office Administration',
      '(BSBA) Bachelor of Science in Business Administration',
      '(BSEntrep) Bachelor of Science in Entrepreneurship',
    ],
  },
];
const collegeOptions = collegeProgramOptions.map(({ college }) => college);
const yearLevelOptions = ['First Year', 'Second Year', 'Third Year', 'Fourth Year'];
const sectionOptions = ['Block A', 'Block B', 'Block C', 'Block D'];

function getProgramOptions(college) {
  return collegeProgramOptions.find((option) => option.college === college)?.programs || [];
}

function calculateAge(dateOfBirth) {
  if (!dateOfBirth) {
    return '';
  }

  const birthDate = new Date(`${dateOfBirth}T00:00:00`);

  if (Number.isNaN(birthDate.getTime())) {
    return '';
  }

  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age -= 1;
  }

  return age >= 0 ? String(age) : '';
}

function cleanDisplayValue(value, emptyLabels = ['Not provided', 'Not assigned', 'No section', 'No college set']) {
  const text = value == null ? '' : String(value).trim();

  if (!text || emptyLabels.includes(text)) {
    return '';
  }

  return text;
}

function buildEditForm(user) {
  const isStudent = Boolean(user.isStudent || user.role === 'student');

  return {
    id: user.id,
    isStudent,
    identifierLabel: user.identifierLabel || (isStudent ? 'School ID' : 'Employee ID'),
    photo: user.photo || '',
    firstName: cleanDisplayValue(user.firstName),
    middleName: cleanDisplayValue(user.middleName),
    lastName: cleanDisplayValue(user.lastName),
    extensionName: cleanDisplayValue(user.extensionName),
    sex: cleanDisplayValue(user.sex),
    dateOfBirth: cleanDisplayValue(user.dateOfBirth),
    age: cleanDisplayValue(user.age) || calculateAge(user.dateOfBirth),
    contactNumber: cleanDisplayValue(user.contactNumber),
    streetAddress: cleanDisplayValue(user.streetAddress),
    barangay: cleanDisplayValue(user.barangay),
    cityMunicipality: cleanDisplayValue(user.cityMunicipality),
    province: cleanDisplayValue(user.province),
    username: cleanDisplayValue(user.username),
    email: cleanDisplayValue(user.email),
    identifier: cleanDisplayValue(user.identifier),
    status: isBlockedStatus(user.status)
      ? 'blocked'
      : user.status === 'inactive'
        ? 'inactive'
        : user.status === 'pending_login'
          ? 'pending_login'
          : 'active',
    college: cleanDisplayValue(user.college),
    yearLevel: cleanDisplayValue(user.yearLevel),
    program: cleanDisplayValue(user.program || user.programDepartment),
    section: cleanDisplayValue(user.section, ['Not provided', 'Not assigned', 'No section']),
    officeDepartment: cleanDisplayValue(user.officeDepartment),
    workPosition: cleanDisplayValue(user.workPosition),
    rfidUid: cleanDisplayValue(user.rfidUid),
    fingerprintCount: user.fingerprintCount || 0,
    joinedAt: cleanDisplayValue(user.joinedAt),
  };
}

function editServerFieldErrors(message) {
  const text = String(message || '');
  const lower = text.toLowerCase();
  const errors = {};

  if (lower.includes('college, program, and year level')) {
    errors.college = 'College is required.';
    errors.program = 'Program is required.';
    errors.yearLevel = 'Year level is required.';
    return errors;
  }

  if (lower.includes('department and position')) {
    errors.officeDepartment = 'Department is required.';
    errors.workPosition = 'Position is required.';
    return errors;
  }

  if (lower.includes('first name and last name')) {
    errors.firstName = 'First name is required.';
    errors.lastName = 'Last name is required.';
    return errors;
  }

  const field = [
    ['username', 'username'],
    ['email', 'email'],
    ['school id', 'identifier'],
    ['employee id', 'identifier'],
    ['rfid', 'rfidUid'],
    ['first name', 'firstName'],
    ['middle name', 'middleName'],
    ['last name', 'lastName'],
    ['extension', 'extensionName'],
    ['sex', 'sex'],
    ['date of birth', 'dateOfBirth'],
    ['contact', 'contactNumber'],
    ['street', 'streetAddress'],
    ['barangay', 'barangay'],
    ['city', 'cityMunicipality'],
    ['province', 'province'],
    ['college', 'college'],
    ['program', 'program'],
    ['year level', 'yearLevel'],
    ['section', 'section'],
    ['department', 'officeDepartment'],
    ['position', 'workPosition'],
    ['status', 'status'],
  ].find(([needle]) => lower.includes(needle));

  if (field) errors[field[1]] = text;

  return errors;
}

function EditField({ label, wide = false, error = '', children }) {
  const control = error && isValidElement(children)
    ? cloneElement(children, { 'aria-invalid': true })
    : children;

  return (
    <div className={wide ? 'is-wide manage-users-edit-field' : 'manage-users-edit-field'}>
      <dt>{label}</dt>
      <dd>
        {control}
        {error ? <p className="manage-users-edit-field-error" role="alert">{error}</p> : null}
      </dd>
    </div>
  );
}

function editPersonNameError(value, label, required = true) {
  const name = String(value || '').trim();

  if (!name) {
    return required ? `${label} is required.` : '';
  }

  if (name.length < 2 || name.length > 50) return `${label} must be 2 to 50 characters.`;
  if (/\p{N}/u.test(name)) return `${label} cannot contain numbers.`;
  if (/[^A-Za-zÑñ -]/.test(name)) return `${label} can only include letters, Ñ, spaces, and hyphens.`;
  if (!/^[A-ZÑ]/.test(name)) return `${label} must start with a capital letter.`;
  if (!/^[A-ZÑ][A-Za-zÑñ]*(?:[ -][A-Za-zÑñ]+)*$/.test(name)) {
    return `${label} cannot start or end with a hyphen, or repeat spaces and hyphens.`;
  }

  return '';
}

function editUsernameError(value) {
  const username = String(value || '').trim();

  if (!username) return 'Username is required.';
  if (username !== username.toLowerCase()) return 'Username must be all lowercase.';
  if (/\p{N}/u.test(username)) return 'Username cannot contain numbers.';
  if (!/^[a-z.]+$/.test(username)) return 'Username can only use lowercase letters and a dot.';
  if (!username.includes('.')) return 'Username must include a dot (.).';
  if (!/^[a-z]+(?:\.[a-z]+)+$/.test(username) || username.length > 50) {
    return 'Use lowercase letters separated by a dot, such as firstname.lastname.';
  }

  return '';
}

function editRequiredTextError(value, label, maxLength) {
  const text = String(value || '').trim();

  if (!text) return `${label} is required.`;
  if (text.length > maxLength) return `${label} must be ${maxLength} characters or fewer.`;

  return '';
}

function validateEditForm(form) {
  const errors = {};
  const assign = (field, message) => {
    if (message) errors[field] = message;
  };

  assign('firstName', editPersonNameError(form.firstName, 'First name'));
  assign('middleName', editPersonNameError(form.middleName, 'Middle name', false));
  assign('lastName', editPersonNameError(form.lastName, 'Last name'));

  const extension = String(form.extensionName || '').trim();
  if (extension && !suffixOptions.includes(extension)) {
    errors.extensionName = 'Extension must be Jr., Sr., II, III, IV, or V.';
  }

  if (!form.sex) errors.sex = 'Sex is required.';

  if (!form.dateOfBirth) {
    errors.dateOfBirth = 'Date of birth is required.';
  } else {
    const birthDate = new Date(`${form.dateOfBirth}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (Number.isNaN(birthDate.getTime()) || birthDate > today) {
      errors.dateOfBirth = 'Date of birth must be a valid past date.';
    }
  }

  if (!/^\d{11}$/.test(String(form.contactNumber || ''))) {
    errors.contactNumber = 'Contact number must be 11 digits.';
  }

  assign('username', editUsernameError(form.username));

  const email = String(form.email || '').trim().toLowerCase();
  const emailSuffix = `@${schoolEmailDomain}`;
  if (!email) {
    errors.email = 'School email is required.';
  } else if (!email.endsWith(emailSuffix)) {
    errors.email = `Email must use the ${emailSuffix} domain.`;
  } else if (!/^[a-z][a-z0-9._-]{2,49}$/.test(email.slice(0, -emailSuffix.length))) {
    errors.email = 'Use 3 to 50 characters, starting with a letter. Letters, numbers, dots, underscores, and hyphens only.';
  }

  const identifier = String(form.identifier || '').trim();
  const identifierPattern = form.isStudent ? /^\d{4}-\d{4}$/ : /^\d{6}-\d{6}$/;
  const identifierFormat = form.isStudent ? 'xxxx-xxxx' : 'xxxxxx-xxxxxx';
  if (!identifier) {
    errors.identifier = `${form.identifierLabel || 'ID'} is required.`;
  } else if (!identifierPattern.test(identifier)) {
    errors.identifier = `${form.identifierLabel || 'ID'} must use ${identifierFormat} format.`;
  }

  if (!['active', 'inactive', 'blocked', 'pending_login'].includes(form.status)) {
    errors.status = 'Status must be active, inactive, or blocked.';
  }

  const street = String(form.streetAddress || '').trim();
  if (street.length > 255) errors.streetAddress = 'Street address must be 255 characters or fewer.';
  assign('barangay', editRequiredTextError(form.barangay, 'Barangay', 100));
  assign('cityMunicipality', editRequiredTextError(form.cityMunicipality, 'City / Municipality', 100));
  assign('province', editRequiredTextError(form.province, 'Province', 100));

  if (form.isStudent) {
    if (!form.college) errors.college = 'College is required.';
    if (!form.program) {
      errors.program = 'Program is required.';
    } else if (collegeOptions.includes(form.college) && !getProgramOptions(form.college).includes(form.program)) {
      errors.program = 'Select a program for the chosen college.';
    }
    if (!yearLevelOptions.includes(form.yearLevel)) errors.yearLevel = 'Year level is required.';
    if (form.section && !sectionOptions.includes(form.section)) {
      errors.section = 'Section must be Block A, Block B, Block C, or Block D.';
    }

    const rfidUid = String(form.rfidUid || '').trim();
    if (rfidUid && !/^[A-Z0-9]{1,30}$/.test(rfidUid)) {
      errors.rfidUid = 'RFID UID must be up to 30 letters or numbers.';
    }
  } else {
    assign('officeDepartment', editRequiredTextError(form.officeDepartment, 'Department', 150));
    assign('workPosition', editRequiredTextError(form.workPosition, 'Position', 150));
  }

  return errors;
}

export default function ManageUsers({ user: currentUser } = {}) {
  const confirmAction = useActionConfirm();
  const roleFilterMenuRef = useRef(null);
  const statusFilterMenuRef = useRef(null);
  const editOriginalRef = useRef(null);
  const [activeTab, setActiveTab] = useState('all');
  const [registrationRole, setRegistrationRole] = useState(null);
  const [activeStatusFilter, setActiveStatusFilter] = useState('all');
  const [isRoleFilterMenuOpen, setIsRoleFilterMenuOpen] = useState(false);
  const [isStatusFilterMenuOpen, setIsStatusFilterMenuOpen] = useState(false);
  const [usersByRole, setUsersByRole] = useState(initialUsers);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [viewUser, setViewUser] = useState(null);
  const [isViewLoading, setIsViewLoading] = useState(false);
  const [viewError, setViewError] = useState('');
  const [isPhotoExpanded, setIsPhotoExpanded] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [isEditLoading, setIsEditLoading] = useState(false);
  const [isEditSaving, setIsEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [editFieldErrors, setEditFieldErrors] = useState({});
  const [editPhotoExpanded, setEditPhotoExpanded] = useState(false);
  const [isDeletingUserId, setIsDeletingUserId] = useState(null);
  const [deleteRequest, setDeleteRequest] = useState(null);
  const [deleteNotice, setDeleteNotice] = useState('');
  const [isBlockingUserId, setIsBlockingUserId] = useState(null);
  const [passwordUser, setPasswordUser] = useState(null);
  const [passwordForm, setPasswordForm] = useState({
    newPassword: '',
    confirmPassword: '',
  });
  const [passwordVisibility, setPasswordVisibility] = useState({
    newPassword: false,
    confirmPassword: false,
  });
  const [passwordError, setPasswordError] = useState('');
  const [passwordFieldErrors, setPasswordFieldErrors] = useState(emptyPasswordFieldErrors);
  const [isPasswordSaving, setIsPasswordSaving] = useState(false);
  const [privilegesUser, setPrivilegesUser] = useState(null);
  const [privilegesMode, setPrivilegesMode] = useState('edit');
  const [privilegesRole, setPrivilegesRole] = useState('admin');
  const [privilegesCatalog, setPrivilegesCatalog] = useState([]);
  const [privilegesSelected, setPrivilegesSelected] = useState([]);
  const [privilegesRoleDefaults, setPrivilegesRoleDefaults] = useState(ROLE_PRIVILEGE_DEFAULTS);
  const [privilegesError, setPrivilegesError] = useState('');
  const [isPrivilegesLoading, setIsPrivilegesLoading] = useState(false);
  const [isPrivilegesSaving, setIsPrivilegesSaving] = useState(false);

  useEffect(() => {
    let isActive = true;

    async function loadUsers() {
      try {
        const response = await axiosClient.get('/api/user.php');

        if (!isActive) {
          return;
        }

        const loadedUsers = response.data.users || {};

        setUsersByRole({
          ...initialUsers,
          ...loadedUsers,
          students: (loadedUsers.students || []).filter((user) => user.status !== 'pending'),
        });
        setErrorMessage('');
      } catch {
        if (isActive) {
          setUsersByRole(initialUsers);
          setErrorMessage('Unable to load users right now.');
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    loadUsers();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!isRoleFilterMenuOpen && !isStatusFilterMenuOpen) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (isRoleFilterMenuOpen && !roleFilterMenuRef.current?.contains(event.target)) {
        setIsRoleFilterMenuOpen(false);
      }

      if (isStatusFilterMenuOpen && !statusFilterMenuRef.current?.contains(event.target)) {
        setIsStatusFilterMenuOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setIsRoleFilterMenuOpen(false);
        setIsStatusFilterMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isRoleFilterMenuOpen, isStatusFilterMenuOpen]);

  const hideSuperAdminRows = currentUser?.role === 'admin';
  const listedUsersByRole = useMemo(
    () => (hideSuperAdminRows ? omitSuperAdminUsers(usersByRole) : usersByRole),
    [hideSuperAdminRows, usersByRole],
  );
  const visibleRoleFilterOptions = useMemo(
    () => (hideSuperAdminRows
      ? roleFilterOptions.filter((option) => option.key !== 'super_admins')
      : roleFilterOptions),
    [hideSuperAdminRows],
  );
  const activeTabConfig =
    visibleRoleFilterOptions.find((tab) => tab.key === activeTab) || allUsersFilter;
  const activeStatusFilterConfig =
    statusFilterOptions.find((option) => option.value === activeStatusFilter) ||
    statusFilterOptions[0];
  const activeUsers = useMemo(
    () => getUsersForRoleFilter(activeTabConfig.key, listedUsersByRole),
    [activeTabConfig.key, listedUsersByRole],
  );
  const statusFilteredUsers = useMemo(
    () => filterUsersByStatus(activeUsers, activeStatusFilter),
    [activeUsers, activeStatusFilter],
  );
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const visibleUsers = useMemo(() => {
    if (!normalizedSearchQuery) {
      return statusFilteredUsers;
    }

    return statusFilteredUsers.filter((user) => {
      const isStudent = user.role === 'student' || activeTabConfig.key === 'students';
      const accessSetup = formatAccessSetup(user, { isStudent });

      const searchableValues = isStudent
        ? [
            user.name,
            user.email,
            user.identifier,
            user.status,
            user.sex,
            user.programDepartment,
            user.college,
            user.yearLevel,
            user.section,
            formatRoleLabel(user.role),
            accessSetup.rfid,
          ]
        : [
            user.name,
            user.email,
            user.identifier,
            user.status,
            user.sex,
            user.officeDepartment,
            user.contactNumber,
            user.workPosition,
            formatRoleLabel(user.role),
            accessSetup.rfid,
            accessSetup.fingerprint,
          ];

      return searchableValues
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearchQuery));
    });
  }, [activeTabConfig.key, statusFilteredUsers, normalizedSearchQuery]);
  const rowsPerPage = 6;
  const totalPages = Math.max(1, Math.ceil(visibleUsers.length / rowsPerPage));
  const paginatedUsers = useMemo(() => {
    const startIndex = (currentPage - 1) * rowsPerPage;
    return visibleUsers.slice(startIndex, startIndex + rowsPerPage);
  }, [currentPage, rowsPerPage, visibleUsers]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, activeStatusFilter, normalizedSearchQuery]);

  const totalUsers = useMemo(
    () => Object.values(listedUsersByRole).reduce((total, users) => total + users.length, 0),
    [listedUsersByRole],
  );
  const roleFilterCounts = useMemo(() => {
    const counts = { all: totalUsers };

    visibleRoleFilterOptions.forEach((option) => {
      if (option.key === 'all') {
        return;
      }

      counts[option.key] = getUsersForRoleFilter(option.key, listedUsersByRole).length;
    });

    return counts;
  }, [listedUsersByRole, totalUsers, visibleRoleFilterOptions]);
  const statusFilterCounts = useMemo(() => {
    const counts = { all: activeUsers.length };

    statusFilterOptions.forEach((option) => {
      if (option.value === 'all') {
        return;
      }

      counts[option.value] = filterUsersByStatus(activeUsers, option.value).length;
    });

    return counts;
  }, [activeUsers]);
  const totalFacultyStaff = useMemo(
    () => (listedUsersByRole.faculty?.length || 0) + (listedUsersByRole.staff?.length || 0),
    [listedUsersByRole],
  );
  const totalAdminAccounts = useMemo(
    () => getUsersForRoleFilter('admins', listedUsersByRole).length,
    [listedUsersByRole],
  );
  const summaryCards = [
    {
      label: 'Total Users',
      value: totalUsers,
      detail: 'Registered accounts',
      icon: Users,
    },
    {
      label: 'Faculty/Staff',
      value: totalFacultyStaff,
      detail: 'Faculty and staff accounts',
      icon: GraduationCap,
    },
    {
      label: 'Admin',
      value: totalAdminAccounts,
      detail: 'Admin accounts',
      icon: Shield,
    },
  ];

  const viewGroups = viewUser?.username
    ? [
        {
          title: 'Personal Information',
          fields: [
            ['Full name', viewUser.name, true],
            ['Sex', viewUser.sex],
            ['Birthdate', viewUser.birthdate],
            ['Age', viewUser.age],
            ['Contact number', viewUser.contactNumber],
            ['Address', viewUser.address, true],
          ],
        },
        {
          title: 'Account Information',
          fields: [
            ['Username', viewUser.username],
            ['Email', viewUser.email],
            ['Role', formatRoleLabel(viewUser.role)],
            [viewUser.identifierLabel, viewUser.identifier],
            ['Status', formatStatusLabel(viewUser.status)],
          ],
        },
        viewUser.isStudent
          ? {
              title: 'School Information',
              fields: [
                ['College', viewUser.college],
                ['Year level', viewUser.yearLevel],
                ['Program', viewUser.program],
                ['Section', viewUser.section || 'No section'],
              ],
            }
          : {
              title: 'Work Information',
              fields: [
                ['Department', viewUser.officeDepartment],
                ['Position', viewUser.workPosition],
              ],
            },
        {
          title: 'Access',
          fields: viewUser.isStudent
            ? [
                ['RFID UID', viewUser.rfidUid],
                ['Joined', viewUser.joinedAt],
              ]
            : [
                [
                  'Fingerprints',
                  viewUser.fingerprintCount ? `${viewUser.fingerprintCount} active` : 'Not Enrolled',
                ],
                ['RFID UID', viewUser.rfidUid],
                ['Joined', viewUser.joinedAt],
              ],
        },
      ]
        .map((group) => ({
          ...group,
          fields: group.fields.filter(([, value]) => value),
        }))
        .filter((group) => group.fields.length > 0)
    : [];

  async function openUserView(user) {
    const isStudent = user.role === 'student';
    const fallbackUser = {
      ...user,
      identifierLabel: isStudent ? 'School ID' : 'Employee ID',
      isStudent,
      program: user.programDepartment,
      rfidUid: user.rfidUid || 'Not assigned',
    };

    setViewUser(fallbackUser);
    setViewError('');
    setIsViewLoading(true);
    setIsPhotoExpanded(false);

    try {
      const response = await axiosClient.get('/api/user.php', { params: { id: user.id } });
      const detailedUser = response.data.user;

      if (detailedUser) {
        setViewUser(detailedUser);
      }
    } catch (error) {
      setViewError(error.response?.data?.message || 'Unable to load this user right now.');
    } finally {
      setIsViewLoading(false);
    }
  }

  function closeUserView() {
    setViewUser(null);
    setViewError('');
    setIsPhotoExpanded(false);
  }

  function updateEditField(field, value) {
    setEditForm((current) => {
      if (!current) {
        return current;
      }

      if (field === 'dateOfBirth') {
        return {
          ...current,
          dateOfBirth: value,
          age: calculateAge(value),
        };
      }

      if (field === 'college') {
        const nextPrograms = getProgramOptions(value);
        return {
          ...current,
          college: value,
          program: nextPrograms.includes(current.program) ? current.program : '',
        };
      }

      return {
        ...current,
        [field]: value,
      };
    });
    setEditFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  async function openUserEdit(user) {
    const isStudent = user.role === 'student';
    const fallbackUser = {
      ...user,
      identifierLabel: isStudent ? 'School ID' : 'Employee ID',
      isStudent,
      program: user.programDepartment,
      rfidUid: user.rfidUid || 'Not assigned',
    };

    setEditForm(buildEditForm(fallbackUser));
    editOriginalRef.current = buildEditForm(fallbackUser);
    setEditError('');
    setEditFieldErrors({});
    setIsEditLoading(true);
    setEditPhotoExpanded(false);

    try {
      const response = await axiosClient.get('/api/user.php', { params: { id: user.id } });
      const detailedUser = response.data.user;

      if (detailedUser) {
        const nextForm = buildEditForm(detailedUser);
        editOriginalRef.current = nextForm;
        setEditForm(nextForm);
      }
    } catch (error) {
      setEditError(error.response?.data?.message || 'Unable to load this user right now.');
    } finally {
      setIsEditLoading(false);
    }
  }

  function closeUserEdit({ force = false } = {}) {
    if (isEditSaving && !force) {
      return;
    }

    setEditForm(null);
    setEditError('');
    setEditFieldErrors({});
    editOriginalRef.current = null;
    setEditPhotoExpanded(false);
  }

  async function reloadUsers() {
    const response = await axiosClient.get('/api/user.php');
    const loadedUsers = response.data.users || {};

    setUsersByRole({
      ...initialUsers,
      ...loadedUsers,
      students: (loadedUsers.students || []).filter((user) => user.status !== 'pending'),
    });
  }

  async function handleSaveEdit(event) {
    event.preventDefault();

    if (!editForm || isEditSaving) {
      return;
    }

    const nextErrors = validateEditForm(editForm);
    const original = editOriginalRef.current;
    const availability = {};

    if (original && editForm.username.trim().toLowerCase() !== String(original.username || '').trim().toLowerCase()) {
      availability.username = editForm.username.trim().toLowerCase();
    }
    if (original && editForm.email.trim().toLowerCase() !== String(original.email || '').trim().toLowerCase()) {
      availability.email = editForm.email.trim().toLowerCase();
    }
    if (original && editForm.identifier !== original.identifier) {
      availability[editForm.isStudent ? 'school_id' : 'employee_id'] = editForm.identifier;
    }
    if (original && editForm.isStudent && editForm.rfidUid !== original.rfidUid) {
      availability.rfid_uid = editForm.rfidUid;
    }

    if (Object.keys(availability).length > 0) {
      try {
        const response = await axiosClient.post('/api/registration_availability.php', availability);
        const taken = response.data?.errors || {};
        if (taken.username) nextErrors.username = taken.username;
        if (taken.email) nextErrors.email = taken.email;
        if (taken.school_id || taken.employee_id) nextErrors.identifier = taken.school_id || taken.employee_id;
        if (taken.rfid_uid) nextErrors.rfidUid = taken.rfid_uid;
      } catch {
        setEditError('Unable to check whether these details are already in use. Please try again.');
        return;
      }
    }

    setEditFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setEditError('Please correct the highlighted fields before saving.');
      return;
    }

    const confirmed = await confirmAction({
      title: 'Update user',
      message: `Are you sure you want to update ${[editForm.firstName, editForm.lastName].filter(Boolean).join(' ') || 'this user'}?`,
    });

    if (!confirmed) {
      return;
    }

    setIsEditSaving(true);
    setEditError('');

    try {
      await axiosClient.put('/api/user.php', {
        ...editForm,
        actor_id: currentUser?.id || undefined,
      });
      await reloadUsers();
      closeUserEdit({ force: true });
    } catch (error) {
      const message = error.response?.data?.message || 'Unable to save user changes right now.';
      const serverErrors = editServerFieldErrors(message);
      if (Object.keys(serverErrors).length > 0) {
        setEditFieldErrors(serverErrors);
      }
      setEditError(message);
    } finally {
      setIsEditSaving(false);
    }
  }

  async function handleDeleteUser(user) {
    if (!user?.id || isDeletingUserId) {
      return;
    }

    if (!canDeleteRecords(currentUser) || !userHasPrivilege(currentUser, 'delete_users')) {
      setErrorMessage(
        'You do not have permission to delete users. Ask a Super Admin to grant Delete Users access.',
      );
      return;
    }

    if (currentUser?.id && Number(currentUser.id) === Number(user.id)) {
      setErrorMessage('You cannot delete your own account.');
      return;
    }

    const confirmed = await confirmAction({
      title: 'Delete user',
      danger: true,
      message: `Are you sure you want to permanently delete ${user.name || 'this user'}? This cannot be undone.`,
    });

    if (!confirmed) {
      return;
    }

    setIsDeletingUserId(user.id);
    setErrorMessage('');

    try {
      await axiosClient.delete('/api/user.php', {
        params: {
          id: user.id,
          actor_id: currentUser?.id || undefined,
        },
      });

      if (viewUser?.id === user.id) {
        closeUserView();
      }

      if (editForm?.id === user.id) {
        closeUserEdit({ force: true });
      }

      if (passwordUser?.id === user.id) {
        closePasswordModal({ force: true });
      }

      await reloadUsers();
    } catch (error) {
      setErrorMessage(error.response?.data?.message || 'Unable to delete this user right now.');
    } finally {
      setIsDeletingUserId(null);
    }
  }

  async function handleToggleBlockUser(user) {
    if (!user?.id || isBlockingUserId) {
      return;
    }

    if (currentUser?.id && Number(currentUser.id) === Number(user.id)) {
      setErrorMessage('You cannot block your own account.');
      return;
    }

    const isBlocked = isBlockedStatus(user.status);
    const nextBlocked = !isBlocked;
    const actionLabel = nextBlocked ? 'Block' : 'Unblock';

    if (
      !nextBlocked &&
      user.role === 'super_admin' &&
      countOccupiedSuperAdminSlots(usersByRole, user.id) >= 2
    ) {
      const confirmed = await confirmAction({
        title: 'Unblock as Admin',
        requirePassword: false,
        message: `The maximum of 2 Super Admin accounts has already been reached. Unblock ${
          user.name || 'this user'
        } as Admin instead? You will choose their privileges next.`,
      });

      if (!confirmed) {
        return;
      }

      await openDemoteUnblockPrivilegesModal(user);
      return;
    }

    const confirmed = await confirmAction({
      title: `${actionLabel} user`,
      danger: nextBlocked,
      message: nextBlocked
        ? `Are you sure you want to block ${user.name || 'this user'}? They will not be able to sign in until unblocked.`
        : `Are you sure you want to unblock ${user.name || 'this user'}? They will be able to sign in again.`,
    });

    if (!confirmed) {
      return;
    }

    setIsBlockingUserId(user.id);
    setErrorMessage('');

    try {
      await axiosClient.post('/api/user.php', {
        action: 'set_block_status',
        id: user.id,
        blocked: nextBlocked,
        actor_id: currentUser?.id || undefined,
      });

      if (editForm?.id === user.id) {
        setEditForm((current) =>
          current
            ? {
                ...current,
                status: nextBlocked ? 'blocked' : user.status === 'pending_login' ? 'pending_login' : 'active',
              }
            : current,
        );
      }

      if (viewUser?.id === user.id) {
        setViewUser((current) =>
          current
            ? {
                ...current,
                status: nextBlocked ? 'blocked' : user.status === 'pending_login' ? 'pending_login' : 'active',
              }
            : current,
        );
      }

      await reloadUsers();
    } catch (error) {
      if (
        !nextBlocked &&
        user.role === 'super_admin' &&
        error.response?.data?.code === 'require_demote_to_admin'
      ) {
        const demoteConfirmed = await confirmAction({
          title: 'Unblock as Admin',
          requirePassword: false,
          message: `The maximum of 2 Super Admin accounts has already been reached. Unblock ${
            user.name || 'this user'
          } as Admin instead? You will choose their privileges next.`,
        });

        if (demoteConfirmed) {
          await openDemoteUnblockPrivilegesModal(user);
        }

        return;
      }

      setErrorMessage(
        error.response?.data?.message ||
          `Unable to ${actionLabel.toLowerCase()} this user right now.`,
      );
    } finally {
      setIsBlockingUserId(null);
    }
  }

  function openPasswordModal(user) {
    if (!user?.id) {
      return;
    }

    setPasswordUser({
      id: user.id,
      name: user.name || 'this user',
    });
    setPasswordForm({
      newPassword: '',
      confirmPassword: '',
    });
    setPasswordVisibility({
      newPassword: false,
      confirmPassword: false,
    });
    setPasswordError('');
    setPasswordFieldErrors(emptyPasswordFieldErrors);
  }

  function closePasswordModal({ force = false } = {}) {
    if (isPasswordSaving && !force) {
      return;
    }

    setPasswordUser(null);
    setPasswordForm({
      newPassword: '',
      confirmPassword: '',
    });
    setPasswordVisibility({
      newPassword: false,
      confirmPassword: false,
    });
    setPasswordError('');
    setPasswordFieldErrors(emptyPasswordFieldErrors);
  }

  async function handleChangePassword(event) {
    event.preventDefault();

    if (!passwordUser?.id || isPasswordSaving) {
      return;
    }

    const newPassword = String(passwordForm.newPassword || '');
    const confirmPassword = String(passwordForm.confirmPassword || '');
    const nextFieldErrors = { ...emptyPasswordFieldErrors };

    nextFieldErrors.newPassword = getPasswordStrengthError(newPassword);

    if (confirmPassword.trim() === '') {
      nextFieldErrors.confirmPassword = 'Please confirm the new password.';
    } else if (newPassword !== confirmPassword) {
      nextFieldErrors.confirmPassword = 'Password and re-entered password must match.';
    }

    if (nextFieldErrors.newPassword || nextFieldErrors.confirmPassword) {
      setPasswordFieldErrors(nextFieldErrors);
      setPasswordError('');
      return;
    }

    const confirmed = await confirmAction({
      title: 'Change password',
      message: `Are you sure you want to change the password for ${passwordUser.name}?`,
    });

    if (!confirmed) {
      return;
    }

    setIsPasswordSaving(true);
    setPasswordError('');
    setPasswordFieldErrors(emptyPasswordFieldErrors);

    try {
      await axiosClient.post('/api/user.php', {
        action: 'change_password',
        id: passwordUser.id,
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      closePasswordModal({ force: true });
    } catch (error) {
      setPasswordError(error.response?.data?.message || 'Unable to change this password right now.');
    } finally {
      setIsPasswordSaving(false);
    }
  }

  function canManagePrivileges(user) {
    return (
      currentUser?.role === 'super_admin' &&
      (user?.role === 'admin' || user?.role === 'super_admin')
    );
  }

  async function openPrivilegesModal(user) {
    if (!user?.id || !canManagePrivileges(user)) {
      return;
    }

    setPrivilegesMode('edit');
    setPrivilegesUser({
      id: user.id,
      name: user.name || 'this user',
      role: user.role,
    });
    setPrivilegesRole(user.role === 'super_admin' ? 'super_admin' : 'admin');
    setPrivilegesSelected([]);
    setPrivilegesError('');
    setIsPrivilegesLoading(true);

    try {
      const response = await axiosClient.get('/api/user_privileges.php', {
        params: { user_id: user.id },
      });
      const catalog = response.data?.catalog || [];
      const defaults = response.data?.role_defaults || ROLE_PRIVILEGE_DEFAULTS;
      const role = response.data?.role === 'super_admin' ? 'super_admin' : 'admin';
      const privileges = Array.isArray(response.data?.privileges)
        ? response.data.privileges
        : defaults[role] || [];

      setPrivilegesCatalog(catalog);
      setPrivilegesRoleDefaults(defaults);
      setPrivilegesRole(role);
      setPrivilegesSelected(privileges);
    } catch (error) {
      setPrivilegesError(error.response?.data?.message || 'Unable to load roles and privileges.');
    } finally {
      setIsPrivilegesLoading(false);
    }
  }

  async function openDemoteUnblockPrivilegesModal(user) {
    if (!user?.id) {
      return;
    }

    setPrivilegesMode('unblock_as_admin');
    setPrivilegesUser({
      id: user.id,
      name: user.name || 'this user',
      role: user.role,
    });
    setPrivilegesRole('admin');
    setPrivilegesSelected([]);
    setPrivilegesError('');
    setIsPrivilegesLoading(true);

    try {
      const response = await axiosClient.get('/api/user_privileges.php', {
        params: { user_id: user.id },
      });
      const catalog = response.data?.catalog || [];
      const defaults = response.data?.role_defaults || ROLE_PRIVILEGE_DEFAULTS;
      const adminDefaults = defaults.admin || ROLE_PRIVILEGE_DEFAULTS.admin || [];

      setPrivilegesCatalog(catalog);
      setPrivilegesRoleDefaults(defaults);
      setPrivilegesRole('admin');
      setPrivilegesSelected(adminDefaults);
    } catch (error) {
      setPrivilegesError(
        error.response?.data?.message || 'Unable to load Admin privileges for unblock.',
      );
    } finally {
      setIsPrivilegesLoading(false);
    }
  }

  function closePrivilegesModal({ force = false } = {}) {
    if (isPrivilegesSaving && !force) {
      return;
    }

    setPrivilegesUser(null);
    setPrivilegesMode('edit');
    setPrivilegesError('');
    setPrivilegesCatalog([]);
    setPrivilegesSelected([]);
  }

  function handlePrivilegesRoleChange(nextRole) {
    if (privilegesMode === 'unblock_as_admin') {
      return;
    }

    setPrivilegesRole(nextRole);
    setPrivilegesSelected(privilegesRoleDefaults[nextRole] || ROLE_PRIVILEGE_DEFAULTS[nextRole] || []);
    setPrivilegesError('');
  }

  function togglePrivilege(key) {
    if (key === 'dashboard') {
      return;
    }

    setPrivilegesSelected((current) => {
      if (current.includes(key)) {
        return current.filter((item) => item !== key);
      }

      return [...current, key];
    });
    setPrivilegesError('');
  }

  async function handleSavePrivileges(event) {
    event.preventDefault();

    if (!privilegesUser?.id || isPrivilegesSaving) {
      return;
    }

    if (
      privilegesMode !== 'unblock_as_admin' &&
      currentUser?.id &&
      Number(currentUser.id) === Number(privilegesUser.id)
    ) {
      setPrivilegesError('You can only view your own privileges.');
      return;
    }

    if (privilegesSelected.length === 0) {
      setPrivilegesError('Select at least one privilege.');
      return;
    }

    if (privilegesMode === 'unblock_as_admin') {
      const confirmed = await confirmAction({
        title: 'Confirm unblock as Admin',
        message: `Unblock ${privilegesUser.name} as Admin with the selected privileges?`,
      });

      if (!confirmed) {
        return;
      }

      setIsPrivilegesSaving(true);
      setPrivilegesError('');

      try {
        await axiosClient.post('/api/user.php', {
          action: 'set_block_status',
          id: privilegesUser.id,
          blocked: false,
          demote_to_admin: true,
          privileges: privilegesSelected,
          actor_id: currentUser?.id || undefined,
        });

        if (editForm?.id === privilegesUser.id) {
          setEditForm((current) =>
            current
              ? {
                  ...current,
                  role: 'admin',
                  status: 'active',
                }
              : current,
          );
        }

        if (viewUser?.id === privilegesUser.id) {
          setViewUser((current) =>
            current
              ? {
                  ...current,
                  role: 'admin',
                  status: 'active',
                }
              : current,
          );
        }

        await reloadUsers();
        closePrivilegesModal({ force: true });
      } catch (error) {
        setPrivilegesError(
          error.response?.data?.message || 'Unable to unblock this user as Admin right now.',
        );
      } finally {
        setIsPrivilegesSaving(false);
      }

      return;
    }

    const confirmed = await confirmAction({
      title: 'Update roles & privileges',
      message: `Are you sure you want to update roles and privileges for ${privilegesUser.name}?`,
    });

    if (!confirmed) {
      return;
    }

    setIsPrivilegesSaving(true);
    setPrivilegesError('');

    try {
      await axiosClient.post('/api/user_privileges.php', {
        actor_id: currentUser?.id,
        user_id: privilegesUser.id,
        role: privilegesRole,
        privileges: privilegesSelected,
      });
      await reloadUsers();
      closePrivilegesModal({ force: true });
    } catch (error) {
      setPrivilegesError(
        error.response?.data?.message || 'Unable to update roles and privileges right now.',
      );
    } finally {
      setIsPrivilegesSaving(false);
    }
  }

  function handleExport(format) {
    setIsExportModalOpen(false);
    const exportColumns = activeTabConfig.columns
      .filter((column) => column !== 'Action')
      .flatMap((column) => (column === 'User' ? ['Name', 'Email'] : [column]));
    exportTable(format, {
      headers: exportColumns,
      rows: visibleUsers.map((user) => {
        const isStudent = user.role === 'student' || activeTabConfig.key === 'students';
        const accessSetup = formatAccessSetup(user, { isStudent });
        const idCell = user.identifier;
        const departmentCell = isStudent
          ? `${user.programDepartment || 'Not assigned'} - ${user.college || 'No college set'}`
          : `${user.officeDepartment || 'Not assigned'}${user.contactNumber ? ` - ${user.contactNumber}` : ''}`;
        const positionCell = isStudent
          ? `${user.yearLevel || 'Not set'} - ${user.section || 'No section'}`
          : user.workPosition || 'Not assigned';
        const roleCell = formatRoleLabel(user.role);

        const accessSetupCell = isStudent
          ? accessSetup.rfid
          : `${accessSetup.fingerprint} - ${accessSetup.rfid}`;

        return [
          user.name,
          user.email || '',
          idCell,
          departmentCell,
          positionCell,
          roleCell,
          formatStatusLabel(user.status),
          accessSetupCell,
        ];
      }),
      fileBaseName: `${activeTabConfig.key}_users_${getManilaDateStamp()}`,
      pdf: {
        title: /(Users|Accounts)$/.test(activeTabConfig.label)
          ? activeTabConfig.label
          : `${activeTabConfig.label} Users`,
        note: buildExportNote(visibleUsers.length, 'user', [
          activeStatusFilter !== 'all' ? `Status: ${activeStatusFilterConfig.label}` : '',
          searchQuery.trim() ? `Search: "${searchQuery.trim()}"` : '',
        ]),
        widths: [110, 140, 75, 150, 100, 60, 55, 100],
        emphasizeColumn: 0,
        emptyMessage: `No ${activeTabConfig.emptyLabel} match the selected filters.`,
      },
    });
  }

  const registerButtonLabel = useMemo(() => {
    const roleLabels = {
      faculty: 'Faculty',
      staff: 'Staff',
      admins: 'Admin',
      super_admins: 'Super Admin',
      students: 'Student',
    };

    return `Register ${roleLabels[activeTabConfig.key] || 'User'}`;
  }, [activeTabConfig.key]);

  const isViewingOwnPrivileges = Boolean(
    privilegesMode === 'edit' &&
      privilegesUser?.id &&
      currentUser?.id &&
      Number(privilegesUser.id) === Number(currentUser.id),
  );
  const isUnblockAsAdminMode = privilegesMode === 'unblock_as_admin';

  function handleRegisterUser() {
    if (currentUser?.role === 'admin' && activeTabConfig.key !== 'students') {
      return;
    }

    setRegistrationRole(activeTabConfig.key === 'super_admins'
      ? 'super_admin'
      : activeTabConfig.key === 'all' ? 'faculty' : activeTabConfig.key);
  }

  async function closeRegistration(wasCreated) {
    setRegistrationRole(null);
    if (wasCreated) {
      try {
        await reloadUsers();
      } catch {
        setErrorMessage('The account was created, but the user list could not be refreshed. Reload the page to see it.');
      }
    }
  }

  const canRegisterCurrentTab =
    currentUser?.role !== 'admin' || activeTabConfig.key === 'students';

  return (
    <>
    {registrationRole !== null ? createPortal(
      <RegisterUser user={currentUser} initialRole={registrationRole} onClose={closeRegistration} />,
      document.body,
    ) : null}
    <main className="admin-dashboard manage-users" aria-label="Manage users">
      <section className="manage-users-summary-grid" aria-label="User summary">
        {summaryCards.map(({ label, value, detail, icon: Icon }) => (
          <article className="dashboard-summary-card manage-users-summary-card" key={label}>
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

      <section className="dashboard-recent-card manage-users-card">
        <div className="dashboard-panel-header">
          <div>
            <span>{activeTabConfig.label}</span>
            <p>Important account, profile, and access credential details.</p>
          </div>
          <button
            type="button"
            className="dashboard-export-button"
            onClick={() => setIsExportModalOpen(true)}
            disabled={isLoading || Boolean(errorMessage) || visibleUsers.length === 0}
          >
            <Download size={15} aria-hidden="true" />
            Export
          </button>
        </div>

        <div className="manage-users-role-filter">
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
              aria-controls="manage-users-role-filter-menu"
              aria-label={`Role filter: ${activeTabConfig.label}`}
              disabled={isLoading}
              onClick={() => {
                setIsRoleFilterMenuOpen((open) => !open);
                setIsStatusFilterMenuOpen(false);
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
                id="manage-users-role-filter-menu"
                className="manage-users-role-tab-menu"
                role="listbox"
                aria-label="Filter users by role"
              >
                {visibleRoleFilterOptions.map((option) => (
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
            ref={statusFilterMenuRef}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                setIsStatusFilterMenuOpen(false);
              }
            }}
          >
            <button
              type="button"
              className={`manage-users-role-tab-trigger${isStatusFilterMenuOpen ? ' is-open' : ''}`}
              aria-haspopup="listbox"
              aria-expanded={isStatusFilterMenuOpen}
              aria-controls="manage-users-status-filter-menu"
              aria-label={`Status filter: ${activeStatusFilterConfig.label}`}
              disabled={isLoading}
              onClick={() => {
                setIsStatusFilterMenuOpen((open) => !open);
                setIsRoleFilterMenuOpen(false);
              }}
            >
              <span className="manage-users-role-tab-trigger-label">
                {activeStatusFilterConfig.label}
              </span>
              <span className="manage-users-role-tab-count">
                {isLoading ? '--' : statusFilterCounts[activeStatusFilterConfig.value] || 0}
              </span>
              <ChevronDown className="manage-users-role-tab-chevron" size={14} aria-hidden="true" />
            </button>

            {isStatusFilterMenuOpen ? (
              <div
                id="manage-users-status-filter-menu"
                className="manage-users-role-tab-menu"
                role="listbox"
                aria-label="Filter users by status"
              >
                {statusFilterOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    className={`manage-users-role-tab-option${
                      activeStatusFilter === option.value ? ' is-active' : ''
                    }`}
                    aria-selected={activeStatusFilter === option.value}
                    onClick={() => {
                      setActiveStatusFilter(option.value);
                      setIsStatusFilterMenuOpen(false);
                    }}
                  >
                    <Check className="manage-users-role-tab-check" size={15} aria-hidden="true" />
                    <span className="manage-users-role-tab-option-label">{option.label}</span>
                    <span className="manage-users-role-tab-count">
                      {isLoading ? '--' : statusFilterCounts[option.value] || 0}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="manage-users-filter-actions" aria-label="Manage user actions">
            {canRegisterCurrentTab ? (
              <button
                type="button"
                className="manage-users-register-button"
                onClick={handleRegisterUser}
                disabled={isLoading || Boolean(errorMessage)}
              >
                <UserPlus size={16} aria-hidden="true" />
                {registerButtonLabel}
              </button>
            ) : null}
            <label className="manage-users-search" aria-label="Search users">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                placeholder={
                  activeTabConfig.key === 'all'
                    ? 'Search users...'
                    : `Search ${activeTabConfig.label.toLowerCase()}...`
                }
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </label>
          </div>
        </div>

        <div className="dashboard-recent-table-wrap manage-users-table-wrap">
          <table className="dashboard-recent-table manage-users-table">
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

              {!isLoading && visibleUsers.length === 0 && (
                <tr>
                  <td className="dashboard-recent-empty" colSpan={activeTabConfig.columns.length}>
                    <TableEmptyState description={normalizedSearchQuery || activeStatusFilter !== 'all' ? 'Try adjusting your search or account status filter.' : 'Registered accounts will appear here.'}>
                      {normalizedSearchQuery
                        ? `No ${activeTabConfig.emptyLabel} match your search.`
                        : activeStatusFilter !== 'all'
                          ? `No ${activeStatusFilterConfig.label.toLowerCase()} ${activeTabConfig.emptyLabel} found.`
                          : `No ${activeTabConfig.emptyLabel} found.`}
                    </TableEmptyState>
                  </td>
                </tr>
              )}

              {!isLoading &&
                paginatedUsers.map((user) => {
                  const isStudent = user.role === 'student' || activeTabConfig.key === 'students';
                  const accessSetup = formatAccessSetup(user, { isStudent });

                  return (
                    <tr key={`${user.role || 'user'}-${user.id}`}>
                      <td>
                        <strong>{user.name}</strong>
                        <span>{user.email}</span>
                      </td>
                      <td>
                        <strong>{user.identifier}</strong>
                      </td>
                      <td>
                        {isStudent ? (
                          <>
                            <strong>{user.programDepartment || 'Not assigned'}</strong>
                            <span>{user.college || 'No college set'}</span>
                          </>
                        ) : (
                          <>
                            <strong>{user.officeDepartment || 'Not assigned'}</strong>
                            <span>{user.contactNumber}</span>
                          </>
                        )}
                      </td>
                      <td>
                        {isStudent ? (
                          <>
                            <strong>{user.yearLevel || 'Not set'}</strong>
                            <span>{user.section || 'No section'}</span>
                          </>
                        ) : (
                          <strong>{user.workPosition || 'Not assigned'}</strong>
                        )}
                      </td>
                      <td>
                        <strong>{formatRoleLabel(user.role)}</strong>
                      </td>
                      <td>
                        <span className={`dashboard-log-status manage-users-status-${user.status}`}>
                          {formatStatusLabel(user.status)}
                        </span>
                      </td>
                      <td>
                        <strong>{accessSetup.primary}</strong>
                        {accessSetup.secondary ? <span>{accessSetup.secondary}</span> : null}
                      </td>
                      <td>
                        <RowActionMenu
                          label={`Actions for ${user.name}`}
                          items={[
                            { label: 'View', icon: Eye, onClick: () => openUserView(user) },
                            { label: 'Edit', icon: Pencil, onClick: () => openUserEdit(user) },
                            {
                              label: 'Change Password',
                              icon: KeyRound,
                              onClick: () => openPasswordModal(user),
                              disabled: isPasswordSaving,
                            },
                            {
                              label: 'Roles & Privileges',
                              icon: Shield,
                              onClick: () => openPrivilegesModal(user),
                              disabled: isPrivilegesLoading || isPrivilegesSaving,
                              hidden: !canManagePrivileges(user),
                            },
                            {
                              label:
                                isBlockingUserId === user.id
                                  ? isBlockedStatus(user.status)
                                    ? 'Unblocking...'
                                    : 'Blocking...'
                                  : isBlockedStatus(user.status)
                                    ? 'Unblock'
                                    : 'Block',
                              icon: isBlockedStatus(user.status) ? Unlock : Ban,
                              danger: !isBlockedStatus(user.status),
                              onClick: () => handleToggleBlockUser(user),
                              disabled: isBlockingUserId === user.id,
                              hidden:
                                Boolean(currentUser?.id) &&
                                Number(currentUser.id) === Number(user.id),
                            },
                            {
                              label: isDeletingUserId === user.id ? 'Deleting...' : 'Delete',
                              icon: Trash2,
                              danger: true,
                              title: currentUser?.role === 'admin' && !['faculty', 'student'].includes(user.role)
                                ? 'Only faculty and student accounts can be sent for deletion. Admin and Super Admin accounts stay blocked.'
                                : undefined,
                              onClick: () => {
                                if (currentUser?.role === 'admin') {
                                  setDeleteRequest({
                                    targetType: 'user_account',
                                    targetId: user.id,
                                    targetLabel: `${user.name || 'Account'} · ${user.role}`,
                                    detail: user.identifier || user.email || '',
                                  });
                                  return;
                                }
                                handleDeleteUser(user);
                              },
                              disabled:
                                isDeletingUserId === user.id ||
                                (currentUser?.role === 'admin' && !['faculty', 'student'].includes(user.role)),
                              hidden:
                                currentUser?.role === 'admin'
                                  ? Boolean(currentUser?.id) && Number(currentUser.id) === Number(user.id)
                                  : !canDeleteRecords(currentUser) ||
                                    !userHasPrivilege(currentUser, 'delete_users') ||
                                    (Boolean(currentUser?.id) && Number(currentUser.id) === Number(user.id)),
                            },
                          ]}
                        />
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {!isLoading && visibleUsers.length > 0 && (
          <div className="manage-users-pagination" aria-label="Accounts pagination">
            <p>
              Showing {(currentPage - 1) * rowsPerPage + 1}-
              {Math.min(currentPage * rowsPerPage, visibleUsers.length)} of {visibleUsers.length}
            </p>
            <div className="manage-users-pagination-controls">
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
    </main>
    <ExportFormatModal
      open={isExportModalOpen}
      title={`Export ${activeTabConfig.label}`}
      subtitle={`${visibleUsers.length} user${visibleUsers.length === 1 ? '' : 's'} in the current view`}
      prompt="Only the users matching the current tab, status filter, and search will be exported. Choose the file format."
      pdfHint="Printable user list table"
      onSelect={handleExport}
      onClose={() => setIsExportModalOpen(false)}
    />
    {viewUser
      ? createPortal(
          <div className="pending-registration-review-backdrop" role="presentation" onClick={closeUserView}>
            <section
              className="pending-registration-review"
              role="dialog"
              aria-modal="true"
              aria-labelledby="manage-user-view-title"
              onClick={(event) => event.stopPropagation()}
            >
              <header>
                <div>
                  <h2 id="manage-user-view-title">View User</h2>
                  <p>Review this account’s saved information.</p>
                </div>
                <button type="button" aria-label="Close user view" onClick={closeUserView}>
                  <X size={16} aria-hidden="true" />
                </button>
              </header>
              {isViewLoading ? <p className="pending-registration-review-note">Loading user...</p> : null}
              {!isViewLoading && viewGroups.length > 0 ? (
                <div className="pending-registration-review-body">
                  <div className="pending-registration-review-identity">
                    <div className="pending-registration-review-photo">
                      {viewUser.photo ? (
                        <>
                          <img src={viewUser.photo} alt={`${viewUser.name} photo`} />
                          <button
                            type="button"
                            className="pending-registration-photo-expand"
                            aria-label="Expand photo"
                            onClick={() => setIsPhotoExpanded(true)}
                          >
                            <Expand size={14} aria-hidden="true" />
                          </button>
                        </>
                      ) : (
                        <p className="pending-registration-review-photo-empty">No photo</p>
                      )}
                    </div>
                    {viewGroups[0] ? (
                      <section className="pending-registration-review-card">
                        <h3>{viewGroups[0].title}</h3>
                        <dl>
                          {viewGroups[0].fields.map(([label, value, isWide]) => (
                            <div key={label} className={isWide ? 'is-wide' : undefined}>
                              <dt>{label}</dt>
                              <dd>{value}</dd>
                            </div>
                          ))}
                        </dl>
                      </section>
                    ) : null}
                  </div>
                  {viewGroups.slice(1).map((group) => (
                    <section className="pending-registration-review-card" key={group.title}>
                      <h3>{group.title}</h3>
                      <dl>
                        {group.fields.map(([label, value, isWide]) => (
                          <div key={label} className={isWide ? 'is-wide' : undefined}>
                            <dt>{label}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  ))}
                </div>
              ) : null}
              <footer>
                <button type="button" className="pending-registration-reject" onClick={closeUserView}>
                  Close
                </button>
              </footer>
            </section>
          </div>,
          document.body,
        )
      : null}
    {editForm
      ? createPortal(
          <div
            className="pending-registration-review-backdrop"
            role="presentation"
            onClick={() => closeUserEdit()}
          >
            <form
              className="pending-registration-review manage-users-edit-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="manage-user-edit-title"
              onClick={(event) => event.stopPropagation()}
              onSubmit={handleSaveEdit}
            >
              <header>
                <div>
                  <h2 id="manage-user-edit-title">Edit User</h2>
                  <p>Update this account’s saved information.</p>
                </div>
                <button type="button" aria-label="Close user edit" onClick={() => closeUserEdit()} disabled={isEditSaving}>
                  <X size={16} aria-hidden="true" />
                </button>
              </header>

              {isEditLoading ? <p className="pending-registration-review-note">Loading user...</p> : null}

              {!isEditLoading ? (
                <div className="pending-registration-review-body">
                  <div className="pending-registration-review-identity manage-users-edit-identity">
                    <div className="pending-registration-review-photo">
                      {editForm.photo ? (
                        <>
                          <img src={editForm.photo} alt={`${editForm.firstName || 'User'} photo`} />
                          <button
                            type="button"
                            className="pending-registration-photo-expand"
                            aria-label="Expand photo"
                            onClick={() => setEditPhotoExpanded(true)}
                          >
                            <Expand size={14} aria-hidden="true" />
                          </button>
                        </>
                      ) : (
                        <p className="pending-registration-review-photo-empty">No photo</p>
                      )}
                    </div>

                    <section className="pending-registration-review-card">
                      <h3>Account Information</h3>
                      <dl>
                        <EditField label="Username" error={editFieldErrors.username}>
                          <input
                            type="text"
                            value={editForm.username}
                            onChange={(event) => updateEditField('username', event.target.value.replace(/\s/g, '').toLowerCase())}
                            required
                          />
                        </EditField>
                        <EditField label="Email" error={editFieldErrors.email}>
                          <input
                            type="email"
                            value={editForm.email}
                            onChange={(event) => updateEditField('email', event.target.value.replace(/\s/g, '').toLowerCase())}
                            required
                          />
                        </EditField>
                        <EditField label={editForm.identifierLabel} error={editFieldErrors.identifier}>
                          <input
                            type="text"
                            inputMode="numeric"
                            maxLength={editForm.isStudent ? 9 : 13}
                            placeholder={editForm.isStudent ? 'xxxx-xxxx' : 'xxxxxx-xxxxxx'}
                            value={editForm.identifier}
                            onChange={(event) => updateEditField(
                              'identifier',
                              normalizeIssuedId(event.target.value, editForm.isStudent ? 'student' : 'employee'),
                            )}
                            required
                          />
                        </EditField>
                        <EditField label="Status" error={editFieldErrors.status}>
                          <select
                            value={editForm.status}
                            onChange={(event) => updateEditField('status', event.target.value)}
                            required
                          >
                            <option value="active">active</option>
                            <option value="inactive">inactive</option>
                            <option value="blocked">blocked</option>
                            {editForm.status === 'pending_login' ? (
                              <option value="pending_login">pending login</option>
                            ) : null}
                          </select>
                        </EditField>
                      </dl>
                    </section>
                  </div>

                  <section className="pending-registration-review-card">
                    <h3>Personal Information</h3>
                    <dl>
                      <EditField label="First name" error={editFieldErrors.firstName}>
                        <input
                          type="text"
                          value={editForm.firstName}
                          onChange={(event) => updateEditField('firstName', event.target.value)}
                          required
                        />
                      </EditField>
                      <EditField label="Middle name" error={editFieldErrors.middleName}>
                        <input
                          type="text"
                          value={editForm.middleName}
                          onChange={(event) => updateEditField('middleName', event.target.value)}
                        />
                      </EditField>
                      <EditField label="Last name" error={editFieldErrors.lastName}>
                        <input
                          type="text"
                          value={editForm.lastName}
                          onChange={(event) => updateEditField('lastName', event.target.value)}
                          required
                        />
                      </EditField>
                      <EditField label="Extension" error={editFieldErrors.extensionName}>
                        <input
                          type="text"
                          value={editForm.extensionName}
                          onChange={(event) => updateEditField('extensionName', event.target.value)}
                        />
                      </EditField>
                      <EditField label="Sex" error={editFieldErrors.sex}>
                        <select
                          value={editForm.sex}
                          onChange={(event) => updateEditField('sex', event.target.value)}
                          required
                        >
                          <option value="">Select sex</option>
                          <option value="Male">Male</option>
                          <option value="Female">Female</option>
                        </select>
                      </EditField>
                      <EditField label="Birthdate" error={editFieldErrors.dateOfBirth}>
                        <input
                          type="date"
                          value={editForm.dateOfBirth}
                          onChange={(event) => updateEditField('dateOfBirth', event.target.value)}
                          required
                        />
                      </EditField>
                      <EditField label="Age">
                        <input type="text" value={editForm.age} readOnly />
                      </EditField>
                      <EditField label="Contact number" error={editFieldErrors.contactNumber}>
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={11}
                          value={editForm.contactNumber}
                          onChange={(event) =>
                            updateEditField('contactNumber', event.target.value.replace(/\D/g, '').slice(0, 11))
                          }
                          required
                        />
                      </EditField>
                    </dl>
                  </section>

                  <section className="pending-registration-review-card">
                    <h3>Address</h3>
                    <dl>
                      <EditField label="Street address" error={editFieldErrors.streetAddress}>
                        <input
                          type="text"
                          value={editForm.streetAddress}
                          onChange={(event) => updateEditField('streetAddress', event.target.value)}
                        />
                      </EditField>
                      <EditField label="Barangay" error={editFieldErrors.barangay}>
                        <input
                          type="text"
                          value={editForm.barangay}
                          onChange={(event) => updateEditField('barangay', event.target.value)}
                        />
                      </EditField>
                      <EditField label="City / Municipality" error={editFieldErrors.cityMunicipality}>
                        <input
                          type="text"
                          value={editForm.cityMunicipality}
                          onChange={(event) => updateEditField('cityMunicipality', event.target.value)}
                        />
                      </EditField>
                      <EditField label="Province" error={editFieldErrors.province}>
                        <input
                          type="text"
                          value={editForm.province}
                          onChange={(event) => updateEditField('province', event.target.value)}
                        />
                      </EditField>
                    </dl>
                  </section>

                  {editForm.isStudent ? (
                    <section className="pending-registration-review-card">
                      <h3>School Information</h3>
                      <dl>
                        <EditField label="College" error={editFieldErrors.college}>
                          <select
                            value={editForm.college}
                            onChange={(event) => updateEditField('college', event.target.value)}
                            required
                          >
                            <option value="">Select college</option>
                            {editForm.college && !collegeOptions.includes(editForm.college) ? (
                              <option value={editForm.college}>{editForm.college}</option>
                            ) : null}
                            {collegeOptions.map((college) => (
                              <option key={college} value={college}>
                                {college}
                              </option>
                            ))}
                          </select>
                        </EditField>
                        <EditField label="Program" error={editFieldErrors.program}>
                          <select
                            value={editForm.program}
                            onChange={(event) => updateEditField('program', event.target.value)}
                            disabled={!editForm.college}
                            required
                          >
                            <option value="">{editForm.college ? 'Select program' : 'Select college first'}</option>
                            {editForm.program && !getProgramOptions(editForm.college).includes(editForm.program) ? (
                              <option value={editForm.program}>{editForm.program}</option>
                            ) : null}
                            {getProgramOptions(editForm.college).map((program) => (
                              <option key={program} value={program}>
                                {program}
                              </option>
                            ))}
                          </select>
                        </EditField>
                        <EditField label="Year level" error={editFieldErrors.yearLevel}>
                          <select
                            value={editForm.yearLevel}
                            onChange={(event) => updateEditField('yearLevel', event.target.value)}
                            required
                          >
                            <option value="">Select year level</option>
                            {editForm.yearLevel && !yearLevelOptions.includes(editForm.yearLevel) ? (
                              <option value={editForm.yearLevel}>{editForm.yearLevel}</option>
                            ) : null}
                            {yearLevelOptions.map((yearLevel) => (
                              <option key={yearLevel} value={yearLevel}>
                                {yearLevel}
                              </option>
                            ))}
                          </select>
                        </EditField>
                        <EditField label="Section" error={editFieldErrors.section}>
                          <select
                            value={editForm.section}
                            onChange={(event) => updateEditField('section', event.target.value)}
                          >
                            <option value="">No section</option>
                            {editForm.section && !sectionOptions.includes(editForm.section) ? (
                              <option value={editForm.section}>{editForm.section}</option>
                            ) : null}
                            {sectionOptions.map((section) => (
                              <option key={section} value={section}>
                                {section}
                              </option>
                            ))}
                          </select>
                        </EditField>
                      </dl>
                    </section>
                  ) : (
                    <section className="pending-registration-review-card">
                      <h3>Work Information</h3>
                      <dl>
                        <EditField label="Department" error={editFieldErrors.officeDepartment}>
                          <input
                            type="text"
                            value={editForm.officeDepartment}
                            onChange={(event) => updateEditField('officeDepartment', event.target.value)}
                            required
                          />
                        </EditField>
                        <EditField label="Position" error={editFieldErrors.workPosition}>
                          <input
                            type="text"
                            value={editForm.workPosition}
                            onChange={(event) => updateEditField('workPosition', event.target.value)}
                            required
                          />
                        </EditField>
                      </dl>
                    </section>
                  )}

                  <section className="pending-registration-review-card">
                    <h3>Access</h3>
                    <dl>
                      {editForm.isStudent ? (
                        <EditField label="RFID UID" error={editFieldErrors.rfidUid}>
                          <input
                            type="text"
                            value={editForm.rfidUid}
                            onChange={(event) =>
                              updateEditField(
                                'rfidUid',
                                event.target.value.replace(/\s+/g, '').toUpperCase(),
                              )
                            }
                            placeholder="Enter RFID UID"
                            maxLength={30}
                            autoComplete="off"
                          />
                        </EditField>
                      ) : (
                        <EditField label="Fingerprints">
                          <input
                            type="text"
                            value={
                              editForm.fingerprintCount
                                ? `${editForm.fingerprintCount} active`
                                : 'Not Enrolled'
                            }
                            readOnly
                          />
                        </EditField>
                      )}
                      {!editForm.isStudent ? (
                        <EditField label="RFID UID">
                          <input type="text" value={editForm.rfidUid || 'Not assigned'} readOnly />
                        </EditField>
                      ) : null}
                      <EditField label="Joined">
                        <input type="text" value={editForm.joinedAt || '—'} readOnly />
                      </EditField>
                    </dl>
                  </section>
                </div>
              ) : null}

              <footer>
                <button
                  type="button"
                  className="pending-registration-reject"
                  onClick={() => closeUserEdit()}
                  disabled={isEditSaving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="pending-registration-approve"
                  disabled={isEditLoading || isEditSaving}
                >
                  {isEditSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </footer>
            </form>
          </div>,
          document.body,
        )
      : null}
    {isPhotoExpanded && viewUser?.photo
      ? createPortal(
          <div
            className="pending-registration-photo-lightbox"
            role="presentation"
            onClick={() => setIsPhotoExpanded(false)}
          >
            <button type="button" aria-label="Close expanded photo" onClick={() => setIsPhotoExpanded(false)}>
              <X size={16} aria-hidden="true" />
            </button>
            <img src={viewUser.photo} alt={`${viewUser.name} photo`} onClick={(event) => event.stopPropagation()} />
          </div>,
          document.body,
        )
      : null}
    {editPhotoExpanded && editForm?.photo
      ? createPortal(
          <div
            className="pending-registration-photo-lightbox"
            role="presentation"
            onClick={() => setEditPhotoExpanded(false)}
          >
            <button type="button" aria-label="Close expanded photo" onClick={() => setEditPhotoExpanded(false)}>
              <X size={16} aria-hidden="true" />
            </button>
            <img
              src={editForm.photo}
              alt={`${editForm.firstName || 'User'} photo`}
              onClick={(event) => event.stopPropagation()}
            />
          </div>,
          document.body,
        )
      : null}
    {passwordUser
      ? createPortal(
          <div
            className="pending-registration-review-backdrop"
            role="presentation"
            onClick={() => closePasswordModal()}
          >
            <form
              className="pending-registration-review manage-users-password-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="manage-user-password-title"
              onClick={(event) => event.stopPropagation()}
              onSubmit={handleChangePassword}
            >
              <header>
                <div>
                  <h2 id="manage-user-password-title">Change Password</h2>
                  <p>Set a new password for {passwordUser.name}.</p>
                </div>
                <button
                  type="button"
                  aria-label="Close change password"
                  onClick={() => closePasswordModal()}
                  disabled={isPasswordSaving}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </header>

              <div className="pending-registration-review-body">
                <h3 className="manage-users-password-section-title">New password</h3>
                <dl>
                  <div className="manage-users-edit-field">
                    <dt>Password</dt>
                    <dd>
                      <div className="manage-users-password-input-wrap">
                        <input
                          type={passwordVisibility.newPassword ? 'text' : 'password'}
                          value={passwordForm.newPassword}
                          onChange={(event) => {
                            const value = event.target.value;
                            setPasswordForm((current) => ({
                              ...current,
                              newPassword: value,
                            }));
                            setPasswordError('');
                            setPasswordFieldErrors((current) => ({
                              ...current,
                              newPassword: value ? getPasswordStrengthError(value) : '',
                              confirmPassword:
                                passwordForm.confirmPassword && value !== passwordForm.confirmPassword
                                  ? 'Password and re-entered password must match.'
                                  : '',
                            }));
                          }}
                          autoComplete="new-password"
                          aria-invalid={Boolean(passwordFieldErrors.newPassword)}
                          required
                        />
                        <button
                          type="button"
                          className="manage-users-password-toggle"
                          aria-label={
                            passwordVisibility.newPassword ? 'Hide password' : 'Show password'
                          }
                          onClick={() =>
                            setPasswordVisibility((current) => ({
                              ...current,
                              newPassword: !current.newPassword,
                            }))
                          }
                        >
                          {passwordVisibility.newPassword ? (
                            <EyeOff size={16} aria-hidden="true" />
                          ) : (
                            <Eye size={16} aria-hidden="true" />
                          )}
                        </button>
                      </div>
                      {passwordFieldErrors.newPassword ? (
                        <p className="manage-users-password-field-error" role="alert">
                          {passwordFieldErrors.newPassword}
                        </p>
                      ) : null}
                    </dd>
                  </div>
                  <div className="manage-users-edit-field">
                    <dt>Confirm password</dt>
                    <dd>
                      <div className="manage-users-password-input-wrap">
                        <input
                          type={passwordVisibility.confirmPassword ? 'text' : 'password'}
                          value={passwordForm.confirmPassword}
                          onChange={(event) => {
                            const value = event.target.value;
                            setPasswordForm((current) => ({
                              ...current,
                              confirmPassword: value,
                            }));
                            setPasswordError('');
                            setPasswordFieldErrors((current) => ({
                              ...current,
                              confirmPassword:
                                value && value !== passwordForm.newPassword
                                  ? 'Password and re-entered password must match.'
                                  : '',
                            }));
                          }}
                          autoComplete="new-password"
                          aria-invalid={Boolean(passwordFieldErrors.confirmPassword)}
                          required
                        />
                        <button
                          type="button"
                          className="manage-users-password-toggle"
                          aria-label={
                            passwordVisibility.confirmPassword
                              ? 'Hide confirm password'
                              : 'Show confirm password'
                          }
                          onClick={() =>
                            setPasswordVisibility((current) => ({
                              ...current,
                              confirmPassword: !current.confirmPassword,
                            }))
                          }
                        >
                          {passwordVisibility.confirmPassword ? (
                            <EyeOff size={16} aria-hidden="true" />
                          ) : (
                            <Eye size={16} aria-hidden="true" />
                          )}
                        </button>
                      </div>
                      {passwordFieldErrors.confirmPassword ? (
                        <p className="manage-users-password-field-error" role="alert">
                          {passwordFieldErrors.confirmPassword}
                        </p>
                      ) : passwordForm.confirmPassword &&
                        passwordForm.confirmPassword === passwordForm.newPassword ? (
                        <p className="manage-users-password-field-success">Passwords match.</p>
                      ) : null}
                    </dd>
                  </div>
                </dl>
              </div>

              <footer>
                <button
                  type="button"
                  className="pending-registration-reject"
                  onClick={() => closePasswordModal()}
                  disabled={isPasswordSaving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="pending-registration-approve"
                  disabled={isPasswordSaving}
                >
                  {isPasswordSaving ? 'Updating...' : 'Update Password'}
                </button>
              </footer>
            </form>
          </div>,
          document.body,
        )
      : null}
    {privilegesUser
      ? createPortal(
          <div
            className="pending-registration-review-backdrop"
            role="presentation"
            onClick={() => closePrivilegesModal()}
          >
            <form
              className={`pending-registration-review manage-users-privileges-modal${
                isViewingOwnPrivileges ? ' is-view-only' : ''
              }${isUnblockAsAdminMode ? ' is-unblock-as-admin' : ''}`}
              role="dialog"
              aria-modal="true"
              aria-labelledby="manage-user-privileges-title"
              onClick={(event) => event.stopPropagation()}
              onSubmit={handleSavePrivileges}
            >
              <header>
                <div>
                  <h2 id="manage-user-privileges-title">
                    {isUnblockAsAdminMode
                      ? 'Unblock as Admin'
                      : isViewingOwnPrivileges
                        ? 'My Privileges'
                        : 'Roles & Privileges'}
                  </h2>
                  <p>
                    {isUnblockAsAdminMode
                      ? `Super Admin slots are full. Choose which Admin privileges ${privilegesUser.name} should manage after unblocking.`
                      : isViewingOwnPrivileges
                        ? 'View the role and privileges assigned to your account.'
                        : `Set the role and page access for ${privilegesUser.name}.`}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={
                    isUnblockAsAdminMode
                      ? 'Close unblock as Admin'
                      : 'Close roles and privileges'
                  }
                  onClick={() => closePrivilegesModal()}
                  disabled={isPrivilegesSaving}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </header>

              {isPrivilegesLoading ? (
                <p className="pending-registration-review-note">Loading privileges...</p>
              ) : (
                <div className="pending-registration-review-body manage-users-privileges-body">
                  <section className="manage-users-privileges-role-card">
                    <h3>Role</h3>
                    <div className="manage-users-privileges-role-options" role="radiogroup" aria-label="Account role">
                      {(isUnblockAsAdminMode
                        ? [{ value: 'admin', label: 'Admin' }]
                        : isViewingOwnPrivileges
                          ? [{ value: 'super_admin', label: 'Super Admin' }]
                          : [
                              { value: 'admin', label: 'Admin' },
                              { value: 'super_admin', label: 'Super Admin' },
                            ]
                      ).map((option) => (
                        <label
                          key={option.value}
                          className={`manage-users-privileges-role-option${
                            privilegesRole === option.value ? ' is-selected' : ''
                          }`}
                        >
                          <input
                            type="radio"
                            name="manage-user-role"
                            value={option.value}
                            checked={privilegesRole === option.value}
                            onChange={() => handlePrivilegesRoleChange(option.value)}
                            disabled={
                              isPrivilegesSaving ||
                              isViewingOwnPrivileges ||
                              isUnblockAsAdminMode
                            }
                          />
                          <span>{option.label}</span>
                        </label>
                      ))}
                    </div>
                    <p className="manage-users-privileges-hint">
                      {isUnblockAsAdminMode
                        ? 'This account will be restored as Admin because both Super Admin slots are already in use.'
                        : isViewingOwnPrivileges
                          ? 'Your own privileges are view-only.'
                          : 'Changing the role applies default privileges. You can still uncheck specific access below.'}
                    </p>
                  </section>

                  <section className="manage-users-privileges-list-card">
                    <h3>Privileges</h3>
                    <ul className="manage-users-privileges-list">
                      {privilegesCatalog.map((item) => {
                        const checked = privilegesSelected.includes(item.key);
                        const isRequired = item.key === 'dashboard';

                        return (
                          <li key={item.key}>
                            <label className={checked ? 'is-checked' : undefined}>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={
                                  isPrivilegesSaving || isRequired || isViewingOwnPrivileges
                                }
                                onChange={() => togglePrivilege(item.key)}
                              />
                              <span>
                                <strong>{item.label}</strong>
                                <small>{item.description}</small>
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                </div>
              )}

              <footer>
                <button
                  type="button"
                  className="pending-registration-reject"
                  onClick={() => closePrivilegesModal()}
                  disabled={isPrivilegesSaving}
                >
                  {isViewingOwnPrivileges ? 'Close' : 'Cancel'}
                </button>
                {isViewingOwnPrivileges ? null : (
                  <button
                    type="submit"
                    className="pending-registration-approve"
                    disabled={isPrivilegesLoading || isPrivilegesSaving}
                  >
                    {isPrivilegesSaving
                      ? isUnblockAsAdminMode
                        ? 'Unblocking...'
                        : 'Saving...'
                      : isUnblockAsAdminMode
                        ? 'Unblock as Admin'
                        : 'Save Privileges'}
                  </button>
                )}
              </footer>
            </form>
          </div>,
          document.body,
        )
      : null}
    <DeleteRequestModal
      open={Boolean(deleteRequest)}
      actorId={currentUser?.id}
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
    <ErrorNoticeModal
      open={Boolean(errorMessage)}
      message={errorMessage}
      onClose={() => setErrorMessage('')}
    />
    <ErrorNoticeModal
      open={Boolean(viewError)}
      message={viewError}
      onClose={() => setViewError('')}
    />
    <ErrorNoticeModal
      open={Boolean(editError)}
      message={editError}
      onClose={() => setEditError('')}
    />
    <ErrorNoticeModal
      open={Boolean(passwordError)}
      message={passwordError}
      onClose={() => setPasswordError('')}
    />
    <ErrorNoticeModal
      open={Boolean(privilegesError)}
      message={privilegesError}
      onClose={() => setPrivilegesError('')}
    />
    </>
  );
}
