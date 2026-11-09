# ReliefGov — Implementation Plan (batch log)

## Batch 1 — Foundation + Supabase connection

**Scope:** inspect the repository, establish the foundation, and verify the application starts.

## Findings (inspection)

- The working directory `D:\FINAL RELIEFGOV` was **empty** — no framework, no source files,
  no `package.json`, no configuration, no errors to preserve.
- Environment: Node.js v24.19.0, npm 11.6.2, Git 2.55.0.
- Decision: establish the stack specified by the capstone requirements
  (React + Vite + Tailwind / Node + Express / Supabase PostgreSQL) as a new foundation.
  There was no existing stack to adapt to.

## Plan executed

1. **Workspace** — npm workspaces with `server/` and `client/`, root `npm run dev` via `concurrently`.
2. **Application tier** — Express API with structured routing, centralised error handling,
   JWT sessions, role middleware (`beneficiary`, `barangay_staff`, `cswd_staff`), and
   explicit HTTP 501 placeholders for modules scheduled in later batches.
3. **Data tier** — Supabase schema with RLS (Tambacan-only constraints) plus a data-source
   adapter with three honest modes: `supabase` (live), `synthetic` (labelled demo data),
   `none` (503 + actionable message). Dashboard counters are always computed.
4. **Presentation tier** — civic visual system (navy/government blue/teal with restrained
   emergency orange), reusable UI kit, responsive sidebar/topbar, guarded routes,
   login/registration, dashboard, read-only beneficiary registry, module placeholders.
5. **Verification** — install, build, start both tiers, hit the API endpoints.

## Batch boundaries respected

Built in this batch: workspace, API foundation, data layer, auth/roles, visual system,
navigation, dashboard shell, read-only registry.

Deferred to later batches (HTTP 501, honest placeholders): beneficiary write workflows,
validation/duplicate detection, Random Forest scoring, reports, notifications, user management.

## Batch 2 — Database + authentication foundation

**Scope:** version-controlled migrations, normalized entities, Supabase Auth with RBAC,
least-privilege RLS, staff approval workflow, private document storage, and security tests.

### Findings (inspection)

- The single `db/supabase/schema.sql` was not version-controlled as a migration and had
  no history mechanism; it was preserved byte-identical as migration `0001`.
- `POST /api/auth/register` accepted a `role` of `barangay_staff` — a public role-escalation
  path. Closed: self-registration is now beneficiary-only and rejects staff roles with 403.
- No staff approval/activation workflow existed; no `profiles` approval columns.
- No password-recovery flow, no account-management endpoints (`/api/users` was a 501 stub),
  no document storage.
- RLS from Batch 1 let any authenticated user read all profiles; tightened to
  own-row-or-CSWD with triggers guarding privileged columns.
- The global 1 MB JSON body limit would have rejected legitimate 5 MB document uploads
  (≈6.7 MB base64) — scoped an 8 MB limit to `/api/documents` only.

### Plan executed

1. **Migrations** — `db/supabase/migrations/` with two idempotent, numbered SQL files:
   `0001` (preserved Batch 1 foundation, already applied) and `0002` (households, documents,
   aid distribution, reports, capstone beneficiary fields, approval workflow, RLS, storage
   bucket). Setup guide: `db/supabase/README.md`.
2. **Authentication hardening** — `handle_new_user` always creates approved beneficiary
   profiles (signup metadata role is ignored); privileged roles are only assigned by the
   server through the service role; `profiles_guard` blocks authenticated clients from
   changing role/approval/activation/email; every request re-verifies approval + activation.
3. **Staff approval workflow** — CSWD-only `/api/users` router: list, create pending staff,
   approve/reject, activate/deactivate, change role — audit-logged, no self-demotion or
   last-CSWD lockout. Pending/rejected accounts cannot sign in or use issued tokens.
4. **Password recovery** — server-mediated `/auth/forgot-password` (generic response, no
   account enumeration) and `/auth/reset-password` (token verified against Supabase with a
   dedicated client); client pages `ForgotPassword` and `ResetPassword`.
5. **Document storage** — private `beneficiary-documents` bucket (PDF/JPEG/PNG, ≤5 MB),
   server-side base64 upload with magic-byte sniffing, ownership checks, short-lived
   signed-URL downloads, owner/CSWD delete. Storage policies limit writes to the
   uploader's own folder.
6. **Presentation** — Register no longer offers a staff account type; Login gained
   recovery links and success notices; CSWD **User Management** page replaces the placeholder.
7. **Security tests** — `server/tests/security.test.js` (node:test, live Supabase,
   cleanup after): 401/403 unauthorized access, registration role escalation, PostgREST
   role-escalation and direct-insert probes, pending/deactivated login rejection,
   Tambacan-only insert/update enforcement, self-verification blocking, document
   type/size/ownership checks, recovery-token error handling, enumeration resistance.

### Open questions (assumptions applied, confirm before later batches)

- Purok list for Tambacan is free text in this batch — needs the official list.
- Enumerations used: income level (`No income/Low/Moderate/High`), damage extent
  (`None/Minor/Major/Total`), house status (`Owned/Rented/Shared/Informal settler/Other`),
  application status (`Draft/Submitted/Under review/Approved/Rejected`).
- Duplicate-similarity threshold and matched fields — Batch 3 (validation module).
- Random Forest feature set and Low/Moderate/High/Severe thresholds — scoring batch.
- Report export format (CSV/PDF) — reporting batch.

## Batch 3 — Beneficiary Profiling Module

**Scope:** the complete beneficiary-side application lifecycle — multi-section profile form,
supporting documents, review-and-submit with confirmation, traceable workflow statuses,
status history timeline, notifications, and the applicant's own vulnerability result.

### Findings (inspection)

- No create/update path for beneficiary records existed (`/api/beneficiaries` was
  read-only for staff); no self-service profiling at all.
- The Batch 2 status vocabulary (`Submitted` / `Under review`) did not match the capstone
  workflow language, and no state expressed "staff asked the applicant to fix something".
- `notifications` had no endpoints (HTTP 501) and its `for all` RLS policy let users
  fabricate their own notifications.
- `beneficiaries` lacked the incident/household columns the capstone form requires
  (`incident_type/date/description`, `damage_extent`, `house_status`, `income_level`).
