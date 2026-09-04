// Both models are mocked directly: the LLM via a mocked `ai` client threaded
// into scoreDispute() through runScoringPipeline(), and the baseline
// classifier via jest.mock('../src/lib/mlClassifier') — deliberately
// disagreeing, to prove the pipeline's disagreement rule (pipeline.js)
// short-circuits the ordinary threshold logic and routes to pending_review.
jest.mock('../src/lib/mlClassifier', () => ({
  predictClassifier: jest.fn().mockReturnValue({ score: 0.12, verdict: 'not_defensible' }),
}));

const { runScoringPipeline } = require('../src/agents/pipeline');
const prisma = require('../src/lib/prisma');
const { createNewDispute, mockRiskScorerAi } = require('./helpers');

describe('runScoringPipeline — model disagreement', () => {
  test('LLM "defensible" vs classifier "not_defensible" routes to pending_review with reason model_disagreement', async () => {
    const dispute = await createNewDispute({ amount: 50000 });

    // LLM verdict is a clean "defensible" with a high score, deliberately
    // opposite the mocked classifier's "not_defensible" above — a score that
    // would otherwise sail straight through to "drafted" under the ordinary
    // threshold branch, proving the disagreement check runs BEFORE (and
    // instead of) that logic, not alongside it.
    const ai = mockRiskScorerAi(0.92, 'defensible');

    const result = await runScoringPipeline(dispute.id, { ai });

    expect(result.status).toBe('pending_review');
    expect(result.reason).toBe('model_disagreement');
    expect(result.score).toBe(0.92);
    expect(result.classifierScore).toBe(0.12);

    const fresh = await prisma.dispute.findUnique({ where: { id: dispute.id } });
    expect(fresh.status).toBe('pending_review');
    expect(fresh.classifierScore).toBe(0.12);
    expect(fresh.classifierVerdict).toBe('not_defensible');

    const log = await prisma.auditLog.findFirst({
      where: { disputeId: dispute.id, action: 'routed_to_pending_review' },
    });
    expect(log).not.toBeNull();
    const reasoning = JSON.parse(log.reasoning);
    expect(reasoning.rule).toBe('model_disagreement');
    expect(reasoning.llmVerdict).toBe('defensible');
    expect(reasoning.llmScore).toBe(0.92);
    expect(reasoning.classifierVerdict).toBe('not_defensible');
    expect(reasoning.classifierScore).toBe(0.12);

    // No EvidencePacket should have been created — disagreement is terminal
    // for this pass, same as the score-proximity/high-value pending_review
    // rules; a human must act via draft-evidence/mark-lost.
    const packet = await prisma.evidencePacket.findUnique({ where: { disputeId: dispute.id } });
    expect(packet).toBeNull();
  });
});
