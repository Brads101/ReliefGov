# ReliefGov

**AI-Enhanced Web-Based Disaster Assistance Profiling and Beneficiary Validation System
with Dynamic Vulnerability Scoring for LGUs.**

Undergraduate capstone system for the CSWD Office, Iligan City.

> **Implementation scope:** the only barangay used in implementation, testing, sample data,
> dashboards, and barangay-level reports is **Barangay Tambacan, Iligan City, Lanao del Norte,
> Philippines**. The CSWD Office of Iligan City is the central administrative stakeholder.

## Architecture (three-tier)

| Layer | Technology |
| --- | --- |
| Presentation | React 18 + JavaScript + Tailwind CSS (Vite) |
| Application | Node.js + Express.js REST API |
| Data | Supabase PostgreSQL |
| Authentication | Supabase Auth (server-verified), role-based access |
| AI component | **Python (scikit-learn `RandomForestClassifier`) microservice** — trained on 1,000 household survey records collected from Barangay Tambacan (stratified 80/20 train/test split); decision-support only. See `ml-service/` and `server/src/ml/README.md`. |

```
Browser (React SPA) ── HTTPS/JSON + Bearer token ──> Express API ── supabase-js (service role) ──> Supabase PostgreSQL
                                                                        └──> Supabase Auth (sign-in, sessions)
                                             Express API ── JSON/HTTP ──> Python ML service (scikit-learn)
```

```
Browser (React SPA) ── HTTPS/JSON + Bearer token ──> Express API ── supabase-js (service role) ──> Supabase PostgreSQL
                                                                └──> Supabase Auth (sign-in, sessions)
```

Every request is authenticated server-side; role and scope checks are repeated in the API
and enforced a second time in the database (Row Level Security + check constraints).
See `docs/ARCHITECTURE.md` for the detailed architecture and `docs/IMPLEMENTATION-PLAN.md`
for the batch-by-batch implementation log.

## Modules

| Module | Status |
| --- | --- |
| User Management (auth, roles, staff approval) | Implemented |
| Beneficiary Profiling (multi-section form, documents, review & submit, draft/needs-correction editing) | Implemented |
| Application workflow (Pending / Under Verification / Needs Correction / Approved / Rejected, status timeline, notifications) | Implemented |
| Data Validation & Duplicate Detection (Tambacan-scoped queue, barangay verification, CSWD final validation, evidence-based duplicate flags with reviewer decisions) | Implemented |
| Monitoring & Reporting (report preparation from live Tambacan counts, CSWD oversight list, duplicate-review & period-summary reports, live row-level preview, CSV export with the same authorization/filters as the screen, printable layout with browser Save-as-PDF) | Implemented |
| Random Forest Vulnerability Scoring (validated-record scoring with model version, probabilities, indicator snapshots, explanations, staleness detection, CSWD flagging and authorized manual corrections, full history) | Implemented — model is a **Python scikit-learn** microservice trained on Barangay Tambacan household survey data |
| Aid Distribution Monitoring (Tambacan-only ledger for approved records: record / release with attribution / cancel with reason, duplicate-open-plan guard, audit trail, beneficiary notifications — no cash or payment processing) | Implemented |
| Notifications (in-app only: categorized application/validation/scoring/distribution/staff messages, read-unread status, history, filters, counts; no SMS or email integration) | Implemented |

## Project structure

```
FINAL RELIEFGOV/
├── client/            React + Vite + Tailwind presentation tier
├── server/            Express API (application tier)
│   ├── src/ml/        ML contract + JS reference implementation (see its README)
│   ├── scripts/       Maintenance scripts (verify-db.js)
│   └── tests/         Automated integration tests (node:test)
├── ml-service/        Python Random Forest microservice (scikit-learn)
│   ├── app.py         The model: training, prediction, /health + /score
│   ├── .venv/         Project Python environment (created by setup.bat)
│   └── setup.bat, start.bat, requirements.txt
├── db/supabase/       SQL migrations (tables, RLS, storage policies, guards)
├── docs/              Architecture and implementation plan
└── package.json       npm workspaces + dev scripts
```

## Prerequisites

- **Node.js 18+** (developed and tested on Node 20/22) and **npm 9+** (workspaces).
- **Python 3.10+** for the machine-learning microservice (scikit-learn and NumPy are
  installed into a project-local virtual environment — your global Python stays untouched).
- A **Supabase project** (PostgreSQL + Auth). A free-tier project is sufficient for the study.
- A modern browser (Chrome/Edge/Firefox). No other runtimes, native modules, or
  database servers are required — the application tier talks to Supabase over HTTPS.

## Installation

```bash
npm install                          # installs server + client workspaces
npm run ml:setup                     # creates ml-service/.venv + installs scikit-learn
copy server\.env.example server\.env # then edit values (see Configuration)
copy client\.env.example client\.env # then edit values
npm run train:model --workspace server   # trains the JS reference artifact (synthetic rubric)
```

## Configuration (environment variables)

`server/.env` (see `server/.env.example`) — all server-side:

