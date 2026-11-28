// Every new schedule and override gets this grace period: someone who enters
// later than the start plus this many minutes counts as Late in the reports.
// It does not extend door access. Each schedule keeps the value it was saved with.
export const defaultGracePeriodMinutes = 15;

// Earlier versions let each browser save its own default here; drop it so
// every browser uses the same value.
const LEGACY_STORAGE_KEYS = ['entrivo_system_settings', 'entrivo_system_settings_saved_at'];

export function getDefaultGracePeriodMinutes() {
  try {
    LEGACY_STORAGE_KEYS.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Storage unavailable: nothing to clean up.
  }
  return defaultGracePeriodMinutes;
}
