// Exercises draftEvidence() directly rather than the full pipeline — the
// anti-fabrication check (verifyEvidence.js) runs inside draftEvidence
// regardless of how it was reached (automatic threshold pass or manual
// POST /disputes/:id/draft-evidence), so this is the narrowest true unit
// for this concern.
const { draftEvidence } = require('../src/agents/evidenceAgent');
const prisma = require('../src/lib/prisma');
const { mockEvidenceAgentAi } = require('./helpers');

describe('draftEvidence — anti-fabrication flag', () => {
  test('citing deliveryConfirmation when the underlying status is not_delivered gets flagged', async () => {
    const dispute = await prisma.dispute.create({
      data: {
        razorpayId: `disp_TEST_FLAG_${Date.now()}`,
        amount: 79900,
        currency: 'INR',
        reasonCode: 'goods_not_received',
        status: 'drafted',
        slaDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        deliveryStatus: 'not_delivered',
        priorRefundCount: 0,
        ipMatch: true,
        billingAddressMatch: true,
        evidenceContext: {
          transactionLog: [{ event: 'order_placed', timestamp: new Date().toISOString() }],
          // The contradiction: the model is about to cite this artifact as
          // proof of delivery, but its own status says otherwise.
          deliveryConfirmation: {
            carrier: 'Test Carrier',
            trackingNumber: 'TEST123',
            status: 'not_delivered',
            deliveredAt: null,
            signedBy: null,
          },
          communicationTrail: [],
          ce3Evidence: null,
        },
      },
    });

    const signals = [{ factor: 'test signal', direction: 'supports', weight: 'medium' }];
    const context = {
      deliveryStatus: 'not_delivered',
      priorRefundCount: 0,
      ipMatch: true,
      billingAddressMatch: true,
      evidenceContext: dispute.evidenceContext,
    };

    // The mocked model claims deliveryConfirmation supports the case even
    // though the underlying data says the opposite — exactly the fabrication
    // verifyEvidence.js exists to catch, since the prompt's own instruction
    // not to do this is a request, not a guarantee.
    const ai = mockEvidenceAgentAi({
      whyThisEvidence: 'The delivery confirmation proves the order was delivered.',
      citedArtifacts: ['deliveryConfirmation'],
      rebuttalLetter: 'This dispute should be denied because the package was delivered as confirmed by tracking.',
    });

    const result = await draftEvidence(dispute.id, signals, context, { ai });

    expect(result).not.toBeNull();

    const packet = await prisma.evidencePacket.findUnique({ where: { disputeId: dispute.id } });
    expect(packet.verificationStatus).toBe('flagged');

    const flaggedLog = await prisma.auditLog.findFirst({
      where: { disputeId: dispute.id, action: 'evidence_flagged' },
    });
    expect(flaggedLog).not.toBeNull();
    const flagged = JSON.parse(flaggedLog.reasoning);
    expect(flagged.some((f) => f.artifact === 'deliveryConfirmation')).toBe(true);
  });
});
