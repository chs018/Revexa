module.exports = {
  testEnvironment: 'node',
  // Runs after the test framework is installed but before each test FILE's
  // own code — resets the (genuinely separate) test database once per
  // file. See tests/setup.js for why this is safe to do unconditionally.
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  // Long-running by test standards (real Postgres round trips over the
  // network to Neon, not a local/in-memory DB) — the default 5s Jest
  // timeout is too tight for that plus a dwell-time test that has to
  // actually wait out a real MIN_REVIEW_SECONDS.
  testTimeout: 20000,
  // One worker: every test file shares the SAME test database (reset
  // before each file, not each test) — running files in parallel would let
  // one file's reset wipe another file's still-running assertions out from
  // under it.
  maxWorkers: 1,
  // @prisma/adapter-pg's internal pg Pool doesn't always close every
  // underlying socket by the time prisma.$disconnect() (tests/setup.js's
  // afterAll) resolves for a Neon/SSL connection — a known driver-adapter
  // quirk, not a leak in this app's own code (each test file only ever
  // opens the one pool lib/prisma.js creates, and disconnects it). Left
  // alone, a straggling reconnect can fire after Jest has already torn a
  // test file's environment down and crash the whole run with a
  // "require after teardown" error even though every test itself passed.
  // forceExit accepts that trade: Jest kills the process once its own
  // results are in, instead of waiting out handles that were always going
  // to close on their own.
  forceExit: true,
};
