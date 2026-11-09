-- ===========================================================================
-- ReliefGov — migration 0001: initial foundation (Batch 1)
-- Scope of implementation/testing: BARANGAY TAMBACAN, ILIGAN CITY,
-- LANAO DEL NORTE, PHILIPPINES. Central stakeholder: CSWD Office, Iligan City.
--
-- This file is the preserved Batch 1 schema (already applied to the project).
-- Apply with the Supabase SQL editor or `supabase db push`.
-- ===========================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1. Profiles (role management)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text not null,
  role        text not null default 'beneficiary'
              check (role in ('beneficiary', 'barangay_staff', 'cswd_staff')),
  barangay    text not null default 'Tambacan'
              check (barangay = 'Tambacan'),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. Beneficiary profiling
-- ---------------------------------------------------------------------------
create table if not exists public.beneficiaries (
  id                      uuid primary key default gen_random_uuid(),
  beneficiary_number      text unique not null,
  user_id                 uuid references auth.users (id) on delete set null,
  first_name              text not null,
  middle_name             text default '',
  last_name               text not null,
  sex                     text check (sex in ('Female', 'Male', 'Prefer not to say')),
  date_of_birth           date,
  civil_status            text,
  mobile_number           text,
  household_no            text,
  purok                  text,
  barangay                text not null default 'Tambacan'
                          check (barangay = 'Tambacan'),
  city_municipality       text not null default 'Iligan City'
                          check (city_municipality = 'Iligan City'),
  province                text not null default 'Lanao del Norte'
                          check (province = 'Lanao del Norte'),
  household_size          integer,
  housing_type            text,
  employment_status       text,
  monthly_family_income   numeric(12, 2),
  monthly_per_capita_income numeric(12, 2),
  is_senior               boolean not null default false,
  is_pregnant             boolean not null default false,
  is_pwd                  boolean not null default false,
  is_lone_parent          boolean not null default false,
  has_no_income           boolean not null default false,
  is_internally_displaced boolean not null default false,
  vulnerability_score     numeric(5, 2),
  vulnerability_class     text check (vulnerability_class in ('Low', 'Moderate', 'High', 'Severe')),
  validation_status       text not null default 'Pending'
                          check (validation_status in ('Pending', 'Verified', 'Flagged')),
  duplicate_of            uuid references public.beneficiaries (id) on delete set null,
  data_origin             text not null default 'user-entry',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists beneficiaries_barangay_idx on public.beneficiaries (barangay);
create index if not exists beneficiaries_validation_idx on public.beneficiaries (validation_status);
create index if not exists beneficiaries_name_idx on public.beneficiaries (lower(last_name), lower(first_name));

-- ---------------------------------------------------------------------------
-- 3. Validation and duplicate detection (later batch)
-- ---------------------------------------------------------------------------
create table if not exists public.validation_results (
  id                  uuid primary key default gen_random_uuid(),
  beneficiary_id      uuid not null references public.beneficiaries (id) on delete cascade,
  duplicate_of        uuid references public.beneficiaries (id) on delete set null,
  similarity_score    numeric(5, 4),
  status              text not null default 'Pending'
                      check (status in ('Pending', 'Cleared', 'Flagged', 'Merged')),
  reviewed_by         uuid references public.profiles (id) on delete set null,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 4. Random Forest vulnerability scoring (later batch)
-- ---------------------------------------------------------------------------
create table if not exists public.vulnerability_scores (
  id                  uuid primary key default gen_random_uuid(),
  beneficiary_id      uuid not null references public.beneficiaries (id) on delete cascade,
  model_version       text not null,
  score               numeric(5, 2) not null,
  class               text not null check (class in ('Low', 'Moderate', 'High', 'Severe')),
  top_factors         jsonb not null default '[]'::jsonb,
  evaluated_on        text not null default 'synthetic-training-data',
  created_at          timestamptz not null default now()
);

create index if not exists vulnerability_scores_beneficiary_idx
  on public.vulnerability_scores (beneficiary_id);

-- ---------------------------------------------------------------------------
-- 5. Notifications (later batch)
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users (id) on delete cascade,
  title       text not null,
  body        text not null,
  level       text not null default 'info' check (level in ('info', 'success', 'warning', 'error')),
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 6. Audit log (traceability of validation / scoring actions)
-- ---------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references public.profiles (id) on delete set null,
  action      text not null,
  entity      text,
  entity_id   uuid,
  detail      jsonb,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists beneficiaries_updated_at on public.beneficiaries;
create trigger beneficiaries_updated_at before update on public.beneficiaries
  for each row execute function public.set_updated_at();

drop trigger if exists validation_results_updated_at on public.validation_results;
create trigger validation_results_updated_at before update on public.validation_results
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Auto-create a profile when a Supabase Auth user signs up
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role, barangay)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    coalesce(nullif(new.raw_user_meta_data ->> 'role', ''), 'beneficiary'),
    'Tambacan'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.beneficiaries enable row level security;
alter table public.validation_results enable row level security;
alter table public.vulnerability_scores enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('barangay_staff', 'cswd_staff')
      and is_active = true
  );
$$;

create or replace function public.is_cswd()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'cswd_staff' and is_active = true
  );
$$;

drop policy if exists "profiles_read_own_or_staff" on public.profiles;
create policy "profiles_read_own_or_staff" on public.profiles for select
  using (id = auth.uid() or public.is_staff());

drop policy if exists "profiles_update_own_or_cswd" on public.profiles;
create policy "profiles_update_own_or_cswd" on public.profiles for update
  using (id = auth.uid() or public.is_cswd());

drop policy if exists "beneficiaries_read" on public.beneficiaries;
create policy "beneficiaries_read" on public.beneficiaries for select
  using (public.is_staff() or user_id = auth.uid());

drop policy if exists "beneficiaries_write_staff" on public.beneficiaries;
create policy "beneficiaries_write_staff" on public.beneficiaries for insert
  with check (public.is_staff() and barangay = 'Tambacan');

drop policy if exists "beneficiaries_update_staff" on public.beneficiaries;
create policy "beneficiaries_update_staff" on public.beneficiaries for update
  using (public.is_staff());

drop policy if exists "beneficiaries_delete_cswd" on public.beneficiaries;
create policy "beneficiaries_delete_cswd" on public.beneficiaries for delete
  using (public.is_cswd());

drop policy if exists "validation_staff" on public.validation_results;
create policy "validation_staff" on public.validation_results for all
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists "scores_staff" on public.vulnerability_scores;
create policy "scores_staff" on public.vulnerability_scores for all
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists "notifications_own" on public.notifications;
create policy "notifications_own" on public.notifications for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "audit_staff" on public.audit_logs;
create policy "audit_staff" on public.audit_logs for select using (public.is_staff());

-- ---------------------------------------------------------------------------
-- Barangay Staff are restricted to Barangay Tambacan (single-barangay study).
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'beneficiaries' and policyname = 'beneficiaries_tambacan_only'
  ) then
    create policy "beneficiaries_tambacan_only" on public.beneficiaries for update
      using (barangay = 'Tambacan' and public.is_staff())
      with check (barangay = 'Tambacan' and public.is_staff());
  end if;
end $$;
