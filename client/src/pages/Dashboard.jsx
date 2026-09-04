import { useEffect, useMemo, useState } from 'react';
import { getDisputes, getMetrics } from '../lib/api';
import { useSocketContext } from '../hooks/SocketContext';
import { formatCurrency } from '../lib/format';
import StatCard from '../components/StatCard';
import ActivityFeed from '../components/ActivityFeed';
import RealPaymentTrigger from '../components/RealPaymentTrigger';

function formatPct(value) {
  return value == null ? '—' : `${(value * 100).toFixed(0)}%`;
}

// businessValue's rupee-denominated figures (opsCostSaved, the assumed
// hourly rate) aren't dispute amounts — they're not stored in the smallest
// currency unit the way dispute.amount is, so formatCurrency's /100 would
// be wrong here. Same Intl formatting, whole rupees in, whole rupees out.
function formatWholeCurrency(amount, currency = 'INR') {
  if (amount == null) return '—';
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

// Statuses that are done moving — everything else is still "in flight" and
// counts toward amount at risk.
const TERMINAL_STATUSES = new Set(['submitted', 'won', 'lost']);

export default function Dashboard() {
  const [disputes, setDisputes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [metricsError, setMetricsError] = useState(null);
  const { events, onUpdate } = useSocketContext();

  // Initial state: fetch once via REST on mount.
  useEffect(() => {
    let cancelled = false;

    getDisputes()
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
  }, []);

  // Same pattern for /metrics — its own aggregate fetch, refreshed below on
  // the same socket events rather than any polling interval.
  useEffect(() => {
    let cancelled = false;
    getMetrics()
      .then((data) => {
        if (!cancelled) setMetrics(data);
      })
      .catch((err) => {
        if (!cancelled) setMetricsError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // After that, the socket keeps it updated — merge each incoming dispute
  // into local state rather than re-fetching.
  useEffect(() => {
    return onUpdate((updated) => {
      setDisputes((prev) => {
        const idx = prev.findIndex((d) => d.id === updated.id);
        if (idx === -1) return [updated, ...prev];
        const next = prev.slice();
        next[idx] = { ...next[idx], ...updated };
        return next;
      });
    });
  }, [onUpdate]);

  // /metrics is a whole-table aggregate, so a partial dispute update can't
  // be merged into it — refetch it in full, same event-driven trigger.
  useEffect(() => {
    return onUpdate(() => {
      getMetrics()
        .then((data) => setMetrics(data))
        .catch((err) => setMetricsError(err.message));
    });
  }, [onUpdate]);

  const stats = useMemo(() => {
    let atRisk = 0;
    let defended = 0;
    let lost = 0;

    for (const d of disputes) {
      if (d.status === 'submitted') defended += d.amount;
      else if (d.status === 'lost') lost += d.amount;
      else if (!TERMINAL_STATUSES.has(d.status)) atRisk += d.amount;
    }

    const decided = defended + lost;
    const winRate = decided > 0 ? (defended / decided) * 100 : null;

    return { total: disputes.length, atRisk, defended, lost, winRate };
  }, [disputes]);

  return (
    <div className="p-8">
      <h1 className="font-display text-xl font-semibold text-(--color-graphite)">Dashboard</h1>
      <p className="mt-1 text-sm text-graphite-muted">Live overview of every dispute in the pipeline.</p>

      {error && (
        <div className="mt-4 rounded border border-danger-100 bg-danger-50 px-4 py-3 text-sm text-danger-700">
          Failed to load disputes: {error}
        </div>
      )}

      {/* GAP 2 (point 7): reputational-risk warning — a clearly separate,
          clearly-labeled card, not folded into the money-based stats below.
          Only rendered when disputeRatio actually exceeds
          DISPUTE_RATIO_WARNING; the illustrative-threshold disclaimer is
          part of the card text itself, not just this component's comments,
          so it can't be quoted without the caveat attached. */}
      {metrics?.reputationalRisk?.exceedsThreshold && (
        <div className="mt-4 rounded border border-caution-600 bg-caution-50 px-4 py-3 text-sm text-caution-700">
          <p className="font-semibold">⚠ Reputational risk — dispute ratio</p>
          <p className="mt-1">
            Dispute ratio is approaching network monitoring-program territory (illustrative threshold — verify
            against current Visa/Mastercard published thresholds before citing a specific number):{' '}
            <strong className="font-mono tabular-nums">{(metrics.reputationalRisk.disputeRatio * 100).toFixed(2)}%</strong> (
            {metrics.reputationalRisk.disputesFiledThisPeriod} disputes /{' '}
            {metrics.reputationalRisk.totalTxnVolume.toLocaleString()} transactions) vs. a configured warning
            threshold of {(metrics.reputationalRisk.warningThreshold * 100).toFixed(2)}%.
          </p>
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Total disputes" value={loading ? '—' : stats.total} tone="neutral" />
        <StatCard
          label="Amount at risk"
          value={loading ? '—' : formatCurrency(stats.atRisk)}
          sublabel="Non-terminal disputes"
          tone="caution"
        />
        <StatCard
          label="Amount defended"
          value={loading ? '—' : formatCurrency(stats.defended)}
          sublabel="Submitted"
          tone="success"
        />
        <StatCard
          label="Amount lost"
          value={loading ? '—' : formatCurrency(stats.lost)}
          sublabel="Lost"
          tone="danger"
        />
        <StatCard
          label="Win rate"
          value={loading ? '—' : stats.winRate === null ? '—' : `${stats.winRate.toFixed(0)}%`}
          sublabel="Defended vs. lost"
          tone="accent"
        />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h2 className="text-sm font-semibold text-(--color-graphite)">Live activity</h2>
          <p className="mt-1 text-xs text-graphite-muted">Last 15 minutes — newest first, each item clears on its own.</p>
          <div className="mt-3">
            <ActivityFeed events={events} />
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-(--color-graphite)">Model performance</h2>
          <p className="mt-1 text-xs text-graphite-muted">Precision, recall, false-positive cost.</p>

          {metricsError && (
            <div className="mt-3 rounded border border-danger-100 bg-danger-50 px-4 py-3 text-xs text-danger-700">
              Failed to load metrics: {metricsError}
            </div>
          )}

          {!metricsError && metrics && metrics.gradedCount === 0 && (
            <div className="mt-3 rounded border border-dashed border-hairline bg-paper p-6 text-center text-sm text-graphite-muted">
              No graded disputes yet — see the Metrics page for details.
            </div>
          )}

          {!metricsError && metrics && metrics.gradedCount > 0 && (
            <div className="mt-3 space-y-3">
              <StatCard
                label="Precision"
                value={formatPct(metrics.precision)}
                sublabel={`Across ${metrics.gradedCount} graded disputes`}
                tone="accent"
              />
              <StatCard label="Recall" value={formatPct(metrics.recall)} tone="accent" />
              <StatCard
                label="False positive cost"
                value={formatCurrency(metrics.falsePositiveCost)}
                sublabel="Effort wasted on hopeless cases"
                tone="caution"
              />
            </div>
          )}

          {!metricsError && !metrics && (
            <div className="mt-3 rounded border border-dashed border-hairline bg-paper p-6 text-center text-sm text-graphite-muted">
              Loading…
            </div>
          )}
        </div>
      </div>

      {/* Part D: business-value figures — each one real counted/measured
          data multiplied by an explicitly assumed rate (see /metrics'
          businessValue.note). The assumed rate is stated directly in the
          sublabel, next to the number it produced, rather than tucked into
          a tooltip — the whole point is that nobody has to go hunting for
          the assumption behind a headline figure. */}
      {!metricsError && metrics && metrics.businessValue && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-(--color-graphite)">Business value (assumption-based estimate)</h2>
          <p className="mt-1 text-xs text-graphite-muted">
            Not a Razorpay-provided or independently verified figure — see the assumed rate on each card.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <StatCard
              label="Est. annual value protected"
              value={formatCurrency(metrics.businessValue.estimatedAnnualValueProtected)}
              sublabel={
                metrics.businessValue.estimatedAnnualValueProtected == null
                  ? 'Not enough graded disputes yet to estimate this'
                  : `Avg. graded dispute × ${formatPct(metrics.businessValue.winRateImprovement)} win-rate improvement × assumed ${metrics.businessValue.assumedMonthlyDisputeVolume}/month × 12`
              }
              tone="success"
            />
            <StatCard
              label="Hours saved"
              value={`${metrics.businessValue.hoursSaved.toFixed(1)} hrs`}
              sublabel={`${metrics.businessValue.scoredDisputeCount} disputes scored × assumed ${metrics.businessValue.assumedMinutesPerManualReview} min/manual review ≈ ${formatWholeCurrency(metrics.businessValue.opsCostSaved)} at an assumed ${formatWholeCurrency(metrics.businessValue.assumedHourlyOpsCost)}/hr`}
              tone="accent"
            />
          </div>
        </div>
      )}

      <div className="mt-8 max-w-2xl">
        <RealPaymentTrigger />
      </div>
    </div>
  );
}
