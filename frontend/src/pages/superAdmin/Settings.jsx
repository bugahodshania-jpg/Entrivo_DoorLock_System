import {
  CalendarDays,
  Eye,
  EyeOff,
  Fingerprint,
  Home,
  IdCard,
  Mail,
  Pencil,
  RefreshCcw,
  Save,
  ShieldCheck,
  User,
  UserCircle,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import axiosClient from '../../api/axiosClient';
import { formatDateTimeInManila, getManilaDateTimeStamp } from '../../utils/dateTime';
import {
  SETTINGS_STORAGE_KEY,
  defaultGracePeriodMinutes,
  normalizeGracePeriodMinutes,
} from '../../utils/systemSettings';
import '../../styles/superAdmin/dashboard.css';
import '../../styles/superAdmin/settings.css';

const defaultSettings = {
  defaultGracePeriodMinutes,
};

function readStoredSettings() {
  try {
    const rawValue = window.localStorage.getItem(SETTINGS_STORAGE_KEY);

    if (!rawValue) {
      return defaultSettings;
    }

    return {
      defaultGracePeriodMinutes: normalizeGracePeriodMinutes(
        JSON.parse(rawValue)?.defaultGracePeriodMinutes,
      ),
    };
  } catch {
    return defaultSettings;
  }
}

function formatRelativeSaveTime(value) {
  if (!value) {
    return 'Not saved yet';
  }

  const formatted = formatDateTimeInManila(value);

  if (formatted === '—' || formatted === String(value)) {
    return 'Saved';
  }

  return `Saved ${formatted}`;
}

function formatPasswordLastUpdated(profile) {
  if (profile?.password_last_updated_label) {
    return profile.password_last_updated_label;
  }

  const timestamp = profile?.password_updated_at || profile?.created_at;

  if (!timestamp) {
    return 'Not available';
  }

  const formatted = formatDateTimeInManila(timestamp);
  return formatted === '—' ? 'Not available' : formatted;
}

const settingsTabByHash = {
  '#admin-information': 'admin',
  '#access-policy': 'access',
};

const settingsHashByTab = Object.fromEntries(
  Object.entries(settingsTabByHash).map(([hash, tab]) => [tab, hash]),
);

function getSettingsTabFromHash() {
  return settingsTabByHash[window.location.hash] || 'admin';
}

export default function Settings({ user }) {
  const [settings, setSettings] = useState(() => readStoredSettings());
  const [savedAt, setSavedAt] = useState(() => window.localStorage.getItem(`${SETTINGS_STORAGE_KEY}_saved_at`) || '');
  const [saveNotice, setSaveNotice] = useState('');
  const [pendingConfirmation, setPendingConfirmation] = useState(null);
  const [activeTab, setActiveTab] = useState(() => getSettingsTabFromHash());
  const [adminProfile, setAdminProfile] = useState(null);
  const [adminProfileError, setAdminProfileError] = useState('');
  const [isAdminProfileLoading, setIsAdminProfileLoading] = useState(false);
  const [isEditingAdminProfile, setIsEditingAdminProfile] = useState(false);
  const [isEditingAdminPassword, setIsEditingAdminPassword] = useState(false);
  const [isSavingAdminProfile, setIsSavingAdminProfile] = useState(false);
  const [isCheckingCurrentPassword, setIsCheckingCurrentPassword] = useState(false);
  const [currentPasswordValidationMessage, setCurrentPasswordValidationMessage] = useState('');
  const [adminPasswordErrors, setAdminPasswordErrors] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
    general: '',
  });
  const [passwordVisibility, setPasswordVisibility] = useState({
    current_password: false,
    new_password: false,
    confirm_password: false,
  });
  const [adminProfileForm, setAdminProfileForm] = useState({
    sex: '',
    age: '',
    province: '',
    city_municipality: '',
    barangay: '',
    street_address: '',
    current_password: '',
    new_password: '',
    confirm_password: '',
  });

  useEffect(() => {
    function handleHashChange() {
      setActiveTab(getSettingsTabFromHash());
    }

    window.addEventListener('hashchange', handleHashChange);

    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    if (!saveNotice) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setSaveNotice('');
    }, 10000);

    return () => window.clearTimeout(timeoutId);
  }, [saveNotice]);

  useEffect(() => {
    if (!pendingConfirmation) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setPendingConfirmation(null);
      }
    }

    window.addEventListener('keydown', handleKeyDown);

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pendingConfirmation]);

  const isDirty = useMemo(() => {
    return JSON.stringify(settings) !== JSON.stringify(readStoredSettings());
  }, [settings]);

  const tabs = useMemo(
    () => [
      { key: 'admin', label: 'Admin information' },
      { key: 'access', label: 'Access policy' },
    ],
    [],
  );

  const adminDisplayName = useMemo(() => {
    const fullName = [
      user?.first_name,
      user?.middle_name,
      user?.last_name,
      user?.extension_name,
    ]
      .filter(Boolean)
      .join(' ');

    return fullName || user?.username || 'Not available';
  }, [user]);

  const employeeIdValue = useMemo(() => {
    return (
      user?.employee_id ||
      user?.employeeId ||
      adminProfile?.employee_id ||
      adminProfile?.employeeId ||
      'Not available'
    );
  }, [adminProfile, user]);

  const roleLabelValue = useMemo(() => {
    return user?.role ? String(user.role).replace(/_/g, ' ') : 'Not available';
  }, [user]);

  const passwordLastUpdatedLabel = useMemo(() => {
    return formatPasswordLastUpdated(adminProfile);
  }, [adminProfile]);

  useEffect(() => {
    if (!user?.id) {
      setAdminProfile(null);
      setAdminProfileError('');
      return undefined;
    }

    let isActive = true;

    async function loadAdminProfile() {
      setIsAdminProfileLoading(true);
      try {
        const response = await axiosClient.get(
          `/api/admin_profile.php?user_id=${encodeURIComponent(user.id)}`,
        );

        if (!isActive) {
          return;
        }

        const profile = response.data?.profile || null;
        setAdminProfile(profile);
        setAdminProfileError('');
        setAdminProfileForm((current) => ({
          ...current,
          sex: profile?.sex ?? '',
          age: profile?.age ?? '',
          province: profile?.province ?? '',
          city_municipality: profile?.city_municipality ?? '',
          barangay: profile?.barangay ?? '',
          street_address: profile?.street_address ?? '',
        }));
      } catch (error) {
        if (!isActive) {
          return;
        }

        setAdminProfile(null);
        setAdminProfileError(
          error?.response?.data?.message || 'Unable to load admin profile information right now.',
        );
      } finally {
        if (isActive) {
          setIsAdminProfileLoading(false);
        }
      }
    }

    loadAdminProfile();

    return () => {
      isActive = false;
    };
  }, [user?.id]);

  const adminPersonalInfo = useMemo(() => {
    const sexLabel = adminProfile?.sex || 'Not available';
    const ageLabel =
      adminProfile?.age != null && adminProfile?.age !== '' ? String(adminProfile.age) : 'Not available';
    const addressParts = [
      adminProfile?.street_address,
      adminProfile?.barangay,
      adminProfile?.city_municipality,
      adminProfile?.province,
    ].filter(Boolean);

    return [
      { label: 'Name', value: adminDisplayName },
      { label: 'Sex', value: sexLabel },
      { label: 'Age', value: ageLabel },
      { label: 'Address', value: addressParts.length ? addressParts.join(', ') : 'Not available' },
    ];
  }, [adminDisplayName, adminProfile]);

  const adminAccountInfo = useMemo(() => {
    return [
      { label: 'Username', value: user?.username || 'Not available', icon: User },
      { label: 'Employee ID', value: employeeIdValue, icon: IdCard },
      { label: 'Email', value: user?.email || 'Not available', icon: Mail },
      { label: 'Role', value: roleLabelValue, icon: ShieldCheck },
    ];
  }, [employeeIdValue, roleLabelValue, user]);

  const adminSecurityOverview = useMemo(() => {
    const fingerprintCount = Number(adminProfile?.fingerprint_count);
    const rfidCount = Number(adminProfile?.rfid_count);

    return [
      {
        label: 'Password Protected',
        value: 'Your account is secured',
        icon: ShieldCheck,
      },
      {
        label: 'Registered Fingerprints',
        value: Number.isFinite(fingerprintCount)
          ? fingerprintCount === 0
            ? 'None enrolled'
            : `${fingerprintCount} active`
          : 'Not available',
        icon: Fingerprint,
      },
      {
        label: 'Registered RFID Cards',
        value: Number.isFinite(rfidCount)
          ? rfidCount === 0
            ? 'None issued'
            : `${rfidCount} active`
          : 'Not available',
        icon: IdCard,
      },
    ];
  }, [adminProfile]);

  const adminEditReadonlyFields = useMemo(
    () => [
      { label: 'Full name', value: adminDisplayName },
      { label: 'Username', value: user?.username || 'Not available' },
      { label: 'Employee ID', value: employeeIdValue },
      { label: 'Email', value: user?.email || 'Not available' },
      { label: 'Role', value: roleLabelValue },
    ],
    [adminDisplayName, employeeIdValue, roleLabelValue, user],
  );

  function updateAdminProfileForm(key, value) {
    setAdminProfileForm((current) => ({
      ...current,
      [key]: value,
    }));

    if (['current_password', 'new_password', 'confirm_password'].includes(key)) {
      setAdminPasswordErrors((current) => ({
        ...current,
        [key]: '',
        general: '',
      }));
    }

    if (key === 'current_password') {
      setCurrentPasswordValidationMessage('');
    }
  }

  function resetAdminPasswordErrors() {
    setAdminPasswordErrors({
      current_password: '',
      new_password: '',
      confirm_password: '',
      general: '',
    });
  }

  function resetAdminPasswordFields() {
    setAdminProfileForm((current) => ({
      ...current,
      current_password: '',
      new_password: '',
      confirm_password: '',
    }));
    setPasswordVisibility({
      current_password: false,
      new_password: false,
      confirm_password: false,
    });
    resetAdminPasswordErrors();
  }

  async function validateCurrentPassword(showRequiredMessage = false) {
    if (!user?.id) {
      return false;
    }

    const currentPassword = String(adminProfileForm.current_password || '').trim();

    if (currentPassword === '') {
      setCurrentPasswordValidationMessage('');

      if (showRequiredMessage) {
        setAdminPasswordErrors((current) => ({
          ...current,
          current_password: 'Current password is required to change the password.',
        }));
      }

      return false;
    }

    setIsCheckingCurrentPassword(true);
    setCurrentPasswordValidationMessage('');

    try {
      await axiosClient.post('/api/admin_profile.php', {
        user_id: user.id,
        current_password: currentPassword,
        validate_current_password: true,
      });

      setAdminPasswordErrors((current) => ({
        ...current,
        current_password: '',
      }));
      setCurrentPasswordValidationMessage('Current password matched.');
      return true;
    } catch (error) {
      const errorMessage = error?.response?.data?.message || 'Unable to validate current password.';
      setCurrentPasswordValidationMessage('');
      setAdminPasswordErrors((current) => ({
        ...current,
        current_password:
          errorMessage === 'Current password is required.'
            ? 'Current password is required to change the password.'
            : errorMessage,
      }));
      return false;
    } finally {
      setIsCheckingCurrentPassword(false);
    }
  }

  function handleStartAdminPasswordEdit() {
    setIsEditingAdminPassword(true);
    setAdminProfileError('');
    resetAdminPasswordErrors();
    setCurrentPasswordValidationMessage('');
  }

  function handleCancelAdminPasswordEdit() {
    setIsEditingAdminPassword(false);
    resetAdminPasswordFields();
    setAdminProfileError('');
    setCurrentPasswordValidationMessage('');
  }

  function togglePasswordVisibility(fieldKey) {
    setPasswordVisibility((current) => ({
      ...current,
      [fieldKey]: !current[fieldKey],
    }));
  }

  function handleStartAdminProfileEdit() {
    setIsEditingAdminProfile(true);
    setSaveNotice('');
    setAdminProfileError('');
  }

  function handleCancelAdminProfileEdit() {
    setIsEditingAdminProfile(false);
    setAdminProfileForm((current) => ({
      ...current,
      sex: adminProfile?.sex ?? '',
      age: adminProfile?.age ?? '',
      province: adminProfile?.province ?? '',
      city_municipality: adminProfile?.city_municipality ?? '',
      barangay: adminProfile?.barangay ?? '',
      street_address: adminProfile?.street_address ?? '',
    }));
    setAdminProfileError('');
  }

  async function handleSaveAdminInfo() {
    if (!user?.id) {
      return;
    }

    setIsSavingAdminProfile(true);
    try {
      await axiosClient.post('/api/admin_profile.php', {
        user_id: user.id,
        sex: adminProfileForm.sex,
        age: adminProfileForm.age,
        province: adminProfileForm.province,
        city_municipality: adminProfileForm.city_municipality,
        barangay: adminProfileForm.barangay,
        street_address: adminProfileForm.street_address,
      });

      const refreshed = await axiosClient.get(
        `/api/admin_profile.php?user_id=${encodeURIComponent(user.id)}`,
      );
      setAdminProfile(refreshed.data?.profile || null);
      setIsEditingAdminProfile(false);
      resetAdminPasswordFields();
      setAdminProfileError('');
      setSaveNotice('Admin information updated.');
    } catch (error) {
      setAdminProfileError(
        error?.response?.data?.message || 'Unable to update admin information right now.',
      );
    } finally {
      setIsSavingAdminProfile(false);
    }
  }

  async function handleSaveAdminPassword() {
    if (!user?.id) {
      return;
    }

    const currentPassword = String(adminProfileForm.current_password || '');
    const newPassword = String(adminProfileForm.new_password || '');
    const confirmPassword = String(adminProfileForm.confirm_password || '');
    const nextErrors = {
      current_password: '',
      new_password: '',
      confirm_password: '',
      general: '',
    };

    if (currentPassword.trim() === '') {
      nextErrors.current_password = 'Current password is required to change the password.';
    }

    if (newPassword.trim() === '') {
      nextErrors.new_password = 'New password is required.';
    } else if (newPassword.length < 6) {
      nextErrors.new_password = 'New password must be at least 6 characters long.';
    }

    if (newPassword !== confirmPassword) {
      nextErrors.confirm_password = 'New password and confirm password do not match.';
    }

    if (
      nextErrors.current_password ||
      nextErrors.new_password ||
      nextErrors.confirm_password ||
      nextErrors.general
    ) {
      setAdminPasswordErrors(nextErrors);
      return;
    }

    const isCurrentPasswordValid = await validateCurrentPassword(true);

    if (!isCurrentPasswordValid) {
      return;
    }

    const preservedProfile = adminProfile || {};

    setIsSavingAdminProfile(true);
    resetAdminPasswordErrors();
    try {
      await axiosClient.post('/api/admin_profile.php', {
        user_id: user.id,
        // Preserve existing admin info so password changes don't overwrite it.
        sex: preservedProfile.sex ?? null,
        age: preservedProfile.age ?? null,
        province: preservedProfile.province ?? null,
        city_municipality: preservedProfile.city_municipality ?? null,
        barangay: preservedProfile.barangay ?? null,
        street_address: preservedProfile.street_address ?? null,
        current_password: currentPassword,
        new_password: newPassword,
      });

      const refreshed = await axiosClient.get(
        `/api/admin_profile.php?user_id=${encodeURIComponent(user.id)}`,
      );
      setAdminProfile(refreshed.data?.profile || null);
      resetAdminPasswordFields();
      setIsEditingAdminPassword(false);
      setAdminProfileError('');
      setSaveNotice('Password updated.');
    } catch (error) {
      const errorMessage = error?.response?.data?.message || 'Unable to update password right now.';

      if (errorMessage === 'Current password is required to change the password.') {
        setAdminPasswordErrors((current) => ({
          ...current,
          current_password: errorMessage,
        }));
      } else if (errorMessage === 'Current password is incorrect.') {
        setAdminPasswordErrors((current) => ({
          ...current,
          current_password: errorMessage,
        }));
      } else if (
        errorMessage === 'New password is required.' ||
        errorMessage === 'New password must be at least 6 characters long.'
      ) {
        setAdminPasswordErrors((current) => ({
          ...current,
          new_password: errorMessage,
        }));
      } else {
        setAdminPasswordErrors((current) => ({
          ...current,
          general: errorMessage,
        }));
      }
    } finally {
      setIsSavingAdminProfile(false);
    }
  }

  function updateSetting(key, value) {
    setSettings((current) => ({
      ...current,
      [key]: value,
    }));
    setSaveNotice('');
  }

  function persistSettings(nextSettings, notice = 'Settings saved successfully.') {
    const normalized = {
      defaultGracePeriodMinutes: normalizeGracePeriodMinutes(nextSettings.defaultGracePeriodMinutes),
    };

    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
    const timestamp = getManilaDateTimeStamp();
    window.localStorage.setItem(`${SETTINGS_STORAGE_KEY}_saved_at`, timestamp);
    setSettings(normalized);
    setSavedAt(timestamp);
    setSaveNotice(notice);
  }

  function requestConfirmation(payload) {
    setPendingConfirmation(payload);
  }

  function closeConfirmation() {
    setPendingConfirmation(null);
  }

  function confirmPendingChange() {
    if (!pendingConfirmation) {
      return;
    }

    if (pendingConfirmation.type === 'save') {
      handleSaveSettings();
    }

    if (pendingConfirmation.type === 'reset') {
      handleResetDefaults();
    }

    closeConfirmation();
  }

  function handleSaveSettings() {
    persistSettings(settings);
  }

  function handleResetDefaults() {
    setSettings(defaultSettings);
    setSaveNotice('Defaults restored. Save changes to apply them.');
  }

  function handleSelectTab(tabKey) {
    setActiveTab(tabKey);
    window.history.replaceState(null, '', `${window.location.pathname}${settingsHashByTab[tabKey] || ''}`);
  }

  function renderPasswordField(fieldKey, label, placeholder, disabled, errorText = '') {
    const isVisible = passwordVisibility[fieldKey];

    return (
      <label
        className={`settings-field settings-admin-security-field${
          disabled ? ' settings-field-readonly' : ''
        }${errorText ? ' settings-field-has-error' : ''}`}
      >
        <span>{label}</span>
        <div className="settings-password-input-wrap">
          <input
            type={isVisible ? 'text' : 'password'}
            placeholder={placeholder}
            value={adminProfileForm[fieldKey]}
            onChange={(event) => updateAdminProfileForm(fieldKey, event.target.value)}
            disabled={disabled}
          />
          <button
            type="button"
            className="settings-password-toggle"
            onClick={() => togglePasswordVisibility(fieldKey)}
            disabled={disabled}
            aria-label={`${isVisible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
            aria-pressed={isVisible}
          >
            {isVisible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
          </button>
        </div>
        {errorText ? <small className="settings-admin-field-error">{errorText}</small> : null}
      </label>
    );
  }

  return (
    <main className="admin-dashboard settings-page" aria-label="System settings">
      <section className="settings-hero" aria-label="Settings overview">
        <div>
          <p className="admin-dashboard-eyebrow">System settings</p>
          <h2>Account details and the default grace period for new schedules.</h2>
          <p>
            Update the signed-in administrator profile, change the password, and set the grace
            period applied when a schedule is created.
          </p>
        </div>
        <div className="settings-hero-actions">
          <div className="settings-save-row">
            <span className={`settings-save-state${isDirty ? ' is-pending' : ''}`}>
              {isDirty ? 'Unsaved changes' : formatRelativeSaveTime(savedAt)}
            </span>
          </div>
          <button
            type="button"
            className="settings-secondary-button"
            onClick={() =>
              requestConfirmation({
                type: 'reset',
                title: 'Restore defaults',
                message: 'Restore the default settings? You can still review and save afterwards.',
              })
            }
          >
            <RefreshCcw size={16} aria-hidden="true" />
            Reset Defaults
          </button>
          <button
            type="button"
            className="settings-primary-button"
            onClick={() =>
              requestConfirmation({
                type: 'save',
                title: 'Save changes',
                message: 'Save all current settings now?',
              })
            }
            disabled={!isDirty}
          >
            <Save size={16} aria-hidden="true" />
            Save Changes
          </button>
        </div>
      </section>

      {saveNotice ? (
        <section className="settings-notice" aria-live="polite">
          <span>{saveNotice}</span>
          <button
            type="button"
            className="settings-notice-close"
            onClick={() => setSaveNotice('')}
            aria-label="Dismiss message"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </section>
      ) : null}

      {pendingConfirmation ? (
        <div
          className="settings-modal-overlay"
          role="presentation"
          onClick={closeConfirmation}
        >
          <div
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-label={pendingConfirmation.title || 'Confirm change'}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="settings-modal-header">
              <h3>{pendingConfirmation.title || 'Confirm change'}</h3>
              <button
                type="button"
                className="settings-modal-close"
                onClick={closeConfirmation}
                aria-label="Close dialog"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <p className="settings-modal-body">
              {pendingConfirmation.message || 'Apply this change?'}
            </p>
            <div className="settings-modal-actions">
              <button type="button" className="settings-secondary-button" onClick={closeConfirmation}>
                Cancel
              </button>
              <button type="button" className="settings-primary-button" onClick={confirmPendingChange}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <nav className="settings-tabs" role="tablist" aria-label="Settings sections">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            className={`settings-tab${activeTab === tab.key ? ' is-active' : ''}`}
            aria-selected={activeTab === tab.key}
            onClick={() => handleSelectTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <section className="settings-grid" aria-label="Settings panels">
        {activeTab === 'admin' ? (
        <article className="settings-card" role="tabpanel" aria-label="Admin information">
          <div className="dashboard-panel-header">
            <div>
              <span>Admin information</span>
              <p>Details for the currently signed-in administrator account.</p>
            </div>
          </div>

          {adminProfileError && !isEditingAdminPassword ? (
            <p className="settings-admin-error">{adminProfileError}</p>
          ) : null}

          <div className="settings-admin-dashboard">
            <section className="settings-admin-profile-summary" aria-label="Admin profile summary">
              <div className="settings-admin-profile-avatar">
                <UserCircle size={84} strokeWidth={1.3} aria-hidden="true" />
              </div>

              <h3 className="settings-admin-profile-name">{adminDisplayName}</h3>
              <span className="settings-admin-profile-role">
                <ShieldCheck size={14} aria-hidden="true" />
                {roleLabelValue}
              </span>

              <div className="settings-admin-profile-meta">
                <span>Employee ID</span>
                <strong>{employeeIdValue}</strong>
              </div>

              <button
                type="button"
                className="settings-admin-profile-edit-button"
                onClick={handleStartAdminProfileEdit}
                disabled={isAdminProfileLoading || isSavingAdminProfile}
              >
                <Pencil size={18} aria-hidden="true" />
                Edit Profile
              </button>
            </section>

            <section className="settings-admin-card settings-admin-personal-card" aria-label="Personal information">
              <header className="settings-admin-card-header">
                <h4>Personal Information</h4>
                <button
                  type="button"
                  className="settings-secondary-button settings-admin-edit-button"
                  onClick={handleStartAdminProfileEdit}
                  disabled={isAdminProfileLoading || isSavingAdminProfile}
                >
                  <Pencil size={16} aria-hidden="true" />
                  Edit
                </button>
              </header>

              <div className="settings-admin-info-grid">
                {adminPersonalInfo.map((item) => (
                  <div className="settings-admin-info-item" key={item.label}>
                    <span className="settings-admin-info-icon" aria-hidden="true">
                      {item.label === 'Name' ? <User size={18} /> : null}
                      {item.label === 'Sex' ? <UserCircle size={18} strokeWidth={1.6} /> : null}
                      {item.label === 'Age' ? <CalendarDays size={18} /> : null}
                      {item.label === 'Address' ? <Home size={18} /> : null}
                    </span>
                    <div className="settings-admin-info-body">
                      <span className="settings-admin-info-label">{item.label}</span>
                      <span className="settings-admin-info-value">{item.value}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="settings-admin-subsection">
                <div className="settings-admin-subsection-title">Account Information</div>
                <div className="settings-admin-info-grid">
                  {adminAccountInfo.map(({ label, value, icon: Icon }) => (
                    <div className="settings-admin-info-item" key={label}>
                      <span className="settings-admin-info-icon" aria-hidden="true">
                        <Icon size={18} />
                      </span>
                      <div className="settings-admin-info-body">
                        <span className="settings-admin-info-label">{label}</span>
                        <span className="settings-admin-info-value">{value}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </section>

            <section className="settings-admin-card settings-admin-overview-card" aria-label="Security overview">
              <header className="settings-admin-card-header">
                <h4>Security Overview</h4>
              </header>

              <div className="settings-admin-overview-grid">
                {adminSecurityOverview.map(({ label, value, icon: Icon }) => (
                  <div className="settings-admin-overview-item" key={label}>
                    <span className="settings-admin-overview-icon" aria-hidden="true">
                      <Icon size={20} />
                    </span>
                    <div className="settings-admin-overview-body">
                      <strong>{label}</strong>
                      <span>{value}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="settings-admin-card settings-admin-security-card" aria-label="Change password">
              <header className="settings-admin-card-header settings-admin-card-header-security">
                <h4>Change Password</h4>
                <button
                  type="button"
                  className="settings-secondary-button settings-admin-edit-button"
                  onClick={isEditingAdminPassword ? handleCancelAdminPasswordEdit : handleStartAdminPasswordEdit}
                  disabled={isSavingAdminProfile || isAdminProfileLoading}
                >
                  <ShieldCheck size={16} aria-hidden="true" />
                  {isEditingAdminPassword ? 'Cancel' : 'Update Password'}
                </button>
              </header>

              <div className="settings-admin-security-grid">
                <label
                  className={`settings-field settings-admin-security-field${
                    !isEditingAdminPassword ? ' settings-field-readonly' : ''
                  }${adminPasswordErrors.current_password ? ' settings-field-has-error' : ''}`}
                >
                  <span>Current password</span>
                  <div className="settings-password-input-wrap">
                    <input
                      type={isEditingAdminPassword && passwordVisibility.current_password ? 'text' : 'password'}
                      placeholder="**********"
                      value={adminProfileForm.current_password}
                      onChange={(event) => updateAdminProfileForm('current_password', event.target.value)}
                      onBlur={() => {
                        if (isEditingAdminPassword && adminProfileForm.current_password.trim() !== '') {
                          validateCurrentPassword();
                        }
                      }}
                      disabled={!isEditingAdminPassword || isSavingAdminProfile || isAdminProfileLoading}
                    />
                    {isEditingAdminPassword ? (
                      <button
                        type="button"
                        className="settings-password-toggle"
                        onClick={() => togglePasswordVisibility('current_password')}
                        disabled={isSavingAdminProfile || isAdminProfileLoading}
                        aria-label={`${
                          passwordVisibility.current_password ? 'Hide' : 'Show'
                        } current password`}
                        aria-pressed={passwordVisibility.current_password}
                      >
                        {passwordVisibility.current_password ? (
                          <EyeOff size={16} aria-hidden="true" />
                        ) : (
                          <Eye size={16} aria-hidden="true" />
                        )}
                      </button>
                    ) : null}
                  </div>
                  <small className="settings-admin-security-note">
                    Last updated: {passwordLastUpdatedLabel}
                  </small>
                  {isEditingAdminPassword && isCheckingCurrentPassword ? (
                    <small className="settings-admin-security-checking">Checking current password...</small>
                  ) : null}
                  {isEditingAdminPassword &&
                  currentPasswordValidationMessage &&
                  !adminPasswordErrors.current_password ? (
                    <small className="settings-admin-security-success">
                      {currentPasswordValidationMessage}
                    </small>
                  ) : null}
                  {adminPasswordErrors.current_password ? (
                    <small className="settings-admin-field-error">
                      {adminPasswordErrors.current_password}
                    </small>
                  ) : null}
                </label>
                {isEditingAdminPassword ? (
                  <>
                    {renderPasswordField(
                      'new_password',
                      'New password',
                      'Enter new password',
                      isSavingAdminProfile || isAdminProfileLoading,
                      adminPasswordErrors.new_password,
                    )}
                    {renderPasswordField(
                      'confirm_password',
                      'Confirm password',
                      'Confirm new password',
                      isSavingAdminProfile || isAdminProfileLoading,
                      adminPasswordErrors.confirm_password,
                    )}
                  </>
                ) : null}
              </div>

              {adminPasswordErrors.general ? (
                <p className="settings-admin-error settings-admin-error-inline">
                  {adminPasswordErrors.general}
                </p>
              ) : null}

              {isEditingAdminPassword ? (
                <button
                  type="button"
                  className="settings-admin-security-submit"
                  onClick={handleSaveAdminPassword}
                  disabled={isSavingAdminProfile || isAdminProfileLoading}
                >
                  <ShieldCheck size={16} aria-hidden="true" />
                  {isSavingAdminProfile ? 'Updating...' : 'Change Password'}
                </button>
              ) : null}
            </section>
          </div>

          {isEditingAdminProfile ? (
            <div
              className="settings-modal-overlay"
              role="presentation"
              onClick={handleCancelAdminProfileEdit}
            >
              <div
                className="settings-modal settings-admin-edit-modal"
                role="dialog"
                aria-modal="true"
                aria-label="Edit admin information"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="settings-modal-header">
                  <h3>Edit admin information</h3>
                  <button
                    type="button"
                    className="settings-modal-close"
                    onClick={handleCancelAdminProfileEdit}
                    aria-label="Close dialog"
                  >
                    <X size={18} aria-hidden="true" />
                  </button>
                </div>

                <p className="settings-modal-body">
                  Review all profile details below. Only editable fields are enabled.
                </p>

                {adminProfileError ? <p className="settings-admin-error">{adminProfileError}</p> : null}

                <div className="settings-admin-edit-grid">
                  {adminEditReadonlyFields.map((field) => (
                    <label className="settings-field settings-field-readonly" key={field.label}>
                      <span>{field.label}</span>
                      <input type="text" value={field.value} readOnly disabled />
                    </label>
                  ))}

                  <label className="settings-field">
                    <span>Sex</span>
                    <select
                      value={adminProfileForm.sex}
                      onChange={(event) => updateAdminProfileForm('sex', event.target.value)}
                    >
                      <option value="">Select sex</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                    </select>
                  </label>

                  <label className="settings-field" key="Age">
                    <span>Age</span>
                    <input
                      type="number"
                      min="0"
                      max="120"
                      value={adminProfileForm.age}
                      onChange={(event) => updateAdminProfileForm('age', event.target.value)}
                    />
                  </label>

                  <label className="settings-field">
                    <span>Province</span>
                    <input
                      type="text"
                      value={adminProfileForm.province}
                      onChange={(event) => updateAdminProfileForm('province', event.target.value)}
                    />
                  </label>

                  <label className="settings-field">
                    <span>City / Municipality</span>
                    <input
                      type="text"
                      value={adminProfileForm.city_municipality}
                      onChange={(event) => updateAdminProfileForm('city_municipality', event.target.value)}
                    />
                  </label>

                  <label className="settings-field">
                    <span>Barangay</span>
                    <input
                      type="text"
                      value={adminProfileForm.barangay}
                      onChange={(event) => updateAdminProfileForm('barangay', event.target.value)}
                    />
                  </label>

                  <label className="settings-field settings-admin-edit-full">
                    <span>Street address</span>
                    <input
                      type="text"
                      value={adminProfileForm.street_address}
                      onChange={(event) => updateAdminProfileForm('street_address', event.target.value)}
                    />
                  </label>
                </div>

                <div className="settings-modal-actions">
                  <button
                    type="button"
                    className="settings-secondary-button"
                    onClick={handleCancelAdminProfileEdit}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="settings-primary-button"
                    onClick={handleSaveAdminInfo}
                    disabled={isSavingAdminProfile || isAdminProfileLoading}
                  >
                    <Save size={16} aria-hidden="true" />
                    {isSavingAdminProfile ? 'Saving...' : 'Save admin info'}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </article>
        ) : null}

        {activeTab === 'access' ? (
        <article className="settings-card" role="tabpanel" aria-label="Access policy">
          <div className="dashboard-panel-header">
            <div>
              <span>Access policy</span>
              <p>Applied to each new schedule. An existing schedule keeps its own grace period when it is edited.</p>
            </div>
            <ShieldCheck size={18} aria-hidden="true" className="settings-card-icon" />
          </div>

          <div className="settings-form-grid">
            <label className="settings-field">
              <span>Default grace period</span>
              <div className="settings-input-suffix">
                <input
                  type="number"
                  min="0"
                  max="120"
                  value={settings.defaultGracePeriodMinutes}
                  onChange={(event) => {
                    const rawValue = event.target.value;

                    if (rawValue === '') {
                      updateSetting('defaultGracePeriodMinutes', '');
                      return;
                    }

                    const parsed = Number(rawValue);
                    updateSetting(
                      'defaultGracePeriodMinutes',
                      Number.isFinite(parsed)
                        ? Math.min(120, Math.max(0, parsed))
                        : defaultGracePeriodMinutes,
                    );
                  }}
                />
                <small>minutes</small>
              </div>
            </label>
          </div>

        </article>
        ) : null}
      </section>
    </main>
  );
}
