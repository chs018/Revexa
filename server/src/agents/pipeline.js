const prisma = require('../lib/prisma');
const { scoreDispute } = require('./riskScorer');
const { draftEvidence } = require('./evidenceAgent');
const { emitDisputeUpdate } = require('../lib/socket');
const { predictClassifier } = require('../lib/mlClassifier');

/**
 * Runs riskScorer -> (model-disagreement check) -> (routing guardrail) ->
 * maybe evidenceAgent for one dispute.
 *
 * The routing check below is deliberately plain code, not part of any
 * prompt sent to Gemini — the model never sees CONFIDENCE_THRESHOLD,
 * RISK_BAND_MARGIN, or HIGH_VALUE_CUTOFF, and has no say in how a dispute
 * is routed. Same guardrail principle as before GAP 2 — routing is decided
 * here, in code, using the score the model returned, not by the model
 * itself.
 *
 * GAP 2: three-way branch, not a binary pass/fail —
 *   - score within CONFIDENCE_THRESHOLD ± RISK_BAND_MARGIN, OR
 *     amount > HIGH_VALUE_CUTOFF
 *     -> "pending_review". evidenceAgent does NOT run automatically; a
 *        human calls POST /disputes/:id/draft-evidence or
 *        POST /disputes/:id/mark-lost (disputes.js) to move it forward.
 *   - score clearly above the band -> "drafted", evidenceAgent runs, same
 *     as before.
 *   - score clearly below the band -> "lost", same as before.
 *
 * PART A: right after riskScorer.js completes (and BEFORE the three-way
 * routing above), an independent baseline classifier (mlClassifier.js)
 * gets the same context and is asked for its own verdict. If it has
 * nothing to say (never trained — predictClassifier returns null), this
 * whole check is skipped and routing proceeds exactly as it did before
 * this feature existed — a missing model must never change behavior. If it
 * DOES have a verdict and it disagrees with the LLM's, that disagreement
 * itself is the reason for pending_review — a third rule alongside
 * score-proximity and high-value — and none of the existing threshold
 * logic below even runs. If they agree, routing proceeds unchanged.
 *
 * `ai` (Part B, point 8): optional injected Gemini client, threaded through
 * to both scoreDispute and draftEvidence — lets tests exercise the full
 * pipeline with a mocked LLM instead of the real API.
 */