- Nothing prevented duplicate applications or repeated-submission races.

### Plan executed

1. **Migration `0003`** — incident/household/`status_reason` columns; status vocabulary
   aligned to `Draft → Pending → Under Verification → Needs Correction | Approved |
   Rejected` (`Submitted`→`Pending`, `Under review`→`Under Verification` renamed);
   `application_status_history` table (append-only, server-written, owner/staff-readable);
   a partial **unique index enforcing one open application per account**; rewritten
   `beneficiaries_guard` (applicant may edit content only while `Draft`/`Needs Correction`,
   can never change status, barangay, validation/scoring/duplicate columns, beneficiary
   number, or data origin; new records forced to `Draft` + `self-service`); notifications
   RLS reduced to select-own (rows created only by the server).
2. **Server API** — `GET/POST/PATCH /api/applications/mine` (ownership from the verified
   token, never from the request body; strict field whitelist — a client-supplied
   `barangay` is rejected with 400, not silently trusted), `POST
   /api/applications/mine/submit` (idempotent; requires the stored row to pass full
   validation and at least one **Barangay certificate** document; optimistic lock against
   concurrent submits), staff-only `POST /api/applications/:id/transition` (matrix-checked:
   Pending→Under Verification→Approved|Rejected|Needs Correction, reasons mandatory for
   Needs Correction/Rejected, submission alone can never approve), and
   `/api/notifications` (own list, mark read, mark all read). Every status change writes
   timeline history, an audit-log entry, and an in-app notification.
3. **Server validation** — `server/src/lib/validate.js` shared field rules (names, enums,
   dates not in the future, family size 1–50, mobile format) with per-field error maps;
   drafts save partially, submission re-validates the stored row in full.
4. **Client** — 4+1-step wizard `ApplicationForm` (Personal → Household → Incident →
   Documents → Review & submit) with autosave between sections, preserved inputs on
   errors, required markers, per-field messages, XHR upload with progress bar, and a
   confirmation dialog before submit; `Application` status page (status card, reason,
   full timeline, submitted information, documents, own vulnerability result);
   real `Notifications` page; beneficiary dashboard panel; `My Application` nav item.
   Shared option lists and client-mirror rules in `client/src/lib/constants.js`.
5. **Tests** — `server/tests/applications.test.js` (21 tests, live Supabase, cleaned up):
   registration→login→create, barangay injection rejected, one-open-application 409,
   per-field validation, privileged fields refused, submit-without-certificate 400,
   upload visibility, submit→Pending+history+notification, idempotent resubmit, edit lock
   while pending, PostgREST self-approval and cross-account probes (rows, history,
   transitions), staff transition matrix + reason enforcement, edit+resubmit after
   correction, approved→own vulnerability result, rejection reason readback, notification
   privacy, 401s, staff registry visibility. Full suite: **37/37 passing**.
6. **Smoke (browser + API)** — registered a new account in the UI, completed the wizard
   (autosave, prefill-on-return, upload control), then drove create→certificate→submit→
   Under Verification→Needs Correction→edit→resubmit as the demo beneficiary; verified
   the status page timeline, correction reason, documents, and notifications rendering.

### Decisions applied (documented assumptions)

- **Statuses:** `Draft` (editable), `Pending` (submitted, awaiting verification),
  `Under Verification`, `Needs Correction` (reason required, applicant edits and
  resubmits), `Approved`, `Rejected` (reason required) — the last two terminal.
  Staff transitions: Pending→Under Verification; Under Verification→Approved/Rejected/
  Needs Correction. No auto-approval anywhere.
- **One open application per account** (DB unique index + 409s + idempotent submit) —
  duplicate submissions from double clicks or network retries cannot create records.
- **Purok:** dropdown of placeholder `Purok 1–8` plus `Other (specify)` free text —
  replace with the official Tambacan purok list when confirmed with the LGU.
- **Vulnerability result** is shown to the applicant only on their own record and only
  once the scoring module (later batch) has produced a class; until then "Not yet assessed".
- **Households table** stays unused for now; the Batch 3 form writes direct columns on
  `beneficiaries` — revisit when household-level features (per-capita income) are scored.
- Staff verification UI (registry actions) is deferred to the validation batch; the
  transition API exists and is exercised end-to-end by tests.

## Batch 4 — Data Validation & Duplicate Detection Module

**Scope:** the barangay/CSWD review workflow — a Tambacan-scoped validation queue,
household verification with recorded outcomes, evidence-based duplicate detection with
human review decisions, CSWD final validation, document review, and a first
Monitoring & Reports slice.

### Findings (inspection)

- No duplicate-detection logic existed anywhere; `validation_status` was a single
  `Pending` value with no path to `Verified`/`Rejected`; `validation_results` existed
  with an unused `Merged` status and no evidence columns.
- The Batch 3 transition matrix let **barangay staff** reach `Approved`/`Rejected` —
  contradicts the capstone rule that final validation is a CSWD decision.
- No `verification_reviews` table: internal outcome/remarks per review stage were
  nowhere recorded; `documents` had no review status (upload-only).
- Staff dashboards and reports read the beneficiary-facing `/dashboard/summary` —
  no queue-oriented staff view, no report preparation path (`/api/reports` was 501).

### Plan executed

1. **Migration `0004`** (applied to live Supabase) — extended
   `validation_status` to `Pending|Verified|Flagged|Duplicate|Rejected`;
   `validation_results.status` to `Pending|Flagged|Cleared|Confirmed` with new
   `candidate_id`, `match_details`, `confidence`, `decision`, `reviewed_at` columns;
   new `verification_reviews` table (stage `barangay_verification|cswd_review`,
   outcome, remarks, reviewer — staff-read-only RLS); `documents.status_reason`;
   queue indexes; `validation_results` RLS tightened to select-only for staff
   (decisions are written only by the server with the service role).
2. **Duplicate engine** (`server/src/lib/duplicates.js`) — normalized comparison of
   names (direct + token-sorted Levenshtein), date of birth, mobile number, purok,
   and family size with weighted renormalization. A **name-anchor floor** (`0.45`)
   guarantees no flag without reasonable name overlap; confidence ladder: high
   (name + DOB or name + mobile), medium (name + a matching detail or score ≥ 0.78),
   low (very strong name alone). A matching name alone is never treated as proof.
