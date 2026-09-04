const express = require('express');
const crypto = require('crypto');
const { signPayload } = require('../lib/razorpaySign');
const { verifyAndIngestDisputeWebhook } = require('../lib/webhookIngest');
const razorpay = require('../lib/razorpayClient');

const router = express.Router();

const REASON_CODES = [
  'goods_not_received',
  'unauthorized_transaction',
  'duplicate_charge',
  'product_not_as_described',
];

const AMOUNTS = [49900, 99900, 149900, 249900, 499900, 999900]; // paise
const CURRENCIES = ['INR', 'INR', 'INR', 'USD']; // mostly INR, occasional USD

// Day 6: how likely a dispute with this reason code is to be genuinely
// defensible in our synthetic world — loosely realistic (e.g. "duplicate
// charge" is often provable from the merchant's own records, "unauthorized
// transaction" is often genuine fraud and hard to fight), and deliberately
// not a clean 50/50 or a 1:1 match with confidenceScore, so the confusion
// matrix ends up with a meaningful mix of all four cells instead of a
// diagonal. This is ground truth, generated independently of anything the
// risk scorer sees — see the groundTruthDefensible comment in schema.prisma.
const GROUND_TRUTH_DEFENSIBLE_RATE = {
  goods_not_received: 0.45,
  unauthorized_transaction: 0.35,
  duplicate_charge: 0.65,
  product_not_as_described: 0.5,
};

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function randomBool(pTrue) {
  return Math.random() < pTrue;
}

function generateGroundTruth(reasonCode) {
  const rate = GROUND_TRUTH_DEFENSIBLE_RATE[reasonCode] ?? 0.5;
  return randomBool(rate);
}

