// app/api/matches/route.js
//
// Route serveur : renvoie la liste des matchs pour une date donnée.
// Toute la logique d'appel réseau (no-store, élargissement de fenêtre,
// journalisation des erreurs) vit dans lib/dataSources.js — cette route se
// contente d'orchestrer et de mettre en forme la réponse pour le client.

import { NextResponse } from 'next/server';
import { fetchMatchesWithWindowExpansion } from '../../../lib/dataSources';
import { getLeagueStrength } from '../../../lib/leagueStrength';

// Empêche toute mise en cache de la route elle-même côté Next.js/Vercel.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function isValidISODate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const requestedDate = searchParams.get('date');

  if (!requestedDate || !isValidISODate(requestedDate)) {
    console.error(`[api/matches] Paramètre "date" invalide ou manquant: ${requestedDate}`);
    return NextResponse.json(
      { error: 'Paramètre "date" invalide. Format attendu : YYYY-MM-DD.' },
      { status: 400 }
    );
  }

  try {
    const { matches, effectiveDateFrom, effectiveDateTo, expanded } =
      await fetchMatchesWithWindowExpansion(requestedDate);

    const simplifiedMatches = matches.map((match) => ({
      id: match.id,
      utcDate: match.utcDate,
      status: match.status,
      competition: {
        id: match.competition?.id ?? null,
        code: match.competition?.code ?? null,
        name: match.competition?.name ?? 'Compétition',
        emblem: match.competition?.emblem ?? null,
        tier: getLeagueStrength(match.competition?.code).tier,
      },
      homeTeam: {
        id: match.homeTeam?.id ?? null,
        name: match.homeTeam?.shortName || match.homeTeam?.name || 'Équipe à domicile',
        crest: match.homeTeam?.crest ?? null,
      },
      awayTeam: {
        id: match.awayTeam?.id ?? null,
        name: match.awayTeam?.shortName || match.awayTeam?.name || 'Équipe à l\'extérieur',
        crest: match.awayTeam?.crest ?? null,
      },
      score: match.score?.fullTime ?? null,
    }));

    return NextResponse.json({
      requestedDate,
      effectiveDateFrom,
      effectiveDateTo,
      windowExpanded: expanded,
      matches: simplifiedMatches,
    });
  } catch (error) {
    // Filet de sécurité final : même une erreur inattendue ne doit jamais
    // faire planter la route sans laisser de trace exploitable.
    console.error('[api/matches] Erreur inattendue lors de la récupération des matchs —', error);
    return NextResponse.json({ requestedDate, matches: [], error: 'internal_error' }, { status: 200 });
  }
}