3. **Validation service** — queue (`GET /api/validation/queue` with search/status/
   purok/date/duplicate filters, Drafts hidden from staff), duplicate flags with
   hydrated evidence (`GET /api/validation/duplicates`), flag decisions
   (`POST /api/validation/flags/:id` — confirm/dismiss/request-info, notes ≥ 5 chars,
   optimistic lock, final; confirm links records and sets `Duplicate` but **never
   deletes a record or changes the application status**), record detail bundle
   (profile/documents/history/reviews/flags/capabilities), and re-scan
   (already-compared pairs are never re-flagged).
4. **Workflow tightening** — `Approved`/`Rejected` are now CSWD-only (403 for
   barangay staff; the matrix check runs before the role gate so illegal moves still
   return 409). Every staff transition writes a `verification_reviews` row with stage
   by role, optional internal remarks, and an applicant-visible reason where required.
   Staff notifications: new submission → barangay queue; barangay verification →
   CSWD queue; return-for-correction → applicant; document decision → uploader.
   Scans run on submit (failures are logged, never blocking).
5. **Documents & reports** — `PATCH /api/documents/:id/status` (Accepted/Rejected with
   required reason, uploader notified); `reportService` preparing 5 report types from
   a live Tambacan snapshot (`GET/POST /api/reports`), filed to
   `CSWD Office, Iligan City`, Screen format (CSV/PDF deferred to the full
   Monitoring batch); `GET /api/dashboard/staff-summary` (queue counts, open flags,
   recent submissions, purok breakdown, distribution, reports).
6. **Client** — `Validation.jsx` (queue with filters + status badges, record detail
   with Profile/Documents/Timeline/Duplicates tabs, verification + approve/reject +
   document dialogs with reason enforcement, flag decision dialog with evidence and
   the "confirming is not a deletion" warning), `Reports.jsx` (prepared list +
   prepare dialog + snapshot viewer), staff operations panel on the dashboard,
   client vocabulary added to `constants.js`.
7. **Tests** — `server/tests/validation.test.js` (25 tests, live Supabase, cleaned up):
   Tambacan-only queue, Draft hiding, search/filters, detail bundle, barangay
   verification + review rows, CSWD approve/reject with reasons + 403s for barangay
   staff, duplicate scan (high/low/no-flag cases including the name-anchor floor),
   flag lifecycle (request-info keeps open, confirm/dismiss finality, notes
   enforcement, re-scan never re-flags), duplicate status preserved on rejection,
   document review permissions, report preparation + snapshot contents,
   staff-summary authorization. Full suite: **62/62 passing**.
8. **Browser smoke (full workflow)** — barangay staff: queue filters (flagged-only,
   search), record detail, start-verification dialog → status + review row, document
   accept, duplicate flag confirm (empty-notes validation, audit trail), flags
   decision-history segment, reports prepare dialog. CSWD: approve (final) →
   `Approved|Verified`; open+reject the flagged duplicate → `Rejected` with
   `Duplicate` validation status preserved and applicant-visible reason. Beneficiary:
   `/validation` and `/reports` redirect to the dashboard. Throwaway records and
   notifications removed afterwards; demo data restored.

### Decisions applied (documented assumptions)

- **Duplicate flags never auto-decide anything.** A flag only routes the pair to a
  human queue; confirming links the records (`duplicate_of` + validation status
  `Duplicate`) and dismissing records the decision — the application status is
  always changed by an explicit, separate staff decision.
- **Final validation belongs to CSWD.** Barangay staff verify and endorse
  (Pending → Under Verification); only CSWD approves or rejects, with mandatory
  reasons on rejection/return. Beneficiaries can never self-approve (no endpoint
  reaches those statuses from the applicant side).
- **Decisions are final and audited** — optimistic lock against double submits,
  reviewer/timestamp/notes stored on the flag, no silent overwrites.
- **Name similarity alone never exceeds low confidence** and below the anchor floor
  produces no flag at all; evidence (DOB/mobile/purok/family-size) is always shown
  so the reviewer judges, not the algorithm.
- **Reports are screen-view snapshots** for now; CSV/PDF exports wait for the full
  Monitoring & Reporting batch.
- No national-ID / PhilSys / biometric / external-government-database integration
  anywhere (explicitly out of scope) — only self-declared and barangay-attested
  data is compared.

## Batch 5 — Random Forest Vulnerability Scoring Module

**Scope:** an auditable, honest machine-learning scoring module — a dependency-free
Random Forest trained on a clearly labelled synthetic development dataset, per-record
scoring of validated beneficiaries with stored evidence, staleness detection, CSWD
flagging and authorized manual corrections, and full score history. Decision-support
only: the model never approves, rejects, or denies anything.

### Findings (inspection)

- No ML code existed anywhere; `vulnerability_scores` (migration 0001) held a bare
  `score`/`class`/`top_factors` row with no provenance, no history, no source
  tracking, and staff-writable RLS; `beneficiaries.vulnerability_score/class` were
  set directly by tests, never by a model.
- No labelled LGU dataset was supplied (none exists for this study) — training on
  real CSWD records was therefore impossible and would have been dishonest to claim.
- No scoring API, no model artifact, no evaluation, no explanation — and the client
  `/scoring` route was a static placeholder.

### Plan executed

1. **ML core** (`server/src/ml/`, zero runtime dependencies, fully separated from
   UI/DB code): seeded CART Random Forest (mulberry32 PRNG, Gini, bootstrap, sqrt
   subsampling), a documented rubric-v1 synthetic dataset generator (400 rows,
   seed 42, 4 % label noise), feature encoding/validation (`household_size`,
   `income_level`, `damage_extent`, `house_status` — 8-column vector; sex, age,
   civil status, senior/pregnant/PWD flags, mobile, names, purok deliberately
   excluded), stratified seeded 80/20 split, hold-out evaluation, and JSON
   serialization. Full documentation in `server/src/ml/README.md` (features,
   labels, preprocessing, training, serialization, evaluation, score conversion,
   limitations).
