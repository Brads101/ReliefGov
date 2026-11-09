/**
 * Dependency-free horizontal bars, used by the Analytics page. Rendered with
 * plain divs so it prints cleanly through the browser's
 * Print → Save as PDF path — no charting library, no canvas, no SVG export
 * dependency.
 */

/**
 * Bar fills for the Analytics charts. The palette runs navy → blue → teal so
 * the page reads as one institutional family instead of switching into
 * warning orange; series identity still comes from the label and the printed
 * share, not from the colour alone.
 */
const TONE_FILL = {
  success: 'bg-teal-600',
  info: 'bg-gov-600',
  warning: 'bg-gov-400',
  danger: 'bg-navy-800',
  neutral: 'bg-slate-400'
};

const TONE_DOT = {
  success: 'bg-teal-500',
  info: 'bg-gov-500',
  warning: 'bg-gov-400',
  danger: 'bg-navy-700',
  neutral: 'bg-slate-400'
};

/** "18%" — one decimal only while the denominator is small enough to need it. */
function shareText(value, sum) {
  const pct = sum > 0 ? (value / sum) * 100 : 0;
  return `${pct.toFixed(sum > 0 && sum < 10 ? 1 : 0)}%`;
}

/**
 * `rows`   = [{ key, label, value, tone }]
 * `total`  = the denominator stated in the caption. If it is omitted the row
 *            values are summed, so a share is never computed against a number
 *            the caption does not show.
 * `suffix` = unit appended after the count (e.g. 'packs').
 *
 * The filled length is the row's share of that same denominator, so the bar
 * and the printed percentage always describe the same quantity.
 */
export function BarList({ rows, total, suffix }) {
  const sum = total ?? rows.reduce((acc, r) => acc + (Number(r.value) || 0), 0);
  return (
    <ul className="space-y-3">
      {rows.map((r) => {
        const value = Number(r.value) || 0;
        const pct = sum > 0 ? (value / sum) * 100 : 0;
        const fill = TONE_FILL[r.tone] || TONE_FILL.info;
        const dot = TONE_DOT[r.tone] || TONE_DOT.info;
        return (
          <li key={r.key}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-[12.5px]">
              <span className="flex min-w-0 items-center gap-1.5 text-navy-800">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
                <span className="truncate font-medium" title={r.label}>
                  {r.label}
                </span>
              </span>
              <span className="shrink-0 tabular-nums text-navy-900">
                <span className="font-semibold">
                  {value.toLocaleString()}
                  {suffix ? ` ${suffix}` : ''}
                </span>
                <span className="ml-1.5 inline-block w-11 text-right text-[11.5px] font-medium text-slate-500">
                  {shareText(value, sum)}
                </span>
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200/70 print:bg-slate-100 print:ring-0">
              <span
                className={`block h-full rounded-full ${fill} print:opacity-90`}
                style={{ width: `${value > 0 ? Math.max(pct, 2) : 0}%` }}
                aria-hidden="true"
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** A single full-width progress bar with a stated numerator/denominator. */
export function ProgressTrack({ value, total, tone = 'success', label }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  const fill = TONE_FILL[tone] || TONE_FILL.success;
  return (
    <div>
      <div className="relative h-4 w-full overflow-hidden rounded-full bg-slate-200/80 print:bg-slate-100">
        <span
          className={`absolute inset-y-0 left-0 rounded-full ${fill} print:opacity-90`}
          style={{ width: `${pct}%` }}
          aria-hidden="true"
        />
      </div>
      {label && <p className="mt-2 text-[12.5px] text-slate-600">{label}</p>}
    </div>
  );
}

export default BarList;
