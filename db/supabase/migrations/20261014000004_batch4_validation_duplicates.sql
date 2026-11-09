-- ---------------------------------------------------------------------------
-- Batch 4 — Data Validation, Duplicate Detection, and authorized review
-- workflow for Barangay Staff and CSWD Staff (Barangay Tambacan only).
--
--  * validation_status gains 'Duplicate' and 'Rejected' so the registry can
--    reflect confirmed duplicates and CSWD rejections.
--  * Duplicate flags keep machine-readable evidence (matched fields,
--    similarity score, confidence) AND the human decision (reviewer,
--    timestamp, decision, notes) for an auditable history.
--  * verification_reviews records each staff verification outcome and
--    internal remarks per stage (server-written; staff read-only).
--  * validation_results becomes read-only to clients: every decision is
--    made through the API where it is authenticated, validated and audited.
--  * Document review gains a required reason column for rejections.
--  * Queue indexes for the validation queue filters.
--
-- Applied to the live Supabase project via the dashboard SQL editor.
-- ---------------------------------------------------------------------------

-- 1. validation_status vocabulary -------------------------------------------------
alter table public.beneficiaries
  drop constraint if exists beneficiaries_validation_status_check;
alter table public.beneficiaries
  add constraint beneficiaries_validation_status_check
  check (validation_status in ('Pending', 'Verified', 'Flagged', 'Duplicate', 'Rejected'));

-- 2. Duplicate flag evidence and human decisions ---------------------------------
--    'Merged' (never used — records are never merged or deleted) is replaced
--    by 'Confirmed': a reviewer confirmed the link while both records stay intact.
alter table public.validation_results
  drop constraint if exists validation_results_status_check;
alter table public.validation_results
  add constraint validation_results_status_check
  check (status in ('Pending', 'Flagged', 'Cleared', 'Confirmed'));

alter table public.validation_results
  add column if not exists candidate_id  uuid references public.beneficiaries (id) on delete set null,
  add column if not exists match_details jsonb not null default '{}'::jsonb,
  add column if not exists confidence    text check (confidence in ('low', 'medium', 'high')),
  add column if not exists decision      text check (decision in ('confirm', 'dismiss', 'request_info')),
  add column if not exists reviewed_at   timestamptz;

create index if not exists validation_results_status_idx
  on public.validation_results (status, created_at desc);
create index if not exists validation_results_candidate_idx
  on public.validation_results (candidate_id);

-- Staff browsers no longer write flags directly: decisions go through the API
-- (service role bypasses RLS) so every change is authorized and audited.
drop policy if exists "validation_staff" on public.validation_results;
create policy "validation_staff_read" on public.validation_results
  for select using (public.is_staff());

-- 3. Staff verification reviews (outcome + internal remarks per stage) -----------
create table if not exists public.verification_reviews (
  id              uuid primary key default gen_random_uuid(),
  beneficiary_id  uuid not null references public.beneficiaries (id) on delete cascade,
  reviewer_id     uuid references public.profiles (id) on delete set null,
  reviewer_role   text not null check (reviewer_role in ('barangay_staff', 'cswd_staff')),
  stage           text not null check (stage in ('barangay_verification', 'cswd_review')),
  outcome         text not null,
  remarks         text,
  created_at      timestamptz not null default now()
);

create index if not exists verification_reviews_beneficiary_idx
  on public.verification_reviews (beneficiary_id, created_at desc);

alter table public.verification_reviews enable row level security;
-- Staff may read review history; rows are inserted only by the API through
-- the service role, so no client policy grants insert/update/delete here.
drop policy if exists "verification_reviews_staff_read" on public.verification_reviews;
create policy "verification_reviews_staff_read" on public.verification_reviews
  for select using (public.is_staff());

-- 4. Document review outcome reason (required by the API when rejected) -----------
alter table public.documents
  add column if not exists status_reason text;

-- 5. Validation queue indexes (Tambacan scope + status/purok/date filters) ---------
create index if not exists beneficiaries_queue_idx
  on public.beneficiaries (barangay, application_status, submitted_at desc);
create index if not exists beneficiaries_purok_idx
  on public.beneficiaries (barangay, purok);