2. **Honest dataset & evaluation** — trained artifact `rf-1.0.0`: **83.75 %**
   hold-out agreement with the synthetic rubric (per-class F1: Low 0.73, Moderate
   0.85, High 0.88, Severe 0.60), reported as synthetic-rubric agreement, never as
   real-world accuracy. Reproducibility verified: two trains → byte-identical
   artifacts and metrics. Monotonic sanity verified (worst case → Severe/95.13,
   best case → Low/1.78). `npm run train:model` retrains deterministically.
3. **Score outputs documented, not invented** — `class` = argmax of tree votes;
   `probabilities` = vote shares (not calibrated harm probabilities);
   `confidence` = winning vote fraction (model agreement, not a CI); `score`
   (0–100) = documented conversion `100 * Σ(i/(K-1) * p_i)` for sorting only —
   not an official LGU scale. `dataset_type = 'synthetic'` is stored on every row
   and shown in the UI.
4. **Migration `0005`** (applied to live Supabase) — `vulnerability_scores` gains
   `status` (current/superseded), `source` (model/manual), `dataset_type`,
   `probabilities`, `confidence`, `indicator_snapshot`, `scored_by`, `corrected_by`,
   `correction_reason`, `flag_note`, `flagged_by`, `flagged_at`; partial unique
   index (one current score per beneficiary); RLS tightened to staff
   `SELECT`-only (server writes with the service role).
5. **Scoring service** (`scoringService.js`) — list (Tambacan-only, search/class/
   state filters, sort by score/class/name/date, missing/stale/flagged states,
   embedded honest model summary), detail bundle (current score, full superseded
   history, live staleness comparison, per-user capabilities), scoring action
   (validated statuses only — `Under Verification`/`Approved`; idempotent for
   fresh inputs unless `force`; supersede-before-insert with rollback; mirror
   columns synced; every run audited), CSWD-only flag (note ≥ 5 chars) and manual
   correction (class + reason ≥ 5 chars; new current row, model row superseded,
   never deleted; a standing correction is only replaced by an explicit forced
   re-run), and a dashboard summary. Model unavailability → honest HTTP 503 with
   "npm run train:model" guidance — **no score is ever fabricated**; missing or
   invalid indicators → 400 with per-indicator details.
6. **REST API** (`/api/scoring`, staff-only, wired in place of the 501
   placeholder) — `GET /model` (honest status: provenance, measured metrics,
   features/exclusions), `GET /summary`, `GET /beneficiaries`, `POST
   /beneficiaries/:id/score`, `GET /beneficiaries/:id`, `POST /scores/:id/flag`,
   `POST /scores/:id/correct`. Beneficiaries get 403 on all of them.
7. **Client** — `Scoring.jsx` (model banner with synthetic disclosure + measured
   per-category table + feature/exclusion disclosure; list with state/dataset
   badges, class chips, search/filter/sort; detail with priority category, the
   0–100 score labelled "not a probability of harm", tree-agreement confidence,
   vote-distribution bars, top-contributing-indicator explanation, indicator
   snapshot, re-run/flag/correct actions with mandatory note/reason dialogs,
   full history); `constants.js` vocabulary (`VULNERABILITY_CLASS_META`,
   `SCORE_STATE_META`, `DATASET_BADGE`); dashboard scoring card enriched with
   live scored/missing/stale/flagged counts + model provenance + human-decision
   reminder.
8. **Tests** — `server/tests/scoring.test.js` (31 tests, live Supabase, cleaned
   up): synthetic-dataset labelling, rubric determinism/monotonicity, training
   reproducibility, seeded stratified split, serialization round-trip, honest
   model status, priority-index conversion formula, feature validation (missing →
   400 with field details, invalid → 400), model loading failures (missing /
   corrupt / wrong-kind / broken-forest → explicit 503, cache test hook), stable
   ordered scoring, staff-only access + beneficiary 403 on all 7 endpoints,
   Pending-record 409 gate, invalid filters 400, score persistence (model
   version/date/indicators/mirror columns), idempotent re-run, forced-run
   reproducibility, independent scoring of duplicate-named profiles, staleness
   detection + re-run clearing it, missing-indicator 400 without losing the
   current score, honest 503 when the artifact is unavailable, CSWD-only flagging
   with note enforcement, CSWD-only correction with reason enforcement + history
   preservation + immutable superseded rows, post-correction re-scoring,
   list filters/sort verification, synthetic dataset-type disclosure on every
   row, scoring never touching application/validation status, and the DB-level
   Tambacan constraint. Full suite: **93/93 passing**.
9. **Browser smoke (full workflow)** — staff: model banner with honest metrics +
   synthetic disclosure, scoring list states, detail gating ("Not scored yet"
   for Pending with no Compute button), compute score via UI (Severe 94.62,
   84 % tree agreement, vote bars, per-indicator explanation with split
   deviations, history), forced re-run reproducing the identical result,
   filters/search; CSWD: flag dialog (submit disabled until note ≥ 5 chars →
   flag banner + state change), manual correction dialog (class select +
   mandatory reason → Manual badge, superseded history kept, reason shown);
   beneficiary: `/scoring` redirects to the dashboard. Throwaway record and
   score rows removed afterwards; demo record and session restored.

### Decisions applied (documented assumptions)

- **No real-data claim.** The training dataset is synthetic (rubric-v1) and every
  artifact, API response, DB row and UI element says so. If an authorized labelled
  LGU dataset is supplied later, retraining must flip `dataset.type` to
  `historical` and update the disclaimers — never present synthetic-trained
  metrics as real-world performance.
- **Four documented indicators only** — sensitive attributes and their obvious
  proxies are excluded by design (documented in `config.js` and the README), a
  guardrail, not a measured fairness claim.
- **Category ≠ score ≠ confidence.** The model's class is the primary output; the
  0–100 score is a documented vote-distribution conversion for sorting (not a
  probability of harm, not an official LGU scale); confidence is tree agreement
  (not a statistical CI). The UI explains all three next to every score.
- **Decision-support only.** Scoring never changes `application_status` or
  `validation_status`; the CSWD human review step remains the decision point; no
  relief is ever denied on model output alone.
- **Scores are evidence, not verdicts.** Only validated records (Under
  Verification / Approved) are scored; every run stores model version, date,
  indicator snapshot, probabilities and explanation; rescoring is an explicit,
  audited staff action attributed to the actor; nothing is ever deleted — new runs
  supersede, and full history stays.
