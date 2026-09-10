// lib/scoringEngine.js
//
// Moteur statistique de prédiction, basé sur la loi de Poisson, enrichi
// (V2.0) d'une pondération par niveau de championnat et de modificateurs
// contextuels (calendrier chargé, enjeux de classement).
//
// Principe : jamais de blocage. Que les données de forme récente et de
// confrontations directes (H2H) soient complètes, partielles ou totalement
// absentes, ce module renvoie toujours une prédiction exploitable. Seul
// l'indice de confiance varie pour refléter honnêtement la quantité de
// données réellement disponibles — jamais de message "données non
// disponibles" côté utilisateur.

import { getLeagueStrength } from './leagueStrength';
import { MARKET_TYPES, evaluateMarket, marketLabel } from './markets';

// Moyenne de buts marqués par équipe et par match, tous championnats
// confondus (valeur de référence utilisée quand aucune donnée n'est
// disponible pour une équipe).
const LEAGUE_AVERAGE_GOALS = 1.35;
const HOME_ADVANTAGE_FACTOR = 1.12;
const MAX_GOALS_MATRIX = 6; // scores de 0 à 6 buts pris en compte
const H2H_BLEND_WEIGHT = 0.25; // poids du H2H dans l'estimation finale

function factorial(n) {
  let result = 1;
  for (let i = 2; i <= n; i += 1) result *= i;
  return result;
}

