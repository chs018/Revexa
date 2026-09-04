const razorpay = require('./razorpayClient');

// Razorpay buildathon integration: calls the real Payments API
// (razorpay.payments.fetch) for disputes backed by a genuine test-mode
// payment (Dispute.razorpayPaymentId set — see routes/demo.js's
// /create-order + /record-real-payment flow). Never throws — a missing
// paymentId, a fetch failure, or hitting this for a dispute that predates
// the flow (no real payment behind it) all just return null, same
// never-throws convention as ensureTransactionContext() and the agents.
//
// Only a normalized subset of Razorpay's payment fields is returned —
// exactly what's useful as evidence (method, contact, capture status,
// refund history, timestamps) — not the raw API response, so callers don't
// need to know Razorpay's full payment entity shape.
async function fetchRealPaymentRecord(paymentId) {
  if (!paymentId) return null;

  try {
    const payment = await razorpay.payments.fetch(paymentId);
    return {
      id: payment.id,
      orderId: payment.order_id,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      method: payment.method,
      captured: payment.captured,
      amountRefunded: payment.amount_refunded,
      email: payment.email,
      contact: payment.contact,
      createdAt: payment.created_at ? new Date(payment.created_at * 1000).toISOString() : null,
    };
  } catch (err) {
    // Same non-Error throw shape as razorpayContest.js's disputes.contest()
    // call — the SDK throws { statusCode, error } directly, not an Error,
    // so err.message is usually undefined here.
    const detail = err.error?.description || (err.statusCode ? `HTTP ${err.statusCode}` : err.message || 'unknown error');
    console.warn(`[razorpayPayment] fetchRealPaymentRecord(${paymentId}) failed: ${detail}`);
    return null;
  }
}

module.exports = { fetchRealPaymentRecord };
