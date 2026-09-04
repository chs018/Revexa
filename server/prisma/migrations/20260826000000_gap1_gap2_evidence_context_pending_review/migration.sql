-- Applied by hand via $executeRawUnsafe, not `prisma migrate dev` — the
-- native schema-engine-windows.exe binary was blocked by Windows Application
-- Control (Smart App Control) on this machine, the same class of issue that
-- blocked a scipy binary earlier in this project (see memory notes). The
-- query-engine path (used by all normal Prisma Client calls, including this
-- ALTER via $executeRawUnsafe) is unaffected — only the schema-engine CLI
-- tool is blocked. This file exists so `prisma migrate deploy`/`migrate
-- status` still see an accurate history in any environment where the
-- schema engine isn't blocked.
ALTER TABLE "Dispute" ADD COLUMN IF NOT EXISTS "evidenceContext" JSONB;
