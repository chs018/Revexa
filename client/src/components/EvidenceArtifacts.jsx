// GAP 1: the three distinct evidence artifacts as small cards, above the
// rebuttal letter — cited ones (from citedArtifacts, the evidence agent's
// own account of what it actually drew on) get a visibly different
// treatment from uncited-but-present ones, so "this is what the draft
// leaned on" is obvious at a glance, not just present in the API response.

function formatShortDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function CitedTag() {
  // Hairline cobalt outline, not a filled block — cited artifacts are a
  // meaningful moment (what the draft actually leans on) but the one
  // accent color still has to stay rare on a card grid with several of
  // these in view at once.
  return (
    <span className="rounded-full border border-cobalt-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cobalt-600">
      Cited
    </span>
  );
}

function ArtifactCard({ title, cited, empty, children }) {
  return (
    <div className={`rounded border p-3 ${cited ? 'border-cobalt-600 bg-paper' : 'border-hairline bg-paper'}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-graphite-muted">{title}</h3>
        {cited && <CitedTag />}
      </div>
      <div className="mt-2">
        {empty ? <p className="text-xs italic text-graphite-muted">Not available for this dispute.</p> : children}
      </div>
    </div>
  );
}

// GAP 1 (point 4): per-element pass/fail row for the CE 3.0 qualification
// card below — element name, whether it matched, and (for the two elements
// Visa's rule treats as device-level) a small tag calling that out, since
// matching userId/shippingAddress alone isn't enough to qualify.
const DEVICE_LEVEL_ELEMENTS = ['ipAddress', 'deviceId'];
const ELEMENT_LABELS = {
  userId: 'User ID',
  ipAddress: 'IP address',
  shippingAddress: 'Shipping address',
  deviceId: 'Device ID',
};

function ElementRow({ name, matched }) {
  return (
    <li className="flex items-center justify-between gap-2 rounded border border-hairline px-2 py-1.5 text-xs">
      <span className="flex items-center gap-1.5">
        <span
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
            matched ? 'bg-success-100 text-success-700' : 'bg-hairline text-graphite-muted'
          }`}
          aria-hidden="true"
        >
          {matched ? '✓' : '✕'}
        </span>
        <span className="text-(--color-graphite)">{ELEMENT_LABELS[name] ?? name}</span>
        {DEVICE_LEVEL_ELEMENTS.includes(name) && (
          <span className="rounded-full border border-hairline px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-graphite-muted">
            Device-level
          </span>
        )}
      </span>
      <span className={matched ? 'font-medium text-success-700' : 'text-graphite-muted'}>{matched ? 'Match' : 'No match'}</span>
    </li>
  );
}

// GAP 1 (point 4): renders the CE 3.0 qualification check explicitly — every
// one of the four matchingDataElements with its own pass/fail, plus the
// prior-transactions and overall verdict — instead of collapsing it into a
// summary sentence. `qualification` is the SAME object ce3Qualification.js
// computed server-side (evidenceAgent.js passes it into the "drafted" audit
// log reasoning); this component never recomputes it, just displays it.
function Ce3QualificationCard({ ce3Evidence, qualification, cited }) {
  if (!ce3Evidence) {
    return (
      <ArtifactCard title="Visa Compelling Evidence 3.0" cited={false} empty>
        {null}
      </ArtifactCard>
    );
  }

  const elements = ce3Evidence.matchingDataElements ?? {};
  const qualifies = qualification?.qualifies ?? false;

  return (
    <ArtifactCard title="Visa Compelling Evidence 3.0" cited={cited}>
      <div
        className={`mb-2 rounded px-2 py-1.5 text-xs font-semibold ${
          qualifies ? 'bg-success-100 text-success-700' : 'bg-caution-100 text-caution-700'
        }`}
      >
        {qualifies ? 'Qualifies for CE 3.0' : 'Does not qualify for CE 3.0'}
      </div>

      <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-graphite-muted">Matching data elements</p>
      <ul className="space-y-1">
        {Object.entries(elements).map(([name, matched]) => (
          <ElementRow key={name} name={name} matched={matched} />
        ))}
      </ul>

      <p className="mb-1 mt-2 text-[10px] font-medium uppercase tracking-wide text-graphite-muted">
        Prior undisputed transactions
      </p>
      <ul className="space-y-1 text-xs text-graphite-muted">
        {(ce3Evidence.priorUndisputedTransactions ?? []).map((t, i) => (
          <li key={i} className="rounded border border-hairline px-2 py-1.5">
            <span className="font-mono">{t.transactionId}</span> — {t.daysBeforeDispute}d before dispute,{' '}
            {t.previouslyDisputedOrFlagged ? (
              <span className="font-medium text-caution-700">previously flagged</span>
            ) : (
              <span className="text-graphite-muted">clean</span>
            )}
          </li>
        ))}
      </ul>

      {!qualifies && qualification?.reasons?.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-caution-700">
          {qualification.reasons.map((reason, i) => (
            <li key={i}>• {reason}</li>
          ))}
        </ul>
      )}
    </ArtifactCard>
  );
}

