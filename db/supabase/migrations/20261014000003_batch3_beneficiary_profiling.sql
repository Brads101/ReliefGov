-- ===========================================================================
-- Migration 0003 — Batch 3: Beneficiary Profiling Module
-- Barangay Tambacan, Iligan City, Lanao del Norte (capstone scope)
--
-- Adds the incident / household fields used by the multi-section beneficiary
-- form, aligns application_status with the documented verification workflow,
-- introduces an append-only status history for the status timeline, and
-- hardens notification policies so only the server can create them.
--
-- Workflow statuses (documented, traceable):
--   Draft            — saved, not yet submitted; editable by the applicant
--   Pending          — submitted; awaiting verification ("Pending")
--   Under Verification — staff opened the record and is verifying it
--   Needs Correction  — staff asked the applicant to fix something (reason required)
--   Approved         — verified and approved (terminal)
--   Rejected         — rejected (reason required, terminal)
--
-- Transitions are enforced server-side (applicationService.js) and, as
-- defense in depth, by the beneficiaries_guard trigger below.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Incident + household + workflow columns
-- ---------------------------------------------------------------------------
alter table public.beneficiaries
  add column if not exists incident_type text
    check (incident_type in ('Typhoon', 'Flood', 'Fire', 'Landslide',
                             'Earthquake', 'Storm surge', 'Other')),
  add column if not exists incident_date date,
  add column if not exists incident_description text,
  add column if not exists damage_extent text
    check (damage_extent in ('None', 'Minor', 'Major', 'Total')),
  add column if not exists house_status text
    check (house_status in ('Owned', 'Rented', 'Shared', 'Informal settler', 'Other')),
  add column if not exists income_level text
    check (income_level in ('No income', 'Low', 'Moderate', 'High')),
  add column if not exists status_reason text;

comment on column public.beneficiaries.status_reason is
  'Reason attached to the current status (required for Needs Correction / Rejected).';

-- ---------------------------------------------------------------------------
-- 2. Status vocabulary: capstone workflow names
--    Submitted        -> Pending
--    Under review     -> Under Verification
--    + Needs Correction (new state; documented above)
-- ---------------------------------------------------------------------------
alter table public.beneficiaries
  drop constraint if exists beneficiaries_application_status_check;

update public.beneficiaries
   set application_status = 'Pending'
 where application_status = 'Submitted';

update public.beneficiaries
   set application_status = 'Under Verification'
 where application_status = 'Under review';

alter table public.beneficiaries
  add constraint beneficiaries_application_status_check
  check (application_status in ('Draft', 'Pending', 'Under Verification',
                                'Needs Correction', 'Approved', 'Rejected'));

-- At most ONE open (non-terminal) application per account. Together with the
-- idempotent submit endpoint this stops duplicate submissions caused by
-- repeated button clicks or network retries, even under concurrent requests.
create unique index if not exists beneficiaries_one_open_application_idx
  on public.beneficiaries (user_id)
  where user_id is not null
    and application_status in ('Draft', 'Pending', 'Under Verification', 'Needs Correction');

-- ---------------------------------------------------------------------------
-- 3. Application status history (append-only timeline)
-- ---------------------------------------------------------------------------
create table if not exists public.application_status_history (
  id             uuid primary key default gen_random_uuid(),
  beneficiary_id uuid not null references public.beneficiaries (id) on delete cascade,
  from_status    text,
  to_status      text not null,
  reason         text,
  actor_id       uuid references auth.users (id) on delete set null,
  actor_role     text,
  created_at     timestamptz not null default now()
);

create index if not exists application_status_history_beneficiary_idx
  on public.application_status_history (beneficiary_id, created_at);

alter table public.application_status_history enable row level security;

-- Read: the applicant who owns the linked record, or staff (Tambacan scope).
drop policy if exists "history_read" on public.application_status_history;
create policy "history_read" on public.application_status_history for select
  using (
    public.is_staff()
    or exists (
      select 1 from public.beneficiaries b
      where b.id = application_status_history.beneficiary_id
        and b.user_id = auth.uid()
    )
  );

