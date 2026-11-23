# Application web — portail Joueur et Staff

`server.js` sert l'application et ses API. Le portail joueur est l'espace par défaut ; le panel Staff historique reste disponible via le bouton Espace Staff, affiché uniquement lorsque le serveur reconnaît un rôle Staff/Admin.

## Espace joueur

- `public/player-portal.js` et `public/player-portal.css` : tableau de bord, personnages, planètes, secteurs, missions, primes et boutique.
- Les API joueur sont préfixées par `/api/player`. Elles sont réservées aux rôles whitelist `1545274332614230084`, membre `1545274332614230082` et Staff/Admin.
- Les personnages et missions sont vérifiés côté serveur à partir du compte Discord connecté.
- Les destinations connues ouvrent directement leurs salons Discord ; l'Espace du Noyau et le Forum général attendent des identifiants de destination.

## Espace Staff

Le panel historique est conservé dans `public/app.js`. Les API de gestion restent sous le middleware Staff de `/api` ; elles ne sont pas rendues accessibles aux membres ordinaires par l'ajout du portail joueur.

Voir le README à la racine pour la configuration OAuth2, les variables d'environnement et le déploiement.
