import { NavLink, Link } from 'react-router-dom';
import Logo from './Logo';

const LINKS = [
  { to: '/app', label: 'Dashboard', end: true },
  { to: '/app/queue', label: 'Queue' },
  { to: '/app/audit-trail', label: 'Audit Trail' },
  { to: '/app/metrics', label: 'Metrics' },
];

export default function Sidebar({ connected }) {
  return (
    // Sidebar gets its own transparent glassy light-navy-blue panel again —
    // background only; the rest of the light-mode visual system (text
    // colors, cobalt active state, hairline border) is untouched.
    <aside className="sidebar-glass flex h-full w-60 shrink-0 flex-col border-r border-hairline">
      <div className="px-6 py-6">
        <Link to="/" title="Back to landing page">
          <Logo size="sm" />
        </Link>
        <p className="mt-1 text-xs text-(--color-graphite)">Chargeback evidence responder</p>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {LINKS.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className={({ isActive }) =>
              // All nav text is dark graphite now, active and inactive
              // alike — no muted/grey label anywhere in the sidebar. The
              // only thing marking "selected" is the crisp 2px underline.
              `block border-b-2 px-2.5 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt-600 text-(--color-graphite) ${
                isActive ? 'border-(--color-graphite)' : 'border-transparent'
              }`
            }
          >
            {link.label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-hairline px-6 py-4">
        <div className="flex items-center gap-2 text-xs">
          <span className={`h-2 w-2 rounded-full ${connected ? 'bg-success-600' : 'bg-danger-600'}`} aria-hidden="true" />
          <span className={connected ? 'text-success-700' : 'text-(--color-graphite)'}>
            {connected ? 'Live' : 'Reconnecting…'}
          </span>
        </div>
      </div>
    </aside>
  );
}
