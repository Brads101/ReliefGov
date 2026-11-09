import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

/**
 * Persistent, honest banner describing where the data on screen comes from.
 * Never claims live data when the system is running on synthetic records.
 */
export default function DataNotice() {
  const [source, setSource] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api('/health')
      .then((data) => {
        if (!cancelled) setSource(data.dataSource);
      })
      .catch(() => {
        if (!cancelled) setSource({ mode: 'unreachable', notice: 'API server unreachable.' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!source || source.mode === 'supabase') return null;

  if (source.mode === 'none' || source.mode === 'unreachable') {
    return (
      <div className="mb-4 rounded-md border border-alert-200 bg-alert-50 px-3.5 py-2.5 text-[13px] text-alert-700" role="status">
        <span className="font-semibold">Database not configured.</span>{' '}
        {source.notice || 'Configure Supabase in server/.env before relying on these figures.'}
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-md border border-gov-200 bg-gov-50 px-3.5 py-2.5 text-[13px] text-gov-900" role="status">
      <span className="font-semibold">Synthetic demonstration data.</span>{' '}
      {source.notice} Totals shown are generated sample records, not official LGU figures.
    </div>
  );
}
