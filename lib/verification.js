// lib/verification.js
//
// Système de vérification automatique (cahier des charges, module 4). Dès
// qu'un match passe au statut FINISHED, compare le score réel à la
// Tendance principale prédite pour afficher un badge "Gagné"/"Perdu",
// entièrement calculé à la volée à partir du score renvoyé par l'API —
// sans aucune base de données externe.
//
// Utilise evaluateMarket (lib/markets.js), la MÊME fonction qui a servi à
// calculer la probabilité avant-match, pour garantir que la vérification
// est rigoureusement cohérente avec ce qui a été annoncé.

import { evaluateMarket } from './markets';

/**
 * @param {{type: string, label: string}} predictedTendency
 * @param {{home: number, away: number}} realScore
 * @returns {{ status: 'won'|'lost'|'unknown', label: string }}
 */
export function verifyTendency(predictedTendency, realScore) {
  if (!predictedTendency || !realScore || realScore.home == null || realScore.away == null) {
    return { status: 'unknown', label: 'Non vérifiable' };
  }

  const hit = evaluateMarket(predictedTendency.type, realScore.home, realScore.away);
  return {
    status: hit ? 'won' : 'lost',
    label: hit ? 'Pronostic validé' : 'Pronostic manqué',
  };
}

/**
 * Vérifie un coupon entier (Combiné DTech du Jour ou coupon personnalisé) :
 * chaque sélection est jugée individuellement, et le coupon global n'est
 * gagnant que si TOUTES les sélections le sont (fonctionnement standard
 * d'un pari combiné).
 *
 * @param {Array} selections Sélections du coupon (voir lib/couponEngine.js)
 * @returns {{ perLeg: Array, overallStatus: 'won'|'lost'|'pending'|'partial', wonCount: number, verifiableCount: number }}
 */
export function verifyCoupon(selections) {
  const perLeg = selections.map((leg) => {
    const isFinished = leg.status === 'FINISHED';
    const result = isFinished
      ? verifyTendency({ type: leg.type, label: leg.label }, leg.realScore)
      : { status: 'pending', label: 'À venir' };
    return { ...leg, verification: result };
  });

  const verifiable = perLeg.filter((leg) => leg.verification.status !== 'pending');
  const wonCount = perLeg.filter((leg) => leg.verification.status === 'won').length;
  const lostCount = perLeg.filter((leg) => leg.verification.status === 'lost').length;

  let overallStatus = 'pending';
  if (verifiable.length === 0) {
    overallStatus = 'pending';
  } else if (lostCount > 0) {
    overallStatus = 'lost'; // un seul échec suffit à faire tomber un combiné classique
  } else if (verifiable.length === perLeg.length) {
    overallStatus = 'won';
  } else {
    overallStatus = 'partial'; // certaines sélections déjà gagnantes, d'autres pas encore jouées
  }

  return {
    perLeg,
    overallStatus,
    wonCount,
    lostCount,
    verifiableCount: verifiable.length,
    totalCount: perLeg.length,
  };
}
