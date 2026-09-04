const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

// Prisma 7 no longer reads the connection string from `datasource.url` in
// schema.prisma at runtime — the client needs an explicit driver adapter.
// (CLI commands like migrate/seed instead read DATABASE_URL from
// prisma.config.js.)
//
// Part B: Jest sets NODE_ENV=test automatically — when true, ALWAYS use
// TEST_DATABASE_URL (a genuinely separate database, see tests/setup.js),
// never DATABASE_URL. This throws rather than silently falling back if
// TEST_DATABASE_URL is missing — "never point tests at the real/demo
// database" has to be impossible to get wrong by omission, not just a
// convention tests are supposed to follow. Production and normal dev usage
// (NODE_ENV unset) are completely unaffected — this branch is unreachable
// outside `npm test`.
let connectionString = process.env.DATABASE_URL;
if (process.env.NODE_ENV === 'test') {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error(
      'TEST_DATABASE_URL must be set when NODE_ENV=test — refusing to fall back to DATABASE_URL (the real database) for tests.'
    );
  }
  if (process.env.TEST_DATABASE_URL === process.env.DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL must not equal DATABASE_URL — refusing to run tests against the real database.');
  }
  connectionString = process.env.TEST_DATABASE_URL;
}

const adapter = new PrismaPg({ connectionString });

// Single shared Prisma client for the whole process — routes and index.js
// all require this instead of instantiating their own, so we don't open a
// new connection pool per module.
const prisma = new PrismaClient({ adapter });

module.exports = prisma;
