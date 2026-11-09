/**
 * Vulnerability Scoring — documented model configuration (Batch 5).
 *
 * Everything the scoring contract uses is declared here so the capstone can
 * point at one auditable place: which classes the model predicts, how the
 * model's probability vector becomes the displayed "priority index", and the
 * identity/provenance of the model that runs in the Python microservice.
 *
 * HONESTY NOTES (read before changing anything):
 *  - The model is trained OFFLINE (Google Colab, scikit-learn) on a
 *    1,000-row household dataset collected for this study and shipped to the
 *    service as ml-service/artifacts/priority_model.joblib. Every score
 *    therefore carries dataset_type = 'historical' and the UI labels it.
 *    The notebook held 200 of the 1,000 rows back (stratified 80/20,
 *    random_state=42); the reported metrics are measured on those held-out
 *    rows — an internal hold-out, not an external or real-world
 *    validation. Agreement over all 1,000 rows is kept separately as
 *    `fullDataAgreement` and labelled as training-set agreement.
 *  - Model inputs are three recorded indicators: damage extent, household
 *    income level and house status (mapped onto the dataset's exact category
 *    wording inside ml-service/app.py). Family size and the documentary
 *    `damage_photo` flag are still validated, stored in every score's
 *    indicator snapshot and used for staleness detection — the model itself
 *    does not use them.
 *  - Sensitive attributes (sex, civil status, age, senior/pregnant/PWD flags,
 *    mobile number) are deliberately EXCLUDED, and identity documents
 *    (certificate / valid ID / national ID presence) are excluded as a
 *    fairness decision — see features.js and app.py FEATURES_BLOCK.
 *  - The model directly predicts a priority CATEGORY (Low/Moderate/High).
 *    The numeric priority index is a documented conversion of the
 *    model's class probabilities for sorting only — it is NOT a calibrated
 *    probability of harm and NOT an official LGU scale.
 */

/** Model artifact identity. Bump when the training pipeline changes. */
export const MODEL_VERSION = 'rf-2.0.0';

/** Predicted classes, ordered from least to most vulnerable. */
export const CLASSES = ['Low', 'Moderate', 'High'];

/**
 * Hyperparameters of the shipped forest (100 CART trees, Gini impurity,
 * seed 42) — read back from the artifact at service start; mirrored here for the record.
 */
export const HYPERPARAMETERS = {
  nEstimators: 100,
  maxDepth: null,
  minSamplesLeaf: 1,
  maxFeatures: 'sqrt',
  seed: 42
};

/** Provenance of the dataset the shipped model was evaluated against. */
export const DATASET = {
  type: 'historical',
  label: 'Trained household records - Barangay Tambacan (9 Features)',
  size: 200,
  source: 'ReliefGov_Classification_Results.xlsx'
};

/**
 * Documented conversion from the model's class probability vector to the
 * displayed priority index (0–100, two decimals).
 *
 *   index = 100 * sum_i ( i / (K - 1) * p_i ),  K = number of classes
 *
 * A record whose trees all vote "High" scores 100; all "Low" scores 0;
 * an even split between "Low" and "High" scores 50. The index exists so
 * staff can sort the queue — it is an ordering aid derived from model votes,
 * not a verified probability that harm occurs. The priority CATEGORY shown to
 * staff is the model's own highest-vote class; no invented LGU thresholds are
 * applied on top of the model output.
 */
export function priorityIndexFromProbabilities(probabilities) {
  const k = CLASSES.length;
  let index = 0;
  for (let i = 0; i < k; i += 1) {
    index += (i / (k - 1)) * (probabilities[i] ?? 0);
  }
  return Math.round(index * 10000) / 100; // 0–100, two decimals
}

/**
 * Display convention for MANUALLY corrected categories (no model votes
 * exist): the original documented filing index for each category. This is
 * a filing convention for the score column, not an official LGU scale.
 * (Kept at the historical values so manually filed scores sort consistently
 * with rows recorded before the category list was reduced to three.)
 */
export const MANUAL_CATEGORY_INDEX = {
  Low: 12.5,
  Moderate: 37.5,
  High: 62.5
};

/**
 * A record may be scored only after barangay verification has started or the
 * application was approved — scoring always operates on VALIDATED data.
 * Draft / Pending / Needs Correction records are not yet validated;
 * Rejected records are not assistance candidates.
 */
export const SCORABLE_STATUSES = ['Under Verification', 'Approved'];

export default {
  MODEL_VERSION,
  CLASSES,
  HYPERPARAMETERS,
  DATASET,
  priorityIndexFromProbabilities,
  MANUAL_CATEGORY_INDEX,
  SCORABLE_STATUSES
};
