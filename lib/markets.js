// lib/markets.js
//
// Référentiel unique des "marchés" de pronostic (1X2, double chance, BTTS,
// over/under, combinés...).
//
// Principe central : UNE SEULE fonction — evaluateMarket(type, homeGoals,
// awayGoals) — sert à la fois :
//   1. au moteur de scoring, qui somme la matrice de Poisson sur toutes les
//      cases de score où evaluateMarket est vraie, pour obtenir une
//      probabilité avant-match ;
//   2. au module de vérification, qui applique la même fonction au score
//      RÉEL une fois le match terminé, pour savoir si le pronostic est
//      gagné ou perdu.
// Ainsi la définition d'un marché ne peut jamais diverger entre ce qui est
// prédit et ce qui est vérifié.

export const MARKET_TYPES = {
  HOME_WIN: '1',
  DRAW: 'X',
  AWAY_WIN: '2',
  DOUBLE_CHANCE_1X: '1X',
  DOUBLE_CHANCE_X2: 'X2',
  DOUBLE_CHANCE_12: '12',
  BTTS_YES: 'BTTS_YES',
  BTTS_NO: 'BTTS_NO',
  OVER_1_5: 'OVER_1_5',
  UNDER_1_5: 'UNDER_1_5',
  OVER_2_5: 'OVER_2_5',
  UNDER_2_5: 'UNDER_2_5',
  OVER_3_5: 'OVER_3_5',
  HOME_OVER_1_5: 'HOME_OVER_1_5',
  AWAY_OVER_1_5: 'AWAY_OVER_1_5',
  DC1X_OVER_1_5: 'DC1X_OVER_1_5',
  DCX2_OVER_1_5: 'DCX2_OVER_1_5',
  DC1X_UNDER_2_5: 'DC1X_UNDER_2_5',
  DCX2_UNDER_2_5: 'DCX2_UNDER_2_5',
};

/**
 * Vrai si le score (homeGoals, awayGoals) satisfait le marché `type`.
 * Utilisée à la fois en pré-match (sur chaque case de la matrice de
 * Poisson, pour intégrer une probabilité) et en post-match (sur le score
 * réel unique, pour vérifier un pronostic).
 */
export function evaluateMarket(type, homeGoals, awayGoals) {
  const total = homeGoals + awayGoals;
  switch (type) {
    case MARKET_TYPES.HOME_WIN:
      return homeGoals > awayGoals;
    case MARKET_TYPES.DRAW:
      return homeGoals === awayGoals;
    case MARKET_TYPES.AWAY_WIN:
      return homeGoals < awayGoals;
    case MARKET_TYPES.DOUBLE_CHANCE_1X:
      return homeGoals >= awayGoals;
    case MARKET_TYPES.DOUBLE_CHANCE_X2:
      return awayGoals >= homeGoals;
    case MARKET_TYPES.DOUBLE_CHANCE_12:
      return homeGoals !== awayGoals;
    case MARKET_TYPES.BTTS_YES:
      return homeGoals >= 1 && awayGoals >= 1;
    case MARKET_TYPES.BTTS_NO:
      return homeGoals === 0 || awayGoals === 0;
    case MARKET_TYPES.OVER_1_5:
      return total >= 2;
    case MARKET_TYPES.UNDER_1_5:
      return total <= 1;
    case MARKET_TYPES.OVER_2_5:
      return total >= 3;
    case MARKET_TYPES.UNDER_2_5:
      return total <= 2;
    case MARKET_TYPES.OVER_3_5:
      return total >= 4;
    case MARKET_TYPES.HOME_OVER_1_5:
      return homeGoals > awayGoals && total >= 2;
    case MARKET_TYPES.AWAY_OVER_1_5:
      return awayGoals > homeGoals && total >= 2;
    case MARKET_TYPES.DC1X_OVER_1_5:
      return homeGoals >= awayGoals && total >= 2;
    case MARKET_TYPES.DCX2_OVER_1_5:
      return awayGoals >= homeGoals && total >= 2;
    case MARKET_TYPES.DC1X_UNDER_2_5:
      return homeGoals >= awayGoals && total <= 2;
    case MARKET_TYPES.DCX2_UNDER_2_5:
      return awayGoals >= homeGoals && total <= 2;
    default:
      return false;
  }
}

/**
 * Libellé humain (FR) d'un marché, avec les noms d'équipes injectés quand
 * nécessaire.
 */
