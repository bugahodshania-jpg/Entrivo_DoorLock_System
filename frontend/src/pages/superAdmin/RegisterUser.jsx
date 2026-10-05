import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff, Fingerprint, KeyRound, X } from 'lucide-react';
import axiosClient from '../../api/axiosClient';
import { useActionConfirm } from '../../components/ActionConfirm';
import {
  composeSchoolEmail,
  formatRole,
  normalizeIssuedId,
  roleOptions,
  schoolEmailDomain,
  temporaryPassword,
} from '../../utils/schoolProfileOptions';
import { portalHref } from '../../utils/privileges';
import '../../styles/superAdmin/dashboard.css';
import '../../styles/superAdmin/registerUser.css';

const registrationDraftKey = 'entrivo_register_user_draft';

const adminBlockedRoles = new Set(['faculty', 'staff', 'super_admin']);

function normalizeInitialRole(role) {
  const normalizedRole = (role || '').toLowerCase();

  if (normalizedRole === 'admins') return 'admin';
  if (normalizedRole === 'students') return 'student';
  if (normalizedRole === 'superadmin') return 'super_admin';

  return roleOptions.some((option) => option.value === normalizedRole) ? normalizedRole : 'faculty';
}

function toTitleCase(value) {
  return value
    .toLowerCase()
    .replace(/(^|[\s-])([a-z])/g, (match, separator, letter) => `${separator}${letter.toUpperCase()}`);
}

function readDraft(role) {
  const fallback = {
    role,
    identifier: '',
    school_email: '',
    first_name: '',
    last_name: '',
    username: '',
  };

  try {
    const saved = window.sessionStorage.getItem(registrationDraftKey);
    if (!saved) return fallback;
    const parsed = JSON.parse(saved);
    return { ...fallback, ...(parsed || {}), role: parsed?.role || role };
  } catch {
    return fallback;
  }
}

