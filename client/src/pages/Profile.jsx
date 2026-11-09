import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/api.js';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import Button from '../components/ui/Button.jsx';
import { Field, Input } from '../components/ui/Input.jsx';
import { InlineAlert } from '../components/ui/States.jsx';
import { ROLE_LABELS } from '../config/navigation.jsx';

/**
 * Self-service account profile (all roles). The display name is the only
 * editable field — email, role, barangay, and approval state are managed by
 * the system and the CSWD Office. Password changes go through the existing
 * email reset flow so authentication itself stays untouched.
 */
export default function Profile() {
  const { user, reload } = useAuth();
  const [fullName, setFullName] = useState(user?.full_name || '');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaved(false);
    setError(null);
    const trimmed = fullName.trim();
    if (!trimmed || trimmed === user?.full_name) return;
    setBusy(true);
    try {
      await api('/auth/me', { method: 'PATCH', body: { full_name: trimmed } });
      await reload(); // refresh the session profile (sidebar, welcome header, cache)
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const roleLabel = ROLE_LABELS[user?.role] || user?.role || '—';
  const unchanged = !fullName.trim() || fullName.trim() === user?.full_name;

  return (
    <div>
      <PageHeader
        title="Manage Profile"
        description="Update the name shown on your account. Your email address is your sign-in ID and cannot be changed here."
      />

      <div className="grid max-w-3xl gap-5">
        <section className="rg-card p-6">
          <h2 className="text-[15px] font-semibold text-navy-900">Profile details</h2>
          <p className="mt-1 text-[13px] text-slate-500">
            Barangay Tambacan, Iligan City · managed with CSWD Office oversight
          </p>

          {saved && (
            <div className="mt-4">
              <InlineAlert level="success" title="Profile updated">
                Your changes have been saved.
              </InlineAlert>
            </div>
          )}
          {error && (
            <div className="mt-4">
              <InlineAlert level="error">{error}</InlineAlert>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
            <Field label="Full name" htmlFor="full_name" required>
              <Input
                id="full_name"
                name="full_name"
                type="text"
                required
                minLength={2}
                maxLength={100}
                autoComplete="name"
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  setSaved(false);
                }}
                placeholder="Your full name"
              />
            </Field>

            <Field label="Email address" htmlFor="email">
              <Input
                id="email"
                name="email"
                type="email"
                value={user?.email || ''}
                readOnly
                disabled
                title="Your email address is your sign-in ID and cannot be changed here."
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-[12.5px] font-medium text-navy-800">Role</p>
                <p className="mt-1 text-[13.5px] text-slate-600">{roleLabel}</p>
              </div>
              <div>
                <p className="text-[12.5px] font-medium text-navy-800">Barangay</p>
                <p className="mt-1 text-[13.5px] text-slate-600">
                  {user?.barangay ? `${user.barangay}, Iligan City` : '—'}
                </p>
              </div>
            </div>

            <div className="pt-1">
              <Button type="submit" loading={busy} disabled={unchanged}>
                Save changes
              </Button>
            </div>
          </form>
        </section>

        <section className="rg-card p-6">
          <h2 className="text-[15px] font-semibold text-navy-900">Password</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
            For your security, the password is changed through a reset link sent to your
            registered email address.
          </p>
          <div className="mt-4">
            <Link
              to="/forgot-password"
              className="inline-flex items-center rounded-md border border-line-strong bg-white px-3.5 py-2 text-[13px] font-medium text-navy-700 hover:bg-surface-muted"
            >
              Send password reset email
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
