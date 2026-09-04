require('dotenv').config();

// One-off addition: a SECOND pending_review demo dispute, alongside the
// permanent disp_DEMOPENDINGREVIEW01 fixture in seed-demo-disputes.js.
// Same score-proximity route (score lands inside CONFIDENCE_THRESHOLD ±
// RISK_BAND_MARGIN), but a different reason code, amount, and signal mix so
// the Queue doesn't show two near-identical pending_review rows during a
// demo. Not part of the "FIVE PERMANENT fixtures" contract in
// seed-demo-disputes.js — this is additive, run independently. Safe to
// rerun: deletes any prior row with this razorpayId first.
const prisma = require('../src/lib/prisma');
const { runScoringPipeline } = require('../src/agents/pipeline');

const RAZORPAY_ID = 'disp_DEMOPENDINGREVIEW02';

async function main() {
  const existing = await prisma.dispute.findUnique({ where: { razorpayId: RAZORPAY_ID } });
  if (existing) {
    await prisma.auditLog.deleteMany({ where: { disputeId: existing.id } });
    await prisma.evidencePacket.deleteMany({ where: { disputeId: existing.id } });
    await prisma.dispute.delete({ where: { id: existing.id } });
  }

  const dispute = await prisma.dispute.create({
    data: {
      razorpayId: RAZORPAY_ID,
      amount: 189900, // Rs 1,899
      currency: 'INR',
      reasonCode: 'duplicate_charge',
      status: 'new',
      slaDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      deliveryStatus: 'delivered',
      priorRefundCount: 2,
      ipMatch: true,
      billingAddressMatch: true,
    },
  });

  // Genuinely mixed: two supporting signals, one weakening (prior refund
  // count of 2 is a real yellow flag for duplicate_charge specifically) —
  // 0.72 reads as earned uncertainty, not an arbitrary pick, and still
  // falls inside the 0.5-0.8 pending_review band.
  const mockAi = {
    models: {
      generateContent: async () => ({
        text: JSON.stringify({
          score: 0.72,
          verdict: 'defensible',
          signals: [
            { factor: 'IP address matches prior known-good orders', direction: 'supports', weight: 'high' },
            { factor: 'Billing address matches the address on file', direction: 'supports', weight: 'medium' },
            { factor: 'Customer has 2 prior refunds, unusual for a duplicate-charge claim', direction: 'weakens', weight: 'medium' },
          ],
          summary:
            'IP and billing history support the merchant, but this customer’s refund history is high enough to warrant a second look before submitting.',
        }),
      }),
    },
  };

  const result = await runScoringPipeline(dispute.id, { ai: mockAi });
  const updated = await prisma.dispute.findUnique({ where: { id: dispute.id } });
  console.log(
    `${RAZORPAY_ID} -> dispute ${updated.id}, status: ${updated.status}, reason: ${result.reason}, score: ${result.score}`
  );
  if (updated.status !== 'pending_review') {
    console.warn(
      `WARNING: expected status "pending_review" — got "${updated.status}". ` +
        'If CONFIDENCE_THRESHOLD/RISK_BAND_MARGIN changed, 0.72 may no longer fall inside the band.'
    );
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
