const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

// Written by scripts/ml/train_classifier.py — see server/data/ml-metrics.json
// and the README for how to regenerate it.
const ML_METRICS_PATH = path.join(__dirname, '..', '..', 'data', 'ml-metrics.json');

// GET /metrics-ml — a static file read, nothing more. No Python process
// runs in production; this just serves whatever the offline training script
// last wrote. Deliberately a separate file/route from GET /metrics
// (disputes.js, the Gemini-based riskScorer's grading) rather than added
// alongside it, so the two stay obviously independent — this classifier is
// its own thing, not a variant of the LLM agent's evaluation.
router.get('/metrics-ml', (req, res) => {
  let raw;
  try {
    raw = fs.readFileSync(ML_METRICS_PATH, 'utf8');
  } catch (err) {
    return res.status(404).json({
      error: 'not_found',
      message: 'No ml-metrics.json found yet — run scripts/ml/train_classifier.py first (see README).',
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return res.status(500).json({ error: 'invalid_json', message: 'ml-metrics.json exists but is not valid JSON.' });
  }

  res.json(parsed);
});

module.exports = router;
