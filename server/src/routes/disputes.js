const express = require('express');
const { DisputeStatus } = require('@prisma/client');
const prisma = require('../lib/prisma');
const { runScoringPipeline } = require('../agents/pipeline');
const { draftEvidence } = require('../agents/evidenceAgent');
const { emitDisputeUpdate } = require('../lib/socket');
const { submitRealContest } = require('../lib/razorpayContest');

const router = express.Router();

const VALID_DISPUTE_STATUSES = new Set(Object.values(DisputeStatus));

// GET /disputes — list all, most recent first. Supports ?status=xyz to
// filter to a single status (e.g. ?status=drafted for pending review).
router.get('/disputes', async (req, res) => {
  const { status } = req.query;

  if (status !== undefined && !VALID_DISPUTE_STATUSES.has(status)) {
    return res.status(400).json({
      error: 'invalid_status',
      message: `status must be one of: ${[...VALID_DISPUTE_STATUSES].join(', ')}`,
    });
  }

  const disputes = await prisma.dispute.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: 'desc' },
  });

  res.json(disputes);
});

// GET /disputes/:id — single dispute with its audit trail (chronological)
// and its evidence packet, if one exists (Day 6 detail drawer needs both).
router.get('/disputes/:id', async (req, res) => {
  const dispute = await prisma.dispute.findUnique({
    where: { id: req.params.id },
    include: {
      auditLogs: { orderBy: { createdAt: 'asc' } },
      evidencePacket: true,
    },
  });

  if (!dispute) {
    return res.status(404).json({ error: 'not_found' });
  }

  res.json(dispute);
});

// POST /disputes/:id/score — manually (re-)trigger the scoring pipeline on
// an existing dispute. Unlike the webhook's fire-and-forget trigger, this
// awaits the full pipeline (riskScorer -> threshold guardrail -> maybe
// evidenceAgent) and returns the result directly, since this route exists
// specifically for testing retries and the needs_attention path without
// having to create a whole new dispute each time.
router.post('/disputes/:id/score', async (req, res) => {
  const dispute = await prisma.dispute.findUnique({ where: { id: req.params.id } });

  if (!dispute) {
    return res.status(404).json({ error: 'not_found' });
  }

  const result = await runScoringPipeline(dispute.id);
  const updated = await prisma.dispute.findUnique({ where: { id: dispute.id } });

  res.json({ ...result, dispute: updated });
});

// POST /disputes/:id/approve — the ONLY code path allowed to move an
// EvidencePacket to "approved"/"submitted". A human reviewer approves a
// drafted packet; we then immediately simulate submission (no real bank
// integration in this build) and mark both rows submitted.
//
// The precondition check uses updateMany({ where: { disputeId, status:
// 'draft' }, ... }) rather than findUnique-then-update — that's a
// deliberate atomicity choice: two /approve requests racing each other
// (or an /approve racing a /reject) can each only succeed if their update
// actually matched a row still in "draft" status. Postgres resolves the
// race at the row-lock level, so exactly one request's updateMany reports
// count: 1 and proceeds; the other reports count: 0 and gets the 409. A
// read-then-write version would let both requests read "draft" before
// either had written, and double-process.
// POST /disputes/:id/start-review — records when a human began the
// mandatory review dwell period for this dispute's current draft packet;
// /approve's dwell check is measured against this timestamp. Requires an
// EvidencePacket in "draft" status — review only makes sense for something
// awaiting approval. Idempotent: calling it again just resets the clock,
// same as re-opening ApprovalGate.jsx does client-side.
router.post('/disputes/:id/start-review', async (req, res) => {
  const disputeId = req.params.id;

  const dispute = await prisma.dispute.findUnique({ where: { id: disputeId }, include: { evidencePacket: true } });
  if (!dispute) {
    return res.status(404).json({ error: 'not_found' });
  }
  if (!dispute.evidencePacket || dispute.evidencePacket.status !== 'draft') {
    return res.status(409).json({
      error: 'invalid_state',
      message: `EvidencePacket must be in "draft" status to start review (current: ${dispute.evidencePacket ? dispute.evidencePacket.status : 'none'})`,
    });
  }

  const updated = await prisma.dispute.update({ where: { id: disputeId }, data: { reviewStartedAt: new Date() } });
  res.json({ dispute: updated });
});

