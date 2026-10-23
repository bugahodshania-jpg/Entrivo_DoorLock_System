const LOGIN_CATEGORIES = new Set(['login', 'logout']);
const SYSTEM_CATEGORIES = new Set(['job', 'sync']);

export const LOG_GROUPS = {
  login: {
    key: 'login',
    title: 'Login Logs',
    description: 'Sign-in and sign-out attempts, including failed logins.',
    userDescription: 'Your sign-in and sign-out attempts, including failed logins.',
    empty: 'No login activity has been recorded yet.',
    filteredEmpty: 'No login logs match these filters.',
    userFilteredEmpty: 'No login logs match the current filters.',
    loadError: 'Unable to load login logs right now.',
    loading: 'Loading login logs...',
    exportTitle: 'Login Logs',
    userExportTitle: 'My Login Logs',
    fileBase: 'login_logs',
    userFileBase: 'my_login_logs',
    exportPrompt: 'Only the login logs matching the current filters will be exported. Choose the file format.',
    categories: [
      { value: 'login', label: 'Login' },
      { value: 'logout', label: 'Logout' },
    ],
  },
  activity: {
    key: 'activity',
    title: 'Activity Logs',
    description: 'User, account, schedule, credential, and access actions recorded in the system.',
    userDescription: 'Your account, schedule, credential, and access actions.',
    empty: 'No activity has been recorded yet.',
    filteredEmpty: 'No activity matches these filters.',
    userFilteredEmpty: 'No activity logs match the current filters.',
    loadError: 'Unable to load activity logs right now.',
    loading: 'Loading activity logs...',
    exportTitle: 'Activity Logs',
    userExportTitle: 'My Activity Logs',
    fileBase: 'activity_logs',
    userFileBase: 'my_activity_logs',
    exportPrompt: 'Only the activity logs matching the current filters will be exported. Choose the file format.',
    categories: [
      { value: 'access', label: 'Access' },
      { value: 'password', label: 'Password' },
      { value: 'recovery', label: 'Recovery' },
      { value: 'account', label: 'Account' },
      { value: 'security', label: 'Security' },
      { value: 'user', label: 'User' },
      { value: 'registration', label: 'Registration' },
      { value: 'schedule', label: 'Schedule' },
      { value: 'override', label: 'Override' },
      { value: 'enroll', label: 'Enroll' },
      { value: 'update', label: 'Update' },
      { value: 'delete', label: 'Delete' },
      { value: 'rfid', label: 'RFID' },
    ],
  },
  system: {
    key: 'system',
    title: 'System Logs',
    description: 'Background jobs and fingerprint sync events recorded by the system.',
    userDescription: 'Background jobs and fingerprint sync events recorded for your account.',
    empty: 'No system events have been recorded yet.',
    filteredEmpty: 'No system logs match these filters.',
    userFilteredEmpty: 'No system logs match the current filters.',
    loadError: 'Unable to load system logs right now.',
    loading: 'Loading system logs...',
    exportTitle: 'System Logs',
    userExportTitle: 'My System Logs',
    fileBase: 'system_logs',
    userFileBase: 'my_system_logs',
    exportPrompt: 'Only the system logs matching the current filters will be exported. Choose the file format.',
    categories: [
      { value: 'job', label: 'Job' },
      { value: 'sync', label: 'Sync' },
    ],
  },
};

export function logGroupKeyFromPath(pathname = '') {
  const path = String(pathname || '');

  if (path.includes('/login-logs')) {
    return 'login';
  }

  if (path.includes('/system-logs')) {
    return 'system';
  }

  return 'activity';
}

export function logGroupConfig(pathname = window.location.pathname) {
  return LOG_GROUPS[logGroupKeyFromPath(pathname)];
}

export function logBelongsToGroup(activity, groupKey) {
  const value = String(activity || '').toLowerCase();

  if (groupKey === 'login') {
    return LOGIN_CATEGORIES.has(value);
  }

  if (groupKey === 'system') {
    return SYSTEM_CATEGORIES.has(value);
  }

  return !LOGIN_CATEGORIES.has(value) && !SYSTEM_CATEGORIES.has(value);
}

export function categoryOptionsForGroup(groupKey) {
  return [{ value: 'all', label: 'All categories' }, ...LOG_GROUPS[groupKey].categories];
}
