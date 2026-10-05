import './styles/global/global.css';
import { useEffect, useState } from 'react';
import AdminLayout from './pages/admin/AdminLayout.jsx';
import Register from './pages/auth/Register.jsx';
import Login from './pages/auth/Login.jsx';
import Home from './pages/shared/Home.jsx';
import NotFound from './pages/shared/NotFound.jsx';
import AccessLogs from './pages/superAdmin/AccessLogs.jsx';
import ActivityLogs from './pages/superAdmin/ActivityLogs.jsx';
import Fingerprint from './pages/superAdmin/Fingerprint.jsx';
import ManageUsers from './pages/superAdmin/ManageUsers.jsx';
import PendingRegistrations from './pages/superAdmin/PendingRegistrations.jsx';
import PendingOverrides from './pages/superAdmin/PendingOverrides.jsx';
import RegisterUser from './pages/superAdmin/RegisterUser.jsx';
import Reports from './pages/superAdmin/Reports.jsx';
import RFIDCards from './pages/superAdmin/RFIDCards.jsx';
import Schedules from './pages/superAdmin/Schedules.jsx';
import Settings from './pages/superAdmin/Settings.jsx';
import ViewProfile from './pages/superAdmin/ViewProfile.jsx';
import SuperAdminDashboard from './pages/superAdmin/SuperAdminDashboard.jsx';
import SuperAdminLayout from './pages/superAdmin/SuperAdminLayout.jsx';
import UserLayout from './pages/user/UserLayout.jsx';
import UserDashboard from './pages/user/UserDashboard.jsx';
import MyAccount from './pages/user/MyAccount.jsx';
import UserAccessLogs from './pages/user/UserAccessLogs.jsx';
import UserActivityLogs from './pages/user/UserActivityLogs.jsx';
import RequestOverride from './pages/user/RequestOverride.jsx';
import MySchedule from './pages/user/MySchedule.jsx';
import {
  firstAllowedPortalPath,
  firstAllowedSuperAdminPath,
  privilegeForPath,
  userHasPrivilege,
} from './utils/privileges';
import './styles/global/responsive.css';

const superAdminRoutes = {
  '/super-admin/dashboard': SuperAdminDashboard,
  '/super-admin/manage-users': ManageUsers,
  '/super-admin/pending-registrations': PendingRegistrations,
  '/super-admin/register-user': RegisterUser,
  '/super-admin/fingerprint': Fingerprint,
  '/super-admin/rfid-cards': RFIDCards,
  '/super-admin/schedules': Schedules,
  '/super-admin/pending-overrides': PendingOverrides,
  '/super-admin/access-logs': AccessLogs,
  '/super-admin/activity-logs': ActivityLogs,
  '/super-admin/reports': Reports,
  '/super-admin/profile': ViewProfile,
  '/super-admin/settings': Settings,
};

const adminRoutes = Object.fromEntries(
  Object.entries(superAdminRoutes).map(([route, page]) => [route.replace('/super-admin', '/admin'), page]),
);

const userPortalRoutes = {
  '/user/dashboard': UserDashboard,
  '/user/my-account': MyAccount,
  '/user/access-logs': UserAccessLogs,
  '/user/activity-logs': UserActivityLogs,
  '/user/request-override': RequestOverride,
  '/user/my-schedule': MySchedule,
};

function getStoredUser() {
  const savedUser =
    window.localStorage.getItem('entrivo_user') ||
    window.sessionStorage.getItem('entrivo_user');

  if (!savedUser) {
    return null;
  }

  try {
    return JSON.parse(savedUser);
  } catch {
    window.localStorage.removeItem('entrivo_user');
    window.sessionStorage.removeItem('entrivo_user');
    return null;
  }
}

function getStoredUserLocation() {
  if (window.localStorage.getItem('entrivo_user')) {
    return window.localStorage;
  }

  if (window.sessionStorage.getItem('entrivo_user')) {
    return window.sessionStorage;
  }

  return null;
}

function logout(reasonMessage = '') {
  const savedUser =
    window.localStorage.getItem('entrivo_user') ||
    window.sessionStorage.getItem('entrivo_user');

  if (savedUser) {
    try {
      const storedUser = JSON.parse(savedUser);
      if (storedUser?.id && storedUser?.username) {
        fetch('http://127.0.0.1:8000/api/auth.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'logout',
            user_id: storedUser.id,
            username: storedUser.username,
          }),
          keepalive: true,
        }).catch(() => {});
      }
    } catch {
      // Continue logout even if the stored profile cannot be read.
    }
  }

  window.localStorage.removeItem('entrivo_user');
  window.sessionStorage.removeItem('entrivo_user');

  if (reasonMessage) {
    window.sessionStorage.setItem('entrivo_login_notice', reasonMessage);
  }

  window.location.assign('/login');
}

