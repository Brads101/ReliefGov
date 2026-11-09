import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import Card from '../components/ui/Card.jsx';
import Table from '../components/ui/Table.jsx';
import Badge from '../components/ui/Badge.jsx';
import Button from '../components/ui/Button.jsx';
import Dialog from '../components/ui/Dialog.jsx';
import { Field, Input, Select, Textarea } from '../components/ui/Input.jsx';
import DataNotice from '../components/DataNotice.jsx';
import PriorityCategoryBars from '../components/PriorityCategoryBars.jsx';
import { LoadingState, ErrorState, EmptyState, InlineAlert } from '../components/ui/States.jsx';
import {
  VULNERABILITY_CLASS_META,
  VULNERABILITY_CLASSES,
  vulnerabilityClassMeta,
  vulnerabilityClassLabel,
  normalizeClassCounts,
  priorityScoreBand,
  LOW_PRIORITY_BASELINE_SCORE,
  displayPriorityScore,
  SCORE_STATE_META,
  SCORE_STATES,
  DATASET_BADGE,
  incomeLevelLabel,
  damageExtentLabel
} from '../lib/constants.js';

/**
 * Random Forest Vulnerability Scoring (Batch 5) — barangay and CSWD staff
 * only. Everything on this page is already scoped to Barangay Tambacan by
 * the server; nothing here widens that scope.
 *
 * WHAT STAFF SEE AND WHY:
 *  - Every row shows the CURRENT score plus its state: Not scored, Scored,
 *    Stale (assessment data or the model version changed after scoring), or
 *    Flagged (a reviewer marked the result questionable).
 *  - Every model score carries its dataset provenance. In this deployment
 *    the model was trained on the household dataset collected for this
 *    study; the banner and every row label that honestly, including the
 *    caveat that the reported figures come from a 200-row internal
 *    hold-out inside that dataset — not an external validation, and not a
 *    claim about households outside it. Scores are decision-support
 *    output, never validated assessments of a real household.
 *  - The "priority score" (0–100) is a documented conversion of the model's
 *    vote distribution for SORTING ONLY. It is NOT a calibrated probability
 *    of harm and NOT an official LGU scale. The priority CATEGORY is the
 *    model's classification; model agreement (confidence) is shown beside it.
 *  - A human keeps the decision: the model never approves, rejects or denies
 *    assistance. CSWD Staff can compute or re-run the score, flag a
 *    questionable result and record an authorized manual correction with a
 *    mandatory reason; Barangay Staff have a read-only view of the same
 *    scores. Full history is preserved.
 */

/**
 * Renders a stored top-factor value in plain language — `damage_photo` is a
 * 0/1 evidence flag and reads better as Yes/No than as a raw number.
 */
function friendlyFactorValue(indicator, value) {
  if (value === null || value === undefined) return '—';
  if (indicator === 'damage_photo') return value ? 'Photo on file' : 'No photo on file';
  if (indicator === 'household_size') return `${value} member${Number(value) === 1 ? '' : 's'}`;
  if (indicator === 'disability_status' || indicator === 'is_pwd') return value === 'Yes' || value === true ? 'PWD' : 'Non-PWD';
  if (indicator === 'location_flood_exposure') return value === 'Yes' || value === true ? 'Puroks 1–4 (High flood hazard)' : 'Puroks 5–8 (Inland / low risk)';
  if (indicator === 'damage_extent' || indicator === 'damage_classification') {
    if (value === 'Total') return 'Total (Totally Destroyed)';
    if (value === 'Major') return 'Major (Heavily Flooded)';
    if (value === 'Minor') return 'Minor (Partially Damaged)';
    if (value === 'None') return 'None (Flooded Only)';
  }
  return String(value);
}

/**
 * Derives the directional impact of each indicator on vulnerability priority.
 * Evaluates whether an indicator increases, lowers, or maintains baseline priority.
 */
