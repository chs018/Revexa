jest.mock('../src/agents/pipeline', () => ({
  runScoringPipeline: jest.fn().mockResolvedValue({ stage: 'scoring', status: 'needs_attention' }),
}));

const request = require('supertest');
const app = require('../src/index');
const prisma = require('../src/lib/prisma');
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
          payment_id: 'pay_TestPayment002',
          amount: 49900,
          currency: 'INR',
          amount_deducted: 49900,
          reason_code: 'duplicate_charge',
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

describe('POST /webhooks/razorpay — signature rejection', () => {
  test('an invalid signature returns 400 and creates no Dispute row', async () => {
    const razorpayId = uniqueRazorpayId('disp_TEST_BADSIG');
    const payload = buildPayload(razorpayId);
    const rawBody = JSON.stringify(payload);

    const res = await request(app)
      .post('/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', 'deadbeef'.repeat(8)) // well-formed hex, wrong value
      .send(rawBody);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_signature');

    const rows = await prisma.dispute.findMany({ where: { razorpayId } });
    expect(rows).toHaveLength(0);
  });

  test('a missing signature header also returns 400 and creates no row', async () => {
    const razorpayId = uniqueRazorpayId('disp_TEST_NOSIG');
    const payload = buildPayload(razorpayId);
    const rawBody = JSON.stringify(payload);

    const res = await request(app)
      .post('/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .send(rawBody);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_signature');

    const rows = await prisma.dispute.findMany({ where: { razorpayId } });
    expect(rows).toHaveLength(0);
  });
});
