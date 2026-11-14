import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import Card from '../components/ui/Card.jsx';
import Table from '../components/ui/Table.jsx';
import Badge from '../components/ui/Badge.jsx';
import Button from '../components/ui/Button.jsx';
import Dialog from '../components/ui/Dialog.jsx';
import { Field, Input, Select } from '../components/ui/Input.jsx';
import { LoadingState, ErrorState, EmptyState, InlineAlert } from '../components/ui/States.jsx';

/**
 * CSWD-authorized account management.
 * Staff accounts are created here in a pending state and must be approved
 * before they can sign in. Public registration never reaches this page.
 */

const ROLE_LABELS = {
  beneficiary: 'Beneficiary',
  barangay_staff: 'Barangay Staff (Tambacan)',
  cswd_staff: 'CSWD Staff'
};
// Role changes are staff-only (Barangay ↔ CSWD). Beneficiary accounts are
// self-registered and fixed — they are displayed read-only and can never be
// promoted to staff from this page.
const STAFF_ROLE_OPTIONS = [
  { value: 'barangay_staff', label: 'Barangay Staff (Tambacan)' },
  { value: 'cswd_staff', label: 'CSWD Staff' }
];

const APPROVAL_TONE = { approved: 'success', pending: 'warning', rejected: 'danger' };