function getFactorImpact(indicator, value, splitShare) {
  const ind = String(indicator || '').toLowerCase();
  const val = String(value || '').toLowerCase();
  const weightPct = splitShare != null ? Math.round(Number(splitShare) * 100) : null;

  if (ind.includes('damage')) {
    if (val.includes('total')) {
      return {
        tone: 'danger',
        label: 'Heavily Increases Priority',
        icon: '▲',
        reason: 'Severe structural destruction requires urgent shelter relief',
        weight: weightPct
      };
    }
    if (val.includes('major')) {
      return {
        tone: 'danger',
        label: 'Increases Priority',
        icon: '▲',
        reason: 'Significant flood inundation and living disruption',
        weight: weightPct
      };
    }
    if (val.includes('minor') || val.includes('partially')) {
      return {
        tone: 'warning',
        label: 'Moderate Impact',
        icon: '•',
        reason: 'Partial property damage reported',
        weight: weightPct
      };
    }
    return {
      tone: 'success',
      label: 'Lowers Priority',
      icon: '▼',
      reason: 'No reported structural damage (dwelling intact)',
      weight: weightPct
    };
  }

  if (ind.includes('house_status') || ind.includes('ownership')) {
    if (val.includes('informal')) {
      return {
        tone: 'danger',
        label: 'Heavily Increases Priority',
        icon: '▲',
        reason: 'High housing precarity and informal dwelling tenure',
        weight: weightPct
      };
    }
    if (val.includes('rent') || val.includes('shared')) {
      return {
        tone: 'warning',
        label: 'Increases Priority',
        icon: '▲',
        reason: 'Displacement vulnerability and tenancy cost burden',
        weight: weightPct
      };
    }
    return {
      tone: 'success',
      label: 'Lowers Priority',
      icon: '▼',
      reason: 'Owned dwelling provides stable shelter security',
      weight: weightPct
    };
  }

  if (ind.includes('disability') || ind.includes('pwd')) {
    if (val === 'yes' || val === 'true' || val === 'pwd') {
      return {
        tone: 'danger',
        label: 'Increases Priority',
        icon: '▲',
        reason: 'Household includes person with disability (special care needs)',
        weight: weightPct
      };
    }
    return {
      tone: 'neutral',
      label: 'Baseline',
      icon: '•',
      reason: 'No disability-related vulnerabilities reported',
      weight: weightPct
    };
  }

  if (ind.includes('flood') || ind.includes('location')) {
    if (val === 'yes' || val === 'true' || val.includes('1–4') || val.includes('high')) {
      return {
        tone: 'danger',
        label: 'Increases Priority',
        icon: '▲',
        reason: 'Located in high-hazard coastal / riverbank flood zone',
        weight: weightPct
      };
    }
    return {
      tone: 'success',
      label: 'Lowers Priority',
      icon: '▼',
      reason: 'Inland elevated topography with lower flood hazard',
      weight: weightPct
    };
  }

  if (ind.includes('purok')) {
    const pNum = (val.match(/\d+/) || [])[0];
    const n = Number(pNum);
    if (n >= 1 && n <= 4) {
      return {
        tone: 'danger',
        label: 'Increases Priority',
        icon: '▲',
        reason: 'Waterfront / coastal flood-vulnerable sub-zone',
        weight: weightPct
      };
    }
    if (n >= 5 && n <= 8) {
      return {
        tone: 'success',
        label: 'Lowers Priority',
        icon: '▼',
        reason: 'Inland / elevated residential sub-zone',
        weight: weightPct
      };
    }
    return {
      tone: 'neutral',
      label: 'Moderate Impact',
      icon: '•',
      reason: 'Resident of Barangay Tambacan',
      weight: weightPct
    };
  }

  if (ind.includes('household_size') || ind.includes('family')) {
    const size = Number(val) || 0;
    if (size >= 6) {
      return {
        tone: 'warning',
        label: 'Increases Priority',
        icon: '▲',
        reason: `High dependent burden (${size} household members)`,
        weight: weightPct
      };
    }
    if (size <= 3 && size > 0) {
      return {
        tone: 'success',
        label: 'Lowers Priority',
        icon: '▼',
        reason: `Small family unit (${size} household members)`,
        weight: weightPct
      };
    }
    return {
      tone: 'neutral',
      label: 'Moderate Impact',
      icon: '•',
      reason: `Average family size (${size} household members)`,
      weight: weightPct
    };
  }

  if (ind.includes('age')) {
    const age = Number(val) || 0;
    if (age >= 60) {
      return {
        tone: 'danger',
        label: 'Increases Priority',
        icon: '▲',
        reason: `Senior citizen household head (Age ${age})`,
        weight: weightPct
      };
    }
    if (age < 18 && age > 0) {
      return {
        tone: 'warning',
        label: 'Increases Priority',
        icon: '▲',
        reason: `Minor household head (Age ${age})`,
        weight: weightPct
      };
    }
    return {
      tone: 'neutral',
      label: 'Baseline',
      icon: '•',
      reason: `Working-age adult (Age ${age || value})`,
      weight: weightPct
    };
  }

  if (ind.includes('supporting') || ind.includes('document')) {
    return {
      tone: 'success',
      label: 'Verified',
      icon: '✓',
      reason: 'Official documentation and residency proof on file',
      weight: weightPct
    };
  }

  return {
    tone: 'neutral',
    label: 'Evaluated',
    icon: '•',
    reason: 'Standard demographic indicator',
    weight: weightPct
  };
}

