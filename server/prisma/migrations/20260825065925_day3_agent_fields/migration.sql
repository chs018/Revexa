-- AlterEnum
ALTER TYPE "DisputeStatus" ADD VALUE 'needs_attention';

-- AlterTable
ALTER TABLE "Dispute" ADD COLUMN     "billingAddressMatch" BOOLEAN,
ADD COLUMN     "deliveryStatus" TEXT,
ADD COLUMN     "ipMatch" BOOLEAN,
ADD COLUMN     "priorRefundCount" INTEGER;
