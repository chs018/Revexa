"""
threshold_sweep.py — empirical basis for CONFIDENCE_THRESHOLD,
RISK_BAND_MARGIN, and HIGH_VALUE_CUTOFF (GAP 3, rigor review).

Does NOT run in production, same as train_classifier.py — this is a one-off
you run locally after generating enough labeled data, and it writes
threshold_analysis.json, which docs/threshold-rationale.md then explains in
prose. Reuses load_dataset()/build_pipeline() from train_classifier.py so
the features, preprocessing, and — critically — the train/test split
(same test_size, same stratify, same random_state=42) are IDENTICAL to what
train_classifier.py reports on the Metrics page. This sweep's "held-out test
set" is the exact same rows as that page's held-out test set, not a
different split that happens to also be called a test set.

HOW TO RUN: same prerequisites as train_classifier.py (venv + requirements
installed, dataset.csv exported). From server/scripts/ml/:
  python threshold_sweep.py

WHAT IT DOES:
  1. Fits the same LogisticRegression pipeline on the training split, then
     reads out predict_proba on the held-out test split as a stand-in for
     the risk scorer's 0-1 confidence score — same semantics riskScorer.js's
     `score` field has.
  2. CONFIDENCE_THRESHOLD: sweeps candidate thresholds 0.50-0.90 in steps of
     0.05. For each, computes precision, recall, F1, and total cost
     (falsePositiveCost + falseNegativeCost, same formula GET /metrics uses,
     including CHARGEBACK_FEE) using actual test-set dispute amounts. Picks
     the threshold that MINIMIZES TOTAL COST — not the one that maximizes
     accuracy or F1, because cost is what this app is actually optimizing
     for (see docs/threshold-rationale.md).
  3. RISK_BAND_MARGIN: at the chosen threshold, computes the disagreement
     rate (predicted verdict != groundTruthDefensible) for test cases whose
     score falls within +/-0.05, +/-0.10, and +/-0.15 of that threshold, and
     compares each to the overall test-set disagreement rate. Picks the
     narrowest band whose disagreement rate is meaningfully elevated over
     the overall rate — the empirical claim being "this band is genuinely
     uncertain, worth a human's attention" rather than an arbitrary width.
  4. HIGH_VALUE_CUTOFF: the 90th percentile of dispute amounts across the
     full labeled dataset (not just the test split) — "the top 10% by value,
     where a wrong auto-decision is disproportionately costly."
"""

import json
import os
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from sklearn.metrics import confusion_matrix, f1_score, precision_score, recall_score
from sklearn.model_selection import train_test_split

from train_classifier import CHARGEBACK_FEE, build_pipeline, load_dataset

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_PATH = os.path.join(SCRIPT_DIR, "threshold_analysis.json")

THRESHOLD_CANDIDATES = [round(0.5 + 0.05 * i, 2) for i in range(9)]  # 0.50 .. 0.90
MARGIN_CANDIDATES = [0.05, 0.10, 0.15]

# A band's disagreement rate has to beat the overall rate by at least this
# multiplier to count as "meaningfully elevated" rather than sampling noise
# — see the docstring on pick_margin() below for why a ratio, not a raw
# difference.
ELEVATION_RATIO = 1.15
# Below this many test cases in a band, its disagreement rate is too noisy
# to trust (a single flipped case swings the rate wildly at n=3).
MIN_BAND_SAMPLE = 8


def cost_for_predictions(y_true, y_pred, amounts):
    """
    Same false-positive / false-negative cost formula GET /metrics and
    train_classifier.py both use: falsePositiveCost sums the disputed
    amount PLUS CHARGEBACK_FEE per false-positive case (a case the model
    told the merchant to fight that wasn't actually defensible — the fee is
    burned regardless of outcome); falseNegativeCost sums just the disputed
    amount (never contested, so no fee was ever incurred).
    """
    y_true = np.asarray(y_true)
    y_pred = np.asarray(y_pred)
    amounts = np.asarray(amounts)

    fp_mask = (y_pred == 1) & (y_true == 0)
    fn_mask = (y_pred == 0) & (y_true == 1)

    fp_cost = int(amounts[fp_mask].sum()) + CHARGEBACK_FEE * int(fp_mask.sum())
    fn_cost = int(amounts[fn_mask].sum())

    return fp_cost, fn_cost


