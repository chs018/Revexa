require('dotenv').config();

// One-off export script — NOT a live route. Run via `npm run export-dataset`
// from server/. Queries every dispute with a ground-truth label, joins its
// synthetic transaction context, and writes a flat CSV for the offline
// Python training script (scripts/ml/train_classifier.py) to consume.
//
// Rows missing transaction context (a dispute whose scoring pipeline never
// actually ran — e.g. still "new") are skipped, since they have no features
// to train on. That's reported below rather than silently dropped.
const fs = require('fs');
const path = require('path');
const prisma = require('../src/lib/prisma');
const { extractFeatures } = require('../src/lib/featureExtraction');

const OUTPUT_DIR = path.join(__dirname, 'ml');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'dataset.csv');

// logAmount/hasPriorRefund come from the SAME extractFeatures() used by
// lib/mlClassifier.js at prediction time — computed once, here, rather than
// re-derived independently in Python (train_classifier.py now just reads
// these two columns instead of recomputing the formulas itself).
const COLUMNS = [
  'disputeId',
  'razorpayId',
  'reasonCode',
  'amount',
  'currency',
  'deliveryStatus',
  'priorRefundCount',
  'ipMatch',
  'billingAddressMatch',
  'logAmount',
  'hasPriorRefund',
  'groundTruthDefensible',
];

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function main() {
  const labeled = await prisma.dispute.findMany({
    where: { groundTruthDefensible: { not: null } },
    select: {
      id: true,
      razorpayId: true,
      reasonCode: true,
      amount: true,
      currency: true,
      deliveryStatus: true,
      priorRefundCount: true,
      ipMatch: true,
      billingAddressMatch: true,
      groundTruthDefensible: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const hasContext = (d) =>
    d.deliveryStatus != null && d.priorRefundCount != null && d.ipMatch != null && d.billingAddressMatch != null;

  const usable = labeled.filter(hasContext);
  const skipped = labeled.length - usable.length;

  const trueCount = usable.filter((d) => d.groundTruthDefensible === true).length;
  const falseCount = usable.length - trueCount;

  const rows = usable.map((d) => {
    const features = extractFeatures(d);
    return [
      d.id,
      d.razorpayId,
      d.reasonCode,
      d.amount,
      d.currency,
      d.deliveryStatus,
      d.priorRefundCount,
      d.ipMatch,
      d.billingAddressMatch,
      features.logAmount,
      features.hasPriorRefund,
      d.groundTruthDefensible,
    ];
  });

  const lines = [COLUMNS.join(','), ...rows.map((r) => r.map(csvEscape).join(','))];

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, lines.join('\n') + '\n', 'utf8');

  console.log(`Labeled disputes found: ${labeled.length}`);
  console.log(`Skipped (no transaction context yet — pipeline never ran): ${skipped}`);
  console.log(`Written to dataset: ${usable.length} rows`);
  console.log(`  groundTruthDefensible=true:  ${trueCount} (${((trueCount / usable.length) * 100).toFixed(1)}%)`);
  console.log(`  groundTruthDefensible=false: ${falseCount} (${((falseCount / usable.length) * 100).toFixed(1)}%)`);
  console.log(`-> ${OUTPUT_PATH}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
