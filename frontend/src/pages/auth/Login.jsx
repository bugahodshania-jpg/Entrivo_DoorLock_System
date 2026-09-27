import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Lock, Mail, Menu, X } from 'lucide-react';
import logo from '../../assets/images/entrivo_logo.png';
import PixelWave from '../../components/PixelWave';
import PasswordReset, { readPasswordResetSession } from './PasswordReset';
import { firstAllowedSuperAdminPath } from '../../utils/privileges';
import '../../styles/home/home.css';
import '../../styles/auth/auth.css';

const showcasePoints = [
  {
    title: 'Secure door access',
    description: 'Manage role-based entry for classrooms, offices, and restricted areas.',
  },
  {
    title: 'Biometric ready',
    description: 'Support fingerprint enrollment and synced door-device templates.',
  },
  {
    title: 'Attendance tracking',
    description: 'Monitor schedules and access activity from one admin dashboard.',
  },
];

const LOCK_STORAGE_KEY = 'entrivo_login_lock';
const AUTH_API_URL = 'http://127.0.0.1:8000/api/auth.php';

const readStoredLock = () => {
  try {
    const raw = window.sessionStorage.getItem(LOCK_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.username) return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeStoredLock = (username) => {
  window.sessionStorage.setItem(
    LOCK_STORAGE_KEY,
    JSON.stringify({
      username,
      savedAt: Date.now(),
    })
  );
};

const clearStoredLock = () => {
  window.sessionStorage.removeItem(LOCK_STORAGE_KEY);
};

export default function Login() {
  const [form, setForm] = useState({
    username: '',
    password: '',
  });
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState({ type: 'idle', message: '' });
  const [fieldErrors, setFieldErrors] = useState({ username: '', password: '' });
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetOpen, setResetOpen] = useState(() => Boolean(readPasswordResetSession()));
  const [lockoutSeconds, setLockoutSeconds] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeShowcase, setActiveShowcase] = useState(0);
  const [carouselPaused, setCarouselPaused] = useState(false);
  const hoverLockedRef = useRef(false);
  const lockRestoreDoneRef = useRef(false);

  const isLocked = lockoutSeconds > 0;

  useEffect(() => {
    const notice = window.sessionStorage.getItem('entrivo_login_notice');

    if (!notice) {
      return;
    }

    window.sessionStorage.removeItem('entrivo_login_notice');
    setStatus({ type: 'error', message: notice });
    setFieldErrors({ username: notice, password: '' });
  }, []);

  useEffect(() => {
    if (carouselPaused) return undefined;

    const timer = window.setInterval(() => {
      setActiveShowcase((current) => (current + 1) % showcasePoints.length);
    }, 4200);

    return () => window.clearInterval(timer);
  }, [carouselPaused]);

  useEffect(() => {
    if (!isLocked) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setLockoutSeconds((current) => {
        if (current <= 1) {
          setShowForgotPassword(false);
          clearStoredLock();
          return 0;
        }
        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isLocked]);

  const selectShowcase = (index, { fromHover = false } = {}) => {
    if (fromHover) {
      if (hoverLockedRef.current || index === activeShowcase) return;
      hoverLockedRef.current = true;
    }
    setActiveShowcase(index);
  };

  const handleCarouselEnter = () => {
    setCarouselPaused(true);
  };

  const handleCarouselLeave = () => {
    hoverLockedRef.current = false;
    setCarouselPaused(false);
  };

  useEffect(() => {
    if (!status.message || status.type === 'loading' || status.type === 'error') {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      setStatus({ type: 'idle', message: '' });
    }, 5000);

    return () => window.clearTimeout(timeout);
  }, [status]);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > 900) {
        setMenuOpen(false);
      }
    };

    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';

    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, []);

  useEffect(() => {
    if (menuOpen) {
      document.body.style.overflow = 'hidden';
    }
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  const applySecurityState = (data, usernameForLock = '') => {
    setShowForgotPassword(Boolean(data?.show_forgot_password));

    const retryAfter = Number(data?.retry_after) || 0;
    if (data?.locked && retryAfter > 0) {
      const lockedUsername = (data.username || usernameForLock || '').trim();
      if (lockedUsername) {
        writeStoredLock(lockedUsername);
        setForm((current) => ({
          ...current,
          username: current.username || lockedUsername,
        }));
      }

      setLockoutSeconds(retryAfter);
      setFieldErrors({ username: '', password: '' });
      return;
    }

    if (!data?.locked) {
      setLockoutSeconds(0);
      clearStoredLock();
    }
  };

  useEffect(() => {
    if (lockRestoreDoneRef.current) return undefined;
    lockRestoreDoneRef.current = true;

    const stored = readStoredLock();
    if (!stored?.username) return undefined;

    let cancelled = false;

    const restoreLockout = async () => {
      setForm((current) => ({
        ...current,
        username: current.username || stored.username,
      }));

      try {
        const response = await fetch(AUTH_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            check_lock: true,
            username: stored.username,
          }),
        });

        const data = await response.json();
        if (cancelled) return;

        if (data.locked && Number(data.retry_after) > 0) {
          applySecurityState(data, stored.username);
          setStatus({ type: 'error', message: data.message || 'Account temporarily locked.' });
        } else {
          clearStoredLock();
          setLockoutSeconds(0);
          setShowForgotPassword(false);
        }
      } catch {
        if (!cancelled) {
          clearStoredLock();
        }
      }
    };

    restoreLockout();

    return () => {
      cancelled = true;
    };
  }, []);

  const updateField = (event) => {
    if (isLocked) return;

    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: value,
    }));
    setFieldErrors((current) => ({
      ...current,
      [name]: '',
    }));
    if (status.type === 'error') {
      setStatus({ type: 'idle', message: '' });
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isLocked) return;

    const nextErrors = {
      username: form.username.trim() ? '' : 'Username is required.',
      password: form.password ? '' : 'Password is required.',
    };

    if (nextErrors.username || nextErrors.password) {
      setFieldErrors(nextErrors);
      setStatus({ type: 'idle', message: '' });
      return;
    }

    setFieldErrors({ username: '', password: '' });
    setStatus({ type: 'loading', message: 'Checking credentials...' });

    try {
      const response = await fetch(AUTH_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(form),
      });

      const data = await response.json();
      applySecurityState(data, form.username.trim());

      if (!response.ok) {
        if (data.locked) {
          setStatus({ type: 'error', message: data.message || 'Account temporarily locked.' });
          return;
        }

        const field = data.field === 'password' ? 'password' : data.field === 'username' ? 'username' : '';
        const message = data.message || 'Login failed.';

        if (field) {
          setFieldErrors({
            username: field === 'username' ? message : '',
            password: field === 'password' ? message : '',
          });
        } else {
          setFieldErrors({ username: message, password: '' });
        }

        setStatus({ type: 'error', message });
        return;
      }

      setShowForgotPassword(false);
      setLockoutSeconds(0);
      clearStoredLock();

      const storage = rememberMe ? window.localStorage : window.sessionStorage;
      storage.setItem('entrivo_user', JSON.stringify(data.user));
      setStatus({ type: 'success', message: data.message });

      if (data.user.role === 'super_admin' || data.user.role === 'admin') {
        window.location.assign(firstAllowedSuperAdminPath(data.user));
        return;
      }

      window.location.assign('/login');
    } catch (error) {
      const message = error.message || 'Login failed.';
      setFieldErrors({ username: '', password: message });
      setStatus({ type: 'error', message });
    }
  };

  return (
    <main className={`auth-page auth-page-split${menuOpen ? ' is-menu-open' : ''}`}>
      <PixelWave variant="auth" className="auth-pixel-wave" />

      <header className="home-header">
        <div className="home-header-inner">
          <a className="home-brand" href="/" aria-label="Entrivo home">
            <img src={logo} alt="Entrivo logo" />
            <span>Entrivo</span>
          </a>

          <button
            type="button"
            className="home-menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="auth-mobile-nav"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>

          <div className={`home-header-right${menuOpen ? ' is-open' : ''}`} id="auth-mobile-nav">
            <nav className="home-actions" aria-label="Primary">
              <a className="home-link-button" href="/" onClick={closeMenu}>
                Home
              </a>
              <a className="home-primary-button" href="/register" onClick={closeMenu}>
                Sign up
              </a>
            </nav>
          </div>
        </div>
      </header>

      <div className="auth-shell">
        <aside className="auth-showcase" aria-label="Entrivo highlights">
          <div className="auth-showcase-content">
            <p className="auth-showcase-eyebrow">Secure Access Management</p>
            <h2>Modern door control, attendance, and identity workflows.</h2>
            <p className="auth-showcase-copy">
              Entrivo helps schools and organizations manage secure entry, biometric enrollment, and
              user access from one clean system.
            </p>

            <div
              className="auth-showcase-carousel"
              aria-label="Feature highlights"
              onMouseEnter={handleCarouselEnter}
              onMouseLeave={handleCarouselLeave}
            >
              {showcasePoints.map(({ title, description }, index) => {
                let offset = index - activeShowcase;
                if (offset > 1) offset -= showcasePoints.length;
                if (offset < -1) offset += showcasePoints.length;

                const positionClass =
                  offset === 0 ? 'is-center' : offset === -1 ? 'is-left' : offset === 1 ? 'is-right' : 'is-hidden';

                return (
                  <article
                    key={title}
                    className={`auth-showcase-card ${positionClass}`}
                    onMouseEnter={() => selectShowcase(index, { fromHover: true })}
                    onFocus={() => selectShowcase(index)}
                    onClick={() => selectShowcase(index)}
                    tabIndex={0}
                    aria-current={offset === 0 ? 'true' : undefined}
                  >
                    <span className="auth-showcase-index" aria-hidden="true">
                      0{index + 1}
                    </span>
                    <div>
                      <strong>{title}</strong>
                      <p>{description}</p>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="auth-showcase-dots" aria-hidden="true">
              {showcasePoints.map((point, index) => (
                <button
                  key={point.title}
                  type="button"
                  className={`auth-showcase-dot${index === activeShowcase ? ' is-active' : ''}`}
                  onClick={() => selectShowcase(index)}
                  aria-label={`Show ${point.title}`}
                />
              ))}
            </div>
          </div>
        </aside>

        <section className="auth-panel" aria-labelledby="login-title">
          <div className="auth-header">
            <h1 id="login-title">Login</h1>
            <p className="auth-copy">Sign in to your account to continue.</p>
          </div>

          <form className="auth-form" onSubmit={handleSubmit} noValidate>
            {isLocked ? (
              <div className="auth-lockout" role="alert" aria-live="polite">
                <p className="auth-lockout-message">
                  Too many failed login attempts. Please wait {lockoutSeconds}{' '}
                  {lockoutSeconds === 1 ? 'second' : 'seconds'} before trying again.
                </p>
              </div>
            ) : null}

            <label className={fieldErrors.username ? 'has-error' : undefined}>
              Username
              <span
                className={`auth-input-wrap${fieldErrors.username ? ' is-invalid' : ''}${
                  isLocked ? ' is-disabled' : ''
                }`}
              >
                <Mail aria-hidden="true" size={17} />
                <input
                  name="username"
                  type="text"
                  value={form.username}
                  onChange={updateField}
                  autoComplete="username"
                  placeholder="Enter your username"
                  required
                  disabled={isLocked}
                  aria-invalid={Boolean(fieldErrors.username)}
                />
              </span>
              {fieldErrors.username ? (
                <span className="auth-field-error">{fieldErrors.username}</span>
              ) : null}
            </label>

            <label className={fieldErrors.password ? 'has-error' : undefined}>
              Password
              <span
                className={`auth-input-wrap${fieldErrors.password ? ' is-invalid' : ''}${
                  isLocked ? ' is-disabled' : ''
                }`}
              >
                <Lock aria-hidden="true" size={17} />
                <input
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onChange={updateField}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  required
                  disabled={isLocked}
                  aria-invalid={Boolean(fieldErrors.password)}
                />
                <button
                  className="auth-icon-button"
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword((current) => !current)}
                  disabled={isLocked}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </span>
              {fieldErrors.password ? (
                <span className="auth-field-error">{fieldErrors.password}</span>
              ) : null}
            </label>

            <div className="auth-options">
              <label className="auth-checkbox">
                <input
                  checked={rememberMe}
                  onChange={(event) => setRememberMe(event.target.checked)}
                  type="checkbox"
                  disabled={isLocked}
                />
                Remember me
              </label>
            </div>

            <button type="submit" disabled={isLocked || status.type === 'loading'}>
              {status.type === 'loading' ? 'Signing in...' : 'Sign In'}
            </button>

            <div className="auth-footer">
              <p className="auth-register-note">
                Don&apos;t have an account? <a href="/register">Sign up</a>
              </p>

              {showForgotPassword ? (
                <>
                  <div className="auth-footer-or" role="separator" aria-label="or">
                    <span>or</span>
                  </div>
                  <p className="auth-forgot-note">
                    Forgot Password?{' '}
                    <button type="button" className="auth-reset-link" onClick={() => setResetOpen(true)}>
                      Reset Here
                    </button>
                  </p>
                </>
              ) : null}
            </div>
          </form>
        </section>
      </div>
      {resetOpen ? <PasswordReset onClose={() => setResetOpen(false)} /> : null}
    </main>
  );
}
