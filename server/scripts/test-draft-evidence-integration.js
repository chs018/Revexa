require('dotenv').config();

// Exercises the FULL draftEvidence() integration (not just verifyEvidence()
// in isolation) — EvidencePacket.verificationStatus actually persisted,
// the "drafted" + "evidence_flagged" AuditLog rows actually written — by
// temporarily monkey-patching the shared Gemini client to return a fixed,
// contradictory response (citing deliveryConfirmation as support despite
// status: "not_delivered"), since live Gemini quota is exhausted right now
// (confirmed via /disputes/:id/score returning needs_attention with a 429
// in the audit trail). Creates one temporary dispute row for this, cleans
// it up at the end. One-off manual test, not part of the app itself.
const prisma = require('../src/lib/prisma');
const ai = require('../src/lib/gemini');
const { draftEvidence } = require('../src/agents/evidenceAgent');
const { generateEvidenceContext } = require('../src/lib/evidenceContext');

async function main() {
  const evidenceContext = generateEvidenceContext({
    reasonCode: 'goods_not_received',
    deliveryStatus: 'not_delivered',
    createdAt: new Date(),
  });
  // Force the load-bearing fact regardless of what the generator randomized.
  evidenceContext.deliveryConfirmation.status = 'not_delivered';
  evidenceContext.deliveryConfirmation.deliveredAt = null;
  evidenceContext.deliveryConfirmation.signedBy = null;

  const dispute = await prisma.dispute.create({
    data: {
      razorpayId: `disp_TESTINTEGRATION_${Date.now()}`,
      amount: 149900,
      currency: 'INR',
      reasonCode: 'goods_not_received',
      status: 'drafted', // pretend the threshold guardrail already passed
      slaDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      deliveryStatus: 'not_delivered',
      priorRefundCount: 0,
      ipMatch: true,
      billingAddressMatch: true,
      groundTruthDefensible: null, // never counted in /metrics — this is a throwaway test row
      evidenceContext,
    },
  });
  console.log(`Created test dispute ${dispute.id} (deliveryConfirmation.status = "not_delivered")`);

  const originalGenerateContent = ai.models.generateContent.bind(ai.models);
  ai.models.generateContent = async () => ({
    text: JSON.stringify({
      whyThisEvidence:
        'The delivery confirmation record proves this package was successfully delivered to the customer.',
      citedArtifacts: ['deliveryConfirmation', 'transactionLog'],
      rebuttalLetter:
        'This is a fabricated claim for testing: it cites deliveryConfirmation as proof of delivery even though deliveryConfirmation.status is "not_delivered".',
    }),
  });

  try {
    const signals = [{ factor: 'delivery not confirmed', direction: 'weakens', weight: 'high' }];
    const context = {
      deliveryStatus: dispute.deliveryStatus,
      priorRefundCount: dispute.priorRefundCount,
      ipMatch: dispute.ipMatch,
      billingAddressMatch: dispute.billingAddressMatch,
      evidenceContext,
    };

    const result = await draftEvidence(dispute.id, signals, context);
    console.log('\ndraftEvidence() returned:', JSON.stringify(result, null, 2));

    const packet = await prisma.evidencePacket.findUnique({ where: { disputeId: dispute.id } });
    console.log('\nEvidencePacket.verificationStatus:', packet.verificationStatus);

    const logs = await prisma.auditLog.findMany({
      where: { disputeId: dispute.id },
      orderBy: { createdAt: 'asc' },
    });
    console.log('\nAuditLog rows:');
    for (const log of logs) {
      console.log(` - ${log.actor} / ${log.action}: ${log.reasoning}`);
    }

    console.log(
      packet.verificationStatus === 'flagged'
        ? '\n=> PASS: EvidencePacket was persisted with verificationStatus "flagged", and an evidence_flagged AuditLog row exists — the fabricated claim did NOT reach an unflagged EvidencePacket.'
        : '\n=> FAIL: expected verificationStatus "flagged".'
    );
  } finally {
    ai.models.generateContent = originalGenerateContent;
    await prisma.auditLog.deleteMany({ where: { disputeId: dispute.id } });
    await prisma.evidencePacket.deleteMany({ where: { disputeId: dispute.id } });
    await prisma.dispute.delete({ where: { id: dispute.id } });
    console.log(`\nCleaned up test dispute ${dispute.id}.`);
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
