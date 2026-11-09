export function PageHeader({ title, subtitle, description, actions }) {
  const desc = description || subtitle;
  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900 sm:text-2xl">{title}</h1>
          {desc && <p className="mt-1 max-w-3xl text-[13.5px] text-slate-600">{desc}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function StatCard({ label, value, hint, tone = 'neutral', icon }) {
  const styles = {
    neutral: {
      value: 'text-slate-900',
      border: 'border-t-slate-700',
      iconBg: 'bg-slate-100 text-slate-700 ring-1 ring-slate-200 shadow-sm',
      glow: 'from-slate-50/60'
    },
    info: {
      value: 'text-sky-800',
      border: 'border-t-sky-600',
      iconBg: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200 shadow-sm',
      glow: 'from-sky-50/50'
    },
    success: {
      value: 'text-emerald-800',
      border: 'border-t-emerald-600',
      iconBg: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 shadow-sm',
      glow: 'from-emerald-50/50'
    },
    warning: {
      value: 'text-amber-800',
      border: 'border-t-amber-500',
      iconBg: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200 shadow-sm',
      glow: 'from-amber-50/60'
    },
    danger: {
      value: 'text-rose-700',
      border: 'border-t-rose-500',
      iconBg: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200 shadow-sm',
      glow: 'from-rose-50/60'
    }
  };
  const s = styles[tone] || styles.neutral;
  return (
    <div
      className={`rg-card relative overflow-hidden border-t-4 ${s.border} bg-gradient-to-br ${s.glow} via-white to-white p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
          <p className={`mt-2 text-3xl font-extrabold tracking-tight tabular-nums ${s.value}`}>
            {value ?? '—'}
          </p>
          {hint && <p className="mt-1.5 text-[12.5px] font-medium text-slate-500">{hint}</p>}
        </div>
        {icon && (
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${s.iconBg}`}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}

export default PageHeader;
