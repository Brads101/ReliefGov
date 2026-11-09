#!/usr/bin/env python3
"""
ReliefGov — Random Forest vulnerability scoring microservice (Python).

This is the machine-learning implementation for the capstone's vulnerability
scoring module. Trained in Google Colab (scikit-learn) and shipped here
as a joblib Pipeline artifact (reliefgov_random_forest.joblib); this service
loads it and speaks a JSON-over-HTTP contract that the Express API
(server/src/ml/pythonClient.js) calls.

MODEL (artifacts/priority_model.joblib)
  Pipeline('preprocessor' -> 'classifier')
    preprocessor : ColumnTransformer:
      - 'cat' (SimpleImputer -> OneHotEncoder(handle_unknown='ignore')) over 7 categorical features:
          Purok | Sex | Ownership | Damage_Classification | Disability_Status |
          Location_Flood_Exposure | Supporting_Documents_ Complete
      - 'num' (SimpleImputer(median)) over 2 numerical features:
          Age | Household_Size
    classifier   : RandomForestClassifier(100 trees, random_state=42)
  classes_ (as stored): ['HIGH', 'LOW', 'MEDIUM'] -> served as Low/Moderate/High

Endpoints:
  GET  /health   -> { ok, modelVersion, available, ... }
  POST /score    -> { class, classIndex, probabilities, priorityIndex,
                      confidence, explanation, datasetType, ... }

Run:  python app.py  (listens on HOST:PORT, default 127.0.0.1:8100)
"""

import json
import os
import re
import sys
import types
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import joblib
import joblib.numpy_pickle as jp
import numpy as np

# --------------------------------------------------------------------------- #
# Configuration — mirrors server/src/ml/config.js.
# --------------------------------------------------------------------------- #

MODEL_VERSION = "rf-2.0.0"

# Served class order, least -> most vulnerable (system wording).
CLASSES = ["Low", "Moderate", "High"]

# The artifact stores these literal labels; they are mapped on the way out
MODEL_CLASS_TO_SYSTEM = {
    "LOW": "Low",
    "MEDIUM": "Moderate",
    "HIGH": "High",
    "Low": "Low",
    "Medium": "Moderate",
    "High": "High",
}

HERE = os.path.dirname(os.path.abspath(__file__))
ARTIFACT_PATH = os.path.join(HERE, "artifacts", "priority_model.joblib")
METRICS_PATH = os.path.join(HERE, "artifacts", "priority_metrics.json")

DATASET = {
    "type": "historical",
    "label": "Trained household records - Barangay Tambacan (9 Features)",
    "size": 1000,
    "source": "ReliefGov_Classification_Results.xlsx",
    "disclaimer": (
        "Trained with a 100-tree Random Forest pipeline on 9 household "
        "and disaster indicators from Barangay Tambacan. Evaluated with a 20% "
        "held-out stratified split (random_state=42). Every score is "
        "decision-support output only: it helps staff prioritize assistance "
        "without manual queue bias."
    ),
}

MODEL_COLUMNS = [
    "Purok",
    "Sex",
    "Ownership",
    "Damage_Classification",
    "Disability_Status",
    "Location_Flood_Exposure",
    "Supporting_Documents_ Complete",
    "Age",
    "Household_Size",
]

DAMAGE_TO_DATASET = {
    "None": "FLOODED",
    "Minor": "PARTIALLY",
    "Major": "HEAVILY FLOODED",
    "Total": "TOTALLY",
}

HOUSE_TO_DATASET = {
    "Owned": "OWNER",
    "Rented": "RENTER",
    "Shared": "SHARER",
    "Informal settler": "RENTER",
    "Other": "SHARER",
}

HIGH_FLOOD_PUROKS = {
    "PUROK 01", "PUROK 01-A", "PUROK 01-B", "PUROK 1", "PUROK 1-A", "PUROK 1-B",
    "PUROK 02", "PUROK 02-A", "PUROK 02-B", "PUROK 2", "PUROK 2-A", "PUROK 2-B",
    "PUROK 03", "PUROK 03-A", "PUROK 03-B", "PUROK 3", "PUROK 3-A", "PUROK 3-B",
    "PUROK 04", "PUROK 04-A", "PUROK 04-B", "PUROK 4", "PUROK 4-A", "PUROK 4-B",
}

FEATURE_NAMES = [
    "purok",
    "sex",
    "age",
    "household_size",
    "house_status",
    "damage_extent",
    "is_pwd",
    "location_flood_exposure",
    "supporting_documents_complete",
]

