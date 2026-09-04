require('dotenv').config();

// Seeds FIVE PERMANENT, demo-ready disputes so a live walkthrough always
// has something to click into, independent of Gemini quota:
//   1. A genuinely CE 3.0-qualifying unauthorized_transaction dispute,
//      honestly cited -> EvidencePacket.verificationStatus: "verified".
//   2. A goods_not_received dispute where the (simulated) model cited
//      Proof of Delivery despite deliveryConfirmation.status being
//      "not_delivered" -> verificationStatus: "flagged", with the warning
//      banner visible in the UI.
//   3. A dispute where the (simulated) LLM says "defensible" but the REAL
//      trained baseline classifier (not mocked — predictClassifier() runs
//      for real against server/data/ml-model-coefficients.json) says
//      "not_defensible", because of a deliberately huge amount alongside
//      otherwise-clean signals -> status: "pending_review", reason:
//      "model_disagreement". Deterministic and reproducible on every
//      machine that has ever run scripts/ml/train_classifier.py, since the
//      classifier side is a pure function of its inputs, not an LLM call.
//   4. A dispute scored right inside the CONFIDENCE_THRESHOLD ±
//      RISK_BAND_MARGIN band -> status: "pending_review", the plain
//      score-proximity string reasoning (not JSON) — the original,
//      simplest guardrail rule, shown alongside #3's newer, more specific
//      one so both pending_review routes are demoable side by side.
//   5. A dispute where the (simulated) Gemini call fails every retry ->
//      status: "needs_attention", a real "scoring_failed" AuditLog entry
//      with the actual thrown error message — the "automation broke, a
//      human needs to look" state, distinct from a genuine "not
//      defensible" verdict.
// Uses the same monkey-patch-Gemini technique as scripts/test-*.js (and, for
// #3-#5, riskScorer.js/pipeline.js's injectable-ai parameter) — none of
// these make a real Gemini call. Does NOT clean up afterward — these are
// meant to stay in the DB for the demo. Rerunning this script is safe: each
// scenario deletes and recreates its own dispute by a fixed razorpayId, so
// reruns refresh cleanly.
const prisma = require('../src/lib/prisma');
const ai = require('../src/lib/gemini');
const { draftEvidence } = require('../src/agents/evidenceAgent');
const { checkCe3Qualification } = require('../src/lib/ce3Qualification');
const { runScoringPipeline } = require('../src/agents/pipeline');

const CE3_RAZORPAY_ID = 'disp_DEMOCE3QUALIFIES01';
const FLAGGED_RAZORPAY_ID = 'disp_DEMOFLAGGEDCASE01';
const DISAGREEMENT_RAZORPAY_ID = 'disp_DEMODISAGREEMENT01';
const PENDING_REVIEW_RAZORPAY_ID = 'disp_DEMOPENDINGREVIEW01';
const NEEDS_ATTENTION_RAZORPAY_ID = 'disp_DEMONEEDSATTENTION01';

// Shared by scenarios 4 and 5 — both start from a plain "new" dispute and
// drive it through the real runScoringPipeline() with a mocked ai client,
// same pattern scenario 3 already established. Deletes any prior row with
// this razorpayId first, same clean-slate-on-rerun contract as
// createAndDraft() above.
async function createAndScore({ razorpayId, amount, reasonCode, deliveryStatus, mockAi }) {
  const existing = await prisma.dispute.findUnique({ where: { razorpayId } });
  if (existing) {
    await prisma.auditLog.deleteMany({ where: { disputeId: existing.id } });
    await prisma.evidencePacket.deleteMany({ where: { disputeId: existing.id } });
    await prisma.dispute.delete({ where: { id: existing.id } });
  }

  const dispute = await prisma.dispute.create({
    data: {
      razorpayId,
      amount,
      currency: 'INR',
      reasonCode,
      status: 'new',
      slaDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      deliveryStatus,
      priorRefundCount: 1,
      ipMatch: true,
      billingAddressMatch: false,
    },
  });

  const result = await runScoringPipeline(dispute.id, { ai: mockAi });
  const updated = await prisma.dispute.findUnique({ where: { id: dispute.id } });
  console.log(`${razorpayId} -> dispute ${dispute.id}, status: ${updated.status}`);
  return { dispute: updated, result };
}

