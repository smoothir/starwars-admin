# RP Origin - Site admin (déploiement séparé)

Ce dépôt est une version **autonome** du site d'admin (profils de
personnages) : il ne contient que ce qui est nécessaire pour le faire
tourner tout seul, séparément du bot Discord. Il se connecte à la **même
base MongoDB** que le bot, donc toute modification faite ici est
immédiatement visible sur Discord et inversement sans rien dupliquer.

## Où l'héberger

C'est une petite appli Node.js/Express classique (un process qui tourne en
continu, pas des fonctions serverless). Ça correspond exactement à ce que
font **Railway** et **Render**  c'est la voie la plus simple.

**Vercel** est fait pour du serverless (fonctions qui démarrent à chaque
requête) ; ça marche aussi mais demande d'adapter `web/server.js` en
route API (`/api/...`) plutôt qu'un serveur Express classique qui `listen()`.
Si tu tiens à Vercel, dis-le-moi et j'adapte le code sinon Railway/Render
fonctionnent avec ce dépôt tel quel, sans rien changer.

## Déployer sur Railway (recommandé)

1. Pousse ce dossier sur un repo GitHub (public ou privé, peu importe grâce
   au `.gitignore` qui protège déjà `.env`).
2. Sur [railway.app](https://railway.app) → **New Project** → **Deploy from
   GitHub repo** → sélectionne ce repo.
3. Railway détecte automatiquement Node.js et lance `npm install` puis
   `npm start`.
4. Dans l'onglet **Variables** du service, ajoute :
   - `MONGO_URI` → la même valeur que dans le `.env` du bot
   - `CLIENT_ID`, `CLIENT_SECRET`, `GUILD_ID` → ceux de l'application Discord du bot
   - `DISCORD_REDIRECT_URI` → `https://<ton-site>/auth/discord/callback`
     (à déclarer aussi dans le portail développeur Discord → OAuth2 → Redirects)
   - `SESSION_SECRET` → une longue valeur aléatoire (ex. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
   (pas besoin d'ajouter `PORT`, Railway le fournit automatiquement)
5. Railway te donne une URL publique (`https://....up.railway.app`) c'est
   ton site : la connexion se fait uniquement via Discord (rôle Staff requis).

## Déployer sur Render

Même principe : **New** → **Web Service** → connecte le repo GitHub.
- Build command : `npm install`
- Start command : `npm start`
- Ajoute les mêmes variables d'environnement que ci-dessus dans l'onglet
  **Environment**.

## Tester en local avant de déployer

```bash
npm install
cp .env.example .env
# remplis .env avec tes vraies valeurs
npm start
```

Puis ouvre `http://localhost:3000`.

## Structure de ce dépôt

```
Data/               → les mêmes fichiers que le bot (config factions/rôles,
                       accès MongoDB) copiés depuis le projet du bot.
web/server.js        → l'API + sert la page
web/public/index.html → l'interface (une seule page, pas de framework)
```

Si tu modifies un jour la config des factions/rôles côté bot
(`Data/config.js`), pense à recopier ce même fichier ici pour que le site
reste synchro (c'est un fichier statique, pas de la donnée en base donc
il ne se met pas à jour tout seul entre les deux dépôts).

## Sécurité

- Toutes les infos sensibles (`MONGO_URI`, `CLIENT_SECRET`, `SESSION_SECRET`)
  vivent uniquement dans les variables d'environnement de l'hébergeur
  jamais dans le code, jamais commitées.
- Le repo GitHub peut être public sans risque tant que `.env` n'y est jamais
  poussé (le `.gitignore` fourni s'en charge).
- Railway/Render fournissent du HTTPS automatiquement, donc les cookies de
  session ne circulent jamais en clair.
- Ne mets jamais de vraie valeur dans `.env.example` (il est versionné).
