/**
 * Signals as a list of rows, not a paragraph: factor, a supports/weakens
 * mark, and the weight as a small tag.
 */
export default function SignalsList({ signals }) {
  return (
    <ul className="mt-3 space-y-2">
      {signals.map((signal, i) => {
        const supports = signal.direction === 'supports';
        return (
          <li
            key={i}
            className="flex items-center justify-between gap-3 rounded border border-hairline bg-paper px-3 py-2"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  supports ? 'bg-success-100 text-success-700' : 'bg-caution-100 text-caution-700'
                }`}
                aria-hidden="true"
              >
                {supports ? '✓' : '!'}
              </span>
              <span className="truncate text-sm text-(--color-graphite)">{signal.factor}</span>
            </div>
            <span className="shrink-0 rounded-full border border-hairline px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-graphite-muted">
              {signal.weight}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
