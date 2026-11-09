# ReliefGov — System Architecture

## Three-tier overview

```
┌──────────────────────────────────────────────────────────────────┐
│ PRESENTATION TIER — client/ (React 18, JavaScript, Tailwind)     │
│  Pages · reusable UI kit · responsive nav · role-guarded routes  │
└───────────────────────────┬──────────────────────────────────────┘
                            │ HTTPS/JSON  (Bearer session token)
┌───────────────────────────▼──────────────────────────────────────┐
│ APPLICATION TIER — server/ (Node.js + Express)                   │
│  routes/ → middleware (auth, roles, errors) → services → data    │
│  auth service (Supabase Auth or dev-demo sessions)               │
│  scoring service → JSON/HTTP contract → Python ML service        │
└───────────┬───────────────────────────────┬──────────────────────┘
            │ supabase-js                   │ HTTP (ML_BACKEND=python)
            │ (service-role key, server only)│
┌───────────▼───────────────┐  ┌────────────▼───────────────────────┐
│ DATA TIER — Supabase      │  │ ML TIER — Python microservice      │
│ PostgreSQL                │  │ ml-service/app.py (scikit-learn)   │
│  profiles · beneficiaries │  │  RandomForestClassifier trained on │
│  application_status_      │  │  the synthetic development dataset │
│  history · validation_    │  │  GET /health · POST /score         │
│  results · verification_  │  │  (JS reference forest in           │
│  reviews · documents ·    │  │   server/src/ml as documented      │
│  households · vulnerability│  │   fallback via ML_BACKEND=auto)   │
│  scores · aid_            │  └────────────────────────────────────┘
│  distributions · reports ·│
│  notifications · audit_   │
│  logs                     │
│  RLS + Tambacan-only      │
│  check constraints +      │
│  append-only guards       │
└───────────────────────────┘
```

All twelve tables carry Row Level Security; several are additionally
*append-only by trigger* (status history, verification reviews) or
*server-write-only* (notifications, vulnerability scores, duplicate-flag
decisions, audit logs) so that client-side writes are rejected by the
database itself, not only by API middleware. Barangay, city, and province
columns carry `check` constraints fixing the value to Tambacan / Iligan City /
Lanao del Norte.

## Data-source modes

| Mode | Trigger | Behaviour |
| --- | --- | --- |
| `supabase` | `SUPABASE_URL` + keys set | Live PostgreSQL reads/writes |
| `synthetic` | `USE_SYNTHETIC_DEMO_DATA=true` | In-memory synthetic demo records, labelled in every response and banner |
| `none` | nothing configured | HTTP 503 with an actionable configuration message |

Dashboard totals are always computed from the active source — never hard-coded.

## Roles and access

| Role | Access |
| --- | --- |
| `beneficiary` | Own account, own profile, notifications |
| `barangay_staff` | Barangay **Tambacan** records only (enforced in API + RLS) |
| `cswd_staff` | Central oversight of all ReliefGov records in this study |

## Security notes

- `SUPABASE_SERVICE_ROLE_KEY` exists only in `server/.env`; it is never bundled into the client.
- Session tokens are HMAC-signed by the API (HS256) or are Supabase access tokens verified by Supabase.
- All API errors pass through a single error handler with a stable
  `{ error: { status, message, details } }` payload. Unimplemented module
  routes were previously stubbed with explicit HTTP 501 so nothing pretended
  to work; all six core modules are now implemented, and routes that cannot
  honour a request answer with an explicit, actionable error (for example the
  scoring endpoints return HTTP 503 when the model artifact cannot load) —
  the system never fabricates data it does not have.

## Visual identity

Restrained civic palette: deep navy (`navy-950`) for structure, government blue (`gov-700`)
for primary actions, muted teal (`teal-600`) for data accents, and emergency orange/red
(`alert`, `danger`) reserved for warnings and errors. System font stack, subtle borders,
restrained shadows, no exaggerated gradients or glassmorphism.
