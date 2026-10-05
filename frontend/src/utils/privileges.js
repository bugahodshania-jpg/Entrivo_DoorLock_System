export const PRIVILEGE_META = {
  dashboard: {
    label: 'Dashboard',
    path: '/super-admin/dashboard',
  },
  manage_users: {
    label: 'Manage Users',
    path: '/super-admin/manage-users',
  },
  delete_users: {
    label: 'Delete Users',
    path: null,
  },
  pending_registrations: {
    label: 'Pending Registration',
    path: '/super-admin/pending-registrations',
  },
  fingerprint: {
    label: 'Fingerprint',
    path: '/super-admin/fingerprint',
  },
  fingerprint_update: {
    label: 'Update Fingerprints',
    path: null,
  },
  rfid_cards: {
    label: 'RFID Cards',
    path: '/super-admin/rfid-cards',
  },
  schedules: {
    label: 'Schedules',
    path: '/super-admin/schedules',
  },
  pending_overrides: {
    label: 'Pending Overrides',
    path: '/super-admin/pending-overrides',
  },
  access_logs: {
    label: 'Access Logs',
    path: '/super-admin/access-logs',
  },
  activity_logs: {
    label: 'Activity Logs',
    path: '/super-admin/activity-logs',
  },
  reports: {
    label: 'Reports',
    path: '/super-admin/reports',
  },
  settings: {
    label: 'Settings',
    path: '/super-admin/settings',
  },
};

export const PRIVILEGE_PATHS = Object.fromEntries(
  Object.entries(PRIVILEGE_META)
    .filter(([, meta]) => meta.path)
    .map(([key, meta]) => [key, meta.path]),
);

export const ROLE_PRIVILEGE_DEFAULTS = {
  super_admin: Object.keys(PRIVILEGE_META),
  admin: [
    'dashboard',
    'manage_users',
    'pending_registrations',
    'fingerprint',
    'fingerprint_update',
    'rfid_cards',
    'schedules',
    'pending_overrides',
    'access_logs',
    'activity_logs',
    'reports',
    'settings',
  ],
};

export function normalizePrivileges(privileges, role = 'admin') {
  const list = Array.isArray(privileges) ? privileges.map(String) : [];
  const allowed = Object.keys(PRIVILEGE_META);
  const filtered = list.filter((key) => allowed.includes(key));

  if (filtered.length > 0) {
    return filtered.includes('dashboard') ? filtered : ['dashboard', ...filtered];
  }

  return ROLE_PRIVILEGE_DEFAULTS[role] || ROLE_PRIVILEGE_DEFAULTS.admin;
}

export function userHasPrivilege(user, privilegeKey) {
  if (!privilegeKey) {
    return true;
  }

  const privileges = normalizePrivileges(user?.privileges, user?.role);
  return privileges.includes(privilegeKey);
}

export function normalizePortalPath(pathname) {
  return String(pathname || '').replace(/^\/admin(?=\/|$)/, '/super-admin');
}

export function currentPortalBase() {
  const path = window.location.pathname;

  if (path === '/admin' || path.startsWith('/admin/')) {
    return '/admin';
  }

  return '/super-admin';
}

export function portalHref(path) {
  const suffix = String(path || '').replace(/^\/(?:super-admin|admin)/, '');
  const normalizedSuffix = suffix.startsWith('/') ? suffix : `/${suffix}`;

  return `${currentPortalBase()}${normalizedSuffix}`;
}

export function canDeleteRecords(user) {
  return user?.role === 'super_admin';
}

export function privilegeForPath(pathname) {
  const path = normalizePortalPath(pathname);
  const exact = Object.entries(PRIVILEGE_PATHS).find(([, privilegePath]) => privilegePath === path);

  if (exact) {
    return exact[0];
  }

  if (path.startsWith('/super-admin/register-user')) {
    return 'manage_users';
  }

  if (path === '/super-admin/profile') {
    return null;
  }

  return null;
}

export function firstAllowedSuperAdminPath(user) {
  const privileges = normalizePrivileges(user?.privileges, user?.role);

  for (const key of privileges) {
    if (PRIVILEGE_PATHS[key]) {
      return PRIVILEGE_PATHS[key];
    }
  }

  return '/super-admin/dashboard';
}

export function firstAllowedPortalPath(user) {
  const path = firstAllowedSuperAdminPath(user);

  if (user?.role === 'admin') {
    return path.replace(/^\/super-admin/, '/admin');
  }

  return path;
}
