# Site admin — Westeros Origin

Petit site pour gérer les maisons, régions et profils sans passer par Discord.
Il réutilise directement les mêmes fichiers que le bot (`Data/maisons.js`,
`Data/regions.js`, `Data/mongo.js`, etc.), donc **les deux voient toujours
exactement les mêmes données** — pas de risque de désynchronisation.

## Installation

Depuis la racine du projet (`BOTGOAT/`), pas besoin d'un `npm install` séparé :

```bash
npm install
```

Ajoute ensuite ces 3 lignes dans ton `.env` existant à la racine (voir
`web/.env.example`) :

```
ADMIN_USER=admin
ADMIN_PASSWORD=choisis-un-mot-de-passe-fort
WEB_PORT=3000
```

## Lancer le site

```bash
npm run web
```

Puis ouvre `http://localhost:3000` (ou l'IP/port de ton serveur si hébergé
ailleurs). Le navigateur demandera l'identifiant/mot de passe définis dans
`.env` (authentification HTTP Basic — pas de compte à créer).

Le site tourne en **plus** du bot, indépendamment (deux process séparés :
`npm start` pour le bot, `npm run web` pour le site). Sur Katabump, ça veut
dire soit un 2ᵉ service, soit lancer les deux dans le même process via un
petit script si ton hébergeur ne permet qu'un seul process — dis-le moi si
c'est le cas, je peux adapter.

## Ce que ça permet

- **Maisons** : voir/modifier la renommée, l'argent, le chef de maison
  (override), et ajouter des entrées à l'historique. L'armée reste en
  lecture seule (elle vient du fichier `Data/json/maisons.json`, comme sur
  Discord).
- **Régions** : pareil, avec statut politique et instabilité.
- **Profils** : voir/modifier statut, garde personnelle, bourse, alliés,
  rivaux, renommée, notes — la liste vient de MongoDB (collection
  `profils`), exactement les mêmes personnages que ceux gérés via
  `/staffedit` sur Discord.
- **🔄 Synchroniser** : s'assure que chaque maison/région du fichier JSON a
  bien un document d'état en base MongoDB. Ne touche jamais aux données déjà
  existantes — utile uniquement si tu ajoutes une nouvelle maison/région
  dans le JSON et que personne n'a encore interagi avec elle.

## Sécurité

- Les identifiants ne sont **jamais** dans le code — uniquement dans `.env`
  (donc jamais poussés sur GitHub si `.gitignore` est en place).
- Le site utilise une authentification HTTP Basic simple. C'est suffisant
  pour un usage staff restreint, mais évite de partager le lien largement :
  il n'y a qu'un seul compte partagé, pas de rôles/permissions par personne.
- Si tu déploies ce site sur un serveur public (pas juste en local), utilise
  HTTPS (la plupart des hébergeurs comme Railway/Render le font
  automatiquement) — sinon le mot de passe circule en clair.
