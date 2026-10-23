import {
  Eye,
  EyeOff,
  Fingerprint,
  IdCard,
  Info,
  Link2,
  Lock,
  Pencil,
  Save,
  Shield,
  ShieldCheck,
  UserCircle,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import axiosClient from '../../api/axiosClient';
import { formatDateTimeInManila } from '../../utils/dateTime';
import '../../styles/superAdmin/dashboard.css';
import { useActionConfirm } from '../../components/ActionConfirm';
import ErrorNoticeModal from '../../components/ErrorNoticeModal';
import '../../styles/superAdmin/settings.css';
import '../../styles/superAdmin/rfid.css';

const securityQuestionOptions = [
  'What is the name of your first school?',
  "What is your mother's maiden name?",
  'What city were you born in?',
  'What is the name of your favorite teacher?',
  'What was the name of your first pet?',
  'What is your favorite book?',
];

const emptySecurityForm = [
  { question: '', answer: '', originalQuestion: '', originalAnswer: '' },
  { question: '', answer: '', originalQuestion: '', originalAnswer: '' },
  { question: '', answer: '', originalQuestion: '', originalAnswer: '' },
];

function securitySlotsFromSaved(saved) {
  const list = Array.isArray(saved) ? saved : [];

  return [0, 1, 2].map((index) => {
    const match =
      list.find((item) => Number(item?.slot ?? item?.question_slot) === index + 1) ||
      list[index] ||
      {};
    const question = match.question || '';
    const answer = match.answer || '';

    return {
      question,
      answer,
      originalQuestion: question,
      originalAnswer: answer,
    };
  });
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

export default function ViewProfile({ user }) {
  const confirmAction = useActionConfirm();
  const [saveNotice, setSaveNotice] = useState('');
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
  const [isSecurityModalOpen, setIsSecurityModalOpen] = useState(false);
  const [securityForm, setSecurityForm] = useState(emptySecurityForm);
  const [visibleAnswers, setVisibleAnswers] = useState([false, false, false]);
  const [editableQuestions, setEditableQuestions] = useState([false, false, false]);
  const [securityError, setSecurityError] = useState('');
  const [isSavingSecurity, setIsSavingSecurity] = useState(false);
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
    if (!saveNotice) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setSaveNotice(''), 10000);
    return () => window.clearTimeout(timeoutId);
  }, [saveNotice]);

  const adminDisplayName = useMemo(() => {
    const fullName = [user?.first_name, user?.middle_name, user?.last_name, user?.extension_name]
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

  const passwordLastUpdatedLabel = useMemo(() => formatPasswordLastUpdated(adminProfile), [adminProfile]);

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
      { label: 'Password Protected', value: 'Your account is secured', icon: ShieldCheck },
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
    setAdminProfileForm((current) => ({ ...current, [key]: value }));

    if (['current_password', 'new_password', 'confirm_password'].includes(key)) {
      setAdminPasswordErrors((current) => ({ ...current, [key]: '', general: '' }));
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
      setAdminPasswordErrors((current) => ({ ...current, current_password: '' }));
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
    setPasswordVisibility((current) => ({ ...current, [fieldKey]: !current[fieldKey] }));
  }

  function openSecurityModal() {
    const slots = securitySlotsFromSaved(adminProfile?.security_questions);
    setSecurityForm(slots);
    setVisibleAnswers([true, true, true]);
    setEditableQuestions(slots.map((item) => !item.question));
    setSecurityError('');
    setIsSecurityModalOpen(true);
  }

  function closeSecurityModal() {
    if (isSavingSecurity) {
      return;
    }

    setIsSecurityModalOpen(false);
    setSecurityError('');
  }

  function updateSecurityQuestion(index, field, value) {
    setSecurityForm((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item)),
    );
    setSecurityError('');
  }

  async function handleSaveSecurityQuestions(event) {
    event.preventDefault();

    if (!user?.id || isSavingSecurity) {
      return;
    }

    const questions = securityForm.map((item) => ({
      question: item.question.trim(),
      answer: item.answer.trim(),
      originalQuestion: item.originalQuestion,
      originalAnswer: item.originalAnswer,
    }));

    if (questions.some((item) => !item.question)) {
      setSecurityError('Select three security questions.');
      return;
    }

    const invalidAnswer = questions.some((item) => {
      const canKeepSavedAnswer =
        item.answer === '' &&
        item.question === item.originalQuestion &&
        item.originalAnswer === '' &&
        item.originalQuestion !== '';

      if (item.answer.length >= 2) {
        return false;
      }

      return item.answer.length > 0 || !canKeepSavedAnswer;
    });

    if (invalidAnswer) {
      setSecurityError('Each answer must be at least 2 characters. Leave a blank answer only to keep one already saved.');
      return;
    }

    if (new Set(questions.map((item) => item.question)).size !== 3) {
      setSecurityError('Choose three different security questions.');
      return;
    }

    const hasChanges = questions.some(
      (item) => item.question !== item.originalQuestion || item.answer !== item.originalAnswer,
    );

    if (!hasChanges) {
      setSecurityError('Change a question or answer before updating.');
      return;
    }

    const confirmed = await confirmAction({
      title: 'Update security questions',
      message: 'Are you sure you want to update your security questions?',
    });

    if (!confirmed) {
      return;
    }

    setIsSavingSecurity(true);
    setSecurityError('');

    try {
      const response = await axiosClient.post('/api/admin_profile.php', {
        action: 'update_security_questions',
        user_id: user.id,
        security_questions: questions.map((item) => ({
          question: item.question,
          answer: item.answer,
        })),
      });
      const refreshed = await axiosClient.get(
        `/api/admin_profile.php?user_id=${encodeURIComponent(user.id)}`,
      );
      setAdminProfile(refreshed.data?.profile || null);
      setIsSecurityModalOpen(false);
      setSaveNotice(response.data?.message || 'Security questions updated successfully.');
    } catch (error) {
      setSecurityError(error?.response?.data?.message || 'Unable to update security questions.');
    } finally {
      setIsSavingSecurity(false);
    }
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

    if (nextErrors.current_password || nextErrors.new_password || nextErrors.confirm_password) {
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

      if (
        errorMessage === 'Current password is required to change the password.' ||
        errorMessage === 'Current password is incorrect.'
      ) {
        setAdminPasswordErrors((current) => ({ ...current, current_password: errorMessage }));
      } else if (
        errorMessage === 'New password is required.' ||
        errorMessage === 'New password must be at least 6 characters long.'
      ) {
        setAdminPasswordErrors((current) => ({ ...current, new_password: errorMessage }));
      } else {
        setAdminPasswordErrors((current) => ({ ...current, general: errorMessage }));
      }
    } finally {
      setIsSavingAdminProfile(false);
    }
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
    <main className="admin-dashboard settings-page" aria-label="Admin information">
      {saveNotice ? (
        <section className="settings-notice" aria-live="polite">
          <span>{saveNotice}</span>
          <button type="button" className="settings-notice-close" onClick={() => setSaveNotice('')} aria-label="Dismiss message">
            <X size={16} aria-hidden="true" />
          </button>
        </section>
      ) : null}
      <section className="settings-grid" aria-label="Admin information">
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
                onClick={openSecurityModal}
                disabled={isAdminProfileLoading || isSavingSecurity}
              >
                <ShieldCheck size={18} aria-hidden="true" />
                Update Security Question
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

          {isSecurityModalOpen ? (
            <div
              className="pending-registration-review-backdrop settings-admin-edit-backdrop"
              role="presentation"
              onClick={closeSecurityModal}
            >
              <form
                className="pending-registration-review settings-security-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="admin-security-title"
                onClick={(event) => event.stopPropagation()}
                onSubmit={handleSaveSecurityQuestions}
              >
                <header>
                  <div>
                    <h2 id="admin-security-title">Update Security Questions</h2>
                  </div>
                  <button
                    type="button"
                    aria-label="Close security questions"
                    onClick={closeSecurityModal}
                    disabled={isSavingSecurity}
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </header>

                <div className="settings-security-layout">
                  <div className="settings-security-fields">
                    {securityForm.map((item, index) => (
                      <div className="settings-security-group" key={`security-question-${index}`}>
                        <label className="settings-security-field">
                          <span>Security question {index + 1}</span>
                          {item.question && !editableQuestions[index] ? (
                            <span className="settings-security-current">
                              <input type="text" value={item.question} readOnly />
                              <button
                                type="button"
                                onClick={() =>
                                  setEditableQuestions((current) =>
                                    current.map((editable, itemIndex) => (itemIndex === index ? true : editable)),
                                  )
                                }
                                disabled={isSavingSecurity}
                              >
                                Change
                              </button>
                            </span>
                          ) : (
                            <select
                              value={item.question}
                              onChange={(event) => updateSecurityQuestion(index, 'question', event.target.value)}
                              disabled={isSavingSecurity}
                            >
                              <option value="">Select a question</option>
                              {(item.question && !securityQuestionOptions.includes(item.question)
                                ? [item.question, ...securityQuestionOptions]
                                : securityQuestionOptions
                              ).map((question) => (
                                <option
                                  key={question}
                                  value={question}
                                  disabled={securityForm.some(
                                    (entry, entryIndex) => entryIndex !== index && entry.question === question,
                                  )}
                                >
                                  {question}
                                </option>
                              ))}
                            </select>
                          )}
                        </label>
                        <label className="settings-security-field">
                          <span>Answer</span>
                          <span className="settings-security-answer">
                            <input
                              type={visibleAnswers[index] ? 'text' : 'password'}
                              value={item.answer}
                              maxLength={100}
                              autoComplete="off"
                              placeholder={
                                item.originalAnswer
                                  ? ''
                                  : item.originalQuestion
                                    ? 'Leave blank to keep the saved answer'
                                    : 'Enter your answer'
                              }
                              onChange={(event) => updateSecurityQuestion(index, 'answer', event.target.value)}
                            />
                            <button
                              type="button"
                              aria-label={visibleAnswers[index] ? 'Hide answer' : 'Show answer'}
                              onClick={() =>
                                setVisibleAnswers((current) =>
                                  current.map((visible, itemIndex) => (itemIndex === index ? !visible : visible)),
                                )
                              }
                            >
                              {visibleAnswers[index] ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                          </span>
                          {!item.originalAnswer && item.originalQuestion ? (
                            <small className="settings-security-hint">
                              A saved answer is on file. Leave this blank to keep it, or type a new one.
                            </small>
                          ) : null}
                        </label>
                      </div>
                    ))}
                  </div>

                  <aside className="settings-security-info" aria-label="Why security questions are needed">
                    <div>
                      <span><Shield size={16} aria-hidden="true" /></span>
                      <div>
                        <h3>Why do we need this?</h3>
                        <p>Your answers keep your account safe and recoverable.</p>
                      </div>
                    </div>
                    <div>
                      <span><ShieldCheck size={16} aria-hidden="true" /></span>
                      <div>
                        <h3>Account Recovery</h3>
                        <p>Verify your identity if you ever forget your password.</p>
                      </div>
                    </div>
                    <div>
                      <span><Link2 size={16} aria-hidden="true" /></span>
                      <div>
                        <h3>Keep It Private</h3>
                        <p>Pick answers only you would know and avoid guessable details.</p>
                      </div>
                    </div>
                    <div>
                      <span><Lock size={16} aria-hidden="true" /></span>
                      <div>
                        <h3>Only You Can See Them</h3>
                        <p>Your saved answers are shown here so you can review and update them.</p>
                      </div>
                    </div>
                    <div className="settings-security-note">
                      <Info size={15} aria-hidden="true" />
                      <p>Choose answers you'll remember. You'll need them to regain access to your account.</p>
                    </div>
                  </aside>
                </div>

                <footer>
                  <button
                    type="button"
                    className="pending-registration-reject"
                    onClick={closeSecurityModal}
                    disabled={isSavingSecurity}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="pending-registration-approve" disabled={isSavingSecurity}>
                    {isSavingSecurity ? 'Updating...' : 'Update'}
                  </button>
                </footer>
              </form>
            </div>
          ) : null}

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
                aria-labelledby="admin-edit-title"
                onClick={(event) => event.stopPropagation()}
                onSubmit={(event) => {
                  event.preventDefault();
                  handleSaveAdminInfo();
                }}
              >
                <header>
                  <div>
                    <h2 id="admin-edit-title">Edit Admin Information</h2>
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
      </section>
      <ErrorNoticeModal
        open={Boolean(adminProfileError)}
        message={adminProfileError}
        onClose={() => setAdminProfileError('')}
      />
      <ErrorNoticeModal
        open={Boolean(securityError)}
        message={securityError}
        onClose={() => setSecurityError('')}
      />
    </main>
  );
}
