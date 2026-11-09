/**
 * Python ML service client (ReliefGov).
 *
 * The actual Random Forest lives in a Python microservice (ml-service/app.py,
 * scikit-learn RandomForestClassifier). This module is the Node side of that
 * JSON-over-HTTP contract: it forwards a beneficiary record to the Python
 * service and reshapes the response into exactly the shape the rest of the
 * Express API already expects from scoreRecord()/modelStatus().
 *
 * WHY A SEPARATE PROCESS: keeps the ML stack in standard Python/scikit-learn
 * while the web tier, database logic, and UI stay in Node. The service is
 * stateless and reloads/retrains on start; this client treats it as the
 * single source of model truth.
 *
 * FAILURE BEHAVIOUR (tested):
 *   - service unreachable / not configured  -> 503 with actionable message
 *   - record missing an indicator           -> 400 with per-indicator details
 *   - service returns a 5xx / bad payload   -> 503; nothing is fabricated
 */

import { badRequest, unavailable } from '../lib/errors.js';
import { MODEL_VERSION } from './config.js';

const DEFAULT_BASE = process.env.ML_SERVICE_URL || 'http://127.0.0.1:8100';
const TIMEOUT_MS = Number(process.env.ML_SERVICE_TIMEOUT_MS || 8000);

/** Live model metadata from the Python service /health (cached briefly). */
let statusCache = { at: 0, value: null };

function baseUrl() {
  return String(process.env.ML_SERVICE_URL || DEFAULT_BASE).replace(/\/+$/, '');
}

function serviceConfigured() {
  // The service URL always has a default, so "configured" here means the
  // env flag has not explicitly disabled the Python path.
  return String(process.env.USE_PYTHON_ML || 'true').toLowerCase() !== 'false';
}

async function callService(pathname, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl()}${pathname}`, {
      ...options,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    throw unavailable(
      'The vulnerability model service is unavailable. Start the Python ML service ' +
        '(see ml-service/) or run it with: python ml-service/app.py',
      { cause: err?.message || String(err) }
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Maps a service error payload to the matching HTTP error, else 503. */
function raiseServiceError(response) {
  const payload = response?.body?.error;
  if (payload && typeof payload === 'object') {
    if (payload.status === 400) {
      throw badRequest(payload.message, payload.details);
    }
    throw unavailable(payload.message || 'The vulnerability model service failed.', payload.details);
  }
  if (typeof payload === 'string') {
    throw badRequest(payload);
  }
  throw unavailable(
    'The vulnerability model service returned an unexpected response. ' +
      'Check the Python ML service logs (see ml-service/).'
  );
}

/** Service health/metadata, shaped for the API's model status endpoint. */
export async function fetchModelStatus() {
  if (!serviceConfigured()) {
    return { available: false, reason: 'Python ML service disabled by USE_PYTHON_ML.', modelVersion: MODEL_VERSION };
  }
  const res = await callService('/health');
  if (!res.ok) {
    return { available: false, reason: 'The Python ML service is not healthy.', modelVersion: MODEL_VERSION };
  }
  const h = res.body || {};
  if (!h.available) {
    return { available: false, reason: h.reason || 'Model not loaded in the ML service.', modelVersion: h.modelVersion };
  }
  return {
    available: true,
    modelVersion: h.modelVersion,
    trainedAt: h.trainedAt,
    algorithm: h.implementation || 'Python scikit-learn RandomForestClassifier',
    dataset: {
      type: h.dataset?.type,
      label: h.dataset?.label,
      size: h.dataset?.size,
      disclaimer: h.dataset?.disclaimer
    },
    features: h.features,
    target: h.target,
    hyperparameters: h.hyperparameters,
    evaluation: h.evaluation
  };
}

/** Cached status for dashboards (refreshed at most every 5 seconds). */
export async function modelStatusCached() {
  const now = Date.now();
  if (statusCache.value && now - statusCache.at < 5000) return statusCache.value;
  const value = await fetchModelStatus();
  statusCache = { at: now, value };
  return value;
}

/** Test hook: drop the cached status (used when the service is restarted). */
export function resetStatusCache() {
  statusCache = { at: 0, value: null };
}

/**
 * Scores one beneficiary row via the Python service.
 *
 * @returns the result contract the rest of the API consumes (see
 *          scoringService.runScore for how each field is stored).
 * @throws 400 when an indicator is missing/invalid; 503 when the service is
 *         unreachable or errors. Never fabricates a score.
 */
export async function scoreRecordRemote(record) {
  const res = await callService('/score', {
    method: 'POST',
    body: JSON.stringify(record)
  });
  if (!res.ok) raiseServiceError(res);
  const r = res.body;
  if (!r || typeof r !== 'object' || !r.class || !Array.isArray(r.probabilities)) {
    throw unavailable('The ML service returned an unscorable response.');
  }
  // Reshape to the model.js contract. datasetType comes straight from the
  // service ('historical' for the collected dataset the model was trained
  // on) and scoringService maps it onto the DB's dataset_type enum.
  return {
    class: r.class,
    classIndex: r.classIndex,
    probabilities: r.probabilities,
    priorityIndex: r.priorityIndex,
    confidence: r.confidence,
    indicators: r.indicators,
    explanation: r.explanation,
    datasetType: r.datasetType,
    datasetLabel: r.datasetLabel,
    modelVersion: r.modelVersion,
    trainedAt: r.trainedAt,
    evaluationSummary: r.evaluationSummary
  };
}

export default { fetchModelStatus, modelStatusCached, resetStatusCache, scoreRecordRemote };
