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
import { useActionConfirm } from '../../components/ActionConfirm';
import PortalToast from '../../components/PortalToast';
import '../../styles/superAdmin/dashboard.css';
import '../../styles/superAdmin/settings.css';
import '../../styles/superAdmin/rfid.css';
import '../../styles/user/userPortal.css';

const securityQuestionOptions = [
  'What is the name of your first school?',
  "What is your mother's maiden name?",
  'What city were you born in?',
  'What is the name of your favorite teacher?',
  'What was the name of your first pet?',
  'What is your favorite book?',
];

const emptySecurityQuestions = [
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

function displayValue(value) {
  const text = String(value ?? '').trim();
  return text || 'Not available';
}

function formatRole(role) {
  const text = String(role ?? '').replace(/_/g, ' ').trim();
  if (!text) {
    return 'Not available';
  }

  return text.replace(/\b\w/g, (character) => character.toUpperCase());
}

function credentialCountLabel(count, emptyLabel) {
  const total = Number(count);
  if (!Number.isFinite(total)) {
    return 'Not available';
  }

  if (total === 0) {
    return emptyLabel;
  }

  return `${total} active`;
}

export default function MyAccount({ user }) {
  const confirmAction = useActionConfirm();
  const [profile, setProfile] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [notice, setNotice] = useState(null);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isEditingPassword, setIsEditingPassword] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [isSecurityModalOpen, setIsSecurityModalOpen] = useState(false);
  const [isSavingSecurity, setIsSavingSecurity] = useState(false);
  const [visibleAnswers, setVisibleAnswers] = useState([false, false, false]);
  const [editableQuestions, setEditableQuestions] = useState([false, false, false]);
  const [profileForm, setProfileForm] = useState({
    contactNumber: '',
    streetAddress: '',
    barangay: '',
    cityMunicipality: '',
    province: '',
  });
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [passwordErrors, setPasswordErrors] = useState({});
  const [passwordVisibility, setPasswordVisibility] = useState({
    currentPassword: false,
    newPassword: false,
    confirmPassword: false,
  });
  const [securityForm, setSecurityForm] = useState(emptySecurityQuestions);
  const [securityError, setSecurityError] = useState('');

  useEffect(() => {
    if (!notice) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setNotice(null), 8000);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  useEffect(() => {
    if (!user?.id) {
      return undefined;
    }

    let isActive = true;

    async function loadProfile() {
      setIsLoading(true);
      try {
        const response = await axiosClient.get('/api/user_portal.php', {
          params: { action: 'profile', user_id: user.id },
        });

        if (!isActive) {
          return;
        }

        const loaded = response.data.profile || null;
        setProfile(loaded);
        setProfileForm({
          contactNumber: loaded?.contactNumber || '',
          streetAddress: loaded?.streetAddress || '',
          barangay: loaded?.barangay || '',
          cityMunicipality: loaded?.cityMunicipality || '',
          province: loaded?.province || '',
        });
        setSecurityForm(securitySlotsFromSaved(loaded?.securityQuestions));
        setErrorMessage('');
      } catch (error) {
        if (isActive) {
          setProfile(null);
          setErrorMessage(error?.response?.data?.message || 'Unable to load account details.');
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    loadProfile();

    return () => {
      isActive = false;
    };
  }, [user?.id]);

  const personalInfo = useMemo(
    () => [
      { label: 'Name', value: displayValue(profile?.name) },
      { label: 'Sex', value: displayValue(profile?.sex) },
      { label: 'Date of birth', value: displayValue(profile?.dateOfBirth) },
      { label: 'Age', value: displayValue(profile?.age) },
      { label: 'Contact number', value: displayValue(profile?.contactNumber), editable: true },
    ],
    [profile],
  );

  const accountInfo = useMemo(
    () => [
      { label: 'Username', value: displayValue(profile?.username || user?.username) },
      { label: 'Employee ID', value: displayValue(profile?.employeeId) },
      { label: 'Email', value: displayValue(profile?.email || user?.email) },
      { label: 'Role', value: formatRole(profile?.role || user?.role) },
      { label: 'Office / Department', value: displayValue(profile?.officeDepartment) },
      { label: 'Work position', value: displayValue(profile?.workPosition) },
    ],
    [profile, user],
  );

  const addressInfo = useMemo(
    () => [
      { label: 'Street address', value: displayValue(profile?.streetAddress) },
      { label: 'Barangay', value: displayValue(profile?.barangay) },
      { label: 'City / Municipality', value: displayValue(profile?.cityMunicipality) },
      { label: 'Province', value: displayValue(profile?.province) },
    ],
    [profile],
  );

  const securityOverview = useMemo(
    () => [
      { label: 'Password Protected', value: 'Your account is secured', icon: ShieldCheck },
      {
        label: 'Registered Fingerprints',
        value: credentialCountLabel(profile?.fingerprintCount, 'None enrolled'),
        icon: Fingerprint,
      },
      {
        label: 'Registered RFID Cards',
        value: credentialCountLabel(profile?.rfidCount, 'None issued'),
        icon: IdCard,
      },
    ],
    [profile],
  );

  const readonlyEditFields = useMemo(
    () => [
      { label: 'Full name', value: displayValue(profile?.name) },
      { label: 'Username', value: displayValue(profile?.username || user?.username) },
      { label: 'Employee ID', value: displayValue(profile?.employeeId) },
      { label: 'Email', value: displayValue(profile?.email || user?.email) },
      { label: 'Role', value: formatRole(profile?.role || user?.role) },
      { label: 'Office / Department', value: displayValue(profile?.officeDepartment) },
      { label: 'Work position', value: displayValue(profile?.workPosition) },
    ],
    [profile, user],
  );

  async function handleSaveProfile(event) {
    event.preventDefault();

    const confirmed = await confirmAction({
      title: 'Update profile',
      message: 'Are you sure you want to save these profile changes?',
    });

    if (!confirmed) {
      return;
    }

    setIsSavingProfile(true);

    try {
      const response = await axiosClient.post('/api/user_portal.php', {
        action: 'update_profile',
        user_id: user.id,
        ...profileForm,
      });
      const loaded = response.data.profile;
      setProfile(loaded);
      setIsEditingProfile(false);
      setNotice({
        type: 'success',
        title: 'Account Notice',
        message: response.data.message || 'Profile updated successfully.',
      });
    } catch (error) {
      setNotice({
        type: 'error',
        title: 'Account Notice',
        message: error?.response?.data?.message || 'Unable to update profile.',
      });
    } finally {
      setIsSavingProfile(false);
    }
  }

  async function handleSavePassword(event) {
    event.preventDefault();
    const errors = {};

    if (!passwordForm.currentPassword) {
      errors.currentPassword = 'Current password is required.';
    }

    if (!passwordForm.newPassword || passwordForm.newPassword.length < 8) {
      errors.newPassword = 'New password must be at least 8 characters.';
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      errors.confirmPassword = 'New password confirmation does not match.';
    }

    setPasswordErrors(errors);

    if (Object.keys(errors).length) {
      return;
    }

    const confirmed = await confirmAction({
      title: 'Change password',
      message: 'Are you sure you want to change your account password?',
      danger: true,
    });

    if (!confirmed) {
      return;
    }

    setIsSavingPassword(true);

    try {
      const response = await axiosClient.post('/api/user_portal.php', {
        action: 'change_password',
        user_id: user.id,
        ...passwordForm,
      });
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setPasswordVisibility({
        currentPassword: false,
        newPassword: false,
        confirmPassword: false,
      });
      setIsEditingPassword(false);
      try {
        const refreshed = await axiosClient.get('/api/user_portal.php', {
          params: { action: 'profile', user_id: user.id },
        });
        setProfile(refreshed.data.profile || null);
      } catch {
        // The password is already saved. A refresh failure should not hide that result.
      }
      setNotice({
        type: 'success',
        title: 'Account Notice',
        message: response.data.message || 'Password updated successfully.',
      });
    } catch (error) {
      setPasswordErrors({
        general: error?.response?.data?.message || 'Unable to update password.',
      });
    } finally {
      setIsSavingPassword(false);
    }
  }

  function handleStartProfileEdit() {
    setProfileForm({
      contactNumber: profile?.contactNumber || '',
      streetAddress: profile?.streetAddress || '',
      barangay: profile?.barangay || '',
      cityMunicipality: profile?.cityMunicipality || '',
      province: profile?.province || '',
    });
    setIsEditingProfile(true);
  }

  function handleCancelProfileEdit() {
    if (isSavingProfile) {
      return;
    }

    setIsEditingProfile(false);
  }

  function handleCancelPasswordEdit() {
    setIsEditingPassword(false);
    setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    setPasswordVisibility({
      currentPassword: false,
      newPassword: false,
      confirmPassword: false,
    });
    setPasswordErrors({});
  }

  function renderPasswordField(field, label, placeholder) {
    const isVisible = passwordVisibility[field];

    return (
      <div className={`settings-admin-edit-field${passwordErrors[field] ? ' settings-admin-edit-field-error' : ''}`}>
        <dt>{label}</dt>
        <dd>
          <div className="settings-password-input-wrap">
            <input
              type={isVisible ? 'text' : 'password'}
              placeholder={placeholder}
              value={passwordForm[field]}
              onChange={(event) =>
                setPasswordForm((current) => ({
                  ...current,
                  [field]: event.target.value,
                }))
              }
              disabled={isSavingPassword}
            />
            <button
              type="button"
              className="settings-password-toggle"
              onClick={() =>
                setPasswordVisibility((current) => ({
                  ...current,
                  [field]: !current[field],
                }))
              }
              disabled={isSavingPassword}
              aria-label={`${isVisible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
              aria-pressed={isVisible}
            >
              {isVisible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
            </button>
          </div>
          {passwordErrors[field] ? (
            <small className="settings-admin-field-error">{passwordErrors[field]}</small>
          ) : null}
        </dd>
      </div>
    );
  }

  function openSecurityModal() {
    const slots = securitySlotsFromSaved(profile?.securityQuestions);
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

  async function handleSaveSecurity(event) {
    event.preventDefault();
    setSecurityError('');

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

    const unique = new Set(questions.map((item) => item.question));
    if (unique.size !== 3) {
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

    try {
      const response = await axiosClient.post('/api/user_portal.php', {
        action: 'update_security_questions',
        user_id: user.id,
        securityQuestions: questions.map((item) => ({
          question: item.question,
          answer: item.answer,
        })),
      });
      setProfile(response.data.profile);
      setSecurityForm(securitySlotsFromSaved(response.data.profile?.securityQuestions));
      setIsSecurityModalOpen(false);
      setNotice({
        type: 'success',
        title: 'Account Notice',
        message: response.data.message || 'Security questions updated successfully.',
      });
    } catch (error) {
      setSecurityError(error?.response?.data?.message || 'Unable to update security questions.');
    } finally {
      setIsSavingSecurity(false);
    }
  }

  return (
    <main className="admin-dashboard settings-page user-portal-page" aria-label="My account">
      {notice ? (
        <PortalToast
          title={notice.title || 'Notice'}
          message={notice.message}
          type={notice.type || 'success'}
          onClose={() => setNotice(null)}
        />
      ) : null}
      {errorMessage ? <p className="settings-admin-error">{errorMessage}</p> : null}

      <section className="settings-grid" aria-label="Account information">
        <article className="settings-card" role="tabpanel" aria-label="Account information">
          <div className="dashboard-panel-header">
            <div>
              <span>Account information</span>
              <p>Details for the currently signed-in faculty or staff account.</p>
            </div>
          </div>

          <div className="settings-admin-dashboard">
            <section className="settings-admin-profile-summary" id="security" aria-label="Account profile summary">
              <div className="settings-admin-profile-avatar">
                <UserCircle size={84} strokeWidth={1.3} aria-hidden="true" />
              </div>

              <h3 className="settings-admin-profile-name">{isLoading ? 'Loading…' : displayValue(profile?.name)}</h3>
              <span className="settings-admin-profile-role">
                <ShieldCheck size={14} aria-hidden="true" />
                {formatRole(profile?.role || user?.role)}
              </span>

              <div className="settings-admin-profile-meta">
                <span>Employee ID</span>
                <strong>{isLoading ? 'Loading…' : displayValue(profile?.employeeId)}</strong>
              </div>

              <button
                type="button"
                className="settings-admin-profile-edit-button"
                onClick={openSecurityModal}
                disabled={isLoading || isSavingSecurity}
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
                  onClick={handleStartProfileEdit}
                  disabled={isLoading || isSavingProfile || !profile}
                >
                  <Pencil size={16} aria-hidden="true" />
                  Edit
                </button>
              </header>

              <div className="settings-admin-review-stack">
                <section className="pending-registration-review-card">
                  <h3>Personal Information</h3>
                  <dl>
                    {personalInfo.map((item) => (
                      <div key={item.label}>
                        <dt>{item.label}</dt>
                        <dd>{isLoading ? 'Loading…' : item.value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>

                <section className="pending-registration-review-card">
                  <h3>Address</h3>
                  <dl>
                    {addressInfo.map((item) => (
                      <div key={item.label}>
                        <dt>{item.label}</dt>
                        <dd>{isLoading ? 'Loading…' : item.value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>

                <section className="pending-registration-review-card">
                  <h3>Account Information</h3>
                  <dl>
                    {accountInfo.map((item) => (
                      <div key={item.label}>
                        <dt>{item.label}</dt>
                        <dd>{isLoading ? 'Loading…' : item.value}</dd>
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
                {securityOverview.map(({ label, value, icon: Icon }) => (
                  <div className="settings-admin-overview-item" key={label}>
                    <span className="settings-admin-overview-icon" aria-hidden="true">
                      <Icon size={20} />
                    </span>
                    <div className="settings-admin-overview-body">
                      <strong>{label}</strong>
                      <span>{isLoading ? 'Loading…' : value}</span>
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
                  onClick={isEditingPassword ? handleCancelPasswordEdit : () => setIsEditingPassword(true)}
                  disabled={isSavingPassword || isLoading}
                >
                  <ShieldCheck size={16} aria-hidden="true" />
                  {isEditingPassword ? 'Cancel' : 'Update Password'}
                </button>
              </header>

              <div className="settings-admin-review-stack">
                <section className="pending-registration-review-card settings-admin-password-card">
                  <h3>Password</h3>
                  <dl>
                    {!isEditingPassword ? (
                      <>
                        <div>
                          <dt>Current password</dt>
                          <dd>**********</dd>
                        </div>
                        <div>
                          <dt>Last updated</dt>
                          <dd>{isLoading ? 'Loading…' : displayValue(profile?.passwordUpdatedAt)}</dd>
                        </div>
                      </>
                    ) : (
                      <>
                        {renderPasswordField('currentPassword', 'Current password', 'Enter current password')}
                        {renderPasswordField('newPassword', 'New password', 'Enter new password')}
                        {renderPasswordField('confirmPassword', 'Confirm password', 'Confirm new password')}
                      </>
                    )}
                  </dl>
                </section>
              </div>

              {passwordErrors.general ? (
                <p className="settings-admin-error settings-admin-error-inline">{passwordErrors.general}</p>
              ) : null}

              {isEditingPassword ? (
                <div className="settings-admin-security-actions">
                  <button
                    type="button"
                    className="pending-registration-approve"
                    onClick={handleSavePassword}
                    disabled={isSavingPassword || isLoading}
                  >
                    <ShieldCheck size={16} aria-hidden="true" />
                    {isSavingPassword ? 'Updating...' : 'Change Password'}
                  </button>
                </div>
              ) : null}
            </section>
          </div>
        </article>
      </section>

      {isEditingProfile ? (
        <div
          className="pending-registration-review-backdrop settings-admin-edit-backdrop"
          role="presentation"
          onClick={handleCancelProfileEdit}
        >
          <form
            className="pending-registration-review settings-admin-edit-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="faculty-edit-title"
            onClick={(event) => event.stopPropagation()}
            onSubmit={handleSaveProfile}
          >
            <header>
              <div>
                <h2 id="faculty-edit-title">Edit Account Information</h2>
                <p>Update contact number and address details for this account.</p>
              </div>
              <button
                type="button"
                aria-label="Close dialog"
                onClick={handleCancelProfileEdit}
                disabled={isSavingProfile}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </header>

            <div className="pending-registration-review-body">
              <section className="pending-registration-review-card">
                <h3>Account Information</h3>
                <dl>
                  {readonlyEditFields.map((field) => (
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
                  {[
                    { label: 'Sex', value: displayValue(profile?.sex) },
                    { label: 'Date of birth', value: displayValue(profile?.dateOfBirth) },
                    { label: 'Age', value: displayValue(profile?.age) },
                  ].map((field) => (
                    <div key={field.label} className="settings-admin-edit-field">
                      <dt>{field.label}</dt>
                      <dd>
                        <input type="text" value={field.value} readOnly />
                      </dd>
                    </div>
                  ))}
                  <div className="settings-admin-edit-field">
                    <dt>Contact number</dt>
                    <dd>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={11}
                        value={profileForm.contactNumber}
                        onChange={(event) =>
                          setProfileForm((current) => ({
                            ...current,
                            contactNumber: event.target.value.replace(/\D/g, '').slice(0, 11),
                          }))
                        }
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
                        value={profileForm.streetAddress}
                        onChange={(event) =>
                          setProfileForm((current) => ({ ...current, streetAddress: event.target.value }))
                        }
                      />
                    </dd>
                  </div>
                  <div className="settings-admin-edit-field">
                    <dt>Barangay</dt>
                    <dd>
                      <input
                        type="text"
                        value={profileForm.barangay}
                        onChange={(event) =>
                          setProfileForm((current) => ({ ...current, barangay: event.target.value }))
                        }
                      />
                    </dd>
                  </div>
                  <div className="settings-admin-edit-field">
                    <dt>City / Municipality</dt>
                    <dd>
                      <input
                        type="text"
                        value={profileForm.cityMunicipality}
                        onChange={(event) =>
                          setProfileForm((current) => ({ ...current, cityMunicipality: event.target.value }))
                        }
                      />
                    </dd>
                  </div>
                  <div className="settings-admin-edit-field">
                    <dt>Province</dt>
                    <dd>
                      <input
                        type="text"
                        value={profileForm.province}
                        onChange={(event) =>
                          setProfileForm((current) => ({ ...current, province: event.target.value }))
                        }
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
                onClick={handleCancelProfileEdit}
                disabled={isSavingProfile}
              >
                Cancel
              </button>
              <button type="submit" className="pending-registration-approve" disabled={isSavingProfile}>
                <Save size={16} aria-hidden="true" />
                {isSavingProfile ? 'Saving...' : 'Save Changes'}
              </button>
            </footer>
          </form>
        </div>
      ) : null}

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
            aria-labelledby="faculty-security-title"
            onClick={(event) => event.stopPropagation()}
            onSubmit={handleSaveSecurity}
          >
            <header>
              <div>
                <h2 id="faculty-security-title">Update Security Questions</h2>
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

            {securityError ? <p className="pending-registration-error" role="alert">{securityError}</p> : null}

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
    </main>
  );
}
