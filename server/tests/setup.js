require('dotenv').config();

// Belt-and-suspenders: Jest sets this automatically, but lib/prisma.js's
// safety guard (never fall back to the real database) depends on it being
// set, so make it explicit here too rather than trust an implicit default.
process.env.NODE_ENV = 'test';

if (!process.env.TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL must be set to run tests — see .env.example.');
}
if (process.env.TEST_DATABASE_URL === process.env.DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL must not equal DATABASE_URL — refusing to run tests against the real database.');
}

const prisma = require('../src/lib/prisma');

// Resets the test database before THIS FILE's test suite runs (once per
// file, not once per individual test) — deletes all rows in FK-safe order
// rather than dropping/recreating the schema, since the schema is already
// correct via `prisma migrate deploy` against TEST_DATABASE_URL and only
// the DATA needs to be wiped so one file's fixtures can never leak into
// another's assertions. jest.config.js's maxWorkers: 1 is what makes this
// safe — test files never run concurrently against the same database.
beforeAll(async () => {
  await prisma.auditLog.deleteMany();
  await prisma.evidencePacket.deleteMany();
  await prisma.dispute.deleteMany();
});

afterAll(async () => {
  // /disputes/:id/approve fires submitRealContest(...).then(...) without
  // awaiting it (routes/disputes.js) — deliberately, so a slow real
  // Razorpay call never holds up the approve response. Tests that hit
  // /approve don't await that chain either (it's not part of the response
  // they're asserting on), so it can still be mid-query — a fresh
  // connection borrow from the pool — right as this fires. Disconnecting
  // out from under it doesn't fail the test (the assertions already ran),
  // but it can crash the *next* test file: the stray connection's SSL
  // handshake completes after Jest has torn this file's module registry
  // down, and blows up trying to touch now-dead bindings. A short buffer
  // here lets any such straggler settle while the environment is still
  // alive, instead of forcing every /approve-calling test to know about
  // and wait out an implementation detail of a route it isn't testing.
  await new Promise((resolve) => setTimeout(resolve, 300));
  await prisma.$disconnect();
});