- **Staleness is detected, not assumed** — the stored indicator snapshot is
  compared with the live record on every read, catching any mutation path.
- **A standing manual correction is protected** — the model only replaces it via
  an explicit forced re-run, never silently.
- **Model failure is honest** — a missing/corrupt artifact answers 503 with
  retraining guidance; scores are never fabricated, defaulted, or cached-stale.

## Batch 6 — Monitoring & Reporting + Aid Distribution Monitoring + Notifications

Scope confirmed by the user: every barangay-level metric, report and dashboard
concerns **Barangay Tambacan only** — no dashboards or reports exist for
Mahayahay, Poblacion or any other barangay; CSWD oversight reflects the
authorized records in this study.

### Delivered

1. **Migration 0006** (`20261014000006_batch6_monitoring_reporting.sql`, applied
   to the live project) — `reports` gains the 'Duplicate review' and 'Period
   summary' types (constraint rebuilt) plus created/type indexes;
   `aid_distributions` gains `recorded_by` (staff attribution),
   `status_reason` (cancellation reasons), the partial unique index
   `aid_open_plan_idx` on (beneficiary_id, assistance_type) WHERE status =
   'Planned' (database backstop against duplicate open plans from repeated
   submits) and a monitoring index; `notifications` gains `category`
   ('application' | 'validation' | 'scoring' | 'distribution' | 'staff' |
   'system', check-constrained) and `link_path` (in-app destinations only) plus
   unread/user indexes; `audit_logs` gains created/actor indexes.
2. **Aid Distribution Monitoring** (`distributionService.js` +
   `distribution.routes.js`, staff-only) — a LEDGER, not a payment system: no
   cash moves and no payment provider is integrated. `GET /api/distributions`
   (list with status/type/search filters, sort, pagination, beneficiary and
   staff joins), `GET /summary` (live counts by status/type + eligible-record
   count), `POST /` (record: beneficiary must be an Approved Tambacan record —
   eligibility enforced server-side; one open plan per assistance type → 409
   with the conflicting reference, backstopped by the partial unique index;
   barangay set server-side, never from the request), `POST /:id/status`
   (Planned → Released with attribution + timestamp, or Planned → Cancelled
   with a mandatory reason ≥ 5 chars; terminal states enforced; every transition
   audited and the record owner notified in-system under the 'distribution'
   category).
3. **Reporting, full module** (`reportService.js` + `reports.routes.js`) —
   prepared-report list/prepare unchanged (snapshot-at-prepare for the audit
   record) and extended with 'Duplicate review' and 'Period summary' types; new
   `GET /api/reports/preview` (row-level columns+rows for the on-screen
   printable layout, same staff-only authorization, Tambacan scope and date
   filtering) and `GET /api/reports/export?format=csv` (re-runs the SAME server
   builder under the caller's own permissions — an export can never carry more
   than the screen shows; audited as `report.export`; RFC-4180 CSV with UTF-8
   BOM and formula-injection protection — cells starting with `= + - @` are
   quote-prefixed). CORS now exposes `Content-Disposition` so the browser reads
   the download filename. PDF is produced by the browser's Print → Save as PDF
   against a print-only layout (no server PDF dependency — deliberate, the C:
   drive is full and a PDF library adds nothing a capstone needs).
4. **Notifications, full feature** (`notificationService.js` +
   `notifications.routes.js`) — categories + in-app `link_path` (sanitised to
   same-origin paths, never remote URLs), category/unread filters with offset
   pagination, `GET /counts` (own unread+total for the dashboard), read /
   read-all scoped to the caller — a foreign notification id answers 404 and is
   never read or altered. All existing call sites categorised (application
   submission/decision, validation & document requests, scoring staff alerts,
   distribution confirmations, staff coordination). In-app only: **no SMS or
   email integration is claimed or configured**.
5. **Dashboard** (`dashboard.routes.js` staff-summary + `Dashboard.jsx`) —
   recent system activity (real `audit_logs` rows, newest first) and the
   caller's own unread-notification counter added to the existing live queue /
   flags / distribution / reports figures; quick actions include Aid
   Distribution.
6. **Client** — new `Distribution.jsx` (summary cards, filters, pagination,
   record dialog with Approved-only beneficiary picker, release/cancel dialogs
   with mandatory cancel reason, empty/loading/error states); `Reports.jsx`
   extended (Live preview & export section: type+period → row-level table with
   Tambacan scope label + generated timestamp, Export CSV with download
   feedback, Print/Save-as-PDF via the print-only layout; per-row CSV from the
   stored parameters; dialog notes that exports regenerate live data under the
   viewer's permissions); `Notifications.jsx` (category + unread filters,
   pagination, category badges, in-app Open shortcut); `constants.js`
   (`DISTRIBUTION_STATUS_META`, `ASSISTANCE_TYPES`,
   `NOTIFICATION_CATEGORY_LABELS`, updated `REPORT_TYPES`); navigation + route
   for Aid Distribution (staff only); `index.css` print rules.
7. **Tests** — `server/tests/monitoring.test.js` (23 tests, live Supabase,
   cleaned up): dashboard counters equal direct DB counts (submitted buckets
   sum to the total; empty reads zero — nothing invented), activity feed rows
   must exist in `audit_logs`, beneficiaries never receive aggregates (403 /
   restricted payload); report type/date validation (inverted & malformed →
   400), all 7 types prepare with the Tambacan scope + snapshot, date ranges
   really narrow rows; CSV header equals preview columns and row counts match
   (unfiltered and filtered), formula-injection neutralised, beneficiary 403;
   distribution eligibility (non-Approved → 400), duplicate open plan → 409
   with the conflicting reference, different type allowed, Released attribution
   + timestamp + terminal-state 409 + beneficiary notification, cancel reason
   enforcement + audit, beneficiary 403 on every endpoint, summary equals DB;
   notification isolation (foreign id → 404, mark-all affects only the caller,
   category filter + unknown category → 400, DB rejects unknown categories,
   links are in-app paths); cross-feature role isolation and shared staff report
   list. Full suite after Batch 6: **116/116 passing**.
