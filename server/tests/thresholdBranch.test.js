// mlClassifier is mocked to null here specifically so the real trained
// classifier (server/data/ml-model-coefficients.json) can't accidentally
// disagree with the mocked LLM verdict and short-circuit into
// model_disagreement — this file is only testing the plain
// CONFIDENCE_THRESHOLD/RISK_BAND_MARGIN branch, same "fails open" behavior
// as if no classifier had ever been trained.
jest.mock('../src/lib/mlClassifier', () => ({
  predictClassifier: jest.fn().mockReturnValue(null),
}));

const { runScoringPipeline } = require('../src/agents/pipeline');
const prisma = require('../src/lib/prisma');
const { createNewDispute, mockRiskScorerAi } = require('./helpers');

describe('runScoringPipeline — threshold branch', () => {
  // .env: CONFIDENCE_THRESHOLD=0.65, RISK_BAND_MARGIN=0.15 -> band is
  // 0.50-0.80. A score clearly below 0.50 must land on "lost"; a score
  // clearly above 0.80 must land on "drafted".
  const threshold = Number(process.env.CONFIDENCE_THRESHOLD);
  const margin = Number(process.env.RISK_BAND_MARGIN) || 0.1;

  test('a score clearly below the band results in status "lost"', async () => {
    const dispute = await createNewDispute({ amount: 50000 });
    const belowScore = Math.max(0, threshold - margin - 0.2);
    const ai = mockRiskScorerAi(belowScore, 'not_defensible');

    const result = await runScoringPipeline(dispute.id, { ai });

    expect(result.status).toBe('lost');
    expect(result.score).toBe(belowScore);

    const fresh = await prisma.dispute.findUnique({ where: { id: dispute.id } });
    expect(fresh.status).toBe('lost');
  });

  test('a score clearly above the band results in status "drafted"', async () => {
    const dispute = await createNewDispute({ amount: 50000 });
    const aboveScore = Math.min(1, threshold + margin + 0.15);

    // Same injected `ai` object serves both agents in sequence — first call
    // is riskScorer's prompt, second is evidenceAgent's, since
    // runScoringPipeline calls scoreDispute() then draftEvidence() with the
    // same client.
    const ai = {
      models: {
        generateContent: jest
          .fn()
          .mockResolvedValueOnce({
            text: JSON.stringify({
              score: aboveScore,
              verdict: 'defensible',
              signals: [{ factor: 'test signal', direction: 'supports', weight: 'high' }],
              summary: 'Test summary.',
            }),
          })
          .mockResolvedValueOnce({
            text: JSON.stringify({
              whyThisEvidence: 'Test evidence rationale.',
              citedArtifacts: [],
              rebuttalLetter: 'Test rebuttal letter body.',
            }),
          }),
      },
    };

    const result = await runScoringPipeline(dispute.id, { ai });

    expect(result.status).toBe('drafted');
    expect(result.score).toBe(aboveScore);

    const fresh = await prisma.dispute.findUnique({ where: { id: dispute.id } });
    expect(fresh.status).toBe('drafted');

    const packet = await prisma.evidencePacket.findUnique({ where: { disputeId: dispute.id } });
    expect(packet.status).toBe('draft');
  });
});
