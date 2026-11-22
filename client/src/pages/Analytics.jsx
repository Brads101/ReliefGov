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
/** 2. Interactive Barangay Tambacan Geographic Zone Map (Choropleth) */
const TAMBACAN_ZONES = [
  // Coastal / Riverbank Flood-Prone Zone (Puroks 1–4)
  {
    num: 1,
    label: 'Purok 1',
    coastal: true,
    path: 'M 108 58 L 222 46 L 236 108 L 138 122 L 100 98 Z',
    cx: 170,
    cy: 84
  },
  {
    num: 2,
    label: 'Purok 2',
    coastal: true,
    path: 'M 100 98 L 138 122 L 236 108 L 246 168 L 122 174 L 94 140 Z',
    cx: 170,
    cy: 142
  },
  {
    num: 3,
    label: 'Purok 3',
    coastal: true,
    path: 'M 94 140 L 122 174 L 246 168 L 254 226 L 132 232 L 102 196 Z',
    cx: 174,
    cy: 200
  },
  {
    num: 4,
    label: 'Purok 4',
    coastal: true,
    path: 'M 102 196 L 132 232 L 254 226 L 266 284 L 154 288 L 114 252 Z',
    cx: 184,
    cy: 258
  },
  // Inland / Lower Flood Risk Zone (Puroks 5–8)
  {
    num: 5,
    label: 'Purok 5',
    coastal: false,
    path: 'M 222 46 L 368 42 L 382 106 L 236 108 Z',
    cx: 302,
    cy: 76
  },
  {
    num: 6,
    label: 'Purok 6',
    coastal: false,
    path: 'M 236 108 L 382 106 L 400 174 L 246 168 Z',
    cx: 316,
    cy: 140
  },
  {
    num: 7,
    label: 'Purok 7',
    coastal: false,
    path: 'M 246 168 L 400 174 L 418 236 L 254 226 Z',
    cx: 330,
    cy: 202
  },
  {
    num: 8,
    label: 'Purok 8',
    coastal: false,
    path: 'M 254 226 L 418 236 L 434 286 L 266 284 Z',
    cx: 344,
    cy: 260
  }
];