def sweep_thresholds(y_test, y_proba, amounts):
    rows = []
    for threshold in THRESHOLD_CANDIDATES:
        y_pred = (y_proba >= threshold).astype(int)
        tn, fp, fn, tp = confusion_matrix(y_test, y_pred, labels=[0, 1]).ravel()
        precision = precision_score(y_test, y_pred, zero_division=0)
        recall = recall_score(y_test, y_pred, zero_division=0)
        f1 = f1_score(y_test, y_pred, zero_division=0)
        fp_cost, fn_cost = cost_for_predictions(y_test, y_pred, amounts)

        rows.append(
            {
                "threshold": threshold,
                "confusionMatrix": {"tp": int(tp), "fp": int(fp), "tn": int(tn), "fn": int(fn)},
                "precision": round(float(precision), 4),
                "recall": round(float(recall), 4),
                "f1": round(float(f1), 4),
                "falsePositiveCost": fp_cost,
                "falseNegativeCost": fn_cost,
                "totalCost": fp_cost + fn_cost,
            }
        )
    return rows


def pick_best_threshold(rows):
    # Minimizes totalCost; ties broken by the smaller threshold value so the
    # choice is deterministic and reproducible, not order-dependent.
    return min(rows, key=lambda r: (r["totalCost"], r["threshold"]))


def pick_margin(y_test, y_proba, chosen_threshold):
    """
    For each candidate band width, disagreement rate = fraction of test
    cases with |score - chosen_threshold| <= width whose prediction AT the
    chosen threshold (score >= chosen_threshold -> predicted defensible)
    disagrees with groundTruthDefensible.

    Compared against the overall test-set disagreement rate as a RATIO
    (band rate / overall rate) rather than a raw percentage-point
    difference, since the overall rate itself moves with dataset size and
    class balance — a ratio says "this band is N times worse than the
    population," which is the actual claim RISK_BAND_MARGIN is supposed to
    justify ("genuinely more uncertain than typical"), independent of what
    the baseline error rate happens to be.

    Picks the NARROWEST band that clears both ELEVATION_RATIO and
    MIN_BAND_SAMPLE — narrower is preferred when several bands qualify,
    since a wider band routes more cases to a human than the data actually
    justifies.
    """
    y_test = np.asarray(y_test)
    y_proba = np.asarray(y_proba)
    y_pred_at_threshold = (y_proba >= chosen_threshold).astype(int)
    disagreement = y_pred_at_threshold != y_test

    overall_rate = float(disagreement.mean()) if len(disagreement) else 0.0

    bands = {}
    qualifying = []
    for width in MARGIN_CANDIDATES:
        in_band = np.abs(y_proba - chosen_threshold) <= width
        n = int(in_band.sum())
        band_rate = float(disagreement[in_band].mean()) if n > 0 else None
        ratio = (band_rate / overall_rate) if (band_rate is not None and overall_rate > 0) else None
        elevated = bool(
            n >= MIN_BAND_SAMPLE and ratio is not None and ratio >= ELEVATION_RATIO
        )
        bands[str(width)] = {
            "width": width,
            "sampleSize": n,
            "disagreementRate": round(band_rate, 4) if band_rate is not None else None,
            "ratioToOverall": round(ratio, 3) if ratio is not None else None,
            "meaningfullyElevated": elevated,
        }
        if elevated:
            qualifying.append(width)

    chosen_width = min(qualifying) if qualifying else max(MARGIN_CANDIDATES)
    chosen_reason = (
        f"Narrowest band (+/-{chosen_width}) clearing both the {ELEVATION_RATIO}x elevation "
        f"bar and the {MIN_BAND_SAMPLE}-case minimum sample size."
        if qualifying
        else (
            f"No band cleared the {ELEVATION_RATIO}x elevation bar with at least "
            f"{MIN_BAND_SAMPLE} cases — defaulted to the widest candidate "
            f"(+/-{chosen_width}) rather than under-cover genuinely uncertain cases."
        )
    )

    return {
        "overallDisagreementRate": round(overall_rate, 4),
        "bands": bands,
        "chosenMargin": chosen_width,
        "rationale": chosen_reason,
    }


def pick_high_value_cutoff(full_dataset_amounts):
    cutoff = float(np.percentile(full_dataset_amounts, 90))
    return {
        "value": int(round(cutoff)),
        "percentile": 90,
        "datasetSize": int(len(full_dataset_amounts)),
        "rationale": (
            "90th percentile of dispute amounts across the full labeled dataset "
            "(not just the held-out test split) — disputes above this cutoff are "
            "the top 10% by value, where a wrong auto-decision is "
            "disproportionately costly, so they're routed to a human regardless "
            "of confidence score."
        ),
    }


