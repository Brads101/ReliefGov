# Random Forest Vulnerability Scoring — ML Module

## Architecture: Python is the model of record

The Random Forest is implemented in **Python (scikit-learn)** and runs in its own
process, the **`ml-service/` microservice**. The Express API never computes a score
itself; it forwards each record to that service over a small JSON/HTTP contract and
stores the returned result. This keeps the machine-learning component in a standard,
auditable Python stack while the web tier, database logic and UI stay in Node.

There is **one model**. The Colab-trained pipeline is shipped as a joblib artifact and
loaded at service start; there is no JavaScript forest, no in-process training step and
no fallback backend any more. If the service cannot produce a score, the API answers
**HTTP 503** with an actionable message and **no score is ever fabricated**. A record
missing an indicator answers **HTTP 400** with per-indicator details. Both behaviours
are covered by tests.

| Piece | Role |
| --- | --- |
| `ml-service/app.py` | **The model.** Loads the artifact, maps system indicators onto the dataset's categories, exposes `GET /health` and `POST /score`, and owns all prediction, probability and explanation logic. |
| `ml-service/artifacts/priority_model.joblib` | The trained Colab pipeline (OneHotEncoder → RandomForestClassifier). |
| `ml-service/artifacts/priority_metrics.json` | The measured metrics reported by `/health` (see **Evaluation**). |
| `ml-service/requirements.txt`, `setup.bat`, `start.bat` | Python environment (venv at `ml-service/.venv`) and one-command setup/start. |
| `pythonClient.js` | Node client for that contract. Reshapes the service's responses into exactly the shapes the rest of the API expects. |
| `backend.js` | Thin facade the application tier calls (`scoreRecordAsync` / `modelStatusAsync`). Python is the only backend. |

Run the service with `npm run ml` (or `ml-service\start.bat`); set it up once with
`npm run ml:setup`. Configure with `ML_SERVICE_URL` and `ML_SERVICE_TIMEOUT_MS` in
`server/.env`. Integration coverage lives in `server/tests/python-ml.test.js`, and the
scoring flow in `server/tests/scoring.test.js` (each suite starts its own instance of
the service on its own port).

## ⚠️ Honesty statement (read first)

- **Training provenance:** the model was fitted offline (Google Colab) on
  `HOUSEHOLD_CLASSIFICATION_RESULTS.xlsx`, a **1,000-row household dataset collected
  for this study** (Barangay Tambacan). Every score produced by this module is labelled
  `dataset_type = historical` and the UI shows that label on every scored record and in
  the model banner.
- **What the reported metrics are:** the notebook split the dataset 80/20
  (stratified, `random_state=42`), fitted on **800 rows** and held **200 rows out**.
  Accuracy, per-class scores and the confusion matrix in `priority_metrics.json` are
  measured on those **held-out rows the model never saw while fitting** — an internal
  hold-out, **not** an external validation, and **not** evidence of accuracy or fairness
  on households outside Barangay Tambacan. Agreement over all 1,000 rows is kept
  separately as `fullDataAgreement` and labelled as training-set agreement. The service
  states this in `/health` and the UI repeats it.
- **What the model is:** decision-support output. It never approves, rejects or denies
  assistance, and it never changes any application or validation status. A human
  reviewer always makes the assistance decision.
- **If the model is retrained**, bump `MODEL_VERSION` in `config.js` and in
  `ml-service/app.py`, regenerate `priority_metrics.json`, and keep the wording of the
  disclaimer matched to what the new artifact actually is. Never present training-set
  agreement (or an internal hold-out on one barangay's records) as real-world
  performance.

## Files

| File | Responsibility |
| --- | --- |
| `config.js` | Documented constants: model version (`rf-1.2.0`), classes, hyperparameters, dataset provenance, priority-score conversion formula, scorable statuses, honesty notes. |
| `features.js` | Indicator validation (`missingIndicators`), the legacy 8-column encoder, indicator snapshots and staleness comparison. |
| `pythonClient.js` | JSON/HTTP client for the Python service, including honest failure mapping (400 → `badRequest`, anything else → `unavailable`). |
| `backend.js` | The seam the application tier uses: `scoreRecordAsync`, `modelStatusAsync`, `activeBackendLabel`. |
| `../ml-service/app.py` | The model itself (loading, mapping, prediction, explanation, HTTP contract). |

Deleted with the model swap: `randomForest.js`, `train.js`, `model.js`,
`syntheticDataset.js`, `artifacts/model.json` and the `train:model` npm script. The
synthetic development dataset and its rubric are gone from the serving path.

## Features (inputs)

The model consumes **three** recorded indicators. System wording is mapped onto the
dataset's exact category wording inside `ml-service/app.py` before inference, and every
mapped value is verified against the encoder's fitted categories at load time:

| System indicator | System values | Dataset categories |
| --- | --- | --- |
| `damage_extent` | None / Minor / Major / Total | `FLOODED` / `PARTIALLY` / `HEAVILY FLOODED` / `TOTALLY` |
| `income_level` | No income / Low / Moderate / High | `INCOME CATEGORY A (₱5,000–₱10,000)` / `B (₱10,001–₱20,000)` / `C (₱20,001–₱50,000)` |
| `house_status` | Owned / Rented / Shared / Informal settler / Other | `OWNER` / `RENTER` / `SHARER` |

Two documented mapping decisions exist because the system's vocabulary is wider than
the dataset's: **`No income` maps to Category A** (the dataset has no zero-income
band), and **`Informal settler` maps to `RENTER`, `Other` to `SHARER`** (the dataset has
no informal-settler/other band). They are documented in `app.py` and listed here so
they are never mistaken for data that was not collected.

