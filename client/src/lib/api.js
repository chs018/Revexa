// Thin fetch wrapper for the initial page load. Pattern for this whole app:
// fetch current state once via REST on mount, then let the socket
// (useSocket.js) keep it updated — never poll on an interval.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';

async function request(path, options) {
  const res = await fetch(`${API_BASE_URL}${path}`, options);

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || body.error || `Request failed: ${res.status}`);
  }

  return res.json();
}

export function getDisputes(params) {
  const qs = params ? `?${new URLSearchParams(params)}` : '';
  return request(`/disputes${qs}`);
}

export function getDispute(id) {
  return request(`/disputes/${id}`);
}

export function getAuditLogs(params) {
  const qs = params ? `?${new URLSearchParams(params)}` : '';
  return request(`/audit-logs${qs}`);
}

export function getConfig() {
  return request('/config');
}

export function getMetrics() {
  return request('/metrics');
}

export function getMetricsMl() {
  return request('/metrics-ml');
}

// Review gate: start-review timestamps the server-side dwell clock; approve
// now requires the pin it's checked against. See ApprovalGate.jsx.
export function startReview(id) {
  return request(`/disputes/${id}/start-review`, { method: 'POST' });
}

export function approveDispute(id, reviewerName, pin) {
  return request(`/disputes/${id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewerName, pin }),
  });
}

export function rejectDispute(id, reviewerName, reason) {
  return request(`/disputes/${id}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewerName, reason }),
  });
}

// GAP 2: the two actions available on a "pending_review" dispute, in place
// of approve/reject (there's no evidence packet yet to approve or reject).
export function draftEvidenceForDispute(id, reviewerName) {
  return request(`/disputes/${id}/draft-evidence`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewerName }),
  });
}

export function markDisputeLost(id, reviewerName, reason) {
  return request(`/disputes/${id}/mark-lost`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewerName, reason }),
  });
}

// Razorpay buildathon integration: creates a real Razorpay test-mode Order
// server-side (server has the API secret; the client never sees it).
export function createRazorpayOrder(amount, currency) {
  return request('/demo/create-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount, currency }),
  });
}

// Called after Razorpay Checkout succeeds client-side, with the exact
// { razorpay_order_id, razorpay_payment_id, razorpay_signature } object
// Checkout's own success handler provides — the server re-verifies the
// signature itself rather than trusting the client's word that it succeeded.
export function recordRealPayment(checkoutResponse, reasonCode) {
  return request('/demo/record-real-payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...checkoutResponse, reasonCode }),
  });
}
