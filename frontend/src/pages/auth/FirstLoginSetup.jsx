import { useEffect, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff, X } from 'lucide-react';
import { getManilaDateStamp } from '../../utils/dateTime';
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

function calculateAge(dateOfBirth) {
  if (!dateOfBirth || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
    return '';
  }

  const [birthYear, birthMonth, birthDay] = dateOfBirth.split('-').map(Number);
  const [todayYear, todayMonth, todayDay] = getManilaDateStamp().split('-').map(Number);
  let age = todayYear - birthYear;
  const hasBirthdayPassed = todayMonth > birthMonth || (todayMonth === birthMonth && todayDay >= birthDay);

  if (!hasBirthdayPassed) {
    age -= 1;
  }

  return age >= 0 ? String(age) : '';
}

function toTitleCase(value) {
  return value
    .toLowerCase()
    .replace(/(^|[\s-])([a-z])/g, (match, separator, letter) => `${separator}${letter.toUpperCase()}`);
}

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

  async function submit(payload, onSuccess) {
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
        setError(data.message || 'Something went wrong. Try again.');
        return;
      }

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
    setProfile((current) => ({ ...current, [field]: value }));
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
    if (!profile.sex) return 'Sex is required.';
    if (!/^\d{11}$/.test(profile.contact_number)) return 'Contact number must be 11 digits.';
    if (!profile.date_of_birth || calculateAge(profile.date_of_birth) === '') {
      return 'Date of birth must be a valid past date.';
    }
    if (!profile.barangay.trim() || !profile.city_municipality.trim() || !profile.province.trim()) {
      return 'Barangay, city, and province are required.';
    }
    if (isStudent) {
      if (!profile.college || !profile.program_department || !profile.year_level) {
        return 'College, program, and year level are required.';
      }
    } else if (!profile.office_department.trim() || !profile.work_position.trim()) {
      return 'Department and position are required.';
    }
    return '';
  }

  function validateQuestions() {
    if (questions.some((item) => !item.question || item.answer.trim().length < 2)) {
      return 'Choose three questions and give each answer at least 2 characters.';
    }
    if (new Set(questions.map((item) => item.question)).size !== 3) {
      return 'Choose three different security questions.';
    }
    return '';
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
      >
        <div className="password-reset-heading">
          <div className="password-reset-step-row">
            <p className="password-reset-step">Step {stepIndex + 1} of 4</p>
            <button type="button" className="password-reset-close" onClick={onClose} aria-label="Close">
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
            onSubmit={(event) => {
              event.preventDefault();
              if (password !== confirmPassword) {
                setError('Password confirmation does not match.');
                return;
              }
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
                  onChange={(event) => setPassword(event.target.value)}
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
            </label>
            <label>
              Confirm password
              <span className="password-reset-secret">
                <input
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
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
            </label>
            {error ? <p className="password-reset-error">{error}</p> : null}
            <button type="submit" disabled={busy}>
              {busy ? 'Saving...' : 'Save password and continue'}
            </button>
          </form>
        ) : null}

        {step === 'profile' ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const message = validateProfile();
              if (message) {
                setError(message);
                return;
              }
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
                />
              </label>
              <label>
                Suffix
                <select value={profile.extension_name} onChange={(event) => updateProfile('extension_name', event.target.value)}>
                  {suffixOptions.map((suffix) => (
                    <option key={suffix || 'none'} value={suffix}>{suffix || 'None'}</option>
                  ))}
                </select>
              </label>
              <label>
                Sex
                <select value={profile.sex} onChange={(event) => updateProfile('sex', event.target.value)} required>
                  <option value="">Select sex</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
              </label>
              <label>
                Contact number
                <input
                  inputMode="numeric"
                  maxLength={11}
                  placeholder="09*********"
                  value={profile.contact_number}
                  onChange={(event) => updateProfile('contact_number', event.target.value.replace(/\D/g, '').slice(0, 11))}
                  required
                />
              </label>
              <label>
                Birthdate
                <input
                  type="date"
                  max={getManilaDateStamp()}
                  value={profile.date_of_birth}
                  onChange={(event) => {
                    const value = event.target.value;
                    setProfile((current) => ({
                      ...current,
                      date_of_birth: value,
                      age: calculateAge(value),
                    }));
                  }}
                  required
                />
              </label>
              <label>
                Age
                <input readOnly value={profile.age} placeholder="Calculated from birthdate" />
              </label>
              <hr className="password-reset-divider is-span" />
              <label>
                Street address
                <input
                  placeholder="Optional"
                  value={profile.street_address}
                  onChange={(event) => updateProfile('street_address', event.target.value)}
                />
              </label>
              <label>
                Barangay
                <input
                  value={profile.barangay}
                  onChange={(event) => updateProfile('barangay', toTitleCase(event.target.value))}
                  required
                />
              </label>
              <label>
                City / Municipality
                <input
                  value={profile.city_municipality}
                  onChange={(event) => updateProfile('city_municipality', toTitleCase(event.target.value))}
                  required
                />
              </label>
              <label>
                Province
                <input
                  value={profile.province}
                  onChange={(event) => updateProfile('province', toTitleCase(event.target.value))}
                  required
                />
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
                      }}
                      required
                    >
                      <option value="">Select college</option>
                      {departmentOptions.map((college) => (
                        <option key={college} value={college}>{college}</option>
                      ))}
                    </select>
                  </label>
                  <label className="is-span">
                    Program / Department
                    <select
                      value={profile.program_department}
                      disabled={!profile.college}
                      onChange={(event) => updateProfile('program_department', event.target.value)}
                      required
                    >
                      <option value="">{profile.college ? 'Select program' : 'Select college first'}</option>
                      {programOptions.map((program) => (
                        <option key={program} value={program}>{program}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Year level
                    <select value={profile.year_level} onChange={(event) => updateProfile('year_level', event.target.value)} required>
                      <option value="">Select year level</option>
                      {yearLevelOptions.map((yearLevel) => (
                        <option key={yearLevel} value={yearLevel}>{yearLevel}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Section
                    <select value={profile.section} onChange={(event) => updateProfile('section', event.target.value)}>
                      <option value="">Optional</option>
                      {sectionOptions.map((section) => (
                        <option key={section} value={section}>{section}</option>
                      ))}
                    </select>
                  </label>
                  <label className="is-span">
                    RFID UID
                    <input
                      maxLength={30}
                      placeholder="Optional"
                      value={profile.rfid_uid}
                      onChange={(event) => updateProfile('rfid_uid', event.target.value.replace(/\s/g, '').toUpperCase().slice(0, 30))}
                    />
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
                      required
                    />
                    <datalist id="onboarding-department-options">
                      {departmentOptions.map((department) => (
                        <option key={department} value={department} />
                      ))}
                    </datalist>
                  </label>
                  <label>
                    Position
                    <input
                      value={profile.work_position}
                      onChange={(event) => updateProfile('work_position', event.target.value)}
                      required
                    />
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
            onSubmit={(event) => {
              event.preventDefault();
              const message = validateQuestions();
              if (message) {
                setError(message);
                return;
              }
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
                      onChange={(event) => {
                        const value = event.target.value;
                        setQuestions((current) => current.map((entry, entryIndex) => (
                          entryIndex === index ? { ...entry, question: value } : entry
                        )));
                      }}
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
                  </label>
                  <label>
                    Answer
                    <span className="password-reset-secret">
                      <input
                        type={showAnswers[index] ? 'text' : 'password'}
                        value={item.answer}
                        onChange={(event) => {
                          const value = event.target.value;
                          setQuestions((current) => current.map((entry, entryIndex) => (
                            entryIndex === index ? { ...entry, answer: value } : entry
                          )));
                        }}
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
