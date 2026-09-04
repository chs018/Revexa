require('dotenv').config();

// Reuse the shared, adapter-configured client (Prisma 7 requires a driver
// adapter — see src/lib/prisma.js) rather than instantiating a bare
// PrismaClient here, which would fail with "no driver adapter" since this
// script runs standalone via `node prisma/seed.js`, not through index.js.
const prisma = require('../src/lib/prisma');
const { generateEvidenceContext } = require('../src/lib/evidenceContext');

function daysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

// GAP 1: these rows never had flat transaction-context fields at all before
// (they're decorative Day-1 fixtures, not run through the real pipeline —
// riskScorer.js's ensureTransactionContext() only ever ran for real/demo
// disputes). Adding them here, chosen to roughly track each row's existing
// confidenceScore/status, is what "kept internally consistent" actually
// requires — there's nothing to be consistent WITH otherwise. evidenceContext
// is generated from the same generateSyntheticContext-adjacent flow real
// disputes use, from these same deliveryStatus values, so it can't
// contradict them either.
const disputes = [
  {
    razorpayId: 'dp_S9YxQmK1L2aBcD',
    amount: 149900,
    currency: 'INR',
    reasonCode: 'goods_not_received',
    status: 'new',
    slaDeadline: daysFromNow(6),
    confidenceScore: null,
    groundTruthDefensible: true,
    deliveryStatus: 'in_transit',
    priorRefundCount: 0,
    ipMatch: true,
    billingAddressMatch: true,
  },
  {
    razorpayId: 'dp_S9YyRnL2M3bCdE',
    amount: 249000,
    currency: 'INR',
    reasonCode: 'duplicate_charge',
    status: 'scored',
    slaDeadline: daysFromNow(4),
    confidenceScore: 0.82,
    groundTruthDefensible: true,
    deliveryStatus: 'delivered',
    priorRefundCount: 0,
    ipMatch: true,
    billingAddressMatch: true,
  },
  {
    razorpayId: 'dp_S9YzSoM3N4cDeF',
    amount: 59900,
    currency: 'INR',
    reasonCode: 'unrecognized_charge',
    status: 'drafted',
    slaDeadline: daysFromNow(3),
    confidenceScore: 0.61,
    groundTruthDefensible: false,
    deliveryStatus: 'delivery_unconfirmed',
    priorRefundCount: 1,
    ipMatch: true,
    billingAddressMatch: true,
  },
  {
    razorpayId: 'dp_S9Z0TpN4O5dEfG',
    amount: 999900,
    currency: 'INR',
    reasonCode: 'fraudulent_transaction',
    status: 'pending_review',
    slaDeadline: daysFromNow(2),
    confidenceScore: 0.45,
    groundTruthDefensible: false,
    deliveryStatus: 'not_delivered',
    priorRefundCount: 2,
    ipMatch: false,
    billingAddressMatch: true,
  },
  {
    razorpayId: 'dp_S9Z1UqO5P6eFgH',
    amount: 349900,
    currency: 'INR',
    reasonCode: 'subscription_cancelled',
    status: 'submitted',
    slaDeadline: daysFromNow(-1),
    confidenceScore: 0.77,
    groundTruthDefensible: true,
    deliveryStatus: 'delivered',
    priorRefundCount: 0,
    ipMatch: true,
    billingAddressMatch: true,
  },
  {
    razorpayId: 'dp_S9Z2VrP6Q7fGhI',
    amount: 129900,
    currency: 'INR',
    reasonCode: 'product_not_as_described',
    status: 'won',
    slaDeadline: daysFromNow(-5),
    confidenceScore: 0.91,
    groundTruthDefensible: true,
    deliveryStatus: 'delivered',
    priorRefundCount: 0,
    ipMatch: true,
    billingAddressMatch: true,
  },
  {
    razorpayId: 'dp_S9Z3WsQ7R8gHiJ',
    amount: 799900,
    currency: 'INR',
    reasonCode: 'credit_not_processed',
    status: 'lost',
    slaDeadline: daysFromNow(-10),
    confidenceScore: 0.38,
    groundTruthDefensible: false,
    deliveryStatus: 'not_delivered',
    priorRefundCount: 3,
    ipMatch: false,
    billingAddressMatch: false,
  },
  {
    razorpayId: 'dp_S9Z4XtR8S9hIjK',
    amount: 89900,
    currency: 'INR',
    reasonCode: 'goods_not_received',
    status: 'new',
    slaDeadline: daysFromNow(7),
    confidenceScore: null,
    // Deliberately left unlabeled — a dispute we haven't formed a
    // ground-truth opinion on yet, same as a real one would be.
    groundTruthDefensible: null,
    deliveryStatus: 'in_transit',
    priorRefundCount: 0,
    ipMatch: true,
    billingAddressMatch: true,
  },
  {
    razorpayId: 'dp_S9Z5YuS9T0iJkL',
    amount: 1999900,
    currency: 'INR',
    reasonCode: 'unrecognized_charge',
    status: 'scored',
    slaDeadline: daysFromNow(5),
    confidenceScore: 0.55,
    groundTruthDefensible: false,
    deliveryStatus: 'delivery_unconfirmed',
    priorRefundCount: 1,
    ipMatch: true,
    billingAddressMatch: false,
  },
  {
    razorpayId: 'dp_S9Z6ZvT0U1jKlM',
    amount: 44900,
    currency: 'USD',
    reasonCode: 'duplicate_charge',
    status: 'drafted',
    slaDeadline: daysFromNow(1),
    confidenceScore: 0.69,
    groundTruthDefensible: true,
    deliveryStatus: 'delivery_unconfirmed',
    priorRefundCount: 0,
    ipMatch: true,
    billingAddressMatch: true,
  },
];

async function main() {
  for (const dispute of disputes) {
    const evidenceContext = generateEvidenceContext({
      reasonCode: dispute.reasonCode,
      deliveryStatus: dispute.deliveryStatus,
      createdAt: new Date(),
    });
    const data = { ...dispute, evidenceContext };

    await prisma.dispute.upsert({
      where: { razorpayId: dispute.razorpayId },
      update: data,
      create: data,
    });
  }

  console.log(`Seeded ${disputes.length} disputes.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
