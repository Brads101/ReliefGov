/**
 * ML backend facade (ReliefGov).
 *
 * The Random Forest runs ONLY in the Python microservice
 * (ml-service/app.py, scikit-learn Pipeline: OneHotEncoder ->
 * RandomForestClassifier, trained offline and shipped as a joblib artifact).
 * The capstone requires the machine-learning component to be implemented in
 * Python, and there is exactly one model: if the service cannot produce a
 * score, the API answers 503 and never fabricates a result. There is no
 * JavaScript fallback and no in-process training step any more.
 *
 * This module keeps the small seam the application tier uses
 * (scoreRecordAsync / modelStatusAsync) so services and routes do not need to
 * know where the model is served from.
 *
 * FAILURE BEHAVIOUR (tested):
 *   - service unreachable / unhealthy     -> 503 with actionable message
 *   - record missing an indicator         -> 400 with per-indicator details
 *   - service returns a 5xx / bad payload -> 503; nothing is fabricated
 */

import { scoreRecordRemote, modelStatusCached } from './pythonClient.js';
import { MODEL_VERSION } from './config.js';

export const ML_BACKENDS = Object.freeze(['python']);

/** The only backend this build supports. */
export function configuredBackend() {
  return 'python';
}

/** Honest model status from the Python service. */
export async function modelStatusAsync() {
  try {
    return await modelStatusCached();
  } catch (err) {
    return { available: false, reason: err.message, modelVersion: MODEL_VERSION };
  }
}

/**
 * Scores one record through the Python service.
 *
 * @throws 400 when an indicator is missing/invalid; 503 when the service
 *         cannot produce a score. Never fabricates a result.
 */
export async function scoreRecordAsync(record) {
  return scoreRecordRemote(record);
}

/** Which backend a score would use right now (diagnostics, honest). */
export function activeBackendLabel() {
  return 'python-microservice';
}

export default { configuredBackend, modelStatusAsync, scoreRecordAsync, activeBackendLabel, ML_BACKENDS };
