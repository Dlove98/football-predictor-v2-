'use client';

import { useEffect, useMemo, useState } from 'react';
import Header from '../components/Header';
import DateSelector from '../components/DateSelector';
import LearningBadge from '../components/LearningBadge';
import CompetitionGroup from '../components/CompetitionGroup';
import MatchCard from '../components/MatchCard';
import PredictionModal from '../components/PredictionModal';
import DailyAccumulator from '../components/DailyAccumulator';
import CouponGenerator from '../components/CouponGenerator';
import { groupMatchesByDateThenCompetition } from '../lib/groupMatches';
import { verifyTendency } from '../lib/verification';
import { recordVerifiedPick } from '../lib/learningEngine';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateHeading(dateKey) {
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(new Date(`${dateKey}T00:00:00Z`));
  } catch (error) {
    return dateKey;
  }
}

function CardSkeleton() {
  return (
    <div className="rounded-xl2 border border-line bg-base-900/70 p-4 h-[210px] animate-pulse">
      <div className="h-3 w-24 bg-base-700 rounded mb-6" />
      <div className="h-4 bg-base-700 rounded mb-6" />
      <div className="h-10 bg-base-700 rounded mb-6" />
      <div className="h-8 bg-base-700 rounded" />
    </div>
  );
}

function EmptyState({ dateLabel }) {
  return (
    <div className="col-span-full flex flex-col items-center justify-center text-center py-20 px-6 rounded-xl2 border border-dashed border-line">
      <div className="w-12 h-12 rounded-full bg-base-800 border border-line flex items-center justify-center mb-4">
        <span className="text-xl">⚽</span>
      </div>
      <p className="text-ink-100 font-medium mb-1">Calme plat sur {dateLabel}</p>
      <p className="text-sm text-ink-500 max-w-sm">
        Aucune rencontre majeure recensée pour le moment. Essayez une autre date dans le sélecteur
        ci-dessus.
      </p>
    </div>
  );
}

export default function HomePage() {
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [matches, setMatches] = useState([]);
  const [isLoadingMatches, setIsLoadingMatches] = useState(true);
  const [predictions, setPredictions] = useState([]);
  const [isLoadingPredictions, setIsLoadingPredictions] = useState(true);
  const [activeMatch, setActiveMatch] = useState(null);
  const [windowExpanded, setWindowExpanded] = useState(false);

  // 1) Chargement des matchs de la date sélectionnée.
  useEffect(() => {
    let isCancelled = false;

    async function loadMatches() {
      setIsLoadingMatches(true);
      setPredictions([]);
      try {
        const response = await fetch(`/api/matches?date=${selectedDate}`, { cache: 'no-store' });
        if (!response.ok) {
          console.error(`[HomePage] Échec HTTP ${response.status} sur /api/matches`);
        }
        const data = await response.json();
        if (!isCancelled) {
          setMatches(Array.isArray(data.matches) ? data.matches : []);
          setWindowExpanded(Boolean(data.windowExpanded));
        }
      } catch (error) {
        console.error('[HomePage] Erreur lors du chargement des matchs —', error);
        if (!isCancelled) {
          setMatches([]);
          setWindowExpanded(false);
        }
      } finally {
        if (!isCancelled) setIsLoadingMatches(false);
      }
    }

    loadMatches();
    return () => {
      isCancelled = true;
    };
  }, [selectedDate]);

  // 2) Une fois les matchs connus, prédiction légère en lot (score exact +
  // tendance sur chaque carte, module 1 ; alimente aussi le combiné et le
  // générateur de coupon).
  useEffect(() => {
    if (isLoadingMatches) return;
    if (matches.length === 0) {
      setPredictions([]);
      setIsLoadingPredictions(false);
      return;
    }

    let isCancelled = false;

    async function loadPredictions() {
      setIsLoadingPredictions(true);
      try {
        const response = await fetch('/api/batch-predict', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ matches }),
          cache: 'no-store',
        });
        if (!response.ok) {
          console.error(`[HomePage] Échec HTTP ${response.status} sur /api/batch-predict`);
        }
        const data = await response.json();
        if (!isCancelled) {
          setPredictions(Array.isArray(data.predictions) ? data.predictions : []);
        }
      } catch (error) {
        console.error('[HomePage] Erreur lors du chargement des prédictions —', error);
        if (!isCancelled) setPredictions([]);
      } finally {
        if (!isCancelled) setIsLoadingPredictions(false);
      }
    }

    loadPredictions();
    return () => {
      isCancelled = true;
    };
  }, [matches, isLoadingMatches]);

  // 3) Passe d'auto-calibration (module "apprendre de ses erreurs") : pour
  // chaque match déjà terminé, on vérifie la Tendance principale contre le
  // score réel et on enregistre le résultat en local — sans base de
  // données externe, purement sur cet appareil.
  useEffect(() => {
    predictions.forEach((p) => {
      if (p.status !== 'FINISHED' || !p.primaryTendency) return;
      const verification = verifyTendency(p.primaryTendency, p.realScore);
      if (verification.status === 'unknown') return;
      recordVerifiedPick({
        matchId: p.matchId,
        type: p.primaryTendency.type,
        confidencePct: p.confidence,
        wasCorrect: verification.status === 'won',
      });
    });
  }, [predictions]);

  const predictionByMatchId = useMemo(() => {
    const map = new Map();
    predictions.forEach((p) => map.set(p.matchId, p));
    return map;
  }, [predictions]);

  const groupedByDate = useMemo(() => groupMatchesByDateThenCompetition(matches), [matches]);

  const dateLabel = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${selectedDate}T00:00:00`));

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <Header />

      <section className="mb-6">
        <DateSelector selectedDate={selectedDate} onSelectDate={setSelectedDate} />
      </section>

      <section className="mb-6 flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-ink-500 capitalize">{dateLabel}</p>
        <div className="flex items-center gap-2">
          {windowExpanded && !isLoadingMatches && matches.length > 0 && (
            <p className="text-[11px] text-ink-700">Fenêtre élargie automatiquement</p>
          )}
          <LearningBadge />
        </div>
      </section>

      {!isLoadingMatches && matches.length > 0 && (
        <DailyAccumulator predictions={predictions} isLoading={isLoadingPredictions} />
      )}

      {!isLoadingMatches && matches.length > 0 && (
        <CouponGenerator predictions={predictions} />
      )}

      {isLoadingMatches ? (
        <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </section>
      ) : matches.length === 0 ? (
        <section className="grid grid-cols-1 gap-4">
          <EmptyState dateLabel={dateLabel} />
        </section>
      ) : (
        groupedByDate.map((dayGroup) => (
          <div key={dayGroup.dateKey} className="mb-2">
            {groupedByDate.length > 1 && (
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500 border-b border-line pb-2 mb-4 mt-2">
                {formatDateHeading(dayGroup.dateKey)}
              </h3>
            )}
            {dayGroup.competitions.map((group) => (
              <CompetitionGroup
                key={group.competition?.id ?? group.competition?.name}
                competition={group.competition}
              >
                {group.matches.map((match) => (
                  <MatchCard
                    key={match.id}
                    match={match}
                    prediction={predictionByMatchId.get(match.id)}
                    isPredictionLoading={isLoadingPredictions}
                    onOpenAnalysis={setActiveMatch}
                  />
                ))}
              </CompetitionGroup>
            ))}
          </div>
        ))
      )}

      {activeMatch && (
        <PredictionModal match={activeMatch} onClose={() => setActiveMatch(null)} />
      )}
    </main>
  );
}