**Captured but not modelled:** `household_size` (family size, 1–50) and `damage_photo`
(the documentary-evidence flag: `1` when a non-rejected "Damage photos" document is on
file). Both are validated, stored in every score's `indicator_snapshot`, and drive
staleness detection — the model simply does not use them as inputs. `/health` reports
them under `features.capturedNotUsed`.

**Deliberately excluded** (documented in `features.js` and the service's `/health`
`excluded` list): sex, civil status, age, senior/pregnant/PWD/lone-parent flags, mobile
number, names, and purok. These are either sensitive attributes, proxies for them, or
not documented assessment indicators — excluding them keeps the model from encoding
demographic shortcuts.

**Identity documents are excluded as a fairness decision.** The presence of a barangay
certificate, valid ID or national ID is deliberately **not** a score input: it measures
documentation, not vulnerability, and scoring by document possession would penalize
applicants who cannot obtain an ID. Identity documents are used by the Data Validation
module only.

## Target label

`priority category` ∈ { **Low, Moderate, High** } — three classes, matching the
`vulnerability_class` check constraint in the database. Labels come from the source
dataset's `Priority_Level` column (the `labelSource` reported by `/health`).

The artifact stores the class labels `['High', 'Low', 'Medium']`; `Medium` is renamed
to the system's **Moderate** on the way out, so stored rows, the UI and the paper all
use the same three words.

## Preprocessing

- `OneHotEncoder(handle_unknown='ignore')` over the three mapped columns (4 + 3 + 3
  one-hot features = 10 model features).
- No scaling, no imputation: missing or invalid indicators cause a 400 with per-field
  details — the API never scores an incomplete record.
- The artifact was fitted under scikit-learn 1.6.1 with pandas column names; the
  service loads it with a tolerant loader (one removed private class is stubbed) and
  rewrites the column spec to the equivalent integer indices so inference runs on a
  plain numpy array — no pandas dependency at serving time.

## Training (offline, in Google Colab)

- Algorithm: `RandomForestClassifier` — 100 trees, `max_depth=None`,
  `min_samples_leaf=1`, `max_features='sqrt'`, `random_state=42`.
- Fit on all 1,000 collected rows; the fitted `Pipeline` is exported as
  `priority_model.joblib` and dropped into `ml-service/artifacts/`.
- The service does **not** retrain at start-up — it loads the shipped artifact, so a
  restart never changes the model.

## Serialization & loading

- Artifact: `ml-service/artifacts/priority_model.joblib` (joblib/sklearn pipeline).
- Metrics: `ml-service/artifacts/priority_metrics.json`, served unchanged as
  `/health.evaluation`.
- Loading validates, in order: the artifact exists, the three mapped values are fitted
  categories, the artifact classes map 1:1 onto Low/Moderate/High, and the metrics file
  has a usable accuracy. Any failure leaves `available: false` with the reason reported
  by `/health` — the API returns 503 and **never fabricates a score**.

## Evaluation (measured — held-out test rows)

`FINAL_CAPSTONE_2.ipynb` split the collected dataset **80/20, stratified on the target,
`random_state=42`**: the forest was fitted on **800 rows** and evaluated on **200 rows it
never saw**. From `priority_metrics.json`, the figures the app reports:

- **Accuracy: 99.5 %** (199 of 200 held-out rows).
- Per class (held-out support in parentheses):
  - Low: precision 1.0000, recall 1.0000, F1 1.0000 (n = 47)
  - Moderate: precision 0.9928, recall 1.0000, F1 0.9964 (n = 138)
  - High: precision 1.0000, recall 0.9333, F1 0.9655 (n = 15)
  - These are recomputed exactly from the confusion matrix; the notebook's printed
    `classification_report` rounds the same values to two decimals (Moderate precision
    0.99, High recall 0.93, High F1 0.97).
- Confusion matrix (rows = dataset labels, columns = predictions, order Low / Moderate /
  High):

  ```
  [[ 47,   0,   0],
   [  0, 138,   0],
   [  0,   1,  14]]
  ```

- The single disagreement is a record the dataset labelled **High** that the model
  predicted **Moderate**.

Two honesty caveats on these numbers:

1. A 200-row hold-out from **one barangay** is a small, narrow test set — with only 15
   held-out `High` rows, the High recall estimate moves by ~6.7 points per row. It is an
   internal hold-out, **not** an external validation.
