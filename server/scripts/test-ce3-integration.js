require('dotenv').config();

// Companion to test-draft-evidence-integration.js: confirms the CE 3.0
// happy path — a genuinely qualifying case, cited honestly, ends up
// "verified" (not flagged), and ce3Qualification is recorded in the
// "drafted" AuditLog's reasoning for the frontend to render. One-off
// manual test, not part of the app itself.
const prisma = require('../src/lib/prisma');
const ai = require('../src/lib/gemini');
const { draftEvidence } = require('../src/agents/evidenceAgent');
const { checkCe3Qualification } = require('../src/lib/ce3Qualification');

async function main() {
  // Constructed to genuinely qualify: 2 matches including ipAddress, both
  // prior transactions in-window and clean.
  const evidenceContext = {
    transactionLog: [{ event: 'payment_captured', timestamp: new Date().toISOString() }],
    deliveryConfirmation: { carrier: 'FedEx', trackingNumber: 'CE3TEST01', status: 'delivered', deliveredAt: new Date().toISOString(), signedBy: 'J. Sharma' },
    communicationTrail: [{ timestamp: new Date().toISOString(), from: 'customer', message: "I don't recognize this charge." }],
    ce3Evidence: {
      priorUndisputedTransactions: [
        { transactionId: 'pay_CE3A', daysBeforeDispute: 150, previouslyDisputedOrFlagged: false },
        { transactionId: 'pay_CE3B', daysBeforeDispute: 200, previouslyDisputedOrFlagged: false },
      ],
      matchingDataElements: { userId: true, ipAddress: true, shippingAddress: false, deviceId: false },
      billingDescriptorMatchesFirstSixChars: true,
    },
  };

  const qualification = checkCe3Qualification(evidenceContext.ce3Evidence);
  console.log('Programmatic qualification check:', qualification);

  const dispute = await prisma.dispute.create({
    data: {
      razorpayId: `disp_TESTCE3_${Date.now()}`,
      amount: 999900,
      currency: 'INR',
      reasonCode: 'unauthorized_transaction',
      status: 'drafted',
      slaDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      deliveryStatus: 'delivered',
      priorRefundCount: 0,
      ipMatch: true,
      billingAddressMatch: true,
      groundTruthDefensible: null,
      evidenceContext,
    },
  });
  console.log(`Created test dispute ${dispute.id}`);

  const originalGenerateContent = ai.models.generateContent.bind(ai.models);
  ai.models.generateContent = async () => ({
    text: JSON.stringify({
      whyThisEvidence:
        'Two prior undisputed transactions with matching IP address and user ID meet Visa CE 3.0 qualification.',
      citedArtifacts: ['ce3Evidence'],
      rebuttalLetter: 'This dispute qualifies for Visa Compelling Evidence 3.0...',
    }),
  });

  try {
    const signals = [{ factor: 'IP address matches prior orders', direction: 'supports', weight: 'high' }];
    const context = {
      deliveryStatus: dispute.deliveryStatus,
      priorRefundCount: dispute.priorRefundCount,
      ipMatch: dispute.ipMatch,
      billingAddressMatch: dispute.billingAddressMatch,
      evidenceContext,
    };

    await draftEvidence(dispute.id, signals, context);

    const packet = await prisma.evidencePacket.findUnique({ where: { disputeId: dispute.id } });
    const draftedLog = await prisma.auditLog.findFirst({
      where: { disputeId: dispute.id, actor: 'evidence_agent', action: 'drafted' },
    });
    console.log('\nEvidencePacket.verificationStatus:', packet.verificationStatus);
    console.log('drafted AuditLog reasoning:', draftedLog.reasoning);
    const parsed = JSON.parse(draftedLog.reasoning);
    console.log('\nce3Qualification present in reasoning:', !!parsed.ce3Qualification, '-> qualifies:', parsed.ce3Qualification?.qualifies);

    console.log(
      packet.verificationStatus === 'verified' && parsed.ce3Qualification?.qualifies === true
        ? '\n=> PASS: verified status + ce3Qualification.qualifies=true recorded for the frontend.'
        : '\n=> FAIL: expected verified + qualifies=true.'
    );
  } finally {
    ai.models.generateContent = originalGenerateContent;
    await prisma.auditLog.deleteMany({ where: { disputeId: dispute.id } });
    await prisma.evidencePacket.deleteMany({ where: { disputeId: dispute.id } });
    await prisma.dispute.delete({ where: { id: dispute.id } });
    console.log(`Cleaned up test dispute ${dispute.id}.`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
