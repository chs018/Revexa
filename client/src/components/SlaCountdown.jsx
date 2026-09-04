import { useCountdown } from '../hooks/useCountdown';

const TONE_TEXT = {
  neutral: 'text-graphite-muted',
  caution: 'text-caution-700',
  danger: 'text-danger-700',
};

const TONE_PILL = {
  neutral: 'border border-hairline text-graphite-muted',
  caution: 'border border-caution-600 text-caution-700',
  danger: 'border-transparent bg-danger-600 text-white',
};

/**
 * `variant="table"` — plain, compact text for a dense table row.
 * `variant="header"` — larger, pill-styled, more visual urgency, for the
 * Detail drawer header.
 */
export default function SlaCountdown({ deadline, variant = 'table' }) {
  const { text, tone } = useCountdown(deadline);

  if (variant === 'header') {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${TONE_PILL[tone]}`}>
        {tone === 'danger' && <span aria-hidden="true">⚠</span>}
        SLA: {text}
      </span>
    );
  }

  return <span className={`font-mono text-sm ${TONE_TEXT[tone]}`}>{text}</span>;
}
