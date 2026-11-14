import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { ROLE_LABELS } from '../config/navigation.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import Card from '../components/ui/Card.jsx';
import Table from '../components/ui/Table.jsx';
import Badge from '../components/ui/Badge.jsx';
import Button from '../components/ui/Button.jsx';
import Dialog from '../components/ui/Dialog.jsx';
import { Field, Input, Select, Textarea } from '../components/ui/Input.jsx';
import DataNotice from '../components/DataNotice.jsx';
import { LoadingState, ErrorState, EmptyState, InlineAlert } from '../components/ui/States.jsx';
import { formatBytes, getDocumentUrl } from '../lib/documents.js';
import {
  STATUS_META,
  VALIDATION_STATUS_META,
  CONFIDENCE_META,
  FLAG_DECISIONS,
  PUROK_OPTIONS,
  isFloodPronePurok,
  incomeLevelLabel,
  damageExtentLabel,
  vulnerabilityClassMeta,
  vulnerabilityClassLabel,
  documentPurposeLabel
} from '../lib/constants.js';

/**
 * Data Validation & Duplicate Detection (Batch 4) — barangay and CSWD staff
 * only. Everything on this page comes from the server already scoped to
 * Barangay Tambacan; nothing here can widen that scope.
 *
 *  * Validation queue — search and filter submitted records, open the full
 *    review bundle (profile, documents, timeline, duplicate flags).
 *  * Review actions — start verification, return for correction, and (CSWD)
 *    approve or reject, with reasons and internal remarks recorded. The
 *    Approve/Reject buttons are server-gated (CSWD-only, "Under Verification"
 *    only); whenever they are unavailable the detail view states WHY and what
 *    the next step is, instead of silently showing no actions.
 *  * Duplicate flags — evidence-first flags with confirm / dismiss / request
 *    information decisions. Confirming never deletes a record or rejects an
 *    application automatically.
 */

const QUEUE_STATUSES = ['Pending', 'Under Verification', 'Needs Correction', 'Approved', 'Rejected'];

const FLAG_STATUS_META = {
  Flagged: { label: 'Open flag', tone: 'danger' },
  Cleared: { label: 'Dismissed', tone: 'neutral' },
  Confirmed: { label: 'Confirmed duplicate', tone: 'danger' }
};

const STAGE_LABEL = {
  barangay_verification: 'Barangay verification',
  cswd_review: 'CSWD review'
};

const ACTOR_LABEL = {
  beneficiary: 'Applicant',
  barangay_staff: 'Barangay Staff',
  cswd_staff: 'CSWD Staff'
};

/** Dialog copy per workflow decision. reason = applicant-facing, required. */
const TRANSITION_UI = {
  'Under Verification': {
    title: 'Verify & endorse application to CSWD',
    description: 'Certifies that the applicant’s residency and documents have been verified by the Barangay office and endorses the profile to CSWD for final approval.',
    confirmLabel: 'Verify and endorse to CSWD',
    remarksLabel: 'Verification remarks (optional)',
    remarksHint: 'Internal office remarks on document checks, residency confirmation, or field findings.'
  },
  'Needs Correction': {
    title: 'Return record for correction',
    description: 'The record goes back to the applicant with your reason. They can edit and resubmit it.',
    confirmLabel: 'Return for correction',
    reasonLabel: 'What must the applicant correct?',
    reasonHint: 'The applicant will see this reason (at least 5 characters).',
    remarksLabel: 'Internal remarks (optional)'
  },
  Approved: {
    title: 'Approve application (final decision)',
    description: 'CSWD final decision. The record enters the assistance roster and the applicant is notified.',
    confirmLabel: 'Approve application',
    remarksLabel: 'Final review remarks (optional)',
    remarksHint: 'Internal office remarks — kept with the record for audit.'
  },
  Rejected: {
    title: 'Reject application (final decision)',
    description: 'CSWD final decision. The applicant is notified of the reason below.',
    confirmLabel: 'Reject application',
    reasonLabel: 'Reason for rejection',
    reasonHint: 'The applicant will see this reason (at least 5 characters).',
    remarksLabel: 'Internal remarks (optional)'
  }
};

const fullName = (r) =>
  [r?.first_name, r?.middle_name, r?.last_name].filter(Boolean).join(' ') || '—';

const dateFmt = (iso) => (iso ? new Date(iso).toLocaleDateString() : '—');
const dateTimeFmt = (iso) => (iso ? new Date(iso).toLocaleString() : '—');

function StatusBadge({ meta, value }) {
  const m = meta?.[value];
  return <Badge tone={m?.tone || 'neutral'}>{m?.label || value || '—'}</Badge>;
}

