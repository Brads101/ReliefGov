import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import Button from '../components/ui/Button.jsx';
import { Field, Input } from '../components/ui/Input.jsx';
import { InlineAlert } from '../components/ui/States.jsx';
import { LogoMark } from '../components/ui/Logo.jsx';

export default function Login() {
  const { user, status, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const justRegistered = Boolean(location.state && location.state.registered);
  const resetDone = Boolean(location.state && location.state.resetDone);

  if (status === 'loading') return null;
  if (user) return <Navigate to={(location.state && location.state.from) || '/dashboard'} replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
      navigate((location.state && location.state.from) || '/dashboard', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-surface">
      {/* Left — LGU-inspired landing panel */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-navy-950 p-10 lg:flex xl:p-12">
        {/* Documentary relief-response photograph (public domain — see public/images/ATTRIBUTION.md) */}
        <img
          src="/images/relief-iligan.jpg"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover object-center"
        />
        {/* Navy overlay keeps text readable over the image */}
        <div
          className="absolute inset-0 bg-gradient-to-br from-navy-950/95 via-navy-900/90 to-[#17365D]/80"
          aria-hidden="true"
        />

        <div className="relative flex items-center gap-3">
          <LogoMark className="h-14 w-14" />
          <div className="leading-tight">
            <p className="text-lg font-semibold text-white">
              Relief<span className="text-teal-300">Gov</span>
            </p>
            <p className="text-[11px] uppercase tracking-[0.18em] text-navy-200">Iligan City LGU</p>
          </div>
        </div>

        <div className="relative">
          <h1 className="text-4xl font-semibold tracking-tight text-white xl:text-[42px]">
            ReliefGov
          </h1>
          <p className="mt-2 max-w-lg text-lg font-medium leading-snug text-teal-200">
            Disaster Relief &amp; Beneficiary Assistance Portal
          </p>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-navy-100">
            A web-based system for beneficiary profiling, record validation, AI-assisted
            vulnerability scoring, and disaster-assistance monitoring — supporting the work of
            the CSWD Office and barangay social workers.
          </p>

          <p className="mt-7 border-l-2 border-alert-400 pl-3.5 text-sm font-medium tracking-wide text-white">
            Serving Communities. Supporting Recovery.
          </p>
        </div>

        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-md border border-white/20 bg-white/5 px-3 py-2 text-[12.5px] text-navy-200">
            <span className="h-1.5 w-1.5 rounded-full bg-teal-400" aria-hidden="true" />
            City Social Welfare and Development (CSWD) Office · Iligan City
          </div>
        </div>
      </div>

      {/* Right — sign-in form */}
      <div className="flex w-full items-center justify-center px-5 py-12 lg:w-1/2 lg:px-10 xl:px-16">
        <div className="w-full max-w-md">
          <div className="rounded-xl border border-line bg-white px-6 py-7 shadow-card sm:px-8 sm:py-8">
            <div className="mb-6 flex items-center gap-3 lg:hidden">
              <LogoMark className="h-10 w-10" />
              <div className="leading-tight">
                <p className="text-base font-semibold text-navy-900">
                  Relief<span className="text-gov-700">Gov</span>
                </p>
                <p className="text-[10.5px] uppercase tracking-[0.16em] text-slate-500">Iligan City LGU</p>
              </div>
            </div>

            <h2 className="text-lg font-semibold text-navy-900">Sign in to ReliefGov</h2>
            <p className="mt-1 text-[13.5px] text-slate-500">
              Use your assigned account. Records are limited to Barangay Tambacan.
            </p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
              {justRegistered && (
                <InlineAlert level="success" title="Registration received">
                  Your beneficiary account has been created. Sign in to continue.
                </InlineAlert>
              )}
              {resetDone && (
                <InlineAlert level="success" title="Password updated">
                  Your password has been reset. Sign in with your new password.
                </InlineAlert>
              )}
              {error && <InlineAlert level="error">{error}</InlineAlert>}

              <Field label="Email address" htmlFor="email" required>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@reliefgov.local"
                />
              </Field>

              <Field label="Password" htmlFor="password" required>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
                <div className="mt-1 text-right">
                  <Link to="/forgot-password" className="text-[12px] font-medium text-gov-700 hover:underline">
                    Forgot password?
                  </Link>
                </div>
              </Field>

              <Button type="submit" loading={busy} className="w-full" size="lg">
                Sign in
              </Button>
            </form>
          </div>

          <p className="mt-6 text-center text-[12.5px] text-slate-500">
            No account yet?{' '}
            <Link to="/register" className="font-medium text-gov-700 hover:underline">
              Register as a beneficiary
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
