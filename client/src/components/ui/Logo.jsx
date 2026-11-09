/**
 * ReliefGov brand marks — logo, wordmark, and stacked lockup.
 * The Iligan City emblem (project-supplied design asset, served from
 * public/reliefgov-emblem.png) renders inside a small white badge so it stays
 * clear on both the dark navy rail and light card backgrounds, using
 * object-contain so its proportions are never distorted. One shared component
 * keeps sign-in, sign-up, password screens, and the sidebar consistent —
 * callers pass a size via className (larger on the sign-in landing panel,
 * compact for navigation/dashboard branding).
 */
const EMBLEM_SRC = '/reliefgov-emblem.png';

export function LogoMark({ className = 'h-9 w-9' }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-black/10 bg-white ${className}`}
    >
      <img
        src={EMBLEM_SRC}
        alt="ReliefGov logo"
        className="h-full w-full object-contain p-[4%]"
      />
    </span>
  );
}

export function Wordmark({ className = '' }) {
  return (
    <span className={`leading-tight ${className}`}>
      <span className="block text-[15px] font-semibold tracking-tight text-white">
        Relief<span className="text-teal-300">Gov</span>
      </span>
      <span className="block text-[10.5px] font-medium uppercase tracking-[0.14em] text-navy-300">
        Iligan City LGU
      </span>
    </span>
  );
}

export function Logo({ compact = false, dark = false }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark className="h-9 w-9 shrink-0" />
      {!compact && (
        <Wordmark className={dark ? 'text-navy-900 [&>span]:text-navy-900' : ''} />
      )}
    </div>
  );
}

export default Logo;
