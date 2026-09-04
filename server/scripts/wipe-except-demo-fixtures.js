require('dotenv').config();

// One-off: wipes every Dispute (and its AuditLog/EvidencePacket rows) EXCEPT
// the two permanent demo fixtures from scripts/seed-demo-disputes.js
// (disp_DEMOCE3QUALIFIES01, disp_DEMOFLAGGEDCASE01) — run ahead of a demo to
// clear real/synthetic clutter while keeping the two guaranteed, non-random
// demo beats (CE 3.0 qualifying + flagged verification) intact. Deletes
// children (AuditLog, EvidencePacket) before parents (Dispute) since neither
// FK has onDelete: Cascade in schema.prisma.
const prisma = require('../src/lib/prisma');

const KEEP_RAZORPAY_IDS = ['disp_DEMOCE3QUALIFIES01', 'disp_DEMOFLAGGEDCASE01'];

async function main() {
  const keep = await prisma.dispute.findMany({
    where: { razorpayId: { in: KEEP_RAZORPAY_IDS } },
    select: { id: true, razorpayId: true },
  });
  if (keep.length !== KEEP_RAZORPAY_IDS.length) {
    const found = keep.map((d) => d.razorpayId);
    const missing = KEEP_RAZORPAY_IDS.filter((id) => !found.includes(id));
    console.warn(`WARNING: demo fixture(s) not found, nothing to protect for: ${missing.join(', ')}`);
  }
  const keepIds = keep.map((d) => d.id);

  const toDelete = await prisma.dispute.findMany({
    where: { id: { notIn: keepIds } },
    select: { id: true },
  });
  const deleteIds = toDelete.map((d) => d.id);

  console.log(`Keeping ${keepIds.length} demo fixture dispute(s).`);
  console.log(`Deleting ${deleteIds.length} other dispute(s) and their audit logs / evidence packets...`);

  if (deleteIds.length === 0) {
    console.log('Nothing to delete.');
    return;
  }

  const auditResult = await prisma.auditLog.deleteMany({ where: { disputeId: { in: deleteIds } } });
  const packetResult = await prisma.evidencePacket.deleteMany({ where: { disputeId: { in: deleteIds } } });
  const disputeResult = await prisma.dispute.deleteMany({ where: { id: { in: deleteIds } } });

  console.log(`Deleted: ${disputeResult.count} disputes, ${auditResult.count} audit logs, ${packetResult.count} evidence packets.`);

  const remaining = await prisma.dispute.findMany({ select: { razorpayId: true, status: true } });
  console.log(`\nRemaining disputes (${remaining.length}):`);
  remaining.forEach((d) => console.log(`  - ${d.razorpayId} (${d.status})`));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
