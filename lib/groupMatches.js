// lib/groupMatches.js
//
// Hiérarchise une liste de matchs en Jour > Championnat (cahier des
// charges, module 1 & correctif d'organisation) :
//
//   Niveau 1 — Jour       : les matchs sont d'abord regroupés par date
//                           calendaire réelle (utcDate, en UTC), pas
//                           seulement par la date sélectionnée dans
//                           l'interface. Ceci est indispensable quand
//                           l'élargissement de fenêtre (lib/dataSources.js)
//                           s'est déclenché : dans ce cas l'API peut
//                           renvoyer des matchs répartis sur plusieurs
//                           jours voisins, qui ne doivent JAMAIS apparaître
//                           mélangés sous une même journée.
//   Niveau 2 — Championnat : à l'intérieur de chaque jour, les matchs sont
//                           regroupés par compétition, triée du niveau le
//                           plus élevé au plus modeste (coefficient de
//                           lib/leagueStrength.js), puis par ordre
//                           alphabétique à coefficient égal.
//
// Le tri est systématique et ne dépend jamais de l'ordre dans lequel l'API
// a renvoyé les matchs : les groupes eux-mêmes sont triés après coup, et
// les matchs à l'intérieur d'un groupe de championnat sont triés par heure
// de coup d'envoi.

import { getLeagueStrength } from './leagueStrength';

function matchDateKey(match) {
  try {
    return new Date(match.utcDate).toISOString().slice(0, 10);
  } catch (error) {
    return 'date-inconnue';
  }
}

/**
 * Regroupe une liste de matchs (déjà filtrée sur un seul jour, cas normal)
 * par compétition, triée par niveau puis nom, avec les matchs de chaque
 * groupe triés chronologiquement.
 *
 * @param {Array} matches
 * @returns {Array<{ competition: object, matches: Array }>}
 */
export function groupMatchesByCompetition(matches) {
  const groups = new Map();

  (matches || []).forEach((match) => {
    const key = match.competition?.id ?? match.competition?.name ?? 'inconnue';
    if (!groups.has(key)) {
      groups.set(key, { competition: match.competition, matches: [] });
    }
    groups.get(key).matches.push(match);
  });

  const sortedGroups = Array.from(groups.values()).sort((a, b) => {
    const coeffA = getLeagueStrength(a.competition?.code).coefficient;
    const coeffB = getLeagueStrength(b.competition?.code).coefficient;
    if (coeffB !== coeffA) return coeffB - coeffA;
    return (a.competition?.name || '').localeCompare(b.competition?.name || '');
  });

  // Tri systématique DES MATCHS à l'intérieur de chaque championnat, par
  // heure de coup d'envoi — indépendant de l'ordre renvoyé par l'API.
  sortedGroups.forEach((group) => {
    group.matches.sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));
  });

  return sortedGroups;
}

/**
 * Hiérarchie complète Jour > Championnat. À utiliser systématiquement pour
 * le rendu de la liste des matchs : dans le cas normal (un seul jour
 * effectivement présent dans `matches`), renvoie un seul groupe de date et
 * se comporte comme un simple passe-plat vers groupMatchesByCompetition.
 * Dans le cas de l'élargissement de fenêtre, sépare proprement chaque jour.
 *
 * @param {Array} matches
 * @returns {Array<{ dateKey: string, competitions: Array }>}
 */
export function groupMatchesByDateThenCompetition(matches) {
  const byDate = new Map();

  (matches || []).forEach((match) => {
    const key = matchDateKey(match);
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(match);
  });

  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateKey, dayMatches]) => ({
      dateKey,
      competitions: groupMatchesByCompetition(dayMatches),
    }));
}
