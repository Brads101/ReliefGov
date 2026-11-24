import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { LogoMark } from '../components/ui/Logo.jsx';

const NAV_LINKS = [
  { href: '#objectives', label: 'Objectives' },
  { href: '#highlights', label: 'Highlights' },
  { href: '#how-it-works', label: 'Approval Process' },
  { href: '#coverage', label: 'Coverage' }
];

const QUICK_HIGHLIGHTS = [
  {
    value: '8 Puroks',
    label: 'Barangay Tambacan Coverage',
    detail: 'Serving both coastal/riverbank (P1–P4) and inland communities (P5–P8)'
  },
  {
    value: 'Online Portal',
    label: 'Simple Digital Application',
    detail: 'Submit household requests and supporting documents from any device'
  },
  {
    value: 'Live Analytics',
    label: 'Community Relief Overview',
    detail: 'Clear purok-level coverage and relief distribution tracking for local leaders'
  },
  {
    value: 'Real-Time',
    label: 'Application Status Updates',
    detail: 'Receive timely notifications from submission up to relief release'
  }
];

const SYSTEM_OBJECTIVES = [
  {
    number: '01',
    title: 'Faster Access to Disaster Assistance',
    description:
      'Make it easier for affected families in Barangay Tambacan to request relief assistance online without long queues or repetitive paperwork.',
    accent: 'bg-gov-50 text-gov-700 border-gov-200',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    )
  },
  {
    number: '02',
    title: 'Fair & Organized Relief Delivery',
    description:
      'Support Barangay Tambacan and the Iligan City CSWD Office in reviewing applications carefully so assistance reaches every eligible household fairly.',
    accent: 'bg-teal-50 text-teal-700 border-teal-200',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
      </svg>
    )
  },
  {
    number: '03',
    title: 'Clear Community Analytics & Monitoring',
    description:
      'Provide local welfare offices with up-to-date purok coverage maps, relief progress summaries, and organized distribution records.',
    accent: 'bg-alert-50 text-alert-700 border-alert-200',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    )
  }
];

const PLATFORM_HIGHLIGHTS = [
  {
    tag: 'For Residents',
    title: 'Guided Online Application',
    description:
      'A clear, step-by-step form where Barangay Tambacan residents can share household information, attach proof of residency, and update details whenever needed.',
    accent: 'bg-gov-50 text-gov-700 border-gov-200',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
      </svg>
    )
  },
  {
    tag: 'Community Analytics',
    title: 'Purok Coverage & Relief Insights',
    description:
      'Interactive barangay zone maps and visual dashboards help CSWD and barangay coordinators see which puroks need immediate attention and track relief progress.',
    accent: 'bg-teal-50 text-teal-700 border-teal-200',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
      </svg>
    )
  },
  {
    tag: 'Coordinated Review',
    title: 'Barangay & CSWD Collaboration',
    description:
      'Barangay social workers and Iligan City CSWD officers work from one unified platform to verify households, coordinate aid, and keep records accurate.',
    accent: 'bg-navy-50 text-navy-700 border-navy-200',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
      </svg>
    )
  },
  {
    tag: 'Stay Informed',
    title: 'Real-Time Status Notifications',
    description:
      'Residents receive clear updates when their application is received, if a document needs to be re-uploaded, or once their assistance is approved and ready.',
    accent: 'bg-alert-50 text-alert-700 border-alert-200',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
      </svg>
    )
  }
];

const APPROVAL_STEPS = [
  {
    step: '01',
    actor: 'Resident',
    title: 'Submit Your Application',
    description:
      'Create an account, fill out your household profile, and upload a clear photo of your Barangay Certificate, National ID, or Barangay ID.'
  },
  {
    step: '02',
    actor: 'Barangay Tambacan',
    title: 'Local Residency Verification',
    description:
      'Barangay staff confirm your residency within Puroks 1–8 and check that your submitted details and documents are complete and readable.'
  },
  {
    step: '03',
    actor: 'CSWD Office',
    title: 'Assessment & Approval',
    description:
      'The Iligan City CSWD Office reviews verified household applications, prioritizes urgent needs, and issues official assistance approval.'
  },
  {
    step: '04',
    actor: 'Distribution Team',
    title: 'Relief Assistance Release',
    description:
      'Approved families are notified through the portal and scheduled for organized, hassle-free relief package distribution.'
  }
];

