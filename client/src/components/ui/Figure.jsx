/**
 * Figure — the shared frame for one chart.
 *
 * Used by the Analytics page and the model-performance panel so every graph
 * has the same title/note/body rhythm, equal height in a grid row, and the
 * same print behaviour. This component renders layout only: the caller still
 * supplies every title, caption and number, so each figure keeps its own
 * honest provenance.
 *
 * `actions` is for a small badge or counter beside the title (hidden when
 * printing). `className` is for grid placement (e.g. "lg:col-span-2").
 */
export function Figure({ title, note, actions, children, className = '' }) {
  return (
    <section
      className={`flex h-full flex-col rounded-lg border border-line bg-white p-4 shadow-card print:break-inside-avoid print:border-0 print:bg-transparent print:p-0 print:shadow-none ${className}`}
    >
      <header className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold tracking-tight text-navy-900">{title}</h3>
          {note && <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-500">{note}</p>}
        </div>
        {actions && <div className="shrink-0 print:hidden">{actions}</div>}
      </header>
      <div className="flex-1">{children}</div>
    </section>
  );
}

export default Figure;
