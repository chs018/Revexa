import { useEffect, useMemo, useState } from 'react';
import { getAuditLogs } from '../lib/api';
import { useSocketContext } from '../hooks/SocketContext';
import { formatCurrency } from '../lib/format';
import { STATUS_LABEL } from '../lib/statusStyles';
import SignalsList from '../components/SignalsList';
import DisputeDetail from '../components/DisputeDetail';
import VerificationStamp, { pseudoVerificationCode } from '../components/VerificationStamp';

const ACTOR_FILTERS = [
  { value: '', label: 'All actors' },
  { value: 'system', label: 'System' },
  { value: 'risk_scorer', label: 'Risk Scorer' },
  { value: 'evidence_agent', label: 'Evidence Agent' },
  { value: 'human', label: 'Human (any reviewer)' },
];

const STATUS_FILTERS = [{ value: '', label: 'All statuses' }, ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))];

// Visual system pass: one consistent hairline-outlined pill for every
// actor — the old slate/indigo/purple/teal palette wasn't part of the
// signal-color system and doesn't belong in the restrained one either.
// The label alone (System / Risk Scorer / Evidence Agent / a reviewer's
// name) carries the distinction.
function actorLabel(actor) {
  if (actor === 'system') return 'System';
  if (actor === 'risk_scorer') return 'Risk Scorer';
  if (actor === 'evidence_agent') return 'Evidence Agent';
  if (actor.startsWith('human:')) return actor.slice('human:'.length) || 'Human';
  return actor;
}

