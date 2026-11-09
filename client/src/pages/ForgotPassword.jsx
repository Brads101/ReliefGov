import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import Button from '../components/ui/Button.jsx';
import { Field, Input } from '../components/ui/Input.jsx';
import { InlineAlert } from '../components/ui/States.jsx';
import { LogoMark } from '../components/ui/Logo.jsx';

/**
 * Step 1 of password recovery: the user asks for a reset email.
 * The server always answers with the same generic message so this form
 * cannot be used to discover which email addresses have accounts.
 */
export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await api('/auth/forgot-password', {
        method: 'POST',
        body: { email: email.trim() }
      });
      setSent(true);
      if (result?.message) setSent(result.message);
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
          <h1 className="text-lg font-semibold text-navy-900">Forgot your password?</h1>
          <p className="mt-1 text-[13.5px] text-slate-500">
            Enter the email address registered with your ReliefGov account. We will send a
            password recovery link.
          </p>

          {sent ? (
            <div className="mt-4">
              <InlineAlert level="success" title="Recovery email requested">
                {typeof sent === 'string' ? sent : 'If an account exists, a recovery email has been sent.'}
              </InlineAlert>
              <Button variant="secondary" className="mt-4" onClick={() => window.location.assign('/login')}>
                Back to sign in
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
              {error && <InlineAlert level="error">{error}</InlineAlert>}

              <Field label="Email address" htmlFor="email" required>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>

              <Button type="submit" loading={busy} className="w-full">
                Send recovery link
              </Button>
            </form>
          )}

          <p className="mt-5 text-center text-[12.5px] text-slate-500">
            Remembered it?{' '}
            <Link to="/login" className="font-medium text-gov-700 hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
