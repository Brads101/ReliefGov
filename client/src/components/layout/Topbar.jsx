/**
 * Top bar — intentionally empty of content. Page titles live in PageHeader,
 * and the account identity + sign out were moved to the sidebar (above its
 * footer). Only the mobile menu trigger remains so the navigation drawer can
 * still be opened on small screens.
 */
export default function Topbar({ onOpenMenu }) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-white/95 px-4 sm:px-6 lg:hidden">
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Open menu"
        className="rounded-md p-2 text-navy-700 hover:bg-surface-muted lg:hidden"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
        </svg>
      </button>
    </header>
  );
}
