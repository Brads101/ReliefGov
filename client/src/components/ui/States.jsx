export function Spinner({ label = 'Loading…', className = 'h-5 w-5' }) {
  return (
    <span className="inline-flex items-center gap-2 text-slate-500">
      <span className={`${className} animate-spin rounded-full border-2 border-gov-600 border-t-transparent`} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function LoadingState({ label = 'Loading records…', minHeight = 'min-h-[200px]' }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 ${minHeight} rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-8 text-center`}>
      <Spinner className="h-6 w-6" />
      <p className="text-sm font-medium text-slate-600">{label}</p>
    </div>
  );
}

export function EmptyState({ title, description, action, minHeight = 'min-h-[200px]' }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2.5 ${minHeight} rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-8 text-center`}>
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-500 shadow-sm">
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7.5A1.5 1.5 0 0 1 17.5 19h-13A1.5 1.5 0 0 1 3 17.5v-10Z" />
        </svg>
      </div>
      <p className="text-[14px] font-bold text-slate-800">{title}</p>
      {description && <p className="max-w-md text-[13px] text-slate-500">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', description, onRetry }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-2.5 rounded-xl border border-rose-200 bg-rose-50/80 p-8 text-center shadow-sm"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-100 text-rose-600">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <p className="text-sm font-bold text-rose-800">{title}</p>
      {description && <p className="max-w-md text-[13px] text-rose-700">{description}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded-lg border border-rose-300 bg-white px-3.5 py-1.5 text-[13px] font-semibold text-rose-700 hover:bg-rose-50 shadow-sm transition-colors"
        >
          Try again
        </button>
      )}
    </div>
  );
}

export function InlineAlert({ level = 'info', title, children }) {
  const tones = {
    info: {
      box: 'border-sky-200 bg-gradient-to-r from-sky-50 via-sky-50/60 to-white text-sky-950',
      title: 'text-sky-900',
      bar: 'bg-sky-500'
    },
    success: {
      box: 'border-emerald-200 bg-gradient-to-r from-emerald-50 via-emerald-50/60 to-white text-emerald-950',
      title: 'text-emerald-900',
      bar: 'bg-emerald-500'
    },
    warning: {
      box: 'border-amber-200 bg-gradient-to-r from-amber-50 via-amber-50/60 to-white text-amber-950',
      title: 'text-amber-900',
      bar: 'bg-amber-500'
    },
    error: {
      box: 'border-rose-200 bg-gradient-to-r from-rose-50 via-rose-50/60 to-white text-rose-950',
      title: 'text-rose-900',
      bar: 'bg-rose-500'
    }
  };
  const t = tones[level] || tones.info;
  return (
    <div className={`relative flex items-start gap-3 rounded-xl border p-3.5 text-[13px] shadow-sm ${t.box}`} role="status">
      <span className={`mt-0.5 h-3.5 w-1 shrink-0 rounded-full ${t.bar}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title && <p className={`font-bold ${t.title}`}>{title}</p>}
        {children && <div className={title ? 'mt-0.5 leading-relaxed' : 'leading-relaxed'}>{children}</div>}
      </div>
    </div>
  );
}
