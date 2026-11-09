-- ===========================================================================
-- ReliefGov — migration 0002: database + authentication foundation (Batch 2)
-- Scope: BARANGAY TAMBACAN, ILIGAN CITY, LANAO DEL NORTE (single barangay).
-- Central stakeholder: CSWD Office, Iligan City.
--
-- Adds: household information, supporting documents, aid distribution,
-- reports; capstone beneficiary fields; staff approval workflow; least-
-- privilege RLS; a private Supabase Storage bucket for documents.
-- Fully idempotent (safe to re-run).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Helper: JWT role of the current request ('anon' | 'authenticated' |
-- 'service_role' or '' for direct SQL connections such as the SQL editor).
-- ---------------------------------------------------------------------------
create or replace function public.jwt_role()
returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  );
$$;

-- ---------------------------------------------------------------------------
-- 1. Profiles: staff approval / activation workflow + accountability
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists approval_status text not null default 'approved'
    check (approval_status in ('pending', 'approved', 'rejected')),
  add column if not exists created_by uuid,
  add column if not exists approved_by uuid,
  add column if not exists approved_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Defense in depth: authenticated clients may never change role, approval
-- status, activation, email or id — not even on their own row. All privileged
-- changes go through the server (service role) or direct SQL by the office.
create or replace function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  jwt text := public.jwt_role();
begin
  if jwt = 'service_role' or jwt = '' then
    return new; -- trusted server-side operations and direct SQL
  end if;
  if tg_op = 'INSERT' then
    -- Profiles are only ever created by the on_auth_user_created trigger
    -- (which runs as the function owner with no request JWT). A direct
    -- insert from an authenticated client must never succeed.
    raise exception 'Profiles are created automatically. Account creation is not allowed from here.';
  end if;
  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.email <> old.email then
      raise exception 'Account identifiers cannot be changed.';
    end if;
    if public.is_cswd() then
      if new.id = auth.uid() and (new.role <> old.role or new.is_active <> old.is_active) then
        raise exception 'You cannot change your own role or activation status.';
      end if;
      return new;
    end if;
    if new.role <> old.role
       or new.approval_status is distinct from old.approval_status
       or new.is_active <> old.is_active
       or new.created_by is distinct from old.created_by
       or new.approved_by is distinct from old.approved_by
       or new.approved_at is distinct from old.approved_at then
      raise exception 'Only the CSWD office can change account roles, approval status or activation.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before insert or update on public.profiles
  for each row execute function public.profiles_guard();

