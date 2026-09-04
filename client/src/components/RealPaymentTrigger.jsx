import { useRef, useState } from 'react';
import { createRazorpayOrder, recordRealPayment } from '../lib/api';

// Razorpay buildathon integration: this is the one place in the app that
// actually opens Razorpay's real (test-mode) Checkout — everywhere else,
// "trigger a dispute" means a self-signed synthetic webhook. This path is
// genuinely real: a real Order (Orders API), a real Checkout session, a
// real captured Payment, a real signature verification, and the resulting
// dispute is tagged with that real payment_id so the risk scorer and
// evidence agent can pull the real Payments API record into their prompts
// (see razorpayPayment.js) — every downstream feature (evidence, the
// pending_review guardrail, metrics) treats it exactly like any other
// dispute, since it flows through the same verifyAndIngestDisputeWebhook
// path (see routes/demo.js's /record-real-payment).
const REASON_CODES = [
  { value: '', label: 'Random reason code' },
  { value: 'goods_not_received', label: 'Goods not received' },
  { value: 'unauthorized_transaction', label: 'Unauthorized transaction' },
  { value: 'duplicate_charge', label: 'Duplicate charge' },
  { value: 'product_not_as_described', label: 'Product not as described' },
];

// Razorpay's own documented domestic Visa test card (see
// https://razorpay.com/docs/payments/payments/test-card-details/) — the
// generic 4111 1111 1111 1111 dummy number many gateways use for testing
// is NOT one of Razorpay's own test cards and reads as an international
// BIN to their system, which rejects it with "International cards are not
// supported." Confirmed by hitting that exact error before switching to
// this number.
const TEST_CARD_HINT = 'Test card: 4100 2800 0000 1007 · any future expiry · any CVV · any OTP if prompted';

export default function RealPaymentTrigger() {
  const [reasonCode, setReasonCode] = useState('');
  const [state, setState] = useState('idle'); // 'idle' | 'creating-order' | 'awaiting-checkout' | 'recording' | 'done' | 'error'
  const [message, setMessage] = useState(null);
  // handleClick's closures (handler/ondismiss) capture `state` as it was at
  // the moment they were created, which is BEFORE the setState('awaiting-
  // checkout') call below takes effect — reading `state` inside them would
  // always see the stale pre-click value, not the current one. A ref sees
  // the current value regardless of which render's closure reads it.
  const handlerFiredRef = useRef(false);

  async function handleClick() {
    if (!window.Razorpay) {
      setState('error');
      setMessage('Razorpay Checkout script failed to load — check your network connection.');
      return;
    }

    setState('creating-order');
    setMessage(null);

    let order;
    try {
      order = await createRazorpayOrder();
    } catch (err) {
      setState('error');
      setMessage(`Couldn't create a Razorpay order: ${err.message}`);
      return;
    }

    setState('awaiting-checkout');
    handlerFiredRef.current = false;

    const checkout = new window.Razorpay({
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amount,
      currency: order.currency,
      name: 'Revexa (test mode)',
      description: 'Buildathon demo — real Razorpay test-mode payment',
      theme: { color: '#2D4FD6' }, // cobalt-600
      handler: async (response) => {
        handlerFiredRef.current = true;
        setState('recording');
        try {
          const result = await recordRealPayment(response, reasonCode || undefined);
          setState('done');
          setMessage(
            result.duplicate
              ? 'Payment recorded, but this exact payment was already turned into a dispute — check the Queue.'
              : `Real payment ${response.razorpay_payment_id} captured — dispute triggered and scoring now. Check the Queue or Dashboard feed.`
          );
        } catch (err) {
          setState('error');
          setMessage(`Payment succeeded on Razorpay, but recording the dispute failed: ${err.message}`);
        }
      },
      modal: {
        ondismiss: () => {
          // Only resets to idle if the modal closed WITHOUT a successful
          // payment (handler never fired) — closing after a completed
          // payment shouldn't stomp the success message handler just set.
          if (!handlerFiredRef.current) {
            setState('idle');
            setMessage('Checkout closed without completing payment.');
          }
        },
      },
    });

    checkout.on('payment.failed', (resp) => {
      setState('error');
      setMessage(`Payment failed: ${resp.error?.description || 'unknown error'}`);
    });

    checkout.open();
  }

  const busy = state === 'creating-order' || state === 'awaiting-checkout' || state === 'recording';

  return (
    <div className="rounded border border-hairline bg-paper p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-graphite-muted">Razorpay buildathon integration</p>
      <h2 className="mt-1 font-display text-sm font-semibold text-(--color-graphite)">Create a real payment</h2>
      <p className="mt-1 text-xs text-graphite-muted">
        Opens real Razorpay Checkout (test mode) — a genuine Order, Payment, and signature verification, not a
        synthetic webhook. The resulting dispute is backed by that real payment_id end to end.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={reasonCode}
          onChange={(e) => setReasonCode(e.target.value)}
          disabled={busy}
          className="rounded border border-hairline bg-paper px-2 py-1.5 text-xs text-(--color-graphite) focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt-600"
        >
          {REASON_CODES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleClick}
          disabled={busy}
          className="rounded bg-cobalt-600 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-cobalt-700 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt-600"
        >
          {state === 'creating-order' ? 'Creating order…' : state === 'recording' ? 'Recording…' : 'Pay with Razorpay'}
        </button>
      </div>

      <p className="mt-2 font-mono text-[10px] text-graphite-muted">{TEST_CARD_HINT}</p>

      {message && (
        <p className={`mt-2 text-xs ${state === 'error' ? 'text-danger-700' : 'text-graphite-muted'}`}>{message}</p>
      )}
    </div>
  );
}
