// lib/dataSources.js
//
// Couche unique d'accès aux données externes.
// Règles non négociables appliquées ici :
//   1. Toute requête fetch vers une API externe utilise { cache: 'no-store' }.
//   2. Aucune erreur n'est avalée en silence : tout échec HTTP ou réseau est
//      journalisé avec console.error (statut, URL, corps de la réponse).
//   3. Aucune donnée factice n'est jamais injectée. En cas d'échec ou
//      d'absence de résultat, on renvoie un tableau/objet vide, jamais un
//      match ou un blason inventé.
//   4. Si aucun match n'existe à la date demandée, la fenêtre de recherche
//      est élargie automatiquement jour après jour, jusqu'à 7 jours,
//      pour que l'interface ne reste jamais vide sans raison.

const FOOTBALL_DATA_BASE_URL = 'https://api.football-data.org/v4';
const MAX_WINDOW_EXPANSION_DAYS = 7;

// Cache mémoire à très courte durée de vie (process Node en cours), réservé
// EXCLUSIVEMENT aux appels d'HISTORIQUE (forme récente d'une équipe,
// classement) — jamais aux matchs/scores du jour, qui restent en
// { cache: 'no-store' } strict comme l'exige la règle anti-cache. Ce n'est
// pas une base de données (rien n'est persisté, tout disparaît au redémarrage
// du process) : c'est une protection contre le quota très serré de
// football-data.org (10 requêtes/minute en plan gratuit), qui, sans elle,
// provoque des échecs HTTP 429 en cascade dès qu'une dizaine d'équipes
// doivent être interrogées pour une même journée — et donc des prédictions
// génériques répétées faute de données, symptôme qu'un cache de quelques
// minutes élimine presque entièrement en pratique.
const HISTORY_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const historyCache = new Map();

function getCachedHistory(key) {
  const hit = historyCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.data;
  if (hit) historyCache.delete(key);
  return null;
}

function setCachedHistory(key, data) {
  historyCache.set(key, { data, expiresAt: Date.now() + HISTORY_CACHE_TTL_MS });
}

/**
 * Effectue un fetch JSON "sûr" : ne lève jamais d'exception non gérée,
 * mais journalise systématiquement les échecs pour qu'ils soient visibles
 * dans les logs Vercel (Functions > Logs).
 *
 * Comporte une petite reprise automatique (2 tentatives supplémentaires,
 * backoff court) UNIQUEMENT sur les échecs transitoires (HTTP 429 — quota
 * football-data.org dépassé — et erreurs réseau). C'est la cause racine la
 * plus fréquente d'une prédiction qui "change" d'un rechargement à l'autre :
 * sans reprise, un appel qui échoue par pur hasard de timing fait retomber
 * silencieusement le moteur sur ses moyennes par défaut, alors qu'un appel
 * qui réussit utilise les vraies données de l'équipe — deux résultats
 * différents pour la même question. Une erreur HTTP non transitoire (4xx
 * hors 429) n'est jamais retentée : elle est journalisée et retournée telle
 * quelle.
 *
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<{ ok: boolean, status: number, data: any | null }>}
 */
export async function safeFetchJson(url, options = {}) {
  const requestOptions = {
    ...options,
    // RÈGLE CRITIQUE : jamais de cache persistant côté Next.js/Vercel pour
    // les données live de matchs et de cotes.
    cache: 'no-store',
    headers: {
      ...(options.headers || {}),
    },
  };

  const RETRY_DELAYS_MS = [350, 900]; // 2 tentatives de reprise, backoff court
  let attempt = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const response = await fetch(url, requestOptions);

      if (!response.ok) {
        const isTransient = response.status === 429 || response.status >= 500;
        if (isTransient && attempt < RETRY_DELAYS_MS.length) {
          console.error(
            `[dataSources] Échec HTTP transitoire ${response.status} sur ${url} — reprise ${attempt + 1}/${RETRY_DELAYS_MS.length}`
          );
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
          attempt += 1;
          continue;
        }
        const errorBody = await response.text().catch(() => '<corps illisible>');
        console.error(
          `[dataSources] Échec HTTP ${response.status} sur ${url} — réponse: ${errorBody}`
        );
        return { ok: false, status: response.status, data: null };
      }

      const data = await response.json();
      return { ok: true, status: response.status, data };
    } catch (error) {
      if (attempt < RETRY_DELAYS_MS.length) {
        console.error(
          `[dataSources] Erreur réseau/parsing sur ${url} — reprise ${attempt + 1}/${RETRY_DELAYS_MS.length} —`,
          error
        );
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
        attempt += 1;
        continue;
      }
      // Erreur réseau, timeout, DNS, JSON invalide, etc. — définitive.
      console.error(`[dataSources] Erreur réseau/parsing définitive sur ${url} —`, error);
      return { ok: false, status: 0, data: null };
    }
  }
}

