/**
 * Central navigation model.
 * Roles: beneficiary | barangay_staff | cswd_staff
 */
export const NAV_SECTIONS = [
  {
    label: 'Overview',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: 'grid', roles: ['beneficiary', 'barangay_staff', 'cswd_staff'] }
    ]
  },
  {
    label: 'Assistance Operations',
    items: [
      { to: '/application', label: 'My Application', icon: 'file', roles: ['beneficiary'] },
      { to: '/beneficiaries', label: 'Beneficiary Profiles', icon: 'users', roles: ['barangay_staff', 'cswd_staff'] },
      { to: '/validation', label: 'Validation & Duplicates', labelByRole: { barangay_staff: 'Data Validation' }, icon: 'shield', roles: ['barangay_staff', 'cswd_staff'] },
      { to: '/scoring', label: 'Vulnerability Scoring', icon: 'chart', roles: ['barangay_staff', 'cswd_staff'] },
      { to: '/monitoring', label: 'Distribution Monitoring', icon: 'package', roles: ['barangay_staff', 'cswd_staff'] }
    ]
  },
  {
    label: 'Oversight',
    items: [
      { to: '/analytics', label: 'Analytics', icon: 'chart', roles: ['cswd_staff'] },
      { to: '/reports', label: 'Reports', icon: 'file', roles: ['barangay_staff', 'cswd_staff'] },
      { to: '/notifications', label: 'Notifications', icon: 'bell', roles: ['beneficiary', 'barangay_staff', 'cswd_staff'] },
      { to: '/users', label: 'User Management', icon: 'cog', roles: ['cswd_staff'] }
    ]
  },
  {
    label: 'Account',
    items: [
      { to: '/profile', label: 'Manage Profile', icon: 'user', roles: ['beneficiary'] }
    ]
  }
];

export const ROLE_LABELS = {
  beneficiary: 'Beneficiary',
  barangay_staff: 'Barangay Staff',
  cswd_staff: 'CSWD Staff'
};

export function navForRole(role) {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items
      .filter((item) => item.roles.includes(role))
      .map((item) => ({ ...item, label: item.labelByRole?.[role] || item.label }))
  })).filter((section) => section.items.length > 0);
}

export function Icon({ name, className = 'h-5 w-5' }) {
  const paths = {
    grid: 'M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z',
    users: 'M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 0a2.5 2.5 0 1 0 0-5M19 19v-1a3 3 0 0 0-2-2.8',
    shield: 'M12 3.5 19 6v5.2c0 4.2-2.8 7.4-7 8.8-4.2-1.4-7-4.6-7-8.8V6l7-2.5Zm-3 8.5 2.2 2.2L15 10.4',
    chart: 'M4 19h16M7 16V9m5 7V5m5 11v-4',
    file: 'M7 3.5h6.5L18 8v10.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1Zm6 0V8h5M9 13h6M9 16.5h4',
    bell: 'M6.5 9.5a5.5 5.5 0 0 1 11 0c0 4 1.5 5.5 1.5 5.5H5s1.5-1.5 1.5-5.5ZM10 18.5a2 2 0 0 0 4 0',
    cog: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3-.9-.6.5-1.6-1.4-1.4-1.6.5-.6-.9h-2l-.6.9-1.6-.5L9.5 9.8l.5 1.6-.9.6v2l.9.6-.5 1.6 1.4 1.4 1.6-.5.6.9h2l.6-.9 1.6.5 1.4-1.4-.5-1.6.9-.6v-2Z',
    user: 'M12 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6.5 8v-1a4 4 0 0 1 4-4h5a4 4 0 0 1 4 4v1',
    logout: 'M9 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h3M14 8l4 4-4 4M18 12H9',
    menu: 'M4 7h16M4 12h16M4 17h16',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5.2-1.8L21 21',
    building: 'M4 20h16M6 20V6l6-2.5V20m6 0V10l-6-2.5M9 9h.01M9 12.5h.01M9 16h.01M15 12.5h.01M15 16h.01',
    package: 'M4 8.5 12 4l8 4.5v7L12 20l-8-4.5v-7Zm0 0L12 13m0 0 8-4.5M12 13v7m-4-10.5 8 4.5'
  };
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] || paths.grid} />
    </svg>
  );
}
