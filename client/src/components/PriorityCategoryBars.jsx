import { VULNERABILITY_CLASSES } from '../lib/constants.js';

/**
 * Tone → bar fill (solid, print-friendly) using the same civic palette as
 * Badge so a category looks identical whether shown as a chip or a bar.
 * Limited to the documented civic tones — no new colours are invented.
 */
const TONE_FILL = {
  success: 'bg-emerald-500',   // Low
  info: 'bg-sky-600',          // Moderate
  warning: 'bg-amber-500',     // High
  danger: 'bg-rose-500',
  neutral: 'bg-slate-400'
};

const TONE_TEXT = {
  success: 'text-emerald-700',
  info: 'text-sky-700',
  warning: 'text-amber-700',
  danger: 'text-rose-700',
  neutral: 'text-slate-600'
};

const TONE_DOT = {
  success: 'bg-emerald-500',
  info: 'bg-sky-500',
  warning: 'bg-amber-500',
  danger: 'bg-rose-500',
  neutral: 'bg-slate-400'
};

/**
 * Optional sequential colorway for pages that read the chart as a scale
 * rather than as three status tones: teal → blue → navy, low to high.
 * Selected with `colorway="spectrum"`; the default stays tone-based so the
 * badges and the bar beside them keep matching everywhere else.
 */
const SPECTRUM = {
  Low: { fill: 'bg-teal-500', dot: 'bg-teal-500', text: 'text-teal-700' },
  Moderate: { fill: 'bg-gov-600', dot: 'bg-gov-600', text: 'text-gov-700' },
  High: { fill: 'bg-navy-700', dot: 'bg-navy-700', text: 'text-navy-800' }
};

/**
 * PriorityCategoryBars — a dependency-free horizontal bar chart of how many
 * scored records fall into each priority category (Low → High).
 *
 * Deliberately built with plain divs and Tailwind (no charting library) so
 * it:
 *   - adds no native/extra dependency to the workspace,
 *   - inherits the restrained civic palette and stays consistent with badges,
 *   - remains readable on screen, on mobile, and in the browser's
 *     Print → Save as PDF layout.
 *
 * Data source is always the API's live `by_class` breakdown (computed from
 * real current scores) — never hard-coded. When every count is zero the
 * component renders an explicit empty message instead of empty bars, so it
 * never implies data that does not exist.
 *
 * @param {Record<string, number>} counts  e.g. { Low: 3, Moderate: 5, ... }
 * @param {Record<string, string>} meta    class → { label, tone }
 */
export function PriorityCategoryBars({ counts = {}, meta = {}, total, colorway }) {
  // Keep the documented Low → High order regardless of object key order.
  const rows = VULNERABILITY_CLASSES.map((cls) => ({
    cls,
    label: meta[cls]?.label || cls,
    tone: meta[cls]?.tone || 'neutral',
    count: Number(counts[cls] || 0)
  }));

  const sum = rows.reduce((acc, r) => acc + r.count, 0);
  const denominator = total ?? sum;

  if (sum === 0) {
    return (
      <p className="text-[13px] text-slate-500">
        No scored records yet — the category breakdown appears once records are scored.
      </p>
    );
  }

  return (
    <ul className="space-y-3.5 print:space-y-2">
      {rows.map((r) => {
        // Bar length is the category's share of the stated denominator, the
        // same quantity as the percentage printed beside it. A minimum sliver
        // keeps a non-zero count visible; the exact figure is always shown.
        const share = denominator > 0 ? (r.count / denominator) * 100 : 0;
        const shareText = share.toFixed(denominator > 0 && denominator < 10 ? 1 : 0);
        const palette =
          colorway === 'spectrum'
            ? SPECTRUM[r.cls]
            : {
                fill: TONE_FILL[r.tone] || TONE_FILL.neutral,
                dot: TONE_DOT[r.tone] || TONE_DOT.neutral,
                text: TONE_TEXT[r.tone] || TONE_TEXT.neutral
              };
        return (
          <li key={r.cls}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-[12.5px]">
              <span className="flex items-center gap-1.5 font-medium text-navy-800">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${palette.dot}`}
                  aria-hidden="true"
                />
                {r.label}
              </span>
              <span className="shrink-0 tabular-nums">
                <span className={`font-semibold ${palette.text}`}>
                  {r.count}
                </span>
                <span className="ml-1.5 inline-block w-10 text-right text-[11.5px] font-medium text-slate-500">
                  {shareText}%
                </span>
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200/70 print:bg-slate-100 print:ring-0">
              <span
                className={`block h-full rounded-full transition-all duration-500 ${palette.fill} print:opacity-90`}
                style={{ width: `${r.count > 0 ? Math.max(share, 3) : 0}%` }}
                aria-hidden="true"
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default PriorityCategoryBars;
