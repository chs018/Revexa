import { useEffect, useMemo, useState } from 'react';
import { getDisputes } from '../lib/api';
import { useSocketContext } from '../hooks/SocketContext';
import { formatCurrency } from '../lib/format';
import { STATUS_LABEL, statusBadgeClasses } from '../lib/statusStyles';
import SlaCountdown from '../components/SlaCountdown';
import DisputeDetail from '../components/DisputeDetail';

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'drafted', label: 'Drafted' },
  { value: 'pending_review', label: 'Pending Review' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'lost', label: 'Lost' },
  { value: 'needs_attention', label: 'Needs Attention' },
];

export default function Queue() {
  const [disputes, setDisputes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterStatus, setFilterStatus] = useState('');
  const [sortKey, setSortKey] = useState('slaDeadline'); // 'slaDeadline' | 'amount'
  const [sortDir, setSortDir] = useState('asc'); // soonest-first by default
  const [selectedId, setSelectedId] = useState(null);

  const { onUpdate } = useSocketContext();

  // Fetch on mount AND whenever the filter changes — an explicit user
  // action, not interval polling, so a fresh REST call here is fine.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getDisputes(filterStatus ? { status: filterStatus } : undefined)
      .then((data) => {
        if (!cancelled) setDisputes(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filterStatus]);

  // Socket keeps the list live after that. If a filter is active and an
  // update moves a dispute out of the filtered status, drop it from view —
  // it no longer belongs in e.g. "Drafted" once it's "lost".
  useEffect(() => {
    return onUpdate((updated) => {
      setDisputes((prev) => {
        const idx = prev.findIndex((d) => d.id === updated.id);
        const matchesFilter = !filterStatus || updated.status === filterStatus;

        if (!matchesFilter) {
          return idx === -1 ? prev : prev.filter((d) => d.id !== updated.id);
        }

        if (idx === -1) return [updated, ...prev];
        const next = prev.slice();
        next[idx] = { ...next[idx], ...updated };
        return next;
      });
    });
  }, [onUpdate, filterStatus]);

  const sorted = useMemo(() => {
    const list = [...disputes];
    list.sort((a, b) => {
      const av = sortKey === 'amount' ? a.amount : new Date(a.slaDeadline).getTime();
      const bv = sortKey === 'amount' ? b.amount : new Date(b.slaDeadline).getTime();
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return list;
  }, [disputes, sortKey, sortDir]);

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'amount' ? 'desc' : 'asc'); // highest amount / soonest SLA first by default
    }
  }

  function sortIndicator(key) {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold text-(--color-graphite)">Queue</h1>
          <p className="mt-1 text-sm text-graphite-muted">Every dispute, live.</p>
        </div>

        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="rounded border border-hairline bg-paper px-3 py-2 text-sm text-(--color-graphite) focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt-600"
        >
          {STATUS_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="mt-4 rounded border border-danger-100 bg-danger-50 px-4 py-3 text-sm text-danger-700">
          Failed to load disputes: {error}
        </div>
      )}

      {/* Point 11: the dense mono/tabular columns are what breaks first on
          narrow screens — overflow-x-auto lets the table scroll
          horizontally inside its own box rather than forcing the whole
          page to scroll sideways, and min-w-full keeps columns from being
          crushed to unreadable widths on the way there. */}
      <div className="mt-6 overflow-x-auto rounded border border-hairline bg-paper">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-xs font-medium uppercase tracking-wide text-graphite-muted">
              <th className="cursor-pointer select-none px-4 py-3 text-right" onClick={() => toggleSort('amount')}>
                Amount{sortIndicator('amount')}
              </th>
              <th className="px-4 py-3">Customer / Reason</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Confidence</th>
              <th className="cursor-pointer select-none px-4 py-3 text-right" onClick={() => toggleSort('slaDeadline')}>
                SLA{sortIndicator('slaDeadline')}
              </th>
            </tr>
          </thead>
          <tbody>
            {!loading && sorted.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-graphite-muted">
                  No disputes match this filter.
                </td>
              </tr>
            )}
            {sorted.map((d) => (
              <tr
                key={d.id}
                onClick={() => setSelectedId(d.id)}
                className="cursor-pointer border-b border-hairline transition-colors last:border-0 hover:bg-porcelain"
              >
                <td className="px-4 py-3 text-right font-mono font-medium tabular-nums text-(--color-graphite)">
                  {formatCurrency(d.amount, d.currency)}
                </td>
                <td className="px-4 py-3">
                  <div className="font-mono text-xs text-graphite-muted">{d.razorpayId}</div>
                  <div className="text-(--color-graphite)">{d.reasonCode}</div>
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusBadgeClasses(d.status)}`}>
                    {STATUS_LABEL[d.status] ?? d.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-graphite-muted">
                  {d.confidenceScore != null ? `${Math.round(d.confidenceScore * 100)}%` : '—'}
                </td>
                <td className="px-4 py-3 text-right">
                  <SlaCountdown deadline={d.slaDeadline} variant="table" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedId && <DisputeDetail disputeId={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
