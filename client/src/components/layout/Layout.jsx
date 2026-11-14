import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import Topbar from './Topbar.jsx';
import SiteFooter from './SiteFooter.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

export default function Layout() {
  const { user } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Sidebar role={user?.role} mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="relative flex min-w-0 flex-1 flex-col lg:pl-64 min-h-screen">
        {/* Civic landscape background — prominent behind page text & cards with blue/sky wash */}
        <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
          <img
            src="/images/dashboard-civic-bg.jpg"
            alt=""
            className="h-full w-full object-cover object-center opacity-40"
          />
          <div className="absolute inset-0 bg-gradient-to-br from-white/80 via-white/60 to-sky-100/40" />
        </div>
        <Topbar onOpenMenu={() => setMobileOpen(true)} />
        <main className="relative flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
        <SiteFooter role={user?.role} />
      </div>
    </div>
  );
}
