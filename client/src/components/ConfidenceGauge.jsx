/**
 * Horizontal bar from 0-100%, filled to the score, with the confidence
 * threshold drawn as a fixed marker line on the same scale — the score
 * visibly clears or misses the line, not just a number next to a number.
 */
export default function ConfidenceGauge({ score, threshold }) {
  const scorePct = Math.round(score * 100);
  const thresholdPct = Math.round(threshold * 100);
  const passed = score >= threshold;

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="font-display text-2xl font-semibold tabular-nums text-(--color-graphite)">{scorePct}%</span>
        <span className={`text-xs font-medium ${passed ? 'text-success-700' : 'text-caution-700'}`}>
          {passed ? 'Clears threshold' : 'Below threshold'}
        </span>
      </div>

      <div className="relative mt-3 h-2 w-full rounded-full bg-hairline">
        <div
          className={`h-2 rounded-full transition-all ${passed ? 'bg-success-600' : 'bg-caution-600'}`}
          style={{ width: `${scorePct}%` }}
        />
        <div
          className="absolute top-0 h-2 w-0.5 bg-(--color-graphite)"
          style={{ left: `${thresholdPct}%` }}
          aria-hidden="true"
        />
      </div>

      <div className="relative mt-1 h-4 text-[10px] font-mono text-graphite-muted">
        <span className="absolute left-0">0%</span>
        <span
          className="absolute -translate-x-1/2 font-medium text-(--color-graphite)"
          style={{ left: `${thresholdPct}%` }}
        >
          ↑ threshold {thresholdPct}%
        </span>
        <span className="absolute right-0">100%</span>
      </div>
    </div>
  );
}