-- No insert/update/delete policy: rows are created only by the ReliefGov
-- server through the service-role key. The guard trigger below blocks any
-- direct write even if a policy were ever added by mistake.
create or replace function public.status_history_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  jwt text := public.jwt_role();
begin
  if jwt = 'service_role' or jwt = '' then
    return new; -- trusted server-side operations and direct SQL
  end if;
  raise exception 'Status history is written only by the ReliefGov server.';
end $$;

drop trigger if exists status_history_guard on public.application_status_history;
create trigger status_history_guard before insert or update or delete
  on public.application_status_history
  for each row execute function public.status_history_guard();

-- ---------------------------------------------------------------------------
-- 4. Beneficiary guard — Batch 3 workflow rules
--    * Applicants create their record as a Draft (submission happens only
--      through the server endpoint, which uses the service-role key).
--    * Applicants may edit content only while Draft or Needs Correction.
--    * Applicants can never change status, validation, scoring, duplicate
--      flags, data origin, beneficiary number, or the barangay fields —
--      those are server/staff only.
-- ---------------------------------------------------------------------------
create or replace function public.beneficiaries_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  jwt text := public.jwt_role();
begin
  if jwt = 'service_role' or jwt = '' then
    return new; -- trusted server-side operations and direct SQL
  end if;
  if public.is_staff() then
    return new; -- staff encode and verify profiles (RLS keeps them in Tambacan)
  end if;

  -- Non-staff authenticated user: own row only.
  if tg_op = 'INSERT' then
    if new.user_id is distinct from auth.uid() then
      raise exception 'You may only submit a profile for your own account.';
    end if;
    if new.validation_status <> 'Pending'
       or new.vulnerability_score is not null
       or new.vulnerability_class is not null
       or new.duplicate_of is not null then
      raise exception 'Validation and vulnerability results are set by the system, not by the applicant.';
    end if;
    if new.application_status is distinct from 'Draft' then
      raise exception 'A new application always starts as a Draft and is submitted through the application form.';
    end if;
    new.data_origin   := 'self-service';
    new.submitted_at  := null;
    new.status_reason := null;
    return new;
  end if;

  -- UPDATE by the owner
  if old.user_id is distinct from auth.uid() then
    raise exception 'You may only modify your own profile.';
  end if;
  if new.application_status is distinct from old.application_status
     or new.submitted_at is distinct from old.submitted_at then
    raise exception 'Application status changes are made through the verification workflow, not by editing the record.';
  end if;
  if old.application_status not in ('Draft', 'Needs Correction') then
    raise exception 'This application can no longer be edited while it is under verification.';
  end if;
  if new.beneficiary_number <> old.beneficiary_number
     or new.user_id is distinct from old.user_id
     or new.household_id is distinct from old.household_id
     or new.validation_status is distinct from old.validation_status
     or new.vulnerability_score is distinct from old.vulnerability_score
     or new.vulnerability_class is distinct from old.vulnerability_class
     or new.duplicate_of is distinct from old.duplicate_of
     or new.data_origin is distinct from old.data_origin
     or new.status_reason is distinct from old.status_reason
     or new.barangay <> old.barangay
     or new.city_municipality <> old.city_municipality
     or new.province <> old.province then
    raise exception 'This information can only be changed by the barangay staff or the CSWD office.';
  end if;
  return new;
end $$;

drop trigger if exists beneficiaries_guard on public.beneficiaries;
create trigger beneficiaries_guard before insert or update on public.beneficiaries
  for each row execute function public.beneficiaries_guard();

-- ---------------------------------------------------------------------------
-- 5. Notifications: least privilege
--    0001 allowed "for all" on own rows, which meant a user could fabricate
--    their own notifications. Clients may now only READ their notifications;
--    rows are inserted (and marked read) exclusively by the server.
-- ---------------------------------------------------------------------------
drop policy if exists "notifications_own" on public.notifications;
drop policy if exists "notifications_read_own" on public.notifications;
drop policy if exists "notifications_update_own" on public.notifications;

create policy "notifications_read_own" on public.notifications for select
  using (user_id = auth.uid());