export default function EvidenceArtifacts({ evidenceContext, citedArtifacts, ce3Qualification }) {
  if (!evidenceContext) return null;

  const cited = Array.isArray(citedArtifacts) ? citedArtifacts : [];
  const { transactionLog, deliveryConfirmation, communicationTrail, ce3Evidence } = evidenceContext;

  // GAP 1 (point 3): display labels renamed to industry-standard terms —
  // these three are still general evidence categories, not a verified
  // Mastercard/Visa field-level taxonomy (see evidenceAgent.js's
  // ARTIFACT_DISPLAY_NAMES comment for why that distinction matters). The
  // CE 3.0 card above is the one place this app claims an actual
  // network-schema mapping, because it's the one place that's been
  // confirmed.
  return (
    <div className={`mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3 ${ce3Evidence ? 'lg:grid-cols-4' : ''}`}>
      <ArtifactCard title="Transaction Timeline" cited={cited.includes('transactionLog')} empty={!transactionLog?.length}>
        <ol className="space-y-1.5">
          {transactionLog?.map((e, i) => (
            <li key={i} className="flex items-baseline justify-between gap-2 text-xs">
              <span className="capitalize text-(--color-graphite)">{e.event.replace(/_/g, ' ')}</span>
              <span className="shrink-0 font-mono text-[10px] text-graphite-muted">{formatShortDate(e.timestamp)}</span>
            </li>
          ))}
        </ol>
      </ArtifactCard>

      <ArtifactCard
        title="Proof of Delivery"
        cited={cited.includes('deliveryConfirmation')}
        empty={!deliveryConfirmation}
      >
        {deliveryConfirmation && (
          <dl className="space-y-1 text-xs text-graphite-muted">
            <div>
              <dt className="inline font-medium text-(--color-graphite)">Status: </dt>
              <dd className="inline capitalize">{deliveryConfirmation.status.replace(/_/g, ' ')}</dd>
            </div>
            <div>
              <dt className="inline font-medium text-(--color-graphite)">Carrier: </dt>
              <dd className="inline">{deliveryConfirmation.carrier}</dd>
            </div>
            <div>
              <dt className="inline font-medium text-(--color-graphite)">Tracking: </dt>
              <dd className="inline font-mono">{deliveryConfirmation.trackingNumber}</dd>
            </div>
            {deliveryConfirmation.signedBy && (
              <div>
                <dt className="inline font-medium text-(--color-graphite)">Signed by: </dt>
                <dd className="inline">{deliveryConfirmation.signedBy}</dd>
              </div>
            )}
          </dl>
        )}
      </ArtifactCard>

      <ArtifactCard
        title="Communication Record"
        cited={cited.includes('communicationTrail')}
        empty={!communicationTrail?.length}
      >
        <ul className="space-y-1.5">
          {communicationTrail?.map((m, i) => (
            <li key={i} className="text-xs">
              <span className={`font-medium ${m.from === 'merchant' ? 'text-cobalt-700' : 'text-(--color-graphite)'}`}>
                {m.from}:
              </span>{' '}
              <span className="text-graphite-muted">{m.message}</span>
            </li>
          ))}
        </ul>
      </ArtifactCard>

      {ce3Evidence && (
        <Ce3QualificationCard
          ce3Evidence={ce3Evidence}
          qualification={ce3Qualification}
          cited={cited.includes('ce3Evidence')}
        />
      )}
    </div>
  );
}