-- ---------------------------------------------------------------------------
-- 2. handle_new_user: EVERY new auth user (public signup or CSWD-created
--    staff account) starts as an ordinary, approved BENEFICIARY profile.
--    The trigger deliberately ignores any `role` in the signup metadata —
--    GoTrue writes auth.users directly to Postgres, so a public signup and
--    an admin-created user are indistinguishable here. Elevated roles are
--    therefore ONLY assignable afterwards, by the server through the
--    service role (profiles_guard allows service-role updates only),
--    which is the trusted administrative process required by the capstone.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (
    id, email, full_name, role, barangay,
    is_active, approval_status, created_by
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    'beneficiary',
    'Tambacan',
    true,
    'approved',
    null
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Households (household information)
-- ---------------------------------------------------------------------------
create table if not exists public.households (
  id                   uuid primary key default gen_random_uuid(),
  household_no         text unique not null default
                       ('TAM-HH-' || upper(substr(gen_random_uuid()::text, 1, 8))),
  family_head_name     text not null,
  purok                text,
  address_line         text,
  family_size          integer check (family_size is null or family_size > 0),
  monthly_family_income numeric(12, 2),
  income_level         text
                       check (income_level is null
                              or income_level in ('No income', 'Low', 'Moderate', 'High')),
  house_status         text
                       check (house_status is null
                              or house_status in ('Owned', 'Rented', 'Shared', 'Informal settler', 'Other')),
  damage_extent        text
                       check (damage_extent is null
                              or damage_extent in ('None', 'Minor', 'Major', 'Total')),
  has_barangay_certificate boolean not null default false,
  barangay             text not null default 'Tambacan' check (barangay = 'Tambacan'),
  city_municipality    text not null default 'Iligan City'
                       check (city_municipality = 'Iligan City'),
  province             text not null default 'Lanao del Norte'
                       check (province = 'Lanao del Norte'),
  created_by           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

drop trigger if exists households_updated_at on public.households;
create trigger households_updated_at before update on public.households
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Supporting documents (references to files in the private storage bucket)
-- ---------------------------------------------------------------------------
create table if not exists public.documents (
  id             uuid primary key default gen_random_uuid(),
  beneficiary_id uuid references public.beneficiaries (id) on delete cascade,
  household_id   uuid references public.households (id) on delete cascade,
  uploaded_by    uuid not null,
  bucket         text not null default 'beneficiary-documents',
  storage_path   text unique not null,
  file_name      text not null,
  mime_type      text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes     integer not null check (size_bytes > 0 and size_bytes <= 5242880),
  purpose        text not null default 'Other'
                 check (purpose in ('Barangay certificate', 'Valid ID', 'Proof of residence',
                                    'Damage photos', 'Medical record', 'Other')),
  status         text not null default 'Pending'
                 check (status in ('Pending', 'Accepted', 'Rejected')),
  reviewed_by    uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists documents_beneficiary_idx on public.documents (beneficiary_id);
create index if not exists documents_uploader_idx on public.documents (uploaded_by);

drop trigger if exists documents_updated_at on public.documents;
create trigger documents_updated_at before update on public.documents
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Aid distribution records
-- ---------------------------------------------------------------------------
create table if not exists public.aid_distributions (
  id                uuid primary key default gen_random_uuid(),
  reference_no      text unique not null
                    default ('AID-' || upper(substr(gen_random_uuid()::text, 1, 8))),
  beneficiary_id    uuid not null references public.beneficiaries (id) on delete cascade,
  household_id      uuid references public.households (id) on delete set null,
  assistance_type   text not null
                    check (assistance_type in ('Food pack', 'Financial assistance',
                                               'Shelter repair', 'Medical assistance',
                                               'Relief goods', 'Other')),
  quantity          numeric(10, 2) not null default 1,
  amount            numeric(12, 2),
  status            text not null default 'Planned'
                    check (status in ('Planned', 'Released', 'Cancelled')),
  barangay          text not null default 'Tambacan' check (barangay = 'Tambacan'),
  distributed_by    uuid,
  distributed_at    timestamptz,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists aid_beneficiary_idx on public.aid_distributions (beneficiary_id);

drop trigger if exists aid_updated_at on public.aid_distributions;
create trigger aid_updated_at before update on public.aid_distributions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. Reports (record of generated monitoring reports)
-- ---------------------------------------------------------------------------
create table if not exists public.reports (
  id            uuid primary key default gen_random_uuid(),
  report_type   text not null
                check (report_type in ('Beneficiary registry', 'Validation summary',
                                       'Vulnerability summary', 'Aid distribution',
                                       'Activity log')),
  format        text not null default 'Screen'
                check (format in ('Screen', 'CSV', 'PDF')),
  parameters    jsonb not null default '{}'::jsonb,
  row_count     integer,
  generated_by  uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 7. Capstone beneficiary fields + household link
-- ---------------------------------------------------------------------------
alter table public.beneficiaries
  add column if not exists household_id uuid references public.households (id) on delete set null,
  add column if not exists application_status text not null default 'Draft'
    check (application_status in ('Draft', 'Submitted', 'Under review',
                                  'Approved', 'Rejected')),
  add column if not exists submitted_at timestamptz;

-- Beneficiaries may submit and edit only their own profile; privileged
-- columns (validation, scoring, identity links) stay staff/server-only.
-- The submission date is stamped automatically when a profile is submitted.
create or replace function public.beneficiaries_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  jwt text := public.jwt_role();
begin
  if jwt = 'service_role' or jwt = '' then
    return new; -- trusted server-side operations and direct SQL
  end if;
  if public.is_staff() then
    if tg_op = 'INSERT' and new.user_id is distinct from auth.uid() then
      return new; -- staff encode profiles on behalf of beneficiaries
    end if;
    return new;
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
    new.data_origin  := 'self-service';
    new.submitted_at := now();
    new.application_status := 'Submitted';
    return new;
  end if;

  -- UPDATE by the owner
  if old.user_id is distinct from auth.uid() then
    raise exception 'You may only modify your own profile.';
  end if;
  if new.beneficiary_number <> old.beneficiary_number
     or new.user_id is distinct from old.user_id
     or new.household_id is distinct from old.household_id
     or new.validation_status is distinct from old.validation_status
     or new.vulnerability_score is distinct from old.vulnerability_score
     or new.vulnerability_class is distinct from old.vulnerability_class
     or new.duplicate_of is distinct from old.duplicate_of
     or new.data_origin is distinct from old.data_origin
     or new.barangay <> old.barangay
     or new.city_municipality <> old.city_municipality
     or new.province <> old.province
     or new.submitted_at is distinct from old.submitted_at then
    raise exception 'This information can only be changed by the barangay staff or the CSWD office.';
  end if;
  if new.application_status is distinct from old.application_status
     and new.application_status not in ('Draft', 'Submitted') then
    raise exception 'Applicants may only save a draft or submit their application.';
  end if;
  if new.application_status = 'Submitted'
     and old.application_status <> 'Submitted' then
    new.submitted_at := now();
  end if;
  return new;
end $$;

drop trigger if exists beneficiaries_guard on public.beneficiaries;
create trigger beneficiaries_guard before insert or update on public.beneficiaries
  for each row execute function public.beneficiaries_guard();

-- ---------------------------------------------------------------------------
-- 8. Row Level Security — least privilege per role
-- ---------------------------------------------------------------------------
alter table public.households enable row level security;
alter table public.documents enable row level security;
alter table public.aid_distributions enable row level security;
alter table public.reports enable row level security;

-- profiles: own row, or CSWD for account administration
-- (0001's staff-reads-everything policy is retired here)
drop policy if exists "profiles_read_own_or_staff" on public.profiles;
drop policy if exists "profiles_read_own_or_cswd" on public.profiles;
create policy "profiles_read_own_or_cswd" on public.profiles for select
  using (id = auth.uid() or public.is_cswd());

-- beneficiaries: staff (Tambacan-only) read/write; applicants read and edit own
drop policy if exists "beneficiaries_read" on public.beneficiaries;
create policy "beneficiaries_read" on public.beneficiaries for select
  using (public.is_staff() or user_id = auth.uid());

drop policy if exists "beneficiaries_write_staff" on public.beneficiaries;
drop policy if exists "beneficiaries_tambacan_only" on public.beneficiaries;
drop policy if exists "beneficiaries_insert_staff" on public.beneficiaries;
create policy "beneficiaries_insert_staff" on public.beneficiaries for insert
  with check (public.is_staff() and barangay = 'Tambacan');

drop policy if exists "beneficiaries_insert_self" on public.beneficiaries;
create policy "beneficiaries_insert_self" on public.beneficiaries for insert
  with check (user_id = auth.uid() and barangay = 'Tambacan');

drop policy if exists "beneficiaries_update_staff" on public.beneficiaries;
create policy "beneficiaries_update_staff" on public.beneficiaries for update
  using (public.is_staff())
  with check (public.is_staff() and barangay = 'Tambacan');

drop policy if exists "beneficiaries_update_own" on public.beneficiaries;
create policy "beneficiaries_update_own" on public.beneficiaries for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and barangay = 'Tambacan');

drop policy if exists "beneficiaries_delete_cswd" on public.beneficiaries;
create policy "beneficiaries_delete_cswd" on public.beneficiaries for delete
  using (public.is_cswd());

-- households: staff manage; applicants can read the household linked to them
drop policy if exists "households_read" on public.households;
create policy "households_read" on public.households for select
  using (
    public.is_staff()
    or exists (
      select 1 from public.beneficiaries b
      where b.household_id = households.id and b.user_id = auth.uid()
    )
  );

drop policy if exists "households_write_staff" on public.households;
create policy "households_write_staff" on public.households for insert
  with check (public.is_staff() and barangay = 'Tambacan');

drop policy if exists "households_update_staff" on public.households;
create policy "households_update_staff" on public.households for update
  using (public.is_staff() and barangay = 'Tambacan')
  with check (public.is_staff() and barangay = 'Tambacan');

drop policy if exists "households_delete_cswd" on public.households;
create policy "households_delete_cswd" on public.households for delete
  using (public.is_cswd());

-- documents: uploader + staff read; uploader or CSWD delete
drop policy if exists "documents_read" on public.documents;
create policy "documents_read" on public.documents for select
  using (
    uploaded_by = auth.uid()
    or public.is_staff()
    or exists (
      select 1 from public.beneficiaries b
      where b.id = documents.beneficiary_id and b.user_id = auth.uid()
    )
  );

drop policy if exists "documents_insert_own" on public.documents;
create policy "documents_insert_own" on public.documents for insert
  with check (uploaded_by = auth.uid());

drop policy if exists "documents_update" on public.documents;
create policy "documents_update" on public.documents for update
  using (uploaded_by = auth.uid() or public.is_staff());

drop policy if exists "documents_delete_owner_or_cswd" on public.documents;
create policy "documents_delete_owner_or_cswd" on public.documents for delete
  using (uploaded_by = auth.uid() or public.is_cswd());

-- aid distributions: staff read/write; beneficiaries read their own
drop policy if exists "aid_read" on public.aid_distributions;
create policy "aid_read" on public.aid_distributions for select
  using (
    public.is_staff()
    or exists (
      select 1 from public.beneficiaries b
      where b.id = aid_distributions.beneficiary_id and b.user_id = auth.uid()
    )
  );

drop policy if exists "aid_write_staff" on public.aid_distributions;
create policy "aid_write_staff" on public.aid_distributions for insert
  with check (public.is_staff() and barangay = 'Tambacan');

drop policy if exists "aid_update_staff" on public.aid_distributions;
create policy "aid_update_staff" on public.aid_distributions for update
  using (public.is_staff() and barangay = 'Tambacan')
  with check (public.is_staff() and barangay = 'Tambacan');

drop policy if exists "aid_delete_cswd" on public.aid_distributions;
create policy "aid_delete_cswd" on public.aid_distributions for delete
  using (public.is_cswd());

-- reports: staff generate and read; CSWD deletes
drop policy if exists "reports_read" on public.reports;
create policy "reports_read" on public.reports for select using (public.is_staff());

drop policy if exists "reports_insert" on public.reports;
create policy "reports_insert" on public.reports for insert
  with check (public.is_staff() and generated_by = auth.uid());

drop policy if exists "reports_delete_cswd" on public.reports;
create policy "reports_delete_cswd" on public.reports for delete
  using (public.is_cswd());

-- ---------------------------------------------------------------------------
-- 9. Private Supabase Storage bucket for supporting documents
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('beneficiary-documents', 'beneficiary-documents', false,
        5242880, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Least-privilege storage policies: users may only write inside their own
-- folder; staff may read; only the owner or CSWD may delete.
drop policy if exists "documents_storage_insert_own" on storage.objects;
create policy "documents_storage_insert_own" on storage.objects for insert
  to authenticated with check (
    bucket_id = 'beneficiary-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "documents_storage_select" on storage.objects;
create policy "documents_storage_select" on storage.objects for select
  to authenticated using (
    bucket_id = 'beneficiary-documents'
    and (
      owner = auth.uid()
      or (storage.foldername(name))[1] = auth.uid()::text
      or public.is_staff()
    )
  );

drop policy if exists "documents_storage_update" on storage.objects;
create policy "documents_storage_update" on storage.objects for update
  to authenticated using (
    bucket_id = 'beneficiary-documents'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_staff())
  );

drop policy if exists "documents_storage_delete" on storage.objects;
create policy "documents_storage_delete" on storage.objects for delete
  to authenticated using (
    bucket_id = 'beneficiary-documents'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_cswd())
  );