function getAuthHeaders() {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) {
    // On journalise l'absence de clé mais on ne bloque jamais le rendu :
    // l'appel échouera proprement et sera géré comme un résultat vide.
    console.error(
      '[dataSources] FOOTBALL_DATA_API_KEY est absente des variables d\'environnement.'
    );
  }
  return { 'X-Auth-Token': apiKey || '' };
}

function formatDate(date) {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

/**
 * Récupère les matchs entre deux dates (incluses) via football-data.org v4.
 *
 * @param {string} dateFrom YYYY-MM-DD
 * @param {string} dateTo YYYY-MM-DD
 * @returns {Promise<Array>} Liste brute des matchs (vide si aucune donnée ou erreur)
 */
export async function fetchMatchesRange(dateFrom, dateTo) {
  const url = `${FOOTBALL_DATA_BASE_URL}/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`;
  const { ok, data } = await safeFetchJson(url, { headers: getAuthHeaders() });

  if (!ok || !data || !Array.isArray(data.matches)) {
    return [];
  }

  return data.matches;
}

/**
 * Récupère les matchs pour une date donnée. Si aucun match n'est trouvé
 * (trêve internationale, faible couverture du plan gratuit, etc.), la
 * fenêtre est élargie automatiquement jour par jour jusqu'à
 * MAX_WINDOW_EXPANSION_DAYS, afin que l'UI ne se retrouve jamais vide
 * sans qu'on ait vraiment essayé d'aller chercher des données proches.
 *
 * @param {string} baseDateISO YYYY-MM-DD, date demandée par l'utilisateur
 * @returns {Promise<{ matches: Array, effectiveDateFrom: string, effectiveDateTo: string, expanded: boolean }>}
 */
export async function fetchMatchesWithWindowExpansion(baseDateISO) {
  const baseDate = new Date(`${baseDateISO}T00:00:00.000Z`);

  // 1. Tentative exacte sur la date demandée.
  const exactMatches = await fetchMatchesRange(baseDateISO, baseDateISO);
  if (exactMatches.length > 0) {
    return {
      matches: exactMatches,
      effectiveDateFrom: baseDateISO,
      effectiveDateTo: baseDateISO,
      expanded: false,
    };
  }

  // 2. Élargissement progressif : on interroge une fenêtre de plus en plus
  // large jusqu'à MAX_WINDOW_EXPANSION_DAYS, en une seule requête par palier
  // pour rester économe en appels API (plans gratuits limités).
  const expandedTo = formatDate(addDays(baseDate, MAX_WINDOW_EXPANSION_DAYS));
  const expandedMatches = await fetchMatchesRange(baseDateISO, expandedTo);

  return {
    matches: expandedMatches,
    effectiveDateFrom: baseDateISO,
    effectiveDateTo: expandedTo,
    expanded: expandedMatches.length > 0,
  };
}

/**
 * Récupère les derniers matchs terminés d'une équipe (pour estimer sa forme
 * offensive/défensive). Utilisé à la demande, uniquement quand l'utilisateur
 * ouvre l'analyse détaillée d'un match, pour ménager le quota d'API.
 *
 * @param {number|string} teamId
 * @param {number} limit
 * @returns {Promise<Array>} Liste des matchs terminés (vide si indisponible)
 */
export async function fetchTeamRecentMatches(teamId, limit = 10) {
  const cacheKey = `recent:${teamId}:${limit}`;
  const cached = getCachedHistory(cacheKey);
  if (cached) return cached;

  const url = `${FOOTBALL_DATA_BASE_URL}/teams/${teamId}/matches?status=FINISHED&limit=${limit}`;
  const { ok, data } = await safeFetchJson(url, { headers: getAuthHeaders() });

  if (!ok || !data || !Array.isArray(data.matches)) {
    return [];
  }

  setCachedHistory(cacheKey, data.matches);
  return data.matches;
}

/**
 * Récupère l'historique des confrontations directes (head-to-head) pour un
 * match donné. Cette donnée est un "bonus" pour le moteur statistique :
 * si elle est indisponible, le moteur de scoring doit simplement s'appuyer
 * sur les moyennes de forme récente sans jamais bloquer ni afficher d'erreur.
 *
 * @param {number|string} matchId
 * @param {number} limit
 * @returns {Promise<{ matches: Array, aggregates: object | null }>}
 */
export async function fetchHeadToHead(matchId, limit = 10) {
  const url = `${FOOTBALL_DATA_BASE_URL}/matches/${matchId}/head2head?limit=${limit}`;
  const { ok, data } = await safeFetchJson(url, { headers: getAuthHeaders() });

  if (!ok || !data || !Array.isArray(data.matches)) {
    return { matches: [], aggregates: null };
  }

  return { matches: data.matches, aggregates: data.aggregates || null };
}

/**
 * Récupère les matchs récents d'une équipe en les restreignant à une liste
 * de compétitions précises (ex. uniquement les compétitions européennes).
 * Utilisé pour la segmentation contextuelle domicile/Europe de l'historique
 * (module 6.2) : avant un match de Coupe d'Europe, on privilégie le vécu de
 * l'équipe en Europe plutôt que ses résultats face au bas de tableau du
 * championnat national.
 *
 * @param {number|string} teamId
 * @param {string[]} competitionCodes ex. ['CL', 'EL']
 * @param {number} limit
 * @returns {Promise<Array>}
 */
export async function fetchTeamMatchesInCompetitions(teamId, competitionCodes, limit = 10) {
  if (!competitionCodes || competitionCodes.length === 0) return [];
  const codes = competitionCodes.join(',');
  const cacheKey = `recent-comp:${teamId}:${codes}:${limit}`;
  const cached = getCachedHistory(cacheKey);
  if (cached) return cached;

  const url = `${FOOTBALL_DATA_BASE_URL}/teams/${teamId}/matches?status=FINISHED&competitions=${codes}&limit=${limit}`;
  const { ok, data } = await safeFetchJson(url, { headers: getAuthHeaders() });

  if (!ok || !data || !Array.isArray(data.matches)) {
    return [];
  }

  setCachedHistory(cacheKey, data.matches);
  return data.matches;
}

/**
 * Récupère les prochains matchs programmés d'une équipe dans les
 * `daysAhead` jours suivant `fromDateISO`. Sert à détecter un calendrier
 * chargé (enchaînement championnat → Coupe d'Europe) et un risque de
 * turn-over (module 6.3).
 *
 * @param {number|string} teamId
 * @param {string} fromDateISO YYYY-MM-DD (généralement la date du match analysé)
 * @param {number} daysAhead
 * @returns {Promise<Array>}
 */
export async function fetchTeamUpcomingMatches(teamId, fromDateISO, daysAhead = 7) {
  const fromDate = new Date(`${fromDateISO}T00:00:00.000Z`);
  const dateFrom = formatDate(fromDate);
  const dateTo = formatDate(addDays(fromDate, daysAhead));
  const url = `${FOOTBALL_DATA_BASE_URL}/teams/${teamId}/matches?dateFrom=${dateFrom}&dateTo=${dateTo}&limit=15`;
  const { ok, data } = await safeFetchJson(url, { headers: getAuthHeaders() });

  if (!ok || !data || !Array.isArray(data.matches)) {
    return [];
  }

  return data.matches;
}

/**
 * Récupère le classement (standings) d'une compétition. Utilisé pour
 * l'analyse des enjeux de classement (module 6.4). Renvoie un tableau vide
 * — jamais d'erreur qui bloque l'UI — si la compétition n'a pas de
 * classement exploitable (coupe à élimination directe, hors-saison, plan
 * API ne couvrant pas cette compétition, etc.).
 *
 * @param {number|string} competitionId
 * @returns {Promise<Array>} Table "TOTAL" aplatie : [{ teamId, position, points, playedGames, ... }]
 */
export async function fetchStandings(competitionId) {
  if (!competitionId) return [];
  const cacheKey = `standings:${competitionId}`;
  const cached = getCachedHistory(cacheKey);
  if (cached) return cached;

  const url = `${FOOTBALL_DATA_BASE_URL}/competitions/${competitionId}/standings`;
  const { ok, data } = await safeFetchJson(url, { headers: getAuthHeaders() });

  if (!ok || !data || !Array.isArray(data.standings)) {
    return [];
  }

  // Une compétition peut exposer plusieurs tables (TOTAL, HOME, AWAY, ou une
  // table par groupe en phase de poules). On privilégie la table globale
  // "TOTAL" ; à défaut on agrège toutes les tables disponibles pour ne
  // jamais renvoyer un classement vide alors que des données existent.
  const totalTable = data.standings.find((t) => t.type === 'TOTAL');
  const tables = totalTable ? [totalTable] : data.standings;

  const rows = [];
  tables.forEach((table) => {
    (table.table || []).forEach((row) => {
      rows.push({
        teamId: row.team?.id ?? null,
        teamName: row.team?.name ?? null,
        position: row.position ?? null,
        points: row.points ?? null,
        playedGames: row.playedGames ?? null,
        group: table.group || null,
      });
    });
  });

  setCachedHistory(cacheKey, rows);
  return rows;
}

/**
 * Exécute `fn` sur chaque élément de `items` avec un nombre limité d'appels
 * simultanés. Indispensable pour respecter le quota de football-data.org
 * (10 requêtes/minute sur le plan gratuit) quand on doit prédire une
 * dizaine de matchs — donc récupérer la forme d'une vingtaine d'équipes —
 * en une seule action utilisateur (chargement d'une date, génération d'un
 * combiné...).
 *
 * @param {Array} items
 * @param {number} concurrency
 * @param {(item: any, index: number) => Promise<any>} fn
 * @returns {Promise<Array>}
 */
export async function mapWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const currentIndex = cursor;
      cursor += 1;
      try {
        results[currentIndex] = await fn(items[currentIndex], currentIndex);
      } catch (error) {
        console.error(`[dataSources] Échec non intercepté sur l'élément #${currentIndex} —`, error);
        results[currentIndex] = null;
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