export default function Users() {
  const { user: me } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ email: '', password: '', full_name: '', role: 'barangay_staff' });
  const [createError, setCreateError] = useState(null);
  const [createBusy, setCreateBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api('/users'));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(path, okMessage) {
    setBusyId(path);
    setNotice(null);
    try {
      await api(path, { method: 'POST' });
      setNotice({ level: 'success', text: okMessage });
      await load();
    } catch (err) {
      setNotice({ level: 'error', text: err.message });
    } finally {
      setBusyId(null);
    }
  }

  async function changeRole(userId, role) {
    setBusyId(`role-${userId}`);
    setNotice(null);
    try {
      await api(`/users/${userId}/role`, { method: 'POST', body: { role } });
      setNotice({ level: 'success', text: 'Role updated.' });
      await load();
    } catch (err) {
      setNotice({ level: 'error', text: err.message });
    } finally {
      setBusyId(null);
    }
  }

  async function submitCreate(e) {
    e.preventDefault();
    setCreateError(null);
    setCreateBusy(true);
    try {
      await api('/users', { method: 'POST', body: createForm });
      setCreateOpen(false);
      setCreateForm({ email: '', password: '', full_name: '', role: 'barangay_staff' });
      setNotice({
        level: 'success',
        text: 'Staff account created. It stays pending until you approve it.'
      });
      await load();
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setCreateBusy(false);
    }
  }

  const columns = [
    {
      key: 'full_name',
      header: 'Name',
      render: (r) => (
        <div>
          <p className="font-medium text-navy-900">{r.full_name}</p>
          <p className="text-[12px] text-slate-500">{r.email}</p>
        </div>
      )
    },
    {
      key: 'role',
      header: 'Role',
      render: (r) => (
        r.id === me?.id ? (
          <Badge tone="info">{ROLE_LABELS[r.role] || r.role} (you)</Badge>
        ) : r.role === 'beneficiary' ? (
          <Badge>Beneficiary</Badge>
        ) : (
          <Select
            name={`role-${r.id}`}
            aria-label={`Role for ${r.full_name}`}
            value={r.role}
            disabled={busyId === `role-${r.id}`}
            onChange={(e) => changeRole(r.id, e.target.value)}
            options={STAFF_ROLE_OPTIONS}
            className="w-52"
          />
        )
      )
    },
    {
      key: 'approval_status',
      header: 'Approval',
      render: (r) => (
        <Badge tone={APPROVAL_TONE[r.approval_status] || 'neutral'}>
          {(r.approval_status || 'approved').charAt(0).toUpperCase() + (r.approval_status || 'approved').slice(1)}
        </Badge>
      )
    },
    {
      key: 'is_active',
      header: 'Status',
      render: (r) =>
        r.is_active === false ? <Badge tone="danger">Deactivated</Badge> : <Badge tone="success">Active</Badge>
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (r) => {
        if (r.id === me?.id) return <span className="text-[12.5px] text-slate-400">—</span>;
        // CSWD manages staff accounts only — beneficiary rows are read-only.
        if (r.role === 'beneficiary') return <span className="text-[12.5px] text-slate-400">—</span>;
        const buttons = [];
        if (r.approval_status === 'pending') {
          buttons.push(
            <Button
              key="approve"
              size="sm"
              onClick={() => act(`/users/${r.id}/approve`, 'Account approved.')}
              loading={busyId === `/users/${r.id}/approve`}
            >
              Approve
            </Button>,
            <Button
              key="reject"
              size="sm"
              variant="danger"
              onClick={() => act(`/users/${r.id}/reject`, 'Account rejected.')}
              loading={busyId === `/users/${r.id}/reject`}
            >
              Reject
            </Button>
          );
        } else if (r.approval_status === 'rejected') {
          buttons.push(
            <Button
              key="approve"
              size="sm"
              onClick={() => act(`/users/${r.id}/approve`, 'Account approved.')}
              loading={busyId === `/users/${r.id}/approve`}
            >
              Approve
            </Button>
          );
        }
        if (r.is_active === false) {
          buttons.push(
            <Button
              key="activate"
              size="sm"
              variant="secondary"
              onClick={() => act(`/users/${r.id}/activate`, 'Account re-activated.')}
              loading={busyId === `/users/${r.id}/activate`}
            >
              Re-activate
            </Button>
          );
        } else {
          buttons.push(
            <Button
              key="deactivate"
              size="sm"
              variant="secondary"
              onClick={() => act(`/users/${r.id}/deactivate`, 'Account deactivated.')}
              loading={busyId === `/users/${r.id}/deactivate`}
            >
              Deactivate
            </Button>
          );
        }
        return <div className="flex flex-wrap gap-2">{buttons}</div>;
      }
    }
  ];

  return (
    <>
      <PageHeader
        title="User Management"
        breadcrumbs={[
          { label: 'Home', to: '/dashboard' },
          { label: 'Oversight' },
          { label: 'User Management' }
        ]}
        actions={
          <Button onClick={() => setCreateOpen(true)} disabled={loading}>
            Create staff account
          </Button>
        }
      />

      {notice && (
        <div className="mb-4">
          <InlineAlert level={notice.level}>{notice.text}</InlineAlert>
        </div>
      )}

      <Card
        padded={false}
        title="Accounts"
        subtitle={data ? `${data.total} account(s)` : 'Loading accounts…'}
        actions={
          <Button variant="secondary" onClick={load} disabled={loading}>
            Refresh
          </Button>
        }
      >
        <div className="p-5">
          {loading && <LoadingState label="Loading accounts…" />}

          {!loading && error && (
            <ErrorState title="Could not load accounts" description={error.message} onRetry={load} />
          )}

          {!loading && !error && data && data.users.length === 0 && (
            <EmptyState title="No accounts found" description="No user accounts exist yet." />
          )}

          {!loading && !error && data && data.users.length > 0 && (
            <Table columns={columns} rows={data.users} keyFn={(r) => r.id} emptyState={null} />
          )}
        </div>
      </Card>

      <Dialog
        open={createOpen}
        title="Create staff account"
        description="Creates a Barangay Staff or CSWD Staff account in a pending state. Approve it after review to let the account sign in."
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button form="create-staff-form" type="submit" loading={createBusy}>
              Create account
            </Button>
          </>
        }
      >
        <form id="create-staff-form" onSubmit={submitCreate} className="space-y-4" noValidate>
          {createError && <InlineAlert level="error">{createError}</InlineAlert>}

          <Field label="Full name" htmlFor="create_full_name" required>
            <Input
              id="create_full_name"
              name="full_name"
              required
              value={createForm.full_name}
              onChange={(e) => setCreateForm((f) => ({ ...f, full_name: e.target.value }))}
            />
          </Field>

          <Field label="Email address" htmlFor="create_email" required>
            <Input
              id="create_email"
              name="email"
              type="email"
              required
              value={createForm.email}
              onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
            />
          </Field>

          <Field label="Temporary password" htmlFor="create_password" required hint="At least 8 characters. Hand this over securely; the user can reset it later.">
            <Input
              id="create_password"
              name="password"
              type="password"
              minLength={8}
              required
              value={createForm.password}
              onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
            />
          </Field>

          <Field label="Role" htmlFor="create_role" required>
            <Select
              id="create_role"
              name="role"
              value={createForm.role}
              onChange={(e) => setCreateForm((f) => ({ ...f, role: e.target.value }))}
              options={[
                { value: 'barangay_staff', label: 'Barangay Staff (Tambacan)' },
                { value: 'cswd_staff', label: 'CSWD Staff' }
              ]}
            />
          </Field>
        </form>
      </Dialog>
    </>
  );
}
