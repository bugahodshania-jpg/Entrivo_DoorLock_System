import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff, Fingerprint, KeyRound, X } from 'lucide-react';
import axiosClient from '../../api/axiosClient';
import { useActionConfirm } from '../../components/ActionConfirm';
import ErrorNoticeModal from '../../components/ErrorNoticeModal';
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

const adminBlockedRoles = new Set(['admin', 'faculty', 'staff', 'super_admin']);

function normalizeInitialRole(role) {
  const normalizedRole = (role || '').toLowerCase();

  if (normalizedRole === 'admins') return 'admin';
  if (normalizedRole === 'students') return 'student';
  if (normalizedRole === 'superadmin') return 'super_admin';

  return roleOptions.some((option) => option.value === normalizedRole) ? normalizedRole : 'faculty';
}

function personNameError(value, label) {
  const name = value.trim();

  if (!name) return `${label} is required.`;
  if (name.length < 2 || name.length > 50) return `${label} must be 2 to 50 characters.`;
  if (/\p{N}/u.test(name)) return `${label} cannot contain numbers.`;
  if (/[^A-Za-zÑñ -]/.test(name)) return `${label} can only include letters, Ñ, spaces, and hyphens.`;
  if (!/^[A-ZÑ]/.test(name)) return `${label} must start with a capital letter.`;
  if (!/^[A-ZÑ][A-Za-zÑñ]*(?:[ -][A-Za-zÑñ]+)*$/.test(name)) {
    return `${label} cannot start or end with a hyphen, or repeat spaces and hyphens.`;
  }

  return '';
}

function usernameError(value) {
  const username = value.trim();

  if (!username) return 'Username is required.';
  if (username !== username.toLowerCase()) return 'Username must be all lowercase.';
  if (/\p{N}/u.test(username)) return 'Username cannot contain numbers.';
  if (!/^[a-z.]+$/.test(username)) return 'Username can only use lowercase letters and a dot.';
  if (!username.includes('.')) return 'Username must include a dot (.).';
  if (!/^[a-z]+(?:\.[a-z]+)+$/.test(username) || username.length > 50) {
    return 'Use lowercase letters separated by a dot, such as firstname.lastname.';
  }

  return '';
}

