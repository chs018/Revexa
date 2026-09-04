require('dotenv').config();

// One-off: applies migrations/20260826010000_gap_fixes_ce3_verification_status
// by hand via $executeRawUnsafe, same workaround the prior migration used —
// see that migration.sql's header comment for why (schema-engine-windows.exe
// is blocked by Windows Application Control on this machine; the
// query-engine path this script uses is unaffected). Not meant to be rerun
// or generalized — a real environment should just use `prisma migrate deploy`.
const prisma = require('../src/lib/prisma');

async function main() {
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "EvidencePacket" ADD COLUMN IF NOT EXISTS "verificationStatus" TEXT;'
  );
  console.log('Applied: EvidencePacket.verificationStatus');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
