import { Link } from 'react-router-dom';

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

export function StatCard({ label, value, hint, tone = 'neutral', icon, to, onClick }) {
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

  const cardBody = (
    <div
      className={`rg-card relative flex flex-col justify-between h-full overflow-hidden border-t-4 ${s.border} bg-gradient-to-br ${s.glow} via-white to-white p-5 transition-all duration-200 ${
        to || onClick
          ? 'cursor-pointer hover:-translate-y-1 hover:shadow-lg hover:ring-2 hover:ring-gov-500/20 active:translate-y-0'
          : 'hover:-translate-y-0.5 hover:shadow-md'
      }`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-h-[28px]">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
            {to && (
              <svg viewBox="0 0 20 20" className="h-3 w-3 shrink-0 text-slate-400 opacity-0 transition-opacity group-hover:opacity-100" fill="currentColor">
                <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
              </svg>
            )}
          </div>
          <p className={`mt-2 text-3xl font-extrabold tracking-tight tabular-nums ${s.value}`}>
            {value ?? '—'}
          </p>
          {hint && <p className="mt-1.5 text-[12.5px] font-medium text-slate-500 min-h-[38px]">{hint}</p>}
        </div>
        {icon && (
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-transform ${to ? 'group-hover:scale-105' : ''} ${s.iconBg}`}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );

  if (to) {
    return (
      <Link to={to} className="group flex flex-col h-full focus:outline-none focus-visible:ring-2 focus-visible:ring-gov-600 rounded-xl">
        {cardBody}
      </Link>
    );
  }

  return cardBody;
}

export default PageHeader;
