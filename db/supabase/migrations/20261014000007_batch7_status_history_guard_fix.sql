-- ===========================================================================
-- ReliefGov — Migration 0007: status-history guard fix + history cleanup
-- Scope: Barangay Tambacan, Iligan City, Lanao del Norte (capstone study)
-- ===========================================================================
--
-- Why this migration exists (found during Part 7 final verification):
--
-- 1. BUG: public.status_history_guard() returns NEW for every operation.
--    In a BEFORE DELETE trigger NEW is NULL, and returning NULL silently
--    CANCELS the delete — even for the service role and direct SQL, which
--    the function's own comment promises to allow. Effects:
--      * legitimate maintenance deletes of history rows silently no-op;
--      * ON DELETE CASCADE from beneficiaries cannot remove child history
--        rows in some paths, which previously let rows referencing deleted
--        beneficiaries accumulate.
--    Fix: return OLD for DELETE operations on trusted paths. Untrusted
--    roles still receive the exception — the append-only protection for
--    clients is unchanged.
--
-- 2. CLEANUP: remove pre-existing orphaned application_status_history rows
--    (beneficiary_id pointing at beneficiaries deleted in earlier development
--    cycles before the foreign key existed). These rows are invisible to the
--    application (every read joins live beneficiaries) but are removed so the
--    stored data is internally consistent.
--
-- Both statements are idempotent (safe to re-run).
-- ===========================================================================

create or replace function public.status_history_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  jwt text := public.jwt_role();
begin
  if jwt = 'service_role' or jwt = '' then
    -- Trusted server-side operations and direct SQL.
    -- BEFORE-delete triggers must return OLD; returning NEW (NULL for
    -- DELETE) would silently cancel the delete.
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  raise exception 'Status history is written only by the ReliefGov server.';
end $$;

-- Orphan cleanup (runs after the guard fix, which now permits trusted deletes).
delete from public.application_status_history h
where h.beneficiary_id is not null
  and not exists (
    select 1 from public.beneficiaries b where b.id = h.beneficiary_id
  );