2. The shipped notebook figure labels the matrix axes the other way round (rows
   "Predicted", columns "Actual"). The values are sklearn's `confusion_matrix`, whose rows
   are the **actual** labels — the orientation above, and the only one consistent with the
   printed report.

### Secondary figure: agreement over all 1,000 rows

`fullDataAgreement` re-scores **all 1,000** rows, **including the 800 the model was fitted
on** — training-set agreement, shown only as a sanity check and labelled as such:

- **Accuracy: 99.9 %** (1 mismatched row out of 1,000).
- Per class (support in parentheses):
  - Low: precision 1.000, recall 1.000, F1 1.000 (n = 233)
  - Moderate: precision 0.9986, recall 1.000, F1 0.9993 (n = 690)
  - High: precision 1.000, recall 0.987, F1 0.9935 (n = 77)

  ```
  [[233,   0,   0],
   [  0, 690,   0],
   [  0,   1,  76]]
  ```

- The single disagreement is an ambiguous row (`TOTALLY` / Category B / `RENTER`,
  labelled HIGH, predicted MEDIUM at 0.44 / 0.00 / 0.56).

**Do not cite either figure as real-world performance.** The held-out number shows the
model generalises to rows from the same collection exercise; the 1,000-row number only
shows it reproduces the source labels. Neither measures behaviour on households outside
this dataset. The notebook's own two plots ship with the app at
`client/public/colab/` (aggregate counts only) and render in **Monitoring & Reports**.

## Score output & the priority-score conversion

- `class`: the model's own classification (argmax of the probability vector). This is
  the primary output.
- `probabilities`: class probabilities in `[Low, Moderate, High]` order (reordered from
  the artifact's `['High','Low','Medium']`).
- `confidence`: the winning class probability (model agreement only — not a statistical
  confidence interval).
- `score` (a.k.a. `priorityIndex`, 0–100): a **documented conversion** of the
  probability vector for sorting and prioritisation only:

  ```
  priorityIndex = 100 * Σ ( i / (K - 1) * p_i )    for i = 0..K-1, K = 3 classes
  ```

  All-Low → 0, all-High → 100, even Low/High split → 50. This is **not** a calibrated
  probability of harm and **not** an official LGU scale — it exists only so staff can
  sort and filter the queue. The UI states this next to every score.

- `top_factors`: one entry per model input, both numbers measured from the model, never
  invented:
  - `splitShare` — the share of the forest's split impurity reduction (Gini importance)
    that happened on that input's one-hot columns;
  - `deviation` — the change in the predicted class's probability when that input is
    swapped across its own possible categories (the other two stay as recorded).

  This is the plain-language "why this result" breakdown shown in the detail panel.

## Human review, correction, and audit

- Scores never auto-approve, auto-reject, or change any status.
- **CSWD Staff only** can compute and re-run scores; Barangay Staff have a read-only
  view (server-enforced 403, so the hidden UI control cannot be bypassed).
- CSWD Staff can **flag** a questionable score (mandatory note ≥ 5 characters) and
  record an **authorized manual correction** (mandatory reason ≥ 5 characters). Both are
  attributed and timestamped; manual rows carry no probabilities.
- A new score run supersedes the previous current row; nothing is ever deleted. The
  full history (model runs and corrections) is kept for audit.
- A stale score is detected in two ways: (a) the assessment data changed after scoring
  — the stored indicator snapshot (including the `damage_photo` flag) is compared with
  the live record; or (b) the score was produced by an older model version than the one
  now running (`rf-1.1.0` scores go stale while `rf-1.2.0` is live, so the queue prompts
  a re-run against the current model). A manually corrected score is exempt from
  model-version staleness.

## Access control

- All scoring endpoints require an authenticated barangay or CSWD staff account.
  Beneficiaries receive 403 on every scoring route (server-enforced; the client route
  guard is a convenience, not the control).
- Score rows are read-only for staff clients (RLS: staff `SELECT` only); the server
  writes with the service role.
- Everything is scoped to Barangay Tambacan inside the service layer — never from client
  input.

## Limitations (documented, not hidden)

1. The headline metrics come from a **single 200-row internal hold-out** of one barangay's
   records — small, narrow, and not an external validation. The secondary 1,000-row figure
   is training-set agreement. Neither is real-world performance evidence.
2. Three inputs only (damage extent, income category, house status). Family size and
   documentary photo evidence are recorded but not modelled; a real assessment would
   consider more (or different) factors, ideally supplied and validated by the LGU.
3. The system's vocabulary is wider than the dataset's in two places (`No income`,
   `Informal settler` / `Other`) and is mapped onto the nearest dataset category — see
   **Features**. Records carrying those values inherit the dataset's nearest band.
4. Priority-score conversion is a ranking heuristic, not a calibrated risk probability.
5. Fairness on real demographic groups cannot be evaluated from this artifact: the
   input set is small and deliberately excludes sensitive attributes. The feature
   exclusions — including the deliberate exclusion of identity-document presence — are
   a design guardrail, not a measured fairness guarantee.
6. 1,000 records from a single barangay is a small, narrow training set; results
   outside Barangay Tambacan-like contexts are unestablished.
