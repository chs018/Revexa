"""
train_classifier.py — offline baseline ML classifier for Revexa.

Trains a genuinely fitted LogisticRegression on real (synthetic-world)
dispute outcomes, as an honest comparison point against the Gemini-based
riskScorer agent's zero-shot verdicts. This script does NOT run in
production — it's a one-off you run locally and commit the resulting
model.joblib / ml-metrics.json, which the server just reads as static files
(see server/src/routes/disputes.js's GET /metrics-ml).

HOW TO RERUN (e.g. after generating more synthetic data):
  1. Trigger more disputes so groundTruthDefensible + transaction context
     keep accumulating — POST /demo/trigger-dispute repeatedly. This does
     NOT require the Gemini call to succeed: ensureTransactionContext()
     runs before the Gemini call in riskScorer.js, and groundTruthDefensible
     is assigned synchronously by the trigger route itself, so both are
     populated even on a quota-exhausted or broken key.
  2. From server/: `npm run export-dataset` — regenerates scripts/ml/dataset.csv.
  3. From server/scripts/ml/: `pip install -r requirements.txt` (once), then
     `python train_classifier.py` — overwrites model.joblib and
     ../../data/ml-metrics.json with the new split/fit/evaluation.

Aim for comfortably more than ~150 usable rows with a class balance that
isn't wildly skewed (not, say, >85/15) before trusting the resulting
precision/recall — too few or too lopsided a training population produces
numbers that look clean but aren't meaningful.
"""

import json
import os
from datetime import datetime, timezone

import joblib
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import confusion_matrix, precision_score, recall_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATASET_PATH = os.path.join(SCRIPT_DIR, "dataset.csv")
MODEL_PATH = os.path.join(SCRIPT_DIR, "model.joblib")
METRICS_PATH = os.path.join(SCRIPT_DIR, "..", "..", "data", "ml-metrics.json")
COEFFICIENTS_PATH = os.path.join(SCRIPT_DIR, "..", "..", "data", "ml-model-coefficients.json")
ENV_PATH = os.path.join(SCRIPT_DIR, "..", "..", ".env")

MIN_RECOMMENDED_ROWS = 150
MAX_RECOMMENDED_IMBALANCE = 0.85  # majority class share, as a fraction


