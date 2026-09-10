'use client';

function LegVerificationDot({ leg }) {
  if (!leg.verification || leg.verification.status === 'pending') {
    return <span className="w-1.5 h-1.5 rounded-full bg-ink-700 shrink-0" title="À venir" />;
  }
  const isWon = leg.verification.status === 'won';
  return (
    <span
      className={`w-1.5 h-1.5 rounded-full shrink-0 ${isWon ? 'bg-signal-home' : 'bg-signal-risk'}`}
      title={leg.verification.label}
    />
  );
}

function OverallBadge({ status }) {
  const map = {
    won: { text: 'Combiné gagnant', tone: 'text-signal-home border-signal-home/30 bg-signal-home/10' },
    lost: { text: 'Combiné perdant', tone: 'text-signal-risk border-signal-risk/30 bg-signal-risk/10' },
    partial: {
      text: 'En partie validé',
      tone: 'text-signal-draw border-signal-draw/30 bg-signal-draw/10',
    },
    pending: { text: 'À venir', tone: 'text-ink-500 border-line bg-base-800/60' },
  };
  const item = map[status] || map.pending;
  return (
    <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full border ${item.tone}`}>
      {item.text}
    </span>
  );
}

export default function CouponResultCard({ coupon, verification, emptyLabel }) {
  if (!coupon || coupon.selections.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-ink-500">
        {emptyLabel || 'Aucune sélection exploitable pour cette date.'}
      </div>
    );
  }

  const legs = verification ? verification.perLeg : coupon.selections;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-mono font-semibold text-signal-home">
            {coupon.combinedOdds}
          </span>
          <span className="text-xs text-ink-500">cote cumulée indicative</span>
        </div>
        <div className="flex items-center gap-2">
          {verification && <OverallBadge status={verification.overallStatus} />}
          <span className="text-[11px] text-ink-700">
            {coupon.reachedCount}/{coupon.requestedCount} sélections ·{' '}
            {coupon.combinedProbabilityPct}% de probabilité combinée
          </span>
        </div>
      </div>

      {coupon.thresholdRelaxedFrom && (
        <p className="text-[11px] text-ink-700">
          Seuil de fiabilité assoupli de {coupon.thresholdRelaxedFrom}% à {coupon.effectiveThresholdPct}%
          pour atteindre l'objectif de sélections — calendrier du jour plus restreint.
        </p>
      )}
      {coupon.widenedBeyondBtts && (
        <p className="text-[11px] text-ink-700">
          Sélection élargie au-delà du BTTS ({coupon.groupsUsed.join(', ')}) faute d'assez de
          matchs exploitables aujourd'hui.
        </p>
      )}

      <div className="space-y-1.5">
        {legs.map((leg) => (
          <div
            key={leg.matchId}
            className="flex items-center justify-between gap-2 rounded-lg border border-line bg-base-800/40 px-3 py-2"
          >
            <div className="min-w-0 flex items-center gap-2">
              {verification && <LegVerificationDot leg={leg} />}
              <div className="min-w-0">
                <p className="text-xs text-ink-100 truncate">
                  {leg.homeTeamName} <span className="text-ink-700">–</span> {leg.awayTeamName}
                </p>
                <p className="text-[11px] text-ink-500 truncate">{leg.label}</p>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs font-mono text-ink-100">{leg.fairOdds}</p>
              <p className="text-[10px] text-ink-700">{leg.probabilityPct}%</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
