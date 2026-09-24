import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, X } from 'lucide-react';

const RESET_API_URL = 'http://127.0.0.1:8000/api/password_reset.php';
const RESET_SESSION_KEY = 'entrivo_password_reset';
const resetSteps = ['identifier', 'otp', 'questions', 'password', 'done'];

const emptyAnswers = () => [
  { question: '', answer: '' },
  { question: '', answer: '' },
  { question: '', answer: '' },
];

export function readPasswordResetSession() {
  try {
    const raw = window.sessionStorage.getItem(RESET_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!resetSteps.includes(parsed?.step)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearPasswordResetSession() {
  window.sessionStorage.removeItem(RESET_SESSION_KEY);
}

export default function PasswordReset({ onClose }) {
  const saved = useState(() => readPasswordResetSession())[0] || {};
  const [step, setStep] = useState(saved.step || 'identifier');
  const [schoolId, setSchoolId] = useState(saved.schoolId || '');
  const [challengeId, setChallengeId] = useState(saved.challengeId || '');
  const [maskedEmail, setMaskedEmail] = useState(saved.maskedEmail || '');
  const [otp, setOtp] = useState(saved.otp || '');
  const [otpExpiresAt, setOtpExpiresAt] = useState(Number(saved.otpExpiresAt) || 0);
  const [remaining, setRemaining] = useState(() => {
    const expires = Number(saved.otpExpiresAt) || 0;
    return expires ? Math.max(0, Math.ceil((expires - Date.now()) / 1000)) : 0;
  });
  const [questions, setQuestions] = useState(Array.isArray(saved.questions) ? saved.questions : []);
  const [answers, setAnswers] = useState(Array.isArray(saved.answers) && saved.answers.length === 3 ? saved.answers : emptyAnswers());
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const otpRefs = useRef([]);

  useEffect(() => {
    window.sessionStorage.setItem(
      RESET_SESSION_KEY,
      JSON.stringify({ step, schoolId, challengeId, maskedEmail, otp, otpExpiresAt, questions, answers }),
    );
  }, [step, schoolId, challengeId, maskedEmail, otp, otpExpiresAt, questions, answers]);

  useEffect(() => {
    if (step !== 'otp' || !otpExpiresAt) return undefined;

    const tick = () => {
      setRemaining(Math.max(0, Math.ceil((otpExpiresAt - Date.now()) / 1000)));
    };

    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [step, otpExpiresAt]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(''), 1000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const closeReset = () => {
    clearPasswordResetSession();
    onClose();
  };

  const submit = async (payload, onSuccess) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(RESET_API_URL, {
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
      setError('The reset service could not be reached.');
    } finally {
      setBusy(false);
    }
  };

  const titles = {
    identifier: ['Reset password', 'Enter the School ID or Employee ID for the account.'],
    otp: ['Verify your email', `Enter the 6-digit code sent to ${maskedEmail}.`],
    questions: ['Security questions', 'Each list has six questions. Choose the one you set during enrollment.'],
    password: ['Create a new password', 'Use a new password. It cannot be the same as your last one.'],
    done: ['Password updated', 'You can sign in with your new password.'],
  };

  const [title, subtitle] = titles[step];
  const stepNumber = step === 'done' ? 4 : ['identifier', 'otp', 'questions', 'password'].indexOf(step) + 1;

  return (
    <div className="password-reset-backdrop" role="presentation" onMouseDown={closeReset}>
      <section
        className={`password-reset-modal${step === 'password' ? ' is-tall' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="password-reset-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="password-reset-heading">
          <div className="password-reset-step-row">
            <p className="password-reset-step">Step {stepNumber} of 4</p>
            <button type="button" className="password-reset-close" onClick={closeReset} aria-label="Close">
              <X size={16} />
            </button>
          </div>
          <div className="password-reset-track" aria-hidden="true">
            {[1, 2, 3, 4].map((item) => (
                <span key={item} className={item <= stepNumber ? 'is-active' : undefined} />
            ))}
          </div>
          <h2 id="password-reset-title">{title}</h2>
          <p>{subtitle}</p>
        </div>

        {step === 'identifier' ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit({ step: 'identifier', school_id: schoolId.trim() }, (data) => {
                setChallengeId(data.challenge_id);
                setMaskedEmail(data.masked_email || 'your registered email');
                const expiresIn = Number(data.expires_in) || 600;
                setOtpExpiresAt(Date.now() + expiresIn * 1000);
                setRemaining(expiresIn);
                setStep('otp');
              });
            }}
          >
            <label className="password-reset-id-label">
              School ID / Employee ID
              <input
                value={schoolId}
                onChange={(event) => {
                  setSchoolId(event.target.value);
                  setError('');
                }}
                placeholder="2021-1234"
                autoComplete="off"
                autoFocus
              />
            </label>
            {error ? <p className="password-reset-error">{error}</p> : null}
            <button type="submit" className="password-reset-send" disabled={busy}>{busy ? 'Sending code...' : 'Send code'}</button>
          </form>
        ) : null}

        {step === 'otp' ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit({ step: 'otp', challenge_id: challengeId, otp: otp.trim() }, (data) => {
                setQuestions(Array.isArray(data.question_sets) ? data.question_sets : []);
                setAnswers(emptyAnswers());
                setStep('questions');
              });
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
                      const filled = Array.from({ length: 6 }, (unused, digitIndex) => (digitIndex === index ? digits : otp[digitIndex] || '')).join('');
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
                  submit({ step: 'resend', challenge_id: challengeId }, (data) => {
                    setChallengeId(data.challenge_id);
                    setOtp('');
                    const expiresIn = Number(data.expires_in) || 600;
                    setOtpExpiresAt(Date.now() + expiresIn * 1000);
                    setRemaining(expiresIn);
                    setNotice('A new code was sent.');
                  });
                }}
              >
                Resend
              </button>
            </p>
            <button type="submit" className="password-reset-send" disabled={busy || remaining === 0}>{busy ? 'Checking...' : 'Verify code'}</button>
          </form>
        ) : null}

        {step === 'questions' ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit({ step: 'questions', challenge_id: challengeId, answers }, () => setStep('password'));
            }}
          >
            {answers.map((item, index) => {
              const options = Array.isArray(questions[index]) ? questions[index] : [];
              return (
                <div className="password-reset-question" key={index}>
                  <label>
                    Question {index + 1}
                    <select
                      value={item.question}
                      onChange={(event) => {
                        const next = [...answers];
                        next[index] = { ...next[index], question: event.target.value };
                        setAnswers(next);
                      }}
                    >
                      <option value="">Select a question</option>
                      {options.map((question) => (
                        <option key={question} value={question}>
                          {question}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Answer
                    <input
                      value={item.answer}
                      onChange={(event) => {
                        const next = [...answers];
                        next[index] = { ...next[index], answer: event.target.value };
                        setAnswers(next);
                      }}
                      autoComplete="off"
                    />
                  </label>
                </div>
              );
            })}
            {error ? <p className="password-reset-error">{error}</p> : null}
            <button type="submit" disabled={busy}>{busy ? 'Checking...' : 'Continue'}</button>
          </form>
        ) : null}

        {step === 'password' ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit(
                {
                  step: 'password',
                  challenge_id: challengeId,
                  password,
                  confirm_password: confirmPassword,
                },
                () => setStep('done'),
              );
            }}
          >
            <label>
              New password
              <span className="password-reset-secret">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                  autoFocus
                />
                <button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
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
                />
                <button type="button" onClick={() => setShowConfirm((current) => !current)} aria-label={showConfirm ? 'Hide password' : 'Show password'}>
                  {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
            </label>
            {error ? <p className="password-reset-error">{error}</p> : null}
            <button type="submit" disabled={busy}>{busy ? 'Saving...' : 'Reset password'}</button>
          </form>
        ) : null}

        {step === 'done' ? (
          <button type="button" onClick={closeReset}>Back to sign in</button>
        ) : null}
      </section>
    </div>
  );
}
