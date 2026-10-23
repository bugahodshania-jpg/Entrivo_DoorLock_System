import { useEffect, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff, X } from 'lucide-react';
import { getManilaDateStamp } from '../../utils/dateTime';
import {
  calculateAge,
  normalizeContactNumber,
  toTitleCase,
  validatePersonalInformation,
} from '../../utils/registrationValidation';
import {
  departmentOptions,
  programsForCollege,
  sectionOptions,
  securityQuestionOptions,
  suffixOptions,
  yearLevelOptions,
} from '../../utils/schoolProfileOptions';

const AUTH_API_URL = 'http://127.0.0.1:8000/api/auth.php';
const setupSteps = ['otp', 'password', 'profile', 'security'];
const CONTACT_EXISTS_MESSAGE = 'Contact number already exists. Use a different contact number.';

const emptyProfile = {
  middle_name: '',
  extension_name: '',
  sex: '',
  contact_number: '',
  date_of_birth: '',
  age: '',
  street_address: '',
  barangay: '',
  city_municipality: '',
  province: '',
  college: '',
  program_department: '',
  year_level: '',
  section: '',
  office_department: '',
  work_position: '',
  rfid_uid: '',
};

export default function FirstLoginSetup({
  challengeId,
  maskedEmail,
  expiresIn,
  initialStep = 'otp',
  setup = null,
  onClose,
  onComplete,
}) {
  const [step, setStep] = useState(setupSteps.includes(initialStep) ? initialStep : 'otp');
  const [activeChallengeId, setActiveChallengeId] = useState(challengeId);
  const [accountSetup, setAccountSetup] = useState(setup);
  const [otp, setOtp] = useState('');
  const [expiresAt, setExpiresAt] = useState(Date.now() + (Number(expiresIn) || 600) * 1000);
  const [remaining, setRemaining] = useState(Number(expiresIn) || 600);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [profile, setProfile] = useState(emptyProfile);
  const [questions, setQuestions] = useState([
    { question: '', answer: '' },
    { question: '', answer: '' },
    { question: '', answer: '' },
  ]);
  const [showAnswers, setShowAnswers] = useState([false, false, false]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [touchedFields, setTouchedFields] = useState({});
  const [serverErrors, setServerErrors] = useState({});
  const [contactAvailability, setContactAvailability] = useState(null);
  const [serverContactError, setServerContactError] = useState(null);
  const contactRequestRef = useRef({ id: 0, controller: null });
  const otpRefs = useRef([]);
  const isStudent = (accountSetup?.role || '') === 'student';
  const programOptions = useMemo(
    () => programsForCollege(profile.college),
    [profile.college],
  );

  useEffect(() => {
    const existing = String(accountSetup?.middle_name || '').trim();
    if (!existing) return;
    setProfile((current) => (current.middle_name ? current : { ...current, middle_name: existing }));
  }, [accountSetup]);

  useEffect(() => {
    if (step !== 'otp') {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setRemaining(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [expiresAt, step]);

  function cancelContactCheck() {
    contactRequestRef.current.id += 1;
    contactRequestRef.current.controller?.abort();
    contactRequestRef.current.controller = null;
  }

  useEffect(() => {
    cancelContactCheck();
    const value = profile.contact_number;
    if (step !== 'profile' || busy || !activeChallengeId || !/^09[0-9]{9}$/.test(value)) {
      return undefined;
    }

    const controller = new AbortController();
    const requestId = contactRequestRef.current.id;
    contactRequestRef.current.controller = controller;
    const timer = window.setTimeout(async () => {
      if (controller.signal.aborted || contactRequestRef.current.id !== requestId) return;
      try {
        const response = await fetch(AUTH_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            action: 'first_login_contact_availability',
            challenge_id: activeChallengeId,
            contact_number: value,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (controller.signal.aborted || contactRequestRef.current.id !== requestId) return;
        if (!response.ok || typeof data.available !== 'boolean') return;
        setContactAvailability({
          value,
          challengeId: activeChallengeId,
          message: data.available ? '' : data.errors?.contact_number || CONTACT_EXISTS_MESSAGE,
        });
      } catch {
        // Saving checks availability again and reports any service failure.
      }
    }, 400);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
      if (contactRequestRef.current.id === requestId) cancelContactCheck();
    };
  }, [activeChallengeId, busy, profile.contact_number, step]);

  async function submit(payload, onSuccess) {
    if (payload.action === 'first_login_profile') cancelContactCheck();
    setBusy(true);
    setError('');
    setNotice('');

    try {
      const response = await fetch(AUTH_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (data.errors && typeof data.errors === 'object' && Object.keys(data.errors).length) {
          const nextErrors = { ...data.errors };
          if (payload.action === 'first_login_profile' && nextErrors.contact_number) {
            setServerContactError({
              value: payload.contact_number,
              challengeId: payload.challenge_id,
              message: nextErrors.contact_number,
            });
            delete nextErrors.contact_number;
          }
          setServerErrors(nextErrors);
          markFieldsTouched(Object.keys(data.errors));
        } else {
          setError(data.message || 'Something went wrong. Try again.');
        }
        return;
      }

      setServerErrors({});
      if (payload.action === 'first_login_profile') setServerContactError(null);
      onSuccess(data);
    } catch {
      setError('The login service could not be reached.');
    } finally {
      setBusy(false);
    }
  }

  function continueAfterPassword(data) {
    if (data.user) {
      onComplete(data.user);
      return;
    }

    if (data.next_step === 'profile') {
      setAccountSetup(data.setup || accountSetup);
      setStep('profile');
      return;
    }

    if (data.next_step === 'security') {
      setStep('security');
      return;
    }

    setError(data.message || 'The account could not be opened.');
  }

  function updateProfile(field, value) {
    if (field === 'contact_number' && value !== profile.contact_number) {
      cancelContactCheck();
      setContactAvailability(null);
      setServerContactError(null);
    }
    setProfile((current) => ({
      ...current,
      [field]: value,
      ...(field === 'date_of_birth' ? { age: calculateAge(value) } : {}),
    }));
    touchField(field);
    if (field === 'date_of_birth') touchField('age');
  }

  function markFieldsTouched(fields) {
    setTouchedFields((current) => ({
      ...current,
      ...Object.fromEntries(fields.map((field) => [field, true])),
    }));
  }

  function touchField(field) {
    markFieldsTouched([field]);
    setServerErrors((current) => ({ ...current, [field]: '' }));
    setError('');
  }

  function updateQuestion(index, field, value) {
    setQuestions((current) => current.map((entry, entryIndex) => (
      entryIndex === index ? { ...entry, [field]: value } : entry
    )));
    touchField(`security_${field}_${index + 1}`);
  }

  function profilePayload() {
    return {
      action: 'first_login_profile',
      challenge_id: activeChallengeId,
      middle_name: profile.middle_name,
      extension_name: profile.extension_name,
      sex: profile.sex,
      contact_number: profile.contact_number,
      date_of_birth: profile.date_of_birth,
      street_address: profile.street_address,
      barangay: profile.barangay,
      city_municipality: profile.city_municipality,
      province: profile.province,
      ...(isStudent
        ? {
            college: profile.college,
            program_department: profile.program_department,
            year_level: profile.year_level,
            section: profile.section,
            rfid_uid: profile.rfid_uid,
          }
        : {
            office_department: profile.office_department,
            work_position: profile.work_position,
          }),
    };
  }

  function validateProfile() {
    const errors = validatePersonalInformation(profile, {
      requireStreet: false,
      includeCountry: false,
      includeZip: false,
      includeNames: false,
    });
    if (isStudent) {
      if (!profile.college) errors.college = 'College is required.';
      if (!profile.program_department) errors.program_department = 'Program / Department is required.';
      if (!profile.year_level) errors.year_level = 'Year level is required.';
    } else {
      if (!profile.office_department.trim()) errors.office_department = 'Department / Office is required.';
      if (!profile.work_position.trim()) errors.work_position = 'Position is required.';
    }
    return errors;
  }

  function validatePassword() {
    const errors = {};
    if (!password) errors.password = 'Password is required.';
    else if (new TextEncoder().encode(password).length > 72) errors.password = 'Password is too long. Use a shorter password.';
    else if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(password)) {
      errors.password = 'Use at least 8 characters with uppercase and lowercase letters, a number, and a special character.';
    }
    if (!confirmPassword) errors.confirm_password = 'Confirm your password.';
    else if (password !== confirmPassword) errors.confirm_password = 'Password confirmation does not match.';
    return errors;
  }

  function validateQuestions() {
    const errors = {};
    questions.forEach((item, index) => {
      if (!item.question) errors[`security_question_${index + 1}`] = 'Select a security question.';
      else if (questions.some((entry, entryIndex) => entryIndex !== index && entry.question === item.question)) {
        errors[`security_question_${index + 1}`] = 'Choose a different security question.';
      }
      const answer = item.answer.trim();
      if (answer.length < 2) errors[`security_answer_${index + 1}`] = 'Enter an answer with at least 2 characters.';
      else if (new TextEncoder().encode(answer).length > 100) errors[`security_answer_${index + 1}`] = 'Answer is too long. Use a shorter answer.';
    });
    return errors;
  }

  const contactErrorForValue = (result) => (
    result?.value === profile.contact_number && result?.challengeId === activeChallengeId
      ? result.message
      : ''
  );
  const contactNumberError = contactErrorForValue(serverContactError) || contactErrorForValue(contactAvailability);
  const fieldErrors = {
    ...(step === 'profile' && contactNumberError ? { contact_number: contactNumberError } : {}),
    ...Object.fromEntries(Object.entries(serverErrors).filter(([, message]) => message)),
    ...(step === 'profile' ? validateProfile() : step === 'password' ? validatePassword() : step === 'security' ? validateQuestions() : {}),
  };

  function getFieldError(field) {
    return touchedFields[field] ? fieldErrors[field] || '' : '';
  }

  function fieldAttributes(field) {
    return {
      'aria-invalid': Boolean(getFieldError(field)),
      'aria-describedby': `first-login-${field}-error`,
      onBlur: () => markFieldsTouched([field]),
    };
  }

  function FieldError({ field }) {
    const message = getFieldError(field);
    return (
      <small
        id={`first-login-${field}-error`}
        className="password-reset-field-error"
        style={{ display: 'block', minHeight: '16px' }}
        aria-live="polite"
      >
        {message || ' '}
      </small>
    );
  }

  const stepIndex = Math.max(0, setupSteps.indexOf(step));
  const titles = {
    otp: 'OTP Verification',
    password: 'Set a new password',
    profile: 'Complete your information',
    security: 'Security questions',
  };
  const descriptions = {
    otp: `Enter the 6-digit code sent to ${maskedEmail}. Your dashboard stays closed until this setup is finished.`,
    password: 'This replaces the temporary password. You will use the new password the next time you sign in.',
    profile: 'These details were not collected when the account was created. Save them before the dashboard opens.',
    security: 'Choose three questions. They are used if you need to reset your password later.',
  };

  return (
    <div className="password-reset-backdrop" role="presentation">
      <section
        className={`password-reset-modal${step === 'profile' || step === 'security' ? ' is-wide' : ''}${step === 'profile' ? ' is-profile' : ''}${step === 'security' ? ' is-security' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="first-login-title"
        style={{ overflowY: 'auto' }}
      >
        <div className="password-reset-heading">
          <div className="password-reset-step-row">
            <p className="password-reset-step">Step {stepIndex + 1} of 4</p>
            <button type="button" className="password-reset-close" onClick={() => { cancelContactCheck(); onClose(); }} aria-label="Close">
              <X size={16} />
            </button>
          </div>
          <div className="password-reset-track" aria-hidden="true">
            {setupSteps.map((item, index) => (
              <span key={item} className={index <= stepIndex ? 'is-active' : undefined} />
            ))}
          </div>
          <h2 id="first-login-title">{titles[step]}</h2>
          <p>{descriptions[step]}</p>
        </div>

        {step === 'otp' ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit(
                { action: 'first_login_verify', challenge_id: activeChallengeId, otp: otp.trim() },
                () => setStep('password'),
              );
            }}
          >
            <div className="password-reset-otp-field">
              <span>One-time code</span>
              <div className="password-reset-otp">
                {Array.from({ length: 6 }, (_, index) => (
                  <input
                    key={index}
                    ref={(node) => {
                      otpRefs.current[index] = node;
                    }}
                    value={otp[index] || ''}
                    inputMode="numeric"
                    autoComplete={index === 0 ? 'one-time-code' : 'off'}
                    aria-label={`Digit ${index + 1}`}
                    maxLength={1}
                    autoFocus={index === 0}
                    onChange={(event) => {
                      const digits = event.target.value.replace(/\D/g, '');
                      if (digits.length > 1) {
                        const pasted = (otp.slice(0, index) + digits).replace(/\D/g, '').slice(0, 6);
                        setOtp(pasted);
                        otpRefs.current[Math.min(pasted.length, 5)]?.focus();
                        return;
                      }
                      const filled = Array.from({ length: 6 }, (unused, digitIndex) => (
                        digitIndex === index ? digits : otp[digitIndex] || ''
                      )).join('');
                      setOtp(filled);
                      if (digits && index < 5) {
                        otpRefs.current[index + 1]?.focus();
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Backspace' && !otp[index] && index > 0) {
                        otpRefs.current[index - 1]?.focus();
                      }
                    }}
                    onPaste={(event) => {
                      const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
                      if (!pasted) return;
                      event.preventDefault();
                      setOtp(pasted);
                      otpRefs.current[Math.min(pasted.length, 5)]?.focus();
                    }}
                  />
                ))}
              </div>
            </div>
            <p className={`password-reset-countdown${remaining === 0 ? ' is-expired' : ''}`}>
              {remaining === 0
                ? 'This code has expired.'
                : `Code expires in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`}
            </p>
            {error ? <p className="password-reset-error">{error}</p> : null}
            {notice ? <p className="password-reset-notice">{notice}</p> : null}
            <p className="password-reset-resend">
              Didn&apos;t receive the code?{' '}
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  submit({ action: 'first_login_resend', challenge_id: activeChallengeId }, (data) => {
                    setActiveChallengeId(data.challenge_id);
                    setOtp('');
                    const nextExpires = Number(data.expires_in) || 600;
                    setExpiresAt(Date.now() + nextExpires * 1000);
                    setRemaining(nextExpires);
                    setNotice('A new code was sent.');
                  });
                }}
              >
                Resend
              </button>
            </p>
            <button type="submit" disabled={busy || otp.trim().length !== 6 || remaining === 0}>
              {busy ? 'Checking...' : 'Verify code'}
            </button>
          </form>
        ) : null}

        {step === 'password' ? (
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              const errors = validatePassword();
              markFieldsTouched(['password', 'confirm_password']);
              setError('');
              if (Object.keys(errors).length) return;
              submit(
                {
                  action: 'first_login_password',
                  challenge_id: activeChallengeId,
                  password,
                  confirm_password: confirmPassword,
                },
                continueAfterPassword,
              );
            }}
          >
            <p className="password-reset-hint">
              Use at least 8 characters, with an uppercase letter, a lowercase letter, a number, and a special character.
            </p>
            <label>
              New password
              <span className="password-reset-secret">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    touchField('password');
                    setServerErrors((current) => ({ ...current, confirm_password: '' }));
                  }}
                  {...fieldAttributes('password')}
                  autoComplete="new-password"
                  autoFocus
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
              <FieldError field="password" />
            </label>
            <label>
              Confirm password
              <span className="password-reset-secret">
                <input
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(event) => {
                    setConfirmPassword(event.target.value);
                    touchField('confirm_password');
                  }}
                  {...fieldAttributes('confirm_password')}
                  autoComplete="new-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((current) => !current)}
                  aria-label={showConfirm ? 'Hide password' : 'Show password'}
                >
                  {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
              <FieldError field="confirm_password" />
            </label>
            {error ? <p className="password-reset-error">{error}</p> : null}
            <button type="submit" disabled={busy}>
              {busy ? 'Saving...' : 'Save password and continue'}
            </button>
          </form>
        ) : null}

        {step === 'profile' ? (
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              const errors = validateProfile();
              if (!errors.contact_number && contactNumberError) errors.contact_number = contactNumberError;
              markFieldsTouched(Object.keys(errors));
              setError('');
              if (Object.keys(errors).length) return;
              submit(profilePayload(), (data) => {
                if (data.next_step === 'security') {
                  setStep('security');
                  return;
                }
                setError(data.message || 'The information could not be saved.');
              });
            }}
          >
            {accountSetup ? (
              <dl className="password-reset-summary">
                <div>
                  <dt>Name</dt>
                  <dd>{[accountSetup.first_name, accountSetup.middle_name, accountSetup.last_name].filter(Boolean).join(' ')}</dd>
                </div>
                <div>
                  <dt>{accountSetup.identifier_label || 'ID'}</dt>
                  <dd>{accountSetup.identifier || 'Not available'}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{accountSetup.email || maskedEmail}</dd>
                </div>
                <div>
                  <dt>Role</dt>
                  <dd>{String(accountSetup.role || '').replace(/_/g, ' ') || 'User'}</dd>
                </div>
              </dl>
            ) : null}
            <div className="password-reset-grid">
              <label>
                Middle name
                <input
                  placeholder="Optional"
                  value={profile.middle_name}
                  onChange={(event) => updateProfile('middle_name', toTitleCase(event.target.value))}
                  {...fieldAttributes('middle_name')}
                />
                <FieldError field="middle_name" />
              </label>
              <label>
                Suffix
                <select value={profile.extension_name} onChange={(event) => updateProfile('extension_name', event.target.value)} {...fieldAttributes('extension_name')}>
                  {suffixOptions.map((suffix) => (
                    <option key={suffix || 'none'} value={suffix}>{suffix || 'None'}</option>
                  ))}
                </select>
                <FieldError field="extension_name" />
              </label>
              <label>
                Sex
                <select value={profile.sex} onChange={(event) => updateProfile('sex', event.target.value)} {...fieldAttributes('sex')} required>
                  <option value="">Select sex</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
                <FieldError field="sex" />
              </label>
              <label>
                Contact number
                <input
                  inputMode="numeric"
                  maxLength={11}
                  placeholder="09*********"
                  value={profile.contact_number}
                  onChange={(event) => updateProfile('contact_number', normalizeContactNumber(event.target.value))}
                  {...fieldAttributes('contact_number')}
                  required
                />
                <FieldError field="contact_number" />
              </label>
              <label>
                Birthdate
                <input
                  type="date"
                  max={getManilaDateStamp()}
                  value={profile.date_of_birth}
                  onChange={(event) => updateProfile('date_of_birth', event.target.value)}
                  {...fieldAttributes('date_of_birth')}
                  required
                />
                <FieldError field="date_of_birth" />
              </label>
              <label>
                Age
                <input readOnly value={profile.age} placeholder="Calculated from birthdate" {...fieldAttributes('age')} />
                <FieldError field="age" />
              </label>
              <hr className="password-reset-divider is-span" />
              <label>
                Street address
                <input
                  placeholder="Optional"
                  value={profile.street_address}
                  onChange={(event) => updateProfile('street_address', event.target.value)}
                  {...fieldAttributes('street_address')}
                />
                <FieldError field="street_address" />
              </label>
              <label>
                Barangay
                <input
                  value={profile.barangay}
                  onChange={(event) => updateProfile('barangay', toTitleCase(event.target.value))}
                  {...fieldAttributes('barangay')}
                  required
                />
                <FieldError field="barangay" />
              </label>
              <label>
                City / Municipality
                <input
                  value={profile.city_municipality}
                  onChange={(event) => updateProfile('city_municipality', toTitleCase(event.target.value))}
                  {...fieldAttributes('city_municipality')}
                  required
                />
                <FieldError field="city_municipality" />
              </label>
              <label>
                Province
                <input
                  value={profile.province}
                  onChange={(event) => updateProfile('province', toTitleCase(event.target.value))}
                  {...fieldAttributes('province')}
                  required
                />
                <FieldError field="province" />
              </label>
              <hr className="password-reset-divider is-span" />
              {isStudent ? (
                <>
                  <label className="is-span">
                    College
                    <select
                      value={profile.college}
                      onChange={(event) => {
                        const college = event.target.value;
                        const nextPrograms = programsForCollege(college);
                        setProfile((current) => ({
                          ...current,
                          college,
                          program_department: nextPrograms.includes(current.program_department) ? current.program_department : '',
                        }));
                        touchField('college');
                        setServerErrors((current) => ({ ...current, program_department: '' }));
                      }}
                      {...fieldAttributes('college')}
                      required
                    >
                      <option value="">Select college</option>
                      {departmentOptions.map((college) => (
                        <option key={college} value={college}>{college}</option>
                      ))}
                    </select>
                    <FieldError field="college" />
                  </label>
                  <label className="is-span">
                    Program / Department
                    <select
                      value={profile.program_department}
                      disabled={!profile.college}
                      onChange={(event) => updateProfile('program_department', event.target.value)}
                      {...fieldAttributes('program_department')}
                      required
                    >
                      <option value="">{profile.college ? 'Select program' : 'Select college first'}</option>
                      {programOptions.map((program) => (
                        <option key={program} value={program}>{program}</option>
                      ))}
                    </select>
                    <FieldError field="program_department" />
                  </label>
                  <label>
                    Year level
                    <select value={profile.year_level} onChange={(event) => updateProfile('year_level', event.target.value)} {...fieldAttributes('year_level')} required>
                      <option value="">Select year level</option>
                      {yearLevelOptions.map((yearLevel) => (
                        <option key={yearLevel} value={yearLevel}>{yearLevel}</option>
                      ))}
                    </select>
                    <FieldError field="year_level" />
                  </label>
                  <label>
                    Section
                    <select value={profile.section} onChange={(event) => updateProfile('section', event.target.value)} {...fieldAttributes('section')}>
                      <option value="">Optional</option>
                      {sectionOptions.map((section) => (
                        <option key={section} value={section}>{section}</option>
                      ))}
                    </select>
                    <FieldError field="section" />
                  </label>
                  <label className="is-span">
                    RFID UID
                    <input
                      maxLength={30}
                      placeholder="Optional"
                      value={profile.rfid_uid}
                      onChange={(event) => updateProfile('rfid_uid', event.target.value.replace(/\s/g, '').toUpperCase().slice(0, 30))}
                      {...fieldAttributes('rfid_uid')}
                    />
                    <FieldError field="rfid_uid" />
                  </label>
                </>
              ) : (
                <>
                  <label>
                    Department / Office
                    <input
                      list="onboarding-department-options"
                      value={profile.office_department}
                      onChange={(event) => updateProfile('office_department', event.target.value)}
                      {...fieldAttributes('office_department')}
                      required
                    />
                    <datalist id="onboarding-department-options">
                      {departmentOptions.map((department) => (
                        <option key={department} value={department} />
                      ))}
                    </datalist>
                    <FieldError field="office_department" />
                  </label>
                  <label>
                    Position
                    <input
                      value={profile.work_position}
                      onChange={(event) => updateProfile('work_position', event.target.value)}
                      {...fieldAttributes('work_position')}
                      required
                    />
                    <FieldError field="work_position" />
                  </label>
                </>
              )}
            </div>
            {error ? <p className="password-reset-error">{error}</p> : null}
            <button type="submit" disabled={busy}>
              {busy ? 'Saving...' : 'Save information'}
            </button>
          </form>
        ) : null}

        {step === 'security' ? (
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              const errors = validateQuestions();
              markFieldsTouched(questions.flatMap((unused, index) => [`security_question_${index + 1}`, `security_answer_${index + 1}`]));
              setError('');
              if (Object.keys(errors).length) return;
              submit(
                {
                  action: 'first_login_security',
                  challenge_id: activeChallengeId,
                  security_questions: questions.map((item) => ({
                    question: item.question,
                    answer: item.answer.trim(),
                  })),
                },
                (data) => {
                  if (!data.user) {
                    setError(data.message || 'The account could not be opened.');
                    return;
                  }
                  onComplete(data.user);
                },
              );
            }}
          >
            <div className="password-reset-questions">
              {questions.map((item, index) => (
                <div className="password-reset-question-row" key={`security-${index}`}>
                  <label>
                    Question {index + 1}
                    <select
                      value={item.question}
                      onChange={(event) => updateQuestion(index, 'question', event.target.value)}
                      {...fieldAttributes(`security_question_${index + 1}`)}
                      required
                    >
                      <option value="">Select a question</option>
                      {securityQuestionOptions.map((question) => (
                        <option
                          key={question}
                          value={question}
                          disabled={questions.some((entry, entryIndex) => entryIndex !== index && entry.question === question)}
                        >
                          {question}
                        </option>
                      ))}
                    </select>
                    <FieldError field={`security_question_${index + 1}`} />
                  </label>
                  <label>
                    Answer
                    <span className="password-reset-secret">
                      <input
                        type={showAnswers[index] ? 'text' : 'password'}
                        value={item.answer}
                        onChange={(event) => updateQuestion(index, 'answer', event.target.value)}
                        {...fieldAttributes(`security_answer_${index + 1}`)}
                        autoComplete="off"
                        required
                      />
                      <button
                        type="button"
                        aria-label={showAnswers[index] ? 'Hide answer' : 'Show answer'}
                        onClick={() => setShowAnswers((current) => current.map((visible, entryIndex) => (
                          entryIndex === index ? !visible : visible
                        )))}
                      >
                        {showAnswers[index] ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </span>
                    <FieldError field={`security_answer_${index + 1}`} />
                  </label>
                </div>
              ))}
            </div>
            {error ? <p className="password-reset-error">{error}</p> : null}
            <button type="submit" disabled={busy}>
              {busy ? 'Saving...' : 'Finish and open dashboard'}
            </button>
          </form>
        ) : null}
      </section>
    </div>
  );
}