function ErrorText({ error }) {
  if (!error) return null;
  return (
    <div className="mb-4">
      <InlineAlert level="error" title={error.status ? `Request failed (${error.status})` : 'Request failed'}>
        {error.message}
      </InlineAlert>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Validation queue                                                    */
/* ------------------------------------------------------------------ */

function QueueTab({ onSelect }) {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get('search') || '');
  const [status, setStatus] = useState(() => searchParams.get('status') || '');
  const [purok, setPurok] = useState(() => searchParams.get('purok') || '');
  const [from, setFrom] = useState(() => searchParams.get('from') || '');
  const [to, setTo] = useState(() => searchParams.get('to') || '');
  const [activePreset, setActivePreset] = useState('all');
  const [groupByDate, setGroupByDate] = useState(true);
  const [flaggedOnly, setFlaggedOnly] = useState(() => searchParams.get('flaggedOnly') === 'true' || searchParams.get('duplicate') === 'flagged');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const s = searchParams.get('status');
    if (s !== null) setStatus(s);
    if (searchParams.has('flaggedOnly') || searchParams.has('duplicate')) {
      setFlaggedOnly(searchParams.get('flaggedOnly') === 'true' || searchParams.get('duplicate') === 'flagged');
    }
  }, [searchParams]);

  const applyPreset = (preset) => {
    setActivePreset(preset);
    const now = new Date();
    const toLocalIso = (d) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    if (preset === 'today') {
      const todayStr = toLocalIso(now);
      setFrom(todayStr);
      setTo(todayStr);
    } else if (preset === 'week') {
      const dayOfWeek = now.getDay();
      const diffToMonday = (dayOfWeek + 6) % 7;
      const monday = new Date(now);
      monday.setDate(now.getDate() - diffToMonday);
      setFrom(toLocalIso(monday));
      setTo(toLocalIso(now));
    } else if (preset === 'month') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      setFrom(toLocalIso(firstDay));
      setTo(toLocalIso(now));
    } else {
      setFrom('');
      setTo('');
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (status) params.set('status', status);
      if (purok) params.set('purok', purok);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (flaggedOnly) params.set('duplicate', 'flagged');
      params.set('limit', '100');
      setData(await api(`/validation/queue?${params.toString()}`));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [search, status, purok, from, to, flaggedOnly]);

  // Debounced reload whenever a filter changes.
  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  const clearFilters = () => {
    setSearch('');
    setStatus('');
    setPurok('');
    setFrom('');
    setTo('');
    setActivePreset('all');
    setFlaggedOnly(false);
  };

  const hasFilters = Boolean(search || status || purok || from || to || flaggedOnly);

  const sortedRows = useMemo(() => {
    if (!data?.rows?.length) return [];
    return [...data.rows].sort((a, b) => {
      const timeA = a.submitted_at ? new Date(a.submitted_at).getTime() : 0;
      const timeB = b.submitted_at ? new Date(b.submitted_at).getTime() : 0;
      return timeB - timeA;
    });
  }, [data?.rows]);

  const dateGroups = useMemo(() => {
    if (!sortedRows.length) return [];
    const groups = [];
    const map = new Map();

    const now = new Date();
    const isSameDay = (d1, d2) =>
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate();

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);

    for (const row of sortedRows) {
      let key = 'no-date';
      let label = 'No submission date';
      let isToday = false;
      let isYesterday = false;

      if (row.submitted_at) {
        const d = new Date(row.submitted_at);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        key = `${year}-${month}-${day}`;

        if (isSameDay(d, now)) {
          isToday = true;
          label = `Today — ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
        } else if (isSameDay(d, yesterday)) {
          isYesterday = true;
          label = `Yesterday — ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
        } else {
          label = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
        }
      }

      if (!map.has(key)) {
        const g = { key, label, isToday, isYesterday, rows: [] };
        map.set(key, g);
        groups.push(g);
      }
      map.get(key).rows.push(row);
    }

    groups.sort((a, b) => {
      if (a.key === 'no-date') return 1;
      if (b.key === 'no-date') return -1;
      return b.key.localeCompare(a.key);
    });

    return groups;
  }, [sortedRows]);

  const columns = [
    {
      key: 'beneficiary_number',
      header: 'Reference',
      render: (r) => <span className="font-mono text-[12.5px] text-navy-700">{r.beneficiary_number}</span>
    },
    { key: 'name', header: 'Name', render: (r) => <span className="font-medium">{fullName(r)}</span> },
    { key: 'purok', header: 'Purok' },
    {
      key: 'application_status',
      header: 'Status',
      render: (r) => <StatusBadge meta={STATUS_META} value={r.application_status} />
    },
    {
      key: 'validation_status',
      header: 'Validation',
      render: (r) => <StatusBadge meta={VALIDATION_STATUS_META} value={r.validation_status} />
    },
    {
      key: 'submitted_at',
      header: 'Submitted',
      render: (r) => <span className="whitespace-nowrap">{dateFmt(r.submitted_at)}</span>
    },
    {
      key: 'duplicate_flagged',
      header: 'Duplicate',
      render: (r) =>
        r.duplicate_flagged ? (
          <Badge tone="danger">Flagged</Badge>
        ) : (
          <span className="text-slate-400">—</span>
        )
    },
    {
      key: 'vulnerability_class',
      header: 'Vulnerability',
      render: (r) =>
        r.vulnerability_class ? (
          <Badge tone={vulnerabilityClassMeta(r.vulnerability_class)?.tone || 'info'}>
            {vulnerabilityClassLabel(r.vulnerability_class)}
          </Badge>
        ) : (
          <span className="text-slate-400">—</span>
        )
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        <Button size="sm" variant="secondary" onClick={() => onSelect(r)}>
          Review
        </Button>
      )
    }
  ];

  return (
    <Card
      title="Validation queue"
      actions={
        data && (
          <span className="text-[13px] tabular-nums text-slate-500">
            {data.total} record{data.total === 1 ? '' : 's'}
          </span>
        )
      }
    >
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="sm:col-span-2 lg:col-span-2">
          <Field label="Search" htmlFor="queue-search">
            <Input
              id="queue-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="e.g. Dela Cruz or TAM-…"
            />
          </Field>
        </div>
        <Field label="Status" htmlFor="queue-status">
          <Select
            id="queue-status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            placeholder="All statuses"
            options={QUEUE_STATUSES.map((s) => ({ value: s, label: s }))}
          />
        </Field>
        <Field label="Purok" htmlFor="queue-purok">
          <Select
            id="queue-purok"
            value={purok}
            onChange={(e) => setPurok(e.target.value)}
            placeholder="All puroks"
            options={PUROK_OPTIONS.map((p) => ({ value: p, label: p }))}
          />
        </Field>
        <div className="flex items-end gap-3 pb-1">
          {user?.role === 'cswd_staff' && (
            <label className="flex cursor-pointer items-center gap-2 text-[13px] text-navy-800">
              <input
                type="checkbox"
                checked={flaggedOnly}
                onChange={(e) => setFlaggedOnly(e.target.checked)}
                className="h-4 w-4 rounded border-line-strong text-gov-700 focus:ring-gov-600"
              />
              Flagged only
            </label>
          )}
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* Quick date batch selection & grouping */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-slate-200/90 bg-slate-50/80 px-3.5 py-2">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="font-semibold text-slate-600 mr-1">Quick date batch:</span>
          {[
            { id: 'all', label: 'All' },
            { id: 'today', label: 'Today' },
            { id: 'week', label: 'This Week' },
            { id: 'month', label: 'This Month' }
          ].map((p) => {
            const active = activePreset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p.id)}
                className={`rounded-full px-3 py-1 font-semibold transition-all ${
                  active
                    ? 'bg-gov-700 text-white shadow-xs'
                    : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700 select-none">
          <input
            type="checkbox"
            checked={groupByDate}
            onChange={(e) => setGroupByDate(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300 text-gov-700 focus:ring-gov-600"
          />
          Group by submission date
        </label>
      </div>

      <ErrorText error={error} />

      {loading && !data && <LoadingState label="Loading the validation queue…" />}

      {!loading && error && !data && (
        <ErrorState title="Could not load the queue" description={error.message} onRetry={load} />
      )}

      {data && !loading && (
        <>
          {data.rows.length === 0 ? (
            <EmptyState
              title={hasFilters ? 'No records match these filters' : 'The queue is clear'}
              description={
                hasFilters
                  ? 'Try widening the filters, or clear them to see every submitted record.'
                  : 'New submissions appear here as soon as applicants submit their forms.'
              }
              minHeight="min-h-[180px]"
              action={
                hasFilters ? (
                  <Button variant="secondary" size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          ) : groupByDate ? (
            <div className="space-y-4">
              {dateGroups.map((group) => (
                <div key={group.key} className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 bg-slate-50/90 px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded bg-gov-100 text-[11px] text-gov-800">
                        📅
                      </span>
                      <span className="text-[13px] font-bold text-slate-900">{group.label}</span>
                      {group.isToday && (
                        <Badge tone="success" className="px-2 py-0 text-[10.5px]">Today's Batch</Badge>
                      )}
                      {group.isYesterday && (
                        <Badge tone="info" className="px-2 py-0 text-[10.5px]">Yesterday</Badge>
                      )}
                    </div>
                    <span className="text-[12px] font-semibold text-slate-500">
                      {group.rows.length} application{group.rows.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <Table columns={columns} rows={group.rows} keyFn={(r) => r.id} />
                </div>
              ))}
            </div>
          ) : (
            <Table
              columns={columns}
              rows={sortedRows}
              keyFn={(r) => r.id}
            />
          )}
        </>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Duplicate flags                                                     */
/* ------------------------------------------------------------------ */

function EvidenceList({ evidence }) {
  const matches = (evidence || []).filter((item) => !item.toLowerCase().includes('differ'));
  if (!matches.length) return <span className="text-slate-400">No matching fields</span>;
  return (
    <ul className="list-disc space-y-0.5 pl-4 text-[13px] text-navy-800">
      {matches.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

function DuplicatesTab({ onOpen }) {
  const [segment, setSegment] = useState('open'); // open | history
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rescanning, setRescanning] = useState(false);
  const [rescanFeedback, setRescanFeedback] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (segment === 'open') {
        const res = await api('/validation/duplicates?status=Flagged&limit=100');
        setData({ rows: res.flags, total: res.total });
      } else {
        const [cleared, confirmed] = await Promise.all([
          api('/validation/duplicates?status=Cleared&limit=100'),
          api('/validation/duplicates?status=Confirmed&limit=100')
        ]);
        const rows = [...cleared.flags, ...confirmed.flags].sort(
          (a, b) => new Date(b.reviewed_at || b.updated_at || 0) - new Date(a.reviewed_at || a.updated_at || 0)
        );
        setData({ rows, total: rows.length });
      }
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [segment]);

  const handleRescanAll = async () => {
    setRescanning(true);
    setRescanFeedback(null);
    try {
      const res = await api('/validation/rescan-all', { method: 'POST' });
      setRescanFeedback({
        tone: 'success',
        message: `Duplicate scan complete. Analyzed ${res.totalRecords || 0} applications (${res.compared || 0} pair comparisons), found ${res.created || 0} new duplicate flag(s).`
      });
      load();
    } catch (err) {
      setRescanFeedback({
        tone: 'error',
        message: err.message || 'Failed to complete duplicate scan.'
      });
    } finally {
      setRescanning(false);
    }
  };

  useEffect(() => {
    load();
  }, [load]);

  const columns = [
    {
      key: 'flagged_record',
      header: 'Flagged record',
      render: (f) => (
        <div>
          <p className="font-medium">{fullName(f.flagged_record)}</p>
          <p className="font-mono text-[12px] text-slate-500">{f.flagged_record?.beneficiary_number || '—'}</p>
        </div>
      )
    },
    {
      key: 'candidate_record',
      header: 'Possible original',
      render: (f) => (
        <div>
          <p className="font-medium">{fullName(f.candidate_record)}</p>
          <p className="font-mono text-[12px] text-slate-500">{f.candidate_record?.beneficiary_number || '—'}</p>
        </div>
      )
    },
    {
      key: 'confidence',
      header: 'Confidence',
      render: (f) => (
        <div className="space-y-1">
          <StatusBadge meta={CONFIDENCE_META} value={f.confidence} />
          {f.similarity_score != null && (
            <p className="text-[12px] tabular-nums text-slate-500">{Math.round(Number(f.similarity_score) * 100)}% match</p>
          )}
        </div>
      )
    },
    {
      key: 'evidence',
      header: 'Why it was flagged',
      render: (f) => <EvidenceList evidence={f.match_details?.evidence} />
    },
    {
      key: 'decision',
      header: 'Decision',
      render: (f) =>
        f.status === 'Flagged' ? (
          <Badge tone="warning">Awaiting review</Badge>
        ) : (
          <div className="text-[12.5px] text-slate-600">
            <p>
              {f.decision === 'confirm' ? 'Confirmed' : f.decision === 'dismiss' ? 'Dismissed' : 'Info requested'}
              {' by '}
              {f.reviewer?.full_name || 'staff'} ({ACTOR_LABEL[f.reviewer?.role] || f.reviewer?.role || 'staff'})
            </p>
            <p className="text-slate-400">{dateTimeFmt(f.reviewed_at)}</p>
          </div>
        )
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (f) => (
        <Button size="sm" variant="secondary" onClick={() => onOpen(f.beneficiary_id, 'duplicates')}>
          Review
        </Button>
      )
    }
  ];

  return (
    <Card
      title="Duplicate flags"
      subtitle="Normalized name, birth date, mobile, purok and family-size comparisons — a name match alone is never proof"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={handleRescanAll}
            loading={rescanning}
            title="Scan all submitted records in Barangay Tambacan for potential duplicates"
          >
            Run duplicate scan
          </Button>
          <div className="flex rounded-lg border border-slate-200/90 bg-slate-100/80 p-0.5 shadow-inner">
            <button
              type="button"
              onClick={() => setSegment('open')}
              className={`rounded-md px-3.5 py-1 text-[13px] font-semibold transition-all ${
                segment === 'open' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              Open flags
            </button>
            <button
              type="button"
              onClick={() => setSegment('history')}
              className={`rounded-md px-3.5 py-1 text-[13px] font-semibold transition-all ${
                segment === 'history' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              Decision history
            </button>
          </div>
        </div>
      }
    >
      {rescanFeedback && (
        <div
          className={`mb-3 flex items-center justify-between rounded-md p-3 text-xs ${
            rescanFeedback.tone === 'success'
              ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border border-rose-200 bg-rose-50 text-rose-800'
          }`}
        >
          <span>{rescanFeedback.message}</span>
          <button
            type="button"
            onClick={() => setRescanFeedback(null)}
            className="ml-2 font-bold hover:opacity-75"
          >
            ✕
          </button>
        </div>
      )}

      <ErrorText error={error} />

      {loading && !data && <LoadingState label="Loading duplicate flags…" />}

      {!loading && error && !data && (
        <ErrorState title="Could not load flags" description={error.message} onRetry={load} />
      )}

      {data && !loading && (
        <Table
          columns={columns}
          rows={data.rows}
          keyFn={(f) => f.id}
          emptyState={
            <EmptyState
              title={segment === 'open' ? 'No open duplicate flags' : 'No decisions recorded yet'}
              description={
                segment === 'open'
                  ? 'Every submitted record has been compared; nothing is waiting on a reviewer right now.'
                  : 'Confirm, dismiss, or request-information decisions will be listed here with reviewer and timestamp.'
              }
              minHeight="min-h-[180px]"
            />
          }
        />
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Record detail & review                                              */
/* ------------------------------------------------------------------ */

function DefinitionRows({ rows }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-[12px] uppercase tracking-wide text-slate-500">{label}</dt>
          <dd className="text-sm text-navy-900">{value ?? <span className="text-slate-400">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

function Detail({ id, initialTab, onBack, onChanged }) {
  const { user } = useAuth();
  const [bundle, setBundle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState(initialTab || 'profile');
  const [notice, setNotice] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Dialog state: { kind: 'transition', to_status } | { kind: 'decision', flag } | { kind: 'doc', doc, status }
  const [dialog, setDialog] = useState(null);
  const [reason, setReason] = useState('');
  const [remarks, setRemarks] = useState('');
  const [notes, setNotes] = useState('');
  const [decisionAction, setDecisionAction] = useState('dismiss');
  const [dialogError, setDialogError] = useState(null);

  // Document preview state
  const [previewDoc, setPreviewDoc] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState(null);

  const isImageDoc = (doc) => {
    if (!doc) return false;
    const mime = String(doc.mime_type || '').toLowerCase();
    if (mime.startsWith('image/')) return true;
    const name = String(doc.file_name || '').toLowerCase();
    return /\.(jpe?g|png|jfif|webp|gif|bmp)$/i.test(name);
  };

  const isPdfDoc = (doc) => {
    if (!doc) return false;
    const mime = String(doc.mime_type || '').toLowerCase();
    if (mime === 'application/pdf') return true;
    return String(doc.file_name || '').toLowerCase().endsWith('.pdf');
  };

  const openPreview = async (doc) => {
    setPreviewDoc(doc);
    setPreviewUrl(null);
    setPreviewError(null);
    setLoadingPreview(true);
    try {
      const res = await getDocumentUrl(doc.id, { inline: true });
      setPreviewUrl(res.url);
    } catch (err) {
      setPreviewError(err?.message || 'Could not load document preview.');
    } finally {
      setLoadingPreview(false);
    }
  };

  const closePreview = () => {
    setPreviewDoc(null);
    setPreviewUrl(null);
    setPreviewError(null);
    setLoadingPreview(false);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setBundle(await api(`/validation/${id}`));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const closeDialog = () => {
    setDialog(null);
    setDialogError(null);
    setReason('');
    setRemarks('');
    setNotes('');
    setDecisionAction('dismiss');
  };

  const refresh = async (message) => {
    setNotice({ level: 'success', text: message });
    setActionError(null);
    await load();
    onChanged?.();
  };

  const run = async (fn, successMessage) => {
    setBusy(true);
    setDialogError(null);
    setActionError(null);
    try {
      await fn();
      closeDialog();
      await refresh(successMessage);
    } catch (err) {
      if (dialog) setDialogError(err);
      else setActionError(err);
    } finally {
      setBusy(false);
    }
  };

  const openTransition = (toStatus) => {
    setReason('');
    setRemarks('');
    setDialog({ kind: 'transition', to_status: toStatus });
  };

  const submitTransition = () => {
    const ui = TRANSITION_UI[dialog.to_status];
    if (ui.reasonLabel && reason.trim().length < 5) {
      setDialogError({ message: 'A clear reason is required (at least 5 characters).' });
      return;
    }
    const body = { to_status: dialog.to_status };
    if (reason.trim()) body.reason = reason.trim();
    if (remarks.trim()) body.remarks = remarks.trim();
    run(() => api(`/applications/${id}/transition`, { method: 'POST', body }), `Record moved to “${dialog.to_status}”.`);
  };

  const openDecision = (flag, preset) => {
    setNotes('');
    setDecisionAction(preset || 'dismiss');
    setDialog({ kind: 'decision', flag });
  };

  const submitDecision = () => {
    if (notes.trim().length < 5) {
      setDialogError({ message: 'Please write a short note explaining the decision (at least 5 characters).' });
      return;
    }
    const chosen = decisionAction;
    const messages = {
      confirm: 'Duplicate confirmed — records linked for the file. The application status is unchanged.',
      dismiss: 'Flag dismissed — this pair will not be flagged again automatically.',
      request_info: 'Information requested — the applicant has been notified and the flag stays open.'
    };
    run(
      () => api(`/validation/flags/${dialog.flag.id}`, { method: 'POST', body: { action: chosen, notes: notes.trim() } }),
      messages[chosen]
    );
  };

  const submitDocStatus = () => {
    const { doc, status } = dialog;
    if (status === 'Rejected' && reason.trim().length < 5) {
      setDialogError({ message: 'A reason is required when rejecting a document (at least 5 characters).' });
      return;
    }
    const body = { status };
    if (reason.trim()) body.reason = reason.trim();
    const successMsg = status === 'Rejected'
      ? 'Document rejected and application automatically returned to beneficiary for corrections.'
      : 'Document marked as accepted.';
    run(() => api(`/documents/${doc.id}/status`, { method: 'PATCH', body }), successMsg);
  };

  const runRescan = () => {
    run(async () => {
      const res = await api(`/validation/${id}/rescan`, { method: 'POST' });
      setNotice({
        level: 'success',
        text:
          res.created > 0
            ? `Scan complete — ${res.created} new flag(s) from ${res.compared} comparison(s).`
            : `Scan complete — ${res.compared} record(s) compared, no new flags.`
      });
    }, null);
  };

  if (loading) return <LoadingState label="Loading the record for review…" />;
  if (error) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Back to queue
        </Button>
        <ErrorState title="Could not load this record" description={error.message} onRetry={load} />
      </div>
    );
  }

  const { application: app, applicant, documents, history, reviews, flags, capabilities } = bundle;
  const openFlags = flags.filter((f) => f.status === 'Flagged');

  /**
   * Explain WHY Approve/Reject are (not) shown — the action bar must never
   * leave staff guessing "where do I approve?". Derived from the same
   * server-provided capabilities that gate the buttons themselves, so the
   * hint can never contradict the real permissions. Nothing here grants or
   * widens any action; it only describes them.
   */
  const decisionHint = (() => {
    if (capabilities.canApprove) return null; // buttons visible — no explanation needed
    const decided = [...history]
      .reverse()
      .find((h) => h.to_status === app.application_status);
    const decidedWhen = decided
      ? `${ACTOR_LABEL[decided.actor_role] || decided.actor_role} · ${dateTimeFmt(decided.created_at)}`
      : 'recorded in the Timeline tab';
    switch (app.application_status) {
      case 'Approved':
        return {
          lead: 'Final decision recorded.',
          text: `Approved (${decidedWhen}). No further status action is available on this record — it now appears in the distribution roster as an eligible record.`
        };
      case 'Rejected':
        return {
          lead: 'Final decision recorded.',
          text: `Rejected (${decidedWhen}). No further status action is available on this record.`
        };
      case 'Draft':
        return {
          lead: 'Waiting on the applicant.',
          text: 'This record has not been submitted yet. Staff actions — including approval — begin once it is submitted.'
        };
      case 'Pending':
        return user?.role === 'cswd_staff'
          ? {
              lead: 'Awaiting Barangay Verification.',
              text: 'This record has been submitted and is currently waiting for Barangay Tambacan staff to verify residency and documents and endorse it to CSWD.'
            }
          : null;
      case 'Needs Correction':
        return {
          lead: 'Waiting on the applicant.',
          text: 'The record was returned for correction. The applicant edits and resubmits it; then verification can resume and approval becomes possible.'
        };
      case 'Under Verification':
        if (!capabilities.verifiedByBarangay) {
          return {
            lead: 'Awaiting Barangay Verification.',
            text: 'Barangay staff must verify residency and documents and endorse this application before CSWD can issue a decision.'
          };
        }
        if (user?.role === 'barangay_staff') {
          return {
            lead: 'Barangay verification recorded ✓',
            text: 'This record was verified by the barangay office and endorsed to CSWD. Awaiting final decision from CSWD staff.'
          };
        }
        return {
          lead: 'Ready for final CSWD decision.',
          text: 'Barangay verification is complete. Review duplicate flags and vulnerability scores above to approve or reject this application.'
        };
      default:
        return null;
    }
  })();
  // Duplicate flags are a CSWD-oversight feature — barangay staff do not see them.
  const tabs = [
    { key: 'profile', label: 'Profile' },
    { key: 'documents', label: `Documents (${documents.length})` },
    { key: 'timeline', label: 'Timeline & reviews' },
    ...(user?.role === 'cswd_staff' ? [{ key: 'duplicates', label: `Duplicates (${flags.length})` }] : [])
  ];

  const transitionDialog = dialog?.kind === 'transition' ? TRANSITION_UI[dialog.to_status] : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Back to {initialTab === 'duplicates' ? 'flags' : 'queue'}
        </Button>
        <div className="flex flex-wrap gap-2">
          {capabilities.canRescan && user?.role === 'cswd_staff' && (
            <Button variant="secondary" size="sm" onClick={runRescan} loading={busy && !dialog}>
              Re-scan for duplicates
            </Button>
          )}
          {capabilities.canStartVerification && (
            <Button size="sm" onClick={() => openTransition('Under Verification')}>
              Verify & endorse to CSWD
            </Button>
          )}
          {capabilities.canReturnForCorrection && app.application_status === 'Pending' && (
            <Button variant="secondary" size="sm" onClick={() => openTransition('Needs Correction')}>
              Return for correction
            </Button>
          )}
          {capabilities.canApprove && (
            <Button size="sm" onClick={() => openTransition('Approved')}>
              Approve
            </Button>
          )}
          {capabilities.canReject && (
            <Button variant="danger" size="sm" onClick={() => openTransition('Rejected')}>
              Reject
            </Button>
          )}
        </div>
      </div>

      {decisionHint && (
        <div className="flex items-start gap-3 rounded-xl border border-sky-200/90 bg-gradient-to-r from-sky-50 via-sky-50/40 to-white px-4 py-3 shadow-sm">
          <span
            className="mt-1 h-3.5 w-1 shrink-0 rounded-full bg-sky-500"
            aria-hidden="true"
          />
          <p className="text-[13px] leading-relaxed text-slate-800">
            <span className="font-bold text-sky-950">{decisionHint.lead}</span>{' '}
            {decisionHint.text}
          </p>
        </div>
      )}

      {notice && (
        <InlineAlert level={notice.level} title="Done">
          {notice.text}
        </InlineAlert>
      )}
      <ErrorText error={actionError} />

      <Card
        title={fullName(app)}
        subtitle={
          <span className="mt-1 inline-flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-100/90 px-2.5 py-0.5 text-[12px] font-bold text-amber-950 shadow-xs">
              Reference: <span className="font-mono">{app.beneficiary_number}</span>
            </span>
            <span className="text-slate-400 font-bold">·</span>
            <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[12px] font-semibold text-slate-700">
              {app.purok ? (app.purok.startsWith('Purok') ? app.purok : `Purok ${app.purok}`) : '—'}
            </span>
            <span className="text-slate-400 font-bold">·</span>
            <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[12px] font-medium text-slate-600">
              Barangay Tambacan
            </span>
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center justify-end gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Application:</span>
              <StatusBadge meta={STATUS_META} value={app.application_status} />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Validation:</span>
              <StatusBadge meta={VALIDATION_STATUS_META} value={app.validation_status} />
            </div>
            {user?.role === 'cswd_staff' && openFlags.length > 0 && <Badge tone="danger">{openFlags.length} open duplicate flag{openFlags.length === 1 ? '' : 's'}</Badge>}
            {app.vulnerability_class && <Badge tone={vulnerabilityClassMeta(app.vulnerability_class)?.tone || 'info'}>Vulnerability: {vulnerabilityClassLabel(app.vulnerability_class)}</Badge>}
          </div>
        }
      >
        <div className="mb-5 flex flex-wrap gap-1 border-b border-slate-200/80">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`-mb-px border-b-2 px-4 py-2.5 text-[13px] font-semibold transition-all duration-150 ${
                tab === t.key
                  ? 'border-gov-600 text-gov-700 bg-gov-50/50 rounded-t-lg shadow-sm'
                  : 'border-transparent text-slate-500 hover:text-slate-900 hover:bg-slate-50/60 rounded-t-lg'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {app.status_reason && tab === 'profile' && (
          <div className="mb-4">
            <InlineAlert level={app.application_status === 'Rejected' ? 'error' : 'warning'} title="Message shown to the applicant">
              {app.status_reason}
            </InlineAlert>
          </div>
        )}

        {tab === 'profile' && (
          <div className="space-y-5">
            <section>
              <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-navy-700">Personal information</h3>
              <DefinitionRows
                rows={[
                  ['Full name', fullName(app)],
                  ['Sex', app.sex],
                  ['Date of birth', dateFmt(app.date_of_birth)],
                  ['Civil status', app.civil_status],
                  ['Disability (PWD)', app.is_pwd ? 'Yes' : 'No'],
                  ['Mobile number', app.mobile_number],
                  ['Purok', app.purok],
                  ['Barangay / City', `${app.barangay}, ${app.city_municipality}`],
                  ['Province', app.province]
                ]}
              />
            </section>
            <section className="border-t border-line pt-4">
              <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-navy-700">Household information</h3>
              <DefinitionRows
                rows={[
                  ['Family size', app.household_size],
                  ['Housing situation', app.house_status]
                ]}
              />
            </section>
            <section className="border-t border-line pt-4">
              <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-navy-700">Disaster incident</h3>
              <DefinitionRows
                rows={[
                  ['Incident type', app.incident_type],
                  ['Date of incident', dateFmt(app.incident_date)],
                  ['Extent of damage', damageExtentLabel(app.damage_extent)],
                  ['Flood hazard exposure', isFloodPronePurok(app.purok) ? 'Yes (Puroks 1–4: High hazard)' : 'No (Puroks 5–8: Low risk)'],
                  ['Submitted', dateTimeFmt(app.submitted_at)]
                ]}
              />
              {app.incident_description && (
                <p className="mt-3 rounded-md bg-surface-muted p-3 text-[13px] leading-relaxed text-navy-800">
                  {app.incident_description}
                </p>
              )}
            </section>
            <section className="border-t border-line pt-4">
              <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-navy-700">Application &amp; applicant</h3>
              <DefinitionRows
                rows={[
                  [
                    'Reference',
                    <span className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-100/90 px-2 py-0.5 text-xs font-bold text-amber-950 font-mono">
                      {app.beneficiary_number}
                    </span>
                  ],
                  ['Applicant account', applicant ? `${applicant.full_name} (${applicant.email})` : '—'],
                  ['Validation status', VALIDATION_STATUS_META[app.validation_status]?.label || app.validation_status],
                  ['Confirmed duplicate', app.duplicate_of ? 'Yes — linked to an earlier record' : 'No'],
                  ['Vulnerability class', app.vulnerability_class ? vulnerabilityClassLabel(app.vulnerability_class) : 'Not yet scored'],
                  ['Data origin', app.data_origin || '—']
                ]}
              />
            </section>
          </div>
        )}

        {tab === 'documents' && (
          <Table
            columns={[
              {
                key: 'file_name',
                header: 'File',
                render: (d) => (
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gov-50 text-gov-700 ring-1 ring-gov-200">
                      {isImageDoc(d) ? (
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      ) : (
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                      )}
                    </span>
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => openPreview(d)}
                        className="truncate text-left font-medium text-gov-700 hover:text-gov-900 hover:underline max-w-[200px] sm:max-w-xs block"
                        title="Click to view attached document"
                      >
                        {d.file_name}
                      </button>
                      {d.size_bytes ? (
                        <span className="text-[11px] text-slate-400">{formatBytes(d.size_bytes)}</span>
                      ) : null}
                    </div>
                  </div>
                )
              },
              {
                key: 'purpose',
                header: 'Purpose',
                render: (d) => (
                  <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[12px] font-medium text-slate-700">
                    {documentPurposeLabel(d.purpose)}
                  </span>
                )
              },
              { key: 'created_at', header: 'Uploaded', render: (d) => dateFmt(d.created_at) },
              {
                key: 'status',
                header: 'Review status',
                render: (d) => (
                  <div className="space-y-0.5">
                    <Badge tone={d.status === 'Accepted' ? 'success' : d.status === 'Rejected' ? 'danger' : 'warning'}>
                      {d.status}
                    </Badge>
                    {d.status === 'Rejected' && d.status_reason && (
                      <p className="max-w-[220px] text-[12px] text-slate-500">{d.status_reason}</p>
                    )}
                  </div>
                )
              },
              {
                key: 'actions',
                header: '',
                align: 'right',
                render: (d) => (
                  <div className="flex justify-end gap-2 items-center">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => openPreview(d)}
                      title="View attached document / image"
                    >
                      <svg className="h-3.5 w-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                      View
                    </Button>
                    {d.status !== 'Accepted' && d.status !== 'Rejected' && (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setReason('');
                            setDialog({ kind: 'doc', doc: d, status: 'Accepted' });
                          }}
                        >
                          Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => {
                            setReason('');
                            setDialog({ kind: 'doc', doc: d, status: 'Rejected' });
                          }}
                        >
                          Reject
                        </Button>
                      </>
                    )}
                  </div>
                )
              }
            ]}
            rows={documents}
            keyFn={(d) => d.id}
            emptyState={
              <EmptyState
                title="No supporting documents"
                description="This record has no uploaded documents yet."
                minHeight="min-h-[160px]"
              />
            }
          />
        )}

        {tab === 'timeline' && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section>
              <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-navy-700">Status history</h3>
              {history.length === 0 ? (
                <EmptyState title="No status changes yet" minHeight="min-h-[120px]" />
              ) : (
                <ol className="space-y-3">
                  {history.map((entry) => (
                    <li key={entry.id} className="rounded-md border border-line p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-navy-900">
                          {entry.from_status || 'New'} → {entry.to_status}
                        </p>
                        <Badge tone={STATUS_META[entry.to_status]?.tone || 'neutral'}>
                          {ACTOR_LABEL[entry.actor_role] || entry.actor_role}
                        </Badge>
                      </div>
                      {entry.reason && <p className="mt-1 text-[13px] text-slate-600">Reason: {entry.reason}</p>}
                      <p className="mt-1 text-[12px] text-slate-400">{dateTimeFmt(entry.created_at)}</p>
                    </li>
                  ))}
                </ol>
              )}
            </section>
            <section>
              <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-navy-700">Verification reviews</h3>
              <p className="mb-3 text-[13px] text-slate-500">
                Internal outcome and remarks recorded by staff at each review stage (office use only).
              </p>
              {reviews.length === 0 ? (
                <EmptyState title="No verification reviews yet" minHeight="min-h-[120px]" />
              ) : (
                <ol className="space-y-3">
                  {reviews.map((review) => (
                    <li key={review.id} className="rounded-md border border-line p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-navy-900">{STAGE_LABEL[review.stage] || review.stage}</p>
                        <StatusBadge meta={STATUS_META} value={review.outcome} />
                      </div>
                      {review.remarks && (
                        <p className="mt-1 text-[13px] text-slate-600">“{review.remarks}”</p>
                      )}
                      <p className="mt-1 text-[12px] text-slate-400">
                        {ACTOR_LABEL[review.reviewer_role] || review.reviewer_role} · {dateTimeFmt(review.created_at)}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        )}

        {tab === 'duplicates' && (
          <div className="space-y-4">
            <InlineAlert level="info" title="How flags are produced">
              Records are compared on normalized name, date of birth, mobile number, purok, and family size. A matching
              name alone only ever produces a low-confidence flag — a human reviewer always decides.
            </InlineAlert>

            {flags.length === 0 && (
              <EmptyState
                title="No duplicate flags for this record"
                description="This record has never been flagged against another Tambacan record."
                minHeight="min-h-[160px]"
              />
            )}

            {flags.map((flag) => {
              const other =
                flag.beneficiary_id === app.id ? flag.candidate_record : flag.flagged_record;
              const isThisSide = flag.beneficiary_id === app.id;
              return (
                <div key={flag.id} className="rounded-md border border-line p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge meta={FLAG_STATUS_META} value={flag.status} />
                      <StatusBadge meta={CONFIDENCE_META} value={flag.confidence} />
                      {flag.similarity_score != null && (
                        <Badge tone="neutral">{Math.round(Number(flag.similarity_score) * 100)}% overall match</Badge>
                      )}
                    </div>
                    <p className="text-[12.5px] text-slate-500">{dateTimeFmt(flag.created_at)}</p>
                  </div>

                  <p className="mt-2 text-sm text-navy-800">
                    {isThisSide ? 'This record' : `Flagged record ${fullName(flag.flagged_record)}`} vs possible original:{' '}
                    <span className="font-medium">{fullName(other)}</span>{' '}
                    <span className="font-mono text-[12px] text-slate-500">{other?.beneficiary_number || '—'}</span>
                  </p>

                  <div className="mt-2">
                    <EvidenceList evidence={flag.match_details?.evidence} />
                  </div>

                  {flag.status !== 'Flagged' && (
                    <div className="mt-3 rounded-md bg-surface-muted p-3 text-[13px] text-navy-800">
                      <p>
                        <strong>
                          {flag.decision === 'confirm' ? 'Confirmed as duplicate' : flag.decision === 'dismiss' ? 'Flag dismissed' : 'Further information requested'}
                        </strong>{' '}
                        by {flag.reviewer?.full_name || 'staff'} ({ACTOR_LABEL[flag.reviewer?.role] || 'staff'}) on{' '}
                        {dateTimeFmt(flag.reviewed_at)}.
                      </p>
                      {flag.notes && <p className="mt-1 text-slate-600">Note: {flag.notes}</p>}
                      <p className="mt-1 text-slate-500">Decisions are final and kept for audit.</p>
                    </div>
                  )}

                  {flag.status === 'Flagged' && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                      <Button size="sm" onClick={() => openDecision(flag, 'confirm')}>
                        Confirm duplicate
                      </Button>
                      {capabilities?.canDismissFlag ? (
                        <Button size="sm" variant="secondary" onClick={() => openDecision(flag, 'dismiss')}>
                          Dismiss flag
                        </Button>
                      ) : (
                        <p className="text-[12.5px] text-slate-500">
                          Only CSWD Staff can clear or dismiss a flag.
                        </p>
                      )}
                      <Button size="sm" variant="secondary" onClick={() => openDecision(flag, 'request_info')}>
                        Request further information
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Decision dialogs ------------------------------------------------ */}

      {transitionDialog && (
        <Dialog
          open
          title={transitionDialog.title}
          description={transitionDialog.description}
          onClose={closeDialog}
          footer={
            <>
              <Button variant="secondary" onClick={closeDialog} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant={dialog.to_status === 'Rejected' ? 'danger' : 'primary'}
                onClick={submitTransition}
                loading={busy}
              >
                {transitionDialog.confirmLabel}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            {dialogError && (
              <InlineAlert level="error" title="Could not record the decision">
                {dialogError.message}
              </InlineAlert>
            )}
            {transitionDialog.reasonLabel && (
              <Field
                label={transitionDialog.reasonLabel}
                htmlFor="transition-reason"
                required
                hint={transitionDialog.reasonHint}
              >
                <Textarea
                  id="transition-reason"
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Explain what needs to change…"
                />
              </Field>
            )}
            <Field label={transitionDialog.remarksLabel} htmlFor="transition-remarks" hint={transitionDialog.remarksHint}>
              <Textarea
                id="transition-remarks"
                rows={3}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Optional internal remarks…"
              />
            </Field>
          </div>
        </Dialog>
      )}

      {dialog?.kind === 'decision' && (
        <Dialog
          open
          title="Review duplicate flag"
          description="Your decision, name, and timestamp are recorded in the audit history."
          onClose={closeDialog}
          footer={
            <>
              <Button variant="secondary" onClick={closeDialog} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant={decisionAction === 'confirm' ? 'danger' : 'primary'}
                onClick={submitDecision}
                loading={busy}
              >
                Submit decision
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            {dialogError && (
              <InlineAlert level="error" title="Could not record the decision">
                {dialogError.message}
              </InlineAlert>
            )}
            <fieldset>
              <legend className="rg-label mb-1.5">Decision</legend>
              <div className="space-y-1.5">
                {FLAG_DECISIONS.filter(
                  (option) => option.value !== 'dismiss' || capabilities?.canDismissFlag
                ).map((option) => (
                  <label
                    key={option.value}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-md border px-2.5 py-2 ${
                      decisionAction === option.value ? 'border-gov-600 bg-gov-50/60' : 'border-line hover:bg-surface-muted'
                    }`}
                  >
                    <input
                      type="radio"
                      name="flag-decision"
                      value={option.value}
                      checked={decisionAction === option.value}
                      onChange={() => setDecisionAction(option.value)}
                      className="mt-0.5 h-4 w-4 border-line-strong text-gov-700 focus:ring-gov-600"
                    />
                    <span>
                      <span className="block text-[13px] font-medium leading-tight text-navy-900">{option.label}</span>
                      <span className="block text-[12px] leading-snug text-slate-500">{option.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {decisionAction === 'confirm' && (
              <InlineAlert level="warning" title="Confirming is not a deletion">
                Both records stay in the system and the application keeps its current status — approving or rejecting it
                remains a separate, recorded decision.
              </InlineAlert>
            )}

            <Field label="Decision notes" htmlFor="decision-notes" required hint="Recorded with reviewer and timestamp (at least 5 characters).">
              <Textarea
                id="decision-notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Same birth date and address — same person re-applied."
              />
            </Field>
          </div>
        </Dialog>
      )}

      {dialog?.kind === 'doc' && (
        <Dialog
          open
          title={`${dialog.status} supporting document`}
          description={`"${dialog.doc.file_name}" — ${documentPurposeLabel(dialog.doc.purpose)}`}
          onClose={closeDialog}
          footer={
            <>
              <Button variant="secondary" onClick={closeDialog} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant={dialog.status === 'Rejected' ? 'danger' : 'primary'}
                onClick={submitDocStatus}
                loading={busy}
              >
                {dialog.status === 'Accepted' ? 'Accept document' : 'Reject document'}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            {dialogError && (
              <InlineAlert level="error" title="Could not update the document">
                {dialogError.message}
              </InlineAlert>
            )}
            {dialog.status === 'Rejected' ? (
              <div className="space-y-3">
                <InlineAlert level="warning" title="Returns application to beneficiary">
                  Rejecting this document automatically sets the application status to <strong>Needs Correction</strong> so the beneficiary can upload a replacement.
                </InlineAlert>
                <Field
                  label="Reason for rejection"
                  htmlFor="doc-reason"
                  required
                  hint="The applicant is notified of this reason (at least 5 characters)."
                >
                  <Textarea
                    id="doc-reason"
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. The photo of the document is blurry and unreadable. Please upload a clearer copy."
                  />
                </Field>
              </div>
            ) : (
              <p className="text-sm text-navy-800">
                The document passes review. The uploader is notified that it was accepted.
              </p>
            )}
          </div>
        </Dialog>
      )}

      {/* Document Preview Modal for Staff Verification ----------------- */}
      {previewDoc && (
        <Dialog
          open
          maxWidth="max-w-3xl"
          title={`Supporting Document: ${documentPurposeLabel(previewDoc.purpose)}`}
          description={`File: ${previewDoc.file_name} • Uploaded: ${dateFmt(previewDoc.created_at)}`}
          onClose={closePreview}
          footer={
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <div>
                {previewUrl && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => window.open(previewUrl, '_blank', 'noopener')}
                  >
                    Open in new tab ↗
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                {previewDoc.status !== 'Accepted' && previewDoc.status !== 'Rejected' && (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        const doc = previewDoc;
                        closePreview();
                        setReason('');
                        setDialog({ kind: 'doc', doc, status: 'Accepted' });
                      }}
                    >
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => {
                        const doc = previewDoc;
                        closePreview();
                        setReason('');
                        setDialog({ kind: 'doc', doc, status: 'Rejected' });
                      }}
                    >
                      Reject
                    </Button>
                  </>
                )}
                <Button size="sm" variant="secondary" onClick={closePreview}>
                  Close
                </Button>
              </div>
            </div>
          }
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-muted/60 px-3.5 py-2 text-xs border border-line">
              <span className="font-semibold text-slate-700">
                Purpose: <span className="text-gov-700">{documentPurposeLabel(previewDoc.purpose)}</span>
              </span>
              <div className="flex items-center gap-2">
                <span className="text-slate-500">Review status:</span>
                <Badge tone={previewDoc.status === 'Accepted' ? 'success' : previewDoc.status === 'Rejected' ? 'danger' : 'warning'}>
                  {previewDoc.status}
                </Badge>
              </div>
            </div>

            {loadingPreview && (
              <div className="py-12 text-center">
                <LoadingState label="Loading document image preview…" minHeight="min-h-[200px]" />
              </div>
            )}

            {previewError && (
              <InlineAlert level="error" title="Could not load document preview">
                {previewError}
              </InlineAlert>
            )}

            {previewUrl && !loadingPreview && (
              <div className="rounded-xl border border-line bg-slate-900/5 p-2 sm:p-4 text-center">
                {isImageDoc(previewDoc) ? (
                  <div className="flex justify-center items-center min-h-[260px] max-h-[60vh] overflow-auto">
                    <img
                      src={previewUrl}
                      alt={previewDoc.purpose}
                      className="max-h-[58vh] max-w-full rounded-lg object-contain shadow-md"
                    />
                  </div>
                ) : isPdfDoc(previewDoc) ? (
                  <iframe
                    src={previewUrl}
                    title={previewDoc.file_name}
                    className="h-[58vh] w-full rounded-lg border border-line bg-white"
                  />
                ) : (
                  <div className="py-12 text-center text-slate-600">
                    <p className="text-sm font-medium">Preview not supported for this file format.</p>
                    <Button
                      size="sm"
                      variant="primary"
                      className="mt-3"
                      onClick={() => window.open(previewUrl, '_blank', 'noopener')}
                    >
                      Download / Open File
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </Dialog>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function Validation() {
  const { user } = useAuth();
  const isCswd = user?.role === 'cswd_staff';
  const [searchParams] = useSearchParams();
  const initialView = searchParams.get('tab') === 'duplicates' && isCswd ? 'duplicates' : 'queue';
  const [view, setView] = useState(initialView); // queue | duplicates | detail
  const [detailId, setDetailId] = useState(null);
  const [detailTab, setDetailTab] = useState('profile');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'duplicates' && isCswd) {
      setView('duplicates');
    } else if (tab === 'queue' || searchParams.has('status') || searchParams.has('flaggedOnly')) {
      setView('queue');
    }
  }, [searchParams, isCswd]);

  const openDetail = (rowOrId, tab = 'profile') => {
    setDetailId(typeof rowOrId === 'string' ? rowOrId : rowOrId.id);
    setDetailTab(tab);
    setView('detail');
  };

  const handleChanged = () => setRefreshKey((n) => n + 1);

  return (
    <>
      <PageHeader
        title={isCswd ? 'Data Validation & Duplicate Detection' : 'Data Validation'}
        breadcrumbs={[{ label: 'Home', to: '/dashboard' }, { label: isCswd ? 'Validation & Duplicates' : 'Data Validation' }]}
      />

      <DataNotice />

      {/* Duplicate-flag review is a CSWD-oversight tab — hidden for barangay staff. */}
      {isCswd && (
        <div className="mb-4 inline-flex items-center gap-1 rounded-xl border border-slate-200/90 bg-white/90 p-1 shadow-sm backdrop-blur-sm">
          <button
            type="button"
            onClick={() => setView('queue')}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-150 ${
              view === 'queue'
                ? 'bg-gradient-to-r from-gov-700 to-gov-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
            }`}
          >
            Validation queue
          </button>
          <button
            type="button"
            onClick={() => setView('duplicates')}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-150 ${
              view === 'duplicates'
                ? 'bg-gradient-to-r from-gov-700 to-gov-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
            }`}
          >
            Duplicate flags
          </button>
        </div>
      )}

      {view === 'detail' && detailId ? (
        <Detail
          key={detailId}
          id={detailId}
          initialTab={detailTab}
          onBack={() => {
            setDetailId(null);
            setView('queue');
          }}
          onChanged={handleChanged}
        />
      ) : view === 'duplicates' && isCswd ? (
        <DuplicatesTab key={`flags-${refreshKey}`} onOpen={openDetail} />
      ) : (
        <QueueTab key={`queue-${refreshKey}`} onSelect={(row) => openDetail(row)} />
      )}
    </>
  );
}
