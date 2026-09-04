const prisma = require('./prisma');
const { generateEvidenceContext } = require('./evidenceContext');

const DELIVERY_STATUSES = ['delivered', 'not_delivered', 'in_transit', 'delivery_unconfirmed'];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomBool(pTrue) {
  return Math.random() < pTrue;
}

function generateSyntheticContext() {
  return {
    deliveryStatus: pick(DELIVERY_STATUSES),
    priorRefundCount: randomInt(0, 3),
    ipMatch: randomBool(0.7),
    billingAddressMatch: randomBool(0.75),
  };
}

/**
 * Returns the transaction context for a dispute, generating and persisting
 * synthetic values on first use. Once set, the same context is reused on
 * every subsequent scoring pass for that dispute (e.g. via POST
 * /disputes/:id/score) rather than being re-randomized each time.
 *
 * GAP 1: also generates/persists evidenceContext (the three evidence
 * artifacts evidenceAgent.js cites by name) here, alongside the flat
 * fields, from the SAME deliveryStatus draw — the only way to guarantee
 * they can't contradict each other. Handled independently of the flat
 * fields' own presence check below: an older dispute may already have flat
 * context but no evidenceContext yet (created before this field existed),
 * so each half backfills separately rather than one clobbering the other.
 */
async function ensureTransactionContext(dispute) {
  const hasFlatContext =
    dispute.deliveryStatus != null &&
    dispute.priorRefundCount != null &&
    dispute.ipMatch != null &&
    dispute.billingAddressMatch != null;

  const flat = hasFlatContext
    ? {
        deliveryStatus: dispute.deliveryStatus,
        priorRefundCount: dispute.priorRefundCount,
        ipMatch: dispute.ipMatch,
        billingAddressMatch: dispute.billingAddressMatch,
      }
    : generateSyntheticContext();

  const evidenceContext =
    dispute.evidenceContext ??
    generateEvidenceContext({
      reasonCode: dispute.reasonCode,
      deliveryStatus: flat.deliveryStatus,
      createdAt: dispute.createdAt,
    });

  if (!hasFlatContext || !dispute.evidenceContext) {
    await prisma.dispute.update({
      where: { id: dispute.id },
      data: { ...flat, evidenceContext },
    });
  }

  return { ...flat, evidenceContext };
}

module.exports = { ensureTransactionContext };