export function marketLabel(type, homeName, awayName) {
  switch (type) {
    case MARKET_TYPES.HOME_WIN:
      return `Victoire ${homeName}`;
    case MARKET_TYPES.DRAW:
      return 'Match nul';
    case MARKET_TYPES.AWAY_WIN:
      return `Victoire ${awayName}`;
    case MARKET_TYPES.DOUBLE_CHANCE_1X:
      return `${homeName} ou nul (1X)`;
    case MARKET_TYPES.DOUBLE_CHANCE_X2:
      return `Nul ou ${awayName} (X2)`;
    case MARKET_TYPES.DOUBLE_CHANCE_12:
      return 'Pas de nul (12)';
    case MARKET_TYPES.BTTS_YES:
      return 'Les deux équipes marquent';
    case MARKET_TYPES.BTTS_NO:
      return "Au moins une équipe ne marque pas";
    case MARKET_TYPES.OVER_1_5:
      return 'Plus de 1.5 but';
    case MARKET_TYPES.UNDER_1_5:
      return 'Moins de 1.5 but';
    case MARKET_TYPES.OVER_2_5:
      return 'Plus de 2.5 buts';
    case MARKET_TYPES.UNDER_2_5:
      return 'Moins de 2.5 buts';
    case MARKET_TYPES.OVER_3_5:
      return 'Plus de 3.5 buts';
    case MARKET_TYPES.HOME_OVER_1_5:
      return `Victoire ${homeName} + Plus de 1.5 but`;
    case MARKET_TYPES.AWAY_OVER_1_5:
      return `Victoire ${awayName} + Plus de 1.5 but`;
    case MARKET_TYPES.DC1X_OVER_1_5:
      return `${homeName} ou nul + Plus de 1.5 but`;
    case MARKET_TYPES.DCX2_OVER_1_5:
      return `Nul ou ${awayName} + Plus de 1.5 but`;
    case MARKET_TYPES.DC1X_UNDER_2_5:
      return `${homeName} ou nul + Moins de 2.5 buts`;
    case MARKET_TYPES.DCX2_UNDER_2_5:
      return `Nul ou ${awayName} + Moins de 2.5 buts`;
    default:
      return type;
  }
}

// Regroupements utilisés par le générateur de coupon : l'utilisateur choisit
// une ou plusieurs familles, et pour chaque match on retient le meilleur
// sous-marché de la famille (ex. "1X2" retient le sens — dom./nul/ext. — le
// plus probable pour CE match précis, pas un sens fixe pour tous les matchs).
export const MARKET_GROUPS = {
  ONE_X_TWO: {
    label: '1X2 (résultat sec)',
    types: [MARKET_TYPES.HOME_WIN, MARKET_TYPES.DRAW, MARKET_TYPES.AWAY_WIN],
  },
  DOUBLE_CHANCE: {
    label: 'Double chance',
    types: [
      MARKET_TYPES.DOUBLE_CHANCE_1X,
      MARKET_TYPES.DOUBLE_CHANCE_X2,
      MARKET_TYPES.DOUBLE_CHANCE_12,
    ],
  },
  BTTS: {
    label: 'Les deux équipes marquent (BTTS)',
    types: [MARKET_TYPES.BTTS_YES, MARKET_TYPES.BTTS_NO],
  },
  OVER_UNDER_1_5: {
    label: 'Total de buts : ligne 1.5',
    types: [MARKET_TYPES.OVER_1_5, MARKET_TYPES.UNDER_1_5],
  },
  OVER_UNDER_2_5: {
    label: 'Total de buts : ligne 2.5',
    types: [MARKET_TYPES.OVER_2_5, MARKET_TYPES.UNDER_2_5],
  },
  COMBO_DOUBLE_CHANCE_BUTS: {
    label: 'Combiné double chance + buts (ex. 1X + 1.5)',
    types: [
      MARKET_TYPES.DC1X_OVER_1_5,
      MARKET_TYPES.DCX2_OVER_1_5,
      MARKET_TYPES.DC1X_UNDER_2_5,
      MARKET_TYPES.DCX2_UNDER_2_5,
    ],
  },
};

// Priorité de sélection pour la Tendance principale affichée sur chaque
// carte de match et pour "Le Combiné DTech du Jour".
//
// V2.1 — pivot stratégique : le marché "Les deux équipes marquent" (BTTS /
// GG) est désormais la lecture PRIORITAIRE de l'IA. C'est un marché
// intrinsèquement plus tranché (rarement écrasé à 90 %+ comme peut l'être
// une double chance + 1.5 but "conservatrice"), donc plus cohérent avec une
// stratégie de paris ambitieuse à cotes plus généreuses. Les lignes de
// buts (2.5) ne servent plus que de repli. Voir
// lib/scoringEngine.js::pickPrimaryTendency pour la règle de sélection
// exacte (BTTS toujours prioritaire, jamais un simple tri par probabilité
// qui le noierait derrière des combos "évidents").
export const PRIMARY_TENDENCY_CANDIDATES = [
  MARKET_TYPES.BTTS_YES,
  MARKET_TYPES.BTTS_NO,
  MARKET_TYPES.OVER_2_5,
  MARKET_TYPES.UNDER_2_5,
];
