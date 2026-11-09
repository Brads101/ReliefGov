import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import PageHeader, { StatCard } from '../components/ui/PageHeader.jsx';
import Card from '../components/ui/Card.jsx';
import Table from '../components/ui/Table.jsx';
import Badge from '../components/ui/Badge.jsx';
import Button from '../components/ui/Button.jsx';
import Dialog from '../components/ui/Dialog.jsx';
import { Field, Input, Select, Textarea } from '../components/ui/Input.jsx';
import DataNotice from '../components/DataNotice.jsx';
import { LoadingState, ErrorState, EmptyState, InlineAlert } from '../components/ui/States.jsx';
import { Icon } from '../config/navigation.jsx';
import {
  DISTRIBUTION_STATUS_META,
  DISTRIBUTION_STATUSES,
  ASSISTANCE_TYPES
} from '../lib/constants.js';

/**
 * Distribution Monitoring (Batch 6) — barangay and CSWD staff only.
 *
 * The single distribution page: it both records and monitors relief
 * distribution, replacing the separate read-only /monitoring view that used
 * to sit beside /distribution.
 *
 * WHAT THIS MODULE IS:
 *  A ledger for recording and monitoring relief distribution in Barangay
 *  Tambacan: which approved beneficiaries are planned to receive which
 *  assistance, who released it, when, and with what notes. Every list,
 *  count and action on this page is scoped to Tambacan by the SERVER; the
 *  client never decides the scope.
 *
 * WHAT IT IS NOT:
 *  It is NOT a payment or cash-transfer system. No cash/financial assistance
 *  type is offered — that is outside the capstone scope — so no money moves
 *  through this application and no payment provider is integrated.
 *
 * WORKFLOW ENFORCED SERVER-SIDE (shown here, never trusted from here):
 *  - Only Approved (eligible, reviewed) records can receive an entry.
 *  - One open (Planned) entry per beneficiary per assistance type; a repeat
 *    attempt answers 409 and is surfaced as an error, never silently added.
 *  - Planned -> Released (attributes the release to the acting staff member
 *    with a timestamp) or Planned -> Cancelled (reason required).
 *  - Released and Cancelled are terminal; every change is audited and the
 *    beneficiary is notified in-system.
 */

const PAGE_SIZE = 25;

const dateFmt = (iso) => (iso ? new Date(iso).toLocaleDateString() : '—');
const dateTimeFmt = (iso) => (iso ? new Date(iso).toLocaleString() : '—');
const fullName = (r) => [r?.first_name, r?.middle_name, r?.last_name].filter(Boolean).join(' ');

