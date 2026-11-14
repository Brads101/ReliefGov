import { useCallback, useEffect, useMemo, useState } from 'react';
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
  const [approvedList, setApprovedList] = useState([]);
  const [loadingEligible, setLoadingEligible] = useState(true);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({
    assistance_type: ASSISTANCE_TYPES.length === 1 ? ASSISTANCE_TYPES[0] : '',
    quantity: '1',
    notes: ''
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoadingEligible(true);
      try {
        const res = await api('/beneficiaries?application_status=Approved&limit=100');
        if (active) {
          const list = (res.rows || []).filter((r) => r.application_status === 'Approved');
          setApprovedList(list);
        }
      } catch {
        if (active) setApprovedList([]);
      } finally {
        if (active) setLoadingEligible(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const filteredCandidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return approvedList;
    return approvedList.filter((r) => {
      const name = `${r.first_name || ''} ${r.middle_name || ''} ${r.last_name || ''}`.toLowerCase();
      const num = (r.beneficiary_number || '').toLowerCase();
      const purok = (r.purok || '').toLowerCase();
      return name.includes(q) || num.includes(q) || purok.includes(q);
    });
  }, [approvedList, search]);

  const submit = async () => {
    if (!selected) {
      setError({ message: 'Choose an approved beneficiary from the list first.' });
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

        {!selected ? (
          <div className="space-y-3">
            <Field
              label="Approved Beneficiary"
              htmlFor="dist-beneficiary"
              required
            >
              <div className="relative">
                <Input
                  id="dist-beneficiary"
                  placeholder="Filter by name, reference number (TAM-26...), or purok..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoFocus
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400 hover:text-slate-600"
                  >
                    Clear
                  </button>
                )}
              </div>
            </Field>

            <div className="rounded-xl border border-slate-200/90 bg-white overflow-hidden shadow-2xs">
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-3 py-2 text-xs">
                <span className="font-bold uppercase tracking-wider text-slate-600">
                  Approved Beneficiaries ({filteredCandidates.length} eligible)
                </span>
                <span className="text-[11px] text-slate-400">Click a record to select</span>
              </div>

              {loadingEligible ? (
                <div className="p-6 text-center text-sm text-slate-500">
                  Loading approved applicants…
                </div>
              ) : filteredCandidates.length === 0 ? (
                <div className="p-6 text-center text-sm text-slate-500">
                  {search.trim()
                    ? `No approved applicants match "${search}".`
                    : 'No approved applicants found in Barangay Tambacan.'}
                </div>
              ) : (
                <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto">
                  {filteredCandidates.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        className="group flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-sky-50/70"
                        onClick={() => {
                          setSelected(r);
                          setError(null);
                        }}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[13.5px] font-bold text-navy-950 group-hover:text-gov-700">
                            {fullName(r)}
                          </p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px]">
                            <span className="rounded bg-amber-50 px-1.5 py-0.5 font-mono text-[11px] font-bold text-amber-900 border border-amber-200/80">
                              {r.beneficiary_number}
                            </span>
                            {r.purok && (
                              <span className="text-slate-500">
                                · {r.purok.startsWith('Purok') ? r.purok : `Purok ${r.purok}`}
                              </span>
                            )}
                          </div>
                        </div>
                        <Badge tone="success">Approved</Badge>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3.5 shadow-2xs">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-[11px] text-white font-bold">
                  ✓
                </span>
                <p className="truncate text-sm font-bold text-navy-950">{fullName(selected)}</p>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px]">
                <span className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[11px] font-bold text-amber-900 border border-amber-200">
                  {selected.beneficiary_number}
                </span>
                {selected.purok && (
                  <span className="text-slate-600">
                    {selected.purok.startsWith('Purok') ? selected.purok : `Purok ${selected.purok}`}
                  </span>
                )}
                <Badge tone="success">Approved</Badge>
              </div>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setSelected(null)}
            >
              Change applicant
            </Button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Quantity" htmlFor="dist-qty" required>
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
