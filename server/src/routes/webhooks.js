const express = require('express');
const { verifyAndIngestDisputeWebhook } = require('../lib/webhookIngest');

const router = express.Router();

// IMPORTANT: express.raw(), not express.json(), scoped to just this route.
// Signature verification needs the exact bytes Razorpay sent — parsing to a
// JS object and re-stringifying can produce different bytes (key order,
// spacing) and break the HMAC check unpredictably.
router.post('/razorpay', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const rawBody = req.body.toString('utf8');

  const result = await verifyAndIngestDisputeWebhook(rawBody, signature);

  res.status(result.status).json(result.body);
});

module.exports = router;
