// Shared fixtures/mocks for the test suite — kept in one place so, e.g., a
// mock Gemini response's exact shape can't drift between test files the
// way the two agents' real prompts could otherwise silently diverge from
// what a test believes they return.
const prisma = require('../src/lib/prisma');

function futureDeadline(days = 7) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function uniqueRazorpayId(prefix = 'disp_TEST') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// A bare "new" dispute with no transaction context yet — the shape
// scoreDispute()/runScoringPipeline() expect to operate on.
async function createNewDispute(overrides = {}) {
  return prisma.dispute.create({
    data: {
      razorpayId: overrides.razorpayId || uniqueRazorpayId(),
      amount: overrides.amount ?? 99900,
      currency: overrides.currency || 'INR',
      reasonCode: overrides.reasonCode || 'goods_not_received',
      status: 'new',
      slaDeadline: futureDeadline(),
      ...overrides.data,
    },
  });
}

// A dispute already past scoring, with a "draft" EvidencePacket — the
// shape /approve, /reject, /start-review expect.
async function createDraftedDispute(overrides = {}) {
  const dispute = await prisma.dispute.create({
    data: {
      razorpayId: overrides.razorpayId || uniqueRazorpayId(),
      amount: overrides.amount ?? 99900,
      currency: overrides.currency || 'INR',
      reasonCode: overrides.reasonCode || 'goods_not_received',
      status: 'drafted',
      slaDeadline: futureDeadline(),
      confidenceScore: overrides.confidenceScore ?? 0.9,
      deliveryStatus: 'delivered',
      priorRefundCount: 0,
      ipMatch: true,
      billingAddressMatch: true,
    },
  });
  await prisma.evidencePacket.create({
    data: { disputeId: dispute.id, content: 'Test rebuttal letter content.', status: 'draft' },
  });
  return dispute;
}

// A dispute in "pending_review" — the shape /draft-evidence, /mark-lost
// expect. Needs a "scored" risk_scorer AuditLog since /draft-evidence
// reads signals back out of it rather than re-scoring.
async function createPendingReviewDispute(overrides = {}) {
  const dispute = await prisma.dispute.create({
    data: {
      razorpayId: overrides.razorpayId || uniqueRazorpayId(),
      amount: overrides.amount ?? 99900,
      currency: overrides.currency || 'INR',
      reasonCode: overrides.reasonCode || 'goods_not_received',
      status: 'pending_review',
      slaDeadline: futureDeadline(),
      confidenceScore: overrides.confidenceScore ?? 0.7,
      deliveryStatus: 'delivered',
      priorRefundCount: 0,
      ipMatch: true,
      billingAddressMatch: true,
    },
  });
  await prisma.auditLog.create({
    data: {
      disputeId: dispute.id,
      actor: 'risk_scorer',
      action: 'scored',
      reasoning: JSON.stringify({
        score: overrides.confidenceScore ?? 0.7,
        verdict: 'defensible',
        signals: [{ factor: 'test signal', direction: 'supports', weight: 'medium' }],
        summary: 'Test summary.',
      }),
    },
  });
  return dispute;
}

// A mock Gemini client shaped like the real one (lib/gemini.js) —
// generateContent() resolving to a risk_scorer-shaped JSON response.
function mockRiskScorerAi(score, verdict) {
  return {
    models: {
      generateContent: jest.fn().mockResolvedValue({
        text: JSON.stringify({
          score,
          verdict,
          signals: [
            { factor: 'test signal', direction: verdict === 'defensible' ? 'supports' : 'weakens', weight: 'medium' },
          ],
          summary: 'Test summary.',
        }),
      }),
    },
  };
}

// A mock Gemini client shaped for evidenceAgent.js's expected response.
function mockEvidenceAgentAi({ whyThisEvidence, citedArtifacts, rebuttalLetter }) {
  return {
    models: {
      generateContent: jest.fn().mockResolvedValue({
        text: JSON.stringify({
          whyThisEvidence,
          citedArtifacts,
          rebuttalLetter,
        }),
      }),
    },
  };
}

module.exports = {
  futureDeadline,
  uniqueRazorpayId,
  createNewDispute,
  createDraftedDispute,
  createPendingReviewDispute,
  mockRiskScorerAi,
  mockEvidenceAgentAi,
};
