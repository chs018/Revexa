require('dotenv').config();

const { defineConfig, env } = require('prisma/config');

// Prisma 7 reads the database connection for CLI commands (migrate, db push,
// db seed, studio, ...) from here rather than from a `url` in schema.prisma.
// The runtime PrismaClient (see src/lib/prisma.js) is configured separately
// via a driver adapter.
module.exports = defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
  migrations: {
    seed: 'node prisma/seed.js',
  },
});