export default function Distribution() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);

  // Dialogs
  const [recordOpen, setRecordOpen] = useState(false);
  const [releasing, setReleasing] = useState(null); // distribution row
  const [cancelling, setCancelling] = useState(null); // distribution row

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (status) params.set('status', status);
      if (type) params.set('type', type);
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(offset));
      const [list, sums] = await Promise.all([
        api(`/distributions?${params.toString()}`),
        api('/distributions/summary')
      ]);
      setData(list);
      setSummary(sums);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [search, status, type, offset]);

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load, refreshTick]);

  const clearFilters = () => {
    setSearch('');
    setStatus('');
    setType('');
    setOffset(0);
  };
  const hasFilters = Boolean(search.trim() || status || type);
  const refresh = () => setRefreshTick((t) => t + 1);

  const columns = [
    {
      key: 'beneficiary',
      header: 'Beneficiary',
      render: (d) => (
        <div>
          <p className="font-medium text-navy-900">{d.beneficiary?.full_name || '—'}</p>
          <p className="text-[12px] text-slate-500">
            {d.beneficiary?.beneficiary_number || '—'}
            {d.beneficiary?.purok ? ` · ${d.beneficiary.purok}` : ''}
          </p>
        </div>
      )
    },
    {
      key: 'assistance_type',
      header: 'Assistance',
      render: (d) => (
        <div>
          <p className="text-[13.5px] text-navy-900">{d.assistance_type}</p>
          <p className="text-[12px] text-slate-500">
            Qty {d.quantity}
          </p>
        </div>
      )
    },
    {
      key: 'status',
      header: 'Status',
      render: (d) => (
        <div className="flex flex-col items-start gap-1">
          <Badge tone={DISTRIBUTION_STATUS_META[d.status]?.tone || 'neutral'}>
            {DISTRIBUTION_STATUS_META[d.status]?.label || d.status}
          </Badge>
          <span className="text-[11.5px] text-slate-500">
            {d.status === 'Released'
              ? `Released ${dateFmt(d.distributed_at)}`
              : d.status === 'Cancelled'
                ? 'Cancelled'
                : `Recorded ${dateFmt(d.created_at)}`}
          </span>
        </div>
      )
    },
    {
      key: 'staff',
      header: 'Responsible staff',
      render: (d) => {
        const who = d.status === 'Released' ? d.distributed_by_profile : d.recorded_by_profile;
        return (
          <div className="text-[13px]">
            <p className="text-navy-900">{who?.full_name || '—'}</p>
            <p className="text-slate-500">{d.status === 'Released' ? 'Released by' : 'Recorded by'}</p>
          </div>
        );
      }
    },
    {
      key: 'notes',
      header: 'Notes',
      render: (d) => (
        <p className="max-w-[260px] text-[12.5px] leading-snug text-slate-600">
          {d.status === 'Cancelled' && d.status_reason
            ? `Reason: ${d.status_reason}`
            : d.notes || <span className="text-slate-400">—</span>}
        </p>
      )
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (d) =>
        d.status === 'Planned' ? (
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={() => setReleasing(d)}>
              Mark released
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setCancelling(d)}>
              Cancel
            </Button>
          </div>
        ) : null
    }
  ];

  const rows = data?.distributions || [];
  const canPrev = offset > 0;
  const canNext = data ? offset + rows.length < data.total : false;

  return (
    <>
      <PageHeader
        title="Distribution Monitoring"
        description="Record and monitor relief distribution for eligible, approved records in Barangay Tambacan. A monitoring ledger only — no cash or payment processing."
        breadcrumbs={[
          { label: 'Home', to: '/dashboard' },
          { label: 'Assistance Operations' },
          { label: 'Distribution Monitoring' }
        ]}
        actions={<Button onClick={() => setRecordOpen(true)}>Record distribution</Button>}
      />

      <DataNotice />

      {notice && (
        <div className="mb-4">
          <InlineAlert level={notice.level} title={notice.title || 'Updated'}>{notice.text}</InlineAlert>
        </div>
      )}

      {summary && (
        <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            label="Planned"
            value={summary.by_status?.Planned || 0}
            tone="info"
            hint="Recorded, not yet released"
            icon={<Icon name="package" className="h-5 w-5" />}
          />
          <StatCard
            label="Released"
            value={summary.by_status?.Released || 0}
            tone="success"
            hint="Handed over and attributed"
            icon={<Icon name="shield" className="h-5 w-5" />}
          />
          <StatCard
            label="Eligible records"
            value={summary.eligible_records || 0}
            tone="info"
            hint="Approved Tambacan profiles"
            icon={<Icon name="users" className="h-5 w-5" />}
          />
        </div>
      )}

      <Card
        title="Distribution records"
        subtitle="Barangay Tambacan · newest first"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-44">
              <Select
                aria-label="Filter by status"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setOffset(0);
                }}
                placeholder="All statuses"
                options={DISTRIBUTION_STATUSES.map((s) => ({ value: s, label: s }))}
              />
            </div>
            <div className="w-48">
              <Select
                aria-label="Filter by assistance type"
                value={type}
                onChange={(e) => {
                  setType(e.target.value);
                  setOffset(0);
                }}
                placeholder="All assistance types"
                options={ASSISTANCE_TYPES.map((t) => ({ value: t, label: t }))}
              />
            </div>
            <div className="relative w-56">
              <Input
                aria-label="Search reference or beneficiary"
                placeholder="Search reference or name…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setOffset(0);
                }}
              />
            </div>
            {hasFilters && (
              <Button size="sm" variant="ghost" onClick={clearFilters}>
                Clear
              </Button>
            )}
          </div>
        }
      >
        {error && (
          <div className="mb-4">
            <InlineAlert level="error" title="Could not load distribution records">
              {error.message}
              <button type="button" onClick={refresh} className="ml-2 underline hover:no-underline">
                Try again
              </button>
            </InlineAlert>
          </div>
        )}

        {loading && !data && <LoadingState label="Loading distribution records…" minHeight="min-h-[160px]" />}

        {!error && data && (
          <>
            <Table
              columns={columns}
              rows={rows}
              keyFn={(d) => d.id}
              emptyState={
                <EmptyState
                  title={hasFilters ? 'No records match these filters' : 'No distributions recorded yet'}
                  description={
                    hasFilters
                      ? 'Try clearing the filters or searching a different reference or name.'
                      : 'Use “Record distribution” to log relief assistance for an approved beneficiary. Entries appear here for monitoring until released or cancelled.'
                  }
                  minHeight="min-h-[180px]"
                  action={
                    hasFilters ? (
                      <Button size="sm" variant="secondary" onClick={clearFilters}>
                        Clear filters
                      </Button>
                    ) : (
                      <Button size="sm" onClick={() => setRecordOpen(true)}>Record the first entry</Button>
                    )
                  }
                />
              }
            />

            {rows.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                <p className="text-[13px] tabular-nums text-slate-500">
                  Showing {offset + 1}–{offset + rows.length} of {data.total}
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" disabled={!canPrev} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                    Previous
                  </Button>
                  <Button size="sm" variant="secondary" disabled={!canNext} onClick={() => setOffset(offset + PAGE_SIZE)}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      {recordOpen && (
        <RecordDistributionDialog
          onClose={() => setRecordOpen(false)}
          onRecorded={(message) => {
            setRecordOpen(false);
            setNotice({ level: 'success', title: 'Distribution recorded', text: message });
            refresh();
          }}
        />
      )}

      {releasing && (
        <ReleaseDialog
          distribution={releasing}
          onClose={() => setReleasing(null)}
          onDone={(message) => {
            setReleasing(null);
            setNotice({ level: 'success', title: 'Marked released', text: message });
            refresh();
          }}
        />
      )}

      {cancelling && (
        <CancelDialog
          distribution={cancelling}
          onClose={() => setCancelling(null)}
          onDone={(message) => {
            setCancelling(null);
            setNotice({ level: 'info', title: 'Entry cancelled', text: message });
            refresh();
          }}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Record distribution                                                 */
/* ------------------------------------------------------------------ */

function RecordDistributionDialog({ onClose, onRecorded }) {
  const [search, setSearch] = useState('');
  const [candidates, setCandidates] = useState(null);
  const [picking, setPicking] = useState(true);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({
    assistance_type: ASSISTANCE_TYPES.length === 1 ? ASSISTANCE_TYPES[0] : '',
    quantity: '1',
    notes: ''
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Search the shared registry (server-scoped to Tambacan) and keep only
  // APPROVED rows — the server re-checks eligibility on create regardless.
  useEffect(() => {
    const q = search.trim();
    if (!q) {
      setCandidates(null);
      return undefined;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await api(`/beneficiaries?search=${encodeURIComponent(q)}&limit=8`);
        setCandidates((res.rows || []).filter((r) => r.application_status === 'Approved'));
      } catch {
        setCandidates([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const submit = async () => {
    if (!selected) {
      setError({ message: 'Choose an approved beneficiary first.' });
      return;
    }
    if (!form.assistance_type) {
      setError({ message: 'Choose an assistance type.' });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = {
        beneficiary_id: selected.id,
        assistance_type: form.assistance_type,
        quantity: Number(form.quantity)
      };
      if (form.notes.trim()) body.notes = form.notes.trim();
      const res = await api('/distributions', { method: 'POST', body });
      onRecorded(
        `${res.distribution.assistance_type} recorded for ${res.distribution.beneficiary?.full_name || 'the beneficiary'} (reference ${res.distribution.reference_no}).`
      );
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      title="Record a distribution"
      description="Approved records only · one open entry per assistance type."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            Record distribution
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <InlineAlert level="error" title="Could not record the distribution">
            {error.message}
          </InlineAlert>
        )}

        {picking && !selected && (
          <Field
            label="Beneficiary"
            htmlFor="dist-beneficiary"
            required
            hint="Search by name or number — approved records only."
          >
            <Input
              id="dist-beneficiary"
              placeholder="e.g. Dela Cruz or TAM-26…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
            {search.trim() && candidates && (
              <div className="mt-2 max-h-52 overflow-y-auto rounded-md border border-line">
                {candidates.length === 0 ? (
                  <p className="p-3 text-[13px] text-slate-500">
                    No approved records match this search. Only Approved applications can receive distribution.
                  </p>
                ) : (
                  <ul className="divide-y divide-line">
                    {candidates.map((r) => (
                      <li key={r.id}>
                        <button
                          type="button"
                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-surface-muted"
                          onClick={() => {
                            setSelected(r);
                            setPicking(false);
                          }}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-[13.5px] font-medium text-navy-900">
                              {fullName(r)}
                            </span>
                            <span className="block text-[12px] text-slate-500">
                              {r.beneficiary_number}
                              {r.purok ? ` · ${r.purok}` : ''}
                            </span>
                          </span>
                          <Badge tone="success">Approved</Badge>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Field>
        )}

        {selected && (
          <div className="flex items-center justify-between gap-3 rounded-md bg-surface-muted p-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-navy-900">{fullName(selected)}</p>
              <p className="text-[12px] text-slate-500">
                {selected.beneficiary_number}
                {selected.purok ? ` · ${selected.purok}` : ''}
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSelected(null);
                setPicking(true);
              }}
            >
              Change
            </Button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Quantity" htmlFor="dist-qty" required hint="1–10,000 units.">
            <Input
              id="dist-qty"
              type="number"
              min="1"
              max="10000"
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
            />
          </Field>
          {ASSISTANCE_TYPES.length === 1 ? (
            <Field label="Assistance type">
              <span className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-3.5 py-2 text-[13px] font-semibold text-teal-800">
                <span className="h-1.5 w-1.5 rounded-full bg-teal-500" aria-hidden="true" />
                {ASSISTANCE_TYPES[0]}
              </span>
            </Field>
          ) : (
            <Field label="Assistance type" htmlFor="dist-type" required>
              <Select
                id="dist-type"
                value={form.assistance_type}
                onChange={(e) => setForm({ ...form, assistance_type: e.target.value })}
                placeholder="Choose an assistance type…"
                options={ASSISTANCE_TYPES.map((t) => ({ value: t, label: t }))}
              />
            </Field>
          )}
        </div>

        <Field label="Notes (optional)" htmlFor="dist-notes">
          <Textarea
            id="dist-notes"
            rows={2}
            maxLength={500}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="e.g. Family of six; food pack for one week."
          />
        </Field>

        <p className="text-[12.5px] leading-relaxed text-slate-500">
          Entries start as <span className="font-semibold text-navy-800">Planned</span> — mark released
          or cancel from the record row.
        </p>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Release / cancel transitions                                        */
/* ------------------------------------------------------------------ */

function ReleaseDialog({ distribution, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api(`/distributions/${distribution.id}/status`, {
        method: 'POST',
        body: { to_status: 'Released' }
      });
      onDone(
        `${res.distribution.assistance_type} released to ${res.distribution.beneficiary?.full_name || 'the beneficiary'} and attributed to you.`
      );
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      title="Mark as released"
      description="Confirms the assistance was handed over. The release is attributed to your account with a timestamp."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Keep as planned
          </Button>
          <Button onClick={confirm} loading={busy}>
            Confirm release
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {error && (
          <InlineAlert level="error" title="Could not release this entry">
            {error.message}
          </InlineAlert>
        )}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
          <div>
            <dt className="text-slate-500">Beneficiary</dt>
            <dd className="font-medium text-navy-900">{distribution.beneficiary?.full_name || '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Assistance</dt>
            <dd className="font-medium text-navy-900">
              {distribution.assistance_type} · Qty {distribution.quantity}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Reference</dt>
            <dd className="font-medium tabular-nums text-navy-900">{distribution.reference_no}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Recorded</dt>
            <dd className="font-medium text-navy-900">{dateTimeFmt(distribution.created_at)}</dd>
          </div>
        </dl>
        <InlineAlert level="info">
          This cannot be undone — a released entry is terminal and stays in the record for audit.
        </InlineAlert>
      </div>
    </Dialog>
  );
}

function CancelDialog({ distribution, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const confirm = async () => {
    if (reason.trim().length < 5) {
      setError({ message: 'Give a brief reason (at least 5 characters).' });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/distributions/${distribution.id}/status`, {
        method: 'POST',
        body: { to_status: 'Cancelled', reason: reason.trim() }
      });
      onDone(`The ${distribution.assistance_type.toLowerCase()} entry (${distribution.reference_no}) was cancelled with your reason recorded.`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      title="Cancel this entry"
      description="A documented reason is required and is kept with the record."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Keep as planned
          </Button>
          <Button variant="danger" onClick={confirm} loading={busy}>
            Cancel entry
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <InlineAlert level="error" title="Could not cancel this entry">
            {error.message}
          </InlineAlert>
        )}
        <p className="text-[13px] text-navy-800">
          {distribution.assistance_type} · Qty {distribution.quantity} · {distribution.beneficiary?.full_name} ·{' '}
          {distribution.reference_no}
        </p>
        <Field label="Reason" htmlFor="cancel-reason" required hint="At least 5 characters; recorded with the entry.">
          <Textarea
            id="cancel-reason"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Assistance released directly by another office."
            autoFocus
          />
        </Field>
      </div>
    </Dialog>
  );
}
