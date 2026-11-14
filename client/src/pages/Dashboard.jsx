import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import PageHeader, { StatCard } from '../components/ui/PageHeader.jsx';
import Card from '../components/ui/Card.jsx';
import DataNotice from '../components/DataNotice.jsx';
import { LoadingState, ErrorState, EmptyState, InlineAlert } from '../components/ui/States.jsx';
import Button from '../components/ui/Button.jsx';
import Badge from '../components/ui/Badge.jsx';
import { Icon, ROLE_LABELS } from '../config/navigation.jsx';
import { STATUS_META, EDITABLE_STATUSES, VULNERABILITY_CLASS_META, vulnerabilityClassLabel, normalizeClassCounts } from '../lib/constants.js';
import PriorityCategoryBars from '../components/PriorityCategoryBars.jsx';

function SectionDivider({ label, badge }) {
  return (
    <div className="flex items-center justify-between gap-3 pt-2">
      <div className="flex items-center gap-2.5">
        <span className="h-2.5 w-2.5 rounded-sm bg-gradient-to-tr from-gov-600 to-sky-500 ring-4 ring-sky-100" aria-hidden="true" />
        <h2 className="text-[12.5px] font-extrabold uppercase tracking-[0.14em] text-slate-800">{label}</h2>
      </div>
      <div className="h-px flex-1 bg-gradient-to-r from-slate-300 to-transparent" aria-hidden="true" />
      {badge && (
        <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-[11px] font-semibold text-sky-800 shadow-sm">
          {badge}
        </span>
      )}
    </div>
  );
}

