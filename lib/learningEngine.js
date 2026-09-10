// lib/learningEngine.js
//
// Auto-calibration de l'IA à partir de ses propres pronostics vérifiés
// ("apprendre de ses erreurs"), sans base de données externe : l'historique
// vit dans le localStorage du navigateur de la personne qui utilise
// l'application.
//
// Ce module NE réentraîne PAS le moteur de Poisson — il mesure, marché par
// marché et tranche de confiance par tranche de confiance, l'écart entre la
// confiance annoncée par le modèle et le taux de réussite réellement
// observé sur cet appareil, puis calcule un petit facteur de correction
// ("shrinkage") appliqué à l'affichage. C'est une calibration honnête et
// transparente, pas une promesse d'apprentissage profond : voir le libellé
// "Auto-calibration locale" utilisé côté UI.
//
// Toutes les fonctions sont no-op sûres côté serveur (SSR) : elles
// vérifient la présence de window/localStorage avant d'agir.

const STORAGE_KEY = 'dtech_predictor_verified_history_v1';
const MAX_HISTORY = 600; // fenêtre glissante, évite une croissance illimitée
const MIN_SAMPLE_FOR_ADJUSTMENT = 8; // en dessous, pas assez d'évidence locale pour corriger le modèle
const CALIBRATION_WEIGHT = 0.3; // poids donné à l'observation locale face au modèle

function isBrowser() {
  return typeof window !== 'undefined' && !!window.localStorage;
}

function readHistory() {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('[learningEngine] Historique local illisible, réinitialisation —', error);
    return [];
  }
}

function writeHistory(history) {
  if (!isBrowser()) return;
  try {
    const trimmed = history.slice(-MAX_HISTORY);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch (error) {
    console.error("[learningEngine] Impossible d'écrire l'historique local —", error);
  }
}

function confidenceBucket(confidencePct) {
  // Tranches de 10 points : 40-49, 50-59, ... 90-99.
  return Math.floor(confidencePct / 10) * 10;
}

/**
 * Enregistre le résultat d'un pronostic une fois le match terminé et
 * vérifié. Idempotent par matchId : rejouer la même date ne compte jamais
 * deux fois le même match, pour que les statistiques restent honnêtes.
 *
 * @param {{ matchId: number|string, type: string, confidencePct: number, wasCorrect: boolean }} entry
 */
export function recordVerifiedPick(entry) {
  if (!isBrowser() || entry?.matchId == null) return;
  const history = readHistory();
  if (history.some((h) => h.matchId === entry.matchId && h.type === entry.type)) return;

  history.push({
    matchId: entry.matchId,
    type: entry.type,
    confidenceBucket: confidenceBucket(entry.confidencePct),
    wasCorrect: !!entry.wasCorrect,
    recordedAt: new Date().toISOString(),
  });

  writeHistory(history);
}

/**
 * Résumé global de la fiabilité observée localement — affiché tel quel
 * dans l'interface ("Fiabilité apprise : XX % sur N pronostics vérifiés").
 */
export function getCalibrationSummary() {
  const history = readHistory();
  if (history.length === 0) {
    return { totalVerified: 0, overallHitRatePct: null };
  }
  const wonCount = history.filter((h) => h.wasCorrect).length;
  return {
    totalVerified: history.length,
    overallHitRatePct: Number(((wonCount / history.length) * 100).toFixed(1)),
  };
}

/**
 * Calcule une confiance "calibrée" en rapprochant la confiance brute du
 * modèle du taux de réussite réellement observé sur des pronostics
 * similaires (même tranche de confiance annoncée). Si l'échantillon local
 * est trop mince, renvoie la confiance brute inchangée : on ne laisse
 * jamais quelques matchs biaiser l'affichage.
 *
 * @param {number} rawConfidencePct
 * @returns {{ calibratedConfidencePct: number, sampleSize: number, adjusted: boolean }}
 */
export function getCalibratedConfidence(rawConfidencePct) {
  const history = readHistory();
  const bucket = confidenceBucket(rawConfidencePct);
  const relevant = history.filter((h) => h.confidenceBucket === bucket);

  if (relevant.length < MIN_SAMPLE_FOR_ADJUSTMENT) {
    return { calibratedConfidencePct: rawConfidencePct, sampleSize: relevant.length, adjusted: false };
  }

  const observedHitRatePct =
    (relevant.filter((h) => h.wasCorrect).length / relevant.length) * 100;

  const calibrated =
    rawConfidencePct * (1 - CALIBRATION_WEIGHT) + observedHitRatePct * CALIBRATION_WEIGHT;

  return {
    calibratedConfidencePct: Math.round(Math.min(Math.max(calibrated, 5), 95)),
    sampleSize: relevant.length,
    adjusted: true,
  };
}

export function clearLearningHistory() {
  if (!isBrowser()) return;
  window.localStorage.removeItem(STORAGE_KEY);
}
