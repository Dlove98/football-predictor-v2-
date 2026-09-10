// lib/couponEngine.js
//
// Construit un coupon (combiné) à partir d'une liste de prédictions de
// matchs déjà calculées (voir app/api/batch-predict). Utilisé par deux
// fonctionnalités qui partagent exactement la même logique :
//   - "Le Combiné DTech du Jour" (module 3) : version automatique, au
//     moins 13 sélections, marchés les plus fiables du jour ;
//   - le générateur de coupon personnalisé (module 6, ajout utilisateur) :
//     version pilotée par l'utilisateur (types de pronostic, cote visée,
//     % de réussite visé, nombre de matchs).
//
// "Cote" = cote décimale ÉQUITABLE dérivée de la probabilité du modèle
// (1 / probabilité), sans marge bookmaker puisque l'application ne
// consomme aucune cote de marché réelle. C'est explicité côté UI comme une
// cote indicative, pas une cote de pari en argent réel.

import { MARKET_GROUPS } from './markets';

const DEFAULT_GROUP_KEYS = Object.keys(MARKET_GROUPS);
const MIN_LEG_PROBABILITY_FLOOR = 45; // en dessous, une sélection n'est plus jugée exploitable
const THRESHOLD_RELAXATION_STEP = 5;

/**
 * Pour un match donné (avec son objet `markets` déjà calculé par le moteur
 * de scoring) et une liste de familles de marché autorisées, retourne la
 * meilleure sélection possible pour CE match (celle qui a la probabilité la
 * plus élevée parmi les sous-marchés des familles choisies).
 */
function bestLegForMatch(matchPrediction, allowedGroupKeys) {
  const candidateTypes = allowedGroupKeys.flatMap((key) => MARKET_GROUPS[key]?.types || []);
  let best = null;

  candidateTypes.forEach((type) => {
    const market = matchPrediction.markets?.[type];
    if (!market) return;
    if (!best || market.probabilityPct > best.probabilityPct) {
      best = market;
    }
  });

  if (!best) return null;

  return {
    matchId: matchPrediction.matchId,
    competitionName: matchPrediction.competitionName,
    homeTeamName: matchPrediction.homeTeamName,
    awayTeamName: matchPrediction.awayTeamName,
    utcDate: matchPrediction.utcDate,
    status: matchPrediction.status,
    realScore: matchPrediction.realScore || null,
    type: best.type,
    label: best.label,
    probabilityPct: best.probabilityPct,
    fairOdds: Number((100 / best.probabilityPct).toFixed(2)),
  };
}

/**
 * Construit le coupon.
 *
 * @param {object} params
 * @param {Array} params.matchPredictions Sorties de generatePrediction, une par match, enrichies de matchId/homeTeamName/etc.
 * @param {string[]} [params.allowedGroupKeys] Sous-ensemble de MARKET_GROUPS autorisé (défaut : tous)
 * @param {number} [params.targetOdds] Cote cumulée visée (optionnel)
 * @param {number} [params.targetSuccessPct] % de réussite minimum souhaité par sélection (défaut 65)
 * @param {number} [params.targetCount] Nombre de sélections visé (défaut : toutes les qualifiées, plafonné)
 */
