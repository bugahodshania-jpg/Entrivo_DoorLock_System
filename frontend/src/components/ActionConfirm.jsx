import { createContext, useContext, useRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import '../styles/shared/actionConfirm.css';

const ActionConfirmContext = createContext(null);

export function useActionConfirm() {
  return useContext(ActionConfirmContext);
}

export function ActionConfirmProvider({ user, children }) {
  const [request, setRequest] = useState(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const resolver = useRef(null);

  const confirmAction = (details) =>
    new Promise((resolve) => {
      resolver.current = resolve;
      setPassword('');
      setShowPassword(false);
      setError('');
      setBusy(false);
      setRequest({
        step: details.step === 'password' ? 'password' : 'sure',
        title: details.title,
        message: details.message,
        danger: Boolean(details.danger),
        requirePassword: details.requirePassword !== false,
      });
    });

  const finish = (allowed) => {
    resolver.current?.(allowed);
    resolver.current = null;
    setRequest(null);
    setPassword('');
    setError('');
  };

  const verifyPassword = async (event) => {
    event.preventDefault();
    if (!password) {
      setError('Security password is required.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const response = await fetch('http://127.0.0.1:8000/api/verify_action_password.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user?.id, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.message || 'The security password is incorrect.');
        return;
      }
      finish(true);
    } catch {
      setError('The security password could not be checked.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ActionConfirmContext.Provider value={confirmAction}>
      {children}
      {request ? (
        <div className="action-confirm-backdrop" role="presentation">
          <section className="action-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="action-confirm-title">
            {request.step === 'sure' ? (
              <>
                <h2 id="action-confirm-title">{request.title}</h2>
                <p>{request.message}</p>
                <div className="action-confirm-actions">
                  <button type="button" className="action-confirm-secondary" onClick={() => finish(false)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={request.danger ? 'action-confirm-danger' : undefined}
                    onClick={() => {
                      if (request.requirePassword === false) {
                        finish(true);
                        return;
                      }

                      setRequest((current) => ({ ...current, step: 'password' }));
                    }}
                  >
                    Continue
                  </button>
                </div>
              </>
            ) : (
              <form onSubmit={verifyPassword}>
                <h2 id="action-confirm-title">Security Verification</h2>
                <p>Enter your password to confirm this action.</p>
                <label>
                  Password
                  <span className="action-confirm-secret">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(event) => {
                        setPassword(event.target.value);
                        setError('');
                      }}
                      autoFocus
                      autoComplete="current-password"
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
                {error ? <p className="action-confirm-error">{error}</p> : null}
                <div className="action-confirm-actions">
                  <button type="button" className="action-confirm-secondary" onClick={() => finish(false)}>
                    Cancel
                  </button>
                  <button type="submit" className={request.danger ? 'action-confirm-danger' : undefined} disabled={busy}>
                    {busy ? 'Checking...' : 'Confirm'}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      ) : null}
    </ActionConfirmContext.Provider>
  );
}