export default function Scoring() {
  const { user } = useAuth();
  const isCswd = user?.role === 'cswd_staff';
  const [search, setSearch] = useState('');
  const [klass, setKlass] = useState('');
  const [state, setState] = useState('');
  const [sort, setSort] = useState('score');
  const [order, setOrder] = useState('desc');
  const [data, setData] = useState(null);
  const [model, setModel] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (klass) params.set('class', klass);
      if (state) params.set('state', state);
      params.set('sort', sort);
      params.set('order', order);
      params.set('limit', '100');
      const [list, modelStatus, summaryStatus] = await Promise.all([
        api(`/scoring/beneficiaries?${params.toString()}`),
        model ? Promise.resolve(model) : api('/scoring/model'),
        // Category totals for the bar chart: the same live, permission-scoped
        // /scoring/summary the dashboard uses. Fetched unfiltered so the
        // chart always shows the whole Tambacan caseload, regardless of the
        // list filters below it.
        api('/scoring/summary')
      ]);
      setData(list);
      setModel(modelStatus);
      setSummary(summaryStatus);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [search, klass, state, sort, order, model]);

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load, refreshTick]);

  const clearFilters = () => {
    setSearch('');
    setKlass('');
    setState('');
    setSort('score');
    setOrder('desc');
  };

  const hasFilters = Boolean(search.trim() || klass || state);

  if (selectedId) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Score review"
          subtitle="Random Forest result, evidence, and full scoring history"
          actions={
            <Button variant="secondary" onClick={() => setSelectedId(null)}>
              Back to scoring list
            </Button>
          }
        />
        <ScoringDetail
          id={selectedId}
          onChanged={() => setRefreshTick((t) => t + 1)}
        />
      </div>
    );
  }

  const columns = [
    {
      key: 'record',
      header: 'Beneficiary',
      render: (r) => (
        <div>
          <p className="font-medium text-navy-900">{r.full_name}</p>
          <p className="font-mono text-[12px] text-slate-500">{r.beneficiary_number}</p>
        </div>
      )
    },
    { key: 'purok', header: 'Purok', render: (r) => <span className="text-[13px]">{r.purok || '—'}</span> },
    {
      key: 'state',
      header: 'Score state',
      render: (r) => (
        <div className="space-y-1">
          <Badge tone={SCORE_STATE_META[r.state]?.tone || 'neutral'}>
            {SCORE_STATE_META[r.state]?.label || r.state}
          </Badge>
          {r.dataset_type && (
            <Badge tone={DATASET_BADGE[r.dataset_type]?.tone || 'neutral'}>
              {DATASET_BADGE[r.dataset_type]?.label || r.dataset_type}
            </Badge>
          )}
        </div>
      )
    },
    {
      key: 'class',
      header: 'Priority category',
      render: (r) =>
        r.vulnerability_class ? (
          <Badge tone={vulnerabilityClassMeta(r.vulnerability_class)?.tone || 'neutral'}>
            {vulnerabilityClassLabel(r.vulnerability_class)}
          </Badge>
        ) : (
          <span className="text-slate-400">—</span>
        )
    },
    {
      key: 'score',
      header: 'Priority score (0–100)',
      align: 'right',
      render: (r) =>
        r.score !== null ? (
          <span className="font-semibold tabular-nums text-navy-900">
            {displayPriorityScore(r.score, r.vulnerability_class)?.toFixed(2)}
          </span>
        ) : (
          <span className="text-slate-400">—</span>
        )
    },
    {
      key: 'scored_at',
      header: 'Scored',
      render: (r) =>
        r.scored_at ? (
          <span className="text-[12.5px] tabular-nums text-slate-600">
            {new Date(r.scored_at).toLocaleDateString()}
          </span>
        ) : (
          <span className="text-slate-400">—</span>
        )
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        <Button size="sm" variant="secondary" onClick={() => setSelectedId(r.id)}>
          {r.state === 'missing' && isCswd ? 'Score' : 'Review'}
        </Button>
      )
    }
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Vulnerability Scoring"
        subtitle="Random Forest priority classification for Barangay Tambacan — decision support for staff, never an automated decision"
      />
      <DataNotice />

      {summary && (
        <Card
          title="Records by priority category"
          subtitle="Current scores across Barangay Tambacan — the whole caseload, not affected by the filters below"
        >
          {summary.total === 0 ? (
            <EmptyState
              title="No records to score"
              description="Records appear in the scoring module once they reach “Under Verification” or “Approved”."
              minHeight="min-h-[120px]"
            />
          ) : (
            <>
              <p className="mb-3 text-sm text-navy-800">
                <span className="font-semibold tabular-nums">{summary.scored}</span> of{' '}
                <span className="tabular-nums">{summary.total}</span> validated profiles have a
                current score.
              </p>
              <PriorityCategoryBars
                counts={normalizeClassCounts(summary.by_class)}
                meta={VULNERABILITY_CLASS_META}
                total={summary.scored}
              />
            </>
          )}
        </Card>
      )}

      <Card
        title="Scoring list"
        subtitle="Validated records (Under Verification / Approved) with their current score state"
      >
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1">
            <Field label="Search">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name or beneficiary number"
              />
            </Field>
          </div>
          <div className="w-40">
            <Field label="Priority category">
              <Select
                value={klass}
                onChange={(e) => setKlass(e.target.value)}
                options={[
                  { value: '', label: 'All categories' },
                  ...VULNERABILITY_CLASSES.map((c) => ({ value: c, label: VULNERABILITY_CLASS_META[c].label }))
                ]}
              />
            </Field>
          </div>
          <div className="w-36">
            <Field label="Score state">
              <Select
                value={state}
                onChange={(e) => setState(e.target.value)}
                options={[
                  { value: '', label: 'All states' },
                  ...SCORE_STATES.map((s) => ({ value: s, label: SCORE_STATE_META[s].label }))
                ]}
              />
            </Field>
          </div>
          <div className="w-36">
            <Field label="Sort by">
              <Select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                options={[
                  { value: 'score', label: 'Priority score' },
                  { value: 'class', label: 'Priority category' },
                  { value: 'name', label: 'Name' },
                  { value: 'date', label: 'Scored date' }
                ]}
              />
            </Field>
          </div>
          <div className="w-28">
            <Field label="Order">
              <Select
                value={order}
                onChange={(e) => setOrder(e.target.value)}
                options={[
                  { value: 'desc', label: 'Highest first' },
                  { value: 'asc', label: 'Lowest first' }
                ]}
              />
            </Field>
          </div>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear
            </Button>
          )}
        </div>

        {data?.counts && (
          <div className="mb-4 flex flex-wrap gap-2 text-[12.5px]">
            <span className="rounded-full bg-surface-muted px-3 py-1 text-navy-700">
              <strong className="tabular-nums">{data.counts.scored}</strong> scored
            </span>
            <span className="rounded-full bg-surface-muted px-3 py-1 text-navy-700">
              <strong className="tabular-nums">{data.counts.missing}</strong> not scored
            </span>
            {data.counts.stale > 0 && (
              <span className="rounded-full bg-alert-50 px-3 py-1 text-alert-700">
                <strong className="tabular-nums">{data.counts.stale}</strong> stale
              </span>
            )}
            {data.counts.flagged > 0 && (
              <span className="rounded-full bg-danger-50 px-3 py-1 text-danger-700">
                <strong className="tabular-nums">{data.counts.flagged}</strong> flagged
              </span>
            )}
          </div>
        )}

        <ErrorText error={error} />

        {loading && !data && <LoadingState label="Loading scoring list…" />}

        {!loading && error && !data && (
          <ErrorState title="Could not load the scoring list" description={error.message} onRetry={load} />
        )}

        {data && !loading && (
          <Table
            columns={columns}
            rows={data.rows}
            keyFn={(r) => r.id}
            emptyState={
              <EmptyState
                title={hasFilters ? 'No records match these filters' : 'No records to score'}
                description={
                  hasFilters
                    ? 'Try widening the filters, or clear them to see every validated record.'
                    : 'Records appear here once they reach “Under Verification” or “Approved”.'
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
            }
          />
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Model banner: honest provenance + measured evaluation              */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Detail: current score, evidence, history, reviewer actions          */
/* ------------------------------------------------------------------ */

function ScoringDetail({ id, onChanged }) {
  const [bundle, setBundle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [dialog, setDialog] = useState(null); // 'flag' | 'correct'
  const [note, setNote] = useState('');
  const [correctionClass, setCorrectionClass] = useState('High');
  const [correctionReason, setCorrectionReason] = useState('');
  const [dialogError, setDialogError] = useState(null);
  const [dialogBusy, setDialogBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setBundle(await api(`/scoring/beneficiaries/${id}`));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const runScore = async (force) => {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const res = await api(`/scoring/beneficiaries/${id}/score`, { method: 'POST', body: { force } });
      setNotice(
        res.unchanged
          ? 'This record already has a fresh score for its current assessment data — nothing new was computed.'
          : `Score computed: ${vulnerabilityClassLabel(res.score.class)} (${Number(res.score.score).toFixed(2)}). The previous result, if any, is kept in the history below.`
      );
      await load();
      onChanged?.();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  };

  const submitDialog = async () => {
    setDialogBusy(true);
    setDialogError(null);
    try {
      if (dialog === 'flag') {
        await api(`/scoring/scores/${bundle.current.id}/flag`, { method: 'POST', body: { note } });
        setNotice('Score flagged as questionable. Review the history, then correct it or re-run the model.');
      } else {
        const res = await api(`/scoring/scores/${bundle.current.id}/correct`, {
          method: 'POST',
          body: { class: correctionClass, reason: correctionReason }
        });
        setNotice(
          `Manual correction recorded: ${vulnerabilityClassLabel(res.score.class)}. The model result is superseded but kept in the history with your name, reason and timestamp.`
        );
      }
      setDialog(null);
      setNote('');
      setCorrectionReason('');
      await load();
      onChanged?.();
    } catch (err) {
      setDialogError(err);
    } finally {
      setDialogBusy(false);
    }
  };

  if (loading && !bundle) return <LoadingState label="Loading score detail…" />;
  if (!loading && error && !bundle) {
    return <ErrorState title="Could not load this score" description={error.message} onRetry={load} />;
  }
  if (!bundle) return null;

  const { record, current, history, indicators, state, scorable, capabilities, model } = bundle;
  const meta = current ? vulnerabilityClassMeta(current.class) : null;
  const datasetMeta = current ? DATASET_BADGE[current.source === 'manual' ? 'manual' : current.dataset_type] : null;

  return (
    <div className="space-y-4">
      <Card title="Record" subtitle={`${record.beneficiary_number} · ${record.application_status}`}>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-4">
          <div>
            <dt className="text-[12px] uppercase tracking-wide text-slate-500">Beneficiary</dt>
            <dd className="text-sm font-medium text-navy-900">{record.full_name}</dd>
          </div>
          <div>
            <dt className="text-[12px] uppercase tracking-wide text-slate-500">Purok</dt>
            <dd className="text-sm text-navy-900">{record.purok || '—'}</dd>
          </div>
          <div>
            <dt className="text-[12px] uppercase tracking-wide text-slate-500">Disability (PWD)</dt>
            <dd className="text-sm font-medium text-navy-900">{record.is_pwd ? 'Yes' : 'No'}</dd>
          </div>
          <div>
            <dt className="text-[12px] uppercase tracking-wide text-slate-500">Score state</dt>
            <dd>
              <Badge tone={SCORE_STATE_META[state]?.tone || 'neutral'}>
                {SCORE_STATE_META[state]?.label || state}
              </Badge>
            </dd>
          </div>
        </dl>
      </Card>

      <Card
        title="Current score"
        subtitle={
          current
            ? `${current.source === 'manual' ? 'Authorized manual correction' : 'Random Forest classification'} · scored ${new Date(current.scored_at).toLocaleString()}`
            : 'No score has been computed for this record yet'
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {capabilities?.canScore && (
              <Button size="sm" loading={busy} onClick={() => runScore(current ? true : false)}>
                {current ? 'Re-run model score' : 'Compute score'}
              </Button>
            )}
            {capabilities?.canFlag && current && (
              <Button size="sm" variant="secondary" onClick={() => setDialog('flag')}>
                Flag as questionable
              </Button>
            )}
            {capabilities?.canCorrect && current && (
              <Button size="sm" variant="secondary" onClick={() => setDialog('correct')}>
                Record manual correction
              </Button>
            )}
          </div>
        }
      >
        <ErrorText error={actionError} />
        {notice && <div className="mb-3"><InlineAlert level="success">{notice}</InlineAlert></div>}

        {!scorable && (
          <div className="mb-3">
            <InlineAlert level="info">{capabilities?.note}</InlineAlert>
          </div>
        )}

        {!current && (
          <EmptyState
            title="Not scored yet"
            description={
              capabilities?.canScore
                ? 'This record is validated and ready. Compute a score to see the model’s priority category, evidence and ranking.'
                : scorable
                  ? 'No score has been computed for this record yet.'
                  : `Scoring applies to records with status: ${(capabilities?.scorableStatuses || []).join(' or ')}.`
            }
            minHeight="min-h-[140px]"
          />
        )}

        {current && (
          <div className="space-y-4">
            {current.flag_note && (
              <InlineAlert level="warning">
                <strong>Flagged as questionable.</strong> {current.flag_note}
              </InlineAlert>
            )}
            {current.stale && (
              <InlineAlert level="warning">
                <strong>Stale score.</strong> The assessment data on this record changed after it was scored.{' '}
                {capabilities?.canScore
                  ? 'Re-run the model to refresh the result.'
                  : 'CSWD Staff can re-run the model to refresh the result.'}
              </InlineAlert>
            )}
            {datasetMeta?.hint ? (
              <InlineAlert level={datasetMeta.tone === 'danger' ? 'warning' : 'info'}>
                <strong>{datasetMeta.label}.</strong> {datasetMeta.hint}
              </InlineAlert>
            ) : null}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-md border border-line bg-surface-muted/60 p-4">
                <p className="text-[12px] uppercase tracking-wide text-slate-500">Priority category</p>
                <p className="mt-1">
                  <Badge tone={meta?.tone || 'neutral'} className="text-[13px]">
                    {meta?.label || current.class}
                  </Badge>
                </p>
                <p className="mt-2 text-[12px] text-slate-500">
                  The model's classification. A human reviewer decides assistance — this category only orders the
                  review queue.
                </p>
              </div>
              <div className="rounded-md border border-line bg-surface-muted/60 p-4">
                <p className="text-[12px] uppercase tracking-wide text-slate-500">Priority score</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-navy-900">
                  {displayPriorityScore(current.score, current.class)?.toFixed(2)}
                </p>
                <p className="mt-0.5 text-[12px] tabular-nums text-slate-500">
                  {Number(current.score) === 0 && current.class === 'Low'
                    ? `Baseline reference score (Band ${priorityScoreBand(current.class)})`
                    : `Reference band ${priorityScoreBand(current.class)}`}
                </p>
                <p className="mt-2 text-[12px] text-slate-500">
                  A 0–100 conversion of the model's vote distribution, used for sorting only. Low priority uses a 12.50
                  baseline reference score so records have an active reference number instead of 0.00.
                </p>
              </div>
              <div className="rounded-md border border-line bg-surface-muted/60 p-4">
                <p className="text-[12px] uppercase tracking-wide text-slate-500">Model agreement</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-navy-900">
                  {current.confidence != null ? `${(current.confidence * 100).toFixed(0)}%` : '—'}
                </p>
                <p className="mt-2 text-[12px] text-slate-500">
                  Share of trees voting for the winning category. Agreement among trees — not a statistical confidence
                  interval.
                </p>
              </div>
            </div>

            {current.probabilities && (
              <div>
                <p className="mb-2 text-[12px] uppercase tracking-wide text-slate-500">Vote distribution</p>
                <div className="space-y-1.5">
                  {VULNERABILITY_CLASSES.map((c, i) => {
                    const pct = (current.probabilities[i] || 0) * 100;
                    return (
                      <div key={c} className="flex items-center gap-3 text-[12.5px]">
                        <span className="w-24 text-slate-600">
                          {VULNERABILITY_CLASS_META[c]?.label || c}
                        </span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted">
                          <div
                            className={`h-full rounded-full ${
                              c === current.class ? 'bg-gov-600' : 'bg-slate-300'
                            }`}
                            style={{ width: `${pct}%` }}
                            aria-hidden="true"
                          />
                        </div>
                        <span className="w-12 text-right tabular-nums text-slate-600">{pct.toFixed(0)}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="rounded-xl border border-slate-200/90 bg-gradient-to-b from-slate-50/50 via-white to-white p-3.5 shadow-xs sm:p-4">
              <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/70 pb-2">
                <h4 className="text-[13.5px] font-bold tracking-tight text-navy-950 sm:text-[14px]">
                  Vulnerability Factors Breakdown
                </h4>
                <span className="text-[11px] text-slate-400">
                  Directional impact on priority classification
                </span>
              </div>

              {current.top_factors?.length ? (
                <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
                  {current.top_factors.map((f, i) => {
                    const impact = getFactorImpact(f.indicator, f.value, f.split_share);
                    return (
                      <div
                        key={i}
                        className="group flex items-center justify-between gap-2 rounded-lg border border-slate-200/70 bg-white px-2.5 py-1.5 text-[12px] transition-colors hover:border-slate-300 hover:bg-slate-50/60"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-1.5 truncate">
                            <span className="font-semibold text-navy-950 capitalize truncate text-[12px]">
                              {String(f.indicator).replace(/_/g, ' ')}:
                            </span>
                            <span className="font-medium text-slate-700 truncate text-[12px]">
                              {friendlyFactorValue(f.indicator, f.value)}
                            </span>
                          </div>
                          <p className="truncate text-[10.5px] text-slate-400 leading-tight" title={impact.reason}>
                            {impact.reason}
                          </p>
                        </div>

                        <div className="flex shrink-0 items-center gap-1.5">
                          {impact.weight != null && (
                            <span
                              className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-500 ring-1 ring-slate-200/50"
                              title="Model criteria importance split share"
                            >
                              {impact.weight}%
                            </span>
                          )}
                          <span
                            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-semibold tracking-tight ${
                              impact.tone === 'danger'
                                ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-200/70'
                                : impact.tone === 'warning'
                                ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200/70'
                                : impact.tone === 'success'
                                ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/70'
                                : 'bg-slate-50 text-slate-600 ring-1 ring-slate-200/70'
                            }`}
                          >
                            <span className="text-[9px]">{impact.icon}</span>
                            <span>{impact.label.replace(' Priority', '')}</span>
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[12px] text-slate-500">
                  {current.source === 'manual'
                    ? 'Set by an authorized reviewer — no model explanation applies.'
                    : 'No per-indicator breakdown stored for this run.'}
                </p>
              )}
            </div>

            <div>
              <p className="mb-2 text-[12px] uppercase tracking-wide text-slate-500">Assessment indicators at scoring time</p>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-5">
                <div>
                  <dt className="text-slate-500">Family size</dt>
                  <dd className="font-medium text-navy-900">{indicators?.household_size ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">House status</dt>
                  <dd className="font-medium text-navy-900">{indicators?.house_status ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Property damage</dt>
                  <dd className="font-medium text-navy-900">{damageExtentLabel(indicators?.damage_extent)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Damage photo on file</dt>
                  <dd className="font-medium text-navy-900">
                    {indicators?.damage_photo == null
                      ? '—'
                      : indicators.damage_photo
                        ? 'Yes'
                        : 'No'}
                  </dd>
                </div>
              </dl>
              {current.correction_reason && (
                <p className="mt-3 rounded-md bg-surface-muted px-3 py-2 text-[12.5px] text-navy-800">
                  <strong>Correction reason:</strong> {current.correction_reason}
                </p>
              )}
            </div>
          </div>
        )}
      </Card>

      <Card
        title="Scoring history"
        subtitle="Every run is kept — nothing is deleted; superseded rows remain for audit"
      >
        {history?.length ? (
          <ol className="space-y-3">
            {history.map((h) => (
              <li key={h.id} className="rounded-md border border-line px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={vulnerabilityClassMeta(h.class)?.tone || 'neutral'}>
                      {vulnerabilityClassLabel(h.class)}
                    </Badge>
                    <span className="text-[13px] font-semibold tabular-nums text-navy-900">
                      {displayPriorityScore(h.score, h.class)?.toFixed(2)}
                    </span>
                    <Badge tone={h.status === 'current' ? 'success' : 'neutral'}>
                      {h.status === 'current' ? 'Current' : 'Superseded'}
                    </Badge>
                    {h.source === 'manual' && <Badge tone="info">Manual correction</Badge>}
                    {h.flagged_at && <Badge tone="danger">Flagged</Badge>}
                  </div>
                  <span className="text-[12.5px] tabular-nums text-slate-500">
                    {new Date(h.scored_at).toLocaleString()}
                  </span>
                </div>
                <p className="mt-1 text-[12.5px] text-slate-600">
                  {h.source === 'manual' ? 'Authorized reviewer correction' : `Model ${h.model_version}`} · evaluated
                  against: {h.evaluated_on}
                  {h.correction_reason ? ` · reason: ${h.correction_reason}` : ''}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState
            title="No scoring history"
            description="Once a score is computed, every run will be listed here with its model version, date and result."
            minHeight="min-h-[120px]"
          />
        )}
      </Card>

      <Dialog
        open={dialog === 'flag'}
        title="Flag this score as questionable"
        description="The score stays visible with a flag badge. Staff can then correct it or re-run the model."
        onClose={() => setDialog(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              loading={dialogBusy}
              disabled={note.trim().length < 5}
              onClick={submitDialog}
            >
              Flag score
            </Button>
          </>
        }
      >
        <ErrorText error={dialogError} />
        <Field
          label="What looks questionable?"
          hint="At least 5 characters. This is recorded with your name and timestamp."
        >
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="e.g. Household size changed between visits; verify before prioritizing."
          />
        </Field>
      </Dialog>

      <Dialog
        open={dialog === 'correct'}
        title="Record an authorized manual correction"
        description="A new current score is stored with your name, the category you choose and a mandatory reason. The model result is superseded but never deleted."
        onClose={() => setDialog(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              loading={dialogBusy}
              disabled={correctionReason.trim().length < 5}
              onClick={submitDialog}
            >
              Record correction
            </Button>
          </>
        }
      >
        <ErrorText error={dialogError} />
        <div className="space-y-3">
          <InlineAlert level="info">
            This does not approve or reject the application. Eligibility decisions remain with the CSWD review step.
          </InlineAlert>
          <Field label="Priority category">
            <Select
              value={correctionClass}
              onChange={(e) => setCorrectionClass(e.target.value)}
              options={VULNERABILITY_CLASSES.map((c) => ({ value: c, label: VULNERABILITY_CLASS_META[c].label }))}
            />
          </Field>
          <Field
            label="Reason for the correction"
            hint="At least 5 characters. Required — every correction must be documented."
          >
            <Textarea
              value={correctionReason}
              onChange={(e) => setCorrectionReason(e.target.value)}
              rows={3}
              placeholder="e.g. House visit confirmed total loss of livelihood; outranks model output."
            />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}

/* Small helper: server errors rendered inline. */
function ErrorText({ error }) {
  if (!error) return null;
  return (
    <p role="alert" className="mb-3 rounded-md border border-danger-200 bg-danger-50 px-3 py-2 text-[13px] text-danger-700">
      {error.message}
    </p>
  );
}
