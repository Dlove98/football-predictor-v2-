// app/api/predict/route.js
//
// Route serveur : calcule la prédiction IA COMPLÈTE d'un match précis, à la
// demande (quand l'utilisateur ouvre la modale d'analyse). Contrairement à
// /api/batch-predict (léger, utilisé pour l'affichage en liste), cette
// route va chercher l'historique H2H et l'ensemble du contexte stratégique
// (module 6) : c'est volontairement plus coûteux en appels API, donc
// réservé à une consultation explicite plutôt qu'à un chargement en masse.

import { NextResponse } from 'next/server';
import {
  fetchTeamRecentMatches,
  fetchHeadToHead,
} from '../../../lib/dataSources';
import { generatePrediction } from '../../../lib/scoringEngine';
import { computeMatchContext, resolveContextualHistory } from '../../../lib/contextEngine';
import { isEuropeanCupCompetition } from '../../../lib/leagueStrength';
import { getCachedPrediction, setCachedPrediction } from '../../../lib/predictionCache';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function isoDateOnly(utcDate) {
  try {
    return new Date(utcDate).toISOString().slice(0, 10);
  } catch (error) {
    return new Date().toISOString().slice(0, 10);
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const matchId = searchParams.get('matchId');
  const homeTeamId = searchParams.get('homeTeamId');
  const awayTeamId = searchParams.get('awayTeamId');
  const homeTeamName = searchParams.get('homeTeamName') || 'Domicile';
  const awayTeamName = searchParams.get('awayTeamName') || 'Extérieur';
  const competitionId = searchParams.get('competitionId');
  const competitionCode = searchParams.get('competitionCode');
  const utcDate = searchParams.get('utcDate');

  if (!matchId || !homeTeamId || !awayTeamId) {
    console.error(
      `[api/predict] Paramètres manquants — matchId=${matchId}, homeTeamId=${homeTeamId}, awayTeamId=${awayTeamId}`
    );
    return NextResponse.json(
      { error: 'Paramètres matchId, homeTeamId et awayTeamId requis.' },
      { status: 400 }
    );
  }

  const matchDateISO = utcDate ? isoDateOnly(utcDate) : new Date().toISOString().slice(0, 10);
  const numericMatchId = Number(matchId);
  const numericHomeId = Number(homeTeamId);
  const numericAwayId = Number(awayTeamId);
  const isEuropeanFixture = isEuropeanCupCompetition(competitionCode);

  // Déterminisme perçu : si ce match précis a déjà été analysé récemment,
  // on renvoie EXACTEMENT le même résultat plutôt que de relancer un calcul
  // qui pourrait légitimement bouger si, entre-temps, un appel réseau a
  // échoué puis réussi (ou l'inverse). Voir lib/predictionCache.js.
  const cached = getCachedPrediction('heavy', numericMatchId);
  if (cached) {
    return NextResponse.json(cached);
  }

  try {
    // 1) Historique "généraliste" (toutes compétitions couvertes par le
    // plan API) + H2H + contexte stratégique, en parallèle.
    const [homeGeneralMatches, awayGeneralMatches, h2hResult, matchContext] = await Promise.all([
      fetchTeamRecentMatches(numericHomeId, 10),
      fetchTeamRecentMatches(numericAwayId, 10),
      fetchHeadToHead(numericMatchId, 8),
      computeMatchContext({
        homeTeamId: numericHomeId,
        awayTeamId: numericAwayId,
        matchDateISO,
        competitionId,
        competitionCode,
      }),
    ]);

    // 2) Segmentation Europe/domicile (module 6.2) : ne déclenche des appels
    // supplémentaires que si le match analysé est lui-même une coupe
    // d'Europe — sinon on réutilise directement l'historique généraliste.
    const [homeHistory, awayHistory] = await Promise.all([
      resolveContextualHistory({
        teamId: numericHomeId,
        isEuropeanFixture,
        fallbackMatches: homeGeneralMatches,
      }),
      resolveContextualHistory({
        teamId: numericAwayId,
        isEuropeanFixture,
        fallbackMatches: awayGeneralMatches,
      }),
    ]);

    const prediction = generatePrediction({
      homeTeamId: numericHomeId,
      awayTeamId: numericAwayId,
      homeTeamName,
      awayTeamName,
      homeRecentMatches: homeHistory.matches,
      awayRecentMatches: awayHistory.matches,
      h2hMatches: h2hResult.matches,
      excludeMatchId: numericMatchId,
      context: matchContext,
    });

    const responseBody = {
      matchId,
      prediction,
      context: {
        isEuropeanFixture,
        leagueTier: matchContext.leagueStrength.tier,
        notes: matchContext.notes,
        homeEuropeSegmentUsed: homeHistory.europeSegmentUsed,
        awayEuropeSegmentUsed: awayHistory.europeSegmentUsed,
      },
    };

    // On ne mémorise que les résultats obtenus sans passer par le filet de
    // secours (catch ci-dessous) : une prédiction dégradée par un échec
    // réseau ne doit jamais rester figée pour les 30 prochaines minutes.
    setCachedPrediction('heavy', numericMatchId, responseBody, { utcDate });

    return NextResponse.json(responseBody);
  } catch (error) {
    console.error(`[api/predict] Erreur inattendue pour le match ${matchId} —`, error);
    // Même en cas d'erreur imprévue, l'IA "ne bloque jamais" : on retombe
    // sur une prédiction basée uniquement sur les moyennes de référence.
    const fallbackPrediction = generatePrediction({
      homeTeamId: numericHomeId,
      awayTeamId: numericAwayId,
      homeTeamName,
      awayTeamName,
      homeRecentMatches: [],
      awayRecentMatches: [],
      h2hMatches: [],
    });
    return NextResponse.json({
      matchId,
      prediction: fallbackPrediction,
      context: { isEuropeanFixture, leagueTier: null, notes: [] },
      degraded: true,
    });
  }
}
