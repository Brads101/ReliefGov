# ReliefGov — Database setup (Supabase PostgreSQL)

Scope of implementation: **Barangay Tambacan, Iligan City, Lanao del Norte** only.
Central administrative stakeholder: **CSWD Office, Iligan City**.

## Migrations

Migrations are version-controlled SQL files applied in numeric order:

| File | Purpose |
| --- | --- |
| `migrations/20261014000001_initial_foundation.sql` | Batch 1 foundation: profiles, beneficiaries, validation, scoring, notifications, audit logs, base RLS. Already applied to the project. |
| `migrations/20261014000002_batch2_auth_rls_storage.sql` | Batch 2: households, documents, aid distribution, reports; capstone beneficiary fields; staff approval workflow; least-privilege RLS; private Storage bucket. |
| `migrations/20261014000003_batch3_beneficiary_profiling.sql` | Batch 3: incident/household/`status_reason` columns; workflow statuses (`Draft/Pending/Under Verification/Needs Correction/Approved/Rejected`); `application_status_history` (append-only); one-open-application unique index; rewritten `beneficiaries_guard`; notifications RLS reduced to select-own. |
| `migrations/20261014000004_batch4_validation_duplicates.sql` | Batch 4: `validation_status` extended (`Pending/Verified/Flagged/Duplicate/Rejected`); duplicate-flag evidence columns on `validation_results` (`candidate_id`, `match_details`, `confidence`, `decision`, `reviewed_at`); `verification_reviews` table (stage/outcome/remarks/reviewer, staff-read-only); `documents.status_reason`; queue indexes; `validation_results` RLS tightened to select-only for staff. |
| `migrations/20261014000005_batch5_vulnerability_scoring.sql` | Batch 5: `vulnerability_scores` extended for auditable ML scoring — `status` (`current`/`superseded`), `source` (`model`/`manual`), `dataset_type` (synthetic/historical), `probabilities`, `confidence`, `indicator_snapshot`, `scored_by`, `corrected_by`, `correction_reason`, `flag_note`, `flagged_by`, `flagged_at`; partial unique index (one current score per beneficiary) + status index; RLS tightened to staff **SELECT-only** (scores, flags, and corrections are written exclusively by the server with the service role). |
| `migrations/20261014000006_batch6_monitoring_reporting.sql` | Batch 6: `reports` gains 'Duplicate review'/'Period summary' types + created/type indexes; `aid_distributions` gains `recorded_by`, `status_reason`, the partial unique index `aid_open_plan_idx` (one open 'Planned' entry per beneficiary per assistance type — duplicate-submit backstop) and a monitoring index; `notifications` gains `category` (application/validation/scoring/distribution/staff/system, check-constrained) and `link_path` (in-app only) + unread/user indexes; `audit_logs` gains created/actor indexes. |
| `migrations/20261014000007_batch7_status_history_guard_fix.sql` | Batch 7 (final verification): fixes `status_history_guard()` so trusted paths (service role / direct SQL) can delete — a BEFORE DELETE trigger must return OLD; the previous `return NEW` silently cancelled every delete — and removes orphaned `application_status_history` rows left from development cycles that predate the foreign key. Untrusted roles still receive the exception; the append-only protection is unchanged. |

Every migration is idempotent (safe to re-run).

## How to apply

### Option A — Supabase SQL editor (simplest)

1. Open the project in the Supabase dashboard → **SQL Editor**.
2. Paste the contents of a migration file and press **Run**.
3. Repeat for the next migration. The editor reports `Success. No rows returned`
   for DDL-only migrations — that is expected.

### Option B — Supabase CLI

```bash
supabase link --project-ref knavlyqfsfsfnboflwue
supabase db push
```

## Environment variables

Server side (`server/.env`, see `server/.env.example`):

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Project URL (`https://<ref>.supabase.co`) |
| `SUPABASE_ANON_KEY` | Public key used for Supabase Auth sign-in and session verification |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only.** Never sent to the browser, never committed |
| `SESSION_SECRET` | Signs ReliefGov API session tokens |
| `CLIENT_ORIGIN` | Allowed web origin (default `http://localhost:5173`) |

Client side (`client/.env`, see `client/.env.example`):

| Variable | Purpose |
| --- | --- |
| `VITE_API_URL` | Express API base URL |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Public project values (optional; protected by RLS) |

No real secrets are committed anywhere in this repository.

## Creating the first authorized CSWD administrator

The system never allows a public signup to grant itself an elevated role, and the
database trigger (`handle_new_user`) always creates new accounts as **approved
beneficiaries**. The first CSWD administrator is therefore provisioned through a
trusted, out-of-band step performed by the office that controls the Supabase project:

1. In the Supabase dashboard, open **Authentication → Users → Add user**.
   Provide the CSWD administrator's email and a strong temporary password, and
   check **Auto Confirm User**.
2. In the **User Metadata** field enter:

   ```json
   { "full_name": "CSWD Administrator Name" }
   ```

   Do **not** put a `role` there — the database ignores it on purpose.