# GAP 2 (rigor review): no python-dotenv in requirements.txt, and adding a
# dependency just to read one number felt like the wrong tradeoff — this
# reads CHARGEBACK_FEE out of server/.env with the same manual parsing this
# repo already does elsewhere (e.g. export-dataset.js's CSV escaping) rather
# than pull in a package. Falls back to the same 1500 default server/
# src/routes/disputes.js's GET /metrics uses if .env or the key is missing,
# so a missing file degrades gracefully instead of crashing training.
def load_env_int(key, default):
    if not os.path.exists(ENV_PATH):
        return default
    with open(ENV_PATH, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            if k.strip() == key:
                try:
                    return int(v.strip())
                except ValueError:
                    return default
    return default


CHARGEBACK_FEE = load_env_int("CHARGEBACK_FEE", 1500)


def _to_int_bool(series):
    # The Node export writes booleans as the literal strings "true"/"false"
    # (CSV has no native boolean type), but pandas' own read_csv already
    # recognizes and auto-converts those to real Python bool values before
    # this function ever sees them — mapping against the string keys again
    # here would silently miss every value (bool != "true") and turn the
    # whole column into NaN. Handle both representations explicitly rather
    # than assume either one.
    if series.dtype == bool:
        return series.astype(int)
    return series.map({"true": True, "false": False}).astype(int)


def load_dataset():
    df = pd.read_csv(DATASET_PATH)

    for col in ["ipMatch", "billingAddressMatch", "hasPriorRefund"]:
        df[col] = _to_int_bool(df[col])

    df["groundTruthDefensible"] = _to_int_bool(df["groundTruthDefensible"])

    # logAmount/hasPriorRefund are read directly from the CSV, not
    # recomputed here — scripts/export-dataset.js writes them using
    # src/lib/featureExtraction.js's extractFeatures(), the SAME function
    # lib/mlClassifier.js uses at live-prediction time. Computing these
    # formulas in two places (Python here, JS there) is exactly the drift
    # risk the shared function exists to prevent, so Python's job is just
    # to read the pre-computed values, not re-derive them.
    return df


def build_pipeline():
    numeric_features = ["amount", "logAmount", "priorRefundCount"]
    boolean_features = ["ipMatch", "billingAddressMatch", "hasPriorRefund"]
    categorical_features = ["reasonCode", "currency", "deliveryStatus"]

    preprocessor = ColumnTransformer(
        transformers=[
            ("num", StandardScaler(), numeric_features),
            ("bool", "passthrough", boolean_features),
            ("cat", OneHotEncoder(handle_unknown="ignore"), categorical_features),
        ]
    )

    # LogisticRegression: the standard, interpretable baseline for a small
    # tabular binary-classification problem like this — chosen deliberately
    # over anything fancier, per the spec.
    pipeline = Pipeline(
        steps=[
            ("preprocess", preprocessor),
            ("classifier", LogisticRegression(max_iter=1000, random_state=42)),
        ]
    )
    feature_groups = (numeric_features, boolean_features, categorical_features)
    return pipeline, numeric_features + boolean_features + categorical_features, feature_groups


def export_coefficients(pipeline, numeric_features, boolean_features, categorical_features):
    """PART A (point 1): everything server/src/lib/mlClassifier.js needs to
    replicate this exact fitted model's prediction in pure JS, no Python at
    request time — feature names in order, fitted weights, the intercept,
    and the StandardScaler's mean/scale.

    Sliced from classifier.coef_ by KNOWN block width (num, then bool, then
    each categorical feature's one-hot width) rather than by parsing
    sklearn's ColumnTransformer.get_feature_names_out() name strings — this
    doesn't depend on knowing sklearn's internal naming convention at all,
    and the assert below catches any slicing mistake immediately, at
    training time, rather than silently producing a wrong live prediction.
    """
    preprocessor = pipeline.named_steps["preprocess"]
    classifier = pipeline.named_steps["classifier"]

    num_scaler = preprocessor.named_transformers_["num"]
    cat_encoder = preprocessor.named_transformers_["cat"]

    coef = classifier.coef_[0]
    intercept = float(classifier.intercept_[0])

    idx = 0
    numeric_coefficients = coef[idx : idx + len(numeric_features)].tolist()
    idx += len(numeric_features)
    boolean_coefficients = coef[idx : idx + len(boolean_features)].tolist()
    idx += len(boolean_features)

    categorical_export = {}
    for i, name in enumerate(categorical_features):
        categories = cat_encoder.categories_[i].tolist()
        width = len(categories)
        categorical_export[name] = {
            "categories": categories,
            "coefficients": coef[idx : idx + width].tolist(),
        }
        idx += width

    assert idx == len(coef), f"coefficient slicing mismatch: consumed {idx} of {len(coef)} — block widths don't add up"

    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "model": "LogisticRegression",
        "numericFeatures": numeric_features,
        "numericScaling": {"mean": num_scaler.mean_.tolist(), "scale": num_scaler.scale_.tolist()},
        "numericCoefficients": numeric_coefficients,
        "booleanFeatures": boolean_features,
        "booleanCoefficients": boolean_coefficients,
        "categoricalFeatures": categorical_export,
        "intercept": intercept,
    }


