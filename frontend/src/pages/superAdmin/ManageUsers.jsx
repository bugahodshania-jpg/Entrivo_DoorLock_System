import { useEffect, useMemo, useState } from 'react';
import { Download, Eye, Mars, Pencil, Search, Trash2, UserPlus, Users, Venus } from 'lucide-react';
import axiosClient from '../../api/axiosClient';
import RowActionMenu from '../../components/RowActionMenu';
import { getManilaDateStamp } from '../../utils/dateTime';
import '../../styles/superAdmin/dashboard.css';
import '../../styles/superAdmin/users.css';

function escapeCsvValue(value) {
  const text = value == null ? '' : String(value);
  const escaped = text.replace(/"/g, '""');

  if (/[",\n\r]/.test(escaped)) {
    return `"${escaped}"`;
  }

  return escaped;
}

function toCsv(rows) {
  return rows.map((row) => row.map(escapeCsvValue).join(',')).join('\r\n');
}

const userTabs = [
  {
    key: 'faculty',
    label: 'Faculty Users',
    emptyLabel: 'faculty users',
    identifierLabel: 'Employee ID',
    columns: ['User', 'Employee ID', 'Sex', 'Department', 'Position', 'Access Setup', 'Action'],
  },
  {
    key: 'staff',
    label: 'Staff',
    emptyLabel: 'staff users',
    identifierLabel: 'Employee ID',
    columns: ['User', 'Employee ID', 'Sex', 'Department', 'Position', 'Access Setup', 'Action'],
  },
  {
    key: 'admins',
    label: 'Admins',
    emptyLabel: 'admin users',
    identifierLabel: 'Employee ID',
    columns: ['User', 'Employee ID', 'Sex', 'Department', 'Position', 'Access Setup', 'Action'],
  },
  {
    key: 'students',
    label: 'Student',
    emptyLabel: 'student users',
    identifierLabel: 'School ID',
    columns: ['User', 'School ID', 'Sex', 'Program', 'Year / Section', 'Access Setup', 'Action'],
  },
];

const initialUsers = {
  faculty: [],
  staff: [],
  admins: [],
  students: [],
};

function formatAccessSetup(user) {
  const fingerprintLabel =
    user.fingerprintCount > 0
      ? `${user.fingerprintCount} fingerprint${user.fingerprintCount > 1 ? 's' : ''}`
      : 'No fingerprint';

  return {
    rfid: user.rfidStatus === 'unassigned' ? 'No RFID' : `${user.rfidStatus} RFID`,
    fingerprint: fingerprintLabel,
  };
}

function getSexTotal(usersByRole, sex) {
  return Object.values(usersByRole)
    .flat()
    .filter((user) => user.sex?.toLowerCase() === sex)
    .length;
}

export default function ManageUsers() {
  const [activeTab, setActiveTab] = useState(userTabs[0].key);
  const [usersByRole, setUsersByRole] = useState(initialUsers);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    let isActive = true;

    async function loadUsers() {
      try {
        const response = await axiosClient.get('/api/user.php');

        if (!isActive) {
          return;
        }

        setUsersByRole({
          ...initialUsers,
          ...response.data.users,
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

  const activeTabConfig = userTabs.find((tab) => tab.key === activeTab) || userTabs[0];
  const activeUsers = usersByRole[activeTabConfig.key] || [];
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const visibleUsers = useMemo(() => {
    if (!normalizedSearchQuery) {
      return activeUsers;
    }

    return activeUsers.filter((user) => {
      const accessSetup = formatAccessSetup(user);
      const isStudent = activeTabConfig.key === 'students';

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
            accessSetup.rfid,
            accessSetup.fingerprint,
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
            user.role?.replace('_', ' '),
            accessSetup.rfid,
            accessSetup.fingerprint,
          ];

      return searchableValues
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearchQuery));
    });
  }, [activeTabConfig.key, activeUsers, normalizedSearchQuery]);
  const totalUsers = useMemo(
    () => Object.values(usersByRole).reduce((total, users) => total + users.length, 0),
    [usersByRole],
  );
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

  function handleDownloadCsv() {
    const isStudent = activeTabConfig.key === 'students';
    const csvColumns = activeTabConfig.columns.filter((column) => column !== 'Action');
    const csvRows = [
      csvColumns,
      ...visibleUsers.map((user) => {
        const accessSetup = formatAccessSetup(user);
        const idCell = `${user.identifier}${user.status ? ` - ${user.status}` : ''}`;
        const departmentCell = isStudent
          ? `${user.programDepartment || 'Not assigned'} - ${user.college || 'No college set'}`
          : `${user.officeDepartment || 'Not assigned'}${user.contactNumber ? ` - ${user.contactNumber}` : ''}`;
        const positionCell = isStudent
          ? `${user.yearLevel || 'Not set'} - ${user.section || 'No section'}`
          : `${user.workPosition || 'Not assigned'} - ${user.role.replace('_', ' ')}`;

        const accessSetupCell = isStudent
          ? `${accessSetup.rfid} - ${accessSetup.fingerprint}`
          : `${accessSetup.fingerprint} - ${accessSetup.rfid}`;

        return [
          `${user.name}${user.email ? ` - ${user.email}` : ''}`,
          idCell,
          user.sex || 'N/A',
          departmentCell,
          positionCell,
          accessSetupCell,
        ];
      }),
    ];
    const csv = toCsv(csvRows);
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${activeTabConfig.key}_users_${getManilaDateStamp()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  const registerButtonLabel = useMemo(() => {
    const roleLabels = {
      faculty: 'Faculty',
      staff: 'Staff',
      admins: 'Admin',
      students: 'Student',
    };

    return `Register ${roleLabels[activeTabConfig.key] || 'User'}`;
  }, [activeTabConfig.key]);
  function handleRegisterUser() {
    const role = encodeURIComponent(activeTabConfig.key);
    window.location.assign(`/super-admin/register-user?role=${role}`);
  }

  return (
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
            <button
              type="button"
              className="manage-users-register-button"
              onClick={handleRegisterUser}
              disabled={isLoading || Boolean(errorMessage)}
            >
              <UserPlus size={16} aria-hidden="true" />
              {registerButtonLabel}
            </button>
            <div className="manage-users-search-stack">
              <button
                type="button"
                className="dashboard-text-link manage-users-download-button"
                onClick={handleDownloadCsv}
                disabled={isLoading || Boolean(errorMessage) || visibleUsers.length === 0}
              >
                <Download size={16} aria-hidden="true" />
                Download CSV
              </button>
              <label className="manage-users-search" aria-label="Search users">
                <Search size={16} aria-hidden="true" />
                <input
                  type="search"
                  placeholder={`Search ${activeTabConfig.label.toLowerCase()}...`}
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
              </label>
            </div>
          </div>
        </div>

        <div className="manage-users-tabs-frame">
          <nav className="manage-users-tabs" aria-label="User type filters">
            {userTabs.map((tab) => (
              <button
                type="button"
                className={activeTab === tab.key ? 'is-active' : ''}
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
              >
                <span>{tab.label}</span>
                <small>{isLoading ? '--' : usersByRole[tab.key]?.length || 0}</small>
              </button>
            ))}
          </nav>
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
                      : `No ${activeTabConfig.emptyLabel} found.`}
                  </td>
                </tr>
              )}

              {!isLoading &&
                !errorMessage &&
                visibleUsers.map((user) => {
                  const accessSetup = formatAccessSetup(user);
                  const isStudent = activeTabConfig.key === 'students';

                  return (
                    <tr key={user.id}>
                      <td>
                        <strong>{user.name}</strong>
                        <span>{user.email}</span>
                      </td>
                      <td>
                        <strong>{user.identifier}</strong>
                        <span className={`dashboard-log-status manage-users-status-${user.status}`}>
                          {user.status}
                        </span>
                      </td>
                      <td>{user.sex || 'N/A'}</td>
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
                          <>
                            <strong>{user.workPosition || 'Not assigned'}</strong>
                            <span>{user.role.replace('_', ' ')}</span>
                          </>
                        )}
                      </td>
                      <td>
                        {isStudent ? (
                          <>
                            <strong>{accessSetup.rfid}</strong>
                            <span>{accessSetup.fingerprint}</span>
                          </>
                        ) : (
                          <>
                            <strong>{accessSetup.fingerprint}</strong>
                            <span>{accessSetup.rfid}</span>
                          </>
                        )}
                      </td>
                      <td>
                        <RowActionMenu
                          label={`Actions for ${user.name}`}
                          items={[
                            { label: 'View', icon: Eye },
                            { label: 'Edit', icon: Pencil },
                            { label: 'Delete', icon: Trash2, danger: true },
                          ]}
                        />
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
