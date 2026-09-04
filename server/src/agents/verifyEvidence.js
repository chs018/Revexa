const { checkCe3Qualification } = require('../lib/ce3Qualification');

// GAP 4: a rules-based cross-check against evidenceContext, run AFTER
// evidenceAgent.js produces its output and BEFORE the EvidencePacket is
// saved — deliberately NOT another LLM call asked to grade its own work.
// The anti-fabrication instruction in evidenceAgent.js's prompt is a
// request, not a guarantee; this is the enforcement. For every artifact
// name the model claims in citedArtifacts, it checks two independent
// things against the actual data:
//   1. exists   — is there real data behind this artifact name at all?
//   2. supports — does that data actually support contesting the dispute,
//                 or does it contradict the claim (e.g. citing delivery
//                 proof when deliveryConfirmation.status is
//                 "not_delivered")?
// Either failure gets the artifact flagged. This function never looks at
// the free-text rebuttalLetter itself — checking prose against data is an
// unbounded problem; checking a structured citedArtifacts claim against
// structured evidenceContext is a bounded one, which is why citedArtifacts
// exists as its own field in the first place.
const ARTIFACT_CHECKS = {
  transactionLog(evidenceContext) {
    const log = evidenceContext.transactionLog;
    if (!Array.isArray(log) || log.length === 0) {
      return { exists: false, reason: 'transactionLog is missing or empty in evidenceContext.' };
    }
    // A plain event log doesn't assert anything contestable either way —
    // nothing to contradict, so any non-empty log supports citing it.
    return { exists: true, supports: true };
  },

  deliveryConfirmation(evidenceContext) {
    const dc = evidenceContext.deliveryConfirmation;
    if (!dc) {
      return { exists: false, reason: 'deliveryConfirmation is missing in evidenceContext.' };
    }
    if (dc.status !== 'delivered') {
      return {
        exists: true,
        supports: false,
        reason: `deliveryConfirmation.status is "${dc.status}", not "delivered" — citing it as proof of delivery contradicts the underlying data rather than supporting the case.`,
      };
    }
    return { exists: true, supports: true };
  },

  communicationTrail(evidenceContext) {
    const trail = evidenceContext.communicationTrail;
    if (!Array.isArray(trail) || trail.length === 0) {
      return { exists: false, reason: 'communicationTrail is missing or empty in evidenceContext.' };
    }
    return { exists: true, supports: true };
  },

  ce3Evidence(evidenceContext) {
    const ce3 = evidenceContext.ce3Evidence;
    if (!ce3) {
      return {
        exists: false,
        reason: 'ce3Evidence is missing in evidenceContext (not a CE 3.0-eligible reason code, or context was never generated).',
      };
    }
    const qualification = checkCe3Qualification(ce3);
    if (!qualification.qualifies) {
      return {
        exists: true,
        supports: false,
        reason: `Cited as CE 3.0-qualifying support, but the programmatic qualification check failed: ${qualification.reasons.join(' ')}`,
      };
    }
    return { exists: true, supports: true };
  },

  // Razorpay buildathon integration: unlike the others, this artifact's
  // data doesn't live in evidenceContext — it's the live Razorpay Payments
  // API record (razorpayPayment.js), passed in separately as
  // `context.real_payment_record` (see verifyEvidence()'s jsdoc below).
  // A payment that was never captured contradicts "this transaction
  // completed" — the actual claim citing it would be making.
  real_payment_record(context) {
    const record = context.real_payment_record;
    if (!record) {
      return { exists: false, reason: 'real_payment_record is missing — no live Razorpay payment is linked to this dispute.' };
    }
    if (!record.captured) {
      return {
        exists: true,
        supports: false,
        reason: `The real Razorpay payment record shows status "${record.status}" (not captured) — citing it as support for a completed transaction contradicts the live data.`,
      };
    }
    return { exists: true, supports: true };
  },
};

/**
 * @param {object|null} evidenceContext - Dispute.evidenceContext
 * @param {string[]} citedArtifacts - the evidence agent's own citedArtifacts claim
 * @param {object|null} [realPaymentRecord] - Razorpay buildathon integration:
 *   the live Payments API record (razorpayPayment.js), null if this dispute
 *   isn't backed by a real payment
 * @returns {{ status: 'verified'|'flagged', flagged: { artifact: string, reason: string }[] }}
 */
function verifyEvidence(evidenceContext, citedArtifacts, realPaymentRecord) {
  const context = { ...(evidenceContext || {}), real_payment_record: realPaymentRecord || null };
  const cited = Array.isArray(citedArtifacts) ? citedArtifacts : [];
  const flagged = [];

  for (const artifact of cited) {
    const check = ARTIFACT_CHECKS[artifact];
    if (!check) {
      flagged.push({ artifact, reason: `"${artifact}" is not a recognized evidence artifact.` });
      continue;
    }
    const result = check(context);
    if (!result.exists || result.supports === false) {
      flagged.push({ artifact, reason: result.reason });
    }
  }

  return {
    status: flagged.length > 0 ? 'flagged' : 'verified',
    flagged,
  };
}

module.exports = { verifyEvidence };
