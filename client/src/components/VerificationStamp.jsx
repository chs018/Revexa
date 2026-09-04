import { useEffect, useState } from 'react';

// PART C — the signature moment. A thin, line-drawn checkmark (SVG stroke
// animation, not a filled glyph) followed by a JetBrains Mono identifier
// typed out character by character, e.g. "VERIFIED · 8F3A2C91". Ties the
// visual language directly to the app's real anti-fabrication check
// (verifyEvidence.js) — this reads as "this was checked," not "this was
// clicked." The code is a short, deterministic, COSMETIC identifier — not a
// real cryptographic hash — derived from a stable seed (the dispute id) so
// the exact same code renders here and next to the matching "approved" row
// in the Audit Trail, not two different-looking codes for one event.

// Deliberately non-cryptographic (FNV-1a, a fast display-quality hash) —
// this only needs to be stable per seed, not collision-resistant.
export function pseudoVerificationCode(seed) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).toUpperCase().padStart(8, '0').slice(0, 8);
}

const CHECK_DRAW_MS = 480; // must match .stamp-check-path--animate's duration in index.css
const PER_CHAR_MS = 35;

export default function VerificationStamp({ code, animate = false, size = 'md' }) {
  const label = `VERIFIED · ${code}`;
  const [typedLength, setTypedLength] = useState(animate ? 0 : label.length);
  const dims = size === 'lg' ? { box: 28, stroke: 2.5 } : { box: 18, stroke: 2.5 };

  useEffect(() => {
    if (!animate) {
      setTypedLength(label.length);
      return undefined;
    }
    setTypedLength(0);
    const timers = [];
    for (let i = 1; i <= label.length; i++) {
      timers.push(setTimeout(() => setTypedLength(i), CHECK_DRAW_MS + i * PER_CHAR_MS));
    }
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate, code]);

  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width={dims.box} height={dims.box} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M5 12.5L10 17L19 7"
          stroke="var(--color-cobalt-600)"
          strokeWidth={dims.stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength="1"
          className={`stamp-check-path ${animate ? 'stamp-check-path--animate' : ''}`}
        />
      </svg>
      <span className="font-mono text-xs font-medium tracking-wide text-cobalt-600">{label.slice(0, typedLength)}</span>
    </span>
  );
}
