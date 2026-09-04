-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('new', 'scored', 'drafted', 'pending_review', 'submitted', 'won', 'lost');

-- CreateEnum
CREATE TYPE "EvidencePacketStatus" AS ENUM ('draft', 'approved', 'rejected', 'submitted');

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "razorpayId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "reasonCode" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'new',
    "slaDeadline" TIMESTAMP(3) NOT NULL,
    "confidenceScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidencePacket" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" "EvidencePacketStatus" NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidencePacket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reasoning" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Dispute_razorpayId_key" ON "Dispute"("razorpayId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidencePacket_disputeId_key" ON "EvidencePacket"("disputeId");

-- AddForeignKey
ALTER TABLE "EvidencePacket" ADD CONSTRAINT "EvidencePacket_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
