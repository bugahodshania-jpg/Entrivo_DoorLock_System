import './styles/global/global.css';
import { useEffect, useState } from 'react';
import AdminDashboard from './pages/admin/AdminDashboard.jsx';
import Register from './pages/auth/Register.jsx';
import Login from './pages/auth/Login.jsx';
import Home from './pages/shared/Home.jsx';
import NotFound from './pages/shared/NotFound.jsx';
import AccessLogs from './pages/superAdmin/AccessLogs.jsx';
import ActivityLogs from './pages/superAdmin/ActivityLogs.jsx';
import Fingerprint from './pages/superAdmin/Fingerprint.jsx';
import ManageUsers from './pages/superAdmin/ManageUsers.jsx';
import PendingRegistrations from './pages/superAdmin/PendingRegistrations.jsx';
import RegisterUser from './pages/superAdmin/RegisterUser.jsx';
import Reports from './pages/superAdmin/Reports.jsx';
import RFIDCards from './pages/superAdmin/RFIDCards.jsx';
import Schedules from './pages/superAdmin/Schedules.jsx';
import Settings from './pages/superAdmin/Settings.jsx';
import ViewProfile from './pages/superAdmin/ViewProfile.jsx';
import SuperAdminDashboard from './pages/superAdmin/SuperAdminDashboard.jsx';
import SuperAdminLayout from './pages/superAdmin/SuperAdminLayout.jsx';

const superAdminRoutes = {
  '/super-admin/dashboard': SuperAdminDashboard,
  '/super-admin/manage-users': ManageUsers,
  '/super-admin/pending-registrations': PendingRegistrations,
  '/super-admin/register-user': RegisterUser,
  '/super-admin/fingerprint': Fingerprint,
  '/super-admin/rfid-cards': RFIDCards,
  '/super-admin/schedules': Schedules,
  '/super-admin/access-logs': AccessLogs,
  '/super-admin/activity-logs': ActivityLogs,
  '/super-admin/reports': Reports,
  '/super-admin/profile': ViewProfile,
  '/super-admin/settings': Settings,
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

function logout() {
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
    if (user?.role !== 'super_admin') {
      window.location.replace('/login');
      return null;
    }

    const SuperAdminPage = superAdminRoutes[path];

    return (
      <SuperAdminLayout user={user} onLogout={logout}>
        <SuperAdminPage user={user} onLogout={logout} />
      </SuperAdminLayout>
    );
  }

  if (path === '/admin/dashboard') {
    if (user?.role !== 'admin') {
      window.location.replace('/login');
      return null;
    }

    return <AdminDashboard user={user} onLogout={logout} />;
  }

  return <NotFound />;
}
