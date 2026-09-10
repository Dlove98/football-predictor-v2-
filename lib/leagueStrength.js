// lib/leagueStrength.js
//
// Table de pondération par niveau de championnat ("League Strength
// Factor"). Sert à empêcher qu'une équipe en forme dans un championnat
// mineur se voie attribuer des buts attendus irréalistes face à un cador
// évoluant dans un championnat majeur ou en Coupe d'Europe.
//
// Le coefficient n'a d'effet réel que lorsqu'il DIFFÈRE entre les deux
// équipes d'un match (typiquement : une confrontation européenne entre deux
// clubs de championnats de niveaux différents). Pour deux équipes du même
// championnat, le coefficient s'annule mathématiquement dans le moteur de
// scoring (voir lib/scoringEngine.js) — il ne fausse donc jamais un match
// "classique" intra-championnat.
//
// Les codes ci-dessous suivent la nomenclature football-data.org v4
// (`competition.code`). Le plan gratuit ne couvre que 12 compétitions
// (PL, PD, BL1, SA, FL1, CL, DED, PPL, ELC, BSA, WC, EC) : les autres codes
// sont fournis par anticipation pour un compte payant plus large, sans
// aucun effet néfaste s'ils ne sont jamais rencontrés.

const LEAGUE_STRENGTH_TABLE = {
  // --- Élite européenne interclubs ---
  CL: { coefficient: 1.1, tier: 'Ligue des Champions' },
  UCL: { coefficient: 1.1, tier: 'Ligue des Champions' },
  EL: { coefficient: 1.02, tier: 'Ligue Europa' },
  UEL: { coefficient: 1.02, tier: 'Ligue Europa' },
  ECL: { coefficient: 0.97, tier: 'Ligue Europa Conférence' },
  UECL: { coefficient: 0.97, tier: 'Ligue Europa Conférence' },
  CLI: { coefficient: 1.0, tier: 'Copa Libertadores' },

  // --- Grands championnats domestiques (top 5 européen) ---
  PL: { coefficient: 1.1, tier: 'Championnat majeur' }, // Premier League
  PD: { coefficient: 1.05, tier: 'Championnat majeur' }, // LaLiga
  BL1: { coefficient: 1.03, tier: 'Championnat majeur' }, // Bundesliga
  SA: { coefficient: 1.03, tier: 'Championnat majeur' }, // Serie A
  FL1: { coefficient: 0.98, tier: 'Championnat majeur' }, // Ligue 1

  // --- Championnats solides, un cran en dessous ---
  DED: { coefficient: 0.9, tier: 'Championnat intermédiaire' }, // Eredivisie
  PPL: { coefficient: 0.89, tier: 'Championnat intermédiaire' }, // Primeira Liga
  BSA: { coefficient: 0.88, tier: 'Championnat intermédiaire' }, // Brasileirão

  // --- Deuxièmes divisions / championnats mineurs couverts ---
  ELC: { coefficient: 0.82, tier: 'Championnat mineur' }, // Championship (D2 Angleterre)

  // --- Compétitions internationales de sélections ---
  WC: { coefficient: 1.08, tier: 'Sélections — Coupe du Monde' },
  EC: { coefficient: 1.05, tier: 'Sélections — Euro' },
};

// Coefficient appliqué à toute compétition non répertoriée ci-dessus : un
// léger malus de prudence plutôt qu'une confiance par défaut, car en
// pratique un code inconnu signale souvent un championnat plus modeste que
// les 12 compétitions couvertes par le plan gratuit.
const DEFAULT_STRENGTH = { coefficient: 0.82, tier: 'Championnat non classé' };

// Compétitions considérées comme des coupes d'Europe interclubs, pour la
// segmentation domicile/Europe de l'historique (voir lib/contextEngine.js).
const EUROPEAN_CUP_CODES = new Set(['CL', 'UCL', 'EL', 'UEL', 'ECL', 'UECL']);

export function getLeagueStrength(competitionCode) {
  if (!competitionCode) return DEFAULT_STRENGTH;
  return LEAGUE_STRENGTH_TABLE[competitionCode] || DEFAULT_STRENGTH;
}

export function isEuropeanCupCompetition(competitionCode) {
  return EUROPEAN_CUP_CODES.has(competitionCode);
}

export function europeanCupCodes() {
  return Array.from(EUROPEAN_CUP_CODES);
}
