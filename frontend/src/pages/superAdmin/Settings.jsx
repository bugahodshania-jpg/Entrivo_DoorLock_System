import {
  Eye,
  EyeOff,
  Fingerprint,
  History,
  IdCard,
  Pencil,
  RefreshCcw,
  Save,
  ShieldCheck,
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
import { useActionConfirm } from '../../components/ActionConfirm';
import ErrorNoticeModal from '../../components/ErrorNoticeModal';
import { DoorControlPanel } from '../../components/DoorStatusCard';
import { useDoorStatus } from '../../hooks/useDoorStatus';
import '../../styles/superAdmin/dashboard.css';
import '../../styles/superAdmin/settings.css';
import '../../styles/superAdmin/rfid.css';

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
  '#door-control': 'door',
};

const settingsHashByTab = Object.fromEntries(
  Object.entries(settingsTabByHash).map(([hash, tab]) => [tab, hash]),
);

function getSettingsTabFromHash() {
  return settingsTabByHash[window.location.hash] || 'admin';
}

export default function Settings({ user }) {
  const confirmAction = useActionConfirm();
  const [settings, setSettings] = useState(() => readStoredSettings());
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
      { key: 'door', label: 'Door control' },
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
    return [
      { label: 'Name', value: adminDisplayName },
      { label: 'Sex', value: adminProfile?.sex || 'Not available' },
      {
        label: 'Age',
        value: adminProfile?.age != null && adminProfile?.age !== '' ? String(adminProfile.age) : 'Not available',
      },
      {
        label: 'Contact number',
        value: adminProfile?.contact_number || 'Not available',
      },
    ];
  }, [adminDisplayName, adminProfile]);

  const adminAddressInfo = useMemo(() => {
    return [
      { label: 'Street address', value: adminProfile?.street_address || 'Not available' },
      { label: 'Barangay', value: adminProfile?.barangay || 'Not available' },
      { label: 'City / Municipality', value: adminProfile?.city_municipality || 'Not available' },
      { label: 'Province', value: adminProfile?.province || 'Not available' },
    ];
  }, [adminProfile]);

  const adminAccountInfo = useMemo(() => {
    return [
      { label: 'Username', value: user?.username || 'Not available' },
      { label: 'Employee ID', value: employeeIdValue },
      { label: 'Email', value: user?.email || 'Not available' },
      { label: 'Role', value: roleLabelValue },
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

    const confirmed = await confirmAction({
      title: 'Update profile',
      message: 'Are you sure you want to update this profile?',
    });
    if (!confirmed) {
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

    const confirmed = await confirmAction({
      title: 'Update password',
      message: 'Are you sure you want to update this password?',
    });
    if (!confirmed) {
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
    setSaveNotice(notice);
  }

  function requestConfirmation(payload) {
    setPendingConfirmation(payload);
  }

  function closeConfirmation() {
    setPendingConfirmation(null);
  }

  async function confirmPendingChange() {
    if (!pendingConfirmation) {
      return;
    }

    const confirmed = await confirmAction({
      step: 'password',
      title: 'Security Verification',
      message: 'Enter your password to confirm this action.',
    });
    if (!confirmed) {
      return;
    }

    if (pendingConfirmation.type === 'save') {
      handleSaveSettings();
    }

    closeConfirmation();
  }

  function handleSaveSettings() {
    persistSettings(settings);
  }

  function handleSelectTab(tabKey) {
    setActiveTab(tabKey);
    window.history.replaceState(null, '', `${window.location.pathname}${settingsHashByTab[tabKey] || ''}`);
  }

  function renderPasswordField(fieldKey, label, placeholder, disabled, errorText = '') {
    const isVisible = passwordVisibility[fieldKey];

    return (
      <div className={`settings-admin-edit-field${errorText ? ' settings-admin-edit-field-error' : ''}`}>
        <dt>{label}</dt>
        <dd>
          <div className="settings-password-input-wrap">
            <input
              type={isVisible ? 'text' : 'password'}
              placeholder={placeholder}
              value={adminProfileForm[fieldKey]}
              onChange={(event) => updateAdminProfileForm(fieldKey, event.target.value)}
              disabled={disabled}
            />
            {!disabled ? (
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
            ) : null}
          </div>
          {errorText ? <small className="settings-admin-field-error">{errorText}</small> : null}
        </dd>
      </div>
    );
  }

  return (
    <main className="admin-dashboard settings-page" aria-label="System settings">
      <section className="settings-hero" aria-label="Settings overview">
        <div>
          <p className="admin-dashboard-eyebrow">System settings</p>
          <h2>Account details, the door&apos;s access rules, and door control.</h2>
          <p>
            Update the signed-in administrator profile and password, review who can enter and when,
            set the default grace period for new schedules, and control the door&apos;s scheduling and lock.
          </p>
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
                <h4>Profile Details</h4>
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

              <div className="settings-admin-review-stack">
                <section className="pending-registration-review-card">
                  <h3>Personal Information</h3>
                  <dl>
                    {adminPersonalInfo.map((item) => (
                      <div key={item.label}>
                        <dt>{item.label}</dt>
                        <dd>{item.value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>

                <section className="pending-registration-review-card">
                  <h3>Address</h3>
                  <dl>
                    {adminAddressInfo.map((item) => (
                      <div key={item.label}>
                        <dt>{item.label}</dt>
                        <dd>{item.value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>

                <section className="pending-registration-review-card">
                  <h3>Account Information</h3>
                  <dl>
                    {adminAccountInfo.map((item) => (
                      <div key={item.label}>
                        <dt>{item.label}</dt>
                        <dd>{item.value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
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

              <div className="settings-admin-review-stack">
                <section className="pending-registration-review-card settings-admin-password-card">
                  <h3>Password</h3>
                  <dl>
                    {!isEditingAdminPassword ? (
                      <>
                        <div>
                          <dt>Current password</dt>
                          <dd>**********</dd>
                        </div>
                        <div>
                          <dt>Last updated</dt>
                          <dd>{passwordLastUpdatedLabel}</dd>
                        </div>
                      </>
                    ) : (
                      <>
                        <div
                          className={`settings-admin-edit-field${
                            adminPasswordErrors.current_password ? ' settings-admin-edit-field-error' : ''
                          }`}
                        >
                          <dt>Current password</dt>
                          <dd>
                            <div className="settings-password-input-wrap">
                              <input
                                type={passwordVisibility.current_password ? 'text' : 'password'}
                                placeholder="Enter current password"
                                value={adminProfileForm.current_password}
                                onChange={(event) => updateAdminProfileForm('current_password', event.target.value)}
                                onBlur={() => {
                                  if (adminProfileForm.current_password.trim() !== '') {
                                    validateCurrentPassword();
                                  }
                                }}
                                disabled={isSavingAdminProfile || isAdminProfileLoading}
                              />
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
                            </div>
                            <small className="settings-admin-security-note">
                              Last updated: {passwordLastUpdatedLabel}
                            </small>
                            {isCheckingCurrentPassword ? (
                              <small className="settings-admin-security-checking">
                                Checking current password...
                              </small>
                            ) : null}
                            {currentPasswordValidationMessage && !adminPasswordErrors.current_password ? (
                              <small className="settings-admin-security-success">
                                {currentPasswordValidationMessage}
                              </small>
                            ) : null}
                            {adminPasswordErrors.current_password ? (
                              <small className="settings-admin-field-error">
                                {adminPasswordErrors.current_password}
                              </small>
                            ) : null}
                          </dd>
                        </div>
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
                    )}
                  </dl>
                </section>
              </div>

              {adminPasswordErrors.general ? (
                <p className="settings-admin-error settings-admin-error-inline">
                  {adminPasswordErrors.general}
                </p>
              ) : null}

              {isEditingAdminPassword ? (
                <div className="settings-admin-security-actions">
                  <button
                    type="button"
                    className="pending-registration-approve"
                    onClick={handleSaveAdminPassword}
                    disabled={isSavingAdminProfile || isAdminProfileLoading}
                  >
                    <ShieldCheck size={16} aria-hidden="true" />
                    {isSavingAdminProfile ? 'Updating...' : 'Change Password'}
                  </button>
                </div>
              ) : null}
            </section>
          </div>

          {isEditingAdminProfile ? (
            <div
              className="pending-registration-review-backdrop settings-admin-edit-backdrop"
              role="presentation"
              onClick={handleCancelAdminProfileEdit}
            >
              <form
                className="pending-registration-review settings-admin-edit-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="settings-admin-edit-title"
                onClick={(event) => event.stopPropagation()}
                onSubmit={(event) => {
                  event.preventDefault();
                  handleSaveAdminInfo();
                }}
              >
                <header>
                  <div>
                    <h2 id="settings-admin-edit-title">Edit Admin Information</h2>
                    <p>Update personal and address details for this account.</p>
                  </div>
                  <button
                    type="button"
                    aria-label="Close dialog"
                    onClick={handleCancelAdminProfileEdit}
                    disabled={isSavingAdminProfile}
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </header>

                <div className="pending-registration-review-body">
                  <section className="pending-registration-review-card">
                    <h3>Account Information</h3>
                    <dl>
                      {adminEditReadonlyFields.map((field) => (
                        <div key={field.label} className="settings-admin-edit-field">
                          <dt>{field.label}</dt>
                          <dd>
                            <input type="text" value={field.value} readOnly />
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </section>

                  <section className="pending-registration-review-card">
                    <h3>Personal Information</h3>
                    <dl>
                      <div className="settings-admin-edit-field">
                        <dt>Sex</dt>
                        <dd>
                          <select
                            value={adminProfileForm.sex}
                            onChange={(event) => updateAdminProfileForm('sex', event.target.value)}
                          >
                            <option value="">Select sex</option>
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                          </select>
                        </dd>
                      </div>
                      <div className="settings-admin-edit-field">
                        <dt>Age</dt>
                        <dd>
                          <input
                            type="number"
                            min="0"
                            max="120"
                            value={adminProfileForm.age}
                            onChange={(event) => updateAdminProfileForm('age', event.target.value)}
                          />
                        </dd>
                      </div>
                    </dl>
                  </section>

                  <section className="pending-registration-review-card">
                    <h3>Address</h3>
                    <dl>
                      <div className="settings-admin-edit-field">
                        <dt>Street address</dt>
                        <dd>
                          <input
                            type="text"
                            value={adminProfileForm.street_address}
                            onChange={(event) => updateAdminProfileForm('street_address', event.target.value)}
                          />
                        </dd>
                      </div>
                      <div className="settings-admin-edit-field">
                        <dt>Barangay</dt>
                        <dd>
                          <input
                            type="text"
                            value={adminProfileForm.barangay}
                            onChange={(event) => updateAdminProfileForm('barangay', event.target.value)}
                          />
                        </dd>
                      </div>
                      <div className="settings-admin-edit-field">
                        <dt>City / Municipality</dt>
                        <dd>
                          <input
                            type="text"
                            value={adminProfileForm.city_municipality}
                            onChange={(event) => updateAdminProfileForm('city_municipality', event.target.value)}
                          />
                        </dd>
                      </div>
                      <div className="settings-admin-edit-field">
                        <dt>Province</dt>
                        <dd>
                          <input
                            type="text"
                            value={adminProfileForm.province}
                            onChange={(event) => updateAdminProfileForm('province', event.target.value)}
                          />
                        </dd>
                      </div>
                    </dl>
                  </section>
                </div>

                <footer>
                  <button
                    type="button"
                    className="pending-registration-reject"
                    onClick={handleCancelAdminProfileEdit}
                    disabled={isSavingAdminProfile}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="pending-registration-approve"
                    disabled={isSavingAdminProfile || isAdminProfileLoading}
                  >
                    <Save size={16} aria-hidden="true" />
                    {isSavingAdminProfile ? 'Saving...' : 'Save Changes'}
                  </button>
                </footer>
              </form>
            </div>
          ) : null}
        </article>
        ) : null}

        {activeTab === 'access' ? (
        <article className="settings-card" role="tabpanel" aria-label="Access policy">
          <div className="dashboard-panel-header">
            <div>
              <span>Access policy</span>
              <p>The rules the door applies to every fingerprint and RFID scan, and the default grace period for new schedules.</p>
            </div>
            <ShieldCheck size={18} aria-hidden="true" className="settings-card-icon" />
          </div>

          <AccessPolicyRules onOpenDoorControl={() => handleSelectTab('door')} />

          <StaffRoomHours user={user} />

          <section className="settings-policy-box" aria-labelledby="settings-policy-grace">
            <header className="settings-policy-box-head">
              <h3 id="settings-policy-grace">Default grace period</h3>
              <p>Filled in on each new schedule and override.</p>
            </header>
            <div className="settings-policy-grace">
            <div className="settings-policy-grace-controls">
            <label className="settings-field settings-policy-grace-field">
              <span>Minutes</span>
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
            <button
              type="button"
              className="settings-primary-button"
              onClick={() =>
                requestConfirmation({
                  type: 'save',
                  title: 'Save grace period',
                  message: 'Save the default grace period now?',
                })
              }
              disabled={!isDirty}
            >
              <Save size={16} aria-hidden="true" />
              Save
            </button>
            </div>
            <ul className="settings-policy-note">
              <li>Shown in schedules and reports. An existing schedule keeps its own grace period when edited.</li>
              <li>It does not extend door access: the door opens only between the schedule&apos;s start and end.</li>
              <li>Saved in this browser only.</li>
            </ul>
            </div>
          </section>

        </article>
        ) : null}

        {activeTab === 'door' ? <DoorControlCard user={user} /> : null}
      </section>
      <ErrorNoticeModal
        open={Boolean(adminProfileError)}
        message={adminProfileError}
        onClose={() => setAdminProfileError('')}
      />
    </main>
  );
}

const ROLE_RULES = [
  { role: 'Student', tag: 'Override only', tone: 'is-on', text: 'Enters only during an approved override schedule. A regular schedule or a registered credential alone never opens the room.' },
  { role: 'Faculty and staff', tag: 'Schedule', tone: 'is-auto', text: 'Enters during an approved regular or override schedule. Staff a Super Admin allows can also enter during the room hours (below).' },
  { role: 'Admin and Super Admin', tag: 'Any time', tone: 'is-lock', text: 'Permanent override: no schedule needed. A schedule that is running is still linked in the logs.' },
  { role: 'Emergency card', tag: 'Any time', tone: 'is-off', text: 'Opens the door online and offline, logged under the card’s name (default “Emergency card”).' },
];

const SCHEDULE_RULES = [
  ['Who can scan', 'An approved, active account with a registered fingerprint or RFID card. Unregistered fingers and cards are denied and logged.'],
  ['Entry window', 'From the schedule’s start time up to its end time, on its date or repeat days. Before the start or after the end, entry is denied.'],
  ['Regular and override', 'A running regular schedule is used first. An override does not cancel the regular schedule; it adds its own window.'],
  ['Exit', 'Never refused. Leaving after the schedule ends is logged as Extended, with the minutes over.'],
  ['End reminder', 'The door plays a reminder 15 minutes before the schedule ends, twice. If the end time is edited, it plans the reminder again.'],
  ['Offline', 'The door keeps a copy of who may enter today and the next 7 days, updated within about a minute of any change. Without internet it checks that copy with its own clock; entries upload later with an Offline tag.'],
  ['New schedules', 'Only fully active accounts (approved, active, password changed, sign-up finished) can be given a schedule.'],
];

function AccessPolicyRules({ onOpenDoorControl }) {
  const door = useDoorStatus();
  const modeLabel = { auto: 'Auto', on: 'On', off: 'Off' }[door.scheduleMode] || 'Auto';
  return (
    <div className="settings-policy">
      <section className="settings-policy-mode" aria-label="Current scheduling mode">
        <span className={`settings-door-tag is-${door.scheduleMode || 'auto'}`}>{modeLabel}</span>
        <p>
          <strong>Scheduling is {modeLabel}{door.state === 'unknown' ? ' · door offline' : ''}.</strong>{' '}
          {door.scheduleMode === 'off'
            ? 'The rules below are paused: every active registered user can enter.'
            : door.scheduleMode === 'on'
              ? 'The rules below apply online and offline (the door checks its saved copy). With no saved copy, only the emergency card opens it offline.'
              : 'The rules below apply online and offline (the door checks its saved copy). With no saved copy, enrolled fingers can enter offline.'}
        </p>
        <button type="button" className="settings-secondary-button" onClick={onOpenDoorControl}>Door control</button>
      </section>

      <section className="settings-policy-box" aria-labelledby="settings-policy-roles">
        <header className="settings-policy-box-head">
          <h3 id="settings-policy-roles">Who can enter</h3>
          <p>Checked on every fingerprint and RFID scan at the door.</p>
        </header>
        <ul className="settings-policy-roles">
          {ROLE_RULES.map((rule) => (
            <li key={rule.role}>
              <div className="settings-policy-role-head">
                <strong>{rule.role}</strong>
                <span className={`settings-door-tag ${rule.tone}`}>{rule.tag}</span>
              </div>
              <p>{rule.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="settings-policy-box" aria-labelledby="settings-policy-schedules">
        <header className="settings-policy-box-head">
          <h3 id="settings-policy-schedules">Schedule rules</h3>
          <p>How schedules open the door, and what is logged.</p>
        </header>
        <dl className="settings-policy-list">
          {SCHEDULE_RULES.map(([term, text]) => <div key={term}><dt>{term}</dt><dd>{text}</dd></div>)}
        </dl>
      </section>
    </div>
  );
}

/**
 * Staff room hours: the room's daily hours, and how many staff may enter
 * during them without a schedule (chosen per person in Manage Users).
 * Admins can view; only a Super Admin can change the hours.
 */
function StaffRoomHours({ user }) {
  const confirmAction = useActionConfirm();
  const [state, setState] = useState({ loading: true, error: '', hours: null, allowed: [], canEdit: false });
  const [form, setForm] = useState({ start: '06:00', end: '21:00' });
  const [notice, setNotice] = useState({ text: '', error: false });
  const [busy, setBusy] = useState(false);

  function apply(data) {
    setState({ loading: false, error: '', hours: data.hours, allowed: data.allowed_user_ids || [], canEdit: Boolean(data.can_edit) });
    setForm({ start: data.hours.start, end: data.hours.end });
  }

  useEffect(() => {
    if (!user?.id) return;
    axiosClient.get('/api/door_control.php', { params: { view: 'room_access', actor_id: user.id } })
      .then((response) => apply(response.data))
      .catch((error) => setState((current) => ({ ...current, loading: false, error: error.response?.data?.message || 'Staff room hours could not be loaded.' })));
  }, [user?.id]);

  const changed = state.hours && (form.start !== state.hours.start || form.end !== state.hours.end);
  const invalid = !form.start || !form.end || form.end <= form.start;

  async function save() {
    if (!changed || invalid) return;
    const password = await confirmAction({
      title: 'Change the staff room hours?',
      message: `Allowed staff will be able to enter from ${form.start} to ${form.end} every day without a schedule.`,
      confirmLabel: 'Save room hours',
      returnPassword: true,
    });
    if (!password) return;
    setBusy(true);
    setNotice({ text: '', error: false });
    try {
      const response = await axiosClient.post('/api/door_control.php', {
        action: 'room_hours', actor_id: user?.id, password, start: form.start, end: form.end,
      });
      apply(response.data);
      setNotice({ text: response.data?.message || 'Saved.', error: false });
    } catch (error) {
      setNotice({ text: error.response?.data?.message || 'The room hours could not be saved.', error: true });
    } finally {
      setBusy(false);
    }
  }

  // On/off: once on, the hours repeat every day until a Super Admin turns them off.
  async function toggleEnabled() {
    const turnOn = !state.hours.enabled;
    const password = await confirmAction({
      title: turnOn ? 'Turn on the staff room hours?' : 'Turn off the staff room hours?',
      message: turnOn
        ? `Allowed staff will be able to enter from ${state.hours.label} every day, until you turn this off.`
        : 'Allowed staff will need a schedule or an approved override to enter until you turn this on again. The hours and the allowed staff are kept.',
      confirmLabel: turnOn ? 'Turn on' : 'Turn off',
      danger: !turnOn,
      returnPassword: true,
    });
    if (!password) return;
    setBusy(true);
    setNotice({ text: '', error: false });
    try {
      const response = await axiosClient.post('/api/door_control.php', {
        action: 'room_hours', actor_id: user?.id, password, start: state.hours.start, end: state.hours.end, enabled: turnOn,
      });
      apply(response.data);
      setNotice({ text: response.data?.message || 'Saved.', error: false });
    } catch (error) {
      setNotice({ text: error.response?.data?.message || 'The room hours could not be changed.', error: true });
    } finally {
      setBusy(false);
    }
  }

  const manageUsersHref = user?.role === 'super_admin' ? '/super-admin/manage-users' : '/admin/manage-users';
  const count = state.allowed.length;

  return (
    <section className="settings-policy-box" aria-labelledby="settings-policy-room">
      <header className="settings-policy-box-head">
        <h3 id="settings-policy-room">Staff room hours</h3>
        <p>Staff who clean or manage the room can enter during these hours without a schedule, but only those a Super Admin allows.</p>
      </header>
      {state.loading ? <p className="settings-room-note">Loading…</p>
        : state.error ? <p className="settings-room-note is-error">{state.error}</p>
        : (
          <div className="settings-room">
            <div className="settings-room-hours">
              <div className="settings-room-status">
                <span className={`settings-door-tag ${state.hours.enabled ? 'is-auto' : 'is-off'}`}>
                  {state.hours.enabled ? 'On · every day' : 'Off'}
                </span>
                {state.canEdit ? (
                  <button type="button" className={`settings-room-toggle${state.hours.enabled ? ' is-on' : ''}`}
                    role="switch" aria-checked={state.hours.enabled} onClick={toggleEnabled} disabled={busy}>
                    <span aria-hidden="true" /> {state.hours.enabled ? 'Turn off' : 'Turn on'}
                  </button>
                ) : null}
              </div>
              {state.canEdit ? (
                <div className="settings-room-inputs">
                  <label>From <input type="time" value={form.start} onChange={(event) => setForm((current) => ({ ...current, start: event.target.value }))} disabled={busy} /></label>
                  <label>To <input type="time" value={form.end} onChange={(event) => setForm((current) => ({ ...current, end: event.target.value }))} disabled={busy} /></label>
                  <button type="button" className="settings-primary-button settings-room-save" onClick={save} disabled={busy || !changed || invalid}>
                    {busy ? 'Saving…' : 'Save hours'}
                  </button>
                </div>
              ) : <strong>{state.hours.label}</strong>}
              {state.canEdit && invalid ? <p className="settings-room-note is-error">The end time must be after the start time.</p> : null}
              {notice.text ? <p className={`settings-room-note${notice.error ? ' is-error' : ''}`} role="status">{notice.text}</p> : null}
            </div>
            <ul className="settings-room-rules">
              <li><b>{count === 0 ? 'No staff' : count === 1 ? '1 staff member' : `${count} staff members`}</b> allowed right now.
                {state.canEdit ? <> Choose who in <a href={manageUsersHref}>Manage Users</a> (row menu → Allow Room Hours).</> : ' Only a Super Admin can change who is allowed.'}</li>
              <li>{state.hours.enabled
                ? 'The hours repeat every day and stay on until a Super Admin turns them off.'
                : 'Turned off: allowed staff need a schedule until it is turned on again. The hours and the allowed staff are kept.'}</li>
              <li>Outside these hours, allowed staff still need a schedule or an approved override. A running schedule is used first.</li>
              <li>Door access only: their portal privileges stay those of a staff account. Works offline too, and the 15-minute reminder plays before the hours end.</li>
            </ul>
          </div>
        )}
    </section>
  );
}

// Longer explanations shown on the Door control tab.
const DOOR_MODE_DETAILS = {
  auto: 'Recommended. Schedules apply online and offline: the door keeps a copy of today’s and the next 7 days’ schedules. With no saved copy, enrolled fingers can enter offline.',
  on: 'Schedules apply online and offline, from the door’s saved copy. With no saved copy, only the emergency card opens the door offline.',
  off: 'No schedule needed. Any active registered user can enter; every entry is still logged.',
};

const DOOR_LOCK_GUIDE = [
  { key: 'unlock', title: 'Unlock', text: 'Opens within seconds and stays open until someone locks it.' },
  { key: 'lock', title: 'Lock', text: 'Locks within seconds. People inside can still exit.' },
  { key: 'offline', title: 'While offline', text: 'Lock and unlock wait for the connection. Scheduling changes are sent when it reconnects.' },
];

function DoorLogsModal({ user, deviceId, onClose }) {
  const [state, setState] = useState({ loading: true, logs: [], error: '' });
  const load = () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    axiosClient.get('/api/door_control.php', { params: { actor_id: user?.id, device_id: deviceId || 1 } })
      .then((response) => setState({ loading: false, logs: response.data?.logs || [], error: '' }))
      .catch((error) => setState({ loading: false, logs: [], error: error.response?.data?.message || 'The door control logs could not be loaded.' }));
  };
  useEffect(() => {
    load();
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="settings-modal-overlay" role="presentation" onClick={onClose}>
      <div className="settings-modal settings-door-logs-modal" role="dialog" aria-modal="true"
        aria-labelledby="settings-door-logs-title" onClick={(event) => event.stopPropagation()}>
        <div className="settings-modal-header">
          <h3 id="settings-door-logs-title">Door control logs</h3>
          <div className="settings-door-logs-actions">
            <button type="button" className="settings-modal-close" onClick={load} aria-label="Refresh logs" disabled={state.loading}>
              <RefreshCcw size={16} aria-hidden="true" />
            </button>
            <button type="button" className="settings-modal-close" onClick={onClose} aria-label="Close dialog">
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
        <p className="settings-door-logs-intro">Scheduling changes, remote lock and unlock, the door&apos;s confirmations, and refused attempts. Newest first.</p>
        {state.loading ? <p className="settings-door-logs-empty">Loading…</p>
          : state.error ? <p className="settings-door-logs-empty is-error">{state.error}</p>
          : state.logs.length === 0 ? <p className="settings-door-logs-empty">No door control changes yet.</p>
          : (
            <ol className="settings-door-logs">
              {state.logs.map((log) => (
                <li key={log.id} className={log.status === 'Failed' ? 'is-failed' : ''}>
                  <time dateTime={log.created_at}>{formatDateTimeInManila(log.created_at)}</time>
                  <span>{log.description}</span>
                  <small>{log.actor_name}{log.status === 'Failed' ? ' · Refused' : ''}</small>
                </li>
              ))}
            </ol>
          )}
      </div>
    </div>
  );
}

/** Same as the header door popup: connection, scheduling mode and remote lock. */
function DoorControlCard({ user }) {
  const door = useDoorStatus();
  const [showLogs, setShowLogs] = useState(false);
  return (
    <article className="settings-card settings-door-card" role="tabpanel" aria-label="Door control">
      <div className="dashboard-panel-header">
        <div>
          <span>Door control</span>
          <p>{door.deviceName} · connection, scheduling and remote lock.</p>
        </div>
        <button type="button" className="settings-secondary-button" onClick={() => setShowLogs(true)}>
          <History size={16} aria-hidden="true" />
          View logs
        </button>
      </div>
      <DoorControlPanel door={door} user={user} variant="sections" modeDetails={DOOR_MODE_DETAILS} lockGuide={DOOR_LOCK_GUIDE} />
      {showLogs ? <DoorLogsModal user={user} deviceId={door.deviceId} onClose={() => setShowLogs(false)} /> : null}
    </article>
  );
}