router.post('/disputes/:id/approve', async (req, res) => {
  const disputeId = req.params.id;
  const reviewerName = (req.body && req.body.reviewerName) || 'Demo Reviewer';
  const pin = req.body && req.body.pin;

  const dispute = await prisma.dispute.findUnique({ where: { id: disputeId } });
  if (!dispute) {
    return res.status(404).json({ error: 'not_found' });
  }

  // Review gate: PIN + mandatory dwell time, mirrored from (and now
  // actually enforced behind) the client's ApprovalGate.jsx. Not real
  // authentication — REVIEW_PIN is a single shared demo value shown
  // directly in the UI — the point is that a raw API call has to go
  // through the same ritual a human clicking through the UI does, not that
  // it keeps out someone who already has API access to this server.
  // Checked BEFORE the atomic draft-status transaction below: neither
  // check touches the database, so failing here can't race against
  // anything and never needs to roll anything back.
  const requiredPin = process.env.REVIEW_PIN || '4721';
  if (pin !== requiredPin) {
    return res.status(401).json({ error: 'invalid_pin', message: 'Incorrect PIN.' });
  }

  const minReviewSeconds = Number(process.env.MIN_REVIEW_SECONDS) || 0;
  if (minReviewSeconds > 0) {
    if (!dispute.reviewStartedAt) {
      return res.status(400).json({
        error: 'review_not_started',
        message: 'Call POST /disputes/:id/start-review before approving.',
      });
    }
    const elapsedSeconds = (Date.now() - dispute.reviewStartedAt.getTime()) / 1000;
    if (elapsedSeconds < minReviewSeconds) {
      return res.status(400).json({
        error: 'review_too_soon',
        message: `Review dwell time not yet satisfied — ${Math.ceil(minReviewSeconds - elapsedSeconds)}s remaining.`,
      });
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const guard = await tx.evidencePacket.updateMany({
        where: { disputeId, status: 'draft' },
        data: { status: 'approved' },
      });

      if (guard.count === 0) {
        const packet = await tx.evidencePacket.findUnique({ where: { disputeId } });
        const err = new Error('invalid_state');
        err.currentStatus = packet ? packet.status : null;
        throw err;
      }

      await tx.auditLog.create({
        data: { disputeId, actor: `human:${reviewerName}`, action: 'approved', reasoning: null },
      });

      // Simulate submission immediately after approval — same transaction,
      // so a crash between "approved" and "submitted" can't leave the
      // packet stuck in a state nothing can recover from.
      await tx.evidencePacket.update({ where: { disputeId }, data: { status: 'submitted' } });
      // reviewStartedAt: null — clears the dwell-gate clock so it can't be
      // reused for a future review cycle without calling start-review again.
      await tx.dispute.update({ where: { id: disputeId }, data: { status: 'submitted', reviewStartedAt: null } });
      await tx.auditLog.create({
        data: {
          disputeId,
          actor: 'system',
          action: 'submitted_to_bank',
          reasoning: 'Simulated — no real bank integration in this build',
        },
      });

      return {
        dispute: await tx.dispute.findUnique({ where: { id: disputeId } }),
        evidencePacket: await tx.evidencePacket.findUnique({ where: { disputeId } }),
      };
    });

    emitDisputeUpdate(result.dispute, 'submitted_to_bank');

    // Razorpay buildathon integration: best-effort, non-blocking real
    // contest submission — the response has already been sent by the time
    // this settles, since it's a slow external call (PDF generation + two
    // Razorpay API round trips) that shouldn't hold the approve response
    // hostage. Outside the transaction above for the same reason a DB
    // transaction shouldn't stay open across a network call to a third
    // party. Never throws (submitRealContest's own contract); either
    // outcome is written as an AuditLog row so it's visible in the trail
    // and the Dispute Detail drawer, same "flag, don't block" pattern
    // verifyEvidence.js already uses for evidence flags.
    submitRealContest(result.dispute, result.evidencePacket)
      .then(async (contestResult) => {
        await prisma.auditLog.create({
          data: {
            disputeId,
            actor: 'system',
            action: contestResult.status === 'submitted' ? 'razorpay_contest_submitted' : 'razorpay_contest_failed',
            reasoning: JSON.stringify(contestResult),
          },
        });
        const fresh = await prisma.dispute.findUnique({ where: { id: disputeId } });
        if (fresh) emitDisputeUpdate(fresh, contestResult.status === 'submitted' ? 'razorpay_contest_submitted' : 'razorpay_contest_failed');
      })
      .catch((err) => {
        // submitRealContest itself never throws — this only catches a
        // failure in the AuditLog write/emit above.
        console.error(`Failed to record contest result for dispute ${disputeId}:`, err);
      });

    res.json(result);
  } catch (err) {
    if (err.message === 'invalid_state') {
      return res.status(409).json({
        error: 'invalid_state',
        message: `EvidencePacket must be in "draft" status to approve (current: ${err.currentStatus ?? 'none'})`,
      });
    }
    throw err;
  }
});