export default function RegisterUser({ user: currentUser } = {}) {
  const confirmAction = useActionConfirm();
  const params = new URLSearchParams(window.location.search);
  const isLimitedAdmin = currentUser?.role === 'admin';
  const requestedRole = normalizeInitialRole(params.get('role'));
  const initialRole = isLimitedAdmin && adminBlockedRoles.has(requestedRole) ? 'student' : requestedRole;
  const availableRoles = isLimitedAdmin
    ? roleOptions.filter((option) => !adminBlockedRoles.has(option.value))
    : roleOptions;
  const [form, setForm] = useState(() => {
    const draft = readDraft(initialRole);
    const draftRole = isLimitedAdmin && adminBlockedRoles.has(draft.role) ? 'student' : draft.role;

    return { ...draft, role: draftRole };
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [touched, setTouched] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [superAdminSlotsFull, setSuperAdminSlotsFull] = useState(false);
  const [savedUser, setSavedUser] = useState(null);
  const schoolEmailInputRef = useRef(null);
  const schoolEmailCursorRef = useRef(null);

  const isStudent = form.role === 'student';
  const idKind = isStudent ? 'student' : 'employee';
  const idFormat = isStudent ? 'xxxx-xxxx' : 'xxxxxx-xxxxxx';
  const idLabel = isStudent ? 'School ID' : 'Employee ID';
  const generatedPassword = temporaryPassword(form.username, form.identifier);
  const composedEmail = composeSchoolEmail(form.school_email);
  const schoolEmailValue = form.school_email ? `${form.school_email}@${schoolEmailDomain}` : '';
  const roleLabel = formatRole(form.role);
  const passwordExample = isStudent
    ? 'Example: username firstname.lastname and ID 2023-0471 becomes firstname.lastname@0471.'
    : 'Example: username firstname.lastname and ID 202301-004712 becomes firstname.lastname@004712.';

  const errors = useMemo(() => {
    const next = {};
    if (!form.role) next.role = 'Role is required.';
    if (form.role === 'super_admin' && superAdminSlotsFull) {
      next.role = 'The super admin limit has been reached.';
    }
    if (!form.identifier.trim()) next.identifier = `${idLabel} is required.`;
    else if (!(isStudent ? /^\d{4}-\d{4}$/ : /^\d{6}-\d{6}$/).test(form.identifier)) {
      next.identifier = `${idLabel} must use ${idFormat} format.`;
    }
    if (!form.school_email.trim()) next.school_email = 'School email is required.';
    else if (!composedEmail) {
      next.school_email = 'Use 3 to 50 characters, starting with a letter. Letters, numbers, dots, underscores, and hyphens only.';
    }
    if (!form.first_name.trim()) next.first_name = 'First name is required.';
    if (!form.last_name.trim()) next.last_name = 'Last name is required.';
    if (!form.username.trim()) next.username = 'Username is required.';
    else if (!/^[A-Za-z][A-Za-z0-9._-]{2,49}$/.test(form.username.trim())) {
      next.username = 'Use 3 to 50 characters, starting with a letter. Letters, numbers, dots, underscores, and hyphens only.';
    } else if (isStudent && !form.username.includes('.')) {
      next.username = 'Username must include a dot (.).';
    }
    if (form.username.trim() && form.identifier && !generatedPassword) {
      next.password = 'Enter a valid username and ID to generate the temporary password.';
    }
    return next;
  }, [composedEmail, form, generatedPassword, idFormat, idLabel, isStudent, superAdminSlotsFull]);

  function updateField(field, value) {
    setForm((current) => {
      if (field !== 'role') {
        return { ...current, [field]: value };
      }

      const nextIsStudent = value === 'student';
      return {
        ...current,
        role: value,
        identifier: normalizeIssuedId(current.identifier, nextIsStudent ? 'student' : 'employee'),
      };
    });
  }

  function schoolEmailLocalPart(value) {
    const compact = String(value || '').replace(/\s/g, '');
    const suffix = `@${schoolEmailDomain}`;
    const lower = compact.toLowerCase();

    if (lower.endsWith(suffix)) {
      return compact.slice(0, compact.length - suffix.length);
    }

    const at = lower.indexOf('@');
    if (at >= 0) {
      return compact.slice(0, at);
    }

    const currentLocal = form.school_email;
    if (!currentLocal) {
      return compact;
    }

    const currentLower = currentLocal.toLowerCase();
    if (lower.startsWith(currentLower)) {
      const remainder = lower.slice(currentLower.length);
      if (schoolEmailDomain.startsWith(remainder)) {
        return currentLocal;
      }
    }

    if (currentLower.startsWith(lower)) {
      return compact;
    }

    return compact;
  }

  function handleSchoolEmailChange(event) {
    const input = event.target;
    const local = schoolEmailLocalPart(input.value);
    const cursor = Math.min(input.selectionStart ?? local.length, local.length);
    schoolEmailCursorRef.current = cursor;
    updateField('school_email', local);
  }

  useLayoutEffect(() => {
    const input = schoolEmailInputRef.current;
    const cursor = schoolEmailCursorRef.current;
    if (!input || cursor == null || document.activeElement !== input) {
      return;
    }

    input.setSelectionRange(cursor, cursor);
  }, [form.school_email]);

  function fieldError(field) {
    return submitted || touched[field] ? errors[field] || '' : '';
  }

  function fieldMessage(field, hint = '') {
    const error = fieldError(field);

    if (error) {
      return <small className="register-create-field-error">{error}</small>;
    }

    return hint ? <small>{hint}</small> : null;
  }

  function leaveRegistration() {
    window.sessionStorage.removeItem(registrationDraftKey);
    window.location.assign(portalHref('/super-admin/manage-users'));
  }

  function enrollNow() {
    const userId = savedUser?.user_id || savedUser?.id;
    const fingerprintId = savedUser?.fingerprint?.fingerprint_id;
    const nextParams = new URLSearchParams();
    if (userId) nextParams.set('enroll_user_id', String(userId));
    if (fingerprintId) nextParams.set('fingerprint_id', String(fingerprintId));
    window.sessionStorage.removeItem(registrationDraftKey);
    window.location.assign(portalHref(`/super-admin/fingerprint?${nextParams.toString()}`));
  }

  useEffect(() => {
    let active = true;

    async function loadCapacity() {
      try {
        const response = await axiosClient.get('/api/user.php');
        const admins = response.data?.users?.admins || [];
        const count = admins.filter((user) => user.role === 'super_admin' && user.status !== 'blocked').length;
        if (active) setSuperAdminSlotsFull(count >= 2);
      } catch {
        if (active) setSuperAdminSlotsFull(false);
      }
    }

    loadCapacity();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (savedUser) return;
    try {
      window.sessionStorage.setItem(registrationDraftKey, JSON.stringify(form));
    } catch {
      // Ignore storage limits so the form stays usable.
    }
  }, [form, savedUser]);

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitted(true);
    setErrorMessage('');

    if (isLimitedAdmin && adminBlockedRoles.has(form.role)) {
      setErrorMessage('Admin accounts cannot create super admin, faculty, or staff users.');
      return;
    }

    if (Object.keys(errors).length > 0) {
      setErrorMessage('Please correct the highlighted fields before creating the account.');
      return;
    }

    const confirmed = await confirmAction({
      title: 'Create account',
      message: `Create this ${roleLabel.toLowerCase()} account and email the temporary password?`,
    });
    if (!confirmed) return;

    setIsSaving(true);

    try {
      let actorId;
      try {
        const raw = window.localStorage.getItem('entrivo_user') || window.sessionStorage.getItem('entrivo_user');
        actorId = raw ? JSON.parse(raw)?.id : undefined;
      } catch {
        actorId = undefined;
      }

      const response = await axiosClient.post('/api/user.php', {
        role: form.role,
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        username: form.username.trim(),
        email: composedEmail,
        ...(isStudent
          ? { school_id: form.identifier }
          : { employee_id: form.identifier }),
        actor_id: actorId,
      });

      window.sessionStorage.removeItem(registrationDraftKey);
      setShowPassword(false);
      setSavedUser(response.data.user);
    } catch (error) {
      setErrorMessage(error.response?.data?.message || 'Unable to save this user. Please check the required details.');
    } finally {
      setIsSaving(false);
    }
  }

  const issuedPassword = savedUser?.temporary_password || '';

  return (
    <div className="register-create-backdrop" role="presentation">
      <section
        className="register-create-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="register-create-title"
      >
        <div className="register-create-heading">
          <div className="register-create-heading-row">
            <p>{savedUser ? 'Account created' : 'Registration'}</p>
            <button type="button" className="register-create-close" onClick={leaveRegistration} aria-label="Close">
              <X size={16} />
            </button>
          </div>
          <h2 id="register-create-title">
            {savedUser ? `${savedUser.full_name || savedUser.username} is ready` : `Register ${roleLabel}`}
          </h2>
          <span>
            {savedUser
              ? 'Choose whether to enroll a fingerprint now. The user still completes the rest of the profile on first login.'
              : 'Save the identity details only. The temporary password is created from the username and the second part of the ID.'}
          </span>
        </div>

        {savedUser ? (
          <div className="register-create-result">
            <dl>
              <div>
                <dt>Username</dt>
                <dd>{savedUser.username}</dd>
              </div>
              <div>
                <dt>School email</dt>
                <dd>{savedUser.email}</dd>
              </div>
              <div>
                <dt>Temporary password</dt>
                <dd className="register-create-secret">
                  <span>{showPassword ? issuedPassword : '•'.repeat(Math.max(issuedPassword.length, 8))}</span>
                  <button
                    type="button"
                    aria-label={showPassword ? 'Hide temporary password' : 'Show temporary password'}
                    onClick={() => setShowPassword((current) => !current)}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </dd>
              </div>
            </dl>
            <p className={savedUser.credential_email_sent ? 'register-create-status' : 'register-create-status is-warning'}>
              {savedUser.credential_email_sent
                ? `These details were emailed to ${savedUser.email}.`
                : 'The account was saved, but the email could not be sent. Share the username and temporary password with the user.'}
            </p>
            <p className="register-create-note">
              {savedUser.fingerprint_note || 'Fingerprint enrollment is pending.'}
            </p>
            <div className="register-create-actions">
              <button type="button" className="register-create-secondary" onClick={leaveRegistration}>
                Skip for now
              </button>
              <button type="button" className="register-create-primary" onClick={enrollNow}>
                <Fingerprint size={16} />
                Enroll now
              </button>
            </div>
          </div>
        ) : (
          <form className="register-create-form" onSubmit={handleSubmit} noValidate>
            {errorMessage ? <p className="register-create-error">{errorMessage}</p> : null}
            <label className="is-span">
              <span>Role<i>*</i></span>
              <select
                value={form.role}
                aria-invalid={Boolean(fieldError('role'))}
                onBlur={() => setTouched((current) => ({ ...current, role: true }))}
                onChange={(event) => updateField('role', event.target.value)}
              >
                {availableRoles.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                    disabled={option.value === 'super_admin' && superAdminSlotsFull}
                  >
                    {option.label}
                    {option.value === 'super_admin' && superAdminSlotsFull ? ' (limit reached)' : ''}
                  </option>
                ))}
              </select>
              {fieldMessage('role')}
            </label>
            <label>
              <span>{idLabel}<i>*</i></span>
              <input
                inputMode="numeric"
                maxLength={isStudent ? 9 : 13}
                placeholder={isStudent ? 'xxxx-xxxx' : 'xxxxxx-xxxxxx'}
                aria-invalid={Boolean(fieldError('identifier'))}
                value={form.identifier}
                onBlur={() => setTouched((current) => ({ ...current, identifier: true }))}
                onChange={(event) => updateField('identifier', normalizeIssuedId(event.target.value, idKind))}
              />
              {fieldMessage(
                'identifier',
                isStudent
                  ? 'Format xxxx-xxxx.'
                  : 'Format xxxxxx-xxxxxx.',
              )}
            </label>
            <label>
              <span>School email<i>*</i></span>
              <input
                ref={schoolEmailInputRef}
                type="text"
                autoComplete="off"
                placeholder={`name@${schoolEmailDomain}`}
                aria-invalid={Boolean(fieldError('school_email'))}
                value={schoolEmailValue}
                onBlur={() => setTouched((current) => ({ ...current, school_email: true }))}
                onChange={handleSchoolEmailChange}
              />
              {fieldMessage('school_email')}
            </label>
            <label>
              <span>First name<i>*</i></span>
              <input
                placeholder="Enter first name"
                aria-invalid={Boolean(fieldError('first_name'))}
                value={form.first_name}
                onBlur={() => setTouched((current) => ({ ...current, first_name: true }))}
                onChange={(event) => updateField('first_name', toTitleCase(event.target.value))}
              />
              {fieldMessage('first_name')}
            </label>
            <label>
              <span>Last name<i>*</i></span>
              <input
                placeholder="Enter last name"
                aria-invalid={Boolean(fieldError('last_name'))}
                value={form.last_name}
                onBlur={() => setTouched((current) => ({ ...current, last_name: true }))}
                onChange={(event) => updateField('last_name', toTitleCase(event.target.value))}
              />
              {fieldMessage('last_name')}
            </label>
            <label className="is-span">
              <span>Username<i>*</i></span>
              <input
                placeholder="firstname.lastname"
                aria-invalid={Boolean(fieldError('username'))}
                value={form.username}
                onBlur={() => setTouched((current) => ({ ...current, username: true }))}
                onChange={(event) => updateField('username', event.target.value.replace(/\s/g, ''))}
              />
              {fieldMessage('username', isStudent ? 'Use firstname.lastname.' : '')}
            </label>
            <label className="is-span">
              <span>Temporary password</span>
              <span className="register-create-secret">
                <input readOnly type={showPassword ? 'text' : 'password'} value={generatedPassword} placeholder={isStudent ? 'Username@0471' : 'Username@004712'} />
                <button
                  type="button"
                  aria-label={showPassword ? 'Hide temporary password' : 'Show temporary password'}
                  onClick={() => setShowPassword((current) => !current)}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
              {fieldMessage('password', passwordExample)}
            </label>
            <p className="register-create-note">
              <KeyRound size={15} />
              On first login the user verifies an email code, replaces this password, completes the remaining details, and sets security questions before the dashboard opens.
            </p>
            <div className="register-create-actions">
              <button type="button" className="register-create-secondary" onClick={leaveRegistration} disabled={isSaving}>
                Cancel
              </button>
              <button type="submit" className="register-create-primary" disabled={isSaving}>
                {isSaving ? 'Creating...' : 'Create account'}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