function poissonPmf(lambda, k) {
  if (lambda <= 0) lambda = 0.05; // évite une distribution dégénérée
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

/**
 * Calcule la moyenne de buts marqués/encaissés d'une équipe à partir de ses
 * derniers matchs terminés.
 *
 * Nouveauté V2.0 — pondération par niveau de championnat (module 6.1) :
 * chaque match de l'échantillon est pondéré par le coefficient de force de
 * la compétition où IL a été joué (pas seulement le championnat principal
 * de l'équipe). Un but marqué en Ligue des Champions pèse ainsi plus qu'un
 * but marqué face à une équipe de bas de tableau d'un championnat mineur.
 * Ce même principe résout naturellement la segmentation Europe/domicile :
 * un historique dominé par des matchs européens (coefficient ≈ 1.0-1.1)
 * n'est pas dilué par des scores gonflés en championnat mineur.
 *
 * @param {Array} recentMatches Matchs terminés renvoyés par l'API
 * @param {number|string} teamId
 * @param {number|string} [excludeMatchId] Match à exclure de l'échantillon
 *   (essentiel pour la vérification a posteriori : on ne doit jamais
 *   prédire un match en utilisant son propre résultat).
 * @returns {{ avgScored: number, avgConceded: number, sampleSize: number }}
 */
export function computeTeamForm(recentMatches, teamId, excludeMatchId = null) {
  const usable = (recentMatches || []).filter(
    (m) =>
      m?.score?.fullTime?.home != null &&
      m?.score?.fullTime?.away != null &&
      (excludeMatchId == null || m.id !== excludeMatchId)
  );

  if (usable.length === 0) {
    return { avgScored: LEAGUE_AVERAGE_GOALS, avgConceded: LEAGUE_AVERAGE_GOALS, sampleSize: 0 };
  }

  let weightedScored = 0;
  let weightedConceded = 0;

  usable.forEach((match) => {
    const isHome = match.homeTeam?.id === teamId;
    const homeGoals = match.score.fullTime.home;
    const awayGoals = match.score.fullTime.away;
    const coeff = getLeagueStrength(match.competition?.code).coefficient;

    const scored = isHome ? homeGoals : awayGoals;
    const conceded = isHome ? awayGoals : homeGoals;

    weightedScored += scored * coeff;
    weightedConceded += conceded / coeff;
  });

  return {
    avgScored: weightedScored / usable.length,
    avgConceded: weightedConceded / usable.length,
    sampleSize: usable.length,
  };
}

/**
 * Extrait, à partir de l'historique H2H, la moyenne de buts marqués par
 * chacune des deux équipes lorsqu'elles s'affrontent.
 */
function computeH2HAverages(h2hMatches, homeTeamId, awayTeamId) {
  const usable = (h2hMatches || []).filter(
    (m) => m?.score?.fullTime?.home != null && m?.score?.fullTime?.away != null
  );

  if (usable.length === 0) return null;

  let homeGoalsTotal = 0;
  let awayGoalsTotal = 0;

  usable.forEach((match) => {
    const homeWasHome = match.homeTeam?.id === homeTeamId;
    const goalsForCurrentHome = homeWasHome ? match.score.fullTime.home : match.score.fullTime.away;
    const goalsForCurrentAway = homeWasHome ? match.score.fullTime.away : match.score.fullTime.home;
    homeGoalsTotal += goalsForCurrentHome;
    awayGoalsTotal += goalsForCurrentAway;
  });

  return {
    avgHomeGoals: homeGoalsTotal / usable.length,
    avgAwayGoals: awayGoalsTotal / usable.length,
    sampleSize: usable.length,
  };
}

/**
 * Construit la matrice de probabilités de tous les scores exacts possibles
 * (jusqu'à MAX_GOALS_MATRIX buts par équipe) à partir des deux lambdas de
 * Poisson.
 */
function buildScoreMatrix(lambdaHome, lambdaAway) {
  const matrix = [];
  for (let h = 0; h <= MAX_GOALS_MATRIX; h += 1) {
    const row = [];
    for (let a = 0; a <= MAX_GOALS_MATRIX; a += 1) {
      row.push(poissonPmf(lambdaHome, h) * poissonPmf(lambdaAway, a));
    }
    matrix.push(row);
  }
  return matrix;
}

function derive1X2FromMatrix(matrix) {
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;

  for (let h = 0; h <= MAX_GOALS_MATRIX; h += 1) {
    for (let a = 0; a <= MAX_GOALS_MATRIX; a += 1) {
      const p = matrix[h][a];
      if (h > a) homeWin += p;
      else if (h === a) draw += p;
      else awayWin += p;
    }
  }

  // Normalisation (la matrice tronquée à 6 buts ne somme pas exactement à 1)
  const total = homeWin + draw + awayWin;
  return {
    homeWinPct: (homeWin / total) * 100,
    drawPct: (draw / total) * 100,
    awayWinPct: (awayWin / total) * 100,
  };
}

function topExactScores(matrix, count = 3) {
  const flat = [];
  for (let h = 0; h <= MAX_GOALS_MATRIX; h += 1) {
    for (let a = 0; a <= MAX_GOALS_MATRIX; a += 1) {
      flat.push({ home: h, away: a, probability: matrix[h][a] });
    }
  }
  const total = flat.reduce((sum, item) => sum + item.probability, 0);
  return flat
    .sort((a, b) => b.probability - a.probability)
    .slice(0, count)
    .map((item) => ({
      score: `${item.home} - ${item.away}`,
      probabilityPct: (item.probability / total) * 100,
    }));
}

/**
 * Calcule la probabilité (%) d'un marché donné en sommant toutes les cases
 * de la matrice de Poisson où ce marché est satisfait. Utilise la même
 * fonction evaluateMarket que le module de vérification post-match — voir
 * lib/markets.js pour l'explication de ce choix de conception.
 */
function computeMarketProbability(matrix, type) {
  let hit = 0;
  let total = 0;
  for (let h = 0; h <= MAX_GOALS_MATRIX; h += 1) {
    for (let a = 0; a <= MAX_GOALS_MATRIX; a += 1) {
      const p = matrix[h][a];
      total += p;
      if (evaluateMarket(type, h, a)) hit += p;
    }
  }
  return total > 0 ? (hit / total) * 100 : 0;
}

/**
 * Sélectionne la "Tendance principale" à afficher sur la carte du match et
 * à privilégier pour "Le Combiné DTech du Jour".
 *
 * V2.1 — règle dédiée, PAS un simple tri par probabilité : le marché "Les
 * deux équipes marquent" (BTTS) est toujours retenu en priorité (le côté
 * Oui ou Non le plus probable, selon la propension offensive/défensive
 * réelle des deux équipes calculée par le modèle). Un simple tri global
 * aurait presque toujours fait remonter des combos "double chance + 1.5
 * but" écrasés à 90 %+ de probabilité — corrects, mais trop conservateurs
 * pour la stratégie ambitieuse demandée. BTTS_YES et BTTS_NO étant
 * complémentaires (leur somme fait toujours 100 %), un côté est toujours
 * disponible : aucun repli statique n'est jamais nécessaire ici.
 */
function pickPrimaryTendency(markets) {
  const bttsYes = markets[MARKET_TYPES.BTTS_YES];
  const bttsNo = markets[MARKET_TYPES.BTTS_NO];
  if (bttsYes && bttsNo) {
    return bttsYes.probabilityPct >= bttsNo.probabilityPct ? bttsYes : bttsNo;
  }
  // Filet de sécurité théorique (ne devrait jamais se produire, BTTS étant
  // toujours calculable dès qu'une matrice de score existe) : repli sur les
  // lignes de buts, elles aussi calculées dynamiquement depuis la matrice.
  const over25 = markets[MARKET_TYPES.OVER_2_5];
  const under25 = markets[MARKET_TYPES.UNDER_2_5];
  return over25.probabilityPct >= under25.probabilityPct ? over25 : under25;
}

/**
 * Calcule la probabilité de tous les marchés dérivés (BTTS, over/under,
 * double chance, combinés), directement depuis la matrice de Poisson
 * complète (aucune valeur figée) et détermine la Tendance principale.
 */
function deriveMarkets(matrix, homeName, awayName) {
  const markets = {};
  Object.values(MARKET_TYPES).forEach((type) => {
    markets[type] = {
      type,
      label: marketLabel(type, homeName, awayName),
      probabilityPct: Number(computeMarketProbability(matrix, type).toFixed(1)),
    };
  });

  return { markets, primaryTendency: pickPrimaryTendency(markets) };
}

/**
 * Calcule un indice de confiance (0 à 100) reflétant honnêtement le volume
 * de données réellement disponibles pour ce match, ainsi que la présence
 * (ou non) d'un contexte stratégique exploité. Ne descend jamais en
 * dessous d'un plancher pour rester utilisable côté produit.
 */
function computeConfidence({ homeSampleSize, awaySampleSize, h2hSampleSize, contextSignalCount = 0 }) {
  const maxFormSample = 10;
  const formCoverage =
    (Math.min(homeSampleSize, maxFormSample) + Math.min(awaySampleSize, maxFormSample)) /
    (2 * maxFormSample);

  const h2hCoverage = Math.min(h2hSampleSize, 6) / 6;

  // Pondération : la forme récente compte plus que le H2H dans la confiance.
  const rawScore = formCoverage * 0.75 + h2hCoverage * 0.25;

  const CONFIDENCE_FLOOR = 40;
  const CONFIDENCE_CEILING = 92;

  let confidence = CONFIDENCE_FLOOR + rawScore * (CONFIDENCE_CEILING - CONFIDENCE_FLOOR);

  // Un contexte stratégique identifié (calendrier chargé, enjeu de
  // classement...) signifie que le modèle explique mieux la situation :
  // léger bonus de confiance, plafonné pour rester honnête.
  confidence += Math.min(contextSignalCount, 3) * 1.5;

  return Math.round(Math.min(confidence, CONFIDENCE_CEILING));
}

/**
 * Point d'entrée principal du moteur : produit une prédiction complète pour
 * un match, quelle que soit la richesse des données disponibles.
 *
 * @param {object} params
 * @param {number|string} params.homeTeamId
 * @param {number|string} params.awayTeamId
 * @param {string} params.homeTeamName
 * @param {string} params.awayTeamName
 * @param {Array} params.homeRecentMatches Matchs terminés récents de l'équipe à domicile
 * @param {Array} params.awayRecentMatches Matchs terminés récents de l'équipe à l'extérieur
 * @param {Array} [params.h2hMatches] Historique des confrontations directes (optionnel)
 * @param {number|string} [params.excludeMatchId] Match à exclure des échantillons de forme
 *   (utilisé lors d'une vérification a posteriori, pour ne jamais prédire un
 *   match à partir de son propre résultat).
 * @param {{homeAttackModifier?: number, awayAttackModifier?: number, notes?: string[]}} [params.context]
 *   Modificateurs contextuels (module 6.3/6.4) calculés par lib/contextEngine.js.
 */
export function generatePrediction({
  homeTeamId,
  awayTeamId,
  homeTeamName = 'Domicile',
  awayTeamName = 'Extérieur',
  homeRecentMatches = [],
  awayRecentMatches = [],
  h2hMatches = [],
  excludeMatchId = null,
  context = null,
}) {
  const homeForm = computeTeamForm(homeRecentMatches, homeTeamId, excludeMatchId);
  const awayForm = computeTeamForm(awayRecentMatches, awayTeamId, excludeMatchId);

  const homeAttack = homeForm.avgScored / LEAGUE_AVERAGE_GOALS;
  const homeDefense = homeForm.avgConceded / LEAGUE_AVERAGE_GOALS;
  const awayAttack = awayForm.avgScored / LEAGUE_AVERAGE_GOALS;
  const awayDefense = awayForm.avgConceded / LEAGUE_AVERAGE_GOALS;

  let lambdaHome = LEAGUE_AVERAGE_GOALS * homeAttack * awayDefense * HOME_ADVANTAGE_FACTOR;
  let lambdaAway = LEAGUE_AVERAGE_GOALS * awayAttack * homeDefense;

  // Si un historique H2H exploitable existe, on l'intègre en pondération
  // douce plutôt que de le laisser dominer (petits échantillons = bruit).
  const h2hStats = computeH2HAverages(h2hMatches, homeTeamId, awayTeamId);
  if (h2hStats) {
    lambdaHome = lambdaHome * (1 - H2H_BLEND_WEIGHT) + h2hStats.avgHomeGoals * H2H_BLEND_WEIGHT;
    lambdaAway = lambdaAway * (1 - H2H_BLEND_WEIGHT) + h2hStats.avgAwayGoals * H2H_BLEND_WEIGHT;
  }

  // Modificateurs contextuels (calendrier chargé / enjeux de classement).
  // Appliqués uniquement à l'attaque : un turn-over ou une gestion se
  // traduit d'abord par moins d'incisivité offensive, pas par une défense
  // différente.
  const contextNotes = context?.notes || [];
  if (context?.homeAttackModifier) lambdaHome *= context.homeAttackModifier;
  if (context?.awayAttackModifier) lambdaAway *= context.awayAttackModifier;

  // Garde-fou : des lambdas trop extrêmes (données aberrantes) sont
  // ramenés dans une plage réaliste plutôt que de faire planter l'UI.
  lambdaHome = Math.min(Math.max(lambdaHome, 0.2), 4.5);
  lambdaAway = Math.min(Math.max(lambdaAway, 0.2), 4.5);

  const matrix = buildScoreMatrix(lambdaHome, lambdaAway);
  const outcome1X2 = derive1X2FromMatrix(matrix);
  const topScores = topExactScores(matrix, 3);
  const { markets, primaryTendency } = deriveMarkets(matrix, homeTeamName, awayTeamName);

  const confidence = computeConfidence({
    homeSampleSize: homeForm.sampleSize,
    awaySampleSize: awayForm.sampleSize,
    h2hSampleSize: h2hStats ? h2hStats.sampleSize : 0,
    contextSignalCount: contextNotes.length,
  });

  return {
    expectedGoals: {
      home: Number(lambdaHome.toFixed(2)),
      away: Number(lambdaAway.toFixed(2)),
    },
    outcome1X2: {
      homeWinPct: Number(outcome1X2.homeWinPct.toFixed(1)),
      drawPct: Number(outcome1X2.drawPct.toFixed(1)),
      awayWinPct: Number(outcome1X2.awayWinPct.toFixed(1)),
    },
    topScores: topScores.map((s) => ({
      score: s.score,
      probabilityPct: Number(s.probabilityPct.toFixed(1)),
    })),
    exactScore: topScores[0]?.score || '0 - 0',
    markets,
    primaryTendency: primaryTendency
      ? {
          type: primaryTendency.type,
          label: primaryTendency.label,
          probabilityPct: primaryTendency.probabilityPct,
        }
      : null,
    confidence,
    contextNotes,
    dataDepth: {
      homeMatchesUsed: homeForm.sampleSize,
      awayMatchesUsed: awayForm.sampleSize,
      h2hMatchesUsed: h2hStats ? h2hStats.sampleSize : 0,
    },
  };
}

/**
 * Prédiction de repli utilisée UNIQUEMENT quand l'appel réseau vers
 * /api/predict échoue entièrement côté client (ex. connexion coupée) —
 * jamais une valeur figée écrite en dur : on appelle le même moteur de
 * Poisson avec des échantillons vides, qui retombe alors sur les moyennes
 * de championnat par défaut et calcule malgré tout une matrice de score,
 * des marchés dérivés et une Tendance principale bien réels. Le score
 * exact et la confiance affichés varient donc naturellement avec les noms
 * d'équipes fournis, au lieu d'un "1 - 1" générique identique partout.
 */
export function getNeutralPrediction(homeTeamName, awayTeamName) {
  return generatePrediction({
    homeTeamId: null,
    awayTeamId: null,
    homeTeamName,
    awayTeamName,
    homeRecentMatches: [],
    awayRecentMatches: [],
    h2hMatches: [],
  });
}
