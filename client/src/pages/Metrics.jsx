import { useEffect, useState } from 'react';
import { getMetrics, getMetricsMl } from '../lib/api';
import { useSocketContext } from '../hooks/SocketContext';
import { formatCurrency } from '../lib/format';
import StatCard from '../components/StatCard';
import ConfusionMatrix from '../components/ConfusionMatrix';

function formatPct(value) {
  return value == null ? '—' : `${(value * 100).toFixed(0)}%`;
}

function MoneyBar({ label, sublabel, amount, max, tone }) {
  const widthPct = max > 0 ? Math.max((amount / max) * 100, amount > 0 ? 2 : 0) : 0;
  const barClasses = {
    neutral: 'bg-hairline',
    accent: 'bg-cobalt-600',
    caution: 'bg-caution-600',
  }[tone];

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-(--color-graphite)">{label}</span>
        <span className="font-mono text-sm font-semibold tabular-nums text-(--color-graphite)">{formatCurrency(amount)}</span>
      </div>
      <div className="mt-1.5 h-2 w-full rounded-full bg-hairline">
        <div className={`h-2 rounded-full transition-all ${barClasses}`} style={{ width: `${widthPct}%` }} />
      </div>
      <p className="mt-1 text-xs text-graphite-muted">{sublabel}</p>
    </div>
  );
}

