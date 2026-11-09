import { supabaseAdmin } from '../lib/supabase.js';
import { badRequest, notFound, HttpError, unavailable } from '../lib/errors.js';

/**
 * In-app notifications (Batch 3: status-change alerts).
 *
 * Rows are created ONLY here, through the service-role key — the RLS
 * policies in migration 0003 let clients read (and only read) their own
 * notifications, so an applicant can never fabricate a "status changed"
 * message for themselves.
 */

const NOTIFICATION_COLUMNS = 'id, user_id, title, body, level, category, link_path, read_at, created_at';

/**
 * Notification categories — mirrors the check constraint added in
 * migration 0006. Used for the dashboard counters and the in-app filter.
 */
export const NOTIFICATION_CATEGORIES = Object.freeze([
  'application',
  'validation',
  'scoring',
  'distribution',
  'staff',
  'system'
]);

function admin() {
  if (!supabaseAdmin) {
    throw unavailable('Notifications require Supabase configuration on the server.');
  }
  return supabaseAdmin;
}

/** Inserts a notification for a user. Failures are logged, never thrown: a
 *  broken notification must not roll back a successful status change.
 *
 *  `category` groups the message for filtering; `link_path` is an IN-APP
 *  destination only (never an external URL) and is sanitized to a leading
 *  slash path so a caller cannot inject a remote link. */
export async function notify(userId, { title, body, level = 'info', category = 'application', link_path = null }) {
  if (!userId) return;
  try {
    const { error } = await admin().from('notifications').insert({
      user_id: userId,
      title: String(title).slice(0, 200),
      body: String(body).slice(0, 1000),
      level,
      category: NOTIFICATION_CATEGORIES.includes(category) ? category : 'application',
      link_path: sanitizeLink(link_path)
    });
    if (error) console.warn('[ReliefGov] notification write failed:', error.message);
  } catch (err) {
    console.warn('[ReliefGov] notification write failed:', err.message);
  }
}

/** Only same-origin in-app paths survive; anything else becomes null. */
function sanitizeLink(link) {
  const raw = String(link || '').trim();
  if (!raw) return null;
  // Must be a simple in-app path: /segment or /segment/segment.
  if (!/^\/[A-Za-z0-9\-_/]{1,100}$/.test(raw)) return null;
  return raw;
}

/** Notifies every active profile with the given role (Batch 4 staff alerts:
 *  new submissions, returned records, endorsements for CSWD review).
 *  Failures never throw — see notify(). */
export async function notifyRole(role, payload) {
  try {
    const { data, error } = await admin()
      .from('profiles')
      .select('id')
      .eq('role', role)
      .eq('is_active', true);
    if (error) {
      console.warn('[ReliefGov] notifyRole lookup failed:', error.message);
      return;
    }
    await Promise.all((data || []).map((profile) => notify(profile.id, payload)));
  } catch (err) {
    console.warn('[ReliefGov] notifyRole failed:', err.message);
  }
}

/** Own notifications, newest first. Supports category / unread filters and
 *  offset pagination so the notification history stays usable at scale. */
export async function listOwn(user, { limit = 50, offset = 0, category, unread } = {}) {
  const cat = String(category || '').trim();
  if (cat && !NOTIFICATION_CATEGORIES.includes(cat)) {
    throw badRequest('Unknown notification category filter.', {
      category: `Must be one of: ${NOTIFICATION_CATEGORIES.join(', ')}.`
    });
  }

  let query = admin()
    .from('notifications')
    .select(NOTIFICATION_COLUMNS, { count: 'exact' })
    .eq('user_id', user.id);

  if (cat) query = query.eq('category', cat);
  if (unread === true || unread === 'true') query = query.is('read_at', null);

  const cappedLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(safeOffset, safeOffset + cappedLimit - 1);
  if (error) throw new HttpError(500, error.message);

  // Unread count is always across the whole account (not the current page)
  // so the badge and "Mark all as read" behave as users expect.
  const { count: unreadCount, error: unreadError } = await admin()
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('read_at', null);
  if (unreadError) throw new HttpError(500, unreadError.message);

  const rows = data || [];
  return {
    notifications: rows,
    unread: unreadCount || 0,
    total: count ?? rows.length,
    limit: cappedLimit,
    offset: safeOffset,
    hasMore: safeOffset + rows.length < (count ?? rows.length),
    categories: NOTIFICATION_CATEGORIES
  };
}

/** Notification counters for the monitoring dashboard (the caller's own
 *  inbox only — never another account's). */
export async function getOwnCounts(user) {
  const [unreadResult, totalResult] = await Promise.all([
    admin().from('notifications').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).is('read_at', null),
    admin().from('notifications').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
  ]);
  if (unreadResult.error) throw new HttpError(500, unreadResult.error.message);
  if (totalResult.error) throw new HttpError(500, totalResult.error.message);
  return { unread: unreadResult.count || 0, total: totalResult.count || 0 };
}

/** Marks one of the caller's notifications as read. Unknown/foreign ids → 404. */
export async function markRead(user, id) {
  const { data, error } = await admin()
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)
    .is('read_at', null)
    .select(NOTIFICATION_COLUMNS)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (data) return { notification: data };

  // Either it does not exist, belongs to someone else, or is already read:
  // confirm one of those before answering so ids cannot be enumerated.
  const { data: existing } = await admin()
    .from('notifications')
    .select('id, read_at')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!existing) throw notFound('Notification not found.');
  return { notification: { ...existing, read_at: existing.read_at } };
}

/** Marks every unread notification of the caller as read. */
export async function markAllRead(user) {
  const { data, error } = await admin()
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .is('read_at', null)
    .select('id');
  if (error) throw new HttpError(500, error.message);
  return { updated: data.length };
}

export default { notify, notifyRole, listOwn, markRead, markAllRead, getOwnCounts, NOTIFICATION_CATEGORIES };
