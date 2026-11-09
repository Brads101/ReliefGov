import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import PageHeader, { StatCard } from '../components/ui/PageHeader.jsx';
import Button from '../components/ui/Button.jsx';
import DataNotice from '../components/DataNotice.jsx';
import Figure from '../components/ui/Figure.jsx';
import Badge from '../components/ui/Badge.jsx';
import { LoadingState, ErrorState, InlineAlert } from '../components/ui/States.jsx';
import ModelPerformance from '../components/ModelPerformance.jsx';
import { STATUS_META, VULNERABILITY_CLASS_META, normalizeClassCounts } from '../lib/constants.js';

/**
 * Analytics — the single place where this deployment's charts live.
 *
 * The page is laid out in four bands, in the order a reviewer reads them:
 *   1. At a glance       — the four headline counters;
 *   2. Live operations   — charts computed from Barangay Tambacan records;
 *   3. Model performance — the Colab training-time figures for the live model;
 *   4. Provenance        — where each band's numbers come from.
 *
 * TWO SOURCES, both read live; nothing on this page is hard-coded, stored,
 * cached or written to the database:
 *
 *  1. `/scoring/model` → <ModelPerformance /> — the training-time figures
 *     produced in Google Colab (held-out confusion matrix, per-class
 *     precision/recall/F1, feature importance, dataset balance, and the
 *     notebook's own two exported figures). All of it comes from
 *     ml-service/artifacts/priority_metrics.json, so the page can never
 *     disagree with the model that is actually running.
 *  2. `/dashboard/staff-summary` + `/scoring/summary` — live operational
 *     figures computed from Barangay Tambacan records at request time.
 *
 * HONESTY RULES FOR THE OPERATIONAL CHARTS:
 *  - score state is drawn as a PARTITION of the record total
 *    (fresh + stale + flagged + not scored = total), so bars never
 *    double-count — `stale` and `flagged` are subsets of `scored` and are
 *    deliberately not plotted alongside it as independent slices;
 *  - every bar shows both the count and its share of the stated total;
 *  - percentages are rounded for display only, never recomputed from
 *    rounded values.
 *
 * Rendered with plain divs/tables (no charting library) so it prints
 * cleanly through the browser's Print → Save as PDF path.
 */

/** Section heading: keeps every band of the page visually anchored. The
 *  accent runs navy → blue → teal down the page so the four bands read as an
 *  ordered sequence rather than four identical blocks. */
const SECTION_ACCENTS = {
  navy: { bar: 'bg-navy-700', rule: 'border-navy-700/20' },
  blue: { bar: 'bg-gov-600', rule: 'border-gov-600/20' },
  teal: { bar: 'bg-teal-600', rule: 'border-teal-600/25' },
  slate: { bar: 'bg-navy-400', rule: 'border-navy-400/25' }
};

