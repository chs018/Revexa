-- Razorpay buildathon integration: tracks the real Razorpay test-mode
-- payment ID a dispute is backed by (see schema.prisma's field comment).
-- Applied by hand via $executeRawUnsafe, same reason as every prior
-- migration in this history: schema-engine-windows.exe is blocked by
-- Windows Application Control on this machine. The query-engine path used
-- by all normal Prisma Client calls, including this ALTER, is unaffected.
ALTER TABLE "Dispute" ADD COLUMN IF NOT EXISTS "razorpayPaymentId" TEXT;