async function createAndDraft({ razorpayId, reasonCode, evidenceContext, deliveryStatus, signals, geminiResponse }) {
  // Clean slate on rerun.
  const existing = await prisma.dispute.findUnique({ where: { razorpayId } });
  if (existing) {
    await prisma.auditLog.deleteMany({ where: { disputeId: existing.id } });
    await prisma.evidencePacket.deleteMany({ where: { disputeId: existing.id } });
    await prisma.dispute.delete({ where: { id: existing.id } });
  }

  const dispute = await prisma.dispute.create({
    data: {
      razorpayId,
      amount: 149900,
      currency: 'INR',
      reasonCode,
      status: 'drafted',
      slaDeadline: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      deliveryStatus,
      priorRefundCount: 0,
      ipMatch: true,
      billingAddressMatch: true,
      groundTruthDefensible: true,
      evidenceContext,
    },
  });

  const original = ai.models.generateContent.bind(ai.models);
  ai.models.generateContent = async () => ({ text: JSON.stringify(geminiResponse) });
  try {
    const context = {
      deliveryStatus: dispute.deliveryStatus,
      priorRefundCount: dispute.priorRefundCount,
      ipMatch: dispute.ipMatch,
      billingAddressMatch: dispute.billingAddressMatch,
      evidenceContext,
    };
    await draftEvidence(dispute.id, signals, context);
  } finally {
    ai.models.generateContent = original;
  }

  const packet = await prisma.evidencePacket.findUnique({ where: { disputeId: dispute.id } });
  console.log(`${razorpayId} -> dispute ${dispute.id}, verificationStatus: ${packet.verificationStatus}`);
  return dispute.id;
}