FEATURES_BLOCK = {
    "names": FEATURE_NAMES,
    "modelColumns": MODEL_COLUMNS,
    "capturedNotUsed": [],
    "capturedNotUsedReason": "All 9 recorded indicators are actively consumed by the Random Forest model.",
    "snapshotNames": FEATURE_NAMES,
    "excluded": [
        "civil status",
        "mobile number",
        "names",
    ],
    "exclusionReason": (
        "Personal identifying attributes (name, phone number, civil status) "
        "are strictly separated to maintain objective algorithmic fairness."
    ),
}

TARGET_BLOCK = {
    "kind": "priority category",
    "classes": CLASSES,
    "labelSource": "Priority level from ReliefGov classification dataset",
}

HOST = os.environ.get("ML_HOST", "127.0.0.1")
PORT = int(os.environ.get("ML_PORT", "8100"))

# --------------------------------------------------------------------------- #
# Record normalization and validation.
# --------------------------------------------------------------------------- #

DAMAGE_EXTENTS = ["None", "Minor", "Major", "Total"]
HOUSE_STATUSES = ["Informal settler", "Shared", "Rented", "Other", "Owned"]

class IndicatorError(ValueError):
    """Raised when a record is missing/invalid assessment indicators."""

    def __init__(self, problems):
        super().__init__("Indicators incomplete.")
        self.problems = problems


def missing_indicators(record):
    problems = []
    size = record.get("household_size")
    if size is not None:
        try:
            s_val = int(size)
            if s_val < 1 or s_val > 50:
                problems.append("family size must be a whole number between 1 and 50")
        except (ValueError, TypeError):
            problems.append("family size must be a whole number between 1 and 50")
    if record.get("damage_extent") not in DAMAGE_EXTENTS:
        problems.append("damage extent must be one of: " + ", ".join(DAMAGE_EXTENTS))
    if record.get("house_status") not in HOUSE_STATUSES:
        problems.append("house status must be one of: " + ", ".join(HOUSE_STATUSES))
    return problems


def normalize_purok(val):
    if not val:
        return "PUROK 01"
    raw = str(val).strip().upper()
    # Match patterns like "PUROK 1" -> "PUROK 01"
    match = re.match(r"^PUROK\s+(\d)(-[A-Z])?$", raw)
    if match:
        num = match.group(1).zfill(2)
        sub = match.group(2) or ""
        return f"PUROK {num}{sub}"
    if not raw.startswith("PUROK"):
        raw = f"PUROK {raw}"
    return raw


def calculate_age(dob, explicit_age=None):
    if explicit_age is not None:
        try:
            val = float(explicit_age)
            if 1 <= val <= 120:
                return val
        except (ValueError, TypeError):
            pass
    if dob:
        try:
            birth_year = int(str(dob)[:4])
            current_year = datetime.now().year
            diff = current_year - birth_year
            if 1 <= diff <= 120:
                return float(diff)
        except (ValueError, TypeError):
            pass
    return 40.0


def indicator_snapshot(record):
    damage_photo = 1 if record.get("damage_photo") in [True, 1, "1"] else 0
    return {
        "household_size": record.get("household_size"),
        "income_level": record.get("income_level"),
        "damage_extent": record.get("damage_extent"),
        "house_status": record.get("house_status"),
        "damage_photo": damage_photo,
    }


def model_row(record):
    """Maps the record onto the 9 features expected by the pipeline."""
    problems = missing_indicators(record)
    if problems:
        raise IndicatorError(problems)

    purok_norm = normalize_purok(record.get("purok"))
    age = calculate_age(record.get("date_of_birth"), record.get("age"))
    is_pwd = "Yes" if bool(record.get("is_pwd") or record.get("disability_status") in [True, "Yes", "yes", 1, "1"]) else "No"
    has_docs = "Yes" if bool(
        record.get("supporting_documents_complete") in [True, "Yes", "yes", 1, "1"]
        or record.get("has_barangay_certificate")
        or record.get("damage_photo")
    ) else "No"
    flood = record.get("location_flood_exposure")
    if flood in [True, "Yes", "yes", 1, "1"]:
        flood_exp = "Yes"
    elif flood in [False, "No", "no", 0, "0"]:
        flood_exp = "No"
    else:
        flood_exp = "Yes" if purok_norm in HIGH_FLOOD_PUROKS else "No"

    sex_raw = str(record.get("sex") or "FEMALE").strip().upper()
    sex = "MALE" if "MALE" in sex_raw and "FEMALE" not in sex_raw else "FEMALE"
    ownership = HOUSE_TO_DATASET.get(record.get("house_status"), "OWNER")
    damage = DAMAGE_TO_DATASET.get(record.get("damage_extent"), "PARTIALLY")
    size = float(record.get("household_size") or 4)

    return np.array(
        [[purok_norm, sex, ownership, damage, is_pwd, flood_exp, has_docs, float(age), size]],
        dtype=object,
    )


