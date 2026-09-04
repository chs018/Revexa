const { Server } = require('socket.io');

let io = null;

/**
 * Attaches Socket.io to the existing HTTP server. Called once from
 * index.js at startup — everything else in the app just requires this
 * module and calls emitDisputeUpdate(), without needing to know about the
 * io instance itself.
 */
function initSocket(httpServer, options) {
  io = new Server(httpServer, options);
  return io;
}

/**
 * Emits "dispute:updated" with the dispute's current state. Call this at
 * real state-transition points only (dispute created, scored, drafted,
 * needs_attention, approved/rejected) — not on every DB write — so the
 * frontend's live feed reads as meaningful events, not noise.
 *
 * `action` (Live Activity feed rework): the same short action string the
 * caller is writing to AuditLog right alongside this call (e.g.
 * "dispute_created", "scored", "drafted") — every call site already has
 * this value sitting right next to the emit, so it costs nothing to pass
 * through. Carried in the payload as `_action` (underscore-prefixed, same
 * convention the client already uses for its own synthesized `_eventId`/
 * `_receivedAt` fields, to keep it visually distinct from real Dispute
 * columns). Lets the frontend render precisely "what just happened" and
 * de-dup on (disputeId, action) instead of (disputeId, status) — the old
 * status-only de-dup silently collapsed genuinely different moments that
 * happened to share a status (e.g. "routed to drafted" and "evidence
 * actually ready" both being status: "drafted") into a single feed row.
 * Optional and defaults to null so this isn't a breaking change for any
 * caller that doesn't pass one.
 *
 * No-ops (with a warning) if initSocket() hasn't run yet — this keeps
 * standalone scripts (seed.js, ad-hoc diagnostics) that require agents/lib
 * modules directly from crashing just because there's no HTTP server in
 * that context.
 */
function emitDisputeUpdate(dispute, action = null) {
  if (!io) {
    console.warn('emitDisputeUpdate() called before initSocket() — skipping emit.');
    return;
  }
  io.emit('dispute:updated', { ...dispute, _action: action });
}

module.exports = { initSocket, emitDisputeUpdate };