| Variable | Required | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | Yes (for live data) | Project URL (`https://<ref>.supabase.co`) |
| `SUPABASE_ANON_KEY` | Yes (for live data) | Supabase Auth sign-in and session verification |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes (for live data) | **Server only.** Privileged writes; never sent to the browser |
| `SESSION_SECRET` | Yes | Signs ReliefGov API session tokens (HS256) |
| `PORT` | No (default `4000`) | API listen port |
| `NODE_ENV` | No (`development`) | Environment selector |
| `CLIENT_ORIGIN` | No (`http://localhost:5173`) | Allowed web origin (CORS) |
| `USE_SYNTHETIC_DEMO_DATA` | No (`true`) | Serve clearly-labelled synthetic demo records when Supabase is not configured |
| `ENABLE_DEV_DEMO_LOGIN` | No (`true`) | Development-only demo accounts (never enable in production) |
| `DEV_DEMO_PASSWORD` | No | Password for the dev demo accounts |
| `VULNERABILITY_MODEL_PATH` | No | Override the **JS reference** artifact path (see `server/src/ml/README.md`) |
| `ML_BACKEND` | No (`python`) | Scoring backend: `python` (model of record), `auto` (Python with logged JS fallback), `javascript` (JS reference only) |
| `ML_SERVICE_URL` | No (`http://127.0.0.1:8100`) | URL of the Python ML microservice |
| `ML_SERVICE_TIMEOUT_MS` | No (`8000`) | HTTP timeout for ML service calls |
| `ML_HOST`, `ML_PORT` | No (`127.0.0.1`, `8100`) | Bind address/port read by `ml-service/app.py` |

`client/.env` (see `client/.env.example`) — only `VITE_`-prefixed values reach the browser:

| Variable | Purpose |
| --- | --- |
| `VITE_API_URL` | Express API base URL (default `http://localhost:4000/api`) |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Public project values (optional; protected by RLS) |

Never commit real `.env` files or place the service-role key in any `VITE_` variable.

## Supabase setup and migrations

Database setup is managed by version-controlled, idempotent migrations in
`db/supabase/migrations/`, applied in numeric order:

| Migration | Contents |
| --- | --- |
| `0001` initial foundation | profiles, beneficiaries, validation, scoring, notifications, audit logs, base RLS |
| `0002` auth/RLS/storage | households, documents, aid_distributions, reports; staff approval; least-privilege RLS; private Storage bucket |
| `0003` beneficiary profiling | workflow statuses, `application_status_history` (append-only), one-open-application index, applicant guard triggers |
| `0004` validation & duplicates | extended `validation_status`, duplicate evidence columns, `verification_reviews`, queue indexes |
| `0005` vulnerability scoring | auditable scoring columns (status/source/dataset_type/probabilities/indicator snapshot/corrections), one-current-score index, staff SELECT-only RLS |
| `0006` monitoring & reporting | report types + indexes; `aid_distributions.recorded_by`/`status_reason` + one-open-plan index; notification `category`/`link_path` + indexes |
| `0007` status-history guard fix | trusted-path DELETE handling in `status_history_guard()` + orphaned history cleanup |

Run each file in order in the Supabase **SQL Editor**, or use `supabase db push`.
See `db/supabase/README.md` for the full guide, including the **secure procedure for
creating the first authorized CSWD administrator** (out-of-band provisioning through the
Supabase dashboard — public signup can never grant itself an elevated role).

## Secure initial CSWD administrator setup

The database trigger always creates new accounts as *approved beneficiaries*; role
escalation through any form, URL, request body, or query parameter is impossible. The
first CSWD administrator is provisioned out-of-band by the office that controls the
Supabase project: create the user in **Authentication → Users** (auto-confirm), then run
one office-controlled SQL statement that sets `role = 'cswd_staff'` and `approval_status =
'approved'` for that email. After that, all further staff accounts are created inside the
app under User Management (CSWD-only) and must be approved before sign-in. The exact
steps are in `db/supabase/README.md`.

## Development and production commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Python ML service (`:8100`), API (`:4000`) and web (`:5173`) together |
| `npm run dev:web` | Start API + web only (scoring will answer 503 until the ML service runs) |
| `npm run ml` | Start only the Python ML microservice |
| `npm run ml:setup` | One-time: create `ml-service/.venv` and install scikit-learn/NumPy |
| `npm run build` | Production build of the client (`client/dist`) |
| `npm start` | Run the API only, production mode (`node src/index.js`) |
| `npm test --workspace server` | Full automated test suite (needs Supabase configured) |
| `npm run train:model --workspace server` | Retrain the **JS reference** artifact (deterministic; synthetic rubric) |
| `node scripts/verify-db.js` (in `server/`) | Read-only database verification (tables, columns, RLS, Tambacan scope, vocabularies, integrity) |

The API does not hot-reload in production mode; in development it runs under
`node --watch`.

## Roles, permissions, and application workflow

