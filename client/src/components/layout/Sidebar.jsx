import { NavLink, useNavigate } from 'react-router-dom';
import { Logo, Wordmark } from '../ui/Logo.jsx';
import { navForRole, Icon, ROLE_LABELS } from '../../config/navigation.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

export default function Sidebar({ role, mobileOpen, onClose }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const sections = navForRole(role || 'beneficiary');

  // Account initials — same derivation the top bar used
  const initials = (user?.full_name || user?.email || '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

  return (
    <>
      {/* Mobile scrim */}
      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-navy-950/40 lg:hidden" onClick={onClose} aria-hidden="true" />
      )}

      {/* Desktop & Mobile: fixed full-height rail permanently pinned to viewport.
          Does not scroll with page content; content is sized so the sidebar itself fits without scrolling. */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-gradient-to-b from-[#0A1628] via-[#0E1E38] to-[#071120] border-r border-slate-800/80 shadow-2xl transition-transform duration-200 h-screen overflow-hidden ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
        aria-label="Primary navigation"
      >
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-white/[0.08] px-4 bg-white/[0.02]">
          <div className="flex items-center gap-2.5">
            <Logo compact />
            <Wordmark />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white lg:hidden transition-colors"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden="true">
              <path d="M6.3 4.9 4.9 6.3 8.6 10l-3.7 3.7 1.4 1.4L10 11.4l3.7 3.7 1.4-1.4L11.4 10l3.7-3.7-1.4-1.4L10 8.6 6.3 4.9Z" />
            </svg>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-3 select-none [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {sections.map((section) => (
            <div key={section.label}>
              <p className="px-2.5 pb-1 pt-0.5 text-[10px] font-bold uppercase tracking-[0.2em] text-sky-400/90">
                {section.label}
              </p>
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      onClick={onClose}
                      className={({ isActive }) =>
                        `flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13.5px] transition-all duration-150 ${
                          isActive
                            ? 'bg-gradient-to-r from-gov-500/35 via-sky-500/20 to-white/[0.02] text-white font-semibold border-l-2 border-sky-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                            : 'text-slate-300 font-medium hover:bg-white/[0.07] hover:text-white'
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <Icon
                            name={item.icon}
                            className={`h-4 w-4 shrink-0 transition-colors ${isActive ? 'text-sky-300' : 'text-slate-400'}`}
                          />
                          <span className="truncate">{item.label}</span>
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* Signed-in account + sign out card */}
        <div className="shrink-0 border-t border-white/[0.08] p-3">
          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-2.5 shadow-inner">
            <div className="flex items-center gap-2.5">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-tr from-gov-600 to-sky-500 text-[12px] font-bold uppercase tracking-wider text-white shadow-md ring-1 ring-white/20"
                aria-hidden="true"
              >
                {initials}
              </span>
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-[13px] font-semibold text-white">{user?.full_name}</p>
                <p className="truncate text-[11.5px] text-sky-200/80">
                  {ROLE_LABELS[user?.role] || user?.role}
                  {user?.barangay ? ` · ${user.barangay}` : ''}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                logout();
                navigate('/login');
              }}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[12px] font-semibold text-red-200 transition-all hover:bg-red-500/25 hover:border-red-400/50 hover:text-white shadow-sm"
            >
              <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M13 3h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-3M9 14l4-4-4-4M13 10H3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Sign out
            </button>
          </div>
        </div>

        <div className="shrink-0 border-t border-white/[0.08] px-3.5 py-2 bg-black/[0.15]">
          <p className="text-[10.5px] font-medium leading-tight text-slate-400">
            City Social Welfare & Development (CSWD)
          </p>
          <p className="text-[10px] text-slate-500">Iligan City · Lanao del Norte</p>
        </div>
      </aside>
    </>
  );
}
