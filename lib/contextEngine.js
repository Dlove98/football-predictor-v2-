// lib/contextEngine.js
//
// Module d'intelligence contextuelle et stratégique (cahier des charges,
// section 6). Vient s'ajouter au moteur de Poisson pur : il transforme des
// données brutes (calendrier à venir, classement) en modificateurs
// numériques appliqués aux buts attendus, et en notes lisibles affichées
// dans la modale d'analyse.
//
// Philosophie identique au reste du projet : jamais de blocage. Une donnée
// manquante (classement indisponible, calendrier à venir non couvert par le
// plan API...) désactive simplement le modificateur correspondant plutôt
// que de faire échouer la prédiction.

import { getLeagueStrength, isEuropeanCupCompetition } from './leagueStrength';
import {
  fetchTeamMatchesInCompetitions,
  fetchTeamUpcomingMatches,
  fetchStandings,
  mapWithConcurrency,
} from './dataSources';

const MIN_EUROPEAN_SAMPLE = 3; // en dessous, l'historique Europe est jugé trop mince
const LARGE_LEAD_THRESHOLD = 10; // points d'avance à partir desquels on suspecte de la gestion
const ROTATION_MODIFIER = 0.91; // atténuation offensive en cas de calendrier chargé
const COMFORTABLE_LEAD_MODIFIER = 0.93; // atténuation en cas de leader sans enjeu + Europe à venir
const RELEGATION_STAKES_MODIFIER = 1.05; // léger surplus d'intensité en cas de lutte pour le maintien

/**
 * Étape 6.2 — Segmentation contextuelle domicile/Europe.
 * Pour un match de Coupe d'Europe, tente de récupérer l'historique de
 * l'équipe spécifiquement en compétitions européennes. Si l'échantillon est
 * trop mince (compétition découverte, phase de groupes qui débute...), on
 * complète avec l'historique généraliste déjà disponible plutôt que de
 * laisser une prédiction sans données.
 *
 * @returns {Promise<{ matches: Array, europeSegmentUsed: boolean, europeSampleSize: number }>}
 */
export async function resolveContextualHistory({ teamId, isEuropeanFixture, fallbackMatches }) {
  if (!isEuropeanFixture) {
    return { matches: fallbackMatches, europeSegmentUsed: false, europeSampleSize: 0 };
  }

  const europeMatches = await fetchTeamMatchesInCompetitions(
    teamId,
    ['CL', 'EL', 'ECL'],
    10
  );

  if (europeMatches.length >= MIN_EUROPEAN_SAMPLE) {
    // Historique Europe suffisant : on le complète légèrement avec le
    // meilleur du reste si besoin, mais il domine largement l'échantillon.
    return {
      matches: europeMatches,
      europeSegmentUsed: true,
      europeSampleSize: europeMatches.length,
    };
  }

  // Échantillon européen trop mince : on fusionne avec l'historique général
  // pour ne jamais bloquer, tout en gardant trace du peu de données Europe
  // disponibles (utile pour l'indice de confiance).
  return {
    matches: [...europeMatches, ...fallbackMatches],
    europeSegmentUsed: europeMatches.length > 0,
    europeSampleSize: europeMatches.length,
  };
}

/**
 * Étape 6.3 — Calendrier rapproché / turn-over.
 * Regarde si l'équipe a un choc européen dans les `daysAhead` jours qui
 * suivent le match analysé. Si oui, on suppose un risque de rotation
 * d'effectif sur CE match (souvent le match domestique "de gestion" avant
 * l'échéance continentale) et on renvoie un modificateur d'atténuation.
 */
export async function computeFixtureCongestion({ teamId, matchDateISO, currentCompetitionCode }) {
  // Si le match analysé est déjà lui-même la coupe d'Europe, la question de
  // "rotation avant un choc européen" ne s'applique pas à ce match précis.
  if (isEuropeanCupCompetition(currentCompetitionCode)) {
    return { hasCongestion: false, modifier: 1, note: null };
  }

  const upcoming = await fetchTeamUpcomingMatches(teamId, matchDateISO, 7);
  const upcomingEuropeanClash = upcoming.find((m) =>
    isEuropeanCupCompetition(m.competition?.code)
  );

  if (!upcomingEuropeanClash) {
    return { hasCongestion: false, modifier: 1, note: null };
  }

  const daysUntil = Math.max(
    1,
    Math.round((new Date(upcomingEuropeanClash.utcDate) - new Date(`${matchDateISO}T00:00:00Z`)) / 86400000)
  );

  return {
    hasCongestion: true,
    modifier: ROTATION_MODIFIER,
    note: `Choc européen (${upcomingEuropeanClash.competition?.name || 'Coupe d\u2019Europe'}) dans ${daysUntil} j — rotation d'effectif probable sur ce match.`,
  };
}