function extractPurokNum(name) {
  const m = String(name || '').match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

function choroplethFill(count, max) {
  if (!count || count <= 0) return '#e8f1f8';
  const ratio = count / Math.max(max, 1);
  if (ratio >= 0.75) return '#0f3d64';
  if (ratio >= 0.45) return '#156082';
  if (ratio >= 0.25) return '#1d8499';
  if (ratio >= 0.12) return '#4ea8b8';
  return '#a8d5e2';
}

function PurokDistributionView({ puroks = [], total = 0 }) {
  const [activeNum, setActiveNum] = useState(null);

  // Aggregate counts by Purok 1..8 (handling formats like "Purok 1", "PUROK 01", "Purok 1-A")
  const countByNum = {};
  for (let i = 1; i <= 8; i += 1) countByNum[i] = 0;
  for (const p of puroks) {
    const n = extractPurokNum(p.purok);
    if (n && n >= 1 && n <= 8) {
      countByNum[n] += Number(p.count) || 0;
    }
  }

  const maxCount = Math.max(...Object.values(countByNum), 1);
  const coastalCount = countByNum[1] + countByNum[2] + countByNum[3] + countByNum[4];
  const inlandCount = countByNum[5] + countByNum[6] + countByNum[7] + countByNum[8];
  const coastalShare = total > 0 ? Math.round((coastalCount / total) * 100) : 0;
  const inlandShare = total > 0 ? Math.round((inlandCount / total) * 100) : 0;

  // Default focused purok = highest density purok
  let topNum = 1;
  for (let i = 2; i <= 8; i += 1) {
    if (countByNum[i] > countByNum[topNum]) topNum = i;
  }
  const focusedNum = activeNum ?? topNum;
  const focusedZone = TAMBACAN_ZONES.find((z) => z.num === focusedNum) || TAMBACAN_ZONES[0];
  const focusedCount = countByNum[focusedNum] || 0;
  const focusedShare = total > 0 ? Math.round((focusedCount / total) * 100) : 0;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-center">
      {/* Left: Featured Interactive Barangay Tambacan Choropleth Map */}
      <div className="space-y-2.5 lg:col-span-7">
        <div className="relative overflow-hidden rounded-xl border border-slate-200/90 bg-gradient-to-br from-sky-50/80 via-slate-50 to-white p-3">
          <svg
            viewBox="0 0 510 315"
            className="h-auto w-full select-none"
            role="img"
            aria-label="Interactive choropleth zone map of Barangay Tambacan showing beneficiary density across Puroks 1 to 8"
          >
            {/* Iligan Bay & Tambacan River Backdrop */}
            <path
              d="M 0 0 L 120 0 C 96 70, 82 140, 92 210 C 98 255, 118 288, 145 315 L 0 315 Z"
              fill="#dbeeff"
            />
            <path
              d="M 88 0 C 120 26, 210 34, 385 32 L 510 24 L 510 0 Z"
              fill="#dbeeff"
            />
            {/* Subtle water contour lines */}
            <path
              d="M 20 65 Q 50 58, 74 68 M 14 145 Q 44 138, 68 148 M 22 230 Q 52 224, 78 234"
              fill="none"
              stroke="#93c5fd"
              strokeWidth="1.2"
              strokeLinecap="round"
              opacity="0.7"
            />

            {/* Geographic Water Labels */}
            <text
              x="44"
              y="185"
              transform="rotate(-90 44 185)"
              fill="#3b82f6"
              fontSize="10"
              fontWeight="700"
              letterSpacing="2"
              opacity="0.75"
            >
              ILIGAN BAY
            </text>
            <text
              x="215"
              y="21"
              fill="#2563eb"
              fontSize="9.5"
              fontWeight="700"
              letterSpacing="1.8"
              opacity="0.75"
            >
              TAMBACAN RIVER
            </text>

            {/* Compass Rose (Top Right) */}
            <g transform="translate(474, 52)">
              <circle cx="0" cy="0" r="14" fill="#ffffff" stroke="#cbd5e1" strokeWidth="1" />
              <polygon points="0,-9 3,0 0,-2 -3,0" fill="#0f2942" />
              <polygon points="0,9 3,0 0,2 -3,0" fill="#94a3b8" />
              <text x="0" y="-17" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="#475569">
                N
              </text>
            </g>

            {/* Subtle Inland Road Grid */}
            <path
              d="M 430 60 L 490 68 M 425 140 L 495 148 M 438 220 L 495 228"
              stroke="#e2e8f0"
              strokeWidth="1.2"
              strokeDasharray="3 3"
            />

            {/* Purok 1–8 Polygons */}
            {TAMBACAN_ZONES.map((z) => {
              const count = countByNum[z.num] || 0;
              const ratio = count / maxCount;
              const fill = choroplethFill(count, maxCount);
              const isDark = ratio >= 0.25 && count > 0;
              const isFocused = z.num === focusedNum;
              const isTop = z.num === topNum && count > 0;

              return (
                <g
                  key={z.num}
                  className="cursor-pointer transition-opacity"
                  onMouseEnter={() => setActiveNum(z.num)}
                  onFocus={() => setActiveNum(z.num)}
                  onClick={() => setActiveNum(z.num)}
                  tabIndex={0}
                  role="button"
                  aria-label={`${z.label}: ${count} records (${total > 0 ? Math.round((count / total) * 100) : 0}%)`}
                >
                  <path
                    d={z.path}
                    fill={fill}
                    stroke={isFocused ? '#f59e0b' : '#ffffff'}
                    strokeWidth={isFocused ? '2.8' : '1.6'}
                    strokeLinejoin="round"
                    opacity={activeNum && !isFocused ? 0.84 : 1}
                  />

                  {/* Purok Label */}
                  <text
                    x={z.cx}
                    y={z.cy + 4}
                    textAnchor="middle"
                    fontSize="12"
                    fontWeight="700"
                    fill={isDark ? '#ffffff' : '#0f2942'}
                  >
                    {z.label}
                  </text>
                </g>
              );
            })}

            {/* Dashed Coastal Flood-Zone Divider between P1-4 and P5-8 */}
            <path
              d="M 222 46 L 236 108 L 246 168 L 254 226 L 266 284"
              fill="none"
              stroke="#d97706"
              strokeWidth="2"
              strokeDasharray="5 4"
              pointerEvents="none"
            />
            <text
              x="175"
              y="305"
              textAnchor="middle"
              fontSize="9"
              fontWeight="700"
              fill="#b45309"
            >
              ▲ COASTAL FLOOD ZONE (P1–4)
            </text>
            <text
              x="345"
              y="305"
              textAnchor="middle"
              fontSize="9"
              fontWeight="700"
              fill="#0e7c7b"
            >
              INLAND ZONE (P5–8)
            </text>
          </svg>
        </div>

        {/* Density Color Legend */}
        <div className="flex items-center justify-center gap-2 px-1 text-[11px] text-slate-500">
          <div className="flex items-center gap-1.5">
            <span>Low</span>
            <span className="h-2.5 w-4 rounded-xs" style={{ backgroundColor: '#e8f1f8' }} />
            <span className="h-2.5 w-4 rounded-xs" style={{ backgroundColor: '#a8d5e2' }} />
            <span className="h-2.5 w-4 rounded-xs" style={{ backgroundColor: '#4ea8b8' }} />
            <span className="h-2.5 w-4 rounded-xs" style={{ backgroundColor: '#1d8499' }} />
            <span className="h-2.5 w-4 rounded-xs" style={{ backgroundColor: '#0f3d64' }} />
            <span>High</span>
          </div>
        </div>
      </div>

      {/* Right: Live Zone Spotlight, Coastal vs Inland Breakdown & Purok Grid */}
      <div className="space-y-3 lg:col-span-5">
        {/* Selected / Hovered Purok Spotlight */}
        <div className="rounded-xl border border-gov-200/80 bg-gradient-to-br from-gov-50/80 via-white to-white p-3.5 shadow-2xs">
          <div className="flex items-center justify-between gap-2">
            <span className="rounded-md bg-gov-700 px-2 py-0.5 text-xs font-bold text-white">
              {focusedZone.label}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                focusedZone.coastal
                  ? 'bg-amber-100 text-amber-900'
                  : 'bg-teal-100 text-teal-900'
              }`}
            >
              {focusedZone.coastal ? 'Coastal Flood Zone' : 'Inland Zone'}
            </span>
          </div>
          <div className="mt-2.5 flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums text-navy-950">{focusedCount}</span>
            <span className="text-xs font-semibold text-slate-500">
              of {total} records ({focusedShare}%)
            </span>
          </div>
          <p className="mt-1 text-[11.5px] text-slate-500">
            {focusedZone.coastal
              ? 'Waterfront / riverbank high flood hazard sub-zone'
              : 'Inland / lower flood risk sub-zone'}
          </p>
        </div>

        {/* Coastal vs. Inland Summary Cards */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-amber-200/90 bg-amber-50/70 px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-amber-900">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              Coastal (P1–4)
            </p>
            <p className="mt-1 text-lg font-bold tabular-nums text-amber-950">
              {coastalCount}{' '}
              <span className="text-xs font-semibold text-amber-800">({coastalShare}%)</span>
            </p>
          </div>
          <div className="rounded-lg border border-teal-200/80 bg-teal-50/60 px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-teal-900">
              <span className="h-2 w-2 rounded-full bg-teal-600" />
              Inland (P5–8)
            </p>
            <p className="mt-1 text-lg font-bold tabular-nums text-teal-950">
              {inlandCount}{' '}
              <span className="text-xs font-semibold text-teal-800">({inlandShare}%)</span>
            </p>
          </div>
        </div>

        {/* Quick-Select Purok 1–8 Grid */}
        <div className="grid grid-cols-4 gap-1.5">
          {TAMBACAN_ZONES.map((z) => {
            const count = countByNum[z.num] || 0;
            const isFocused = z.num === focusedNum;
            return (
              <button
                key={z.num}
                type="button"
                onMouseEnter={() => setActiveNum(z.num)}
                onClick={() => setActiveNum(z.num)}
                className={`rounded-lg border px-2 py-1.5 text-left transition-colors ${
                  isFocused
                    ? 'border-gov-600 bg-gov-50 ring-1 ring-gov-200'
                    : 'border-slate-200/80 bg-white hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <p className="text-[10.5px] font-semibold text-slate-500">Purok {z.num}</p>
                <p className="text-sm font-bold tabular-nums text-navy-950">{count}</p>
              </button>
            );
          })}
        </div>
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
          aside={livePill}
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="lg:col-span-2">
              <Figure
                title="Geographic density by purok"
                highlightTitle
              >
                <PurokDistributionView puroks={puroks} total={queue.total || 0} />
              </Figure>
            </div>

            <div className="lg:col-span-2">
              <Figure
                title="Application queue by status"
                highlightTitle
              >
                <QueueStatusView queue={queue} />
              </Figure>
            </div>

            <Figure
              title="Vulnerability scoring readiness"
              highlightTitle
            >
              <ScoringCoverageView scoring={scoring} total={scoreTotal} />
            </Figure>

            <Figure
              title="Priority category distribution"
              highlightTitle
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