3. Open the SQL editor and run the following (replace the email):

   ```sql
   update public.profiles
   set role = 'cswd_staff',
       approval_status = 'approved',
       is_active = true,
       approved_at = now()
   where email = 'cswd.admin@iligan.gov.ph';
   ```

4. Sign in to ReliefGov with that account. From then on, all further staff
   accounts are created inside the app under **User Management** (CSWD-only):
   they land in a *pending* state and must be approved before they can sign in.

Roles are changed only through the service-role server path or a direct,
office-controlled SQL statement — never through a public form, URL, request
body, or query parameter.

## Security model (summary)

- **Row Level Security** is enabled on every table. Policies are least-privilege:
  - Beneficiaries read and edit **only their own** profile, application,
    documents, timeline, and notifications, and cannot change validation or vulnerability
    fields (enforced by trigger, not just policy). They can only edit application
    content while the status is `Draft` or `Needs Correction`; status, barangay,
    validation, scoring, duplicate flags, and data origin are server/staff-only.
  - Status history (`application_status_history`) is **append-only**: rows are
    written exclusively by the server (service role); clients can only read their own.
  - Notifications are **read-only for clients** — rows are inserted (and marked
    read) only by the server, so an applicant can never fabricate a status message.
  - A partial **unique index allows at most one open application per account**
    (`Draft/Pending/Under Verification/Needs Correction`), so duplicate
    submissions cannot be stored even under concurrent requests.
  - Barangay Staff access only **Tambacan** records; every barangay, city, and
    province column carries a `check` constraint, so an out-of-scope value is
    rejected by the database itself regardless of how it arrives.
  - Duplicate-flag decisions (`validation_results`) are **select-only for staff**:
    rows and decisions are written exclusively by the server, and each decision
    stores reviewer, timestamp, and notes. Verification reviews
    (`verification_reviews`) follow the same pattern — staff read, server write.
  - Vulnerability scores (`vulnerability_scores`) follow the same pattern —
    staff **SELECT-only**; scoring runs, flags and manual corrections are written
    exclusively by the server with the service role, each carrying actor,
    timestamp, model version, dataset provenance (`synthetic` in this
    deployment), probabilities, and the indicator snapshot used. A partial
    unique index keeps at most one `current` score per beneficiary; superseded
    rows are never deleted (append-only history).
  - CSWD Staff access the records needed for central oversight and are the only
    role that manages accounts.
- **Storage**: the `beneficiary-documents` bucket is **private**. Uploads are
  limited to PDF/JPEG/PNG and 5 MB, stored under the uploader's own folder, and
  downloaded only through a server-side ownership check that returns a short-lived
  signed URL. Storage policies deny public access.
- **Passwords** live in Supabase Auth only — there is no password column in any
  application table.
- The **service-role key** is read only by the Express server from `server/.env`.

## Testing

With Supabase configured in `server/.env`:

```bash
npm test --workspace server
```

The suite covers unauthorized access (401/403), role-escalation attempts
(registration, PostgREST updates, direct inserts), Tambacan-only enforcement,
document ownership/type/size checks, and password-recovery error handling
(`security.test.js`), plus the full beneficiary application workflow: profile
create/edit rules, barangay-injection rejection, one-open-application duplicate
prevention, certificate-gated submission, idempotent resubmits, the staff
transition matrix with mandatory reasons, self-approval/cross-account PostgREST
probes, timeline integrity, and notification privacy (`applications.test.js`),
and the Data Validation & Duplicate Detection module: Tambacan-scoped queue,
Draft hiding, barangay verification with review rows, CSWD-only final decisions,
duplicate scanning with the name-anchor floor, flag confirm/dismiss/request-info
lifecycle with optimistic locking, decision audit trails, document review
permissions, report preparation with live snapshots, and staff-summary
authorization (`validation.test.js`), plus the Random Forest Vulnerability
Scoring module: synthetic-dataset labelling, training reproducibility,
serialization round-trip, honest model status, missing/invalid indicator
validation, model loading failures (explicit 503s), score persistence and
history, staleness detection, duplicate-profile independence, CSWD-only
flag/correction with mandatory notes, list filters/sorting, beneficiary 403s,
and the database-level Tambacan constraint (`scoring.test.js`), plus the
Monitoring & Reporting module: database-driven dashboard metrics, report
filters and CSV exports under the caller's own permissions, the aid
distribution workflow (Approved-only eligibility, duplicate open-plan guard,
release attribution, cancellation reasons), notification permissions and
category filters, and cross-role data isolation (`monitoring.test.js`).
Test accounts are created with `@reliefgov.test` emails and deleted afterwards.
The suite runs serialized (`--test-concurrency=1`) because test files share
one live database. Final verification result: **116 / 116 passing**.

A read-only schema/state audit is also available:

```bash
node scripts/verify-db.js   # from server/
```

It checks table existence, migration columns, effective RLS blocking (anon
key gets zero rows), Tambacan scoping, controlled vocabularies, and integrity
invariants against the live database.
