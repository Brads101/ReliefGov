export function Card({ title, subtitle, actions, children, className = '', padded = true, accent = false }) {
  return (
    <section
      className={`rg-card overflow-hidden transition-all duration-200 ${
        accent ? 'border-t-4 border-t-gov-600' : ''
      } ${className}`}
    >
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200/80 bg-gradient-to-r from-slate-50/90 via-sky-50/20 to-white px-5 py-3.5">
          <div className="flex items-start gap-2.5">
            <span className="mt-1 h-3.5 w-1 shrink-0 rounded-full bg-gradient-to-b from-gov-600 to-sky-500 shadow-[0_0_6px_rgba(36,90,129,0.35)]" aria-hidden="true" />
            <div>
              {title && <h2 className="text-[14.5px] font-bold tracking-tight text-slate-900">{title}</h2>}
              {subtitle && <p className="mt-0.5 text-[12.5px] font-normal text-slate-500">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </section>
  );
}

export default Card;
