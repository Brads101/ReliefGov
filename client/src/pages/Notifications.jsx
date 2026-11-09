import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import PageHeader from '../components/ui/PageHeader.jsx';
import Card from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Badge from '../components/ui/Badge.jsx';
import { Select } from '../components/ui/Input.jsx';
import { LoadingState, ErrorState, EmptyState, InlineAlert } from '../components/ui/States.jsx';
import { NOTIFICATION_CATEGORY_LABELS } from '../lib/constants.js';

const LEVEL_TONE = { info: 'info', success: 'success', warning: 'warning', error: 'danger' };

const PAGE_SIZE = 25;

function relativeTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * In-app notifications for the signed-in user only (Batch 3 + Batch 6).
 *
 * Batch 6 adds category and unread filters, pagination, and in-app link
 * shortcuts. Every query is scoped to the signed-in account by the server —
 * a notification belonging to another account answers 404 and can never be
 * read or altered here. There is NO SMS or email integration in this
 * deployment; everything is in-system.
 */
export default function Notifications() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [offset, setOffset] = useState(0);
  const [refreshTick, setRefreshTick] = useState(0);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(offset));
    if (category) params.set('category', category);
    if (unreadOnly) params.set('unread', 'true');
    api(`/notifications?${params.toString()}`)
      .then(setData)
      .catch((err) => setError(err))
      .finally(() => setLoading(false));
  }, [category, unreadOnly, offset]);

  useEffect(() => {
    load();
  }, [load, refreshTick]);

  const markRead = async (id) => {
    setBusy(true);
    try {
      await api(`/notifications/${id}/read`, { method: 'POST' });
      setRefreshTick((t) => t + 1);
    } catch {
      // keep the list as-is; user can retry
    } finally {
      setBusy(false);
    }
  };

  const markAllRead = async () => {
    setBusy(true);
    try {
      await api('/notifications/read-all', { method: 'POST' });
      setRefreshTick((t) => t + 1);
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  };

  const rows = data?.notifications || [];
  const hasFilters = Boolean(category || unreadOnly);
  const canPrev = offset > 0;
  const canNext = data ? offset + rows.length < data.total : false;

  const clearFilters = () => {
    setCategory('');
    setUnreadOnly(false);
    setOffset(0);
  };

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Messages about your account and your disaster assistance application. In-app only — no SMS or email is sent."
        breadcrumbs={[{ label: 'Home', to: '/dashboard' }, { label: 'Notifications' }]}
        actions={
          data && data.unread > 0 ? (
            <Button variant="secondary" onClick={markAllRead} disabled={busy}>
              Mark all as read
            </Button>
          ) : null
        }
      />

      <Card
        className="mb-5"
        title="Filters"
        subtitle="Narrow your notification history"
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-52">
            <label htmlFor="notif-category" className="rg-label">
              Category
            </label>
            <Select
              id="notif-category"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setOffset(0);
              }}
              placeholder="All categories"
              options={Object.entries(NOTIFICATION_CATEGORY_LABELS).map(([value, label]) => ({
                value,
                label
              }))}
            />
          </div>
          <div className="w-44">
            <label htmlFor="notif-read" className="rg-label">
              Read status
            </label>
            <Select
              id="notif-read"
              value={unreadOnly ? 'unread' : ''}
              onChange={(e) => {
                setUnreadOnly(e.target.value === 'unread');
                setOffset(0);
              }}
              placeholder="All messages"
              options={[{ value: 'unread', label: 'Unread only' }]}
            />
          </div>
          {hasFilters && (
            <Button size="sm" variant="ghost" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
        </div>
      </Card>

      {loading && <LoadingState label="Loading notifications…" />}

      {!loading && error && (
        <ErrorState title="Could not load notifications" description={error.message} onRetry={load} />
      )}

      {!loading && !error && data && rows.length === 0 && (
        <Card>
          <EmptyState
            title={hasFilters ? 'No notifications match these filters' : 'No notifications yet'}
            description={
              hasFilters
                ? 'Try clearing the filters to see your full notification history.'
                : 'You will be notified here whenever the status of your disaster assistance application changes.'
            }
            minHeight="min-h-[180px]"
            action={
              hasFilters ? (
                <Button size="sm" variant="secondary" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : null
            }
          />
        </Card>
      )}

      {!loading && !error && data && rows.length > 0 && (
        <Card
          title={`Your notifications (${data.unread} unread of ${data.total})`}
          subtitle="Newest first"
        >
          {data.unread === 0 && !unreadOnly && (
            <div className="mb-4">
              <InlineAlert level="success">You have read everything. There are no unread messages.</InlineAlert>
            </div>
          )}
          <ul className="divide-y divide-line">
            {rows.map((n) => (
              <li
                key={n.id}
                className={`flex flex-col gap-2 py-4 sm:flex-row sm:items-start sm:justify-between ${n.read_at ? 'opacity-70' : ''}`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={LEVEL_TONE[n.level] || 'info'}>{n.level}</Badge>
                    {n.category && (
                      <Badge tone="neutral">
                        {NOTIFICATION_CATEGORY_LABELS[n.category] || n.category}
                      </Badge>
                    )}
                    <p className={`text-sm ${n.read_at ? 'text-navy-700' : 'font-semibold text-navy-900'}`}>
                      {n.title}
                    </p>
                    {!n.read_at && <span className="text-[11px] font-medium text-gov-700">● New</span>}
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed text-slate-600">{n.body}</p>
                  <p className="mt-1 text-[12px] text-slate-400">{relativeTime(n.created_at)}</p>
                </div>
                <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                  {n.link_path && (
                    <Link to={n.link_path}>
                      <Button size="sm" variant="ghost">
                        Open
                      </Button>
                    </Link>
                  )}
                  {!n.read_at && (
                    <Button size="sm" variant="secondary" onClick={() => markRead(n.id)} disabled={busy}>
                      Mark as read
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {(rows.length > PAGE_SIZE / 2 || canPrev) && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              <p className="text-[13px] tabular-nums text-slate-500">
                Showing {offset + 1}–{offset + rows.length} of {data.total}
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={!canPrev} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                  Previous
                </Button>
                <Button size="sm" variant="secondary" disabled={!canNext} onClick={() => setOffset(offset + PAGE_SIZE)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
