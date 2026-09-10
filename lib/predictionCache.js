// lib/predictionCache.js
//
// Mémorisation des prédictions déjà calculées, par identifiant de match.
// Objectif : déterminisme perçu par l'utilisateur — pour un même match, tant
// que le cache n'a pas expiré, DEUX rechargements de page renvoient
// exactement le même objet JSON (même matrice de Poisson, mêmes marchés,
// même Tendance principale, même cote indicative).
//
// Ce n'est PAS une base de données : c'est une Map en mémoire du processus
// Node, vidée à chaque redémarrage/déploiement/cold start. C'est un
// complément, pas un substitut, à la vraie correction de fond (reprise
// automatique sur échec transitoire dans lib/dataSources.js::safeFetchJson) :
// sans cette dernière, un cache figerait aussi bien une BONNE prédiction
// qu'une prédiction dégradée par un échec réseau passager.
//
// Deux espaces de clés distincts et volontairement séparés :
//   - "light:<matchId>"  → prédiction légère (app/api/batch-predict), sans H2H ni contexte
//   - "heavy:<matchId>"  → prédiction complète (app/api/predict), avec H2H + contexte
// Mélanger les deux ferait fuiter une profondeur d'analyse vers l'autre mode.

const store = new Map();

// Une prédiction reste valable jusqu'au coup d'envoi (les stats ne bougent
// plus une fois le match commencé) ou 30 minutes, ce qui arrive en premier —
// suffisamment long pour couvrir une session de test/consultation normale,
// suffisamment court pour absorber un résultat de match voisin qui vient de
// tomber pendant la journée.
const DEFAULT_TTL_MS = 30 * 60 * 1000;

function makeKey(namespace, matchId) {
  return `${namespace}:${matchId}`;
}

/**
 * @param {'light'|'heavy'} namespace
 * @param {number|string} matchId
 * @returns {any | null}
 */
export function getCachedPrediction(namespace, matchId) {
  const key = makeKey(namespace, matchId);
  const hit = store.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  return hit.value;
}

// Un match FINISHED ne peut plus jamais changer : on le mémorise pour une
// durée longue (12h, bien au-delà de la durée de vie habituelle d'un
// process serverless) plutôt que de le recalculer à chaque consultation
// d'une date passée — c'est ce qui garantit que l'audit d'un match déjà
// joué reste stable indéfiniment, pas seulement pendant 30 minutes.
const FINISHED_MATCH_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * @param {'light'|'heavy'} namespace
 * @param {number|string} matchId
 * @param {any} value
 * @param {{ utcDate?: string|null, isFinished?: boolean }} [options]
 *   `utcDate` borne la mémorisation à l'heure de coup d'envoi quand le match
 *   n'a pas encore débuté. `isFinished: true` court-circuite ce calcul avec
 *   une durée longue, puisqu'un match terminé ne peut plus évoluer.
 */
export function setCachedPrediction(namespace, matchId, value, options = {}) {
  const { utcDate = null, isFinished = false } = options;
  const key = makeKey(namespace, matchId);

  if (isFinished) {
    store.set(key, { value, expiresAt: Date.now() + FINISHED_MATCH_TTL_MS });
    return;
  }

  let ttl = DEFAULT_TTL_MS;
  if (utcDate) {
    const kickoff = new Date(utcDate).getTime();
    const msUntilKickoff = kickoff - Date.now();
    if (!Number.isNaN(msUntilKickoff) && msUntilKickoff > 0) {
      ttl = Math.min(DEFAULT_TTL_MS, msUntilKickoff);
    }
  }

  store.set(key, { value, expiresAt: Date.now() + Math.max(ttl, 60 * 1000) });
}
