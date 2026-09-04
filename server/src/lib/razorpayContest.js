const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const razorpay = require('./razorpayClient');

// Razorpay buildathon integration: completes the loop RAZORPAY_KEY_ID/
// RAZORPAY_KEY_SECRET were provisioned for — actually submitting the
// approved evidence packet to Razorpay's real Disputes API. Two real API
// calls, not one:
//   1. Documents API (POST /v1/documents) — Razorpay's contest endpoint
//      only accepts document IDs as evidence, not raw text, so the
//      rebuttal letter is rendered to a one-page PDF and uploaded first.
//   2. Disputes API (PATCH /v1/disputes/:id/contest) — submits that
//      document as explanation_letter evidence with action: "submit".
//
// The Documents upload deliberately does NOT use razorpay.documents.create()
// — that SDK method passes a plain object as axios's request body with a
// manually-set multipart/form-data header but never actually multipart-
// encodes it (confirmed by reading node_modules/razorpay/dist/api.js — no
// FormData construction, no transformRequest). Node's native fetch/FormData
// (global since Node 18, no new dependency) does the real encoding
// correctly, so the upload is made directly against Razorpay's REST API
// instead of through that helper. The contest PATCH itself has no such
// issue — that one goes through the SDK normally.

async function buildEvidencePdf(dispute, evidencePacket) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]); // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontSize = 10;
  const margin = 50;
  const maxWidth = page.getWidth() - margin * 2;
  let y = page.getHeight() - margin;

  function drawLine(text, size = fontSize, bold = false) {
    if (y < margin) return; // silently stop rather than add pages — one page is enough for a buildathon PDF
    page.drawText(text, { x: margin, y, size, font, color: rgb(0.1, 0.1, 0.12) });
    y -= size * 1.5;
  }

  drawLine(`Chargeback Evidence — Dispute ${dispute.razorpayId}`, 14);
  drawLine(`Reason code: ${dispute.reasonCode}`, 10);
  y -= 10;

  // Naive word-wrap — this is a buildathon evidence attachment, not a
  // typeset document; good enough to be legible.
  const words = evidencePacket.content.replace(/\s+/g, ' ').trim().split(' ');
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) > maxWidth) {
      drawLine(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) drawLine(line);

  return pdf.save(); // Uint8Array
}

async function uploadEvidenceDocument(pdfBytes, filename) {
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');

  const form = new FormData();
  form.append('purpose', 'dispute_evidence');
  form.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), filename);

  const res = await fetch('https://api.razorpay.com/v1/documents', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}` },
    body: form,
  });

  const body = await res.json();
  if (!res.ok) {
    const err = new Error(body?.error?.description || `Document upload failed (${res.status})`);
    err.razorpayResponse = body;
    throw err;
  }
  return body; // { id: 'doc_...', ... }
}

/**
 * Submits the approved evidence packet to Razorpay's real Disputes API.
 * Never throws — returns { status: 'submitted', razorpayResponse } on
 * success or { status: 'failed', reason } on any failure (including the
 * expected case in test mode: dispute.razorpayId doesn't correspond to a
 * real Razorpay dispute, since Razorpay's test mode has no self-service way
 * to create one — see docs/threshold-rationale.md's sibling note in
 * routes/disputes.js for context). Callers treat this as best-effort and
 * non-blocking, same pattern as verifyEvidence.js's flagging.
 */
async function submitRealContest(dispute, evidencePacket) {
  try {
    const pdfBytes = await buildEvidencePdf(dispute, evidencePacket);
    const doc = await uploadEvidenceDocument(pdfBytes, `${dispute.razorpayId}-evidence.pdf`);

    const result = await razorpay.disputes.contest(dispute.razorpayId, {
      amount: dispute.amount,
      summary: `Automated evidence packet from Revexa for ${dispute.reasonCode}.`.slice(0, 1000),
      explanation_letter: [doc.id],
      action: 'submit',
    });

    return { status: 'submitted', documentId: doc.id, razorpayResponse: result };
  } catch (err) {
    // Two different error shapes to handle: uploadEvidenceDocument throws a
    // real Error with .razorpayResponse attached, but the razorpay SDK's
    // disputes.contest() throws a plain `{ statusCode, error }` object (its
    // own normalizeError() does `throw {...}`, not `throw new Error(...)`)
    // — confirmed directly: hitting contest() against a non-existent
    // dispute id returns { statusCode: 404, error: undefined }, not
    // something with a .message. Falling through to err.message alone
    // silently produced "reason: undefined" here before this fix.
    const razorpayError = err.razorpayResponse?.error || err.error || null;
    const reason =
      razorpayError?.description ||
      err.message ||
      (err.statusCode ? `Razorpay API returned HTTP ${err.statusCode} with no error detail — likely no dispute exists with this id in test mode (Razorpay's test mode has no self-service way to create one).` : 'Unknown error');
    return { status: 'failed', reason, razorpayError, statusCode: err.statusCode ?? null };
  }
}

module.exports = { submitRealContest, buildEvidencePdf };