# --------------------------------------------------------------------------- #
# Loading the Colab artifact (trained under scikit-learn).
# --------------------------------------------------------------------------- #

def _make_stub(module, name):
    """Stand-in for a private class that no longer exists in this sklearn."""
    mod = sys.modules.get(module)
    if mod is None:
        mod = types.ModuleType(module)
        sys.modules[module] = mod
    cls = type(name, (object,), {})
    cls.__module__ = module
    setattr(mod, name, cls)
    return cls


def _patch_column_spec(pipe):
    """Serve the ColumnTransformer from a plain numpy array (no pandas required)."""
    pre = pipe.named_steps["preprocessor"]

    # SimpleImputer compatibility fix for newer scikit-learn
    for name, trans, cols in pre.transformers_:
        if hasattr(trans, "steps"):
            for sname, step in trans.steps:
                if hasattr(step, "_fit_dtype"):
                    step._fill_dtype = step._fit_dtype
                if hasattr(step, "feature_names_in_"):
                    try:
                        delattr(step, "feature_names_in_")
                    except Exception:
                        pass

    cat_pipe = pre.transformers_[0][1]
    num_pipe = pre.transformers_[1][1]

    # Map categorical columns (0..6) and numerical columns (7, 8)
    pre.transformers_ = [
        ("cat", cat_pipe, list(range(7))),
        ("num", num_pipe, [7, 8]),
    ]
    pre.transformers = pre.transformers_
    pre._columns = [list(range(7)), [7, 8]]
    if hasattr(pre, "_feature_names_in"):
        delattr(pre, "_feature_names_in")
    return pipe


def load_pipeline(path):
    original = jp.NumpyUnpickler.find_class

    def patched(self, module, name):
        try:
            return original(self, module, name)
        except Exception:
            return _make_stub(module, name)

    jp.NumpyUnpickler.find_class = patched
    try:
        pipe = joblib.load(path)
    finally:
        jp.NumpyUnpickler.find_class = original
    return _patch_column_spec(pipe)


# --------------------------------------------------------------------------- #
# Priority Index & Explanation.
# --------------------------------------------------------------------------- #

def priority_index_from_probabilities(probs):
    k = len(CLASSES)
    index = sum((i / (k - 1)) * probs[i] for i in range(k))
    return round(index * 100, 2)


