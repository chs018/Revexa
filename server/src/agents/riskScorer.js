const prisma = require('../lib/prisma');
const defaultAi = require('../lib/gemini');
const { withRetry } = require('../lib/retry');
const { ensureTransactionContext } = require('../lib/transactionContext');
const { emitDisputeUpdate } = require('../lib/socket');
const { fetchRealPaymentRecord } = require('../lib/razorpayPayment');

// gemini-2.5-flash (the model named in the original spec) returns a hard 404
// for new API keys as of this build — "no longer available to new users",
// per Google's own error message, which names this as the replacement.
const MODEL = 'gemini-3.6-flash';

const VALID_VERDICTS = ['defensible', 'not_defensible'];
const VALID_DIRECTIONS = ['supports', 'weakens'];
const VALID_WEIGHTS = ['high', 'medium', 'low'];

// Razorpay buildathon integration: when this dispute is backed by a real
// Razorpay test-mode payment (dispute.razorpayPaymentId set), the actual
// Payments API record — fetched live, not synthetic — is appended as its
// own clearly-labeled section, distinct from the always-synthetic
// transaction context above it, so the model (and anyone reading the
// prompt) can tell which facts are genuinely real.
function formatRealPaymentRecord(record) {
  if (!record) return '';
  return `

Real Razorpay payment record (fetched live via the Payments API, not synthetic):
- Payment id: ${record.id}
- Status: ${record.status}${record.captured ? ' (captured)' : ' (not captured)'}
- Method: ${record.method}
- Amount refunded so far: ${record.amountRefunded}
- Contact on file: ${record.contact || 'N/A'}
- Created: ${record.createdAt}`;
}

function buildPrompt(dispute, context, realPaymentRecord) {
  return `You are a chargeback risk-scoring assistant for a merchant using Razorpay.

Assess whether this dispute is defensible (winnable if the merchant submits evidence) based on the transaction details below.

Dispute:
- Reason code: ${dispute.reasonCode}
- Amount: ${dispute.amount} ${dispute.currency} (smallest currency unit, e.g. paise)
- Razorpay dispute id: ${dispute.razorpayId}

Transaction context:
- Delivery status: ${context.deliveryStatus}
- Prior refunds issued to this customer: ${context.priorRefundCount}
- Billing address matches the address on file: ${context.billingAddressMatch}
- IP address matches this customer's prior known-good orders: ${context.ipMatch}
${formatRealPaymentRecord(realPaymentRecord)}

Respond with ONLY a JSON object matching this exact shape, no other text, no markdown fences:
{
  "score": <float between 0 and 1, your confidence the merchant can win this dispute>,
  "verdict": "defensible" | "not_defensible",
  "signals": [
    { "factor": "<plain language factor name>", "direction": "supports" | "weakens", "weight": "high" | "medium" | "low" }
  ],
  "summary": "<one plain-language sentence summarizing the assessment>"
}

List 2-4 signals that most influenced your score. Each "factor" must name a specific fact from the transaction context above (e.g. "delivery not confirmed", "no prior refund history") — not a generic statement.`;
}

function validateResult(result) {
  if (typeof result !== 'object' || result === null) {
    throw new Error('Risk scorer response is not a JSON object');
  }
  if (typeof result.score !== 'number' || Number.isNaN(result.score) || result.score < 0 || result.score > 1) {
    throw new Error(`Risk scorer returned an invalid score: ${JSON.stringify(result.score)}`);
  }
  if (!VALID_VERDICTS.includes(result.verdict)) {
    throw new Error(`Risk scorer returned an invalid verdict: ${JSON.stringify(result.verdict)}`);
  }
  if (!Array.isArray(result.signals) || result.signals.length === 0) {
    throw new Error('Risk scorer returned no signals');
  }
  for (const signal of result.signals) {
    if (!signal || typeof signal.factor !== 'string' || !signal.factor.trim()) {
      throw new Error(`Risk scorer returned a signal with an invalid factor: ${JSON.stringify(signal)}`);
    }
    if (!VALID_DIRECTIONS.includes(signal.direction)) {
      throw new Error(`Risk scorer returned an invalid signal direction: ${JSON.stringify(signal)}`);
    }
    if (!VALID_WEIGHTS.includes(signal.weight)) {
      throw new Error(`Risk scorer returned an invalid signal weight: ${JSON.stringify(signal)}`);
    }
  }
  if (typeof result.summary !== 'string' || !result.summary.trim()) {
    throw new Error('Risk scorer returned an empty summary');
  }
}