// POST /disputes/:id/reject — human rejects a drafted packet. Same atomic
// draft-only guard as /approve (see comment above); this is the only path
// that can set EvidencePacket.status to "rejected".
router.post('/disputes/:id/reject', async (req, res) => {
  const disputeId = req.params.id;
  const reviewerName = (req.body && req.body.reviewerName) || 'Demo Reviewer';
  const reason = req.body && req.body.reason;

  const dispute = await prisma.dispute.findUnique({ where: { id: disputeId } });
  if (!dispute) {
    return res.status(404).json({ error: 'not_found' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const guard = await tx.evidencePacket.updateMany({
        where: { disputeId, status: 'draft' },
        data: { status: 'rejected' },
      });

      if (guard.count === 0) {
        const packet = await tx.evidencePacket.findUnique({ where: { disputeId } });
        const err = new Error('invalid_state');
        err.currentStatus = packet ? packet.status : null;
        throw err;
      }

      await tx.dispute.update({ where: { id: disputeId }, data: { status: 'lost' } });
      await tx.auditLog.create({
        data: { disputeId, actor: `human:${reviewerName}`, action: 'rejected', reasoning: reason || null },
      });

      return {
        dispute: await tx.dispute.findUnique({ where: { id: disputeId } }),
        evidencePacket: await tx.evidencePacket.findUnique({ where: { disputeId } }),
      };
    });

    emitDisputeUpdate(result.dispute, 'rejected');

    res.json(result);
  } catch (err) {
    if (err.message === 'invalid_state') {
      return res.status(409).json({
        error: 'invalid_state',
        message: `EvidencePacket must be in "draft" status to reject (current: ${err.currentStatus ?? 'none'})`,
      });
    }
    throw err;
  }
});

// POST /disputes/:id/draft-evidence — GAP 2: the only path that moves a
// "pending_review" dispute forward by actually drafting evidence. A human
// decided this borderline/high-value case is worth pursuing; manually
// triggers the same evidenceAgent the automatic pipeline already has (Day
// 3), on demand instead of automatically. Same atomic updateMany-guard
// pattern as /approve and /reject above — see the comment on /approve for
// why that's not a plain findUnique-then-update.
//
// Re-reads the risk scorer's signals from its own last "scored" audit log
// rather than re-scoring: this dispute was already scored once (that's how
// it reached pending_review), and re-scoring here would burn another
// Gemini call and risk landing on a different score that moves it out of
// pending_review entirely, which isn't what a human clicking "draft
// evidence" on THIS case is asking for.
router.post('/disputes/:id/draft-evidence', async (req, res) => {
  const disputeId = req.params.id;
  const reviewerName = (req.body && req.body.reviewerName) || 'Demo Reviewer';

  const dispute = await prisma.dispute.findUnique({ where: { id: disputeId } });
  if (!dispute) {
    return res.status(404).json({ error: 'not_found' });
  }

  const scoredLog = await prisma.auditLog.findFirst({
    where: { disputeId, actor: 'risk_scorer', action: 'scored' },
    orderBy: { createdAt: 'desc' },
  });
  if (!scoredLog || !scoredLog.reasoning) {
    return res.status(409).json({
      error: 'invalid_state',
      message: 'No risk scorer result found for this dispute — cannot draft evidence.',
    });
  }

  let signals;
  try {
    signals = JSON.parse(scoredLog.reasoning).signals;
  } catch {
    return res.status(500).json({ error: 'internal_error', message: 'Stored risk scorer result is not valid JSON.' });
  }

  let draftingDispute;
  try {
    draftingDispute = await prisma.$transaction(async (tx) => {
      const guard = await tx.dispute.updateMany({
        where: { id: disputeId, status: 'pending_review' },
        data: { status: 'drafted' },
      });

      if (guard.count === 0) {
        const current = await tx.dispute.findUnique({ where: { id: disputeId } });
        const err = new Error('invalid_state');
        err.currentStatus = current ? current.status : null;
        throw err;
      }

      await tx.auditLog.create({
        data: { disputeId, actor: `human:${reviewerName}`, action: 'requested_draft_evidence', reasoning: null },
      });

      return tx.dispute.findUnique({ where: { id: disputeId } });
    });
  } catch (err) {
    if (err.message === 'invalid_state') {
      return res.status(409).json({
        error: 'invalid_state',
        message: `Dispute must be "pending_review" to draft evidence (current: ${err.currentStatus ?? 'none'})`,
      });
    }
    throw err;
  }

  // Live the moment the status flips, same as the automatic path — evidence
  // drafting itself (the Gemini call) can take a few seconds, and the
  // Queue/Dashboard should already reflect "drafted, evidence pending" by
  // then rather than waiting on the LLM round trip.
  emitDisputeUpdate(draftingDispute, 'requested_draft_evidence');

  const context = {
    deliveryStatus: draftingDispute.deliveryStatus,
    priorRefundCount: draftingDispute.priorRefundCount,
    ipMatch: draftingDispute.ipMatch,
    billingAddressMatch: draftingDispute.billingAddressMatch,
    evidenceContext: draftingDispute.evidenceContext,
  };

  const evidenceResult = await draftEvidence(disputeId, signals, context);

  if (!evidenceResult) {
    // draftEvidence already set needs_attention + logged why.
    return res.status(502).json({ error: 'drafting_failed', message: 'Evidence agent failed — see the audit trail.' });
  }

  const updated = await prisma.dispute.findUnique({ where: { id: disputeId } });
  const evidencePacket = await prisma.evidencePacket.findUnique({ where: { disputeId } });
  res.json({ dispute: updated, evidencePacket });
});