def main():
    df = load_dataset()
    total_rows = len(df)
    true_count = int(df["groundTruthDefensible"].sum())
    false_count = total_rows - true_count
    majority_share = max(true_count, false_count) / total_rows if total_rows else 0

    print(f"Dataset: {total_rows} rows "
          f"({true_count} true / {false_count} false, "
          f"majority class {majority_share * 100:.1f}%)")

    warnings = []
    if total_rows < MIN_RECOMMENDED_ROWS:
        warnings.append(
            f"Only {total_rows} rows — fewer than the recommended {MIN_RECOMMENDED_ROWS}. "
            "Precision/recall below are likely noisy; generate more data before trusting them."
        )
    if majority_share > MAX_RECOMMENDED_IMBALANCE:
        warnings.append(
            f"Class balance is {majority_share * 100:.1f}%/{100 - majority_share * 100:.1f}% — "
            "more skewed than the recommended 85/15 cap. Precision/recall may not mean much."
        )
    for w in warnings:
        print(f"WARNING: {w}")

    pipeline, feature_cols, (numeric_features, boolean_features, categorical_features) = build_pipeline()

    X = df[feature_cols + ["disputeId", "razorpayId"]]  # keep ids/amount around for cost calc after split
    y = df["groundTruthDefensible"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, stratify=y, random_state=42
    )

    pipeline.fit(X_train[feature_cols], y_train)
    y_pred = pipeline.predict(X_test[feature_cols])

    tn, fp, fn, tp = confusion_matrix(y_test, y_pred, labels=[0, 1]).ravel()
    precision = precision_score(y_test, y_pred, zero_division=0)
    recall = recall_score(y_test, y_pred, zero_division=0)

    # Same raw-amount-sum convention as GET /metrics (server/src/routes/
    # disputes.js) — mixed currencies (INR paise, USD cents) summed without
    # FX conversion. That's an existing simplification in this app, not one
    # introduced here; replicating it exactly is what makes the two numbers
    # genuinely comparable rather than apples-to-oranges.
    #
    # GAP 2: false-positive cost also adds CHARGEBACK_FEE per false-positive
    # case, same formula GET /metrics uses — the flat fee the acquirer
    # charges per filed dispute, burned specifically on cases that weren't
    # worth contesting. Not added to false-negative cost, for the same
    # reason as the Node side: a false negative was never contested, so no
    # fee was ever incurred.
    test_amounts = X_test["amount"].reset_index(drop=True)
    y_test_reset = y_test.reset_index(drop=True)
    y_pred_series = pd.Series(y_pred)

    fp_mask = (y_pred_series == 1) & (y_test_reset == 0)
    fn_mask = (y_pred_series == 0) & (y_test_reset == 1)
    false_positive_cost = int(test_amounts[fp_mask].sum()) + CHARGEBACK_FEE * int(fp_mask.sum())
    false_negative_cost = int(test_amounts[fn_mask].sum())

    test_true_count = int(y_test.sum())
    test_false_count = int(len(y_test) - test_true_count)

    results = {
        "model": "LogisticRegression",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "datasetSize": total_rows,
        "trainSetSize": len(y_train),
        "testSetSize": len(y_test),
        "classBalance": {
            "trueCount": true_count,
            "falseCount": false_count,
            "truePct": round(true_count / total_rows * 100, 1) if total_rows else None,
        },
        "testSetClassBalance": {
            "trueCount": test_true_count,
            "falseCount": test_false_count,
            "truePct": round(test_true_count / len(y_test) * 100, 1) if len(y_test) else None,
        },
        "confusionMatrix": {"tp": int(tp), "fp": int(fp), "tn": int(tn), "fn": int(fn)},
        "precision": round(float(precision), 4),
        "recall": round(float(recall), 4),
        "falsePositiveCost": false_positive_cost,
        "falseNegativeCost": false_negative_cost,
        "chargebackFee": CHARGEBACK_FEE,
        "costNote": (
            "Same raw-amount-sum convention as GET /metrics — mixed currencies "
            "(INR paise, USD cents) summed without FX conversion, not real "
            "dollar amounts. falsePositiveCost includes CHARGEBACK_FEE "
            f"({CHARGEBACK_FEE}) per false-positive case, on top of the "
            "disputed amount — same formula GET /metrics uses, so the two "
            "are genuinely comparable."
        ),
        "warnings": warnings,
    }

    os.makedirs(os.path.dirname(METRICS_PATH), exist_ok=True)
    with open(METRICS_PATH, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)

    joblib.dump(pipeline, MODEL_PATH)

    # PART A (point 1): the JS-replicable form of this same fitted model —
    # server/src/lib/mlClassifier.js reads this at request time so the live
    # pipeline can compare its verdict against the LLM's without shelling
    # out to Python.
    coefficients = export_coefficients(pipeline, numeric_features, boolean_features, categorical_features)
    with open(COEFFICIENTS_PATH, "w", encoding="utf-8") as f:
        json.dump(coefficients, f, indent=2)

    print(f"\nTest set: {len(y_test)} rows ({test_true_count} true / {test_false_count} false)")
    print(f"Precision: {precision:.4f}  Recall: {recall:.4f}")
    print(f"Confusion matrix: TP={tp} FP={fp} TN={tn} FN={fn}")
    print(f"False positive cost: {false_positive_cost}  False negative cost: {false_negative_cost}")
    print(f"\nWrote {METRICS_PATH}")
    print(f"Wrote {MODEL_PATH}")
    print(f"Wrote {COEFFICIENTS_PATH}")


if __name__ == "__main__":
    main()
