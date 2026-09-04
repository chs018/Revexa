import { useEffect, useState } from 'react';
import {
  getDispute,
  getConfig,
  approveDispute,
  rejectDispute,
  draftEvidenceForDispute,
  markDisputeLost,
} from '../lib/api';
import { useSocketContext } from '../hooks/SocketContext';
import { formatCurrency } from '../lib/format';
import { STATUS_LABEL, statusBadgeClasses } from '../lib/statusStyles';
import SlaCountdown from './SlaCountdown';
import ConfidenceGauge from './ConfidenceGauge';
import SignalsList from './SignalsList';
import EvidenceArtifacts from './EvidenceArtifacts';
import ApprovalGate from './ApprovalGate';
import VerificationStamp, { pseudoVerificationCode } from './VerificationStamp';

function latestByActor(auditLogs, actor, action) {
  const matches = auditLogs.filter((l) => l.actor === actor && (!action || l.action === action));
  return matches[matches.length - 1] ?? null;
}

function parseRiskAssessment(auditLogs) {
  const log = latestByActor(auditLogs, 'risk_scorer', 'scored');
  if (!log) return null;
  try {
    return JSON.parse(log.reasoning);
  } catch {
    return null;
  }
}

function parseEvidenceWhy(auditLogs) {
  const log = latestByActor(auditLogs, 'evidence_agent', 'drafted');
  if (!log || !log.reasoning) return null;
  try {
    return JSON.parse(log.reasoning);
  } catch {
    return null;
  }
}

// PART A (point 6): the score-proximity/high-value rules log a plain
// string reasoning; model_disagreement logs structured JSON (both
// verdicts, both scores — see pipeline.js). Try JSON first, fall back to
// the plain string, so the "Models disagree" case can render distinctly
// (both scores side by side) while the other two rules render exactly as
// before.
function parsePendingReviewReason(auditLogs) {
  const log = latestByActor(auditLogs, 'system', 'routed_to_pending_review');
  if (!log || !log.reasoning) return null;
  try {
    const parsed = JSON.parse(log.reasoning);
    if (parsed && parsed.rule === 'model_disagreement') {
      return { kind: 'model_disagreement', ...parsed };
    }
  } catch {
    // not JSON — a plain score-proximity/high-value string, fall through
  }
  return { kind: 'text', text: log.reasoning };
}

function parseEvidenceFlags(auditLogs) {
  const log = latestByActor(auditLogs, 'system', 'evidence_flagged');
  if (!log || !log.reasoning) return null;
  try {
    const flags = JSON.parse(log.reasoning);
    return Array.isArray(flags) ? flags : null;
  } catch {
    return null;
  }
}

// Razorpay buildathon integration: the real Disputes API contest result —
// "submitted" or "failed" (with Razorpay's actual reason, e.g. the expected
// 404 when razorpayId isn't a real dispute test mode has no way to create).
// Whichever action's log is most recent wins, same latest-by-actor pattern
// as everything else here.
function parseContestResult(auditLogs) {
  const submitted = latestByActor(auditLogs, 'system', 'razorpay_contest_submitted');
  const failed = latestByActor(auditLogs, 'system', 'razorpay_contest_failed');
  const log = [submitted, failed].filter(Boolean).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  if (!log || !log.reasoning) return null;
  try {
    return { ...JSON.parse(log.reasoning), action: log.action };
  } catch {
    return null;
  }
}

