// GAP 1 (point 2) / GAP 4: Visa Compelling Evidence 3.0 qualification,
// checked programmatically against the actual data — never left to the LLM
// to self-assess. Two callers share this exact function so there is only
// one place the rule itself lives:
//   - evidenceAgent.js calls it BEFORE building the prompt, so the
//     qualification verdict is handed to the model as a stated fact
//     ("this case QUALIFIES / DOES NOT QUALIFY, per fixed business rules")
//     rather than asked as a question.
//   - verifyEvidence.js calls it AFTER the model responds, to check the
//     model's own claim (via citedArtifacts including "ce3Evidence")
//     against this same rule — catching a case where the model claims
//     qualification despite the fact stated in its own prompt.
//
// Visa's real CE 3.0 rule (the one being modeled here): at least two prior
// undisputed transactions from the same cardholder, both 120-365 days
// before the disputed transaction and never themselves disputed/flagged,
// PLUS at least two matching data elements between those transactions and
// the disputed one, at least one of which is a device-level signal (IP
// address or device ID) — a billing name/address match alone doesn't meet
// the bar.
const MIN_DAYS_BEFORE_DISPUTE = 120;
const MAX_DAYS_BEFORE_DISPUTE = 365;
const DEVICE_LEVEL_ELEMENTS = ['ipAddress', 'deviceId'];

/**
 * @param {object|null} ce3Evidence - Dispute.evidenceContext.ce3Evidence
 * @returns {{ qualifies: boolean, reasons: string[], matchedElements: string[] }}
 *   `reasons` explains every rule the case failed (empty if it qualifies).
 */
function checkCe3Qualification(ce3Evidence) {
  if (!ce3Evidence) {
    return { qualifies: false, reasons: ['No CE 3.0 evidence exists for this dispute.'], matchedElements: [] };
  }

  const reasons = [];
  const elements = ce3Evidence.matchingDataElements || {};
  const matchedElements = Object.entries(elements)
    .filter(([, matched]) => matched === true)
    .map(([name]) => name);

  const hasTwoMatches = matchedElements.length >= 2;
  if (!hasTwoMatches) {
    reasons.push(`Only ${matchedElements.length} of 4 matching data elements — CE 3.0 requires at least 2.`);
  }

  const hasDeviceLevelMatch = matchedElements.some((name) => DEVICE_LEVEL_ELEMENTS.includes(name));
  if (!hasDeviceLevelMatch) {
    reasons.push('None of the matched elements is an IP address or device ID match — CE 3.0 requires at least one.');
  }

  const priorTransactions = Array.isArray(ce3Evidence.priorUndisputedTransactions)
    ? ce3Evidence.priorUndisputedTransactions
    : [];
  const hasTwoPriorTransactions = priorTransactions.length >= 2;
  if (!hasTwoPriorTransactions) {
    reasons.push(`Only ${priorTransactions.length} prior undisputed transaction(s) on file — CE 3.0 requires at least 2.`);
  }

  const priorTransactionsValid =
    hasTwoPriorTransactions &&
    priorTransactions.every(
      (t) =>
        typeof t.daysBeforeDispute === 'number' &&
        t.daysBeforeDispute >= MIN_DAYS_BEFORE_DISPUTE &&
        t.daysBeforeDispute <= MAX_DAYS_BEFORE_DISPUTE &&
        t.previouslyDisputedOrFlagged !== true
    );
  if (hasTwoPriorTransactions && !priorTransactionsValid) {
    reasons.push(
      `One or more prior transactions fall outside the ${MIN_DAYS_BEFORE_DISPUTE}-${MAX_DAYS_BEFORE_DISPUTE} day window, or were themselves previously disputed/flagged.`
    );
  }

  return {
    qualifies: hasTwoMatches && hasDeviceLevelMatch && priorTransactionsValid,
    reasons,
    matchedElements,
  };
}

module.exports = { checkCe3Qualification, MIN_DAYS_BEFORE_DISPUTE, MAX_DAYS_BEFORE_DISPUTE, DEVICE_LEVEL_ELEMENTS };