// POST /disputes/:id/mark-lost — GAP 2: the other path out of
// "pending_review" — a human decided this one isn't worth pursuing. Sets
// status straight to "lost" without ever running evidenceAgent. Same
// reviewerName + reason pattern, and the same atomic guard, as /reject.
router.post('/disputes/:id/mark-lost', async (req, res) => {
  const disputeId = req.params.id;
  const reviewerName = (req.body && req.body.reviewerName) || 'Demo Reviewer';
  const reason = req.body && req.body.reason;

  const dispute = await prisma.dispute.findUnique({ where: { id: disputeId } });
  if (!dispute) {
    return res.status(404).json({ error: 'not_found' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const guard = await tx.dispute.updateMany({
        where: { id: disputeId, status: 'pending_review' },
        data: { status: 'lost' },
      });

      if (guard.count === 0) {
        const current = await tx.dispute.findUnique({ where: { id: disputeId } });
        const err = new Error('invalid_state');
        err.currentStatus = current ? current.status : null;
        throw err;
      }

      await tx.auditLog.create({
        data: { disputeId, actor: `human:${reviewerName}`, action: 'marked_lost', reasoning: reason || null },
      });

      return tx.dispute.findUnique({ where: { id: disputeId } });
    });

    emitDisputeUpdate(result, 'marked_lost');

    res.json({ dispute: result });
  } catch (err) {
    if (err.message === 'invalid_state') {
      return res.status(409).json({
        error: 'invalid_state',
        message: `Dispute must be "pending_review" to mark lost this way (current: ${err.currentStatus ?? 'none'})`,
      });
    }
    throw err;
  }
});

// GET /audit-logs — all audit log rows, most recent first. Supports
// ?disputeId= and ?actor= to narrow the list (Day 6 Audit Trail filters).
router.get('/audit-logs', async (req, res) => {
  const { disputeId, actor } = req.query;

  const where = {};
  if (disputeId) where.disputeId = disputeId;
  if (actor) where.actor = actor;

  const auditLogs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      dispute: { select: { razorpayId: true, amount: true, currency: true, status: true } },
    },
  });

  res.json(auditLogs);
});

