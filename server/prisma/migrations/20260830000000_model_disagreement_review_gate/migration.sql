-- Applied by hand via $executeRawUnsafe, same reason as every prior
-- migration in this history: schema-engine-windows.exe is blocked by
-- Windows Application Control on this machine. The query-engine path used
-- by all normal Prisma Client calls, including this ALTER, is unaffected.
--
-- classifierScore / classifierVerdict: the baseline ML classifier's own
-- independent read on a dispute, stored whenever it runs.
-- reviewStartedAt: server-side timestamp for the mandatory dwell period
-- before POST /disputes/:id/approve is allowed to succeed.
ALTER TABLE "Dispute" ADD COLUMN IF NOT EXISTS "classifierScore" DOUBLE PRECISION;
ALTER TABLE "Dispute" ADD COLUMN IF NOT EXISTS "classifierVerdict" TEXT;
ALTER TABLE "Dispute" ADD COLUMN IF NOT EXISTS "reviewStartedAt" TIMESTAMP(3);
