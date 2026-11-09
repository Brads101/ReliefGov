import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import Card from './ui/Card.jsx';
import Badge from './ui/Badge.jsx';
import Figure from './ui/Figure.jsx';
import { LoadingState, InlineAlert } from './ui/States.jsx';
import { PriorityCategoryBars } from './PriorityCategoryBars.jsx';
import { DATASET_BADGE, VULNERABILITY_CLASS_META } from '../lib/constants.js';

/**
 * ModelPerformance — the training-time figures produced in Google Colab,
 * rendered inside the app.
 *
 * Every number comes from `ml-service/artifacts/priority_metrics.json`,
 * served unchanged as `/api/scoring/model → evaluation`. Nothing here is
 * hard-coded, so the panel can never disagree with the model that is
 * actually running.
 *
 * Honesty rules baked into this component:
 *   - the headline accuracy comes from the 200 rows the Colab notebook held
 *     out of training (stratified 80/20, seed 42) — an internal hold-out,
 *     never presented as external or real-world accuracy;
 *   - the 1,000-row figure is shown only as `fullDataAgreement`, explicitly
 *     labelled training-set agreement, because it re-scores rows the model
 *     was fitted on;
 *   - feature importance is the forest's own Gini impurity share, labelled as
 *     such rather than as "accuracy contribution";
 *   - the confusion matrix counts rows, not households' outcomes.
 *
 * The two PNG figures are the notebook's own plots, exported as aggregate
 * images (counts only — no names, no birthdates, no row-level data).
 *
 * Rendered with plain divs/tables (no charting library) so it prints cleanly
 * through the browser's Print → Save as PDF path used by Reports.
 */

/** Short axis label: "Low priority" → "Low" inside the matrix. */
const shortClass = (value) =>
  (VULNERABILITY_CLASS_META[value]?.label || value).replace(' priority', '');

/** One headline number with a coloured top edge, used for the four KPIs. */
function MetricTile({ label, value, hint, tone = 'info' }) {
  const edges = {
    success: 'border-t-teal-500',
    info: 'border-t-gov-600',
    neutral: 'border-t-navy-500',
    warning: 'border-t-alert-500'
  };
  const values = {
    success: 'text-teal-700',
    info: 'text-gov-700',
    neutral: 'text-navy-900',
    warning: 'text-alert-600'
  };
  return (
    <div
      className={`rounded-lg border border-line/80 border-t-2 bg-white p-3 print:border-0 print:p-0 ${
        edges[tone] || edges.info
      }`}
    >
      <dt className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd
        className={`mt-1 text-2xl font-bold tracking-tight tabular-nums ${
          values[tone] || values.info
        }`}
      >
        {value}
      </dd>
      {hint && <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{hint}</p>}
    </div>
  );
}

const METRIC_TONES = {
  precision: 'bg-gov-600',
  recall: 'bg-teal-600',
  f1: 'bg-navy-700'
};

function MetricBar({ label, value, tone = 'precision' }) {
  const raw = Math.max(0, Math.min(1, Number(value) || 0));
  const pct = raw * 100;
  // Exact 1.0 stays "100%"; anything else keeps one decimal so 99.86%
  // is never displayed as a flattering 100%.
  const text = raw === 1 ? '100%' : `${pct.toFixed(1)}%`;
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-[11px] text-slate-500">{label}</span>
      <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200/70 print:bg-slate-100 print:ring-0">
        <span
          className={`block h-full rounded-full ${METRIC_TONES[tone] || METRIC_TONES.precision} print:opacity-90`}
          style={{ width: `${pct}%` }}
          aria-hidden="true"
        />
      </span>
      <span className="w-11 shrink-0 text-right text-[11.5px] font-semibold tabular-nums text-navy-900">
        {text}
      </span>
    </div>
  );
}

/** Legend chip for the per-class metric colours. */
function LegendItem({ tone, children }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
      <span className={`h-1.5 w-4 rounded-full ${METRIC_TONES[tone] || METRIC_TONES.precision}`} aria-hidden="true" />
      {children}
    </span>
  );
}

