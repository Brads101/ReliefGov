import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import PageHeader from '../components/ui/PageHeader.jsx';
import Card from '../components/ui/Card.jsx';
import Table from '../components/ui/Table.jsx';
import Badge from '../components/ui/Badge.jsx';
import Button from '../components/ui/Button.jsx';
import { Input, Select } from '../components/ui/Input.jsx';
import DataNotice from '../components/DataNotice.jsx';
import { LoadingState, ErrorState, EmptyState } from '../components/ui/States.jsx';
import { incomeLevelLabel, VALIDATION_STATUS_META } from '../lib/constants.js';

const fullName = (r) => `${r.last_name}, ${r.first_name} ${r.middle_name || ''}`.trim();

export default function Beneficiaries() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (status) params.set('status', status);
      params.set('limit', '50');
      const result = await api(`/beneficiaries?${params.toString()}`);
      setData(result);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [search, status]);

  useEffect(() => {
    const timer = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  const columns = [
    {
      key: 'beneficiary_number',
      header: 'Reference No.',
      render: (r) => <span className="font-medium tabular-nums text-gov-800">{r.beneficiary_number}</span>
    },
    { key: 'name', header: 'Name', render: (r) => fullName(r) },
    { key: 'purok', header: 'Purok', render: (r) => r.address?.purok || r.purok || '—' },
    { key: 'barangay', header: 'Barangay', render: () => 'Tambacan' },
    {
      key: 'household_size',
      header: 'HH size',
      align: 'right',
      render: (r) => <span className="tabular-nums">{r.household_size ?? '—'}</span>
    },
    {
      key: 'validation_status',
      header: 'Validation',
      render: (r) => (
        <Badge tone={VALIDATION_STATUS_META[r.validation_status]?.tone || 'neutral'}>
          {VALIDATION_STATUS_META[r.validation_status]?.label || r.validation_status || 'Pending'}
        </Badge>
      )
    }
  ];

  return (
    <>
      <PageHeader
        title="Beneficiary Profiles"
        breadcrumbs={[
          { label: 'Home', to: '/dashboard' },
          { label: 'Assistance Operations' },
          { label: 'Beneficiary Profiles' }
        ]}
      />

      <DataNotice />

      <Card
        padded={false}
        title="Profile registry"
        subtitle={
          data ? (
            <span className="inline-flex items-center gap-1.5 mt-0.5">
              <span className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-100/90 px-2.5 py-0.5 text-[12px] font-bold text-amber-950 shadow-xs">
                <span className="tabular-nums font-mono text-[13px]">{data.total}</span>
                <span className="font-semibold text-amber-800">record(s)</span>
              </span>
            </span>
          ) : (
            'Loading records…'
          )
        }
        actions={
          <Button variant="secondary" onClick={load} disabled={loading}>
            Refresh
          </Button>
        }
      >
        <div className="flex flex-col gap-3 border-b border-line px-5 py-4 sm:flex-row">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5.2-1.8L21 21" strokeLinecap="round" />
              </svg>
            </span>
            <Input
              name="search"
              aria-label="Search beneficiaries"
              placeholder="Search by name or reference number"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="sm:w-56">
            <Select
              name="status"
              aria-label="Filter by validation status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              placeholder="All validation statuses"
              options={[
                { value: 'Verified', label: 'Verified' },
                { value: 'Pending', label: 'Pending' },
                { value: 'Flagged', label: 'Flagged' }
              ]}
            />
          </div>
        </div>

        <div className="p-5">
          {loading && <LoadingState label="Loading beneficiary records…" />}

          {!loading && error && (
            <ErrorState
              title={error.status === 503 ? 'Database not configured' : 'Could not load records'}
              description={error.message}
              onRetry={load}
            />
          )}

          {!loading && !error && data && data.rows.length === 0 && (
            <EmptyState
              title="No beneficiary records found"
              description={
                search || status
                  ? 'Try adjusting the search term or validation filter.'
                  : 'No profiles have been encoded yet for Barangay Tambacan.'
              }
            />
          )}

          {!loading && !error && data && data.rows.length > 0 && (
            <Table
              columns={columns}
              rows={data.rows}
              keyFn={(r) => r.id}
              emptyState={null}
            />
          )}
        </div>
      </Card>
    </>
  );
}