8. **Browser smoke (full workflow)** — staff: Aid Distribution page (summary
   cards showing real zeros + eligible count, filters), record dialog
   (Approved-only picker finds the demo record, duplicate submit refused with
   the AID- reference, release dialog with terminal warning → Released row with
   staff attribution and date, beneficiary notified with the 'distribution'
   category and an in-app link); Reports: Live preview renders the real row
   with scope label + timestamp, Export CSV downloads `reliefgov_aid-distribution_tambacan_*.csv`
   with an on-screen success notice, print layout present. Test residue from
   earlier batches (a `deact.*@reliefgov.test` profile) and orphaned audit rows
   from the test runs were removed; the demo record keeps a synthetic-labelled
   score and one released food-pack entry as honest demo state.

### Decisions applied (documented assumptions)

- **Distribution is a monitoring ledger, never a payment system.** The
  'Financial assistance' type records WHAT was assistance TYPE/quantity for the
  file — no pesos are transferred by the application and no payment/cash
  provider is integrated or implied.
- **Eligibility = Approved.** Only reviewed-and-approved Tambacan records can
  receive a distribution entry; the gate is server-side and the picker is a
  convenience, not the control.
- **One open plan per beneficiary per assistance type** — a repeated submit
  answers 409 with the conflicting reference (app-level check + partial unique
  index backstop for racing requests). Released/Cancelled entries never block a
  new plan.
- **Exports obey the on-screen rules.** CSV is regenerated from the same
  builder, under the caller's own role, scope and filters, and is audited —
  there is no separate export path that could leak more than the screen shows.
- **PDF via the browser, not a library.** Print-only layout + the browser's
  Save-as-PDF satisfies "printable layouts and PDF export where technically
  practical" with zero native dependencies (also required while C: has no free
  space for npm installs).
- **Notifications are in-app only** — no SMS/email integration is claimed; the
  DB check-constrains the category vocabulary and the service sanitises
  `link_path` to in-app paths so a crafted payload can never inject a remote
  link.
- **Every dashboard number is a live query** — zeros are shown when there is no
  data; no counter is seeded or estimated to make the dashboard look complete.

## Part 7 — Final verification and documentation

### Checks executed (14 October 2026)

| Check | Command / method | Result |
| --- | --- | --- |
| Automated tests | `npm test` in `server/` (serialized `node --test`, live Supabase) | **116 / 116 pass, 0 fail** (~4.8 min) — security & role escalation, Tambacan scoping, application workflow, validation & duplicates, RF scoring (incl. 503 model-failure paths, reproducibility, persistence, corrections), monitoring dashboards, reports & CSV export, distribution workflow, notification permissions, cross-role isolation |
| Lint / static check | `node --check` over all 46 server JS files (no ESLint/TS configured in this pure-JS project) | **0 syntax errors** |
| Type check | Not applicable — the project is plain JavaScript (no TypeScript) | n/a |
| Production build | `npm run build` (`vite build`, client) | **Success** — 67 modules, `dist/` emitted (index 0.53 kB, CSS 27.74 kB, JS 351.55 kB) |
| Application startup | API `/api/health` + web app serve/proxy | Healthy — Supabase PostgreSQL, Tambacan scope, CSWD central office reported |
| Database verification | new read-only script `server/scripts/verify-db.js` | **52 / 52 pass** — 12 tables present; migration 0003–0006 columns present; anon key (unauthenticated) gets **zero rows from every table** (RLS effectively enforced); every beneficiary/distribution/staff profile scoped to Tambacan; report types, notification categories/levels, score classes/status/dataset_type, distribution statuses and assistance types all within DB check-constraint vocabularies; at most one current score per beneficiary; no Planned distribution for a non-Approved beneficiary; no notifications to unknown users |

### Findings

1. **`status_history_guard()` silently cancelled DELETE operations** (real bug,
   pre-existing since Batch 3). The BEFORE-trigger returned `NEW` for every
   operation; for DELETE, `NEW` is NULL, so returning it cancels the delete —
   even for the service role and direct SQL, which the function's own comment
   promises to allow. Discovered when the orphan-cleanup deletes reported
   success but removed nothing.
2. **466 orphaned `application_status_history` rows** referenced beneficiaries
   deleted in earlier development cycles (before the foreign key existed).
   Invisible to the application — every read joins live beneficiaries — but
   inconsistent state for anyone inspecting the database.
3. The Supabase dashboard browser session expired (machine restart), so live
   SQL could not be applied during this pass.

### Fixes applied

- **Migration `20261014000007_batch7_status_history_guard_fix.sql`** created:
  the guard now returns `OLD` for DELETE on trusted paths (untrusted roles
  still get the exception — append-only protection unchanged) and removes the
  466 orphaned history rows. The FK probe (insert against a non-existent
  beneficiary → rejected) confirmed the foreign key is live and enforcing;
  beneficiary deletion with cascade still works. **The migration file is
  ready and must be run once in the Supabase SQL editor** (the dashboard
  session had expired; everything else was already applied and verified).
- **`server/scripts/verify-db.js`** added as a permanent, read-only database
  audit (the first draft's failures were wrong guessed column names, corrected
  against the real schema: `validation_results`, `verification_reviews`,
  `beneficiary_number`, `vulnerability_scores.status/score`, `reports.parameters`,
  `audit_logs.detail`, stored barangay value `'Tambacan'`).
- **Documentation updated**: root `README.md` rewritten to cover project
  overview & architecture, prerequisites, installation, the full environment
  variable reference, Supabase setup and the complete migration table
  (0001–0007), the secure initial CSWD administrator procedure, development
  and production commands, the role-permission matrix and application
  workflow, the RF honesty statement, final test results, and known
  limitations; `docs/ARCHITECTURE.md` data-tier diagram completed (all twelve
  tables, append-only/server-write-only notes) and the obsolete "HTTP 501
  until implemented" note replaced; `db/supabase/README.md` gained the 0007
  row, the Batch 6 test coverage paragraph, the 116/116 result and the
  `verify-db.js` audit.

### Acceptance-criteria mapping (evidence)

1. **App starts and builds** — `vite build` success; API health OK. ✅
2. **Six core modules connected and functional** — 116/116 tests + browser
   end-to-end verification per batch. ✅
3. **Supabase PostgreSQL stores records correctly** — verify-db 52/52,
   vocabularies and integrity invariants hold. ✅
4. **Role restrictions enforced server-side and in the database** — anon-key
   probe returns zero rows on every table; role-escalation tests pass. ✅
