import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Ban,
  Check,
  ChevronDown,
  Download,
  Expand,
  Eye,
  EyeOff,
  KeyRound,
  Mars,
  Pencil,
  Search,
  Shield,
  Trash2,
  Unlock,
  UserPlus,
  Users,
  Venus,
  X,
} from 'lucide-react';
import axiosClient from '../../api/axiosClient';
import { useActionConfirm } from '../../components/ActionConfirm';
import ExportFormatModal from '../../components/ExportFormatModal';
import RowActionMenu from '../../components/RowActionMenu';
import { getManilaDateStamp } from '../../utils/dateTime';
import { buildExportNote, exportTable } from '../../utils/exportFiles';
import { ROLE_PRIVILEGE_DEFAULTS, canDeleteRecords, portalHref, userHasPrivilege } from '../../utils/privileges';
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

function getSexTotal(usersByRole, sex) {
  return Object.values(usersByRole)
    .flat()
    .filter((user) => user.sex?.toLowerCase() === sex)
    .length;
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

function EditField({ label, wide = false, children }) {
  return (
    <div className={wide ? 'is-wide manage-users-edit-field' : 'manage-users-edit-field'}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export default function ManageUsers({ user: currentUser } = {}) {
  const confirmAction = useActionConfirm();
  const roleFilterMenuRef = useRef(null);
  const statusFilterMenuRef = useRef(null);
  const [activeTab, setActiveTab] = useState('all');
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
  const [editPhotoExpanded, setEditPhotoExpanded] = useState(false);
  const [isDeletingUserId, setIsDeletingUserId] = useState(null);
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

  const activeTabConfig =
    roleFilterOptions.find((tab) => tab.key === activeTab) || allUsersFilter;
  const activeStatusFilterConfig =
    statusFilterOptions.find((option) => option.value === activeStatusFilter) ||
    statusFilterOptions[0];
  const activeUsers = useMemo(
    () => getUsersForRoleFilter(activeTabConfig.key, usersByRole),
    [activeTabConfig.key, usersByRole],
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
    () => Object.values(usersByRole).reduce((total, users) => total + users.length, 0),
    [usersByRole],
  );
  const roleFilterCounts = useMemo(() => {
    const counts = { all: totalUsers };

    roleFilterOptions.forEach((option) => {
      if (option.key === 'all') {
        return;
      }

      counts[option.key] = getUsersForRoleFilter(option.key, usersByRole).length;
    });

    return counts;
  }, [totalUsers, usersByRole]);
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
  const totalMale = useMemo(() => getSexTotal(usersByRole, 'male'), [usersByRole]);
  const totalFemale = useMemo(() => getSexTotal(usersByRole, 'female'), [usersByRole]);
  const summaryCards = [
    {
      label: 'Total Users',
      value: totalUsers,
      detail: 'Registered accounts',
      icon: Users,
    },
    {
      label: 'Total Male',
      value: totalMale,
      detail: 'Male user profiles',
      icon: Mars,
    },
    {
      label: 'Total Female',
      value: totalFemale,
      detail: 'Female user profiles',
      icon: Venus,
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
    setEditError('');
    setIsEditLoading(true);
    setEditPhotoExpanded(false);

    try {
      const response = await axiosClient.get('/api/user.php', { params: { id: user.id } });
      const detailedUser = response.data.user;

      if (detailedUser) {
        setEditForm(buildEditForm(detailedUser));
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
      setEditError(error.response?.data?.message || 'Unable to save user changes right now.');
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
    if (currentUser?.role === 'admin' && !['students', 'admins'].includes(activeTabConfig.key)) {
      return;
    }

    if (activeTabConfig.key === 'all') {
      window.location.assign(portalHref('/super-admin/register-user'));
      return;
    }

    if (activeTabConfig.key === 'super_admins') {
      window.location.assign(portalHref('/super-admin/register-user?role=super_admin'));
      return;
    }

    const role = encodeURIComponent(activeTabConfig.key);
    window.location.assign(portalHref(`/super-admin/register-user?role=${role}`));
  }

  const canRegisterCurrentTab =
    currentUser?.role !== 'admin' || activeTabConfig.key === 'students' || activeTabConfig.key === 'admins';

  return (
    <>
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
          <div className="manage-users-header-actions" aria-label="Manage user actions">
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
            <div className="manage-users-search-stack">
              <button
                type="button"
                className="dashboard-text-link manage-users-download-button"
                onClick={() => setIsExportModalOpen(true)}
                disabled={isLoading || Boolean(errorMessage) || visibleUsers.length === 0}
              >
                <Download size={16} aria-hidden="true" />
                Download
              </button>
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
                {roleFilterOptions.map((option) => (
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

              {!isLoading && errorMessage && (
                <tr>
                  <td className="dashboard-recent-empty" colSpan={activeTabConfig.columns.length}>
                    {errorMessage}
                  </td>
                </tr>
              )}

              {!isLoading && !errorMessage && visibleUsers.length === 0 && (
                <tr>
                  <td className="dashboard-recent-empty" colSpan={activeTabConfig.columns.length}>
                    {normalizedSearchQuery
                      ? `No ${activeTabConfig.emptyLabel} match your search.`
                      : activeStatusFilter !== 'all'
                        ? `No ${activeStatusFilterConfig.label.toLowerCase()} ${activeTabConfig.emptyLabel} found.`
                        : `No ${activeTabConfig.emptyLabel} found.`}
                  </td>
                </tr>
              )}

              {!isLoading &&
                !errorMessage &&
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
                              onClick: () => handleDeleteUser(user),
                              disabled: isDeletingUserId === user.id,
                              hidden:
                                !canDeleteRecords(currentUser) ||
                                !userHasPrivilege(currentUser, 'delete_users') ||
                                (Boolean(currentUser?.id) &&
                                  Number(currentUser.id) === Number(user.id)),
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

        {!isLoading && !errorMessage && visibleUsers.length > 0 && (
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
              {viewError ? <p className="pending-registration-error" role="alert">{viewError}</p> : null}
              {!isViewLoading && !viewError && viewGroups.length > 0 ? (
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
              {editError ? <p className="pending-registration-error" role="alert">{editError}</p> : null}

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
                        <EditField label="Username">
                          <input
                            type="text"
                            value={editForm.username}
                            onChange={(event) => updateEditField('username', event.target.value)}
                            required
                          />
                        </EditField>
                        <EditField label="Email">
                          <input
                            type="email"
                            value={editForm.email}
                            onChange={(event) => updateEditField('email', event.target.value)}
                            required
                          />
                        </EditField>
                        <EditField label={editForm.identifierLabel}>
                          <input
                            type="text"
                            value={editForm.identifier}
                            onChange={(event) => updateEditField('identifier', event.target.value)}
                            required
                          />
                        </EditField>
                        <EditField label="Status">
                          <select
                            value={editForm.status}
                            onChange={(event) => updateEditField('status', event.target.value)}
                            required
                          >
                            <option value="active">active</option>
                            <option value="inactive">inactive</option>
                            <option value="blocked">blocked</option>
                          </select>
                        </EditField>
                      </dl>
                    </section>
                  </div>

                  <section className="pending-registration-review-card">
                    <h3>Personal Information</h3>
                    <dl>
                      <EditField label="First name">
                        <input
                          type="text"
                          value={editForm.firstName}
                          onChange={(event) => updateEditField('firstName', event.target.value)}
                          required
                        />
                      </EditField>
                      <EditField label="Middle name">
                        <input
                          type="text"
                          value={editForm.middleName}
                          onChange={(event) => updateEditField('middleName', event.target.value)}
                        />
                      </EditField>
                      <EditField label="Last name">
                        <input
                          type="text"
                          value={editForm.lastName}
                          onChange={(event) => updateEditField('lastName', event.target.value)}
                          required
                        />
                      </EditField>
                      <EditField label="Extension">
                        <input
                          type="text"
                          value={editForm.extensionName}
                          onChange={(event) => updateEditField('extensionName', event.target.value)}
                        />
                      </EditField>
                      <EditField label="Sex">
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
                      <EditField label="Birthdate">
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
                      <EditField label="Contact number">
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
                      <EditField label="Street address">
                        <input
                          type="text"
                          value={editForm.streetAddress}
                          onChange={(event) => updateEditField('streetAddress', event.target.value)}
                        />
                      </EditField>
                      <EditField label="Barangay">
                        <input
                          type="text"
                          value={editForm.barangay}
                          onChange={(event) => updateEditField('barangay', event.target.value)}
                        />
                      </EditField>
                      <EditField label="City / Municipality">
                        <input
                          type="text"
                          value={editForm.cityMunicipality}
                          onChange={(event) => updateEditField('cityMunicipality', event.target.value)}
                        />
                      </EditField>
                      <EditField label="Province">
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
                        <EditField label="College">
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
                        <EditField label="Program">
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
                        <EditField label="Year level">
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
                        <EditField label="Section">
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
                        <EditField label="Department">
                          <input
                            type="text"
                            value={editForm.officeDepartment}
                            onChange={(event) => updateEditField('officeDepartment', event.target.value)}
                            required
                          />
                        </EditField>
                        <EditField label="Position">
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
                        <EditField label="RFID UID">
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

              {passwordError ? (
                <p className="pending-registration-error" role="alert">
                  {passwordError}
                </p>
              ) : null}

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

              {privilegesError ? (
                <p className="pending-registration-error" role="alert">
                  {privilegesError}
                </p>
              ) : null}

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
    </>
  );
}
