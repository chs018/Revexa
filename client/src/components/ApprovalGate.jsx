import { useState } from 'react';
import { useDwellTimer } from '../hooks/useDwellTimer';
import { startReview } from '../lib/api';

// A deliberate two-part confirmation gate in front of Approve — a PIN plus
// a mandatory dwell period — because approving immediately simulates
// submission (see the /approve route: draft -> approved -> submitted in
// one transaction, no undo). This app has no real user accounts or
// authentication anywhere else (reviewerName is a free-text field with no
// check behind it), so DEMO_PIN below is NOT a security boundary against
// an adversary — it's the same value POST /disputes/:id/approve checks
// server-side (REVIEW_PIN in .env), so a raw API call has to go through
// the same ritual this UI does, not skip it. Shown right in the UI rather
// than hidden, since hiding it wouldn't add real security anyway. The
// dwell timer mirrors the server's MIN_REVIEW_SECONDS the same way: this
// component's own countdown is genuinely enforced too (Confirm Approval
// stays disabled until DWELL_MS elapses), but the AUTHORITATIVE clock is
// the one /approve checks against dispute.reviewStartedAt, started by the
// startReview() call below — not this local timer, which could be
// bypassed by anyone editing the page's JS.
const DEMO_PIN = '4721';
const DWELL_MS = 3000;

export default function ApprovalGate({ disputeId, onConfirm, busy }) {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [pinTouched, setPinTouched] = useState(false);
  const [startError, setStartError] = useState(null);
  const dwell = useDwellTimer(DWELL_MS);

  async function handleStart() {
    setOpen(true);
    setPin('');
    setPinTouched(false);
    setStartError(null);
    dwell.start();
    try {
      await startReview(disputeId);
    } catch (err) {
      setStartError(err.message);
    }
  }

  function handleCancel() {
    setOpen(false);
    dwell.reset();
  }

  const pinCorrect = pin === DEMO_PIN;
  const canConfirm = pinCorrect && dwell.done && !busy && !startError;
  const dwellSeconds = Math.ceil(dwell.remainingMs / 1000);
  const dwellPct = Math.min(100, ((DWELL_MS - dwell.remainingMs) / DWELL_MS) * 100);

  if (!open) {
    return (
      <button
        type="button"
        onClick={handleStart}
        disabled={busy}
        className="rounded bg-cobalt-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-cobalt-700 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt-600"
      >
        Approve
      </button>
    );
  }

  return (
    <div className="rounded border border-hairline bg-porcelain p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-graphite-muted">Confirm approval</p>
      <p className="mt-1 text-xs text-graphite-muted">
        This submits the evidence packet. Enter the PIN and wait for the dwell period to clear.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input
          type="text"
          inputMode="numeric"
          maxLength={4}
          value={pin}
          onChange={(e) => {
            setPin(e.target.value.replace(/\D/g, ''));
            setPinTouched(true);
          }}
          placeholder="PIN"
          aria-label="Confirmation PIN"
          className="w-24 rounded border border-hairline bg-paper px-3 py-2 font-mono text-sm tracking-widest text-(--color-graphite) focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt-600"
        />
        <span className="text-xs text-graphite-muted">demo PIN: {DEMO_PIN} — no real auth in this build</span>
      </div>

      {pinTouched && !pinCorrect && pin.length === 4 && <p className="mt-1.5 text-xs text-danger-700">Incorrect PIN.</p>}

      {startError && (
        <p className="mt-1.5 text-xs text-danger-700">
          Could not start server-side review: {startError}. Cancel and try again.
        </p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-hairline" role="progressbar" aria-valuenow={Math.round(dwellPct)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-1.5 bg-cobalt-600 transition-[width] duration-100 ease-linear" style={{ width: `${dwellPct}%` }} />
        </div>
        <span className="w-16 shrink-0 font-mono text-xs text-graphite-muted">{dwell.done ? 'ready' : `${dwellSeconds}s`}</span>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onConfirm(pin)}
          disabled={!canConfirm}
          className="rounded bg-cobalt-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-cobalt-700 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt-600"
        >
          {busy ? 'Approving…' : 'Confirm Approval'}
        </button>
        <button
          type="button"
          onClick={handleCancel}
          disabled={busy}
          className="rounded border border-hairline bg-paper px-4 py-2.5 text-sm font-medium text-graphite-muted transition-colors hover:text-(--color-graphite) disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt-600"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
