import PageHeader from '../components/ui/PageHeader.jsx';
import Card from '../components/ui/Card.jsx';
import DataNotice from '../components/DataNotice.jsx';
import { EmptyState, InlineAlert } from '../components/ui/States.jsx';
import Badge from '../components/ui/Badge.jsx';

const BATCH_BY_PATH = {
  '/validation': 'Batch 3 — Data Validation and Duplicate Detection',
  '/scoring': 'Batch 4 — Random Forest Vulnerability Scoring',
  '/reports': 'Batch 5 — Monitoring and Reporting',
  '/notifications': 'Batch 6 — Notifications',
  '/users': 'Batch 7 — User Management'
};

/**
 * Honest module placeholder: the route and navigation exist, the module is
 * explicitly marked as not yet implemented (no fake screens or fake numbers).
 */
export default function ModulePlaceholder({ path, title, description, requirements = [] }) {
  const batch = BATCH_BY_PATH[path] || 'Scheduled for a later batch';

  return (
    <>
      <PageHeader
        title={title}
        description={description}
        breadcrumbs={[{ label: 'Home', to: '/dashboard' }, { label: title }]}
        actions={<Badge tone="warning">Not yet implemented</Badge>}
      />

      <DataNotice />

      <Card title="Module status" subtitle={batch}>
        <div className="space-y-4">
          <InlineAlert level="warning" title="This module is not implemented yet">
            The route, navigation entry, and API contract exist, but the functionality is scheduled
            for a later build batch. The API answers with HTTP 501 instead of returning simulated data.
          </InlineAlert>

          {requirements.length > 0 && (
            <div>
              <p className="mb-2 text-[13px] font-semibold text-navy-800">Planned functionality</p>
              <ul className="space-y-1.5 text-[13.5px] text-slate-600">
                {requirements.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-500" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <EmptyState
            title="Nothing to display yet"
            description="Records, queues, and reports for this module will appear here once the module is built and connected to the database."
            minHeight="min-h-[160px]"
          />
        </div>
      </Card>
    </>
  );
}
