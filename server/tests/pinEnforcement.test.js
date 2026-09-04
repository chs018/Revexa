jest.mock('../src/lib/razorpayContest', () => ({
  submitRealContest: jest.fn().mockResolvedValue({ status: 'skipped', reason: 'test mock' }),
}));

const request = require('supertest');
const app = require('../src/index');
const prisma = require('../src/lib/prisma');
const { createDraftedDispute } = require('./helpers');

describe('POST /disputes/:id/approve — PIN enforcement', () => {
  const originalPin = process.env.REVIEW_PIN;
  const originalMinReview = process.env.MIN_REVIEW_SECONDS;

  beforeAll(() => {
    process.env.REVIEW_PIN = 'TEST_PIN';
  });

  afterAll(() => {
    process.env.REVIEW_PIN = originalPin;
    process.env.MIN_REVIEW_SECONDS = originalMinReview;
  });

  test('wrong PIN returns 401 and leaves dispute/packet state untouched', async () => {
    process.env.MIN_REVIEW_SECONDS = '0';
    const dispute = await createDraftedDispute();

    const res = await request(app)
      .post(`/disputes/${dispute.id}/approve`)
      .send({ reviewerName: 'Test Reviewer', pin: 'WRONG_PIN' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_pin');

    const fresh = await prisma.dispute.findUnique({ where: { id: dispute.id } });
    expect(fresh.status).toBe('drafted');

    const packet = await prisma.evidencePacket.findUnique({ where: { disputeId: dispute.id } });
    expect(packet.status).toBe('draft');

    const approvedLogs = await prisma.auditLog.findMany({
      where: { disputeId: dispute.id, action: 'approved' },
    });
    expect(approvedLogs).toHaveLength(0);
  });

  test('correct PIN with MIN_REVIEW_SECONDS=0 succeeds', async () => {
    process.env.MIN_REVIEW_SECONDS = '0';
    const dispute = await createDraftedDispute();

    const res = await request(app)
      .post(`/disputes/${dispute.id}/approve`)
      .send({ reviewerName: 'Test Reviewer', pin: 'TEST_PIN' });

    expect(res.status).toBe(200);
    expect(res.body.dispute.status).toBe('submitted');
  });
});
