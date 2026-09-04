require('dotenv').config();

// One-off: applies the new columns by hand via $executeRawUnsafe (same
// workaround as every prior migration in this history — schema-engine
// blocked by Windows Application Control on this machine), AND backfills
// _prisma_migrations tracking rows for the two PRIOR migrations that got
// applied the same way but never recorded — `prisma migrate dev` just
// reported drift for both of them (razorpayPaymentId, verificationStatus)
// and offered to reset the whole database, which would have destroyed
// real accumulated demo/test data. Not meant to be rerun or generalized —
// a real environment should just use `prisma migrate deploy`.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const prisma = require('../src/lib/prisma');

const UNTRACKED_MIGRATIONS = [
  '20260826010000_gap_fixes_ce3_verification_status',
  '20260829000000_razorpay_payment_id',
  '20260830000000_model_disagreement_review_gate',
];

async function main() {
  await prisma.$executeRawUnsafe('ALTER TABLE "Dispute" ADD COLUMN IF NOT EXISTS "classifierScore" DOUBLE PRECISION;');
  await prisma.$executeRawUnsafe('ALTER TABLE "Dispute" ADD COLUMN IF NOT EXISTS "classifierVerdict" TEXT;');
  await prisma.$executeRawUnsafe('ALTER TABLE "Dispute" ADD COLUMN IF NOT EXISTS "reviewStartedAt" TIMESTAMP(3);');
  console.log('Applied: Dispute.classifierScore, classifierVerdict, reviewStartedAt');

  const existing = await prisma.$queryRawUnsafe('SELECT migration_name FROM _prisma_migrations;');
  const existingNames = new Set(existing.map((r) => r.migration_name));

  for (const name of UNTRACKED_MIGRATIONS) {
    if (existingNames.has(name)) {
      console.log(`Already tracked: ${name}`);
      continue;
    }
    const sqlPath = path.join(__dirname, '..', 'prisma', 'migrations', name, 'migration.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
    const id = crypto.randomUUID();
    await prisma.$executeRawUnsafe(
      'INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count) VALUES ($1, $2, $3, now(), now(), 1)',
      id,
      checksum,
      name
    );
    console.log(`Backfilled tracking row: ${name}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
