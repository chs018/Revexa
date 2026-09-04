// PART A: the baseline classifier's live prediction path — pure JS, no
// Python at request time. Reads server/data/ml-model-coefficients.json
// (written by scripts/ml/train_classifier.py) and replicates the exact
// fitted LogisticRegression: the same StandardScaler mean/scale for
// numeric features, the same OneHotEncoder categories for categorical
// ones, applied to the SAME feature definition lib/featureExtraction.js
// gives the training CSV.
const fs = require('fs');
const path = require('path');
const { extractFeatures } = require('./featureExtraction');

const COEFFICIENTS_PATH = path.join(__dirname, '..', '..', 'data', 'ml-model-coefficients.json');

function sigmoid(z) {
  return 1 / (1 + Math.exp(-z));
}

function isValidCoefficients(c) {
  return (
    c &&
    Array.isArray(c.numericFeatures) &&
    c.numericScaling &&
    Array.isArray(c.numericScaling.mean) &&
    Array.isArray(c.numericScaling.scale) &&
    Array.isArray(c.numericCoefficients) &&
    c.numericFeatures.length === c.numericScaling.mean.length &&
    c.numericFeatures.length === c.numericScaling.scale.length &&
    c.numericFeatures.length === c.numericCoefficients.length &&
    Array.isArray(c.booleanFeatures) &&
    Array.isArray(c.booleanCoefficients) &&
    c.booleanFeatures.length === c.booleanCoefficients.length &&
    c.categoricalFeatures &&
    typeof c.categoricalFeatures === 'object' &&
    typeof c.intercept === 'number'
  );
}

// Cached after first successful read — re-read only if the file's mtime
// changes, so a fresh `python train_classifier.py` run is picked up
// without a server restart, but every other prediction is a cheap
// in-memory lookup, not a disk read.
let cache = null; // { mtimeMs, coefficients } | null
let loggedMissing = false;

function loadCoefficients() {
  let stat;
  try {
    stat = fs.statSync(COEFFICIENTS_PATH);
  } catch {
    if (!loggedMissing) {
      console.log('[mlClassifier] No ml-model-coefficients.json found — classifier disagreement check is disabled until one is trained.');
      loggedMissing = true;
    }
    return null;
  }

  if (cache && cache.mtimeMs === stat.mtimeMs) {
    return cache.coefficients;
  }

  try {
    const raw = fs.readFileSync(COEFFICIENTS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!isValidCoefficients(parsed)) {
      console.warn('[mlClassifier] ml-model-coefficients.json exists but failed shape validation — treating as absent.');
      cache = { mtimeMs: stat.mtimeMs, coefficients: null };
      return null;
    }
    cache = { mtimeMs: stat.mtimeMs, coefficients: parsed };
    loggedMissing = false;
    return parsed;
  } catch (err) {
    console.warn(`[mlClassifier] Failed to read/parse ml-model-coefficients.json — treating as absent: ${err.message}`);
    cache = { mtimeMs: stat.mtimeMs, coefficients: null };
    return null;
  }
}

// ColumnTransformer concatenates blocks in declaration order (num, bool,
// cat) — ../scripts/ml/train_classifier.py slices classifier.coef_ the
// same way when exporting, so re-summing per-block here (rather than
// parsing sklearn's internal feature-name strings) is exact and doesn't
// depend on knowing sklearn's naming convention at all.
function computeLinearCombination(features, coefficients) {
  const { numericFeatures, numericScaling, numericCoefficients, booleanFeatures, booleanCoefficients, categoricalFeatures, intercept } =
    coefficients;

  let z = intercept;

  numericFeatures.forEach((name, i) => {
    const raw = Number(features[name]);
    const mean = numericScaling.mean[i];
    const scale = numericScaling.scale[i];
    const scaled = scale !== 0 ? (raw - mean) / scale : 0;
    z += scaled * numericCoefficients[i];
  });

  booleanFeatures.forEach((name, i) => {
    z += (features[name] ? 1 : 0) * booleanCoefficients[i];
  });

  // One-hot: exactly one category (if seen during training) contributes
  // its coefficient; an unseen category contributes 0 — the same behavior
  // as sklearn's OneHotEncoder(handle_unknown="ignore").
  for (const [name, block] of Object.entries(categoricalFeatures)) {
    const value = features[name];
    const idx = block.categories.indexOf(value);
    if (idx !== -1) {
      z += block.coefficients[idx];
    }
  }

  return z;
}

/**
 * predictClassifier(rawFeatures): rawFeatures is
 * { reasonCode, amount, currency, deliveryStatus, priorRefundCount, ipMatch, billingAddressMatch }
 * — the same fields ensureTransactionContext()/the Dispute row already
 * provide, no separate lookup needed.
 *
 * Returns { score, verdict } in the same shape riskScorer.js produces
 * (verdict is "defensible" | "not_defensible", the classifier's own call at
 * its natural 0.5 decision boundary — independent of CONFIDENCE_THRESHOLD,
 * which is purely a pipeline ROUTING concern, same relationship the LLM's
 * own verdict field already has to that threshold).
 *
 * Returns null — NEVER throws — if the coefficients file doesn't exist,
 * fails validation, or anything else goes wrong. Callers (pipeline.js) must
 * treat null as "skip this check, fall through to existing behavior
 * unchanged" — this is the fail-open contract the whole feature depends on.
 */
function predictClassifier(rawFeatures) {
  const coefficients = loadCoefficients();
  if (!coefficients) return null;

  try {
    const features = extractFeatures(rawFeatures);
    const z = computeLinearCombination(features, coefficients);
    const score = sigmoid(z);
    const verdict = score >= 0.5 ? 'defensible' : 'not_defensible';
    return { score, verdict };
  } catch (err) {
    console.warn(`[mlClassifier] predictClassifier failed, treating as absent: ${err.message}`);
    return null;
  }
}

module.exports = { predictClassifier };
