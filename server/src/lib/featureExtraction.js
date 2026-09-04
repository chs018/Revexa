// Canonical definition of a dispute's ML features — shared by
// scripts/export-dataset.js (writes the training CSV) and
// lib/mlClassifier.js (predicts live, in JS, using coefficients trained on
// that same CSV). Both derive features through this one function so they
// can never drift apart on what a "feature" means or how it's computed.
//
// Engineered features (logAmount, hasPriorRefund) are computed HERE, once —
// scripts/ml/train_classifier.py reads them straight out of the CSV rather
// than recomputing its own copy of these formulas in Python.
function extractFeatures({ reasonCode, amount, currency, deliveryStatus, priorRefundCount, ipMatch, billingAddressMatch }) {
  return {
    reasonCode,
    amount,
    currency,
    deliveryStatus,
    priorRefundCount,
    ipMatch: !!ipMatch,
    billingAddressMatch: !!billingAddressMatch,
    logAmount: Math.log(amount + 1),
    hasPriorRefund: priorRefundCount > 0,
  };
}

module.exports = { extractFeatures };
