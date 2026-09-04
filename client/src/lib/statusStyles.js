// Shared status → label/tone/badge mapping, used by ActivityFeed (Day 5),
// the Queue table, and the Detail drawer (Day 6) — one source of truth so
// a status never renders differently in two places.
export const STATUS_LABEL = {
  new: 'New',
  scored: 'Scored',
  drafted: 'Drafted',
  pending_review: 'Pending Review',
  submitted: 'Submitted',
  won: 'Won',
  lost: 'Lost',
  needs_attention: 'Needs Attention',
};

// Longer, feed-style phrasing for the activity feed specifically. Kept as a
// fallback for feed rows that only have a `status` to go on (the REST-
// seeded historical rows in useSocket.js, which reflect a dispute's
// CURRENT state, not a specific moment) — anything with a real `_action`
// from a live event uses ACTION_EVENT_LABEL below instead, which is more
// precise (e.g. distinguishes "evidence flagged" from "evidence drafted"
// even though both leave status at "drafted").
export const STATUS_EVENT_LABEL = {
  new: 'New dispute created',
  scored: 'Risk scored',
  drafted: 'Evidence drafted — ready for review',
  pending_review: 'Pending review',
  submitted: 'Submitted to bank',
  won: 'Dispute won',
  lost: 'Dispute lost',
  needs_attention: 'Needs attention — automated step failed',
};

// Live Activity feed rework: every emitDisputeUpdate() call site across the
// server now passes the same short action string it's already writing to
// AuditLog (see lib/socket.js's jsdoc) — this is the precise, "what just
// happened" label, one entry per actual emit point, not per DisputeStatus
// value. Two different actions can legitimately leave a dispute at the
// same status (e.g. "drafted" and "evidence_flagged" both leave
// status: "drafted") and this is what lets the feed tell them apart.
export const ACTION_EVENT_LABEL = {
  dispute_created: 'New dispute created',
  scored: 'Risk scored',
  routed_to_pending_review: 'Routed for human review',
  threshold_passed: 'Cleared threshold — drafting evidence',
  threshold_failed: 'Below threshold — marked lost',
  drafted: 'Evidence drafted — ready for review',
  evidence_flagged: 'Evidence flagged — citation contradicts the data',
  drafting_failed: 'Evidence drafting failed',
  scoring_failed: 'Risk scoring failed',
  approved: 'Approved by reviewer',
  submitted_to_bank: 'Submitted to bank',
  rejected: 'Rejected by reviewer',
  requested_draft_evidence: 'Reviewer requested an evidence draft',
  marked_lost: 'Marked lost by reviewer',
  razorpay_contest_submitted: 'Submitted to the real Razorpay Disputes API',
  razorpay_contest_failed: 'Razorpay contest attempt did not go through',
};

// Per-action tone override — falls back to STATUS_TONE when an action isn't
// listed here. Exists because an action's own severity can differ from the
// status it leaves behind: "evidence_flagged" is a real warning even though
// the dispute's status stays "drafted" (an "accent"-toned status).
export const ACTION_TONE = {
  evidence_flagged: 'caution',
  scoring_failed: 'critical',
  drafting_failed: 'critical',
  razorpay_contest_failed: 'caution',
  razorpay_contest_submitted: 'success',
  rejected: 'danger',
  marked_lost: 'danger',
  submitted_to_bank: 'success',
  approved: 'success',
  routed_to_pending_review: 'caution',
  threshold_failed: 'danger',
};

export const STATUS_TONE = {
  new: 'accent',
  scored: 'accent',
  drafted: 'accent',
  pending_review: 'caution',
  submitted: 'success',
  won: 'success',
  lost: 'danger',
  // Terracotta, not the shared "caution" amber used for weakens-signals —
  // a pipeline failure needing a human to look at it is not the same thing
  // as a routine risk signal, and shouldn't read like one. Every other
  // status's tone above is unchanged.
  needs_attention: 'critical',
};

// Visual system pass: status pills are now thin hairline-bordered outlines
// in each status's signal color, no fill — except critical/needs_attention,
// which stays solid terracotta per the brief ("no fill except critical").
// The signal colors themselves (success/caution/danger green/amber/red,
// terracotta critical) are UNCHANGED — only the fill-vs-outline treatment
// changed, matching the "borders over shadows/fills" shape language.
export const BADGE_CLASSES = {
  success: 'border border-success-600 text-success-700',
  caution: 'border border-caution-600 text-caution-700',
  danger: 'border border-danger-600 text-danger-700',
  accent: 'border border-cobalt-600 text-cobalt-700',
  critical: 'border-transparent bg-(--color-critical) text-white',
  neutral: 'border border-hairline text-graphite-muted',
};

export function statusTone(status) {
  return STATUS_TONE[status] ?? 'neutral';
}

export function statusBadgeClasses(status) {
  return BADGE_CLASSES[statusTone(status)];
}

// Resolves a feed event's headline: prefer the precise action-based label,
// fall back to the status-based one for seeded rows that only carry a
// current status (see useSocket.js's REST-seed effect).
export function activityLabel(event) {
  return ACTION_EVENT_LABEL[event._action] ?? STATUS_EVENT_LABEL[event.status] ?? event.status;
}

export function activityTone(event) {
  return ACTION_TONE[event._action] ?? statusTone(event.status);
}

export function activityBadgeClasses(event) {
  return BADGE_CLASSES[activityTone(event)];
}
