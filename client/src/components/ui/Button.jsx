const VARIANTS = {
  primary:
    'bg-gradient-to-r from-gov-700 via-gov-600 to-sky-600 hover:from-gov-800 hover:via-gov-700 hover:to-sky-700 text-white border border-gov-700/80 shadow-[0_1px_3px_rgba(23,54,93,0.25)] hover:shadow-md focus-visible:ring-gov-600 font-semibold',
  secondary:
    'bg-white text-slate-700 border border-slate-300/90 hover:bg-slate-50 hover:border-slate-400 hover:text-slate-900 shadow-sm focus-visible:ring-gov-600 font-medium',
  danger:
    'bg-gradient-to-r from-red-600 via-rose-600 to-rose-700 hover:from-red-700 hover:via-rose-700 hover:to-rose-800 text-white border border-red-700 shadow-sm hover:shadow-md focus-visible:ring-red-500 font-semibold',
  ghost:
    'bg-transparent text-slate-700 border border-transparent hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-gov-600 font-medium'
};

const SIZES = {
  sm: 'px-3 py-1.5 text-[12.5px] rounded-lg',
  md: 'px-4 py-2 text-sm rounded-lg',
  lg: 'px-5 py-2.5 text-sm rounded-xl'
};

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  className = '',
  children,
  type = 'button',
  ...rest
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 transition-all duration-150 active:scale-[0.98]
        focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2
        disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {loading && (
        <span
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
      )}
      {children}
    </button>
  );
}