function formatTimestamp(ts) {
  return new Date(ts).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function RiskScorerReasoning({ reasoning }) {
  const [expanded, setExpanded] = useState(false);

  let parsed = null;
  try {
    parsed = JSON.parse(reasoning);
  } catch {
    // fall through — render as plain text below
  }

  if (!parsed || typeof parsed.summary !== 'string') {
    return <span className="text-graphite-muted">{reasoning}</span>;
  }

  return (
    <div>
      <p className="text-graphite-muted">{parsed.summary}</p>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-1 text-xs font-medium text-cobalt-700 hover:underline"
      >
        {expanded ? 'Hide details' : 'View details'}
      </button>
      {expanded && Array.isArray(parsed.signals) && (
        <div className="mt-2 max-w-sm rounded border border-hairline bg-porcelain p-3">
          <SignalsList signals={parsed.signals} />
        </div>
      )}
    </div>
  );
}

function EvidenceAgentReasoning({ reasoning }) {
  let parsed = null;
  try {
    parsed = JSON.parse(reasoning);
  } catch {
    // fall through — render as plain text below
  }

  if (!parsed || typeof parsed.whyThisEvidence !== 'string') {
    return <span className="text-graphite-muted">{reasoning}</span>;
  }

  return (
    <div>
      <p className="text-graphite-muted">{parsed.whyThisEvidence}</p>
      {Array.isArray(parsed.citedArtifacts) && parsed.citedArtifacts.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {parsed.citedArtifacts.map((a) => (
            <span key={a} className="rounded-full border border-hairline px-2 py-0.5 text-[10px] font-medium text-graphite-muted">
              {a}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// PART A (point 6): routed_to_pending_review's reasoning is a plain string
// for the score-proximity/high-value rules but structured JSON for
// model_disagreement (see pipeline.js) — same actor/action either way, so
// this cell has to tell them apart itself rather than assume one shape.
function PendingReviewReasoning({ reasoning }) {
  let parsed = null;
  try {
    parsed = JSON.parse(reasoning);
  } catch {
    // fall through — a plain score-proximity/high-value string
  }

  if (!parsed || parsed.rule !== 'model_disagreement') {
    return <span className="text-graphite-muted">{reasoning}</span>;
  }

  return (
    <div>
      <p className="font-medium text-danger-700">Models disagree</p>
      <p className="mt-0.5 text-graphite-muted">
        LLM: {parsed.llmVerdict.replace(/_/g, ' ')} ({Math.round(parsed.llmScore * 100)}%) · Classifier:{' '}
        {parsed.classifierVerdict.replace(/_/g, ' ')} ({Math.round(parsed.classifierScore * 100)}%)
      </p>
    </div>
  );
}

// PART C (point 8): the same checkmark-plus-code marker that appears live
// in the Dispute Detail drawer, next to "approved" entries here — same
// pseudoVerificationCode(disputeId) seed as DisputeDetail.jsx, so the two
// views show byte-identical codes for the same event, not two different-
// looking ones. Always at-rest here (animate=false) — the Audit Trail is
// the permanent record, not the live moment.
function ApprovedReasoning({ disputeId }) {
  return <VerificationStamp code={pseudoVerificationCode(disputeId)} animate={false} />;
}

function ReasoningCell({ log }) {
  if (log.actor === 'risk_scorer' && log.action === 'scored' && log.reasoning) {
    return <RiskScorerReasoning reasoning={log.reasoning} />;
  }
  if (log.actor === 'evidence_agent' && log.action === 'drafted' && log.reasoning) {
    return <EvidenceAgentReasoning reasoning={log.reasoning} />;
  }
  if (log.actor.startsWith('human:') && log.action === 'approved') {
    return <ApprovedReasoning disputeId={log.disputeId} />;
  }
  if (log.actor === 'system' && log.action === 'routed_to_pending_review' && log.reasoning) {
    return <PendingReviewReasoning reasoning={log.reasoning} />;
  }
  if (!log.reasoning) return <span className="text-graphite-muted">—</span>;
  return (
    <span className="block max-w-xs truncate text-graphite-muted" title={log.reasoning}>
      {log.reasoning}
    </span>
  );
}

export default function AuditTrail() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actorFilter, setActorFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedId, setSelectedId] = useState(null);

  const { onUpdate } = useSocketContext();

  function fetchLogs() {
    const params = actorFilter && actorFilter !== 'human' ? { actor: actorFilter } : undefined;
    return getAuditLogs(params);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchLogs()
      .then((data) => {
        if (!cancelled) setLogs(data);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorFilter]);

  useEffect(() => {
    return onUpdate(() => {
      fetchLogs()
        .then((data) => setLogs(data))
        .catch((err) => setError(err.message));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onUpdate, actorFilter]);

  const filtered = useMemo(() => {
    return logs.filter((log) => {
      if (actorFilter === 'human' && !log.actor.startsWith('human:')) return false;
      if (statusFilter && log.dispute?.status !== statusFilter) return false;
      return true;
    });
  }, [logs, actorFilter, statusFilter]);

  return (
    <div className="p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-(--color-graphite)">Audit Trail</h1>
          <p className="mt-1 text-sm text-graphite-muted">Every automated and human step, across every dispute.</p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
            className="rounded border border-hairline bg-paper px-3 py-2 text-sm text-(--color-graphite) focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt-600"
          >
            {ACTOR_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded border border-hairline bg-paper px-3 py-2 text-sm text-(--color-graphite) focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt-600"
          >
            {STATUS_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded border border-danger-100 bg-danger-50 px-4 py-3 text-sm text-danger-700">
          Failed to load audit logs: {error}
        </div>
      )}

      <div className="mt-6 overflow-x-auto rounded border border-hairline bg-paper">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-xs font-medium uppercase tracking-wide text-graphite-muted">
              <th className="px-4 py-3">Timestamp</th>
              <th className="px-4 py-3">Dispute</th>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Reasoning</th>
            </tr>
          </thead>
          <tbody>
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-graphite-muted">
                  No audit log entries match this filter.
                </td>
              </tr>
            )}
            {filtered.map((log) => (
              <tr key={log.id} className="border-b border-hairline align-top last:border-0 hover:bg-porcelain">
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-graphite-muted">{formatTimestamp(log.createdAt)}</td>
                <td className="px-4 py-3">
                  <button type="button" onClick={() => setSelectedId(log.disputeId)} className="text-left hover:underline">
                    <div className="font-mono font-medium tabular-nums text-(--color-graphite)">
                      {log.dispute ? formatCurrency(log.dispute.amount, log.dispute.currency) : '—'}
                    </div>
                    <div className="font-mono text-xs text-graphite-muted">{log.dispute?.razorpayId ?? log.disputeId}</div>
                  </button>
                </td>
                <td className="px-4 py-3">
                  <span className="rounded-full border border-hairline px-2.5 py-1 text-xs font-medium text-graphite-muted">
                    {actorLabel(log.actor)}
                  </span>
                </td>
                <td className="px-4 py-3 text-graphite-muted">{log.action.replace(/_/g, ' ')}</td>
                <td className="px-4 py-3">
                  <ReasoningCell log={log} />
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