export default function Home() {
  const { user } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-surface text-slate-900">
      {/* Sticky Civic Navigation Bar */}
      <header className="sticky top-0 z-40 border-b border-line bg-white/95 backdrop-blur-md">
        <div className="rg-container flex h-16 items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-3">
            <LogoMark className="h-10 w-10" />
            <div className="leading-tight">
              <p className="text-base font-bold tracking-tight text-navy-900">
                Relief<span className="text-gov-600">Gov</span>
              </p>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Iligan City LGU Portal
              </p>
            </div>
          </Link>

          <nav className="hidden items-center gap-6 md:flex" aria-label="Primary">
            {NAV_LINKS.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="text-[13.5px] font-medium text-slate-600 transition-colors hover:text-navy-800"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="hidden items-center gap-2.5 md:flex">
            {user ? (
              <Link
                to="/dashboard"
                className="inline-flex items-center gap-2 rounded-lg bg-navy-700 px-4 py-2 text-[13.5px] font-semibold text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-navy-800"
              >
                Go to Dashboard
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-[13.5px] font-semibold text-navy-800 transition-all duration-200 hover:-translate-y-0.5 hover:bg-slate-50"
                >
                  Sign In
                </Link>
                <Link
                  to="/register"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-gov-600 px-4 py-2 text-[13.5px] font-semibold text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-gov-700"
                >
                  Apply for Assistance
                </Link>
              </>
            )}
          </div>

          {/* Mobile menu toggle */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            className="inline-flex items-center justify-center rounded-lg border border-line p-2 text-slate-600 hover:bg-slate-50 md:hidden"
            aria-label="Toggle navigation menu"
            aria-expanded={mobileMenuOpen}
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {mobileMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              )}
            </svg>
          </button>
        </div>

        {/* Mobile dropdown */}
        {mobileMenuOpen && (
          <div className="border-t border-line bg-white px-4 py-4 md:hidden">
            <div className="flex flex-col gap-3">
              {NAV_LINKS.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="text-sm font-medium text-slate-700 hover:text-navy-800"
                >
                  {item.label}
                </a>
              ))}
              <div className="mt-2 flex flex-col gap-2 border-t border-line pt-3">
                {user ? (
                  <Link
                    to="/dashboard"
                    className="inline-flex items-center justify-center rounded-lg bg-navy-700 px-4 py-2.5 text-sm font-semibold text-white"
                  >
                    Go to Dashboard
                  </Link>
                ) : (
                  <>
                    <Link
                      to="/login"
                      className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-navy-800"
                    >
                      Sign In
                    </Link>
                    <Link
                      to="/register"
                      className="inline-flex items-center justify-center rounded-lg bg-gov-600 px-4 py-2.5 text-sm font-semibold text-white"
                    >
                      Apply for Assistance
                    </Link>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Hero Banner */}
      <section className="relative overflow-hidden bg-navy-950">
        <img
          src="/images/relief-iligan.jpg"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover object-center opacity-35"
        />
        <div
          className="absolute inset-0 bg-gradient-to-r from-navy-950 via-navy-900/95 to-navy-800/80"
          aria-hidden="true"
        />

        <div className="rg-container relative py-16 sm:py-20 lg:py-24">
          <div className="grid items-center gap-10 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <div className="inline-flex items-center gap-2 rounded-full border border-teal-400/30 bg-teal-500/10 px-3.5 py-1 text-xs font-medium text-teal-200">
                <span className="h-1.5 w-1.5 rounded-full bg-teal-400" aria-hidden="true" />
                CSWD Disaster Relief &amp; Beneficiary Portal · Barangay Tambacan
              </div>

              <h1 className="mt-5 text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-[44px] lg:leading-[1.15]">
                Bringing Organized, Accessible{' '}
                <span className="text-teal-300">Disaster Relief Assistance</span> to Every Family
              </h1>

              <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-navy-100 sm:text-base">
                Welcome to <strong className="font-semibold text-white">ReliefGov</strong> — the
                online assistance portal for residents of{' '}
                <strong className="font-semibold text-white">Barangay Tambacan, Iligan City</strong>.
                Apply for disaster relief, track your application status, and help our community
                coordinate timely support after calamities.
              </p>

              <p className="mt-5 border-l-2 border-alert-400 pl-3.5 text-sm font-medium tracking-wide text-white">
                Serving Communities. Supporting Recovery.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                {user ? (
                  <Link
                    to="/dashboard"
                    className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-teal-500"
                  >
                    Open Your Dashboard
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                    </svg>
                  </Link>
                ) : (
                  <>
                    <Link
                      to="/register"
                      className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-teal-500"
                    >
                      Apply for Assistance
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                      </svg>
                    </Link>
                    <Link
                      to="/login"
                      className="inline-flex items-center gap-2 rounded-lg border border-white/25 bg-white/10 px-6 py-3 text-sm font-semibold text-white backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/20"
                    >
                      Staff &amp; Resident Sign In
                    </Link>
                  </>
                )}
                <a
                  href="#objectives"
                  className="inline-flex items-center gap-1.5 px-3 py-3 text-sm font-medium text-navy-200 transition-colors hover:text-white"
                >
                  Learn How It Works
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5L12 21m0 0l-7.5-7.5M12 21V3" />
                  </svg>
                </a>
              </div>
            </div>

            {/* Right: Friendly Portal Guide Card */}
            <div className="lg:col-span-5">
              <div className="rounded-xl border border-white/15 bg-navy-900/80 p-6 shadow-pop backdrop-blur-md transition-all duration-200 hover:border-teal-400/40">
                <div className="flex items-center justify-between border-b border-white/10 pb-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-teal-300">
                      Portal Guide
                    </p>
                    <h2 className="mt-0.5 text-base font-semibold text-white">
                      Who Uses ReliefGov?
                    </h2>
                  </div>
                  <span className="rounded-md bg-white/10 px-2.5 py-1 text-[11px] font-medium text-navy-100">
                    Iligan City LGU
                  </span>
                </div>

                <ul className="mt-4 space-y-3 text-[13px]">
                  <li className="flex items-start gap-3 rounded-lg border border-transparent bg-white/5 p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-teal-400/30 hover:bg-white/10">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-teal-500/20 text-xs font-bold text-teal-300">
                      01
                    </span>
                    <div>
                      <p className="font-semibold text-white">Barangay Tambacan Residents</p>
                      <p className="mt-0.5 text-navy-200">
                        Submit household relief applications, upload your ID or barangay certificate, and check your status anytime.
                      </p>
                    </div>
                  </li>
                  <li className="flex items-start gap-3 rounded-lg border border-transparent bg-white/5 p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-gov-300/30 hover:bg-white/10">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gov-500/25 text-xs font-bold text-gov-200">
                      02
                    </span>
                    <div>
                      <p className="font-semibold text-white">Barangay Tambacan Staff</p>
                      <p className="mt-0.5 text-navy-200">
                        Verify local residency, review submitted documents, and assist families throughout the application process.
                      </p>
                    </div>
                  </li>
                  <li className="flex items-start gap-3 rounded-lg border border-transparent bg-white/5 p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-alert-400/30 hover:bg-white/10">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-alert-500/20 text-xs font-bold text-alert-300">
                      03
                    </span>
                    <div>
                      <p className="font-semibold text-white">CSWD Office (Iligan City)</p>
                      <p className="mt-0.5 text-navy-200">
                        Approve verified applications, monitor purok-level analytics, and oversee fair relief distribution.
                      </p>
                    </div>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* At-a-Glance Highlights Strip */}
      <section className="border-b border-line bg-white">
        <div className="rg-container py-8">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {QUICK_HIGHLIGHTS.map((item) => (
              <div
                key={item.label}
                className="flex flex-col rounded-xl border border-line bg-surface/60 p-4 transition-all duration-200 hover:-translate-y-1 hover:border-gov-300 hover:bg-white hover:shadow-card"
              >
                <span className="text-2xl font-bold tracking-tight text-navy-900">
                  {item.value}
                </span>
                <span className="mt-0.5 text-sm font-semibold text-gov-700">
                  {item.label}
                </span>
                <span className="mt-1 text-xs leading-relaxed text-slate-500">
                  {item.detail}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Core Objectives Section */}
      <section id="objectives" className="scroll-mt-20 py-16 sm:py-20">
        <div className="rg-container">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gov-600">
              Our Objectives
            </p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-navy-900 sm:text-3xl">
              Built to Serve Families Faster and More Fairly
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-600 sm:text-[15px]">
              ReliefGov was created to simplify how disaster assistance is requested, reviewed, and
              delivered across Barangay Tambacan, Iligan City.
            </p>
          </div>

          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {SYSTEM_OBJECTIVES.map((obj) => (
              <div
                key={obj.title}
                className="rg-card group flex flex-col p-6 transition-all duration-200 hover:-translate-y-1 hover:border-gov-300 hover:shadow-lg"
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`inline-flex h-11 w-11 items-center justify-center rounded-xl border transition-transform duration-200 group-hover:scale-105 ${obj.accent}`}
                  >
                    {obj.icon}
                  </span>
                  <span className="text-xs font-bold tracking-wider text-slate-300 group-hover:text-gov-400 transition-colors">
                    {obj.number}
                  </span>
                </div>
                <h3 className="mt-5 text-base font-semibold text-navy-900">
                  {obj.title}
                </h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-slate-600">
                  {obj.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Highlights & Community Analytics Section */}
      <section id="highlights" className="scroll-mt-20 border-y border-line bg-white py-16 sm:py-20">
        <div className="rg-container">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">
              System Highlights &amp; Analytics
            </p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-navy-900 sm:text-3xl">
              Helpful Tools for Residents and Local Responders
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-600 sm:text-[15px]">
              From easy online applications to clear community analytics, ReliefGov keeps everyone
              connected throughout disaster recovery.
            </p>
          </div>

          <div className="mt-10 grid gap-5 sm:grid-cols-2">
            {PLATFORM_HIGHLIGHTS.map((mod) => (
              <div
                key={mod.title}
                className="rg-card group flex flex-col justify-between p-6 transition-all duration-200 hover:-translate-y-1 hover:border-gov-300 hover:shadow-lg"
              >
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <span
                      className={`inline-flex h-10 w-10 items-center justify-center rounded-lg border transition-transform duration-200 group-hover:scale-105 ${mod.accent}`}
                    >
                      {mod.icon}
                    </span>
                    <span className="rounded-full bg-surface px-2.5 py-1 text-[11px] font-semibold text-slate-500 border border-line">
                      {mod.tag}
                    </span>
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-navy-900">
                    {mod.title}
                  </h3>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-slate-600">
                    {mod.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works & Approval Process */}
      <section id="how-it-works" className="scroll-mt-20 py-16 sm:py-20">
        <div className="rg-container">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gov-600">
              How It Works
            </p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-navy-900 sm:text-3xl">
              Step-by-Step Application &amp; Approval Process
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-600 sm:text-[15px]">
              Follow these four simple steps to apply for disaster assistance and stay updated until
              relief distribution.
            </p>
          </div>

          <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {APPROVAL_STEPS.map((item) => (
              <div
                key={item.step}
                className="rg-card group relative p-6 transition-all duration-200 hover:-translate-y-1 hover:border-gov-300 hover:shadow-lg"
              >
                <div className="flex items-center justify-between">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-navy-700 text-xs font-bold text-white transition-colors duration-200 group-hover:bg-teal-600">
                    {item.step}
                  </span>
                  <span className="rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] font-semibold text-gov-700">
                    {item.actor}
                  </span>
                </div>
                <h3 className="mt-4 text-[15px] font-semibold text-navy-900">
                  {item.title}
                </h3>
                <p className="mt-2 text-[13px] leading-relaxed text-slate-600">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pilot Coverage & Friendly Readiness Checklist */}
      <section id="coverage" className="scroll-mt-20 border-t border-line bg-white py-16 sm:py-20">
        <div className="rg-container">
          <div className="grid items-center gap-10 lg:grid-cols-12">
            <div className="lg:col-span-6">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gov-600">
                Community Coverage
              </p>
              <h2 className="mt-2 text-2xl font-bold tracking-tight text-navy-900 sm:text-3xl">
                Serving Barangay Tambacan, Iligan City
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-600 sm:text-[15px]">
                ReliefGov supports households across all eight puroks of{' '}
                <strong className="text-navy-900">Barangay Tambacan</strong>, helping local welfare
                teams coordinate assistance across coastal, riverbank, and inland neighborhoods.
              </p>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-alert-200 bg-alert-50/70 p-5 transition-all duration-200 hover:-translate-y-1 hover:border-alert-400 hover:shadow-card">
                  <p className="text-xs font-bold uppercase tracking-wider text-alert-700">
                    Coastal / Riverbank Zone
                  </p>
                  <p className="mt-1 text-lg font-bold text-navy-900">Puroks 1 – 4</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">
                    Communities along Iligan Bay and Tambacan River supported for rapid flood
                    response and recovery.
                  </p>
                </div>
                <div className="rounded-xl border border-teal-200 bg-teal-50/70 p-5 transition-all duration-200 hover:-translate-y-1 hover:border-teal-400 hover:shadow-card">
                  <p className="text-xs font-bold uppercase tracking-wider text-teal-700">
                    Inland Residential Zone
                  </p>
                  <p className="mt-1 text-lg font-bold text-navy-900">Puroks 5 – 8</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">
                    Inland neighborhoods covered under the same unified application, review, and
                    relief distribution portal.
                  </p>
                </div>
              </div>
            </div>

            {/* Ready to Apply Box */}
            <div className="lg:col-span-6">
              <div className="rg-card border-gov-200 bg-surface p-7 sm:p-8 transition-all duration-200 hover:-translate-y-1 hover:border-gov-400 hover:shadow-lg">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gov-700">
                  Ready to Apply?
                </p>
                <h3 className="mt-2 text-lg font-bold text-navy-900">
                  What to Prepare Before Starting
                </h3>
                <ul className="mt-4 space-y-2.5 text-[13.5px] text-slate-700">
                  <li className="flex items-start gap-2.5">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-teal-600" />
                    <span>
                      <strong>Proof of Residency or ID:</strong> A clear photo or PDF of your{' '}
                      <em>Barangay Certificate, National ID, or Barangay ID</em>.
                    </span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-teal-600" />
                    <span>
                      <strong>Basic Household Information:</strong> Your purok (Purok 1–8), contact
                      number, and household details.
                    </span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-teal-600" />
                    <span>
                      <strong>Supporting Photo:</strong> A clear photo of disaster or flood impact
                      on your home (if applicable).
                    </span>
                  </li>
                </ul>

                <div className="mt-6 flex flex-wrap gap-3 border-t border-line pt-5">
                  {user ? (
                    <Link
                      to="/dashboard"
                      className="inline-flex items-center gap-2 rounded-lg bg-navy-700 px-5 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-navy-800"
                    >
                      Go to Dashboard
                    </Link>
                  ) : (
                    <>
                      <Link
                        to="/register"
                        className="inline-flex items-center gap-2 rounded-lg bg-gov-600 px-5 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-gov-700"
                      >
                        Register as Beneficiary
                      </Link>
                      <Link
                        to="/login"
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-navy-800 transition-all duration-200 hover:-translate-y-0.5 hover:bg-slate-50"
                      >
                        Sign In to Portal
                      </Link>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Clean Government Footer */}
      <footer className="bg-navy-950 text-navy-200">
        <div className="rg-container py-12">
          <div className="grid gap-8 md:grid-cols-12">
            <div className="md:col-span-5">
              <div className="flex items-center gap-3">
                <LogoMark className="h-10 w-10" />
                <div className="leading-tight">
                  <p className="text-base font-bold text-white">
                    Relief<span className="text-teal-300">Gov</span>
                  </p>
                  <p className="text-[10.5px] uppercase tracking-[0.16em] text-navy-300">
                    Iligan City LGU
                  </p>
                </div>
              </div>
              <p className="mt-4 max-w-sm text-xs leading-relaxed text-navy-300">
                Disaster Relief &amp; Beneficiary Assistance Portal supporting the City Social
                Welfare and Development (CSWD) Office of Iligan City and Barangay Tambacan.
              </p>
            </div>

            <div className="md:col-span-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white">
                Quick Links
              </p>
              <ul className="mt-3 space-y-2 text-xs">
                <li>
                  <a href="#objectives" className="transition-colors hover:text-white">
                    Objectives
                  </a>
                </li>
                <li>
                  <a href="#highlights" className="transition-colors hover:text-white">
                    Highlights &amp; Analytics
                  </a>
                </li>
                <li>
                  <a href="#how-it-works" className="transition-colors hover:text-white">
                    Approval Process
                  </a>
                </li>
                <li>
                  <Link to="/login" className="transition-colors hover:text-white">
                    Staff &amp; Resident Sign In
                  </Link>
                </li>
                <li>
                  <Link to="/register" className="transition-colors hover:text-white">
                    Beneficiary Registration
                  </Link>
                </li>
              </ul>
            </div>

            <div className="md:col-span-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white">
                Service Area
              </p>
              <p className="mt-3 text-xs leading-relaxed text-navy-300">
                City Social Welfare and Development (CSWD) Office · Iligan City
                <br />
                Pilot Barangay: Barangay Tambacan (Puroks 1–8)
              </p>
            </div>
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-6 text-[11.5px] text-navy-400">
            <p>
              © {new Date().getFullYear()} ReliefGov · CSWD Office, Iligan City
            </p>
            <p>Barangay Tambacan, Iligan City</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
