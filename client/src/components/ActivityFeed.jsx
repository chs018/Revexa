import { activityLabel, activityBadgeClasses } from '../lib/statusStyles';
import { formatCurrency } from '../lib/format';

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// Live Activity feed rework (v2): purely time-driven now — an item is here
// because it happened in the last 15 minutes (see useSocket.js's prune
// sweep), and leaves on its own once it ages out. No per-item interaction
// to track here anymore; this component just renders whatever `events`
// currently contains.
export default function ActivityFeed({ events }) {
  if (events.length === 0) {
    return (
      <div className="rounded border border-dashed border-hairline bg-paper p-6 text-center text-sm text-graphite-muted">
        No activity in the last 15 minutes — trigger a dispute to see live updates here.
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {events.map((event) => (
        <li
          key={event._eventId}
          className="animate-feed-in flex items-start justify-between gap-3 rounded border border-hairline bg-paper px-4 py-3"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-(--color-graphite)">{activityLabel(event)}</p>
            <p className="mt-0.5 truncate text-xs text-graphite-muted">
              {event.reasonCode ?? '—'} · <span className="font-mono tabular-nums">{formatCurrency(event.amount, event.currency)}</span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${activityBadgeClasses(event)}`}>{event.status}</span>
            <span className="font-mono text-xs text-graphite-muted">{formatTime(event._receivedAt)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