export default function ModelPerformance() {
  const [model, setModel] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api('/scoring/model')
      .then((status) => {
        if (!cancelled) setModel(status);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <Card title="Model performance">
        <InlineAlert level="warning">
          The model evaluation could not be loaded: {error.message}
        </InlineAlert>
      </Card>
    );
  }

  if (!model) {
    return (
      <Card title="Model performance">
        <LoadingState label="Loading model evaluation…" />
      </Card>
    );
  }

  if (!model.available) {
    return (
      <Card title="Model performance">
        <InlineAlert level="warning">
          The model is not available on the server: {model.reason}
        </InlineAlert>
      </Card>
    );
  }

  const ev = model.evaluation || {};
  const cm = ev.confusionMatrix;
  const matrix = cm?.matrix || [];
  const classes = cm?.classes || [];
  const cmMax = Math.max(1, ...matrix.flat());
  const matrixTotal = matrix.flat().reduce((a, b) => a + b, 0);
  const matrixAgree = matrix.reduce((sum, row, i) => sum + (row[i] || 0), 0);
  const badge = DATASET_BADGE[model.dataset?.type] || DATASET_BADGE.synthetic;
  // Dataset balance comes from classDistribution (all 1,000 records); the
  // perClass supports are the much smaller held-out test rows and must not
  // be shown as "how many households are in each class".
  const dist = ev.classDistribution?.counts || {};
  const counts = Object.keys(dist).length
    ? dist
    : Object.fromEntries((ev.perClass || []).map((row) => [row.class, row.support]));
  const datasetRows =
    ev.classDistribution?.total ??
    (ev.perClass || []).reduce((sum, r) => sum + (r.support || 0), 0);
  const full = ev.fullDataAgreement || null;

  return (
    <Card
      title="Training results"
      subtitle={`${model.modelVersion} · ${model.dataset?.label || ''} · figures produced when the model was trained`}
      actions={<Badge tone={badge.tone}>{badge.label}</Badge>}
    >
      <div className="space-y-5">
        {/* Headline figures ------------------------------------------------ */}
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 print:grid-cols-4">
          <MetricTile
            label="Accuracy on held-out rows"
            value={ev.accuracy != null ? `${(ev.accuracy * 100).toFixed(1)}%` : '—'}
            hint="Rows never seen while fitting"
            tone="success"
          />
          <MetricTile
            label="Held-out test rows"
            value={(ev.nTest ?? datasetRows)?.toLocaleString?.() ?? ev.nTest}
            hint="The 20% internal hold-out"
            tone="info"
          />
          <MetricTile
            label="Rows used for training"
            value={ev.split?.trainRows?.toLocaleString?.() ?? '—'}
            hint="The other 80% of the dataset"
            tone="neutral"
          />
          <MetricTile
            label="Model inputs"
            value={model.features?.names?.length ?? '—'}
            hint="Survey fields the model reads"
            tone="neutral"
          />
        </dl>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Confusion matrix --------------------------------------------- */}
          {matrix.length > 0 && (
            <Figure
              title="Confusion matrix — held-out test rows"
              note={`Rows = the source dataset's own priority label. Columns = the model's prediction, on the ${ev.nTest} rows withheld from training.`}
              actions={
                <Badge tone="success">
                  {matrixAgree} / {matrixTotal} agree
                </Badge>
              }
            >
              <table className="w-full border-separate border-spacing-1 pr-1" aria-label="Confusion matrix on held-out rows">
                <thead>
                  <tr className="text-slate-500">
                    <th className="pb-1 pr-1 text-left text-[10px] font-medium">
                      Actual ↓ / Predicted →
                    </th>
                    {classes.map((c) => (
                      <th key={c} className="px-1 text-center text-[11.5px] font-semibold">
                        {shortClass(c)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.map((row, i) => (
                    <tr key={classes[i]}>
                      <th className="pr-1 text-left text-[11.5px] font-semibold text-navy-800">
                        {shortClass(classes[i])}
                      </th>
                      {row.map((value, j) => {
                        const hit = i === j;
                        const intensity = value / cmMax;
                        return (
                          <td
                            key={j}
                            className={`rounded-md px-1.5 py-2.5 text-center text-[13px] font-bold tabular-nums ${
                              value === 0
                                ? 'text-slate-400'
                                : hit
                                  ? 'text-teal-900'
                                  : 'text-danger-700'
                            }`}
                            style={{
                              backgroundColor: hit
                                ? `rgba(13, 116, 95, ${0.08 + intensity * 0.3})`
                                : value > 0
                                  ? `rgba(190, 60, 60, ${0.08 + intensity * 0.3})`
                                  : 'transparent'
                            }}
                          >
                            {value}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line/70 pt-2 text-[11px] text-slate-500">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="h-2.5 w-2.5 rounded-[3px] bg-teal-600/30 ring-1 ring-teal-600/60"
                    aria-hidden="true"
                  />
                  Agreement
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="h-2.5 w-2.5 rounded-[3px] bg-danger-600/25 ring-1 ring-danger-600/60"
                    aria-hidden="true"
                  />
                  Disagreement
                </span>
                <span className="ml-auto tabular-nums">
                  {matrixTotal > 0 ? `${((matrixAgree / matrixTotal) * 100).toFixed(1)}% correct` : '—'}
                </span>
              </div>
            </Figure>
          )}

          {/* Per-class metrics -------------------------------------------- */}
          {(ev.perClass || []).length > 0 && (
            <Figure
              title="Precision, recall and F1 per class"
              note={`Measured against the source dataset's own labels on the ${ev.nTest} held-out rows the model never saw while fitting.`}
            >
              <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
                <LegendItem tone="precision">Precision</LegendItem>
                <LegendItem tone="recall">Recall</LegendItem>
                <LegendItem tone="f1">F1</LegendItem>
              </div>
              <div className="divide-y divide-line/70">
                {(ev.perClass || []).map((row) => {
                  const meta = VULNERABILITY_CLASS_META[row.class] || {};
                  return (
                    <div key={row.class} className="py-2.5 first:pt-0 last:pb-0">
                      <div className="mb-1.5 flex items-baseline justify-between gap-2">
                        <span className="text-[12.5px] font-semibold text-navy-900">
                          {meta.label || row.class}
                        </span>
                        <span className="text-[11px] tabular-nums text-slate-500">
                          {row.support?.toLocaleString?.() ?? row.support} held-out rows
                        </span>
                      </div>
                      <div className="space-y-1">
                        <MetricBar label="Precision" value={row.precision} tone="precision" />
                        <MetricBar label="Recall" value={row.recall} tone="recall" />
                        <MetricBar label="F1" value={row.f1} tone="f1" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Figure>
          )}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Feature importance ------------------------------------------- */}
          {(ev.featureImportance || []).length > 0 && (
            <Figure
              title="Feature importance"
              note={ev.importanceBasis || 'Share of the forest’s split impurity reduction attributed to each input.'}
            >
              <ul className="space-y-3">
                {(ev.featureImportance || []).map((f) => {
                  const pct = Math.round(Number(f.share) * 1000) / 10;
                  return (
                    <li key={f.feature}>
                      <div className="mb-1 flex items-baseline justify-between gap-2 text-[12.5px]">
                        <span className="flex items-center gap-1.5 font-medium text-navy-800">
                          <span className="h-1.5 w-1.5 rounded-full bg-gov-600" aria-hidden="true" />
                          {f.label || f.feature}
                        </span>
                        <span className="shrink-0 font-semibold tabular-nums text-navy-900">{pct}%</span>
                      </div>
                      <div className="h-2.5 overflow-hidden rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200/70 print:bg-slate-100 print:ring-0">
                        <span
                          className="block h-full rounded-full bg-gov-700 print:opacity-90"
                          style={{ width: `${Math.max(pct, 4)}%` }}
                          aria-hidden="true"
                        />
                      </div>
                      <p className="mt-1 font-mono text-[10.5px] text-slate-500">{f.feature}</p>
                    </li>
                  );
                })}
              </ul>
            </Figure>
          )}

          {/* Class distribution ------------------------------------------- */}
          {datasetRows > 0 && (
            <Figure
              title="Rows per class in the source dataset"
              note={`How the ${datasetRows.toLocaleString?.() ?? datasetRows} collected household records are labelled — the balance the model was trained against (the notebook's own bar chart is below).`}
            >
              <PriorityCategoryBars
                counts={counts}
                meta={VULNERABILITY_CLASS_META}
                total={datasetRows}
                colorway="spectrum"
              />
            </Figure>
          )}
        </div>

        {/* The notebook's own figures -------------------------------------- */}
        <Figure
          title="Figures from your Colab notebook"
          note="Exported from FINAL_CAPSTONE_2.ipynb exactly as the notebook drew them — aggregate counts only, no household names, birthdates or row-level data. The notebook labels the confusion-matrix axes the other way round (rows 'Predicted'); the numbers are sklearn's confusion_matrix, whose rows are the actual labels — the orientation used by every chart above."
        >
          <div className="grid gap-4 sm:grid-cols-2 print:grid-cols-2">
            <figure className="overflow-hidden rounded-lg border border-line bg-white print:border-0">
              <img
                src="/colab/confusion-matrix.png"
                alt="Notebook confusion matrix: 47 Low, 138 Medium and 14 High predicted correctly on held-out rows, with one High record predicted Medium."
                className="block w-full"
                loading="lazy"
              />
              <figcaption className="border-t border-line px-3 py-2 text-[11.5px] text-slate-500">
                Held-out confusion matrix (200 rows, 199 correct).
              </figcaption>
            </figure>
            <figure className="overflow-hidden rounded-lg border border-line bg-white print:border-0">
              <img
                src="/colab/class-distribution.png"
                alt="Notebook bar chart of priority-level distribution: Low 233, Medium 690, High 77 households."
                className="block w-full"
                loading="lazy"
              />
              <figcaption className="border-t border-line px-3 py-2 text-[11.5px] text-slate-500">
                Priority-level distribution across all 1,000 collected records.
              </figcaption>
            </figure>
          </div>
        </Figure>

        {/* Honesty footnote ------------------------------------------------ */}
        <div className="rounded-lg border border-line bg-surface-muted/50 p-3 print:border-0 print:bg-transparent print:p-0">
          <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-500">
            About these figures
          </p>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-slate-600">
            <strong className="text-navy-800">What they are:</strong>{' '}
            {ev.evaluatedOn ||
              'metrics measured on the rows the notebook withheld from training.'}{' '}
            They are decision-support evidence for staff, not a claim of real-world
            accuracy or fairness, and no score on this system approves, rejects or
            denies assistance on its own.
          </p>
          {full && (
            <p className="mt-2 border-t border-line/70 pt-2 text-[11.5px] leading-relaxed text-slate-600">
              <strong className="text-navy-800">Secondary figure:</strong>{' '}
              {full.evaluatedOn}{' '}
              {full.accuracy != null && (
                <>
                  That figure is <strong className="tabular-nums">{(full.accuracy * 100).toFixed(1)}%</strong> over{' '}
                  {(full.nRows ?? 0).toLocaleString?.() ?? full.nRows} rows.
                </>
              )}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