async function callGemini(dispute, context, realPaymentRecord, ai) {
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: buildPrompt(dispute, context, realPaymentRecord),
    config: {
      responseMimeType: 'application/json',
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error('Gemini returned an empty response');
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`Gemini response was not valid JSON: ${err.message}`);
  }

  validateResult(parsed);
  return parsed;
}

/**
 * Scores a dispute's defensibility with Gemini. On success: persists
 * confidenceScore, writes a "scored" AuditLog row with the raw JSON result,
 * and returns { score, verdict, signals, summary, context }.
 *
 * On failure (every retry attempt exhausted): sets the dispute to
 * "needs_attention", writes a "scoring_failed" AuditLog row with the error
 * message, and returns null. Never throws — callers don't need a try/catch.
 *
 * `ai` (Part B, point 8): the Gemini client, injectable rather than always
 * the shared singleton — defaults to the real one, so every production
 * call site is unchanged, but tests can pass a mock
 * `{ models: { generateContent: jest.fn() } }` to get deterministic LLM
 * responses instead of hitting the real API.
 */
async function scoreDispute(disputeId, { ai = defaultAi } = {}) {
  const dispute = await prisma.dispute.findUnique({ where: { id: disputeId } });
  if (!dispute) {
    throw new Error(`scoreDispute: dispute ${disputeId} not found`);
  }

  const context = await ensureTransactionContext(dispute);
  // Razorpay buildathon integration: null for every dispute except ones
  // created through POST /demo/record-real-payment — fetchRealPaymentRecord
  // never throws, so a missing paymentId or a failed API call both just
  // fall through to "no real record," not a scoring failure.
  const realPaymentRecord = await fetchRealPaymentRecord(dispute.razorpayPaymentId);
  const attempts = Number(process.env.MAX_RETRY_ATTEMPTS) || 3;

  try {
    const result = await withRetry(() => callGemini(dispute, context, realPaymentRecord, ai), { attempts });

    // Live Activity feed rework: status: "scored" was always a defined
    // DisputeStatus enum value (and statusStyles.js already had display
    // copy for it — "Risk scored") but nothing in this pipeline ever
    // actually set it; the dispute jumped straight from "new" to whatever
    // pipeline.js's routing decided next, so "a risk score was just
    // produced" was never its own visible moment, only inferable after the
    // fact from the next status change. Setting it here, and emitting
    // right away, makes it one — pipeline.js's own follow-up update
    // (drafted/lost/pending_review) fires its own separate emit moments
    // later in the same request, so a viewer genuinely sees two distinct
    // events in quick succession, not one collapsed into the other.
    const scoredDispute = await prisma.dispute.update({
      where: { id: dispute.id },
      data: { confidenceScore: result.score, status: 'scored' },
    });

    await prisma.auditLog.create({
      data: {
        disputeId: dispute.id,
        actor: 'risk_scorer',
        action: 'scored',
        reasoning: JSON.stringify(result),
      },
    });

    emitDisputeUpdate(scoredDispute, 'scored');

    return { ...result, context, realPaymentRecord };
  } catch (err) {
    const updatedDispute = await prisma.dispute.update({
      where: { id: dispute.id },
      data: { status: 'needs_attention' },
    });

    await prisma.auditLog.create({
      data: {
        disputeId: dispute.id,
        actor: 'system',
        action: 'scoring_failed',
        reasoning: err.message,
      },
    });

    emitDisputeUpdate(updatedDispute, 'scoring_failed');

    return null;
  }
}

module.exports = { scoreDispute };
