-- ===========================================================================
-- ReliefGov — Migration 0008: Add missing foreign key relationships for ERD
-- Scope: Barangay Tambacan, Iligan City, Lanao del Norte
-- ===========================================================================
--
-- Why this migration exists:
--   In migration 0002, `reports.generated_by` (along with several staff/user
--   attribution columns on `documents`, `aid_distributions`, `households`,
--   and `profiles`) was defined as a bare `uuid` without a `REFERENCES
--   public.profiles (id)` foreign key constraint. As a result, `public.reports`
--   appeared completely disconnected (floating) in the Supabase Schema
--   Visualizer / ERD diagram.
--
--   This migration cleans up any orphaned UUIDs and adds explicit foreign keys
--   to `public.profiles (id)` so every table is properly linked in the schema.
--   Fully idempotent (safe to re-run).
-- ===========================================================================

begin;

-- 1. Nullify any orphaned user references (from deleted test accounts) so
--    adding the foreign keys never fails on existing data.
update public.reports r
   set generated_by = null
 where generated_by is not null
   and not exists (select 1 from public.profiles p where p.id = r.generated_by);

update public.documents d
   set reviewed_by = null
 where reviewed_by is not null
   and not exists (select 1 from public.profiles p where p.id = d.reviewed_by);

update public.aid_distributions a
   set distributed_by = null
 where distributed_by is not null
   and not exists (select 1 from public.profiles p where p.id = a.distributed_by);

update public.households h
   set created_by = null
 where created_by is not null
   and not exists (select 1 from public.profiles p where p.id = h.created_by);

update public.profiles pr
   set created_by = null
 where created_by is not null
   and not exists (select 1 from public.profiles p where p.id = pr.created_by);

update public.profiles pr
   set approved_by = null
 where approved_by is not null
   and not exists (select 1 from public.profiles p where p.id = pr.approved_by);

-- 2. Connect `public.reports` -> `public.profiles`
alter table public.reports
  drop constraint if exists reports_generated_by_fkey,
  add constraint reports_generated_by_fkey
    foreign key (generated_by) references public.profiles (id) on delete set null;

create index if not exists reports_generated_by_idx
  on public.reports (generated_by);

-- 3. Connect `public.documents` -> `public.profiles`
alter table public.documents
  drop constraint if exists documents_uploaded_by_fkey,
  add constraint documents_uploaded_by_fkey
    foreign key (uploaded_by) references public.profiles (id) on delete cascade,
  drop constraint if exists documents_reviewed_by_fkey,
  add constraint documents_reviewed_by_fkey
    foreign key (reviewed_by) references public.profiles (id) on delete set null;

-- 4. Connect `public.aid_distributions.distributed_by` -> `public.profiles`
alter table public.aid_distributions
  drop constraint if exists aid_distributions_distributed_by_fkey,
  add constraint aid_distributions_distributed_by_fkey
    foreign key (distributed_by) references public.profiles (id) on delete set null;

-- 5. Connect `public.households.created_by` -> `public.profiles`
alter table public.households
  drop constraint if exists households_created_by_fkey,
  add constraint households_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null;

-- 6. Connect `public.profiles` self-references (`created_by`, `approved_by`)
alter table public.profiles
  drop constraint if exists profiles_created_by_fkey,
  add constraint profiles_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null,
  drop constraint if exists profiles_approved_by_fkey,
  add constraint profiles_approved_by_fkey
    foreign key (approved_by) references public.profiles (id) on delete set null;

commit;
