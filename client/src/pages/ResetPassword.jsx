import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import Button from '../components/ui/Button.jsx';
import { Field, Input } from '../components/ui/Input.jsx';
import { InlineAlert } from '../components/ui/States.jsx';
import { LogoMark } from '../components/ui/Logo.jsx';

/**
 * Step 2 of password recovery. Supabase redirects here with the one-time
 * recovery tokens in the URL (implicit flow: #access_token=…&refresh_token=…).
 * The tokens are posted to the server, which verifies them with Supabase and
 * sets the new password. Nothing secret is stored in this page.
 */
export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [tokens, setTokens] = useState(null);
  const [linkError, setLinkError] = useState(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Supabase recovery links deliver tokens in the URL hash fragment.
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const access_token = params.get('access_token') || hash.get('access_token');
    const refresh_token = params.get('refresh_token') || hash.get('refresh_token');
    const type = params.get('type') || hash.get('type');
    const errorDescription = params.get('error_description') || hash.get('error_description');

    if (errorDescription) {
      setLinkError(
        'This recovery link is no longer valid. Request a new password reset email.'
      );
    } else if (access_token && refresh_token && (!type || type === 'recovery')) {
      setTokens({ access_token, refresh_token });
    } else {
      setLinkError(
        'This page can only be opened from a password recovery link. Request a new link from the sign-in page.'
      );
    }
  }, [params]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    setBusy(true);
    try {
      await api('/auth/reset-password', {
        method: 'POST',
        body: { ...tokens, password }
      });
      navigate('/login', { state: { resetDone: true } });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-5 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <LogoMark className="h-9 w-9" />
          <div className="leading-tight">
            <p className="text-base font-semibold text-navy-900">
              Relief<span className="text-gov-700">Gov</span>
            </p>
            <p className="text-[10.5px] uppercase tracking-[0.16em] text-slate-500">Iligan City LGU</p>
          </div>
        </div>

        <div className="rg-card p-6">
          <h1 className="text-lg font-semibold text-navy-900">Set a new password</h1>
          <p className="mt-1 text-[13.5px] text-slate-500">
            Choose a new password for your ReliefGov account.
          </p>

          {linkError ? (
            <div className="mt-4">
              <InlineAlert level="warning" title="Recovery link problem">
                {linkError}
              </InlineAlert>
              <Button variant="secondary" className="mt-4" onClick={() => navigate('/forgot-password')}>
                Request a new link
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
              {error && <InlineAlert level="error">{error}</InlineAlert>}

              <Field label="New password" htmlFor="password" required hint="At least 8 characters.">
                <Input
                  id="password"
                  name="password"
                  type="password"
                  minLength={8}
                  required
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>

              <Field label="Confirm new password" htmlFor="confirm" required>
                <Input
                  id="confirm"
                  name="confirm"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </Field>

              <Button type="submit" loading={busy} className="w-full">
                Update password
              </Button>
            </form>
          )}

          <p className="mt-5 text-center text-[12.5px] text-slate-500">
            <Link to="/login" className="font-medium text-gov-700 hover:underline">
              Back to sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
