// A real 2x2 confusion matrix — predicted verdict (risk scorer) as columns,
// actual ground truth as rows — not just four numbers in a row. Correct
// cells (TP/TN, the model agreed with reality) get the muted-success tint;
// incorrect cells (FP/FN, the model was wrong) get the muted-caution tint —
// a wrong verdict is a modeling miss, not the kind of genuine error that
// calls for red.
// totalLabel: what the per-cell percentage is "of" — defaults to "graded"
// (the LLM section's usage) but the ML classifier section passes "test set"
// instead, since "graded" isn't the right word for a held-out split.
export default function ConfusionMatrix({ tp, fp, tn, fn, totalLabel = 'graded' }) {
  const total = tp + fp + tn + fn;

  function Cell({ value, tone, label }) {
    const toneClasses = tone === 'good' ? 'border-success-600 text-success-700' : 'border-caution-600 text-caution-700';
    const pct = total > 0 ? Math.round((value / total) * 100) : 0;

    return (
      <div className={`flex flex-col items-center justify-center rounded border bg-paper p-4 ${toneClasses}`}>
        <span className="font-display text-2xl font-semibold tabular-nums">{value}</span>
        <span className="mt-0.5 text-xs font-medium uppercase tracking-wide">{label}</span>
        {total > 0 && <span className="mt-1 font-mono text-[11px] opacity-80">{pct}% of {totalLabel}</span>}
      </div>
    );
  }

  return (
    <div className="inline-grid grid-cols-[auto_1fr_1fr] gap-2 text-sm">
      <div />
      <div className="flex items-end justify-center pb-1 text-center text-xs font-medium text-graphite-muted">
        Model: Defensible
      </div>
      <div className="flex items-end justify-center pb-1 text-center text-xs font-medium text-graphite-muted">
        Model: Not Defensible
      </div>

      <div className="flex items-center justify-end pr-2 text-right text-xs font-medium text-graphite-muted">
        Truly
        <br />
        Defensible
      </div>
      <Cell value={tp} tone="good" label="True Positive" />
      <Cell value={fn} tone="bad" label="False Negative" />

      <div className="flex items-center justify-end pr-2 text-right text-xs font-medium text-graphite-muted">
        Truly Not
        <br />
        Defensible
      </div>
      <Cell value={fp} tone="bad" label="False Positive" />
      <Cell value={tn} tone="good" label="True Negative" />
    </div>
  );
}
