const prisma = require('./prisma');
const { verifySignature } = require('./razorpaySign');
const { runScoringPipeline } = require('../agents/pipeline');
const geminiLimiter = require('./limiter');
const { emitDisputeUpdate } = require('./socket');

const SLA_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Pulls the fields we care about out of a Razorpay-shaped dispute webhook
 * event: { event: 'payment.dispute.created', payload: { dispute: { entity: {...} } } }
 */
function extractDisputeFields(event) {
  const entity = event && event.payload && event.payload.dispute && event.payload.dispute.entity;
  if (!entity || !entity.id) return null;

  return {
    razorpayId: entity.id,
    amount: entity.amount,
    currency: entity.currency || 'INR',
    reasonCode: entity.reason_code,
    // Razorpay buildathon integration: persisted so later steps (evidence
    // enrichment via the real Payments API, contest submission) can look it
    // up. Present on every real Razorpay webhook payload already
    // (payload.dispute.entity.payment_id) — this just stops discarding it.
    paymentId: entity.payment_id || null,
  };
}

/**
 * Core ingestion logic shared by the real webhook route (routes/webhooks.js)
 * and the synthetic demo route (routes/demo.js). Both hand this the same two
 * things a real Razorpay delivery gives us: the raw JSON body (string) and
 * the signature that's supposed to cover it — so a self-signed synthetic
 * event goes through exactly the same verification + idempotency + write
 * path as a genuine webhook.
 *
 * Does NOT throw — always resolves to a { ok, status, body } result the
 * caller can send straight back as the HTTP response.
 *
 * `options.groundTruthDefensible` (Day 6): only ever passed by the demo
 * synthetic-trigger route, which is the only caller that actually knows
 * "what really happened". The real webhook route calls this with no
 * options, so genuine Razorpay-sourced disputes correctly get no ground
 * truth label — we have no way of knowing the true outcome in advance.
 */
async function verifyAndIngestDisputeWebhook(rawBody, signature, options = {}) {
  if (!signature || !verifySignature(rawBody, signature)) {
    return { ok: false, status: 400, body: { error: 'invalid_signature' } };
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (err) {
    return { ok: false, status: 400, body: { error: 'invalid_json' } };
  }

  const fields = extractDisputeFields(event);
  if (!fields || fields.amount == null || !fields.reasonCode) {
    return { ok: false, status: 400, body: { error: 'invalid_payload' } };
  }

  // Idempotency check: Razorpay retries webhook delivery on timeout, so the
  // same event can arrive more than once. If we've already recorded this
  // dispute, ack it and stop — no further writes.
  const existing = await prisma.dispute.findUnique({
    where: { razorpayId: fields.razorpayId },
  });

  if (existing) {
    return {
      ok: true,
      status: 200,
      body: { received: true, duplicate: true, disputeId: existing.id },
    };
  }

  const now = new Date();

  const dispute = await prisma.dispute.create({
    data: {
      razorpayId: fields.razorpayId,
      amount: fields.amount,
      currency: fields.currency,
      reasonCode: fields.reasonCode,
      status: 'new',
      slaDeadline: new Date(now.getTime() + SLA_WINDOW_MS),
      createdAt: now,
      groundTruthDefensible: options.groundTruthDefensible ?? null,
      razorpayPaymentId: fields.paymentId,
    },
  });

  await prisma.auditLog.create({
    data: {
      disputeId: dispute.id,
      actor: 'system',
      action: 'dispute_created',
      reasoning: null,
    },
  });

  emitDisputeUpdate(dispute, 'dispute_created');

  // Fire-and-forget: score + (maybe) draft evidence for this dispute without
  // blocking the webhook response. Don't await it here — Razorpay expects a
  // fast 200, and the scoring/drafting pipeline makes LLM calls that can
  // take seconds. runScoringPipeline() never throws on its own (riskScorer
  // and evidenceAgent both catch their own failures into needs_attention),
  // but this .catch is a backstop against an unhandled rejection taking the
  // process down if something upstream of that still slips through.
  //
  // Wrapped in the shared geminiLimiter (Day 4) so a batch of disputes
  // arriving close together (e.g. Day 7's bulk trigger) doesn't fire dozens
  // of concurrent Gemini calls at once — at most 5 of these run at a time,
  // the rest queue and start as earlier ones finish.
  geminiLimiter(() => runScoringPipeline(dispute.id)).catch((err) => {
    console.error(`Scoring pipeline crashed for dispute ${dispute.id}:`, err);
  });

  return {
    ok: true,
    status: 200,
    body: { received: true, duplicate: false, disputeId: dispute.id },
  };
}

module.exports = { verifyAndIngestDisputeWebhook, extractDisputeFields };