def main():
    df = load_dataset()
    pipeline, feature_cols = build_pipeline()

    X = df[feature_cols + ["disputeId", "razorpayId"]]
    y = df["groundTruthDefensible"]

    # Identical split to train_classifier.py — same test_size, stratify,
    # random_state — so this sweep's test set IS that script's test set.
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, stratify=y, random_state=42
    )

    pipeline.fit(X_train[feature_cols], y_train)
    y_proba = pipeline.predict_proba(X_test[feature_cols])[:, 1]

    test_amounts = X_test["amount"].reset_index(drop=True).to_numpy()
    y_test_arr = y_test.reset_index(drop=True).to_numpy()

    sweep_rows = sweep_thresholds(y_test_arr, y_proba, test_amounts)
    best = pick_best_threshold(sweep_rows)

    margin_analysis = pick_margin(y_test_arr, y_proba, best["threshold"])
    high_value_cutoff = pick_high_value_cutoff(df["amount"].to_numpy())

    # Same spirit as train_classifier.py's dataset-size/imbalance warnings —
    # flag when the sweep result itself looks degenerate rather than let a
    # clean-looking JSON hide it. Two known failure modes:
    #  1. Several thresholds tying on totalCost (recall collapses to 0 for
    #     all of them) means the model's predicted probabilities barely
    #     range above the tie point — the "minimum" is really "first of a
    #     flat plateau," not a real optimum.
    #  2. predict_proba rarely reaching the top of the swept range at all
    #     suggests the underlying features carry little signal relative to
    #     ground truth — worth knowing before trusting the chosen threshold.
    warnings = []
    tied_at_best = [r["threshold"] for r in sweep_rows if r["totalCost"] == best["totalCost"]]
    if len(tied_at_best) > 1:
        warnings.append(
            f"{len(tied_at_best)} thresholds ({', '.join(str(t) for t in tied_at_best)}) tie for the "
            f"lowest total cost ({best['totalCost']}) — recall is 0 at every one of them, so this isn't "
            "a real optimum, it's the point where the model stops predicting 'defensible' at all. "
            "Usually means the swept feature set has weak signal relative to how groundTruthDefensible "
            "was actually generated — see docs/threshold-rationale.md."
        )
    max_proba = float(y_proba.max()) if len(y_proba) else 0.0
    if max_proba < 0.75:
        warnings.append(
            f"Highest predicted probability on the test set is {max_proba:.3f} — predictions rarely "
            "reach high confidence in either direction, consistent with weak feature signal."
        )

    results = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "datasetSize": int(len(df)),
        "testSetSize": int(len(y_test)),
        "chargebackFee": CHARGEBACK_FEE,
        "sweep": sweep_rows,
        "chosenConfidenceThreshold": {
            "value": best["threshold"],
            "totalCost": best["totalCost"],
            "precision": best["precision"],
            "recall": best["recall"],
            "rationale": (
                f"Of the {len(THRESHOLD_CANDIDATES)} candidate thresholds swept "
                f"(0.50-0.90 in steps of 0.05), {best['threshold']} minimizes total "
                f"cost (falsePositiveCost + falseNegativeCost, amount + "
                f"CHARGEBACK_FEE per false positive) at {best['totalCost']} on the "
                "held-out test set — not the threshold with the best F1 or "
                "accuracy alone, since cost is what actually matters here."
            ),
        },
        "riskBandMargin": margin_analysis,
        "highValueCutoff": high_value_cutoff,
        "warnings": warnings,
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)

    for w in warnings:
        print(f"WARNING: {w}")
    print(f"Swept {len(THRESHOLD_CANDIDATES)} threshold candidates on {len(y_test)} held-out test cases.")
    print(f"Chosen CONFIDENCE_THRESHOLD: {best['threshold']} (total cost {best['totalCost']})")
    print(f"Chosen RISK_BAND_MARGIN: +/-{margin_analysis['chosenMargin']}")
    print(f"Chosen HIGH_VALUE_CUTOFF: {high_value_cutoff['value']} (90th percentile of {high_value_cutoff['datasetSize']} disputes)")
    print(f"\nWrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