/** Beneficiary dashboard panel: the applicant's own application at a glance. */
function MyApplicationPanel() {
  const [bundle, setBundle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api('/applications/mine')
      .then(setBundle)
      .catch((err) => setError(err))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  if (loading) return <LoadingState label="Loading your application…" minHeight="min-h-[160px]" />;
  if (error) return <ErrorState title="Could not load your application" description={error.message} onRetry={load} />;

  const application = bundle?.application;
  if (!application) {
    return (
      <Card title="Your assistance application" subtitle="Visible only to your account">
        <EmptyState
          title="No application started yet"
          description="Complete the beneficiary form for Barangay Tambacan to apply for disaster assistance. You can save your progress as a draft and submit when everything is ready."
          minHeight="min-h-[160px]"
          action={
            <Link to="/application/new">
              <Button>Start your application</Button>
            </Link>
          }
        />
      </Card>
    );
  }

  const meta = STATUS_META[application.application_status];
  const canEdit = EDITABLE_STATUSES.includes(application.application_status);

  return (
    <Card
      title="Your assistance application"
      subtitle={
        <span className="inline-flex items-center gap-1.5 mt-0.5">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-100/90 px-2.5 py-0.5 text-[12.5px] font-bold text-amber-950 shadow-xs">
            <span className="font-semibold text-amber-800">Reference:</span>
            <span className="font-mono tracking-wide">{application.beneficiary_number}</span>
          </span>
        </span>
      }
      actions={
        <Link to="/application">
          <Button variant="secondary">Open application</Button>
        </Link>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Badge tone={meta?.tone || 'neutral'} className="px-3 py-1 text-[13px]">
            {meta?.label || application.application_status}
          </Badge>
          {canEdit && (
            <Link to="/application/edit">
              <Button size="sm">
                {application.application_status === 'Draft' ? 'Continue filling out' : 'Make corrections'}
              </Button>
            </Link>
          )}
        </div>
        <p className="text-sm leading-relaxed text-navy-800">{meta?.hint}</p>
        {application.status_reason && (
          <InlineAlert level={application.application_status === 'Rejected' ? 'error' : 'warning'} title="Message from the office">
            {application.status_reason}
          </InlineAlert>
        )}
        {application.vulnerability_class && (
          <p className="text-[13px] text-slate-600">
            Vulnerability classification:{' '}
            <strong className="text-navy-900">{vulnerabilityClassLabel(application.vulnerability_class)}</strong>
          </p>
        )}
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          <Link to="/notifications">
            <Button variant="secondary" size="sm">Notifications</Button>
          </Link>
          <Link to="/application">
            <Button variant="ghost" size="sm">Status timeline</Button>
          </Link>
        </div>
      </div>
    </Card>
  );
}

/**
 * Staff operations panel (Batch 4): validation-queue counts, open duplicate
 * flags, recent submissions, purok breakdown, local distribution monitoring,
 * and prepared-report visibility — all computed live for Tambacan.
 */
function StaffOperationsPanel({ refreshToken }) {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api('/dashboard/staff-summary')
      .then(setData)
      .catch((err) => setError(err))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load, refreshToken]);

  if (loading && !data) return <LoadingState label="Loading the operations queue…" minHeight="min-h-[140px]" />;
  if (error) return <ErrorState title="Could not load the operations queue" description={error.message} onRetry={load} />;
  if (!data) return null;

  const { queue, openDuplicateFlags, recentSubmissions, purokBreakdown, distribution, reports, recentActivity, notifications } = data;

  const humanizeAction = (action) =>
    String(action || '')
      .replace(/[._]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());

  const maxPurok = Math.max(...(purokBreakdown || []).map((p) => p.count), 1);
  const duplicateTo = user?.role === 'cswd_staff' ? '/validation?tab=duplicates' : '/validation?flaggedOnly=true';

  return (
    <div className="space-y-6">
      <SectionDivider label="Validation & Review Queue" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Pending submissions"
          value={queue.pending}
          tone="warning"
          hint="New applications to verify"
          icon={<Icon name="file" className="h-5 w-5" />}
          to="/validation?status=Pending"
        />
        <StatCard
          label="Awaiting CSWD"
          value={queue.under_verification}
          tone="info"
          hint="Endorsed for final review"
          icon={<Icon name="shield" className="h-5 w-5" />}
          to="/validation?status=Under Verification"
        />
        <StatCard
          label="Returned for correction"
          value={queue.needs_correction}
          tone="warning"
          hint="Waiting on the applicant"
          icon={<Icon name="bell" className="h-5 w-5" />}
          to="/validation?status=Needs Correction"
        />
        <StatCard
          label="Open duplicate flags"
          value={openDuplicateFlags}
          tone={openDuplicateFlags > 0 ? 'danger' : 'success'}
          hint={openDuplicateFlags > 0 ? 'Awaiting reviewer decisions' : 'Nothing waiting on review'}
          icon={<Icon name="users" className="h-5 w-5" />}
          to={duplicateTo}
        />
      </div>

      <SectionDivider label="Barangay Field Operations & Breakdown" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card
          title="Recent submissions"
          actions={
            notifications && notifications.unread > 0 ? (
              <Link to="/notifications">
                <Badge tone="warning">{notifications.unread} unread notification{notifications.unread === 1 ? '' : 's'}</Badge>
              </Link>
            ) : (
              <Link to="/validation">
                <span className="text-[12px] font-semibold text-gov-600 hover:text-gov-800">View queue →</span>
              </Link>
            )
          }
        >
          {recentSubmissions.length === 0 ? (
            <EmptyState
              title="No submissions yet"
              description="Submitted applications appear here and in the validation queue."
              minHeight="min-h-[140px]"
            />
          ) : (
            <ul className="space-y-2.5">
              {recentSubmissions.map((row) => {
                const initials = String(row.full_name || 'B')
                  .split(/\s+/)
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((p) => p[0])
                  .join('')
                  .toUpperCase();
                return (
                  <li
                    key={row.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-line/80 bg-surface-muted/40 px-3 py-2.5 transition-colors hover:bg-navy-50/50"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-navy-700 to-gov-600 text-[11px] font-bold text-white shadow-sm"
                        aria-hidden="true"
                      >
                        {initials}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[13.5px] font-semibold text-navy-900">
                          {row.full_name || row.beneficiary_number}
                        </p>
                        <p className="font-mono text-[11.5px] text-slate-500">
                          {row.beneficiary_number} · <span className="font-sans font-medium text-gov-700">{row.purok || '—'}</span>
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge tone={STATUS_META[row.application_status]?.tone || 'neutral'}>
                        {STATUS_META[row.application_status]?.label || row.application_status}
                      </Badge>
                      <span className="text-[11px] font-medium text-slate-400">
                        {row.submitted_at ? new Date(row.submitted_at).toLocaleDateString() : '—'}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="Purok breakdown">
          {purokBreakdown.length === 0 ? (
            <EmptyState title="No submitted records" minHeight="min-h-[140px]" />
          ) : (
            <ul className="space-y-2.5">
              {purokBreakdown.map((row) => {
                const pct = Math.max(Math.round((row.count / maxPurok) * 100), 8);
                return (
                  <li key={row.purok} className="rounded-lg border border-line/70 bg-surface-muted/30 px-3 py-2">
                    <div className="mb-1.5 flex items-center justify-between text-[13px]">
                      <span className="flex items-center gap-2 font-semibold text-navy-900">
                        <span className="h-2 w-2 rounded-full bg-teal-500" aria-hidden="true" />
                        {row.purok || '—'}
                      </span>
                      <span className="rounded-md bg-navy-900/5 px-2 py-0.5 text-[12px] font-bold tabular-nums text-navy-900">
                        {row.count} {row.count === 1 ? 'record' : 'records'}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-gov-600 to-teal-500 transition-all duration-500"
                        style={{ width: `${pct}%` }}
                        aria-hidden="true"
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="Local monitoring">
          <div className="space-y-4">
            <div className="rounded-lg border border-teal-200/70 bg-gradient-to-br from-teal-50/70 via-white to-white p-3.5">
              <div className="flex items-center justify-between">
                <p className="text-[11.5px] font-bold uppercase tracking-wider text-teal-800">Aid distribution</p>
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-teal-100 text-teal-700">
                  <Icon name="package" className="h-4 w-4" />
                </span>
              </div>
              {distribution.total === 0 ? (
                <p className="mt-2 text-[12.5px] text-slate-600">
                  No aid distributions recorded yet — records will be listed here once distributions are logged.
                </p>
              ) : (
                <div className="mt-2.5 grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-md border border-teal-200/80 bg-white px-2 py-2 shadow-sm">
                    <p className="text-lg font-bold tabular-nums text-teal-700">{distribution.released}</p>
                    <p className="text-[11px] font-medium text-slate-500">Released</p>
                  </div>
                  <div className="rounded-md border border-gov-200/80 bg-white px-2 py-2 shadow-sm">
                    <p className="text-lg font-bold tabular-nums text-gov-700">{distribution.planned}</p>
                    <p className="text-[11px] font-medium text-slate-500">Planned</p>
                  </div>
                </div>
              )}
              <div className="mt-3">
                <Link to="/monitoring">
                  <Button variant="secondary" size="sm" className="w-full justify-center">
                    Manage aid distribution
                  </Button>
                </Link>
              </div>
            </div>

            <div className="rounded-lg border border-gov-200/70 bg-gradient-to-br from-gov-50/70 via-white to-white p-3.5">
              <div className="flex items-center justify-between">
                <p className="text-[11.5px] font-bold uppercase tracking-wider text-gov-800">Prepared reports</p>
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gov-100 text-gov-700">
                  <Icon name="file" className="h-4 w-4" />
                </span>
              </div>
              <p className="mt-1.5 text-[13px] text-navy-800">
                <span className="text-lg font-bold tabular-nums text-navy-900">{reports.prepared}</span> official report
                {reports.prepared === 1 ? '' : 's'} prepared for CSWD oversight.
              </p>
              <div className="mt-3">
                <Link to="/reports">
                  <Button variant="secondary" size="sm" className="w-full justify-center">
                    Open reports
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Batch 6: recent system activity from the audit trail + notification counter */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card
          className="lg:col-span-2"
          title="Recent system activity"
        >
          {!recentActivity || recentActivity.length === 0 ? (
            <EmptyState
              title="No recorded activity yet"
              description="Staff and system actions — submissions, validations, scoring runs, distributions and reports — appear here once they happen."
              minHeight="min-h-[140px]"
            />
          ) : (
            <ul className="relative space-y-2 before:absolute before:bottom-3 before:left-[15px] before:top-3 before:w-0.5 before:bg-line">
              {recentActivity.map((entry, i) => (
                <li
                  key={`${entry.action}-${entry.at}-${i}`}
                  className="relative flex items-center justify-between gap-3 rounded-lg border border-transparent py-1.5 pl-9 pr-2 transition-colors hover:border-line hover:bg-surface-muted/40"
                >
                  <span
                    className="absolute left-2.5 h-3 w-3 rounded-full border-2 border-white bg-gov-600 shadow-sm ring-2 ring-gov-100"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-semibold text-navy-900">{humanizeAction(entry.action)}</p>
                    <p className="text-[11.5px] font-medium uppercase tracking-wide text-slate-500">
                      Module: <span className="text-gov-700">{entry.entity || 'system'}</span>
                    </p>
                  </div>
                  <span className="shrink-0 whitespace-nowrap rounded-md bg-surface-muted px-2 py-1 text-[11.5px] font-medium tabular-nums text-slate-600">
                    {new Date(entry.at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Your notifications">
          <div className="flex h-full flex-col justify-between space-y-4">
            <div className="rounded-xl border border-alert-200/70 bg-gradient-to-br from-alert-50/70 via-white to-white p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-alert-100 text-alert-700 ring-1 ring-alert-200">
                  <Icon name="bell" className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold tabular-nums text-navy-900">
                    {notifications?.unread ?? 0}
                  </p>
                  <p className="text-[12.5px] font-medium text-slate-600">
                    Unread message{(notifications?.unread ?? 0) === 1 ? '' : 's'} waiting
                  </p>
                </div>
              </div>
              <p className="mt-3 text-[12px] leading-relaxed text-slate-600">
                Application updates, correction requests, scoring notices and distribution confirmations are
                delivered in-app in real time.
              </p>
            </div>
            <Link to="/notifications" className="block">
              <Button variant="secondary" size="sm" className="w-full justify-center">
                Open notifications inbox
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}

/**
 * Dashboard slice of the Vulnerability Scoring module (Batch 5): live
 * scored/missing/stale counts plus the honest model-provenance badge.
 * The full list, filters and reviewer actions live at /scoring.
 */
function ScoringSummaryPanel({ refreshToken }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api('/scoring/summary')
      .then(setData)
      .catch((err) => setError(err))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load, refreshToken]);

  if (loading && !data) return <LoadingState label="Loading scoring status…" minHeight="min-h-[140px]" />;
  if (error) {
    return (
      <ErrorState
        title="Could not load scoring status"
        description={error.message}
        onRetry={load}
      />
    );
  }
  if (!data) return null;

  const { total, scored, missing, stale, flagged, by_class: byClass, model } = data;
  const classCounts = normalizeClassCounts(byClass || {});
  const scoredTotal = Object.values(classCounts).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4">
      {total === 0 ? (
        <EmptyState
          title="No records to score"
          description="Records appear in the scoring module once they reach “Under Verification” or “Approved”."
          minHeight="min-h-[140px]"
        />
      ) : (
        <>
          <p className="text-sm text-navy-800">
            <span className="font-semibold tabular-nums">{scored}</span> of{' '}
            <span className="tabular-nums">{total}</span> validated profiles have a current score.
          </p>
          <div className="flex flex-wrap gap-2 text-[12.5px]">
            <span className="rounded-full bg-surface-muted px-3 py-1 text-navy-700">
              <strong className="tabular-nums">{missing}</strong> not scored
            </span>
            {stale > 0 && (
              <span className="rounded-full bg-alert-50 px-3 py-1 text-alert-700">
                <strong className="tabular-nums">{stale}</strong> stale
              </span>
            )}
            {flagged > 0 && (
              <span className="rounded-full bg-danger-50 px-3 py-1 text-danger-700">
                <strong className="tabular-nums">{flagged}</strong> flagged for review
              </span>
            )}
          </div>

          <div className="mt-1">
            <p className="mb-2 text-[13px] font-medium text-navy-800">
              Records by priority category
            </p>
            <PriorityCategoryBars
              counts={classCounts}
              meta={VULNERABILITY_CLASS_META}
              total={scoredTotal}
            />
          </div>
        </>
      )}

      {model && !model.available && (
        <InlineAlert level="warning">
          <strong>Model unavailable.</strong> {model.reason}
        </InlineAlert>
      )}

      <div>
        <Link to="/scoring">
          <Button variant="secondary" size="sm">Open vulnerability scoring</Button>
        </Link>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);

  const refreshAll = () => {
    load();
    setRefreshTick((n) => n + 1);
  };

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api('/dashboard/summary')
      .then(setData)
      .catch((err) => setError(err))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);
  const counts = data?.counts;
  const synthetic = data?.source?.mode === 'synthetic';

  return (
    <>
      <PageHeader
        title={`Welcome, ${user?.full_name || 'user'}`}
        breadcrumbs={[{ label: 'Home', to: '/dashboard' }, { label: 'Dashboard' }]}
        actions={
          <Button variant="secondary" onClick={refreshAll} disabled={loading}>
            Refresh
          </Button>
        }
      />

      {/* Welcome banner — visual treatment for the dashboard header area */}
      <div className="relative mb-5 overflow-hidden rounded-lg border border-line">
        <img
          src="/images/relief-ormoc.jpg"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover object-[center_58%]"
        />
        <div
          className="absolute inset-0 bg-gradient-to-r from-navy-950/95 via-navy-900/90 to-[#17365D]/75"
          aria-hidden="true"
        />
        <div className="relative flex flex-wrap items-center justify-between gap-4 px-5 py-6 sm:px-7">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-teal-200">
              Community relief operations
            </p>
            <h2 className="mt-1.5 text-xl font-semibold text-white">Disaster Assistance Monitoring</h2>
            <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-navy-100">
              Relief assistance profiling, validation, and monitoring for Barangay Tambacan,
              Iligan City, Lanao del Norte.
            </p>
          </div>
          <div className="inline-flex shrink-0 items-center gap-2 rounded-md border border-white/20 bg-white/10 px-3 py-2 text-[12.5px] font-medium text-white">
            <span className="h-1.5 w-1.5 rounded-full bg-teal-300" aria-hidden="true" />
            CSWD Office, Iligan City
          </div>
        </div>
      </div>

      <DataNotice />

      {loading && <LoadingState label="Loading dashboard counters…" />}

      {!loading && error && (
        <ErrorState
          title={error.status === 503 ? 'Data source not available' : 'Could not load the dashboard'}
          description={error.message}
          onRetry={load}
        />
      )}

      {!loading && !error && data && data.restricted && (
        <div className="space-y-5">
          <MyApplicationPanel />
        </div>
      )}

      {!loading && !error && data && !data.restricted && (
        <div className="space-y-6">
          <SectionDivider label="Beneficiary Registry Overview" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Beneficiary profiles"
              value={counts.total}
              tone="info"
              hint={synthetic ? 'Synthetic sample records' : 'Barangay Tambacan records'}
              icon={<Icon name="users" className="h-5 w-5" />}
              to="/beneficiaries"
            />
            <StatCard
              label="Verified"
              value={counts.verified}
              tone="success"
              hint="Passed data validation"
              icon={<Icon name="shield" className="h-5 w-5" />}
              to="/beneficiaries?status=Verified"
            />
            <StatCard
              label="Pending validation"
              value={counts.pending}
              tone="warning"
              hint="Awaiting staff review"
              icon={<Icon name="file" className="h-5 w-5" />}
              to="/beneficiaries?status=Pending"
            />
            <StatCard
              label="Flagged"
              value={counts.flagged}
              tone="danger"
              hint="Possible duplicate or discrepancy"
              icon={<Icon name="bell" className="h-5 w-5" />}
              to="/beneficiaries?status=Flagged"
            />
          </div>

          <StaffOperationsPanel refreshToken={refreshTick} />

          <SectionDivider label="Decision Support & System Telemetry" />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card
              className="lg:col-span-2"
              title="Vulnerability scoring"
            >
              <ScoringSummaryPanel refreshToken={refreshTick} />
            </Card>

            <Card title="System status">
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-teal-200/80 bg-teal-50/70 px-3 py-2 text-[12.5px] font-semibold text-teal-800">
                <span className="h-2 w-2 rounded-full bg-teal-500" aria-hidden="true" />
                All services operational
              </div>
              <dl className="divide-y divide-line text-[13px]">
                <div className="flex items-center justify-between gap-3 py-2.5">
                  <dt className="font-medium text-slate-500">Barangay scope</dt>
                  <dd className="text-right font-semibold text-gov-700">Tambacan only</dd>
                </div>
                <div className="flex items-center justify-between gap-3 py-2.5">
                  <dt className="font-medium text-slate-500">Central office</dt>
                  <dd className="text-right font-semibold text-navy-900">CSWD, Iligan City</dd>
                </div>
                <div className="flex items-center justify-between gap-3 py-2.5">
                  <dt className="font-medium text-slate-500">Last synced</dt>
                  <dd className="text-right font-mono text-[12px] font-medium text-slate-600">
                    {new Date(data.generatedAt).toLocaleString()}
                  </dd>
                </div>
              </dl>
              {synthetic && (
                <div className="mt-4">
                  <InlineAlert level="info">
                    These figures come from synthetic demonstration records, not official LGU data.
                  </InlineAlert>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
