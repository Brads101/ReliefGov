import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import Button from '../components/ui/Button.jsx';
import { Field, Input } from '../components/ui/Input.jsx';
import { InlineAlert, LoadingState } from '../components/ui/States.jsx';
import { LogoMark } from '../components/ui/Logo.jsx';

/**
 * Beneficiary self-registration. Requires Supabase Auth; the server answers
 * HTTP 501 with a clear message when it is not configured.
 */
export default function Register() {
  const navigate = useNavigate();
  const [config, setConfig] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    password: '',
    role: 'beneficiary'
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/auth/session-config')
      .then(setConfig)
      .catch((err) => setLoadError(err.message));
  }, []);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api('/auth/register', { method: 'POST', body: form });
      navigate('/login', { state: { registered: true } });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <div className="p-6"><InlineAlert level="error">{loadError}</InlineAlert></div>;
  if (!config) return <div className="p-6"><LoadingState label="Loading registration…" /></div>;

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-5 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <LogoMark className="h-10 w-10" />
          <div className="leading-tight">
            <p className="text-base font-semibold text-navy-900">
              Relief<span className="text-gov-700">Gov</span>
            </p>
            <p className="text-[10.5px] uppercase tracking-[0.16em] text-slate-500">Iligan City LGU</p>
          </div>
        </div>

        <div className="rg-card p-6">
          <h1 className="text-lg font-semibold text-navy-900">Beneficiary registration</h1>
          <p className="mt-1 text-[13.5px] text-slate-500">
            Accounts are restricted to Barangay Tambacan, Iligan City.
          </p>

          {!config.registrationEnabled ? (
            <div className="mt-4">
              <InlineAlert level="warning" title="Registration unavailable">
                Self-registration requires Supabase Auth. {config.notice}
              </InlineAlert>
              <Button variant="secondary" className="mt-4" onClick={() => navigate('/login')}>
                Back to sign in
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
              {error && <InlineAlert level="error">{error}</InlineAlert>}

              <Field label="Full name" htmlFor="full_name" required>
                <Input id="full_name" name="full_name" required value={form.full_name} onChange={set('full_name')} />
              </Field>

              <Field label="Email address" htmlFor="email" required>
                <Input id="email" name="email" type="email" required value={form.email} onChange={set('email')} />
              </Field>

              <Field label="Password" htmlFor="password" required hint="At least 8 characters.">
                <Input
                  id="password"
                  name="password"
                  type="password"
                  minLength={8}
                  required
                  value={form.password}
                  onChange={set('password')}
                />
              </Field>

              <p className="rg-hint">
                Public registration creates <strong>beneficiary</strong> accounts only.
                Barangay Staff and CSWD Staff accounts are created and approved by the
                CSWD Office, Iligan City.
              </p>

              <Button type="submit" loading={busy} className="w-full">
                Create account
              </Button>
            </form>
          )}

          <p className="mt-5 text-center text-[12.5px] text-slate-500">
            Already registered?{' '}
            <Link to="/login" className="font-medium text-gov-700 hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
