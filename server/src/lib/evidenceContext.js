// Builds the three distinct evidence artifacts (transactionLog,
// deliveryConfirmation, communicationTrail) for one dispute — GAP 1 fix:
// evidenceAgent.js used to get one flat context blob; now it gets these as
// real structured data it can cite by name.
//
// Deliberately generated ALONGSIDE the existing flat transaction-context
// fields (deliveryStatus etc.), not independently, so the two can never
// contradict each other — see lib/transactionContext.js, the only caller.

const CARRIERS = ['BlueDart', 'Delhivery', 'DTDC', 'FedEx', 'India Post'];
const SIGNATORIES = ['J. Sharma', 'A. Kumar', 'Front Desk', 'R. Patel', null];

// GAP 1: reason codes that map to Visa's card-not-present fraud dispute
// category (Visa reason code 10.4) — the only ones Compelling Evidence 3.0
// actually applies to. Everything else uses the general evidence buckets
// below, not network-specific fraud evidence.
const CE3_REASON_CODES = ['unauthorized_transaction', 'fraudulent_transaction'];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function randomTrackingNumber() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  for (let i = 0; i < 10; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function daysBefore(base, days) {
  return new Date(base.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomBool(pTrue = 0.5) {
  return Math.random() < pTrue;
}

function randomTransactionId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 14; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return `pay_${id}`;
}

// 2-4 messages per reason code, varying by what the dispute is actually
// about — a goods_not_received customer asks about delivery, not a generic
// complaint. Ordered oldest-first; timestamps are assigned in that order.
const COMMUNICATION_TEMPLATES = {
  goods_not_received: [
    { from: 'customer', message: "Hi, it's been over a week and I still don't see my order. Can you check on this?" },
    { from: 'merchant', message: 'Sorry for the trouble — let me check with our courier partner and get back to you shortly.' },
    { from: 'merchant', message: 'Our tracking shows the package was marked delivered. Could you check with others at the address or a front desk?' },
  ],
  unauthorized_transaction: [
    { from: 'customer', message: "I don't recognize this charge on my card statement — I never placed this order." },
    { from: 'merchant', message: 'We can look into this — could you confirm the last 4 digits of the card used and your billing address?' },
    { from: 'customer', message: "I'd rather you just refund it." },
  ],
  duplicate_charge: [
    { from: 'customer', message: 'I think I was charged twice for the same order — can you check?' },
    { from: 'merchant', message: "We've reviewed the account and only see a single successful charge for this order." },
  ],
  product_not_as_described: [
    { from: 'customer', message: "The product I received doesn't match what was shown in the listing." },
    { from: 'merchant', message: 'Sorry to hear that — could you share a photo so we can look into it?' },
    { from: 'customer', message: "I'd rather just get a refund." },
    { from: 'merchant', message: 'Understood — we can offer a partial refund or an exchange, whichever you prefer.' },
  ],
  default: [
    { from: 'customer', message: 'I want to dispute this charge.' },
    { from: 'merchant', message: 'Could you tell us more about the issue so we can look into it?' },
  ],
};

function buildTransactionLog(baseDate, deliveryStatus) {
  const events = [
    { event: 'order_placed', timestamp: daysBefore(baseDate, 6) },
    { event: 'payment_captured', timestamp: daysBefore(baseDate, 6) },
    { event: 'shipment_created', timestamp: daysBefore(baseDate, 5) },
  ];
  if (deliveryStatus === 'delivered') {
    events.push({ event: 'delivered', timestamp: daysBefore(baseDate, 2) });
  }
  return events;
}

function buildDeliveryConfirmation(baseDate, deliveryStatus) {
  // deliveryConfirmation.status only has 3 values (delivered/not_delivered/
  // in_transit), one fewer than the flat deliveryStatus field's 4 (it also
  // has delivery_unconfirmed). Map delivery_unconfirmed -> not_delivered:
  // for evidence purposes, "can't confirm delivery happened" carries the
  // same weight as "confirmed not delivered" — neither supports the
  // merchant's case.
  const status = deliveryStatus === 'delivered' ? 'delivered' : deliveryStatus === 'in_transit' ? 'in_transit' : 'not_delivered';

  return {
    carrier: pick(CARRIERS),
    trackingNumber: randomTrackingNumber(),
    status,
    deliveredAt: status === 'delivered' ? daysBefore(baseDate, 2) : null,
    signedBy: status === 'delivered' ? pick(SIGNATORIES) : null,
  };
}

function buildCommunicationTrail(baseDate, reasonCode) {
  const template = COMMUNICATION_TEMPLATES[reasonCode] || COMMUNICATION_TEMPLATES.default;
  return template.map((msg, i) => ({
    timestamp: daysBefore(baseDate, template.length - i),
    from: msg.from,
    message: msg.message,
  }));
}

// GAP 1: Visa Compelling Evidence 3.0 — the actual evidence structure Visa's
// CE 3.0 policy defines for contesting 10.4 (card-not-present fraud)
// disputes: two or more prior UNDISPUTED transactions from the same
// cardholder, both at least 120 days old (and within the 365-day lookback
// CE 3.0 allows), plus at least two matching data elements between the
// prior transactions and the disputed one — one of which must be an IP
// address or device ID match (a billing name/address match alone isn't
// enough under the real rule; it has to include a device-level signal).
//
// Each of the four matchingDataElements and both priorUndisputedTransactions'
// previouslyDisputedOrFlagged are independently randomized rather than
// forced to always pass — daysBeforeDispute is the one field kept always
// inside Visa's real 120-365 window (that's a generation-validity
// constraint, not a qualification lever). This is deliberate: it's what
// lets evidenceAgent.js's qualification check (computed in code, not by the
// LLM) actually do something — some synthetic disputes qualify for CE 3.0,
// some don't, exactly like real cases would.
function buildCe3Evidence(baseDate) {
  const priorUndisputedTransactions = [1, 2].map(() => ({
    transactionId: randomTransactionId(),
    daysBeforeDispute: randomInt(120, 365),
    previouslyDisputedOrFlagged: randomBool(0.15), // usually clean, sometimes not
  }));

  const matchingDataElements = {
    userId: randomBool(),
    ipAddress: randomBool(),
    shippingAddress: randomBool(),
    deviceId: randomBool(),
  };

  return {
    priorUndisputedTransactions,
    matchingDataElements,
    billingDescriptorMatchesFirstSixChars: randomBool(0.7),
  };
}

/**
 * `deliveryStatus` must be the SAME value already generated for this
 * dispute's flat transaction context — passed in, not re-rolled here, so
 * transactionLog/deliveryConfirmation can never contradict it.
 *
 * GAP 1: also generates ce3Evidence, but only for reason codes CE 3.0
 * actually applies to (CE3_REASON_CODES) — everything else gets null there,
 * since attaching fraud-specific evidence to e.g. a goods_not_received
 * dispute would misrepresent what evidence exists for it.
 */
function generateEvidenceContext({ reasonCode, deliveryStatus, createdAt }) {
  const baseDate = createdAt ? new Date(createdAt) : new Date();

  return {
    transactionLog: buildTransactionLog(baseDate, deliveryStatus),
    deliveryConfirmation: buildDeliveryConfirmation(baseDate, deliveryStatus),
    communicationTrail: buildCommunicationTrail(baseDate, reasonCode),
    ce3Evidence: CE3_REASON_CODES.includes(reasonCode) ? buildCe3Evidence(baseDate) : null,
  };
}

module.exports = { generateEvidenceContext, CE3_REASON_CODES };