async function runScoringPipeline(disputeId, { ai } = {}) {
  const scoreResult = await scoreDispute(disputeId, { ai });

  if (!scoreResult) {
    // riskScorer already set status: needs_attention and logged why.
    return { stage: 'scoring', status: 'needs_attention' };
  }

  const dispute = await prisma.dispute.findUnique({ where: { id: disputeId } });

  // PART A: model disagreement — fails open (classifierResult === null) to
  // the existing threshold logic below, completely unchanged, if no
  // classifier has ever been trained.
  const classifierResult = predictClassifier({
    reasonCode: dispute.reasonCode,
    amount: dispute.amount,
    currency: dispute.currency,
    deliveryStatus: scoreResult.context.deliveryStatus,
    priorRefundCount: scoreResult.context.priorRefundCount,
    ipMatch: scoreResult.context.ipMatch,
    billingAddressMatch: scoreResult.context.billingAddressMatch,
  });

  if (classifierResult) {
    // Stored whenever the classifier runs, regardless of agree/disagree —
    // "the classifier's independent result," not just its disagreements.
    await prisma.dispute.update({
      where: { id: disputeId },
      data: { classifierScore: classifierResult.score, classifierVerdict: classifierResult.verdict },
    });

    if (classifierResult.verdict !== scoreResult.verdict) {
      const updatedDispute = await prisma.dispute.update({ where: { id: disputeId }, data: { status: 'pending_review' } });
      await prisma.auditLog.create({
        data: {
          disputeId,
          actor: 'system',
          action: 'routed_to_pending_review',
          // Structured JSON, same convention as risk_scorer's "scored" and
          // evidence_agent's "drafted" entries — both verdicts and both
          // scores inspectable, not collapsed into a status flip. The
          // score-proximity/high-value rules below still log a plain
          // string; the frontend tells the two apart by trying to parse
          // JSON first (see DisputeDetail.jsx's parsePendingReviewReason).
          reasoning: JSON.stringify({
            rule: 'model_disagreement',
            llmVerdict: scoreResult.verdict,
            llmScore: scoreResult.score,
            classifierVerdict: classifierResult.verdict,
            classifierScore: classifierResult.score,
          }),
        },
      });

      emitDisputeUpdate(updatedDispute, 'routed_to_pending_review');

      // No evidenceAgent call — same as the other pending_review rules,
      // waits for explicit human action.
      return {
        stage: 'threshold',
        status: 'pending_review',
        score: scoreResult.score,
        classifierScore: classifierResult.score,
        reason: 'model_disagreement',
      };
    }
  }

  const threshold = Number(process.env.CONFIDENCE_THRESHOLD);
  const margin = Number(process.env.RISK_BAND_MARGIN) || 0.1;
  const highValueCutoff = Number(process.env.HIGH_VALUE_CUTOFF) || 50000;
  const score = scoreResult.score;

  const lowerBand = threshold - margin;
  const upperBand = threshold + margin;
  const isBorderline = score >= lowerBand && score <= upperBand;
  const isHighValue = dispute.amount > highValueCutoff;

  if (isBorderline || isHighValue) {
    const rulesTriggered = [];
    if (isBorderline) {
      rulesTriggered.push(`score-proximity: score ${score} is within ${threshold} ± ${margin} (band ${lowerBand}-${upperBand})`);
    }
    if (isHighValue) {
      rulesTriggered.push(`high-value: amount ${dispute.amount} exceeds HIGH_VALUE_CUTOFF ${highValueCutoff}`);
    }

    const updatedDispute = await prisma.dispute.update({ where: { id: disputeId }, data: { status: 'pending_review' } });
    await prisma.auditLog.create({
      data: {
        disputeId,
        actor: 'system',
        action: 'routed_to_pending_review',
        reasoning: rulesTriggered.join('; '),
      },
    });

    emitDisputeUpdate(updatedDispute, 'routed_to_pending_review');

    // No evidenceAgent call — waits for explicit human action.
    return { stage: 'threshold', status: 'pending_review', score };
  }

  const passed = score > upperBand; // clearly above the band (isBorderline already ruled out the band itself)
  const status = passed ? 'drafted' : 'lost';

  const updatedDispute = await prisma.dispute.update({ where: { id: disputeId }, data: { status } });
  await prisma.auditLog.create({
    data: {
      disputeId,
      actor: 'system',
      action: passed ? 'threshold_passed' : 'threshold_failed',
      reasoning: `score ${score} vs threshold ${threshold} (band ${lowerBand}-${upperBand})`,
    },
  });

  emitDisputeUpdate(updatedDispute, passed ? 'threshold_passed' : 'threshold_failed');

  if (!passed) {
    // Terminal per spec — no evidence agent call.
    return { stage: 'threshold', status: 'lost', score };
  }

  // Razorpay buildathon integration: realPaymentRecord travels folded into
  // context, same way evidenceContext already does — one object, one thing
  // for draftEvidence() to destructure, not a growing parameter list.
  const evidenceResult = await draftEvidence(
    disputeId,
    scoreResult.signals,
    {
      ...scoreResult.context,
      realPaymentRecord: scoreResult.realPaymentRecord,
    },
    { ai }
  );

  if (!evidenceResult) {
    // evidenceAgent already set status: needs_attention and logged why.
    return { stage: 'evidence', status: 'needs_attention', score };
  }

  return { stage: 'evidence', status: 'drafted', score };
}

module.exports = { runScoringPipeline };