function readDraft(role) {
  const fallback = {
    role,
    identifier: '',
    school_email: '',
    first_name: '',
    last_name: '',
    username: '',
    rfid_uid: '',
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

export default function RegisterUser({ user: currentUser, initialRole: selectedRole, onClose } = {}) {
  const confirmAction = useActionConfirm();
  const params = new URLSearchParams(window.location.search);
  const isLimitedAdmin = currentUser?.role === 'admin';
  const requestedRole = normalizeInitialRole(selectedRole ?? params.get('role'));
  const initialRole = isLimitedAdmin && adminBlockedRoles.has(requestedRole) ? 'student' : requestedRole;
  const availableRoles = isLimitedAdmin
    ? roleOptions.filter((option) => !adminBlockedRoles.has(option.value))
    : roleOptions;
  const [form, setForm] = useState(() => {
    const draft = readDraft(initialRole);
    const draftRole = selectedRole != null
      ? initialRole
      : isLimitedAdmin && adminBlockedRoles.has(draft.role) ? 'student' : draft.role;

    return {
      ...draft,
      role: draftRole,
      username: String(draft.username || '').replace(/\s/g, '').toLowerCase(),
      rfid_uid: String(draft.rfid_uid || '').replace(/\s/g, '').toUpperCase().slice(0, 30),
    };
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [touched, setTouched] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [superAdminSlotsFull, setSuperAdminSlotsFull] = useState(false);
  const [savedUser, setSavedUser] = useState(null);
  const [identifierAvailability, setIdentifierAvailability] = useState({ value: '', role: '', message: '' });
  const [emailAvailability, setEmailAvailability] = useState({ value: '', message: '' });
  const [usernameAvailability, setUsernameAvailability] = useState({ value: '', message: '' });
  const [rfidIdentify, setRfidIdentify] = useState({ uid: '', ok: false, message: '' });
  const [isIdentifyingRfid, setIsIdentifyingRfid] = useState(false);
  const schoolEmailInputRef = useRef(null);
  const schoolEmailCursorRef = useRef(null);
  const identifierRequestRef = useRef(0);
  const identifierTimerRef = useRef(0);
  const emailRequestRef = useRef(0);
  const emailTimerRef = useRef(0);
  const checkingOnSubmitRef = useRef(false);

  const isStudent = form.role === 'student';
  const idKind = isStudent ? 'student' : 'employee';
  const idFormat = isStudent ? 'xxxx-xxxx' : 'xxxxxx-xxxxxx';
  const idLabel = isStudent ? 'School ID' : 'Employee ID';
  const generatedPassword = temporaryPassword(form.username, form.identifier);
  const composedEmail = composeSchoolEmail(form.school_email);
  const schoolEmailValue = form.school_email ? `${form.school_email}@${schoolEmailDomain}` : '';
  const roleLabel = formatRole(form.role);
  const passwordPattern = isStudent ? 'firstname.lastname@xxxx' : 'firstname.lastname@xxxxxx';
  const passwordExample = isStudent
    ? 'Example: firstname.lastname@xxxx uses the last 4 digits of the School ID.'
    : 'Example: firstname.lastname@xxxxxx uses the last 6 digits of the Employee ID.';

  const errors = useMemo(() => {
    const next = {};
    if (!form.role) next.role = 'Role is required.';
    if (form.role === 'super_admin' && superAdminSlotsFull) {
      next.role = 'The super admin limit has been reached.';
    }
    if (!form.identifier.trim()) next.identifier = `${idLabel} is required.`;
    else if (!(isStudent ? /^\d{4}-\d{4}$/ : /^\d{6}-\d{6}$/).test(form.identifier)) {
      next.identifier = `${idLabel} must use ${idFormat} format.`;
    } else if (
      identifierAvailability.value === form.identifier
      && identifierAvailability.role === (isStudent ? 'student' : 'employee')
      && identifierAvailability.message
    ) {
      next.identifier = identifierAvailability.message;
    }
    if (!form.school_email.trim()) next.school_email = 'School email is required.';
    else if (!composedEmail) {
      next.school_email = 'Use 3 to 50 characters, starting with a letter. Letters, numbers, dots, underscores, and hyphens only.';
    } else if (emailAvailability.value === composedEmail && emailAvailability.message) {
      next.school_email = emailAvailability.message;
    }
    const firstNameError = personNameError(form.first_name, 'First name');
    const lastNameError = personNameError(form.last_name, 'Last name');
    if (firstNameError) next.first_name = firstNameError;
    if (lastNameError) next.last_name = lastNameError;
    const nextUsernameError = usernameError(form.username);
    if (nextUsernameError) next.username = nextUsernameError;
    else if (
      usernameAvailability.value === form.username.trim().toLowerCase()
      && usernameAvailability.message
    ) {
      next.username = usernameAvailability.message;
    }
    if (form.username.trim() && form.identifier && !generatedPassword) {
      next.password = 'Enter a valid username and ID to generate the temporary password.';
    }
    if (isStudent) {
      const rfidUid = form.rfid_uid.trim();
      if (!rfidUid) next.rfid_uid = 'RFID UID is required.';
      else if (!/^[A-Z0-9]{1,30}$/.test(rfidUid)) next.rfid_uid = 'The UID must match the scanner exactly.';
      else if (isIdentifyingRfid) {
        // Keep the field clear until Identify finishes.
      } else if (rfidIdentify.uid === rfidUid && rfidIdentify.message && !rfidIdentify.ok) next.rfid_uid = rfidIdentify.message;
      else if (!(rfidIdentify.ok && rfidIdentify.uid === rfidUid)) {
        next.rfid_uid = 'Identify this UID against the scanned school ID before creating the account.';
      }
    }
    return next;
  }, [composedEmail, emailAvailability, form, generatedPassword, idFormat, idLabel, identifierAvailability, isIdentifyingRfid, isStudent, rfidIdentify, superAdminSlotsFull, usernameAvailability]);

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
    const message = errors[field] || '';
    if (!message) return '';
    if (submitted || touched[field]) return message;
    if (
      field === 'identifier'
      && identifierAvailability.message
      && identifierAvailability.value === form.identifier
      && identifierAvailability.role === (isStudent ? 'student' : 'employee')
    ) {
      return message;
    }
    if (
      field === 'school_email'
      && emailAvailability.message
      && emailAvailability.value === composedEmail
    ) {
      return message;
    }
    if (
      field === 'rfid_uid'
      && !rfidIdentify.ok
      && rfidIdentify.message
      && rfidIdentify.uid === form.rfid_uid
    ) {
      return message;
    }
    return '';
  }

  const checkIdentifierAvailability = useCallback(async (identifier, student) => {
    const requestId = identifierRequestRef.current + 1;
    identifierRequestRef.current = requestId;
    const formatOk = (student ? /^\d{4}-\d{4}$/ : /^\d{6}-\d{6}$/).test(identifier);
    const roleKey = student ? 'student' : 'employee';

    if (!formatOk) {
      setIdentifierAvailability((current) => (
        current.message ? { value: identifier, role: roleKey, message: '' } : current
      ));
      return true;
    }

    const field = student ? 'school_id' : 'employee_id';

    try {
      const response = await axiosClient.post('/api/registration_availability.php', {
        [field]: identifier,
      });
      if (requestId !== identifierRequestRef.current) return false;

      const message = response.data?.errors?.[field] || '';
      setIdentifierAvailability({ value: identifier, role: roleKey, message });
      return !message;
    } catch {
      if (requestId !== identifierRequestRef.current) return false;
      return null;
    }
  }, []);

  const checkEmailAvailability = useCallback(async (email) => {
    const requestId = emailRequestRef.current + 1;
    emailRequestRef.current = requestId;

    if (!email) {
      setEmailAvailability((current) => (current.message ? { value: '', message: '' } : current));
      return true;
    }

    try {
      const response = await axiosClient.post('/api/registration_availability.php', { email });
      if (requestId !== emailRequestRef.current) return false;

      const message = response.data?.errors?.email || '';
      setEmailAvailability({ value: email, message });
      return !message;
    } catch {
      if (requestId !== emailRequestRef.current) return false;
      return null;
    }
  }, []);

  function fieldMessage(field, hint = '') {
    const error = fieldError(field);

    if (error) {
      return <small className="register-create-field-error">{error}</small>;
    }

    if (field === 'rfid_uid' && rfidIdentify.ok && rfidIdentify.uid === form.rfid_uid) {
      return <small className="register-create-field-ok">{rfidIdentify.message}</small>;
    }

    return hint ? <small>{hint}</small> : null;
  }

  function updateRfidUid(value) {
    const uid = value.replace(/\s/g, '').toUpperCase().slice(0, 30);
    setForm((current) => ({ ...current, rfid_uid: uid }));
    setRfidIdentify((current) => (current.uid === uid ? current : { uid: '', ok: false, message: '' }));
  }

  async function identifyRfidUid() {
    const uid = form.rfid_uid.replace(/\s/g, '').toUpperCase();
    setTouched((current) => ({ ...current, rfid_uid: true }));
    setErrorMessage('');

    if (!uid || !/^[A-Z0-9]{1,30}$/.test(uid)) {
      setRfidIdentify({
        uid,
        ok: false,
        message: uid ? 'The UID must match the scanner exactly.' : '',
      });
      return;
    }

    setIsIdentifyingRfid(true);

    try {
      const response = await axiosClient.post('/api/verify_rfid_uid.php', { rfid_uid: uid });
      const verifiedUid = String(response.data?.rfid_uid || uid).replace(/\s/g, '').toUpperCase();
      setForm((current) => ({ ...current, rfid_uid: verifiedUid }));
      setRfidIdentify({
        uid: verifiedUid,
        ok: true,
        message: 'This UID matches a scanned school ID.',
      });
    } catch (error) {
      setRfidIdentify({
        uid,
        ok: false,
        message: error.response?.data?.message || 'Unable to verify the RFID UID right now.',
      });
    } finally {
      setIsIdentifyingRfid(false);
    }
  }

  function leaveRegistration() {
    window.sessionStorage.removeItem(registrationDraftKey);
    if (onClose) {
      onClose(Boolean(savedUser));
      return;
    }
    window.location.assign(portalHref('/super-admin/manage-users'));
  }

  function enrollNow() {
    const userId = savedUser?.user_id || savedUser?.id;
    const fingerprintId = savedUser?.fingerprint?.fingerprint_id;
    const nextParams = new URLSearchParams();
    if (userId) nextParams.set('enroll_user_id', String(userId));
    if (fingerprintId) nextParams.set('fingerprint_id', String(fingerprintId));
    window.sessionStorage.removeItem(registrationDraftKey);
    window.location.assign(portalHref(`/super-admin/fingerprint-direct?${nextParams.toString()}`));
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
    if (savedUser) return undefined;

    const identifier = form.identifier;
    const student = form.role === 'student';
    identifierTimerRef.current = window.setTimeout(() => {
      if (checkingOnSubmitRef.current) return;
      void checkIdentifierAvailability(identifier, student);
    }, 300);

    return () => window.clearTimeout(identifierTimerRef.current);
  }, [checkIdentifierAvailability, form.identifier, form.role, savedUser]);

  useEffect(() => {
    if (savedUser) return undefined;

    const email = composedEmail;
    emailTimerRef.current = window.setTimeout(() => {
      if (checkingOnSubmitRef.current) return;
      void checkEmailAvailability(email);
    }, 300);

    return () => window.clearTimeout(emailTimerRef.current);
  }, [checkEmailAvailability, composedEmail, savedUser]);

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
      setErrorMessage('Admin accounts cannot create admin, faculty, staff, or super admin users.');
      return;
    }

    if (Object.keys(errors).length > 0) {
      setErrorMessage('Please correct the highlighted fields before creating the account.');
      return;
    }

    window.clearTimeout(identifierTimerRef.current);
    window.clearTimeout(emailTimerRef.current);
    checkingOnSubmitRef.current = true;
    let identifierIsUnique;
    let emailIsUnique;
    try {
      [identifierIsUnique, emailIsUnique] = await Promise.all([
        checkIdentifierAvailability(form.identifier, isStudent),
        checkEmailAvailability(composedEmail),
      ]);
    } finally {
      checkingOnSubmitRef.current = false;
    }
    if (identifierIsUnique === false || emailIsUnique === false) {
      setTouched((current) => ({
        ...current,
        identifier: identifierIsUnique === false || current.identifier,
        school_email: emailIsUnique === false || current.school_email,
      }));
      setErrorMessage('Please correct the highlighted fields before creating the account.');
      return;
    }
    if (identifierIsUnique === null) {
      setErrorMessage(`Unable to check whether this ${idLabel.toLowerCase()} is already in use. Please try again.`);
      return;
    }
    if (emailIsUnique === null) {
      setErrorMessage('Unable to check whether this school email is already in use. Please try again.');
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
          ? { school_id: form.identifier, rfid_uid: form.rfid_uid }
          : { employee_id: form.identifier }),
        actor_id: actorId,
      });

      window.sessionStorage.removeItem(registrationDraftKey);
      setShowPassword(false);
      setSavedUser(response.data.user);
    } catch (error) {
      const duplicateErrors = error.response?.data?.errors || {};
      const duplicateMessage = duplicateErrors.employee_id || duplicateErrors.school_id || '';
      if (duplicateMessage) {
        setIdentifierAvailability({
          value: form.identifier,
          role: isStudent ? 'student' : 'employee',
          message: duplicateMessage,
        });
        setTouched((current) => ({ ...current, identifier: true }));
      }
      if (duplicateErrors.email) {
        setEmailAvailability({ value: composedEmail, message: duplicateErrors.email });
        setTouched((current) => ({ ...current, school_email: true }));
      }
      if (duplicateErrors.username) {
        setUsernameAvailability({
          value: form.username.trim().toLowerCase(),
          message: duplicateErrors.username,
        });
        setTouched((current) => ({ ...current, username: true }));
      }
      const saveMessage = error.response?.data?.message || 'Unable to save this user. Please check the required details.';
      if (duplicateErrors.rfid_uid || (isStudent && /uid/i.test(saveMessage))) {
        setRfidIdentify({
          uid: form.rfid_uid,
          ok: false,
          message: duplicateErrors.rfid_uid || saveMessage,
        });
        setTouched((current) => ({ ...current, rfid_uid: true }));
      }
      setErrorMessage(saveMessage);
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
              : `Save the identity details only. The temporary password is ${passwordPattern}, using the last ${isStudent ? '4 digits of the School ID' : '6 digits of the Employee ID'}.`}
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
              {savedUser.rfid?.rfid_uid ? (
                <div>
                  <dt>RFID UID</dt>
                  <dd>{savedUser.rfid.rfid_uid}</dd>
                </div>
              ) : null}
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
            {isStudent ? (
              <label className="is-span">
                <span>RFID UID<i>*</i></span>
                <span className="register-create-rfid">
                  <input
                    autoComplete="off"
                    maxLength={30}
                    placeholder="Enter scanned UID"
                    aria-invalid={Boolean(fieldError('rfid_uid'))}
                    value={form.rfid_uid}
                    onBlur={() => setTouched((current) => ({ ...current, rfid_uid: true }))}
                    onChange={(event) => updateRfidUid(event.target.value)}
                  />
                  <button
                    type="button"
                    className={`register-create-identify${isIdentifyingRfid ? ' is-busy' : ''}${rfidIdentify.ok && rfidIdentify.uid === form.rfid_uid ? ' is-matched' : ''}`}
                    disabled={isIdentifyingRfid || (rfidIdentify.ok && rfidIdentify.uid === form.rfid_uid)}
                    onClick={identifyRfidUid}
                  >
                    {isIdentifyingRfid ? 'Identifying...' : rfidIdentify.ok && rfidIdentify.uid === form.rfid_uid ? 'Identified' : 'Identify'}
                  </button>
                </span>
                {fieldMessage('rfid_uid', 'Scan the school ID, then identify the UID shown on the scanner.')}
              </label>
            ) : null}
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
                onChange={(event) => updateField('first_name', event.target.value)}
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
                onChange={(event) => updateField('last_name', event.target.value)}
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
                onChange={(event) => updateField('username', event.target.value.replace(/\s/g, '').toLowerCase())}
              />
              {fieldMessage('username')}
            </label>
            <label className="is-span">
              <span>Temporary password</span>
              <span className="register-create-secret">
                <input readOnly type={showPassword ? 'text' : 'password'} value={generatedPassword} placeholder={passwordPattern} />
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
              <button type="submit" className="register-create-primary" disabled={isSaving || isIdentifyingRfid}>
                {isSaving ? 'Creating...' : 'Create account'}
              </button>
            </div>
          </form>
        )}
      </section>
      <ErrorNoticeModal
        open={Boolean(errorMessage)}
        message={errorMessage}
        onClose={() => setErrorMessage('')}
      />
    </div>
  );
}