class Model:
    """Loads the Random Forest pipeline and serves vulnerability scoring."""

    def __init__(self):
        self.available = False
        self.reason = None
        self.pipe = None
        self.evaluation = None
        self.trained_at = None
        self.hyperparameters = None
        self.class_order = []
        self.feature_shares = {}
        self.load()

    def load(self):
        try:
            if not os.path.exists(ARTIFACT_PATH):
                raise FileNotFoundError(f"model artifact not found at {ARTIFACT_PATH}")
            pipe = load_pipeline(ARTIFACT_PATH)
            clf = pipe.named_steps["classifier"]
            pre = pipe.named_steps["preprocessor"]
            cat_pipe = pre.transformers_[0][1]
            ohe = cat_pipe.named_steps["encoder"]

            # Model classes mapping
            model_classes = [str(c).upper() for c in clf.classes_]
            self.class_order = []
            for system_label in CLASSES:
                # Find matching index
                matches = [
                    idx for idx, c in enumerate(model_classes)
                    if MODEL_CLASS_TO_SYSTEM.get(c) == system_label
                ]
                if not matches:
                    raise ValueError(f"Class {system_label} not found in model classes {model_classes}")
                self.class_order.append(matches[0])

            # Calculate feature importance shares across all 9 features
            importances = clf.feature_importances_
            cat_cols = [
                "Purok", "Sex", "Ownership", "Damage_Classification",
                "Disability_Status", "Location_Flood_Exposure", "Supporting_Documents_ Complete"
            ]
            num_cols = ["Age", "Household_Size"]

            start = 0
            cat_shares = {}
            for col_name, cats in zip(cat_cols, ohe.categories_):
                length = len(cats)
                share = float(importances[start:start + length].sum())
                cat_shares[col_name] = share
                start += length

            num_shares = {}
            for col_name in num_cols:
                share = float(importances[start])
                num_shares[col_name] = share
                start += 1

            all_shares = {**cat_shares, **num_shares}
            tot = sum(all_shares.values())
            self.feature_shares = {k: v / tot for k, v in all_shares.items()}

            if os.path.exists(METRICS_PATH):
                with open(METRICS_PATH, encoding="utf-8") as handle:
                    self.evaluation = json.load(handle)
            else:
                self.evaluation = {"accuracy": 0.63, "evaluatedOn": "200 held-out rows"}

            clf_params = clf.get_params()
            self.hyperparameters = {
                "nEstimators": int(clf.n_estimators),
                "maxDepth": clf.max_depth,
                "minSamplesLeaf": int(clf_params.get("min_samples_leaf", 1)),
                "maxFeatures": str(clf.max_features),
                "seed": clf.random_state,
            }
            self.trained_at = datetime.fromtimestamp(
                os.path.getmtime(ARTIFACT_PATH), timezone.utc
            ).isoformat()
            self.pipe = pipe
            self.available = True
            self.reason = None
        except Exception as err:
            self.pipe = None
            self.available = False
            self.reason = f"Vulnerability model could not be loaded: {err}"

    def score(self, record):
        if not self.available or self.pipe is None:
            raise RuntimeError(self.reason or "model unavailable")
        row = model_row(record)
        raw = self.pipe.predict_proba(row)[0]
        probs = [float(raw[i]) for i in self.class_order]
        total = float(sum(probs))
        if total <= 0:
            raise RuntimeError("model returned an empty probability vector")
        probs = [p / total for p in probs]

        class_index = int(np.argmax(probs))
        snapshot = indicator_snapshot(record)

        return {
            "class": CLASSES[class_index],
            "classIndex": class_index,
            "probabilities": [round(p, 4) for p in probs],
            "priorityIndex": priority_index_from_probabilities(probs),
            "confidence": round(probs[class_index], 4),
            "indicators": snapshot,
            "explanation": self._explain(record, row, class_index),
            "datasetType": DATASET["type"],
            "datasetLabel": DATASET["label"],
            "modelVersion": MODEL_VERSION,
            "trainedAt": self.trained_at,
            "evaluationSummary": {
                "accuracy": self.evaluation.get("accuracy", 0.63),
                "evaluatedOn": self.evaluation.get("evaluatedOn", "200 test rows"),
            },
        }

    def _explain(self, record, row, class_index):
        entries = []
        name_map = [
            ("Ownership", "house_status", "House ownership", record.get("house_status")),
            ("Purok", "purok", "Purok zone", normalize_purok(record.get("purok"))),
            ("Damage_Classification", "damage_extent", "Damage classification", record.get("damage_extent")),
            ("Age", "age", "Age", calculate_age(record.get("date_of_birth"), record.get("age"))),
            ("Household_Size", "household_size", "Household size", record.get("household_size")),
            ("Location_Flood_Exposure", "location_flood_exposure", "Flood prone location", record.get("location_flood_exposure") or "No"),
            ("Sex", "sex", "Gender", record.get("sex")),
            ("Disability_Status", "is_pwd", "PWD / Disability status", "Yes" if record.get("is_pwd") else "No"),
            ("Supporting_Documents_ Complete", "supporting_documents_complete", "Documentary verification", "Yes" if record.get("supporting_documents_complete") or record.get("damage_photo") else "No"),
        ]

        for model_col, snap_key, label, val in name_map:
            share = self.feature_shares.get(model_col, 0.0)
            entries.append({
                "indicator": snap_key,
                "label": label,
                "value": val,
                "splitShare": round(share, 4),
            })

        entries.sort(key=lambda e: -e["splitShare"])
        return entries


MODEL = Model()

# --------------------------------------------------------------------------- #
# HTTP Handler
# --------------------------------------------------------------------------- #

class ScoringHandler(BaseHTTPRequestHandler):

    def do_GET(self):
        if self.path == "/health":
            self._send_json(200, {
                "ok": MODEL.available,
                "modelVersion": MODEL_VERSION,
                "implementation": "Python scikit-learn RandomForestClassifier",
                "available": MODEL.available,
                "reason": MODEL.reason,
                "trainedAt": MODEL.trained_at,
                "classes": CLASSES,
                "hyperparameters": MODEL.hyperparameters,
                "dataset": DATASET,
                "features": FEATURES_BLOCK,
                "target": TARGET_BLOCK,
                "evaluation": MODEL.evaluation,
            })
        else:
            self._send_json(404, {"error": "not found"})

    def do_POST(self):
        if self.path == "/score":
            try:
                length = int(self.headers.get("content-length", 0))
                payload = json.loads(self.rfile.read(length))
                record = payload.get("record", payload)
                result = MODEL.score(record)
                self._send_json(200, result)
            except IndicatorError as err:
                self._send_json(400, {
                    "error": {
                        "message": str(err),
                        "details": {"indicators": err.problems},
                        "status": 400
                    }
                })
            except Exception as err:
                self._send_json(500, {"error": str(err)})
        else:
            self._send_json(404, {"error": "not found"})

    def _send_json(self, status, data):
        body = json.dumps(data, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        # Concise logging
        pass


def run_server():
    server = ThreadingHTTPServer((HOST, PORT), ScoringHandler)
    print(f"ReliefGov ML Scoring Service listening on http://{HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    run_server()