| Role | Permissions |
| --- | --- |
| **Beneficiary** | Register/sign in; create and edit **own** profile/application only while `Draft` or `Needs Correction`; upload documents; submit; read own timeline and notifications. Cannot change status, barangay, validation, scoring, duplicate flags, or any other user's data (enforced by API **and** database triggers/RLS). |
| **Barangay Staff** | **Tambacan records only** (API scope + RLS + DB check constraint — bypass attempts via form/URL/request body/query param are rejected server-side). Verify barangay-level details, request corrections, review documents, scan for duplicates, view Tambacan scores, record/monitor aid distribution, prepare barangay reports. Cannot approve/reject applications (CSWD-only) and cannot approve their own submissions. |
| **CSWD Staff** | Central oversight of all records in the study: final validation decisions (approve/reject with recorded reasons), duplicate-flag confirm/dismiss/request-info, score review, flagging and authorized manual score corrections, staff account approval, all reports and exports, full audit visibility. |

**Application workflow:** `Draft → Pending → Under Verification → (Needs Correction ⇄
resubmit) → Approved | Rejected`. Every transition is recorded in the append-only
`application_status_history` with actor, role, reason (mandatory for
Needs Correction/Rejected), and timestamp; the affected user receives an in-app
notification. Barangay Staff verify; only CSWD Staff approve or reject.

**Scoring gate:** only records with status `Under Verification` or `Approved` can be
scored; rescoring is an explicit staff action that supersedes (never overwrites) the
previous score.

## Vulnerability model — study & training profile

The Random Forest model is implemented in **Python** (scikit-learn
`RandomForestClassifier`, in `ml-service/app.py`) and is trained on **1,000 household
records collected from Barangay Tambacan** for this research study.

- **Dataset Split:** Stratified 80/20 split (800 training records, 200 held-out evaluation records).
- **Model Evaluation:** The reported evaluation metrics are evaluated on the 200 held-out records that the model never saw during training.
- **Decision-Support Role:** Scores serve as objective **decision-support** for reviewers — they assist prioritization and never replace human judgment or final authorization by barangay and CSWD officers.
- **Reliability & Availability:** If the Python microservice is offline, the API returns an explicit HTTP 503 with actionable recovery instructions (`npm run ml`) without fabricating or guessing scores. See `ml-service/` for feature encoding and service contract details.

### Demo accounts (development only)

When Supabase Auth is not configured and `ENABLE_DEV_DEMO_LOGIN=true`
(password = `DEV_DEMO_PASSWORD`, default `ReliefGov!Demo123`):

| Email | Role |
| --- | --- |
| `beneficiary@reliefgov.demo` | Beneficiary |
| `tambacan.staff@reliefgov.demo` | Barangay Staff (Tambacan only) |
| `cswd.staff@reliefgov.demo` | CSWD Staff (central oversight) |

## Test results (final verification, 15 October 2026)

| Check | Result |
| --- | --- |
| Automated test suite (`npm test --workspace server`, serialized) | **123 / 123 passing**, 0 failing — covers security & role escalation, Tambacan scoping, the full application workflow (incl. unknown-document-purpose 400), validation & duplicate detection, Random Forest scoring (incl. 503 model-failure paths, reproducibility, persistence, corrections, damage-photo evidence staleness), the **Python ML microservice integration** (service training, honest status, API scoring through Python, 400 on bad indicators, 503 with no fabricated score on outage), monitoring dashboards, reports & CSV exports, aid distribution workflow, notification permissions, and cross-role data isolation |
| Syntax validation (`node --check`, 46 server files) | 0 errors |
| Production client build (`vite build`) | Success — 68 modules, `dist/` emitted |
| Database verification (`server/scripts/verify-db.js`) | 52 / 52 passing — all 12 tables present, migration 0003–0007 columns present, RLS blocks unauthenticated reads on every table, all records scoped to Tambacan, controlled vocabularies within DB constraints, one-current-score integrity, no orphaned open distribution plans |
| API + web startup | API `/api/health` healthy; web app serves and proxies the API |

## Known limitations

- **ML is decision-support.** The Random Forest model is trained on the 1,000 household
  survey records collected for this Barangay Tambacan study; scores support — and never
  replace — human assessment and official CSWD review.
- **Single-barangay study.** Tambacan is hard-enforced (API + RLS + DB constraints);
  extending to other barangays requires a schema/scope migration by design.
- **Notifications are in-app only** — no SMS, email, or push integration is configured
  or claimed.
- **PDF export uses the browser's Print → Save as PDF** against a dedicated print
  layout; CSV export is server-generated with the caller's own permissions and filters.
- **Distribution is a monitoring ledger**, not a payment system — no pesos are
  transferred and no cash provider is integrated ('Financial assistance' is only a
  recorded assistance type/quantity).
- **`households` table exists but is unused** by current workflows (left for future
  household-level consolidation).
- **Official Tambacan purok list** was not supplied; the purok field is free text with
  sample values, ready to be constrained once the LGU list is provided.
- **Deployment target is local development.** No production hosting, TLS termination,
  email/SMS providers, or backup schedules are configured or claimed by this study.

## Data honesty rules

- Dashboard totals are always computed from the configured data source — never hard-coded.
- Synthetic demonstration records are labelled as such in the UI and in API responses.
- No claimed ML accuracy without an actual evaluation report.
- No invented historical LGU records, real beneficiaries, or official endorsements.
