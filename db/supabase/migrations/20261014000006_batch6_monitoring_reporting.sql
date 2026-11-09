-- ===========================================================================
-- ReliefGov — Migration 0006: Monitoring, Reporting, Aid Distribution,
--                           Notifications (Batch 6)
-- ===========================================================================
-- Extends the Batch 2/4 foundations for the full Monitoring & Reporting
-- module, the Aid Distribution Monitoring workflow, and the in-system
-- Notification feature.
--
--   * reports      — two new report types (Duplicate review, Period
--                    summary) plus listing indexes;
--   * aid_distribution — creation attribution, cancellation reason, an
--                    index for the monitoring filters, and a partial
--                    unique index that prevents DUPLICATE OPEN PLANS
--                    (one Planned entry per beneficiary + assistance
--                    type — repeated requests cannot double-record);
--   * notifications— a category (application / validation / scoring /
--                    distribution / staff / system) and an optional
--                    in-app link path, plus read/unread and history
--                    indexes;
--   * audit_logs   — indexes so the dashboard "recent activity" feed and
--                    the Activity log report stay fast.
--
-- Aid distribution stays a MONITORING record: quantities and assistance
-- details only. No cash, no disbursement, no payment processing.
--
-- Applied to the live Supabase project via the dashboard SQL editor.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Reports — new types for the duplicate-review and date-range reports
-- ---------------------------------------------------------------------------
alter table public.reports
  drop constraint if exists reports_report_type_check;
alter table public.reports
  add constraint reports_report_type_check
  check (report_type in ('Beneficiary registry', 'Validation summary',
                         'Vulnerability summary', 'Aid distribution',
                         'Activity log', 'Duplicate review',
                         'Period summary'));

create index if not exists reports_created_idx
  on public.reports (created_at desc);
create index if not exists reports_type_idx
  on public.reports (report_type, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. Aid distribution monitoring
-- ---------------------------------------------------------------------------
--    recorded_by  — who entered the entry (separate from who released it);
--    status_reason— required by the API when an entry is cancelled.
alter table public.aid_distributions
  add column if not exists recorded_by   uuid references public.profiles (id) on delete set null,
  add column if not exists status_reason text;

-- ONE open (Planned) entry per beneficiary per assistance type: a repeated
-- submit cannot create a second open plan. Released/Cancelled history is
-- untouched, so legitimate repeat assistance stays possible.
create unique index if not exists aid_open_plan_idx
  on public.aid_distributions (beneficiary_id, assistance_type)
  where status = 'Planned';

create index if not exists aid_monitoring_idx
  on public.aid_distributions (barangay, status, distributed_at desc);

-- ---------------------------------------------------------------------------
-- 3. Notifications — categories, in-app links, history
-- ---------------------------------------------------------------------------
alter table public.notifications
  add column if not exists category   text not null default 'application'
    check (category in ('application', 'validation', 'scoring',
                        'distribution', 'staff', 'system')),
  add column if not exists link_path  text;

create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications (user_id) where read_at is null;

-- ---------------------------------------------------------------------------
-- 4. Audit log — dashboard activity feed + Activity log report
-- ---------------------------------------------------------------------------
create index if not exists audit_logs_created_idx
  on public.audit_logs (created_at desc);
create index if not exists audit_logs_actor_idx
  on public.audit_logs (actor_id, created_at desc);

commit;

-- ---------------------------------------------------------------------------
-- Notes for reviewers
-- ---------------------------------------------------------------------------
-- * The unique open-plan index is a DATA-integrity backstop; the API also
--   checks eligibility and duplicates before writing and answers 409 with a
--   clear message instead of relying on the index error.
-- * notifications.category is additive: existing rows default to
--   'application', which matches what Batch 3 wrote (status changes).
--   RLS is unchanged — clients still read only their own notifications and
--   cannot insert, update or delete them; every write goes through the
--   server with the service role.
-- * No SMS or email integration is claimed or configured: notifications are
--   in-system only.