export default function App() {
  const path = window.location.pathname;
  const [user, setUser] = useState(() => getStoredUser());

  useEffect(() => {
    if (!user?.id || path === '/' || path === '/login' || path === '/register') {
      return undefined;
    }

    let isActive = true;

    async function refreshUser() {
      try {
        const response = await fetch(`http://127.0.0.1:8000/api/auth.php?user_id=${encodeURIComponent(user.id)}`);
        const data = await response.json();

        if (!response.ok) {
          if (data?.code === 'super_admin_session_taken' || response.status === 409) {
            logout(data?.message || 'Another Super Admin is currently active. Only one Super Admin can be active at a time. Please try again later.');
            return;
          }

          throw new Error(data.message || 'Unable to refresh user profile.');
        }

        if (!isActive) {
          return;
        }

        const refreshedUser = {
          ...user,
          ...data.user,
        };
        const storage = getStoredUserLocation();
        storage?.setItem('entrivo_user', JSON.stringify(refreshedUser));
        setUser(refreshedUser);
      } catch {
        // Keep the currently stored login data if the profile refresh is unavailable.
      }
    }

    refreshUser();

    return () => {
      isActive = false;
    };
  }, [path, user?.id]);

  useEffect(() => {
    if (user?.role !== 'super_admin' || !user?.id) {
      return undefined;
    }

    let isActive = true;

    async function sendHeartbeat() {
      try {
        const response = await fetch('http://127.0.0.1:8000/api/auth.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'super_admin_heartbeat',
            user_id: user.id,
          }),
        });
        const data = await response.json().catch(() => ({}));

        if (!isActive) {
          return;
        }

        if (!response.ok || data?.code === 'super_admin_session_taken') {
          logout(data?.message || 'Another Super Admin is currently active. Only one Super Admin can be active at a time. Please try again later.');
        }
      } catch {
        // Ignore transient heartbeat failures; the next tick retries.
      }
    }

    sendHeartbeat();
    const intervalId = window.setInterval(sendHeartbeat, 30000);

    return () => {
      isActive = false;
      window.clearInterval(intervalId);
    };
  }, [user?.id, user?.role]);

  if (path === '/') {
    return <Home />;
  }

  if (path === '/login') {
    return <Login />;
  }

  if (path === '/register') {
    return <Register />;
  }

  if (superAdminRoutes[path]) {
    if (user?.role === 'admin') {
      window.location.replace(`${path.replace('/super-admin', '/admin')}${window.location.search}`);
      return null;
    }

    if (user?.role !== 'super_admin') {
      window.location.replace('/login');
      return null;
    }

    const requiredPrivilege = privilegeForPath(path);

    if (requiredPrivilege && !userHasPrivilege(user, requiredPrivilege)) {
      window.location.replace(firstAllowedSuperAdminPath(user));
      return null;
    }

    const SuperAdminPage = superAdminRoutes[path];

    return (
      <SuperAdminLayout user={user} onLogout={logout}>
        <SuperAdminPage user={user} onLogout={logout} />
      </SuperAdminLayout>
    );
  }

  if (adminRoutes[path]) {
    if (user?.role === 'super_admin') {
      window.location.replace(`${path.replace('/admin', '/super-admin')}${window.location.search}`);
      return null;
    }

    if (user?.role !== 'admin') {
      window.location.replace('/login');
      return null;
    }

    const requiredPrivilege = privilegeForPath(path);

    if (requiredPrivilege && !userHasPrivilege(user, requiredPrivilege)) {
      window.location.replace(firstAllowedPortalPath(user));
      return null;
    }

    const AdminPage = adminRoutes[path];

    return (
      <AdminLayout user={user} onLogout={logout}>
        <AdminPage user={user} onLogout={logout} />
      </AdminLayout>
    );
  }

  if (userPortalRoutes[path]) {
    const isFacultyOrStaff = user?.role === 'faculty' || user?.role === 'staff';

    if (!isFacultyOrStaff) {
      window.location.replace('/login');
      return null;
    }

    const UserPage = userPortalRoutes[path];

    return (
      <UserLayout user={user} onLogout={logout}>
        <UserPage user={user} onLogout={logout} />
      </UserLayout>
    );
  }

  return <NotFound />;
}