5. **Barangay operations restricted to Tambacan** — API scope + RLS + DB
   check constraints; all live rows Tambacan. ✅
6. **Records and documents protected** — private Storage bucket, signed-URL
   downloads with ownership checks, RLS on every table. ✅
7. **RF integration communicates model vs demo status honestly** —
   `dataset_type='synthetic'` stored, labelled in API + UI, 503 on model
   failure instead of fabricated scores. ✅
8. **Dashboards/reports/notifications use authorized records** — every number
   is a live query under the caller's role and scope; exports regenerate with
   the same rules and are audited. ✅
9. **Critical workflows have documented test results** — this section +
   `db/supabase/README.md` testing section. ✅
10. **ISO 9126 / TAM objectives** — functional completeness (six modules,
    workflow coverage), reliability (explicit failure paths, no fabricated
    data), security (server-side + DB enforcement, audit trail), usability
    (empty/loading/error states, responsive layouts) map to ISO 9126
    sub-characteristics; the capstone's planned Technology Acceptance Model
    survey with actual end users has **not** been conducted in this study and
    is listed as future work — no TAM results are claimed.

## Part 8 — Machine learning moved to Python (user-directed change)

At the user's explicit request ("if you don't use Python in that line —
PLEASE USE IT"), the Random Forest implementation was moved from pure
JavaScript to **Python (scikit-learn)** while preserving every tested
behaviour, the honesty labelling, and the API contract.

### Delivered

- **`ml-service/` Python microservice** (`app.py`, stdlib HTTP server):
  trains a `sklearn.ensemble.RandomForestClassifier` (25 trees, max depth 8,
  `sqrt` features, seed 42) at startup on the same documented rubric-v1
  synthetic dataset (400 rows, 4 % label noise, stratified 80/20 split);
  exposes `GET /health` (honest metadata: provenance, hyperparameters,
  measured hold-out metrics) and `POST /score` (validation → prediction →
  probabilities → priority index → explanation). Measured hold-out agreement
  with the rubric: **85.19 %** (per-class F1: Low 0.89, Moderate 0.84,
  High 0.85, Severe 0.86) — synthetic-rubric agreement only, labelled as
  such everywhere. A `self.clf`-style syntax slip caught by
  `py_compile`/first run was fixed before delivery.
- **Project Python environment**: `ml-service/.venv` (created by
  `ml-service/setup.bat`, `requirements.txt`: scikit-learn, NumPy); C: drive
  now has ~28 GB free, so installation succeeded.
- **Node side of the contract**: `server/src/ml/pythonClient.js` (HTTP client,
  reshapes responses to the exact shapes `scoringService` expects, maps the
  service's 400/503 to `badRequest`/`unavailable`) and
  `server/src/ml/backend.js` (`ML_BACKEND`: `python` default, `auto` =
  Python with logged JS fallback, `javascript` = reference only).
- **`scoringService` / `scoring.routes`** now resolve the model through the
  backend selector (async `getModelStatus`, `scoreRecordAsync`); all storage,
  workflow gates, staleness, flag/correction and audit logic unchanged.
- **Wiring**: root `package.json` gains `npm run ml` / `npm run ml:setup`;
  `npm run dev` now starts ML (`:8100`) + API + web; `server/.env(.example)`
  documents `ML_BACKEND`, `ML_SERVICE_URL`, `ML_SERVICE_TIMEOUT_MS`.
- **Tests**: new `server/tests/python-ml.test.js` (5 tests, starts its own
  service instance on `:8177` from the project venv) — service trains and
  reports honest status; `/api/scoring/model` reflects the Python backend;
  the API stores a Python-produced score (probabilities sum ≈ 1, priority
  index 0–100, explanation persisted, `dataset_type='synthetic'`); invalid
  indicators → 400 with details and **no fabricated row**; service outage →
  **503 with the existing score untouched**. `scoring.test.js` pins
  `ML_BACKEND=javascript` so the Batch 5 suite stays offline-deterministic
  (it exercises the JS reference directly). Suite: **121 tests** at that point in time (123 after
   the document-upload batch below).
- **Verified live**: API `/api/scoring/model` reports "Python scikit-learn
  Random ForestClassifier"; scoring the demo record (Juan D Dela Cruz:
  6 persons, Low income, Major damage, Owned) through the API returned
  **High, priority 60.94, confidence 0.837**, synthetic-labelled, with the
  four-factor explanation — consistent with the JS model's behaviour on the
  same indicators.

### Decisions applied

- **Python is the model of record; the JS forest stays as a documented
  reference/fallback.** The Batch 5 suite still validates it, and `auto`
  mode keeps scoring available during a Python outage — always logged, never
  silent, and never applied to validation errors (400s always propagate).
- **Training happens in Python at service start** (deterministic seed), so no
  separate Python training step is required; the JS artifact
  (`npm run train:model`) remains only for the JS fallback path.
- **Same honesty contract**: identical dataset provenance labels, the same
  400-on-missing-indicator and 503-on-unavailable guarantees, and the same
  "never fabricate a score" rule — verified by the new integration tests
  against the live service, not assumed.

## Part 9 — Beneficiary document uploads (guided) + damage-photo scoring evidence

Date: 15 October 2026. Two connected problems were addressed together: the
beneficiary document-upload flow (uploads appeared not to register and Submit
bounced back to Documents), and wiring house-damage photo evidence into the
Random Forest as a documented feature (rubric-v2 / `rf-1.1.0`).

### Findings (inspection)

- **Server upload path is correct.** A valid JPEG/PNG/PDF posted to
  `POST /api/documents` returns **201** and the row is stored; the proxy and
  direct-API paths agree. The failure was **client-side**, not server-side.
- **Root cause 1 — `File.type`-only validation.** The client trusted the
  browser-supplied `File.type` as the sole type check. Several legitimate
  files carry an empty or non-standard MIME (`photo.jfif` → `image/jfif` or
  `""`; some scanned PDFs → `""`), so they were rejected before any request
  was sent. The document count stayed at (0), and since Submit is gated on a
  Barangay certificate, Submit bounced back to Documents with no useful reason.
- **Root cause 2 — invisible feedback.** Upload errors were rendered only as a
  small field hint or a dismissible top banner, so a rejection looked like
  "nothing happened" — the perceived "upload doesn't register".