export default function Metrics() {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [mlMetrics, setMlMetrics] = useState(null);
  const [mlLoading, setMlLoading] = useState(true);
  const [mlError, setMlError] = useState(null);
  const { onUpdate } = useSocketContext();

  function refetch() {
    return getMetrics()
      .then((data) => setMetrics(data))
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    setLoading(true);
    setError(null);
    refetch().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    return onUpdate(() => {
      refetch();
    });
  }, [onUpdate]);

  useEffect(() => {
    setMlLoading(true);
    setMlError(null);
    getMetricsMl()
      .then((data) => setMlMetrics(data))
      .catch((err) => setMlError(err.message))
      .finally(() => setMlLoading(false));
  }, []);

  const { confusionMatrix, precision, recall, falsePositiveCost, falseNegativeCost, modelResult, baselines, labeledCount, gradedCount } =
    metrics ?? {};

  const maxBar = metrics
    ? Math.max(baselines.acceptEverything.moneyDefended, modelResult, baselines.contestEverything.moneyDefended, 1)
    : 1;

  return (
    <div className="p-8">
      <h1 className="font-display text-xl font-semibold text-(--color-graphite)">Metrics</h1>
      <p className="mt-1 text-sm text-graphite-muted">
        Grading the risk scorer's verdicts against ground truth — how often it was right, and what being wrong cost.
      </p>

      {error && (
        <div className="mt-4 rounded border border-danger-100 bg-danger-50 px-4 py-3 text-sm text-danger-700">
          Failed to load metrics: {error}
        </div>
      )}

      {loading && <p className="mt-6 text-sm text-graphite-muted">Loading…</p>}

      {!loading && metrics && gradedCount === 0 && (
        <div className="mt-6 rounded border border-dashed border-hairline bg-paper p-6 text-sm text-graphite-muted">
          No graded disputes yet — {labeledCount} dispute{labeledCount === 1 ? '' : 's'} carry a ground truth label,
          but none of them have a risk scorer verdict to compare it against. Trigger a synthetic dispute and wait for
          it to score, then check back here.
        </div>
      )}

      {!loading && metrics && (
        <>
          <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
            <div>
              <h2 className="text-sm font-semibold text-(--color-graphite)">Confusion matrix</h2>
              <p className="mt-1 text-xs text-graphite-muted">
                Evaluated across all scored disputes ({gradedCount} graded) — verdict vs. ground truth.
              </p>
              <div className="mt-3">
                <ConfusionMatrix {...confusionMatrix} />
              </div>
            </div>

            <div>
              <h2 className="text-sm font-semibold text-(--color-graphite)">Model performance</h2>
              <p className="mt-1 text-xs text-graphite-muted">Precision, recall, and the cost of being wrong in each direction.</p>
              <div className="mt-3 grid grid-cols-2 gap-4">
                <StatCard label="Precision" value={formatPct(precision)} sublabel="TP / (TP + FP)" tone="accent" />
                <StatCard label="Recall" value={formatPct(recall)} sublabel="TP / (TP + FN)" tone="accent" />
                <StatCard
                  label="False positive cost"
                  value={formatCurrency(falsePositiveCost)}
                  sublabel={
                    metrics?.chargebackFee
                      ? `Disputed amount + ${formatCurrency(metrics.chargebackFee)} chargeback fee per case`
                      : 'Effort wasted on hopeless cases'
                  }
                  tone="caution"
                />
                <StatCard
                  label="False negative cost"
                  value={formatCurrency(falseNegativeCost)}
                  sublabel="Money left on the table"
                  tone="caution"
                />
              </div>
            </div>
          </div>

          {metrics.reputationalRisk && (
            <div className="mt-10 max-w-2xl rounded border border-hairline bg-paper p-6">
              <h2 className="text-sm font-semibold text-(--color-graphite)">Reputational risk — dispute ratio</h2>
              <p className="mt-1 text-xs text-graphite-muted">
                A merchant's dispute RATE, not just how individual cases are graded — a cost the confusion matrix
                above can't capture.
              </p>
              <div className="mt-4 flex items-baseline gap-3">
                <span className="font-display text-2xl font-semibold tabular-nums text-(--color-graphite)">
                  {formatPct(metrics.reputationalRisk.disputeRatio)}
                </span>
                <span className="text-xs text-graphite-muted">
                  {metrics.reputationalRisk.disputesFiledThisPeriod} disputes /{' '}
                  {metrics.reputationalRisk.totalTxnVolume.toLocaleString()} transactions (all-time — this app has
                  no date-range concept yet)
                </span>
              </div>
              {metrics.reputationalRisk.exceedsThreshold ? (
                <p className="mt-3 rounded bg-caution-50 px-3 py-2 text-xs font-medium text-caution-700">
                  ⚠ Exceeds the configured warning threshold ({formatPct(metrics.reputationalRisk.warningThreshold)}).
                </p>
              ) : (
                <p className="mt-3 text-xs text-graphite-muted">
                  Below the configured warning threshold ({formatPct(metrics.reputationalRisk.warningThreshold)}).
                </p>
              )}
              <p className="mt-3 text-xs text-graphite-muted">{metrics.reputationalRisk.note}</p>
            </div>
          )}

          <div className="mt-10">
            <h2 className="text-sm font-semibold text-(--color-graphite)">Money defended: model vs. baselines</h2>
            <p className="mt-1 text-xs text-graphite-muted">
              The model should land above "accept everything" without spending "contest everything"'s effort.
            </p>
            <div className="mt-4 max-w-2xl space-y-5 rounded border border-hairline bg-paper p-6">
              <MoneyBar
                label="Accept everything"
                sublabel="Contest nothing — 0 cases, 0 effort"
                amount={baselines.acceptEverything.moneyDefended}
                max={maxBar}
                tone="neutral"
              />
              <MoneyBar
                label="Model (actual)"
                sublabel="Disputes the pipeline pursued and actually got submitted"
                amount={modelResult}
                max={maxBar}
                tone="accent"
              />
              <MoneyBar
                label="Contest everything"
                sublabel={`Fight every case, including hopeless ones — ${baselines.contestEverything.effortCount} cases, full effort`}
                amount={baselines.contestEverything.moneyDefended}
                max={maxBar}
                tone="caution"
              />
            </div>
          </div>
        </>
      )}

      <MlClassifierSection loading={mlLoading} error={mlError} data={mlMetrics} />
    </div>
  );
}