// GET /metrics — grades the risk scorer's verdicts against
// groundTruthDefensible (Day 6) and reports the result as a confusion
// matrix, precision/recall, and money-based costs/baselines.
//
// Only disputes with a known groundTruthDefensible can be graded at all —
// real Razorpay-sourced disputes (null groundTruthDefensible) are silently
// excluded from the matrix, since we have nothing to grade them against.
// Of those, only ones that actually reached the risk scorer (a
// risk_scorer/scored AuditLog exists) contribute a confusion-matrix cell —
// a dispute that's still "new" or hit "needs_attention" has a ground truth
// label but no verdict to grade.
router.get('/metrics', async (req, res) => {
  const disputes = await prisma.dispute.findMany({
    include: {
      auditLogs: {
        where: { actor: 'risk_scorer', action: 'scored' },
        orderBy: { createdAt: 'desc' },
        take: 1, // most recent scoring pass only — re-scores supersede earlier verdicts
      },
    },
  });

  // GAP 2 (rigor review): a flat fee the acquirer charges per filed dispute,
  // regardless of outcome. A false positive here means the model told the
  // merchant to contest a dispute that wasn't actually defensible — the
  // amount was never really recoverable, AND this fee was burned pursuing
  // it. Not applied to falseNegativeCost: a false negative means the
  // dispute was never contested, so no representment fee was ever incurred
  // on it. See docs/threshold-rationale.md.
  const chargebackFee = Number(process.env.CHARGEBACK_FEE) || 0;

  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  let falsePositiveCost = 0;
  let falseNegativeCost = 0;
  let modelResult = 0; // actual money defended: amount of every "submitted" dispute
  let contestEverythingDefended = 0; // sum of amounts where groundTruth is genuinely true
  let labeledCount = 0; // disputes with a ground truth label at all
  let gradedCount = 0; // of those, disputes with an actual verdict to compare it to
  let gradedAmountSum = 0; // Part D (point 12): sum of amounts across graded disputes only —
  // denominator for the average dispute size used below, kept separate from
  // modelResult/contestEverythingDefended so it isn't silently mixed with
  // money that was never actually graded against a ground truth.
  let scoredDisputeCount = 0; // Part D (point 13): every dispute the risk scorer actually
  // evaluated, labeled or not — this is the real, counted "cases the model
  // read instead of a human" figure hours-saved is grounded in.

  for (const dispute of disputes) {
    if (dispute.status === 'submitted') {
      modelResult += dispute.amount;
    }

    const scoredLog = dispute.auditLogs[0];
    if (scoredLog && scoredLog.reasoning) {
      scoredDisputeCount += 1;
    }

    if (dispute.groundTruthDefensible === null) continue;
    labeledCount += 1;

    if (dispute.groundTruthDefensible === true) {
      contestEverythingDefended += dispute.amount;
    }

    if (!scoredLog || !scoredLog.reasoning) continue;

    let verdict;
    try {
      verdict = JSON.parse(scoredLog.reasoning).verdict;
    } catch {
      continue; // malformed reasoning JSON — can't grade this one
    }
    if (verdict !== 'defensible' && verdict !== 'not_defensible') continue;

    gradedCount += 1;
    gradedAmountSum += dispute.amount;
    const predictedDefensible = verdict === 'defensible';
    const actuallyDefensible = dispute.groundTruthDefensible === true;

    if (predictedDefensible && actuallyDefensible) {
      tp += 1;
    } else if (predictedDefensible && !actuallyDefensible) {
      fp += 1;
      falsePositiveCost += dispute.amount + chargebackFee;
    } else if (!predictedDefensible && actuallyDefensible) {
      fn += 1;
      falseNegativeCost += dispute.amount;
    } else {
      tn += 1;
    }
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall = tp + fn > 0 ? tp / (tp + fn) : null;

  // Part D (point 12): a data-grounded estimatedAnnualValueProtected, not an
  // invented headline figure. Three of its four factors are real, measured
  // numbers:
  //   - avgGradedDisputeAmount: the actual average dispute size, computed
  //     only across disputes that were both labeled AND scored (gradedCount
  //     — the same population the confusion matrix above grades).
  //   - winRateImprovement: recall (tp / (tp+fn)) IS this figure already —
  //     "of the disputes that were genuinely defensible, what fraction did
  //     the model correctly catch and contest." The "accept everything"
  //     baseline's recall is trivially 0 (it never contests anything, so it
  //     never catches any of them) — recall - 0 = recall, so no separate
  //     calculation is needed, just this existing one relabeled for what
  //     it's actually being used for here.
  // The fourth factor, ASSUMED_MONTHLY_DISPUTE_VOLUME, is the one genuinely
  // assumed input — explicitly labeled as such below and in the API
  // response, never presented as a Razorpay-provided or measured figure.
  const avgGradedDisputeAmount = gradedCount > 0 ? gradedAmountSum / gradedCount : null;
  const winRateImprovement = recall; // see comment above — recall already IS this figure
  const assumedMonthlyDisputeVolume = Number(process.env.ASSUMED_MONTHLY_DISPUTE_VOLUME) || 0;
  const estimatedAnnualValueProtected =
    avgGradedDisputeAmount != null && winRateImprovement != null && assumedMonthlyDisputeVolume > 0
      ? avgGradedDisputeAmount * winRateImprovement * assumedMonthlyDisputeVolume * 12
      : null;

  // Part D (point 13): hours saved, grounded the same way — scoredDisputeCount
  // is real (every dispute the risk scorer actually evaluated, counted
  // above), multiplied by an assumed per-dispute manual-review time. This
  // app has no manual-review process to measure that time from (nothing here
  // was ever done by hand), so — unlike avgGradedDisputeAmount/recall above —
  // there's no way to make this factor anything but an assumption; it's kept
  // as its own clearly-labeled constant (not hardcoded silently into the
  // multiplication) for the same reason ASSUMED_MONTHLY_DISPUTE_VOLUME and
  // ASSUMED_HOURLY_OPS_COST are both env vars rather than inline numbers.
  const assumedMinutesPerManualReview = Number(process.env.ASSUMED_MINUTES_PER_MANUAL_REVIEW) || 15;
  const assumedHourlyOpsCost = Number(process.env.ASSUMED_HOURLY_OPS_COST) || 0;
  const hoursSaved = (scoredDisputeCount * assumedMinutesPerManualReview) / 60;
  const opsCostSaved = hoursSaved * assumedHourlyOpsCost;

  // GAP 2 (rigor review): reputational risk, tracked separately from the
  // money-based costs above — a merchant's dispute RATE (not just how the
  // model grades individual cases) can put them into card-network
  // monitoring programs, which is a cost the confusion matrix can't
  // capture. "This period" is all disputes ever recorded, since the app has
  // no date-range/period concept yet — documented here rather than implied.
  const totalTxnVolume = Number(process.env.TOTAL_TXN_VOLUME) || 0;
  const disputeRatioWarning = Number(process.env.DISPUTE_RATIO_WARNING) || 0.01;
  const disputesFiledThisPeriod = disputes.length;
  const disputeRatio = totalTxnVolume > 0 ? disputesFiledThisPeriod / totalTxnVolume : null;

  res.json({
    confusionMatrix: { tp, fp, tn, fn },
    precision,
    recall,
    falsePositiveCost,
    falseNegativeCost,
    chargebackFee,
    modelResult,
    baselines: {
      acceptEverything: { moneyDefended: 0, effortCount: 0 },
      contestEverything: { moneyDefended: contestEverythingDefended, effortCount: labeledCount },
    },
    labeledCount,
    gradedCount,
    reputationalRisk: {
      disputesFiledThisPeriod,
      totalTxnVolume,
      disputeRatio,
      warningThreshold: disputeRatioWarning,
      exceedsThreshold: disputeRatio != null && disputeRatio > disputeRatioWarning,
      note:
        'DISPUTE_RATIO_WARNING is a configurable, illustrative placeholder — not a verified current Visa/Mastercard monitoring-program threshold. Verify against the networks\' current published figures before citing a specific number anywhere real.',
    },
    // Part D: business-value figures, each built from real counted data
    // multiplied by an explicitly-labeled assumption — never an invented
    // headline number. See the comments above where each is computed.
    businessValue: {
      estimatedAnnualValueProtected,
      avgGradedDisputeAmount,
      winRateImprovement,
      assumedMonthlyDisputeVolume,
      hoursSaved,
      opsCostSaved,
      scoredDisputeCount,
      assumedMinutesPerManualReview,
      assumedHourlyOpsCost,
      note:
        'estimatedAnnualValueProtected and opsCostSaved are both real measured factors (average graded dispute amount, recall, count of disputes actually scored) multiplied by explicitly assumed rates (ASSUMED_MONTHLY_DISPUTE_VOLUME, ASSUMED_MINUTES_PER_MANUAL_REVIEW, ASSUMED_HOURLY_OPS_COST) — not Razorpay-provided or independently verified figures. Set the assumed rates to your own merchant\'s real numbers before quoting either figure anywhere real.',
    },
  });
});

module.exports = router;
