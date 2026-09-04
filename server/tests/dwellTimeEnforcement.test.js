jest.mock('../src/lib/razorpayContest', () => ({
  submitRealContest: jest.fn().mockResolvedValue({ status: 'skipped', reason: 'test mock' }),
}));

const request = require('supertest');
const app = require('../src/index');
const prisma = require('../src/lib/prisma');
const { createDraftedDispute } = require('./helpers');

describe('POST /disputes/:id/approve — dwell-time enforcement', () => {
  const originalPin = process.env.REVIEW_PIN;
  const originalMinReview = process.env.MIN_REVIEW_SECONDS;

  beforeAll(() => {
    process.env.REVIEW_PIN = 'TEST_PIN';
    process.env.MIN_REVIEW_SECONDS = '3'; // real, nonzero dwell time for this file
  });

  afterAll(() => {
    process.env.REVIEW_PIN = originalPin;
    process.env.MIN_REVIEW_SECONDS = originalMinReview;
  });

  test('approving without ever calling start-review returns 400 review_not_started', async () => {
    const dispute = await createDraftedDispute();

    const res = await request(app)
      .post(`/disputes/${dispute.id}/approve`)
      .send({ reviewerName: 'Test Reviewer', pin: 'TEST_PIN' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('review_not_started');

    const fresh = await prisma.dispute.findUnique({ where: { id: dispute.id } });
    expect(fresh.status).toBe('drafted');
  });

  test('start-review then immediate approve returns 400 review_too_soon', async () => {
    const dispute = await createDraftedDispute();

    const started = await request(app).post(`/disputes/${dispute.id}/start-review`);
    expect(started.status).toBe(200);
    expect(started.body.dispute.reviewStartedAt).toBeTruthy();

    const res = await request(app)
      .post(`/disputes/${dispute.id}/approve`)
      .send({ reviewerName: 'Test Reviewer', pin: 'TEST_PIN' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('review_too_soon');

    const fresh = await prisma.dispute.findUnique({ where: { id: dispute.id } });
    expect(fresh.status).toBe('drafted');
  });

  test('start-review then waiting out the dwell time lets approve succeed', async () => {
    const dispute = await createDraftedDispute();

    const started = await request(app).post(`/disputes/${dispute.id}/start-review`);
    expect(started.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 3100));

    const res = await request(app)
      .post(`/disputes/${dispute.id}/approve`)
      .send({ reviewerName: 'Test Reviewer', pin: 'TEST_PIN' });

    expect(res.status).toBe(200);
    expect(res.body.dispute.status).toBe('submitted');
    expect(res.body.dispute.reviewStartedAt).toBeNull();
  }, 10000);
});
