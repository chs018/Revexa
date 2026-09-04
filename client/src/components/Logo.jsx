// Abstract geometric mark — a rounded square overlapped by a translucent
// circle, not a literal icon. Used at small size in the sidebar and large
// size on the landing page so the two share one identity.
//
// Visual system pass: the sidebar is porcelain/light now too (no more dark
// panel), so the old tone="dark"/tone="sidebar" branch collapses to one
// treatment — graphite, everywhere. The mark is deliberately NOT cobalt:
// per the brief, cobalt stays reserved for active/interactive states and
// the verification signature, not brand chrome.
export function LogoMark({ size = 28, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="4" className="fill-(--color-graphite)" />
      <circle cx="23" cy="23" r="7" className="fill-(--color-graphite)" fillOpacity="0.45" />
    </svg>
  );
}

const WORDMARK_SIZES = {
  sm: { mark: 28, text: 'text-lg' },
  lg: { mark: 56, text: 'text-3xl' },
};

export default function Logo({ size = 'sm', className = '' }) {
  const s = WORDMARK_SIZES[size] ?? WORDMARK_SIZES.sm;

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <LogoMark size={s.mark} />
      <span className={`font-display font-semibold tracking-tight text-(--color-graphite) ${s.text}`}>Revexa</span>
    </div>
  );
}