function Section({ id, title, description, aside, accent = 'blue', children }) {
  const tone = SECTION_ACCENTS[accent] || SECTION_ACCENTS.blue;
  return (
    <section id={id} aria-labelledby={`${id}-heading`}>
      <div className={`mb-3 border-b-2 pb-2 ${tone.rule}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className={`h-4 w-1 shrink-0 rounded-full ${tone.bar}`} aria-hidden="true" />
            <h2
              id={`${id}-heading`}
              className="text-[15px] font-bold tracking-tight text-navy-900"
            >
              {title}
            </h2>
          </div>
          {aside && <div className="shrink-0 print:hidden">{aside}</div>}
        </div>
        {description && (
          <p className="mt-1 max-w-3xl pl-3 text-[12.5px] leading-relaxed text-slate-500">
            {description}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* UPGRADED MODERN LGU CHART VIEWS                                    */
/* ------------------------------------------------------------------ */

/** 1. Application Queue by Status (Segmented Bar + Status Breakdown) */
function QueueStatusView({ queue = {} }) {
  const total = queue.total || 0;
  const statuses = [
    { key: 'Approved', count: queue.approved || 0, bg: 'bg-emerald-500', text: 'text-emerald-700', light: 'bg-emerald-50' },
    { key: 'Under Verification', count: queue.under_verification || 0, bg: 'bg-gov-600', text: 'text-gov-700', light: 'bg-gov-50' },
    { key: 'Pending', count: queue.pending || 0, bg: 'bg-amber-500', text: 'text-amber-700', light: 'bg-amber-50' },
    { key: 'Needs Correction', count: queue.needs_correction || 0, bg: 'bg-orange-500', text: 'text-orange-700', light: 'bg-orange-50' },
    { key: 'Rejected', count: queue.rejected || 0, bg: 'bg-rose-500', text: 'text-rose-700', light: 'bg-rose-50' }
  ];

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100 p-0.5 shadow-inner">
          {total > 0 ? (
            statuses.map((s) => {
              const pct = (s.count / total) * 100;
              if (pct === 0) return null;
              return (
                <div
                  key={s.key}
                  className={`h-full ${s.bg} first:rounded-l-full last:rounded-r-full transition-all duration-500`}
                  style={{ width: `${pct}%` }}
                  title={`${s.key}: ${s.count} (${pct.toFixed(1)}%)`}
                />
              );
            })
          ) : (
            <div className="h-full w-full bg-slate-200 rounded-full" />
          )}
        </div>
        <div className="flex justify-between text-[11px] text-slate-500 px-0.5 font-mono">
          <span>0 records</span>
          <span className="font-semibold text-navy-900">{total} total submitted</span>
        </div>
      </div>

      <div className="divide-y divide-line/60">
        {statuses.map((s) => {
          const pct = total > 0 ? (s.count / total) * 100 : 0;
          return (
            <div key={s.key} className="py-2.5 first:pt-1 last:pb-1 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <span className={`h-2.5 w-2.5 rounded-full ${s.bg} shrink-0`} />
                <span className="text-[12.5px] font-medium text-navy-900 truncate">{s.key}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-24 hidden sm:block h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full ${s.bg} rounded-full`} style={{ width: `${pct}%` }} />
                </div>
                <span className="text-[12px] font-mono text-slate-500 w-10 text-right">
                  {pct.toFixed(0)}%
                </span>
                <span className={`min-w-[28px] text-center text-xs font-bold px-2 py-0.5 rounded-full ${s.light} ${s.text} tabular-nums`}>
                  {s.count}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 2. Geographic Distribution by Purok (Ranked Caseload) */
function PurokDistributionView({ puroks = [], total = 0 }) {
  const visible = puroks.slice(0, 7);
  const max = Math.max(...visible.map((p) => p.count), 1);
  const topPurok = visible[0];

  return (
    <div className="space-y-3">
      {topPurok && (
        <div className="flex items-center justify-between rounded-md bg-gov-50/70 border border-gov-100 px-3 py-2 text-xs">
          <span className="text-gov-800 font-medium flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-gov-600" />
            Highest density: <strong>{topPurok.purok}</strong>
          </span>
          <span className="font-bold text-gov-700 tabular-nums">
            {topPurok.count} of {total} records ({total > 0 ? Math.round((topPurok.count / total) * 100) : 0}%)
          </span>
        </div>
      )}

      <div className="space-y-2.5">
        {visible.map((p, idx) => {
          const pct = Math.round((p.count / max) * 100);
          const share = total > 0 ? Math.round((p.count / total) * 100) : 0;
          return (
            <div key={p.purok || idx} className="space-y-1">
              <div className="flex items-center justify-between text-[12.5px]">
                <div className="flex items-center gap-2">
                  <span className={`flex h-4 w-4 items-center justify-center rounded text-[10px] font-bold ${
                    idx === 0 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'
                  }`}>
                    {idx + 1}
                  </span>
                  <span className="font-medium text-navy-900">{p.purok || '—'}</span>
                </div>
                <div className="flex items-center gap-2 text-xs font-mono">
                  <span className="text-slate-400">({share}%)</span>
                  <span className="font-semibold text-navy-900 tabular-nums">{p.count}</span>
                </div>
              </div>
              <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-gov-600 to-teal-500 transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 3. Scoring Coverage & Assessment Readiness */
function ScoringCoverageView({ scoring = {}, total = 0 }) {
  const scored = scoring?.scored || 0;
  const flagged = scoring?.flagged || 0;
  const missing = scoring?.missing || 0;
  const coveragePct = total > 0 ? Math.round((scored / total) * 100) : 0;

  const items = [
    { label: 'Assessed & Scored', count: scored, tone: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
    { label: 'Flagged for Review', count: flagged, tone: 'bg-rose-500', text: 'text-rose-700', bg: 'bg-rose-50', border: 'border-rose-200' },
    { label: 'Awaiting Score', count: missing, tone: 'bg-slate-400', text: 'text-slate-700', bg: 'bg-slate-50', border: 'border-slate-200' }
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between p-3 rounded-lg bg-surface-muted/60 border border-line">
        <div>
          <span className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold block">Triage Coverage</span>
          <div className="text-2xl font-bold text-navy-900 tabular-nums mt-0.5">{coveragePct}%</div>
        </div>
        <div className="text-right text-xs text-slate-500">
          <div><strong className="text-navy-900">{scored}</strong> scored profiles</div>
          <div><strong className="text-slate-600">{missing}</strong> pending assessment</div>
        </div>
      </div>

      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
        {total > 0 && (
          <>
            <div style={{ width: `${((scored - flagged) / total) * 100}%` }} className="bg-emerald-500 transition-all" title="Scored" />
            <div style={{ width: `${(flagged / total) * 100}%` }} className="bg-rose-500 transition-all" title="Flagged" />
            <div style={{ width: `${(missing / total) * 100}%` }} className="bg-slate-300 transition-all" title="Awaiting Score" />
          </>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        {items.map((it) => (
          <div key={it.label} className={`p-2.5 rounded-lg border ${it.border} ${it.bg}`}>
            <div className="flex items-center justify-between mb-1">
              <span className={`h-2 w-2 rounded-full ${it.tone}`} />
              <span className={`font-bold tabular-nums text-sm ${it.text}`}>{it.count}</span>
            </div>
            <div className="text-[11px] font-medium text-slate-700 truncate">{it.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 4. Priority Category Distribution (3 Institutional Triage Cards) */
function PriorityCategoryView({ classCounts = {}, total = 0 }) {
  const categories = [
    {
      key: 'Low',
      label: 'Low Priority',
      count: classCounts.Low || 0,
      border: 'border-teal-200',
      bg: 'bg-teal-50/50',
      bar: 'bg-teal-600'
    },
    {
      key: 'Moderate',
      label: 'Medium Priority',
      count: classCounts.Moderate || 0,
      border: 'border-gov-200',
      bg: 'bg-gov-50/50',
      bar: 'bg-gov-600'
    },
    {
      key: 'High',
      label: 'High Priority',
      count: classCounts.High || 0,
      border: 'border-alert-200',
      bg: 'bg-alert-50/50',
      bar: 'bg-alert-500'
    }
  ];

  return (
    <div className="space-y-3">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100 p-0.5">
        {total > 0 && categories.map((c) => {
          const pct = (c.count / total) * 100;
          if (pct === 0) return null;
          return (
            <div
              key={c.key}
              className={`h-full ${c.bar} first:rounded-l-full last:rounded-r-full transition-all duration-500`}
              style={{ width: `${pct}%` }}
              title={`${c.label}: ${c.count}`}
            />
          );
        })}
      </div>

      <div className="space-y-2">
        {categories.map((c) => {
          const pct = total > 0 ? Math.round((c.count / total) * 100) : 0;
          return (
            <div key={c.key} className={`p-3 rounded-lg border ${c.border} ${c.bg} flex items-center justify-between gap-3`}>
              <div className="flex items-center gap-2.5 min-w-0">
                <span className={`h-2.5 w-2.5 rounded-full ${c.bar} shrink-0`} />
                <span className="font-bold text-sm text-navy-900">{c.label}</span>
              </div>
              <div className="text-right shrink-0 flex items-center gap-3">
                <div className="w-24 hidden sm:block h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full ${c.bar} rounded-full`} style={{ width: `${pct}%` }} />
                </div>
                <span className="text-[12px] font-mono text-slate-500 w-10 text-right">{pct}%</span>
                <span className="min-w-[28px] text-center text-xs font-bold px-2.5 py-1 rounded-full bg-white text-navy-900 shadow-sm border border-line tabular-nums">
                  {c.count}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Analytics() {
  const [summary, setSummary] = useState(null);
  const [scoring, setScoring] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showModelEvaluation, setShowModelEvaluation] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([api('/dashboard/staff-summary'), api('/scoring/summary')])
      .then(([staff, scores]) => {
        setSummary(staff);
        setScoring(scores);
      })
      .catch((err) => setError(err))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const header = (
    <PageHeader
      title="Analytics"
      description=""
      actions={
        <Button variant="secondary" onClick={load} disabled={loading}>
          Refresh
        </Button>
      }
    />
  );

  if (loading && !summary) {
    return (
      <>
        {header}
        <DataNotice />
        <LoadingState label="Loading analytics…" />
      </>
    );
  }

  if (error && !summary) {
    return (
      <>
        {header}
        <ErrorState
          title="Could not load the analytics data"
          description={error.message}
          onRetry={load}
        />
      </>
    );
  }

  const queue = summary?.queue || {};
  const puroks = summary?.purokBreakdown || [];

  const scoreTotal = scoring?.total || 0;

  const classCounts = normalizeClassCounts(scoring?.by_class || {});
  const classTotal = Object.values(classCounts).reduce((a, b) => a + (Number(b) || 0), 0);

  const generatedAt = summary?.generatedAt ? new Date(summary.generatedAt) : null;
  const livePill = (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-3 py-1 text-[11.5px] font-medium text-slate-600">
      <span className="h-1.5 w-1.5 rounded-full bg-teal-500" aria-hidden="true" />
      Live{generatedAt ? ` · ${generatedAt.toLocaleTimeString()}` : ''}
    </span>
  );

  return (
    <>
      {header}
      <DataNotice />

      {error && (
        <div className="mb-4 print:hidden">
          <InlineAlert level="warning" title="Some figures could not be refreshed">
            {error.message}
          </InlineAlert>
        </div>
      )}

      <div className="space-y-6">
        {/* Headline Stat Cards */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 print:grid-cols-4">
          <StatCard
            label="Profiles in scope"
            value={(queue.total ?? 0).toLocaleString()}
            hint="Submitted records in Barangay Tambacan"
            tone="info"
          />
          <StatCard
            label="Scorable profiles"
            value={(scoring?.scorable ?? 0).toLocaleString()}
            hint="Approved profiles"
            tone="neutral"
          />
          <StatCard
            label="Current scores"
            value={`${scoring?.scored ?? 0} / ${scoring?.total ?? 0}`}
            hint="Records with a live model score"
            tone="success"
          />
          <StatCard
            label="Open duplicate flags"
            value={(summary?.openDuplicateFlags ?? 0).toLocaleString()}
            hint="Awaiting a reviewer's decision"
            tone={(summary?.openDuplicateFlags ?? 0) > 0 ? 'warning' : 'success'}
          />
        </div>

        {/* Live operations -------------------------------------------------- */}
        <Section
          id="operations"
          accent="blue"
          title="Live operations"
          description="Computed from Barangay Tambacan records at request time — refreshed by the button above, never stored."
          aside={livePill}
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <Figure
              title="Application queue by status"
              note={`All ${queue.total ?? 0} submitted records, grouped by their current application status.`}
            >
              <QueueStatusView queue={queue} />
            </Figure>

            <Figure
              title="Geographic density by purok"
              note={
                puroks.length > 7
                  ? `Top 7 of ${puroks.length} puroks by record count across Barangay Tambacan.`
                  : `All ${queue.total ?? 0} submitted records, grouped by purok.`
              }
            >
              <PurokDistributionView puroks={puroks} total={queue.total || 0} />
            </Figure>

            <Figure
              title="Vulnerability scoring readiness"
              note={`Assessment coverage across all ${scoreTotal} submitted records. Shows active scores vs pending model review.`}
            >
              <ScoringCoverageView scoring={scoring} total={scoreTotal} />
            </Figure>

            <Figure
              title="Priority category distribution"
              note={`Live distribution across Low, Medium, and High priority categories (${classTotal} scored records).`}
            >
              {classTotal > 0 ? (
                <PriorityCategoryView classCounts={classCounts} total={classTotal} />
              ) : (
                <p className="text-[13px] text-slate-500 py-4 text-center">No records have been scored yet.</p>
              )}
            </Figure>
          </div>
        </Section>

        {/* 3. Model performance (Collapsible for Defense & Audits) --------- */}
        <section aria-labelledby="model-eval-heading">
          <div className="rounded-xl border border-line bg-white shadow-card overflow-hidden">
            <button
              type="button"
              onClick={() => setShowModelEvaluation((open) => !open)}
              className="w-full flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-surface-muted/50"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-50 text-teal-700 text-sm font-bold">
                  ML
                </span>
                <div>
                  <h2 id="model-eval-heading" className="text-sm font-bold text-navy-900">
                    Model Training Evaluation & Academic Audit
                  </h2>
                  <p className="text-[12px] text-slate-500">
                    Random Forest (rf-1.2.0) Google Colab offline validation, confusion matrix & feature importances for capstone review
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Badge tone={showModelEvaluation ? 'teal' : 'neutral'}>
                  {showModelEvaluation ? 'Hide evaluation' : 'View evaluation'}
                </Badge>
                <span className={`text-slate-400 text-xs transition-transform duration-200 ${showModelEvaluation ? 'rotate-180' : ''}`}>
                  ▼
                </span>
              </div>
            </button>

            {showModelEvaluation && (
              <div className="border-t border-line p-5 bg-surface-muted/20">
                <p className="mb-4 text-[12.5px] leading-relaxed text-slate-600">
                  Training-time figures produced in Google Colab for the Random Forest model serving scores right now — measured on 200 rows held out of fitting (internal hold-out).
                </p>
                <ModelPerformance />
              </div>
            )}
          </div>
        </section>

      </div>
    </>
  );
}
