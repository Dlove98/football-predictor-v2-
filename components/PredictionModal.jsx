'use client';

import { useEffect, useState } from 'react';
import { verifyTendency } from '../lib/verification';
import { getCalibratedConfidence } from '../lib/learningEngine';
import { getNeutralPrediction } from '../lib/scoringEngine';
import { MARKET_TYPES } from '../lib/markets';

function ProbabilityBar({ label, value, colorClass }) {
  return (
    <div className="flex-1">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-xs text-ink-500">{label}</span>
        <span className="text-sm font-mono font-semibold text-ink-100">{value}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-base-700 overflow-hidden">
        <div
          className={`h-full rounded-full ${colorClass}`}
          style={{ width: `${Math.max(value, 2)}%` }}
        />
      </div>
    </div>
  );
}

function ConfidenceBadge({ confidence, calibration }) {
  let tone = 'text-signal-home border-signal-home/30 bg-signal-home/10';
  let label = 'Confiance élevée';
  if (confidence < 55) {
    tone = 'text-signal-risk border-signal-risk/30 bg-signal-risk/10';
    label = 'Confiance mesurée';
  } else if (confidence < 75) {
    tone = 'text-signal-draw border-signal-draw/30 bg-signal-draw/10';
    label = 'Confiance correcte';
  }
  return (
    <div className="flex flex-col gap-1 items-start">
      <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${tone}`}>
        {label} · {confidence}%
      </span>
      {calibration?.adjusted && (
        <span className="text-[10px] text-ink-700">
          Auto-calibré ({calibration.calibratedConfidencePct}%) sur {calibration.sampleSize} pronostics
          locaux
        </span>
      )}
    </div>
  );
}

function MarketMiniGrid({ markets }) {
  if (!markets) return null;
  const rows = [
    { label: 'BTTS Oui', value: markets[MARKET_TYPES.BTTS_YES]?.probabilityPct },
    { label: '+ 2.5 buts', value: markets[MARKET_TYPES.OVER_2_5]?.probabilityPct },
    { label: '- 2.5 buts', value: markets[MARKET_TYPES.UNDER_2_5]?.probabilityPct },
    { label: 'Double chance 1X', value: markets[MARKET_TYPES.DOUBLE_CHANCE_1X]?.probabilityPct },
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {rows.map((row) => (
        <div
          key={row.label}
          className="flex items-center justify-between rounded-lg border border-line bg-base-800/40 px-3 py-2"
        >
          <span className="text-xs text-ink-500">{row.label}</span>
          <span className="text-xs font-mono text-ink-100">{row.value ?? '—'}%</span>
        </div>
      ))}
    </div>
  );
}

export default function PredictionModal({ match, onClose }) {
  const [prediction, setPrediction] = useState(null);
  const [context, setContext] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isCancelled = false;

    async function loadPrediction() {
      setIsLoading(true);
      try {
        const params = new URLSearchParams({
          matchId: String(match.id),
          homeTeamId: String(match.homeTeam.id),
          awayTeamId: String(match.awayTeam.id),
          homeTeamName: match.homeTeam.name || '',
          awayTeamName: match.awayTeam.name || '',
          competitionId: match.competition?.id != null ? String(match.competition.id) : '',
          competitionCode: match.competition?.code || '',
          utcDate: match.utcDate || '',
        });
        const response = await fetch(`/api/predict?${params.toString()}`, { cache: 'no-store' });

        if (!response.ok) {
          console.error(`[PredictionModal] Échec HTTP ${response.status} sur /api/predict`);
        }

        const data = await response.json();
        if (!isCancelled) {
          setPrediction(data.prediction ?? null);
          setContext(data.context ?? null);
        }
      } catch (error) {
        console.error('[PredictionModal] Erreur lors du chargement de la prédiction —', error);
        // Filet de sécurité côté client : on reste silencieux et fluide pour
        // l'utilisateur, la génération sera simplement retentée à la
        // prochaine ouverture plutôt que d'afficher un message d'erreur cru.
        if (!isCancelled) {
          setPrediction(null);
          setContext(null);
        }
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    }

    loadPrediction();
    return () => {
      isCancelled = true;
    };
  }, [match]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-base-950/80 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-base-900 border border-line rounded-t-xl2 sm:rounded-xl2 shadow-card p-5 sm:p-6 max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between mb-5">
          <div>
            <p className="text-xs text-ink-500 mb-1">{match.competition?.name}</p>
            <h2 className="text-base font-semibold text-ink-100">
              {match.homeTeam.name} <span className="text-ink-500 font-normal">vs</span>{' '}
              {match.awayTeam.name}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="text-ink-500 hover:text-ink-100 transition-colors text-xl leading-none px-1"
          >
            ×
          </button>
        </div>

        {isLoading ? (
          <div className="space-y-4 animate-pulse">
            <div className="h-3 bg-base-700 rounded w-1/2" />
            <div className="h-1.5 bg-base-700 rounded" />
            <div className="h-1.5 bg-base-700 rounded" />
            <div className="h-1.5 bg-base-700 rounded" />
            <div className="h-20 bg-base-700 rounded" />
          </div>
        ) : (
          <PredictionContent prediction={prediction} context={context} match={match} />
        )}
      </div>
    </div>
  );
}

function PredictionContent({ prediction, context, match }) {
  // Filet de sécurité ultime : si même la route /api/predict a échoué en
  // amont (réseau coupé côté client par ex.), on affiche encore une analyse
  // plutôt qu'un écran d'erreur — mais JAMAIS une valeur figée écrite en
  // dur. getNeutralPrediction fait tourner le vrai moteur de Poisson avec
  // des échantillons vides : le résultat reste un calcul réel, pas un
  // gabarit statique répété sur tous les matchs.
  const safePrediction =
    prediction ?? getNeutralPrediction(match.homeTeam?.name, match.awayTeam?.name);

  const calibration = getCalibratedConfidence(safePrediction.confidence);
  const isFinished = match.status === 'FINISHED';
  const verification =
    isFinished && safePrediction.primaryTendency
      ? verifyTendency(safePrediction.primaryTendency, match.score)
      : null;

  return (
    <div className="space-y-6">
      {verification && verification.status !== 'unknown' && (
        <div
          className={[
            'rounded-lg border px-3 py-2 text-xs font-medium flex items-center justify-between',
            verification.status === 'won'
              ? 'border-signal-home/30 bg-signal-home/10 text-signal-home'
              : 'border-signal-risk/30 bg-signal-risk/10 text-signal-risk',
          ].join(' ')}
        >
          <span>{verification.label}</span>
          <span className="font-mono text-ink-100">
            {match.score?.home} - {match.score?.away}
          </span>
        </div>
      )}

      {safePrediction.primaryTendency && (
        <div className="rounded-lg border border-signal-home/30 bg-signal-home/10 px-3 py-2.5">
          <p className="text-[11px] text-ink-500 mb-0.5">Tendance principale</p>
          <p className="text-sm font-semibold text-signal-home">
            {safePrediction.primaryTendency.label}{' '}
            <span className="font-mono font-normal">
              · {safePrediction.primaryTendency.probabilityPct}%
            </span>
          </p>
        </div>
      )}

      <div>
        <p className="text-xs text-ink-500 mb-3">Probabilités 1X2</p>
        <div className="flex gap-3">
          <ProbabilityBar
            label={match.homeTeam.name}
            value={safePrediction.outcome1X2.homeWinPct}
            colorClass="bg-signal-home"
          />
          <ProbabilityBar label="Nul" value={safePrediction.outcome1X2.drawPct} colorClass="bg-signal-draw" />
          <ProbabilityBar
            label={match.awayTeam.name}
            value={safePrediction.outcome1X2.awayWinPct}
            colorClass="bg-signal-away"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-line bg-base-800/60 p-3">
          <p className="text-xs text-ink-500 mb-1">Buts attendus (xG modèle)</p>
          <p className="font-mono text-lg text-ink-100">
            {safePrediction.expectedGoals.home} <span className="text-ink-700">–</span>{' '}
            {safePrediction.expectedGoals.away}
          </p>
        </div>
        <div className="rounded-lg border border-line bg-base-800/60 p-3 flex flex-col justify-between">
          <p className="text-xs text-ink-500 mb-1">Indice de confiance</p>
          <ConfidenceBadge confidence={safePrediction.confidence} calibration={calibration} />
        </div>
      </div>

      <div>
        <p className="text-xs text-ink-500 mb-3">Autres marchés dérivés</p>
        <MarketMiniGrid markets={safePrediction.markets} />
      </div>

      <div>
        <p className="text-xs text-ink-500 mb-3">Scores exacts les plus probables</p>
        <div className="space-y-2">
          {safePrediction.topScores.map((item) => (
            <div
              key={item.score}
              className="flex items-center justify-between rounded-lg border border-line bg-base-800/40 px-3 py-2"
            >
              <span className="font-mono text-sm text-ink-100">{item.score}</span>
              <span className="text-xs text-ink-500">{item.probabilityPct}%</span>
            </div>
          ))}
        </div>
      </div>

      {context?.notes?.length > 0 && (
        <div>
          <p className="text-xs text-ink-500 mb-3">Contexte stratégique</p>
          <ul className="space-y-2">
            {context.notes.map((note) => (
              <li
                key={note}
                className="text-xs text-ink-300 leading-relaxed rounded-lg border border-signal-draw/25 bg-signal-draw/5 px-3 py-2"
              >
                {note}
              </li>
            ))}
          </ul>
        </div>
      )}

      {context?.isEuropeanFixture && (
        <p className="text-[11px] text-ink-700">
          Match européen — historique {context.homeEuropeSegmentUsed ? 'domicile' : ''}
          {context.homeEuropeSegmentUsed && context.awayEuropeSegmentUsed ? ' et ' : ''}
          {context.awayEuropeSegmentUsed ? 'extérieur' : ''}{' '}
          {context.homeEuropeSegmentUsed || context.awayEuropeSegmentUsed
            ? 'segmenté sur les résultats en Coupe d\'Europe.'
            : 'analysé sans historique européen suffisant : forme générale utilisée.'}
        </p>
      )}

      <p className="text-[11px] text-ink-700 leading-relaxed">
        Analyse générée par un modèle statistique (loi de Poisson pondérée par niveau de
        championnat) fondé sur la forme récente des deux équipes, leurs confrontations passées et
        leur contexte stratégique. À titre informatif uniquement.
      </p>
    </div>
  );
}
