# ⚽ Football Predictor by DTech — V2.0

Plateforme de pronostics de football pilotée par un moteur statistique (loi de Poisson) enrichi d'une **intelligence contextuelle et stratégique** : pondération par niveau de championnat, segmentation domicile/Europe, calendrier chargé, enjeux de classement. Interface sombre inspirée des outils de trading professionnel. Construit avec **Next.js 14 (App Router)** et **Tailwind CSS**.

## ✨ Nouveautés V2.0

- **Regroupement par championnat** : les matchs de la page d'accueil sont organisés par compétition (blason + nom en en-tête), triés du niveau le plus élevé au plus modeste.
- **Score exact + tendance directement sur la carte** : plus besoin d'ouvrir la modale pour voir le score exact estimé et la tendance principale du match.
- **Sélecteur de dates étendu** : de J-2 à J+5, pour consulter aussi bien les matchs à venir que les matchs passés (audit des pronostics).
- **Le Combiné DTech du Jour** : sélection automatique d'au moins 13 matchs (ou le maximum disponible), avec cote cumulée indicative et probabilité combinée.
- **Générateur de coupon personnalisé** : choisissez le(s) type(s) de pronostic (1X2, double chance, BTTS, over/under, combinés), la cote visée, le % de réussite visé et le nombre de matchs.
- **Vérification automatique Gagné/Perdu** : dès qu'un match passe en `FINISHED`, chaque pronostic (carte, combiné, coupon) est comparé au score réel et affiche un badge vert/rouge — sans aucune base de données externe.
- **Auto-calibration locale ("apprendre de ses erreurs")** : l'application mesure, dans le navigateur (localStorage), l'écart entre la confiance annoncée et le taux de réussite réellement observé, et ajuste légèrement l'affichage en conséquence. Voir `lib/learningEngine.js`.
- **Intelligence contextuelle et stratégique** (module 6) :
  - **Pondération par niveau de championnat** (`lib/leagueStrength.js`) : empêche qu'une équipe en forme dans un championnat mineur ne paraisse favorite face à un cador évoluant dans un championnat majeur ou en Coupe d'Europe.
  - **Segmentation domicile/Europe** : pour un match de Coupe d'Europe, l'historique européen de l'équipe est priorisé sur son historique domestique.
  - **Calendrier chargé / turn-over** : détecte un choc européen dans les 4 à 7 jours suivant le match et modère les buts attendus (risque de rotation d'effectif).
  - **Enjeux de classement** : détecte un leader avec large avance (gestion probable) ou une équipe en lutte pour le maintien (intensité renforcée), à partir du classement réel de la compétition.
  - Chaque signal contextuel détecté est expliqué en clair dans la modale d'analyse ("Contexte stratégique").

## 🧠 Stratégie du moteur — pourquoi BTTS (V2.1)

Depuis la V2.1, la Tendance principale (carte + Combiné du Jour) cible en priorité le marché **BTTS — Les deux équipes marquent**, plutôt qu'un combiné "double chance + 1.5 but" trop souvent écrasé au-dessus de 90 % de probabilité. Le BTTS reflète directement la propension offensive **et** défensive des deux équipes (buts marqués/encaissés, pondérés par niveau de championnat), reste rarement extrême dans un sens ou l'autre, et offre donc des cotes indicatives plus intéressantes pour une stratégie de paris ambitieuse. Voir `lib/scoringEngine.js::pickPrimaryTendency`.

Aucune valeur n'est jamais écrite en dur : même le repli utilisé si `/api/predict` échoue complètement côté client fait tourner le vrai moteur de Poisson (`getNeutralPrediction`) plutôt que d'afficher un score générique figé.

## 🔒 Stabilité des pronostics (V2.2)

Le moteur (`generatePrediction`) a toujours été une fonction pure — aucun `Math.random()` nulle part. Le vrai risque d'instabilité venait d'ailleurs : un appel réseau vers football-data.org qui échoue par pur hasard de timing (quota de 10 req/min dépassé) fait retomber silencieusement le calcul sur les moyennes de championnat par défaut, alors qu'un appel qui réussit utilise les vraies statistiques — deux résultats différents pour la même question, à deux rechargements différents. Deux corrections complémentaires :

1. **Reprise automatique** (`lib/dataSources.js::safeFetchJson`) : un échec HTTP 429/5xx ou une erreur réseau est retenté deux fois (backoff court) avant d'abandonner — la cause la plus fréquente de résultats "flous" est traitée à la source.
2. **Mémorisation déterministe par match** (`lib/predictionCache.js`) : une fois une prédiction calculée pour un `matchId` donné, elle est servie identique à l'identique tant qu'elle n'a pas expiré (jusqu'au coup d'envoi, ou 12h pour un match `FINISHED` qui ne peut plus changer). Deux rechargements de page pour le même match renvoient donc exactement le même JSON. Ce n'est pas une base de données : une simple mémoire de process, vidée à chaque redéploiement — la reprise automatique reste la correction de fond.

## 🗓️ Hiérarchie d'affichage Jour → Championnat

`lib/groupMatches.js::groupMatchesByDateThenCompetition` impose une hiérarchie stricte à deux niveaux, quel que soit l'ordre renvoyé par l'API :

- **Niveau 1 — Jour** : les matchs sont d'abord regroupés par date calendaire réelle. Ceci compte surtout quand l'élargissement de fenêtre (`fetchMatchesWithWindowExpansion`, jusqu'à 7 jours si le jour exact est vide) s'est déclenché : les matchs de jours différents ne sont alors jamais mélangés sous un même intitulé — un sous-en-tête de date apparaît pour chaque jour effectivement représenté.
- **Niveau 2 — Championnat** : à l'intérieur de chaque jour, les matchs sont regroupés par compétition (blason + nom), triée du niveau le plus élevé (Ligue des Champions, grands championnats) au plus modeste, puis par ordre alphabétique. Les matchs à l'intérieur d'un même championnat sont eux-mêmes triés par heure de coup d'envoi. Ce tri est recalculé après coup : il est donc systématique même si l'API renvoie ses résultats dans le désordre.

## 🗂️ Structure du projet

```
football-predictor/
├── app/
│   ├── api/
│   │   ├── matches/route.js         # Liste des matchs du jour (élargissement de fenêtre)
│   │   ├── predict/route.js         # Prédiction COMPLÈTE à la demande (H2H + contexte stratégique)
│   │   └── batch-predict/route.js   # Prédiction LÉGÈRE en lot (cartes, combiné, coupon)
│   ├── icon.png                     # Favicon (Next.js App Router)
│   ├── layout.jsx
│   ├── page.jsx                     # Page principale : orchestre tout le reste
│   └── globals.css
├── components/
│   ├── Header.jsx                   # Logo DTech
│   ├── DateSelector.jsx             # J-2 → J+5
│   ├── LearningBadge.jsx            # Fiabilité apprise localement
│   ├── CompetitionGroup.jsx         # En-tête + grille par championnat
│   ├── MatchCard.jsx                # Score exact + tendance + badge Gagné/Perdu
│   ├── PredictionModal.jsx          # Analyse complète (1X2, xG, marchés, contexte stratégique)
│   ├── DailyAccumulator.jsx         # Le Combiné DTech du Jour
│   ├── CouponGenerator.jsx          # Générateur de coupon personnalisé
│   └── CouponResultCard.jsx         # Affichage partagé des sélections + cote cumulée
├── lib/
│   ├── dataSources.js               # Accès API football-data.org : no-store, logs, fenêtre glissante,
│   │                                 # cache court (historique uniquement), concurrence limitée
│   ├── leagueStrength.js            # Coefficients de force par championnat
│   ├── markets.js                   # Référentiel des marchés (1X2, BTTS, O/U, combinés) + vérification
│   ├── scoringEngine.js             # Moteur Poisson pondéré + marchés dérivés + Tendance principale
│   ├── contextEngine.js             # Segmentation Europe, calendrier chargé, enjeux de classement
│   ├── couponEngine.js              # Construction des coupons/combinés (auto et personnalisés)
│   ├── verification.js              # Vérification Gagné/Perdu (match et coupon), sans base de données
│   ├── learningEngine.js            # Auto-calibration locale (localStorage), "apprendre de ses erreurs"
│   ├── predictionCache.js           # Mémorisation déterministe par match (stabilité des rechargements)
│   └── groupMatches.js              # Hiérarchie Jour > Championnat, tri systématique
├── .env.example
├── next.config.js
├── tailwind.config.js
└── package.json
```

## 🚀 Démarrage local

```bash
git clone <url-de-votre-depot-github>
cd football-predictor
npm install
cp .env.example .env.local
# Éditez .env.local et renseignez FOOTBALL_DATA_API_KEY
npm run dev
```

L'application est disponible sur [http://localhost:3000](http://localhost:3000).

## 🔑 Obtenir une clé API football-data.org

1. Créez un compte gratuit sur **https://www.football-data.org/client/register**
2. Récupérez votre clé (`X-Auth-Token`) depuis **https://www.football-data.org/pricing**.
3. Consultez la documentation officielle de l'API v4 ici : **https://docs.football-data.org/general/v4/index.html**

### ⚠️ Limites du plan gratuit — à connaître avant de déployer

Le plan gratuit de football-data.org couvre **12 compétitions** (Premier League, LaLiga, Bundesliga, Serie A, Ligue 1, Ligue des Champions, Eredivisie, Primeira Liga, Championship, Brasileirão, Coupe du Monde, Euro) et limite à **10 requêtes/minute**. Conséquences concrètes pour cette application :

- La Ligue Europa et la Ligue Europa Conférence ne sont **pas** couvertes par le plan gratuit : la logique de segmentation Europe (`isEuropeanCupCompetition`) reste prête pour ces compétitions, mais ne s'activera en pratique que sur des matchs de Ligue des Champions tant que vous êtes sur le plan gratuit.
- `lib/dataSources.js` met en cache (10 minutes, en mémoire process, jamais persisté) les appels d'**historique** (forme récente d'une équipe, classement) pour limiter le risque de dépasser le quota lors du chargement d'une journée chargée — les matchs et scores du jour, eux, restent systématiquement `no-store`.
- Sur un très gros calendrier (nombreuses compétitions le même jour), certaines équipes peuvent malgré tout ne pas être récupérées à temps : le moteur ne bloque jamais dans ce cas, il retombe sur la moyenne de championnat par défaut et réduit son indice de confiance en conséquence.

## ☁️ Déploiement sur Vercel (via GitHub)

1. **Poussez le code sur GitHub**
   ```bash
   git init
   git add .
   git commit -m "Football Predictor by DTech — V2.0"
   git branch -M main
   git remote add origin https://github.com/<votre-utilisateur>/<votre-depot>.git
   git push -u origin main
   ```

2. **Importez le dépôt sur Vercel**
   - Rendez-vous sur **https://vercel.com/new**
   - Sélectionnez votre dépôt GitHub — Vercel détecte automatiquement Next.js.

3. **Configurez la variable d'environnement**
   - Dans **Project Settings → Environment Variables** (doc : **https://vercel.com/docs/projects/environment-variables**)
   - Ajoutez `FOOTBALL_DATA_API_KEY` pour les environnements Production, Preview et Development.

4. **Déployez** — chaque `git push` sur `main` déclenche un nouveau déploiement.

### Éviter les erreurs de mise à jour / cache

- Ne réintroduisez jamais de `fetch` sans `{ cache: 'no-store' }` pour les endpoints de matchs/scores du jour dans `lib/dataSources.js`.
- Les trois routes API exportent `export const dynamic = 'force-dynamic'` — ne retirez pas cette ligne.
- Toute nouvelle source de données doit journaliser ses échecs avec `console.error`, jamais en silence.

## 📚 Ressources utiles

- Documentation API football-data.org v4 : **https://docs.football-data.org/general/v4/index.html**
- Inscription / gestion de clé API : **https://www.football-data.org/client/register**
- Documentation Next.js App Router : **https://nextjs.org/docs/app**
- Documentation Tailwind CSS : **https://tailwindcss.com/docs/installation**
- Déploiement Next.js sur Vercel : **https://vercel.com/docs/frameworks/nextjs**
- Loi de Poisson appliquée aux pronostics sportifs (référence méthodologique) : **https://en.wikipedia.org/wiki/Poisson_distribution**

## ⚠️ Avertissement

Les "cotes" affichées dans le Combiné du Jour et le générateur de coupon sont des **cotes décimales équitables** dérivées directement des probabilités du modèle (1 / probabilité) — l'application ne consomme aucune cote de marché réelle et n'est reliée à aucun opérateur de paris. Ce projet est fourni à des fins d'information et d'analyse statistique sportive uniquement ; aucune garantie n'est donnée quant à l'exactitude des pronostics, et les probabilités combinées supposent une indépendance raisonnable entre matchs distincts.

## 📄 Licence

Projet fourni tel quel, à des fins d'information sportive. Aucune garantie n'est donnée quant à l'exactitude des pronostics.
