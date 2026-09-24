export const SETTINGS_STORAGE_KEY = 'entrivo_system_settings';

export const defaultGracePeriodMinutes = 15;

export function normalizeGracePeriodMinutes(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return defaultGracePeriodMinutes;
  }

  return Math.min(120, Math.max(0, Math.round(parsed)));
}

export function getDefaultGracePeriodMinutes() {
  try {
    const rawValue = window.localStorage.getItem(SETTINGS_STORAGE_KEY);

    if (!rawValue) {
      return defaultGracePeriodMinutes;
    }

    return normalizeGracePeriodMinutes(JSON.parse(rawValue)?.defaultGracePeriodMinutes);
  } catch {
    return defaultGracePeriodMinutes;
  }
}