function randomRazorpayId(prefix) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 14; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${prefix}_${id}`;
}

/**
 * Builds a synthetic event in the same shape Razorpay sends for a
 * payment.dispute.created webhook. All overrides are optional:
 * `razorpayId` (e.g. to test the idempotency path by reusing an id across
 * two requests), and — Razorpay buildathon integration —
 * `paymentId`/`amount`/`currency`/`reasonCode`, used by
 * POST /demo/record-real-payment to back a synthetic dispute with a
 * genuine Razorpay test-mode payment instead of a fabricated one.
 * Anything not overridden is generated exactly as before.
 */
function buildSyntheticDisputePayload(overrides = {}) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const disputeId = overrides.razorpayId || randomRazorpayId('disp');
  const amount = overrides.amount ?? pick(AMOUNTS);

  return {
    entity: 'event',
    account_id: 'acc_DemoAccount000',
    event: 'payment.dispute.created',
    contains: ['dispute'],
    payload: {
      dispute: {
        entity: {
          id: disputeId,
          entity: 'dispute',
          payment_id: overrides.paymentId || randomRazorpayId('pay'),
          amount,
          currency: overrides.currency || pick(CURRENCIES),
          amount_deducted: amount,
          reason_code: overrides.reasonCode || pick(REASON_CODES),
          respond_by: nowSeconds + 7 * 24 * 60 * 60,
          status: 'open',
          phase: 'chargeback',
          created_at: nowSeconds,
        },
      },
    },
    created_at: nowSeconds,
  };
}

// Generates a realistic, self-signed dispute-created event and runs it
// through the exact same verify -> parse -> idempotency -> write logic as a
// real Razorpay webhook delivery (see lib/webhookIngest.js). Lets you exercise
// the whole pipeline without Razorpay's dashboard or a tunnel.
//
// Optional body: { "razorpayId": "disp_...", "reasonCode": "...", "amount":
// 149900, "currency": "INR" } — buildSyntheticDisputePayload already
// supports all four, this route just wasn't forwarding the last three.
// Anything omitted is still picked at random exactly as before, so existing
// callers (no body, or just { razorpayId }) are unaffected.
router.post('/trigger-dispute', async (req, res) => {
  const overrideId = req.body && req.body.razorpayId;
  const { reasonCode: reasonCodeOverride, amount: amountOverride, currency: currencyOverride } = req.body || {};

  if (reasonCodeOverride && !REASON_CODES.includes(reasonCodeOverride)) {
    return res.status(400).json({
      error: 'invalid_reason_code',
      message: `reasonCode must be one of: ${REASON_CODES.join(', ')}`,
    });
  }

  const payload = buildSyntheticDisputePayload({
    razorpayId: overrideId,
    reasonCode: reasonCodeOverride,
    amount: amountOverride,
    currency: currencyOverride,
  });
  const rawBody = JSON.stringify(payload);
  const signature = signPayload(rawBody);

  // Ground truth is a property of this synthetic dispute, decided here at
  // creation time — independent of, and never passed to, the risk scorer.
  // Threaded through as an option rather than written directly, since
  // verifyAndIngestDisputeWebhook is shared with the real webhook route,
  // which has no ground truth to give it.
  const reasonCode = payload.payload.dispute.entity.reason_code;
  const groundTruthDefensible = generateGroundTruth(reasonCode);

  const result = await verifyAndIngestDisputeWebhook(rawBody, signature, { groundTruthDefensible });

  res.status(result.status).json({ ...result.body, synthetic: payload, groundTruthDefensible });
});

// --- Razorpay buildathon integration -------------------------------------
// Two routes that make a dispute traceable to a REAL Razorpay test-mode
// payment, not a fabricated pay_xxx string: create a real Order, let the
// client complete real Razorpay Checkout against it, then record the real
// payment as a synthetic-but-backed dispute through the exact same
// verify -> parse -> idempotency -> write path every other dispute uses.

// POST /demo/create-order — creates a genuine Razorpay test-mode Order via
// the real Orders API (razorpay.orders.create). Returns what the client
// needs to open Razorpay Checkout against it. amount/currency default to
// the same synthetic ranges trigger-dispute already uses, so a demo
// dispute's amount looks the same whether it's backed by a real payment or
// not.
router.post('/create-order', async (req, res) => {
  const amount = req.body?.amount ?? pick(AMOUNTS);
  const currency = req.body?.currency || 'INR';

  try {
    const order = await razorpay.orders.create({
      amount,
      currency,
      receipt: `revexa_demo_${Date.now()}`,
    });
    res.json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId: process.env.RAZORPAY_KEY_ID });
  } catch (err) {
    console.error('Failed to create Razorpay order:', err);
    res.status(502).json({ error: 'razorpay_order_failed', message: err.error?.description || err.message });
  }
});

// POST /demo/record-real-payment — called after Razorpay Checkout succeeds
// client-side. Verifies the payment signature Razorpay's own docs specify
// (HMAC-SHA256 of "order_id|payment_id" under RAZORPAY_KEY_SECRET — the
// same family of check razorpaySign.js already does for webhooks, just a
// different formula for this different Razorpay security scheme), re-fetches
// the order server-side rather than trusting client-supplied amount/currency,
// then builds a synthetic dispute-created event carrying the REAL payment_id
// and runs it through the same verifyAndIngestDisputeWebhook every other
// dispute uses — this is genuinely real data flowing through the ordinary
// path, not a special case.
router.post('/record-real-payment', async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, reasonCode } = req.body || {};

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'invalid_payload', message: 'Missing Razorpay Checkout response fields.' });
  }

  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (expectedSignature !== razorpay_signature) {
    return res.status(400).json({ error: 'invalid_signature', message: 'Razorpay Checkout payment signature did not verify.' });
  }

  let order;
  try {
    order = await razorpay.orders.fetch(razorpay_order_id);
  } catch (err) {
    return res.status(502).json({ error: 'razorpay_order_fetch_failed', message: err.error?.description || err.message });
  }

  const payload = buildSyntheticDisputePayload({
    paymentId: razorpay_payment_id,
    amount: order.amount,
    currency: order.currency,
    reasonCode: REASON_CODES.includes(reasonCode) ? reasonCode : undefined,
  });
  const rawBody = JSON.stringify(payload);
  const signature = signPayload(rawBody);

  const finalReasonCode = payload.payload.dispute.entity.reason_code;
  const groundTruthDefensible = generateGroundTruth(finalReasonCode);

  const result = await verifyAndIngestDisputeWebhook(rawBody, signature, { groundTruthDefensible });

  res.status(result.status).json({
    ...result.body,
    synthetic: payload,
    groundTruthDefensible,
    razorpayPaymentId: razorpay_payment_id,
  });
});

module.exports = router;