// A visibly distinct card — heavier border, a cobalt top rule, an explicit
// eyebrow label — so this reads as a different methodology from the LLM
// grading above it, not a continuation of the same one.
function MlClassifierSection({ loading, error, data }) {
  return (
    <div className="mt-12 rounded border border-hairline border-t-2 border-t-cobalt-600 bg-paper p-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-cobalt-700">Offline · Trained Model</p>
      <h2 className="mt-1 font-display text-base font-semibold text-(--color-graphite)">
        Baseline ML Classifier (trained, held-out test set)
      </h2>
      <p className="mt-1 text-xs text-graphite-muted">
        A separate, genuinely fitted logistic regression — not the Gemini agent above. Evaluated on a held-out test
        set the model never trained on, not across all scored disputes.
      </p>

      {loading && <p className="mt-4 text-sm text-graphite-muted">Loading…</p>}

      {!loading && error && (
        <div className="mt-4 rounded border border-dashed border-hairline bg-porcelain px-4 py-3 text-sm text-graphite-muted">
          No trained classifier yet ({error}). Run <code className="font-mono text-xs">npm run export-dataset</code>{' '}
          from <code className="font-mono text-xs">server/</code>, then{' '}
          <code className="font-mono text-xs">python train_classifier.py</code> from{' '}
          <code className="font-mono text-xs">server/scripts/ml/</code> — see the README.
        </div>
      )}

      {!loading && !error && data && (
        <>
          {data.warnings && data.warnings.length > 0 && (
            <div className="mt-4 space-y-2">
              {data.warnings.map((w, i) => (
                <div key={i} className="rounded border border-caution-100 bg-caution-50 px-4 py-3 text-xs text-caution-700">
                  {w}
                </div>
              ))}
            </div>
          )}

          <div className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <StatCard label="Dataset size" value={data.datasetSize} sublabel="Total labeled rows" tone="neutral" />
            <StatCard label="Train / test split" value={`${data.trainSetSize} / ${data.testSetSize}`} sublabel="80/20 stratified" tone="neutral" />
            <StatCard
              label="Test set balance"
              value={`${data.testSetClassBalance.trueCount}T / ${data.testSetClassBalance.falseCount}F`}
              sublabel={data.testSetClassBalance.truePct != null ? `${data.testSetClassBalance.truePct}% true` : undefined}
              tone="neutral"
            />
            <StatCard label="Model" value={data.model} sublabel="scikit-learn" tone="neutral" />
          </div>

          <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold text-(--color-graphite)">Confusion matrix</h3>
              <p className="mt-1 text-xs text-graphite-muted">Held-out test set only — {data.testSetSize} disputes the model never trained on.</p>
              <div className="mt-3">
                <ConfusionMatrix {...data.confusionMatrix} totalLabel="test set" />
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-(--color-graphite)">Test-set performance</h3>
              <p className="mt-1 text-xs text-graphite-muted">Same precision/recall/cost definitions as the LLM section above, for a fair comparison.</p>
              <div className="mt-3 grid grid-cols-2 gap-4">
                <StatCard label="Precision" value={formatPct(data.precision)} sublabel="TP / (TP + FP)" tone="accent" />
                <StatCard label="Recall" value={formatPct(data.recall)} sublabel="TP / (TP + FN)" tone="accent" />
                <StatCard
                  label="False positive cost"
                  value={formatCurrency(data.falsePositiveCost)}
                  sublabel="Effort wasted on hopeless cases"
                  tone="caution"
                />
                <StatCard
                  label="False negative cost"
                  value={formatCurrency(data.falseNegativeCost)}
                  sublabel="Money left on the table"
                  tone="caution"
                />
              </div>
            </div>
          </div>

          <p className="mt-6 text-xs text-graphite-muted">{data.costNote}</p>
          <p className="mt-1 text-xs text-graphite-muted">
            Trained {new Date(data.generatedAt).toLocaleString()} — rerun <code className="font-mono">train_classifier.py</code> to
            refresh after generating more data.
          </p>
        </>
      )}
    </div>
  );
}
