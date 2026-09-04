// /approve is guarded by an atomic updateMany({ where: { status: 'draft' } })
// — this test proves that guard actually prevents a second approval from
// going through, not just that it looks atomic on paper.
jest.mock('../src/lib/razorpayContest', () => ({
  submitRealContest: jest.fn().mockResolvedValue({ status: 'skipped', reason: 'test mock' }),
}));

const request = require('supertest');
const app = require('../src/index');
const prisma = require('../src/lib/prisma');
const { createDraftedDispute } = require('./helpers');

describe('POST /disputes/:id/approve — no double-approval', () => {
  const originalPin = process.env.REVIEW_PIN;
  const originalMinReview = process.env.MIN_REVIEW_SECONDS;

  beforeAll(() => {
    process.env.REVIEW_PIN = 'TEST_PIN';
    process.env.MIN_REVIEW_SECONDS = '0'; // dwell gate not under test here
  });

  afterAll(() => {
    process.env.REVIEW_PIN = originalPin;
    process.env.MIN_REVIEW_SECONDS = originalMinReview;
  });

  test('approving twice: first succeeds, second is rejected with 409 and no duplicate audit entries', async () => {
    const dispute = await createDraftedDispute();

    const first = await request(app)
      .post(`/disputes/${dispute.id}/approve`)
      .send({ reviewerName: 'Test Reviewer', pin: 'TEST_PIN' });

    expect(first.status).toBe(200);
    expect(first.body.dispute.status).toBe('submitted');
    expect(first.body.evidencePacket.status).toBe('submitted');

    const second = await request(app)
      .post(`/disputes/${dispute.id}/approve`)
      .send({ reviewerName: 'Test Reviewer', pin: 'TEST_PIN' });

    expect(second.status).toBe(409);
    expect(second.body.error).toBe('invalid_state');

    const approvedLogs = await prisma.auditLog.findMany({
      where: { disputeId: dispute.id, action: 'approved' },
    });
    expect(approvedLogs).toHaveLength(1);

    const submittedLogs = await prisma.auditLog.findMany({
      where: { disputeId: dispute.id, action: 'submitted_to_bank' },
    });
    expect(submittedLogs).toHaveLength(1);
  });
});
