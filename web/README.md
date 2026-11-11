# Site admin  dossier `web/`

Ce dossier contient l'application Express (`server.js` + `public/`) : c'est
elle qui sert l'interface et l'API. Voir le `README.md` à la racine du dépôt
pour l'installation et le déploiement (Railway/Render).

## Ce que ça permet

- **Profils** : voir/modifier statut, garde personnelle, bourse, renommée,
  notes, relations avec les factions et stats la liste vient de MongoDB
  (collection `profils`), exactement les mêmes personnages que ceux gérés
  via `/staffedit` ou `/inventaire` sur Discord.
- L'identité d'un personnage (nom, surnom, âge, faceclaim, rôle, faction)
  est affichée en lecture seule : elle vient de la fiche validée côté
  Discord et ne doit être changée que par ce biais, pour ne jamais désync
  du rôle Discord réellement attribué.

Pas encore de maisons/régions : le bot actuel ne gère que les profils. Si un
jour un système de factions territoriales est ajouté côté bot, ce site
pourra être étendu pour le gérer aussi.

## Sécurité

- Les secrets (`CLIENT_SECRET`, `SESSION_SECRET`, `MONGO_URI`) ne sont **jamais**
  dans le code  uniquement dans `.env` (donc jamais poussés sur GitHub si le
  `.gitignore` est en place).
- Authentification par Discord OAuth2 : seuls les membres ayant le rôle Staff
  du serveur peuvent se connecter ; le panel Admin est réservé au créateur.
- En production, utilise HTTPS (Railway/Render le font automatiquement) :
  le cookie de session n'est marqué « secure » que sur une connexion HTTPS.