- **Root cause 3 — unknown purpose crashed.** An unrecognized `purpose` value
  reached storage and violated a DB constraint, returning a raw **500**.
- **No schema migration is needed.** The six existing purposes already cover
  the guided slots; they simply were not surfaced as a checklist.

### Delivered

- **Client upload validation rewritten** (`client/src/lib/documents.js`):
  file type is now determined by **magic-byte sniffing** (`sniffFileMime`
  reads the leading bytes and maps JPEG/PNG/PDF signatures), not `File.type`;
  the canonical MIME is rebuilt into the data URL before the XHR upload so the
  server always receives a MIME it accepts. `.jfif`/empty-MIME images now
  upload correctly. Size (>5 MB) and unsupported-type (e.g. HEIC) failures
  produce explicit messages.
- **Guided document checklist** (`DOCUMENT_CHECKLIST` in
  `client/src/lib/constants.js`, rendered in `ApplicationForm.jsx`): a 3-item
  checklist — Barangay certificate (**required**), "Photo of the damaged
  house" (**recommended** → becomes the scoring evidence feature), and
  "Certificate or valid ID (national ID / PSA)" (**recommended** → identity
  validation only, never scored). Each item shows its state and an
  "Upload this" / "Upload another" action.
- **In-box feedback.** Success/warning/error alerts render **inside** the
  upload box, and each upload is verified post-hoc via a `refresh()` so the
  checklist reflects the stored documents, not an optimistic guess.
- **Submit gate.** Submit stays disabled until the Barangay certificate is
  attached (client guard in `submitApplication`; the server-side certificate
  check remains authoritative). A hint explains why Submit is disabled.
- **Server: unknown purpose is now a clean 400** (`documentService.js`)
  validated **before** storage, so a bad purpose never reaches the DB
  constraint and never returns a raw 500. A constraint-violation defence is
  kept as a backstop.
- **Scoring evidence feature (`damage_photo`)** — the ML contract grows from
  7 to **8 columns**: `[size, income, damage, informal, shared, rented, other,
  damage_photo]`. `damage_photo` = 1 when the record has ≥ 1 non-rejected
  "Damage photos" document, supplied by the **server** at scoring time (the
  model still never queries the DB). It enters the indicator snapshot (so
  attaching/deleting a photo marks a score **stale**) and is **optional** —
  absent evidence is a legitimate 0, never a 400.
- **rubric-v2 / `rf-1.1.0`** — the synthetic labelling rubric adds **+1 point
  only when a damage photo corroborates damage that is actually claimed**
  (photo AND `damage_extent != None`); a photo can never create damage. Bands
  unchanged (Low 0–3, Moderate 4–7, High 8–11, Severe 12–15). Dataset grown
  **400 → 1200** rows (seed 42, 4 % noise). Model version bumped to
  `rf-1.1.0`; **model-version staleness** added — a score produced by an older
  model version is marked stale and may be re-run without `force` (manually
  corrected scores are exempt).
- **UI** (`Scoring.jsx`): a fifth "Damage photo on file" Yes/No indicator and
  updated five-feature model-card text.

### Measured, honest metrics (re-measured, both backends)

- **Python (model of record, `ml-service/app.py`) — 87.92 %** hold-out
  agreement with rubric-v2 on **240** held-out rows (was 85.19 % at 400
  rows/rubric-v1). Per-class F1: Low 0.73, Moderate 0.87, High 0.91,
  Severe 0.86.
- **JavaScript reference (`artifacts/model.json`) — 91.21 %** on **239**
  held-out rows. Per-class F1: Low 0.77, Moderate 0.91, High 0.93,
  Severe 0.91.
- Both remain **synthetic-rubric agreement only** — not real-world accuracy or
  fairness. The two backends differ slightly because scikit-learn's forest and
  the dependency-free JS reference do not make identical bootstrap/split
  choices; the Python service is the model of record.

### Decisions applied

- **Fairness: identity documents are excluded from scoring.** The presence of
  a barangay certificate / valid ID / national ID is **not** a score input —
  it measures documentation, not vulnerability, and scoring by document
  possession would penalize applicants who cannot obtain an ID. Identity
  documents are used by Data Validation only. The new checklist item collects
  a user-provided ID copy as a **document** with no national-ID/PhilSys/
  biometric/external-governance-DB integration, and its presence never changes
  a score. Documented in the model card and `features.js` exclusions.
- **Evidence, not requirement.** The damage photo is recommended, never
  required; scoring works identically with or without it (0 is a valid value).
- **Client checks are UX, not control.** Magic-byte sniffing, the checklist
  and the Submit gate are conveniences; the server's purpose validation,
  size/type limits and certificate check remain the authoritative gate.

### Verification

- **Test suite: 123 / 123 passing** (was 121; +1 unknown-purpose-400 test in
  `applications.test.js`, +1 damage-photo-evidence staleness test at the end of
  `scoring.test.js`). Serialized run.
- New/updated assertions: 8-column vector and `vec[7]` evidence value;
  `features.names` includes `damage_photo` and asserts identity-document
  exclusion; both `indicators` snapshots include `damage_photo`; `rf-1.1.0`
  pins in `scoring.test.js` and `python-ml.test.js`; `/health` exposes
  `features`, `excluded`, `target` and `labelSource`.
- **Client build (`vite build`)**: success, 68 modules, `dist/` emitted.
- **DB verification (`verify-db.js`)**: 52 / 52 passing.
- Failure-mode matrix checked live: valid JPEG end-to-end; `.jfif`/empty-MIME
  accepted via sniff; >5 MB loud in-box error; HEIC clear error; unknown
  purpose 400 (was 500); Submit disabled without certificate, enabled with it.
- Live services confirmed after restart: API `:4000` healthy (Supabase),
  Python ML `:8100` on `rf-1.1.0`/rubric-v2/1200, Vite `:5173` serving.

### Known limitations (carried forward)

- ML is **synthetic-trained decision-support**; agreement is with the rubric
  only. No authorized LGU dataset was available.
- Single barangay (Tambacan) scope; in-app notifications only (no SMS/email
  claims); Save-as-PDF for documents; distribution is **not** payments; local
  development only (no TAM household survey behind the synthetic generator).