/**
 * Étape 6.4 — Enjeux de classement.
 * Détermine si une équipe est un leader confortable (gestion probable) ou
 * en lutte pour le maintien (motivation renforcée), et renvoie un
 * modificateur + une note lisible pour la modale d'analyse.
 */
export function computeStakesContext({ standings, teamId, hasUpcomingEuropeanFixture }) {
  if (!standings || standings.length === 0 || !teamId) {
    return { situation: 'inconnu', modifier: 1, note: null };
  }

  const sorted = [...standings].sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
  const teamRow = sorted.find((row) => row.teamId === teamId);
  if (!teamRow || teamRow.position == null) {
    return { situation: 'inconnu', modifier: 1, note: null };
  }

  const totalTeams = sorted.length;
  const second = sorted.find((row) => row.position === 2);
  const relegationZoneStart = totalTeams - 2; // approximation : 3 dernières places

  if (teamRow.position === 1 && second && hasUpcomingEuropeanFixture) {
    const gap = (teamRow.points ?? 0) - (second.points ?? 0);
    if (gap >= LARGE_LEAD_THRESHOLD) {
      return {
        situation: 'leader_confortable',
        modifier: COMFORTABLE_LEAD_MODIFIER,
        note: `Leader avec ${gap} pts d'avance et une échéance européenne cette semaine — gestion d'effectif probable, match plus prudent qu'attendu.`,
      };
    }
  }

  if (teamRow.position >= relegationZoneStart) {
    return {
      situation: 'lutte_maintien',
      modifier: RELEGATION_STAKES_MODIFIER,
      note: `${teamRow.teamName || 'Équipe'} joue gros dans la course au maintien (${teamRow.position}${teamRow.position === 1 ? 'er' : 'e'} sur ${totalTeams}) — intensité généralement renforcée.`,
    };
  }

  return { situation: 'normal', modifier: 1, note: null };
}

/**
 * Orchestrateur : calcule le contexte complet pour les deux équipes d'un
 * match (segmentation Europe, calendrier chargé, enjeux de classement) en
 * limitant le nombre d'appels réseau simultanés. Conçu pour n'être appelé
 * que dans le mode d'analyse détaillée (modale), pas dans le mode léger
 * utilisé pour l'affichage en liste — cf. app/api/predict vs
 * app/api/batch-predict.
 */
export async function computeMatchContext({
  homeTeamId,
  awayTeamId,
  matchDateISO,
  competitionId,
  competitionCode,
}) {
  const isEuropeanFixture = isEuropeanCupCompetition(competitionCode);
  const leagueStrength = getLeagueStrength(competitionCode);

  const [congestionHome, congestionAway, standings] = await Promise.all([
    computeFixtureCongestion({ teamId: homeTeamId, matchDateISO, currentCompetitionCode: competitionCode }),
    computeFixtureCongestion({ teamId: awayTeamId, matchDateISO, currentCompetitionCode: competitionCode }),
    fetchStandings(competitionId),
  ]);

  const stakesHome = computeStakesContext({
    standings,
    teamId: homeTeamId,
    hasUpcomingEuropeanFixture: congestionHome.hasCongestion,
  });
  const stakesAway = computeStakesContext({
    standings,
    teamId: awayTeamId,
    hasUpcomingEuropeanFixture: congestionAway.hasCongestion,
  });

  const notes = [
    congestionHome.note,
    congestionAway.note,
    stakesHome.note,
    stakesAway.note,
  ].filter(Boolean);

  return {
    isEuropeanFixture,
    leagueStrength,
    homeAttackModifier: congestionHome.modifier * stakesHome.modifier,
    awayAttackModifier: congestionAway.modifier * stakesAway.modifier,
    notes,
  };
}

export { mapWithConcurrency };
