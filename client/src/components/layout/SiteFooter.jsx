import { Link } from 'react-router-dom';
import { LogoMark } from '../ui/Logo.jsx';

/**
 * Philippine-government-style site footer (modelled on the DPWH / gov.ph
 * footer layout): brand header, link columns, and a lower "republic" strip.
 * Colours match the sidebar rail (bg-navy-900, navy-100/200 body text,
 * white headings, teal accents) so the page is framed consistently.
 *
 * Every link is either a real in-app route (filtered by role, mirroring
 * navigation.jsx) or a verified official external website. Contact details
 * are office/location lines only — no phone numbers, e-mails, seals, or
 * social accounts are invented.
 */

const PORTAL_LINKS = [
  { to: '/dashboard', label: 'Dashboard', roles: ['beneficiary', 'barangay_staff', 'cswd_staff'] },
  { to: '/notifications', label: 'Notifications', roles: ['beneficiary', 'barangay_staff', 'cswd_staff'] },
  { to: '/application', label: 'My Application', roles: ['beneficiary'] },
  { to: '/profile', label: 'Manage Profile', roles: ['beneficiary'] }
];

const OPS_LINKS = [
  { to: '/beneficiaries', label: 'Beneficiary Profiles', roles: ['barangay_staff', 'cswd_staff'] },
  { to: '/validation', label: 'Validation & Duplicates', labelByRole: { barangay_staff: 'Data Validation' }, roles: ['barangay_staff', 'cswd_staff'] },
  { to: '/scoring', label: 'Vulnerability Scoring', roles: ['barangay_staff', 'cswd_staff'] },
  { to: '/monitoring', label: 'Distribution Monitoring', roles: ['barangay_staff', 'cswd_staff'] },
  { to: '/reports', label: 'Reports', roles: ['barangay_staff', 'cswd_staff'] },
  { to: '/users', label: 'User Management', roles: ['cswd_staff'] }
];

function visible(items, role) {
  return items
    .filter((item) => item.roles.includes(role))
    .map((item) => ({ ...item, label: item.labelByRole?.[role] || item.label }));
}

function Column({ title, children }) {
  return (
    <div>
      <h3 className="relative pb-2.5 text-[13.5px] font-semibold text-white after:absolute after:bottom-0 after:left-0 after:h-[2px] after:w-8 after:rounded-full after:bg-teal-400 after:content-['']">
        {title}
      </h3>
      <ul className="mt-3 space-y-0.5">{children}</ul>
    </div>
  );
}

function ExtLink({ href, children }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="block -mx-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium leading-snug text-navy-200 transition-colors hover:bg-white/5 hover:text-white"
    >
      {children}
    </a>
  );
}

function AppLink({ to, children }) {
  return (
    <Link
      to={to}
      className="block -mx-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium leading-snug text-navy-200 transition-colors hover:bg-white/5 hover:text-white"
    >
      {children}
    </Link>
  );
}

export function SiteFooter({ role = 'beneficiary' }) {
  const portal = visible(PORTAL_LINKS, role);
  const ops = visible(OPS_LINKS, role);

  return (
    <footer className="relative">
      {/* Main footer panel — sidebar navy (bg-navy-900) with light text */}
      <div className="relative border-t border-white/10 bg-navy-900 px-4 py-8 sm:px-6 lg:px-8">
        {/* Teal accent line framing the top edge, fading into the navy */}
        <div
          className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-teal-400 via-gov-500 to-transparent"
          aria-hidden="true"
        />
        {/* Brand header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <LogoMark className="h-12 w-12" />
            <div className="leading-tight">
              <p className="text-[12px] text-navy-300">Republic of the Philippines</p>
              <p className="text-xl font-semibold tracking-tight text-white">ReliefGov</p>
              <p className="mt-0.5 text-[13px] font-medium text-navy-100">
                Disaster Assistance Profiling and Beneficiary Validation System
              </p>
            </div>
          </div>
          <div className="inline-flex items-center gap-2 rounded-md border border-white/20 bg-white/5 px-3 py-2 text-[12.5px] font-medium text-navy-100">
            <span className="h-1.5 w-1.5 rounded-full bg-teal-400" aria-hidden="true" />
            City Social Welfare and Development (CSWD) Office · Iligan City
          </div>
        </div>

        {/* Link columns — flex so the row stays balanced for every role */}
        <div className="mt-8 flex flex-wrap gap-x-10 gap-y-8">
          {portal.length > 0 && (
            <div className="min-w-[190px] flex-1">
              <Column title="Portal">{portal.map((l) => <li key={l.to}><AppLink to={l.to}>{l.label}</AppLink></li>)}</Column>
            </div>
          )}
          {ops.length > 0 && (
            <div className="min-w-[190px] flex-1">
              <Column title="Assistance Operations">
                {ops.map((l) => <li key={l.to}><AppLink to={l.to}>{l.label}</AppLink></li>)}
              </Column>
            </div>
          )}
          <div className="min-w-[190px] flex-1">
            <Column title="Offices">
              <li className="-mx-2.5 px-2.5 py-1.5 text-[13px] leading-snug text-navy-100">Barangay Tambacan, Iligan City</li>
              <li className="-mx-2.5 px-2.5 py-1.5 text-[13px] leading-snug text-navy-100">
                City Social Welfare and Development (CSWD) Office
              </li>
              <li><ExtLink href="https://www.dswd.gov.ph">Department of Social Welfare and Development</ExtLink></li>
            </Column>
          </div>
          <div className="min-w-[190px] flex-1">
            <Column title="Contact Us">
              <li className="-mx-2.5 px-2.5 py-1.5 text-[13px] leading-snug text-navy-100">
                Office of the City Social Welfare and Development (CSWD)
              </li>
              <li className="-mx-2.5 px-2.5 py-1.5 text-[13px] leading-snug text-navy-100">Iligan City, Lanao del Norte</li>
              <li className="-mx-2.5 px-2.5 py-1.5 text-[13px] leading-snug text-navy-100">Barangay Tambacan</li>
            </Column>
          </div>
        </div>
      </div>

      {/* Lower republic strip — deeper navy band, like the reference's second tone */}
      <div className="border-t border-white/10 bg-navy-950 px-4 py-7 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-7 sm:grid-cols-2">
          <div>
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-teal-200">
              Republic of the Philippines
            </h4>
            <p className="mt-2.5 text-[12.5px] leading-relaxed text-navy-100">
              Barangay Tambacan, Iligan City, Lanao del Norte.
            </p>
            <p className="mt-1.5 text-[12.5px] font-medium italic text-white">
              Serving Communities. Supporting Recovery.
            </p>
          </div>
          <div>
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-teal-200">About ReliefGov</h4>
            <p className="mt-2.5 text-[12.5px] leading-relaxed text-navy-100">
              A web-based system for beneficiary profiling, record validation, AI-assisted
              vulnerability scoring, and disaster-assistance monitoring — supporting the work of
              the CSWD Office and barangay social workers.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default SiteFooter;