export default function DisputeDetail({ disputeId, onClose }) {
  const [dispute, setDispute] = useState(null);
  const [threshold, setThreshold] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [reviewerName, setReviewerName] = useState('Demo Reviewer');
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [showRejectReason, setShowRejectReason] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [actionState, setActionState] = useState(null); // 'approving' | 'rejecting' | null
  const [actionError, setActionError] = useState(null);
  // Set true only when THIS session's approval gate actually fires the
  // request — never on a dispute that loads already submitted — so
  // VerificationStamp animates for the live moment and renders at-rest
  // (already drawn, no typing effect) everywhere else. Part C's whole point
  // is that "checked" and "clicked" look different; this flag is how.
  const [justApproved, setJustApproved] = useState(false);

  const [pendingActionState, setPendingActionState] = useState(null); // 'drafting' | 'marking_lost' | null
  const [pendingActionError, setPendingActionError] = useState(null);
  const [showMarkLostReason, setShowMarkLostReason] = useState(false);
  const [markLostReason, setMarkLostReason] = useState('');

  const { onUpdate } = useSocketContext();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([getDispute(disputeId), getConfig()])
      .then(([d, cfg]) => {
        if (cancelled) return;
        setDispute(d);
        setDraftText(d.evidencePacket?.content ?? '');
        setThreshold(cfg.confidenceThreshold);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [disputeId]);

  useEffect(() => {
    return onUpdate((updated) => {
      if (updated.id !== disputeId) return;
      getDispute(disputeId)
        .then((d) => {
          setDispute(d);
          setDraftText((prev) => (editing ? prev : d.evidencePacket?.content ?? ''));
        })
        .catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disputeId, onUpdate]);

  async function handleApprove(pin) {
    setActionState('approving');
    setActionError(null);
    try {
      const result = await approveDispute(disputeId, reviewerName, pin);
      setDispute((prev) => ({ ...prev, ...result.dispute, evidencePacket: result.evidencePacket }));
      setEditing(false);
      setJustApproved(true);
    } catch (err) {
      setActionError(err.message);
    } finally {
      setActionState(null);
    }
  }

  async function handleReject() {
    if (!showRejectReason) {
      setShowRejectReason(true);
      return;
    }
    setActionState('rejecting');
    setActionError(null);
    try {
      const result = await rejectDispute(disputeId, reviewerName, rejectReason);
      setDispute((prev) => ({ ...prev, ...result.dispute, evidencePacket: result.evidencePacket }));
      setShowRejectReason(false);
      setEditing(false);
    } catch (err) {
      setActionError(err.message);
    } finally {
      setActionState(null);
    }
  }

  async function handleDraftEvidence() {
    setPendingActionState('drafting');
    setPendingActionError(null);
    try {
      await draftEvidenceForDispute(disputeId, reviewerName);
      const fresh = await getDispute(disputeId);
      setDispute(fresh);
      setDraftText(fresh.evidencePacket?.content ?? '');
    } catch (err) {
      setPendingActionError(err.message);
    } finally {
      setPendingActionState(null);
    }
  }

  async function handleMarkLost() {
    if (!showMarkLostReason) {
      setShowMarkLostReason(true);
      return;
    }
    setPendingActionState('marking_lost');
    setPendingActionError(null);
    try {
      const result = await markDisputeLost(disputeId, reviewerName, markLostReason);
      setDispute((prev) => ({ ...prev, ...result.dispute }));
      setShowMarkLostReason(false);
    } catch (err) {
      setPendingActionError(err.message);
    } finally {
      setPendingActionState(null);
    }
  }

  const risk = dispute ? parseRiskAssessment(dispute.auditLogs) : null;
  const evidenceWhy = dispute ? parseEvidenceWhy(dispute.auditLogs) : null;
  const pendingReviewReason = dispute ? parsePendingReviewReason(dispute.auditLogs) : null;
  const evidenceFlags = dispute ? parseEvidenceFlags(dispute.auditLogs) : null;
  const contestResult = dispute ? parseContestResult(dispute.auditLogs) : null;
  const showEvidenceSection = dispute && dispute.status !== 'lost' && dispute.evidencePacket;
  const showPendingReviewActions = dispute && dispute.status === 'pending_review';
  const edited = dispute?.evidencePacket && draftText !== dispute.evidencePacket.content;
  const isSubmitted = dispute?.evidencePacket?.status === 'submitted';

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button
        type="button"
        aria-label="Close dispute detail"
        onClick={onClose}
        className="absolute inset-0 bg-(--color-graphite)/30"
      />

      {/* This drawer keeps its shadow — genuinely floating above the page,
          the one exception to "borders over shadows" per the brief. */}
      <div className="relative z-50 flex h-full w-full max-w-xl flex-col overflow-y-auto bg-porcelain shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded p-1.5 text-graphite-muted transition-colors hover:bg-hairline/50 hover:text-(--color-graphite) focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt-600"
          aria-label="Close"
        >
          ✕
        </button>

        {loading && <div className="p-8 text-sm text-graphite-muted">Loading dispute…</div>}

        {error && (
          <div className="m-8 rounded border border-danger-100 bg-danger-50 px-4 py-3 text-sm text-danger-700">
            Failed to load dispute: {error}
          </div>
        )}

        {dispute && (
          <>
            <div className="border-b border-hairline bg-paper px-8 py-6">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display text-3xl font-semibold tabular-nums text-(--color-graphite)">
                    {formatCurrency(dispute.amount, dispute.currency)}
                  </p>
                  <p className="mt-1 truncate font-mono text-xs text-graphite-muted">{dispute.razorpayId}</p>
                  <p className="mt-2 text-sm text-graphite-muted">{dispute.reasonCode}</p>
                  {dispute.razorpayPaymentId && (
                    <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-cobalt-600 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-cobalt-600">
                      Real Razorpay payment · <span className="font-mono normal-case">{dispute.razorpayPaymentId}</span>
                    </p>
                  )}
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${statusBadgeClasses(dispute.status)}`}>
                  {STATUS_LABEL[dispute.status] ?? dispute.status}
                </span>
              </div>

              <div className="mt-4">
                <SlaCountdown deadline={dispute.slaDeadline} variant="header" />
              </div>
            </div>

            <div className="mx-6 mt-6 rounded border border-hairline bg-paper p-6">
              <h2 className="text-sm font-semibold text-(--color-graphite)">Risk Assessment</h2>

              {!risk && (
                <p className="mt-3 text-sm text-graphite-muted">
                  {dispute.status === 'needs_attention'
                    ? 'Automated scoring failed — see the audit trail for details.'
                    : 'Not yet scored.'}
                </p>
              )}

              {risk && (
                <>
                  <p className="mt-2 text-sm text-graphite-muted">{risk.summary}</p>
                  {threshold != null && (
                    <div className="mt-4">
                      <ConfidenceGauge score={risk.score} threshold={threshold} />
                    </div>
                  )}
                  <SignalsList signals={risk.signals} />
                </>
              )}
            </div>

            {showPendingReviewActions && (
              <div className="mx-6 mb-6 mt-6 rounded border border-hairline bg-paper p-6">
                <h2 className="text-sm font-semibold text-(--color-graphite)">Pending Review</h2>

                {!pendingReviewReason && (
                  <p className="mt-2 text-sm text-graphite-muted">
                    This dispute needs a human risk judgment before evidence is drafted.
                  </p>
                )}

                {pendingReviewReason?.kind === 'text' && (
                  <p className="mt-2 text-sm text-graphite-muted">Routed here because: {pendingReviewReason.text}</p>
                )}

                {/* PART A (point 6): "Models disagree" — distinct from the
                    score-proximity/high-value text case, both scores shown
                    side by side rather than folded into one sentence. */}
                {pendingReviewReason?.kind === 'model_disagreement' && (
                  <div className="mt-2">
                    <p className="text-sm font-medium text-danger-700">Models disagree</p>
                    <p className="mt-1 text-xs text-graphite-muted">
                      The LLM risk scorer and the baseline classifier reached opposite verdicts — routed for a human
                      call rather than trusting either one alone.
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-3">
                      <div className="rounded border border-hairline bg-porcelain p-2.5">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-graphite-muted">LLM (risk scorer)</p>
                        <p className="mt-1 text-lg font-semibold tabular-nums text-(--color-graphite)">
                          {Math.round(pendingReviewReason.llmScore * 100)}%
                        </p>
                        <p className="text-xs capitalize text-graphite-muted">{pendingReviewReason.llmVerdict.replace(/_/g, ' ')}</p>
                      </div>
                      <div className="rounded border border-hairline bg-porcelain p-2.5">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-graphite-muted">Baseline classifier</p>
                        <p className="mt-1 text-lg font-semibold tabular-nums text-(--color-graphite)">
                          {Math.round(pendingReviewReason.classifierScore * 100)}%
                        </p>
                        <p className="text-xs capitalize text-graphite-muted">
                          {pendingReviewReason.classifierVerdict.replace(/_/g, ' ')}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {pendingActionError && (
                  <p className="mt-2 rounded bg-danger-50 px-3 py-2 text-xs text-danger-700">{pendingActionError}</p>
                )}

                <div className="mt-4 space-y-3">
                  <input
                    type="text"
                    value={reviewerName}
                    onChange={(e) => setReviewerName(e.target.value)}
                    placeholder="Reviewer name"
                    className="w-full rounded border border-hairline bg-paper px-3 py-2 text-sm text-(--color-graphite) focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt-600"
                  />

                  {showMarkLostReason && (
                    <textarea
                      value={markLostReason}
                      onChange={(e) => setMarkLostReason(e.target.value)}
                      placeholder="Reason for marking lost…"
                      rows={2}
                      className="w-full rounded border border-danger-100 bg-paper px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt-600"
                    />
                  )}

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleDraftEvidence}
                      disabled={pendingActionState !== null}
                      className="rounded bg-cobalt-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-cobalt-700 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt-600"
                    >
                      {pendingActionState === 'drafting' ? 'Drafting…' : 'Draft Evidence'}
                    </button>
                    <button
                      type="button"
                      onClick={handleMarkLost}
                      disabled={pendingActionState !== null}
                      className="rounded border border-danger-200 bg-paper px-4 py-2.5 text-sm font-medium text-danger-700 transition-colors hover:bg-danger-50 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt-600"
                    >
                      {pendingActionState === 'marking_lost' ? 'Marking lost…' : showMarkLostReason ? 'Confirm mark lost' : 'Mark Lost'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {showEvidenceSection && (
              <div className="mx-6 mb-6 mt-6 rounded border border-hairline bg-paper p-6">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-(--color-graphite)">Evidence Packet</h2>
                  {isSubmitted && (
                    <VerificationStamp code={pseudoVerificationCode(dispute.id)} animate={justApproved} />
                  )}
                </div>

                {evidenceWhy && <p className="mt-2 text-sm italic text-graphite-muted">{evidenceWhy.whyThisEvidence}</p>}

                {dispute.evidencePacket.verificationStatus === 'flagged' && (
                  <div className="mt-3 rounded border-2 border-danger-200 bg-danger-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-danger-700">
                      ⚠ Evidence verification flagged this draft
                    </p>
                    <p className="mt-1 text-xs text-danger-700">
                      A rules-based check (not the LLM grading itself) found the draft cites evidence that doesn't
                      actually support the case:
                    </p>
                    {evidenceFlags && (
                      <ul className="mt-2 space-y-1 text-xs text-danger-700">
                        {evidenceFlags.map((f, i) => (
                          <li key={i}>
                            <span className="font-semibold">{f.artifact}:</span> {f.reason}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                <EvidenceArtifacts
                  evidenceContext={dispute.evidenceContext}
                  citedArtifacts={evidenceWhy?.citedArtifacts}
                  ce3Qualification={evidenceWhy?.ce3Qualification}
                />

                <textarea
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  readOnly={!editing}
                  rows={10}
                  className={`mt-3 w-full rounded border p-3 font-mono text-xs leading-relaxed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt-600 ${
                    editing ? 'border-cobalt-600 bg-paper' : 'border-hairline bg-porcelain text-graphite-muted'
                  }`}
                />

                {edited && (
                  <p className="mt-2 text-xs text-caution-700">
                    Edits aren't saved to the server yet — Approve will submit the original draft, not your edits.
                  </p>
                )}

                {actionError && (
                  <p className="mt-2 rounded bg-danger-50 px-3 py-2 text-xs text-danger-700">{actionError}</p>
                )}

                {dispute.evidencePacket.status === 'draft' ? (
                  <div className="mt-4 space-y-3">
                    <input
                      type="text"
                      value={reviewerName}
                      onChange={(e) => setReviewerName(e.target.value)}
                      placeholder="Reviewer name"
                      className="w-full rounded border border-hairline bg-paper px-3 py-2 text-sm text-(--color-graphite) focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt-600"
                    />

                    {showRejectReason && (
                      <textarea
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        placeholder="Reason for rejecting…"
                        rows={2}
                        className="w-full rounded border border-danger-100 bg-paper px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt-600"
                      />
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                      <ApprovalGate disputeId={disputeId} onConfirm={handleApprove} busy={actionState === 'approving'} />
                      <button
                        type="button"
                        onClick={() => setEditing((v) => !v)}
                        disabled={actionState !== null}
                        className="rounded border border-hairline bg-paper px-4 py-2.5 text-sm font-medium text-(--color-graphite) transition-colors hover:bg-porcelain disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt-600"
                      >
                        {editing ? 'Stop editing' : 'Edit'}
                      </button>
                      <button
                        type="button"
                        onClick={handleReject}
                        disabled={actionState !== null}
                        className="rounded border border-danger-200 bg-paper px-4 py-2.5 text-sm font-medium text-danger-700 transition-colors hover:bg-danger-50 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt-600"
                      >
                        {actionState === 'rejecting' ? 'Rejecting…' : showRejectReason ? 'Confirm reject' : 'Reject'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 rounded bg-porcelain px-3 py-2.5 text-sm text-graphite-muted">
                    {dispute.evidencePacket.status === 'submitted'
                      ? 'Submitted — no further action needed.'
                      : `Resolved: ${dispute.evidencePacket.status}. No further action available.`}
                  </div>
                )}

                {/* Razorpay buildathon integration: the real Disputes API
                    contest attempt's outcome — shown regardless of success/
                    failure, since a "failed" result (typically Razorpay's
                    404 for a dispute id test mode has no way to create) is
                    still useful proof the integration is real, not hidden
                    as an error. */}
                {contestResult && (
                  <div
                    className={`mt-3 rounded border p-3 text-xs ${
                      contestResult.status === 'submitted' ? 'border-success-600 bg-success-50 text-success-700' : 'border-hairline bg-porcelain text-graphite-muted'
                    }`}
                  >
                    <p className="font-semibold uppercase tracking-wide">
                      {contestResult.status === 'submitted' ? '✓ Submitted to Razorpay Disputes API' : 'Razorpay Disputes API contest attempt'}
                    </p>
                    {contestResult.status === 'submitted' ? (
                      <p className="mt-1 font-mono">document: {contestResult.documentId}</p>
                    ) : (
                      <p className="mt-1">{contestResult.reason}</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