async function main() {
  // 1. CE 3.0 qualifying case — genuinely 2 matches incl. ipAddress, both
  // prior transactions in-window and clean.
  const ce3Evidence = {
    priorUndisputedTransactions: [
      { transactionId: 'pay_DEMOCE3A1', daysBeforeDispute: 160, previouslyDisputedOrFlagged: false },
      { transactionId: 'pay_DEMOCE3B2', daysBeforeDispute: 210, previouslyDisputedOrFlagged: false },
    ],
    matchingDataElements: { userId: true, ipAddress: true, shippingAddress: true, deviceId: false },
    billingDescriptorMatchesFirstSixChars: true,
  };
  console.log('CE3 qualification (should qualify):', checkCe3Qualification(ce3Evidence));

  const ce3EvidenceContext = {
    transactionLog: [
      { event: 'order_placed', timestamp: new Date(Date.now() - 6 * 86400000).toISOString() },
      { event: 'payment_captured', timestamp: new Date(Date.now() - 6 * 86400000).toISOString() },
    ],
    deliveryConfirmation: {
      carrier: 'BlueDart',
      trackingNumber: 'DEMOTRACK001',
      status: 'delivered',
      deliveredAt: new Date(Date.now() - 2 * 86400000).toISOString(),
      signedBy: 'A. Kumar',
    },
    communicationTrail: [
      { timestamp: new Date(Date.now() - 3 * 86400000).toISOString(), from: 'customer', message: "I don't recognize this charge on my statement." },
      { timestamp: new Date(Date.now() - 2 * 86400000).toISOString(), from: 'merchant', message: 'Could you confirm the last 4 digits of the card used?' },
    ],
    ce3Evidence,
  };

  await createAndDraft({
    razorpayId: CE3_RAZORPAY_ID,
    reasonCode: 'unauthorized_transaction',
    evidenceContext: ce3EvidenceContext,
    deliveryStatus: 'delivered',
    signals: [
      { factor: 'IP address matches prior known-good orders', direction: 'supports', weight: 'high' },
      { factor: 'two prior undisputed transactions on file', direction: 'supports', weight: 'high' },
    ],
    geminiResponse: {
      whyThisEvidence:
        'Two prior undisputed transactions with matching IP address and user ID meet Visa Compelling Evidence 3.0 qualification for this card-not-present fraud claim.',
      citedArtifacts: ['ce3Evidence', 'transactionLog'],
      rebuttalLetter:
        'This dispute qualifies for Visa Compelling Evidence 3.0. Two prior undisputed transactions (pay_DEMOCE3A1, 160 days prior; pay_DEMOCE3B2, 210 days prior) share a matching IP address and user ID with this transaction, neither previously flagged or disputed. Per Visa CE 3.0 policy, this constitutes compelling evidence the cardholder authorized this purchase.',
    },
  });

  // 2. Flagged case — cites Proof of Delivery despite deliveryConfirmation
  // status being "not_delivered". This is the exact scenario from the GAP4
  // anti-fabrication test, kept in the DB permanently (not cleaned up) so
  // it's clickable in the live UI, not just terminal output.
  const flaggedEvidenceContext = {
    transactionLog: [
      { event: 'order_placed', timestamp: new Date(Date.now() - 6 * 86400000).toISOString() },
      { event: 'shipment_created', timestamp: new Date(Date.now() - 5 * 86400000).toISOString() },
    ],
    deliveryConfirmation: {
      carrier: 'Delhivery',
      trackingNumber: 'DEMOTRACK002',
      status: 'not_delivered',
      deliveredAt: null,
      signedBy: null,
    },
    communicationTrail: [
      { timestamp: new Date(Date.now() - 2 * 86400000).toISOString(), from: 'customer', message: "It's been over a week and I still don't see my order." },
    ],
    ce3Evidence: null,
  };

  await createAndDraft({
    razorpayId: FLAGGED_RAZORPAY_ID,
    reasonCode: 'goods_not_received',
    evidenceContext: flaggedEvidenceContext,
    deliveryStatus: 'not_delivered',
    signals: [{ factor: 'delivery not confirmed', direction: 'weakens', weight: 'high' }],
    geminiResponse: {
      whyThisEvidence: 'The delivery confirmation record proves this package was successfully delivered to the customer.',
      citedArtifacts: ['deliveryConfirmation', 'transactionLog'],
      rebuttalLetter:
        'DEMO: this letter deliberately cites deliveryConfirmation as proof of delivery even though its status is "not_delivered", to show verifyEvidence.js catching the contradiction rather than trusting the claim.',
    },
  });

  // 3. Model disagreement — huge amount (the classifier's strongest,
  // most-negative-weighted numeric feature) paired with every qualitative
  // signal reading clean (delivered, IP match, billing match, no prior
  // refunds), which a chargeback-reading LLM tends to call defensible on
  // its own merits regardless of the raw amount. Confirmed live against a
  // real Gemini call earlier in development (see git history / session
  // notes) to actually produce this split — the mocked "defensible" 0.88
  // response here reproduces that same real result deterministically for
  // every future demo, rather than re-rolling the dice against the live API.
  const existing = await prisma.dispute.findUnique({ where: { razorpayId: DISAGREEMENT_RAZORPAY_ID } });
  if (existing) {
    await prisma.auditLog.deleteMany({ where: { disputeId: existing.id } });
    await prisma.evidencePacket.deleteMany({ where: { disputeId: existing.id } });
    await prisma.dispute.delete({ where: { id: existing.id } });
  }

  const disagreementDispute = await prisma.dispute.create({
    data: {
      razorpayId: DISAGREEMENT_RAZORPAY_ID,
      amount: 5000000, // paise = Rs 50,000 — deliberately huge
      currency: 'INR',
      reasonCode: 'unauthorized_transaction',
      status: 'new',
      slaDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      deliveryStatus: 'delivered',
      priorRefundCount: 0,
      ipMatch: true,
      billingAddressMatch: true,
    },
  });

  const mockAi = {
    models: {
      generateContent: async () => ({
        text: JSON.stringify({
          score: 0.88,
          verdict: 'defensible',
          signals: [
            { factor: "IP address matches customer's prior known-good orders", direction: 'supports', weight: 'high' },
            { factor: 'Delivery status is delivered', direction: 'supports', weight: 'high' },
            { factor: 'Billing address matches the address on file', direction: 'supports', weight: 'medium' },
            { factor: 'Zero prior refunds issued to this customer', direction: 'supports', weight: 'low' },
          ],
          summary: 'This dispute is highly defensible as the transaction shows matching IP history, verified billing details, and confirmed delivery.',
        }),
      }),
    },
  };

  const result = await runScoringPipeline(disagreementDispute.id, { ai: mockAi });
  const updated = await prisma.dispute.findUnique({ where: { id: disagreementDispute.id } });
  console.log(
    `${DISAGREEMENT_RAZORPAY_ID} -> dispute ${disagreementDispute.id}, status: ${updated.status}, reason: ${result.reason}, llmScore: ${result.score}, classifierScore: ${result.classifierScore}`
  );
  if (updated.status !== 'pending_review' || result.reason !== 'model_disagreement') {
    console.warn(
      'WARNING: expected status "pending_review" / reason "model_disagreement" — got something else. ' +
        'If server/data/ml-model-coefficients.json changed (e.g. retrained), this scenario may need new numbers to still disagree.'
    );
  }

  // 4. Score-proximity pending_review — score lands right inside the
  // CONFIDENCE_THRESHOLD (0.65) ± RISK_BAND_MARGIN (0.15) band, i.e.
  // 0.5-0.8. Genuinely mixed signals (two supporting, one weakening) so the
  // 0.68 score reads as earned uncertainty, not an arbitrary number.
  const pendingReviewMockAi = {
    models: {
      generateContent: async () => ({
        text: JSON.stringify({
          score: 0.68,
          verdict: 'defensible',
          signals: [
            { factor: 'delivery status is delivered', direction: 'supports', weight: 'high' },
            { factor: 'IP address matches prior known-good orders', direction: 'supports', weight: 'medium' },
            { factor: 'billing address does not match address on file', direction: 'weakens', weight: 'medium' },
          ],
          summary: 'Delivery and IP history support the merchant, but a billing address mismatch keeps this from being clear-cut.',
        }),
      }),
    },
  };
  const { result: pendingReviewResult } = await createAndScore({
    razorpayId: PENDING_REVIEW_RAZORPAY_ID,
    amount: 299900,
    reasonCode: 'goods_not_received',
    deliveryStatus: 'delivered',
    mockAi: pendingReviewMockAi,
  });
  if (pendingReviewResult.status !== 'pending_review') {
    console.warn(
      `WARNING: expected status "pending_review" for ${PENDING_REVIEW_RAZORPAY_ID} — got "${pendingReviewResult.status}". ` +
        'If CONFIDENCE_THRESHOLD/RISK_BAND_MARGIN changed, 0.68 may no longer fall inside the band.'
    );
  }

  // 5. needs_attention — the mock throws on every call, so
  // riskScorer.js's withRetry() genuinely exhausts all MAX_RETRY_ATTEMPTS
  // (real retries happen, ~1s total with the default backoff) before
  // scoreDispute() sets needs_attention and logs the real error message.
  // Not faked by writing the status directly — this exercises the actual
  // failure path, same as the rest of this script exercises the actual
  // success paths.
  const failingMockAi = {
    models: {
      generateContent: async () => {
        throw new Error(
          '{"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details."}}'
        );
      },
    },
  };
  const { result: needsAttentionResult } = await createAndScore({
    razorpayId: NEEDS_ATTENTION_RAZORPAY_ID,
    amount: 199900,
    reasonCode: 'duplicate_charge',
    deliveryStatus: 'delivery_unconfirmed',
    mockAi: failingMockAi,
  });
  if (needsAttentionResult.status !== 'needs_attention') {
    console.warn(`WARNING: expected status "needs_attention" for ${NEEDS_ATTENTION_RAZORPAY_ID} — got "${needsAttentionResult.status}".`);
  }

  console.log('\nDone. All five disputes are permanent (not cleaned up) — rerun this script anytime to refresh them.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
