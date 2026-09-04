// Visual system pass: every tone shares the same neutral paper+hairline
// surface now — no colored background tints on card chrome. Signal color
// (or cobalt, for "accent") shows up only in the FIGURE itself, which is
// enough to carry the meaning without a colored block competing with it.
const TONE_STYLES = {
  neutral: 'text-(--color-graphite)',
  accent: 'text-cobalt-700',
  success: 'text-success-700',
  caution: 'text-caution-700',
  danger: 'text-danger-700',
};

export default function StatCard({ label, value, sublabel, tone = 'neutral' }) {
  const accentClass = TONE_STYLES[tone] ?? TONE_STYLES.neutral;

  return (
    <div className="rounded border border-hairline bg-paper p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-graphite-muted">{label}</p>
      <p className={`mt-2 font-display text-2xl font-semibold tabular-nums ${accentClass}`}>{value}</p>
      {sublabel && <p className="mt-1 text-xs text-graphite-muted">{sublabel}</p>}
    </div>
  );
}