export function buildCoupon({
  matchPredictions,
  allowedGroupKeys = DEFAULT_GROUP_KEYS,
  targetOdds = null,
  targetSuccessPct = 65,
  targetCount = null,
}) {
  const groupKeys =
    allowedGroupKeys && allowedGroupKeys.length > 0 ? allowedGroupKeys : DEFAULT_GROUP_KEYS;

  // Une seule sélection par match (jamais deux marchés sur la même
  // rencontre : ce serait redondant/corrélé dans un même combiné).
  const pool = matchPredictions
    .map((mp) => bestLegForMatch(mp, groupKeys))
    .filter(Boolean)
    .sort((a, b) => b.probabilityPct - a.probabilityPct);

  let threshold = Math.max(targetSuccessPct, MIN_LEG_PROBABILITY_FLOOR);
  let relaxedFrom = null;
  let selections = pool.filter((leg) => leg.probabilityPct >= threshold);

  const desiredCount = targetCount || Math.min(pool.length, 13);

  // Philosophie "jamais de blocage" déjà en vigueur ailleurs dans l'app :
  // si le seuil demandé est trop strict pour atteindre le nombre de
  // sélections souhaité, on l'assouplit progressivement (jamais en dessous
  // de MIN_LEG_PROBABILITY_FLOOR) plutôt que de renvoyer un coupon vide ou
  // incomplet sans explication.
  while (selections.length < desiredCount && threshold > MIN_LEG_PROBABILITY_FLOOR) {
    if (relaxedFrom == null) relaxedFrom = threshold;
    threshold = Math.max(MIN_LEG_PROBABILITY_FLOOR, threshold - THRESHOLD_RELAXATION_STEP);
    selections = pool.filter((leg) => leg.probabilityPct >= threshold);
  }

  selections = selections.slice(0, desiredCount);

  // Si une cote cumulée cible est fournie, on retire les sélections les
  // moins probables une à une jusqu'à s'en rapprocher, sans jamais
  // descendre sous 1 sélection ni sous le nombre minimum implicite.
  if (targetOdds && selections.length > 1) {
    let currentOdds = selections.reduce((acc, leg) => acc * leg.fairOdds, 1);
    while (currentOdds < targetOdds && selections.length < pool.length) {
      const next = pool.find((leg) => !selections.includes(leg));
      if (!next) break;
      selections.push(next);
      currentOdds = selections.reduce((acc, leg) => acc * leg.fairOdds, 1);
    }
  }

  const combinedOdds = selections.reduce((acc, leg) => acc * leg.fairOdds, 1);
  // Probabilité combinée : produit des probabilités individuelles. Simplification
  // qui suppose une indépendance raisonnable entre matchs distincts (des
  // rencontres n'impliquant pas les mêmes équipes) — signalé côté UI.
  const combinedProbabilityPct = selections.reduce((acc, leg) => acc * (leg.probabilityPct / 100), 1) * 100;

  return {
    selections,
    combinedOdds: Number(combinedOdds.toFixed(2)),
    combinedProbabilityPct: Number(combinedProbabilityPct.toFixed(1)),
    requestedCount: desiredCount,
    reachedCount: selections.length,
    countSatisfied: selections.length >= desiredCount,
    effectiveThresholdPct: threshold,
    thresholdRelaxedFrom: relaxedFrom,
    availableMatchesToday: matchPredictions.length,
  };
}

// Chaîne de repli, du plus ciblé au plus large, pour "Le Combiné DTech du
// Jour" (module 3). V2.1 — le marché "Les deux équipes marquent" (BTTS) est
// désormais la cible PRIORITAIRE de la sélection automatique (stratégie
// plus ambitieuse, cotes plus généreuses qu'un combiné "double chance +
// buts" trop conservateur). On n'élargit au-delà de BTTS que si le
// calendrier du jour ne fournit vraiment pas assez de sélections
// exploitables pour atteindre l'objectif de 13 — jamais de blocage.
const DAILY_ACCUMULATOR_GROUP_CHAIN = [
  ['BTTS'],
  ['BTTS', 'OVER_UNDER_2_5'],
  ['BTTS', 'OVER_UNDER_2_5', 'DOUBLE_CHANCE'],
  DEFAULT_GROUP_KEYS,
];

/**
 * Construit "Le Combiné DTech du Jour" : au moins `targetCount` sélections
 * quand le calendrier le permet, en priorisant le marché BTTS et en
 * n'élargissant aux autres familles de marché qu'en dernier recours.
 *
 * @param {Array} matchPredictions
 * @param {number} [targetCount]
 * @param {number} [targetSuccessPct]
 */
export function buildDailyAccumulator(matchPredictions, targetCount = 13, targetSuccessPct = 60) {
  let result = null;
  let groupsUsed = DAILY_ACCUMULATOR_GROUP_CHAIN[0];

  for (const groupKeys of DAILY_ACCUMULATOR_GROUP_CHAIN) {
    result = buildCoupon({
      matchPredictions,
      allowedGroupKeys: groupKeys,
      targetSuccessPct,
      targetCount,
    });
    groupsUsed = groupKeys;
    if (result.countSatisfied) break;
  }

  const widenedBeyondBtts = groupsUsed.length > 1;

  return {
    ...result,
    strategy: 'BTTS (Les deux équipes marquent) en priorité',
    groupsUsed,
    widenedBeyondBtts,
  };
}
