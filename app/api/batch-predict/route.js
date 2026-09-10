// app/api/batch-predict/route.js
//
// Route serveur : calcule une prédiction LÉGÈRE pour un lot de matchs
// (généralement : tous les matchs d'une date). Utilisée pour :
//   - afficher directement le score exact estimé + la tendance sur chaque
//     carte de match de la page d'accueil (module 1) ;
//   - alimenter "Le Combiné DTech du Jour" (module 3) ;
//   - alimenter le générateur de coupon personnalisé (module 6).
//
// Volontairement plus légère que /api/predict : pas de H2H, pas de
// segmentation Europe ni de calcul de calendrier chargé/classement (ces
// analyses coûteuses en appels API sont réservées à la modale détaillée,
// ouverte à la demande). Le coefficient de force du championnat (module
// 6.1), lui, ne coûte AUCUN appel réseau supplémentaire : il reste donc
// pleinement actif ici.
//
// Optimisation quota : chaque équipe n'est interrogée qu'UNE seule fois
// même si elle apparaît dans plusieurs matchs du lot, via un cache local à
// la requête, et les appels sont limités en concurrence pour respecter le
// plafond de football-data.org (10 requêtes/minute sur le plan gratuit).

import { NextResponse } from 'next/server';
import { fetchTeamRecentMatches, mapWithConcurrency } from '../../../lib/dataSources';
import { generatePrediction } from '../../../lib/scoringEngine';
import { getCachedPrediction, setCachedPrediction } from '../../../lib/predictionCache';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const TEAM_FETCH_CONCURRENCY = 4;
const RECENT_MATCHES_LIMIT = 8;

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch (error) {
    console.error('[api/batch-predict] Corps de requête JSON invalide —', error);
    return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 });
  }

  const matches = Array.isArray(body?.matches) ? body.matches : [];
  if (matches.length === 0) {
    return NextResponse.json({ predictions: [] });
  }

  // Déterminisme perçu + économie de quota : un match déjà analysé
  // récemment renvoie EXACTEMENT la même prédiction (voir
  // lib/predictionCache.js), au lieu d'être recalculé — et donc
  // potentiellement affecté par un aléa réseau différent — à chaque
  // rechargement de la page. Seuls les matchs réellement nouveaux (ou dont
  // le cache a expiré) déclenchent de nouveaux appels API.
  const alreadyCached = new Map();
  const toCompute = [];
  matches.forEach((match) => {
    const cached = getCachedPrediction('light', match.id);
    if (cached) {
      alreadyCached.set(match.id, cached);
    } else {
      toCompute.push(match);
    }
  });

  if (toCompute.length === 0) {
    return NextResponse.json({ predictions: matches.map((m) => alreadyCached.get(m.id)) });
  }

  // 1) Liste dédupliquée des équipes à interroger — uniquement pour les
  // matchs qui ne sont pas déjà en cache.
  const teamIds = new Set();
  toCompute.forEach((m) => {
    if (m.homeTeam?.id != null) teamIds.add(m.homeTeam.id);
    if (m.awayTeam?.id != null) teamIds.add(m.awayTeam.id);
  });

  const teamForm = new Map();
  await mapWithConcurrency(Array.from(teamIds), TEAM_FETCH_CONCURRENCY, async (teamId) => {
    const recentMatches = await fetchTeamRecentMatches(teamId, RECENT_MATCHES_LIMIT);
    teamForm.set(teamId, recentMatches);
  });

  // 2) Une prédiction par match restant, à partir du cache de forme déjà
  // récupéré — aucun appel réseau supplémentaire à ce stade.
  toCompute.forEach((match) => {
    const homeRecentMatches = teamForm.get(match.homeTeam?.id) || [];
    const awayRecentMatches = teamForm.get(match.awayTeam?.id) || [];

    const prediction = generatePrediction({
      homeTeamId: match.homeTeam?.id,
      awayTeamId: match.awayTeam?.id,
      homeTeamName: match.homeTeam?.name || 'Domicile',
      awayTeamName: match.awayTeam?.name || 'Extérieur',
      homeRecentMatches,
      awayRecentMatches,
      // Exclut le match lui-même de son propre échantillon de forme : sur
      // une date passée, ce match apparaît désormais comme FINISHED dans
      // l'historique récent de chaque équipe — l'utiliser fausserait la
      // vérification a posteriori (module 4) en le faisant "prédire" son
      // propre résultat déjà connu.
      excludeMatchId: match.id,
    });

    const entry = {
      matchId: match.id,
      competitionId: match.competition?.id ?? null,
      competitionCode: match.competition?.code ?? null,
      competitionName: match.competition?.name ?? 'Compétition',
      competitionEmblem: match.competition?.emblem ?? null,
      homeTeamId: match.homeTeam?.id ?? null,
      awayTeamId: match.awayTeam?.id ?? null,
      homeTeamName: match.homeTeam?.name || 'Domicile',
      awayTeamName: match.awayTeam?.name || 'Extérieur',
      utcDate: match.utcDate,
      status: match.status,
      realScore: match.score || null,
      ...prediction,
    };

    // Un match FINISHED ne bougera plus jamais : on le mémorise pour de bon
    // (dans la limite de la durée de vie du process) plutôt que de recalculer
    // inutilement à chaque consultation d'une date passée.
    setCachedPrediction('light', match.id, entry, {
      utcDate: match.utcDate,
      isFinished: match.status === 'FINISHED',
    });
    alreadyCached.set(match.id, entry);
  });

  return NextResponse.json({ predictions: matches.map((m) => alreadyCached.get(m.id)) });
}
