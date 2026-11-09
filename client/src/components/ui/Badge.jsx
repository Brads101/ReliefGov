const TONES = {
  neutral: 'bg-slate-100/90 text-slate-700 border-slate-200/90 shadow-sm font-medium',
  info: 'bg-sky-50 text-sky-800 border-sky-200 shadow-sm font-semibold',
  success: 'bg-emerald-50 text-emerald-800 border-emerald-200 shadow-sm font-semibold',
  warning: 'bg-amber-50 text-amber-900 border-amber-200 shadow-sm font-semibold',
  danger: 'bg-rose-50 text-rose-800 border-rose-200 shadow-sm font-semibold'
};

export default function Badge({ tone = 'neutral', children, className = '' }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11.5px] tracking-wide transition-colors ${TONES[tone] || TONES.neutral} ${className}`}
    >
      {children}
    </span>
  );
}
