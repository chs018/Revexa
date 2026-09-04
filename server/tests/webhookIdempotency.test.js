// The pipeline runs fire-and-forget after a new dispute is created (see
// webhookIngest.js) — mocked here so this test doesn't burn a real Gemini
// call for something it isn't testing at all.
jest.mock('../src/agents/pipeline', () => ({
  runScoringPipeline: jest.fn().mockResolvedValue({ stage: 'scoring', status: 'needs_attention' }),
}));

const request = require('supertest');
const app = require('../src/index');
const prisma = require('../src/lib/prisma');
const { signPayload } = require('../src/lib/razorpaySign');
const { uniqueRazorpayId } = require('./helpers');

function buildPayload(razorpayId) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    entity: 'event',
    account_id: 'acc_TestAccount',
    event: 'payment.dispute.created',
    contains: ['dispute'],
    payload: {
      dispute: {
        entity: {
          id: razorpayId,
          entity: 'dispute',
          payment_id: 'pay_TestPayment001',
          amount: 99900,
          currency: 'INR',
          amount_deducted: 99900,
          reason_code: 'goods_not_received',
          respond_by: nowSeconds + 7 * 24 * 60 * 60,
          status: 'open',
          phase: 'chargeback',
          created_at: nowSeconds,
        },
      },
    },
    created_at: nowSeconds,
  };
}

describe('POST /webhooks/razorpay — idempotency', () => {
  test('the same signed payload posted twice creates exactly one Dispute row', async () => {
    const razorpayId = uniqueRazorpayId('disp_TEST_IDEMPOTENT');
    const payload = buildPayload(razorpayId);
    const rawBody = JSON.stringify(payload);
    const signature = signPayload(rawBody);

    const first = await request(app)
      .post('/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', signature)
      .send(rawBody);

    expect(first.status).toBe(200);
    expect(first.body.received).toBe(true);
    expect(first.body.duplicate).toBe(false);

    const second = await request(app)
      .post('/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', signature)
      .send(rawBody);

    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.disputeId).toBe(first.body.disputeId);

    const rows = await prisma.dispute.findMany({ where: { razorpayId } });
    expect(rows).toHaveLength(1);
  });
});
