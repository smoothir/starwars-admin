// Petit site d'admin pour gérer les profils de personnages sans passer par
// Discord. Réutilise directement les modules du bot (Data/...) pour ne jamais
// dupliquer la logique ni risquer que le site et le bot voient des données
// différentes.
require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const crypto = require('crypto');

const {
  listAllProfiles,
  getProfile,
  updateProfileFields,
  STATUTS,
  DEFAULT_STATS,
  STAT_MAX,
} = require('../Data/profileStore.js');
const config = require('../Data/config.js');
const { getFactions, findGradeByRoleId } = require('../Data/factionHelper.js');
const { findAvatar, upsertAvatarImage } = require('../Data/avatarStore.js');
const {
  getCatalog,
  addCatalogItem,
  updateCatalogItem,
  removeCatalogItem,
  listAllInventories,
  addItem,
  removeItem,
  setItemQuantity,
} = require('../Data/invStore.js');
const { recordConnexion, listConnexions, logAction, listLogs } = require('../Data/adminStore.js');

const app = express();
// Limite relevée (défaut Express : 100kb) pour accepter l'upload d'un portrait
// en base64 dans le corps JSON  une photo fait facilement 1-4 Mo encodée.
app.use(express.json({ limit: '10mb' }));

// --- Connexion Discord (OAuth2) : SEUL moyen d'accéder au site, réservé aux
// membres du serveur Discord qui ont le rôle Staff (Data/config.js). ---
const {
  CLIENT_ID: DISCORD_CLIENT_ID,
  CLIENT_SECRET: DISCORD_CLIENT_SECRET,
  DISCORD_REDIRECT_URI,
  GUILD_ID,
  SESSION_SECRET,
} = process.env;
const DISCORD_OAUTH_READY = Boolean(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET && DISCORD_REDIRECT_URI && GUILD_ID);
if (!DISCORD_OAUTH_READY) {
  console.error('❌ CLIENT_ID / CLIENT_SECRET / DISCORD_REDIRECT_URI / GUILD_ID manquant(s) dans le .env : la connexion Discord est le SEUL moyen d\'accéder au site, il ne peut pas démarrer sans ça.');
  process.exit(1);
}
if (!SESSION_SECRET) {
  console.error('❌ SESSION_SECRET manquant dans le .env : nécessaire pour signer les sessions (seul mécanisme d\'authentification restant).');
  process.exit(1);
}
if (!process.env.MONGO_URI) {
  console.error('❌ MONGO_URI manquant dans le .env : nécessaire aussi pour stocker les sessions de façon durable.');
  process.exit(1);
}

// Necessaire sur Render (et tout hebergeur derriere un proxy HTTPS) pour que
// les cookies "secure" fonctionnent correctement.
app.set('trust proxy', 1);

app.use(session({
  name: 'rpadmin.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  // Sessions stockées en base (au lieu de la mémoire du process, par défaut
  // avec express-session) : sinon tout le monde est déconnecté à chaque
  // redémarrage/redéploiement du serveur (fréquent sur Render), avec une
  // page qui reste affichée jusqu'à ce qu'une action échoue en 401.
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI,
    dbName: 'westerosorigin',
    collectionName: 'site_sessions',
    ttl: 7 * 24 * 60 * 60, // 7 jours, en secondes (aligné sur cookie.maxAge)
  }),
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

// Le site (HTML/CSS/JS/logo) reste public : c'est l'ecran de connexion custom
// de la page elle-meme qui gere l'authentification, pas le navigateur. Seules
// les routes /api/* sont protegees, et sans en-tete WWW-Authenticate, pour ne
// jamais declencher la popup native du navigateur par-dessus notre ecran.
app.use(express.static(path.join(__dirname, 'public')));

// Qui est connecte (utilise par le site au chargement pour savoir si une
// session Discord est deja ouverte et sauter l'ecran de connexion). Doit
// rester déclarée AVANT le middleware d'auth ci-dessous : sinon ce dernier
// bloque /api/me lui-même (401 permanent), et plus personne — même avec une
// session Discord parfaitement valide — ne peut jamais passer l'écran de
// connexion, puisque le site ne saurait plus jamais lui dire qu'il est connecté.
app.get('/api/me', (req, res) => {
  if (req.session.user) {
    return res.json({
      authenticated: true,
      via: 'discord',
      ...req.session.user,
      isSuperAdmin: req.session.user.id === config.SUPER_ADMIN_ID,
    });
  }
  res.json({ authenticated: false });
});

// Seule une session Discord valide (rôle Staff vérifié à la connexion) donne accès.
app.use('/api', (req, res, next) => {
  if (req.session.user) return next();
  return res.status(401).json({ error: 'Authentification requise.' });
});

// Petit raccourci pour journaliser une action depuis une route : reprend
// automatiquement l'identité de la personne connectée (req.session.user).
function logFromReq(req, action, details) {
  logAction({ ...req.session.user, action, details }).catch((err) => console.error('logAction échoué :', err.message));
}

// ---------------------------------------------------------------------------
// PANEL ADMIN (créateur uniquement) : qui se connecte, combien de fois, et
// journal de toutes les actions faites sur le site.
// ---------------------------------------------------------------------------
app.use('/api/admin', (req, res, next) => {
  if (req.session.user?.id === config.SUPER_ADMIN_ID) return next();
  return res.status(403).json({ error: 'Réservé au créateur du site.' });
});

app.get('/api/admin/connexions', async (req, res) => {
  try {
    res.json(await listConnexions());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/logs', async (req, res) => {
  try {
    res.json(await listLogs());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// CONNEXION DISCORD (OAuth2)
// ---------------------------------------------------------------------------

app.get('/auth/discord', (req, res) => {
  // Anti-CSRF : valeur aleatoire verifiee au retour, avant d'accepter le "code".
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;

  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', DISCORD_CLIENT_ID);
  url.searchParams.set('redirect_uri', DISCORD_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify guilds.members.read');
  url.searchParams.set('state', state);
  res.redirect(url.toString());
});

app.get('/auth/discord/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state || state !== req.session.oauthState) {
    return res.redirect('/?auth_error=' + encodeURIComponent('Requete invalide ou expiree, reessaie de te connecter.'));
  }
  delete req.session.oauthState;

  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: DISCORD_REDIRECT_URI,
      }),
    });
    if (!tokenRes.ok) throw new Error(`Echange du token refuse par Discord (HTTP ${tokenRes.status}).`);
    const token = await tokenRes.json();

    const meRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (!meRes.ok) throw new Error("Impossible de recuperer l'identite Discord.");
    const me = await meRes.json();

    // Appartenance + roles sur LE serveur du bot : c'est ca qui determine si
    // la personne est staff, pas juste le fait d'avoir un compte Discord.
    const memberRes = await fetch(`https://discord.com/api/users/@me/guilds/${GUILD_ID}/member`, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (memberRes.status === 404) {
      return res.redirect('/?auth_error=' + encodeURIComponent("Tu n'es pas membre du serveur Discord, connexion refusee."));
    }
    if (!memberRes.ok) throw new Error('Impossible de recuperer tes roles sur le serveur.');
    const member = await memberRes.json();

    if (!config.STAFF_ROLE_ID || !member.roles?.includes(config.STAFF_ROLE_ID)) {
      return res.redirect('/?auth_error=' + encodeURIComponent("Tu n'as pas le role Staff requis sur le serveur Discord, connexion refusee."));
    }

    req.session.user = {
      id: me.id,
      username: me.global_name || me.username,
      avatar: me.avatar ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=64` : null,
    };

    // Suivi des connexions + journal, pour le panel Admin (créateur uniquement).
    // Ne doit jamais empêcher la connexion elle-même si Mongo a un souci passager.
    recordConnexion(req.session.user).catch((err) => console.error('recordConnexion échoué :', err.message));
    logAction({ ...req.session.user, action: 'login', details: 'Connexion au site via Discord.' })
      .catch((err) => console.error('logAction (login) échoué :', err.message));

    res.redirect('/');
  } catch (err) {
    console.error('Erreur OAuth Discord :', err);
    res.redirect('/?auth_error=' + encodeURIComponent('Erreur pendant la connexion Discord, reessaie.'));
  }
});

app.post('/auth/logout', (req, res) => {
  if (req.session.user) {
    logAction({ ...req.session.user, action: 'logout', details: 'Déconnexion du site.' })
      .catch((err) => console.error('logAction (logout) échoué :', err.message));
  }
  req.session.destroy(() => res.json({ ok: true }));
});

// ---------------------------------------------------------------------------
// PROFILS
// ---------------------------------------------------------------------------

app.get('/api/profils', async (req, res) => {
  try {
    res.json(await listAllProfiles());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/profils/:id', async (req, res) => {
  try {
    const profile = await getProfile(req.params.id);
    if (!profile) return res.status(404).json({ error: 'Profil inconnu' });

    const fields = {};
    const b = req.body || {};

    // Identité (nom, surnom, âge, faceclaim, rôle/faction) : éditable depuis
    // le site. ⚠️ Ceci ne change QUE ce qui est affiché ici  ça n'attribue
    // ni ne retire le rôle Discord réel du joueur, à faire en plus côté
    // Discord si besoin.
    ['nomPrenom', 'surnom', 'age', 'faceclaim'].forEach((key) => {
      if (b[key] !== undefined) fields[key] = b[key];
    });

    // Rôle/faction : si un roleId connu du catalogue (Data/config.js) est
    // fourni, on en dérive aussi roleName/categoryId/categoryName pour que
    // les trois restent cohérents entre eux plutôt que de laisser un texte
    // libre désynchronisé du vrai catalogue de grades.
    if (b.roleId !== undefined) {
      if (b.roleId === '') {
        fields.roleId = null;
        fields.roleName = null;
        fields.categoryId = null;
        fields.categoryName = null;
      } else {
        const match = findGradeByRoleId(b.roleId);
        if (match) {
          fields.roleId = match.grade.id;
          fields.roleName = match.grade.name;
          fields.categoryId = match.faction.categoryRoleId;
          fields.categoryName = match.faction.label;
        }
      }
    }

    // Champs modifiables de la "fiche" (statut, garde, bourse, notes, renommée)
    ['statut', 'gardePersonnelle', 'boursePersonnelle', 'notes'].forEach((key) => {
      if (b[key] !== undefined) fields[key] = b[key];
    });
    if (b.renommee !== undefined) fields.renommee = Number(b.renommee) || 0;

    // Relations avec les factions (1 à 5) : on ne garde que les clés connues
    // et on fusionne avec les relations existantes plutôt que de tout remplacer.
    if (b.relations && typeof b.relations === 'object') {
      const relations = { ...(profile.relations || {}) };
      for (const f of config.RELATION_FACTIONS) {
        if (b.relations[f.key] !== undefined) {
          relations[f.key] = Math.max(1, Math.min(5, Number(b.relations[f.key]) || 1));
        }
      }
      fields.relations = relations;
    }

    // Stats (0 à STAT_MAX) : même principe, fusion avec l'existant.
    if (b.stats && typeof b.stats === 'object') {
      const stats = { ...(profile.stats || {}) };
      for (const [key, value] of Object.entries(b.stats)) {
        stats[key] = Math.max(0, Math.min(STAT_MAX, Number(value) || 0));
      }
      fields.stats = stats;
    }

    // Nouveau portrait (image encodée en base64, envoyée par le formulaire) :
    // enregistré dans la collection "avatars", associé au faceclaim FINAL
    // (celui qu'on vient de sauvegarder ci-dessus, au cas où il ait aussi été
    // renommé dans la même sauvegarde).
    if (b.portraitDataUrl && typeof b.portraitDataUrl === 'string') {
      const match = b.portraitDataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (!match) {
        return res.status(400).json({ error: 'Image invalide (format attendu : data URL base64).' });
      }
      const [, contentType, base64] = match;
      const faceclaimFinal = fields.faceclaim !== undefined ? fields.faceclaim : profile.faceclaim;
      if (!faceclaimFinal) {
        return res.status(400).json({ error: "Impossible d'enregistrer une image sans faceclaim renseigné." });
      }
      await upsertAvatarImage({
        faceclaim: faceclaimFinal,
        nomPrenom: fields.nomPrenom || profile.nomPrenom,
        userId: profile.userId,
        buffer: Buffer.from(base64, 'base64'),
        contentType,
      });
    }

    const updated = await updateProfileFields(req.params.id, fields);
    logFromReq(req, 'profil_modifie', `A modifié le profil de ${profile.nomPrenom || req.params.id}.`);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/statuts', (req, res) => res.json(STATUTS));

// Données de référence (factions/rôles/relations/stats) pour construire le
// panneau d'édition d'un profil côté site  copiées depuis Data/config.js et
// Data/profileStore.js pour rester exactement alignées avec le bot.
app.get('/api/lists', (req, res) => {
  res.json({
    factions: getFactions(),
    relationFactions: config.RELATION_FACTIONS,
    relationLevels: config.RELATION_LEVELS,
    defaultStats: DEFAULT_STATS,
    statMax: STAT_MAX,
  });
});

// Portrait (faceclaim) d'un personnage, servi à la volée depuis Mongo (avatars
// stockés en base64)  pas chargé dans la liste des profils pour rester léger.
app.get('/api/profils/:id/avatar', async (req, res) => {
  try {
    const profile = await getProfile(req.params.id);
    if (!profile || !profile.faceclaim) return res.status(404).end();

    const avatar = await findAvatar(profile.faceclaim);
    if (!avatar) return res.status(404).end();

    res.set('Content-Type', avatar.contentType || 'image/png');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(Buffer.from(avatar.imageBase64, 'base64'));
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

// ---------------------------------------------------------------------------
// INVENTAIRE catalogue d'objets + inventaires par personnage
// ---------------------------------------------------------------------------

app.get('/api/inventaire/catalogue', async (req, res) => {
  try {
    res.json(await getCatalog());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/inventaire/catalogue', async (req, res) => {
  try {
    const { id, name, emoji, category, description } = req.body || {};
    const created = await addCatalogItem({ id, name, emoji, category, description });
    logFromReq(req, 'objet_cree', `A ajouté l'objet "${name}" au catalogue.`);
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/inventaire/catalogue/:itemId', async (req, res) => {
  try {
    const { name, emoji, category, description } = req.body || {};
    const updated = await updateCatalogItem(req.params.itemId, { name, emoji, category, description });
    logFromReq(req, 'objet_modifie', `A modifié l'objet "${name || req.params.itemId}" du catalogue.`);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/inventaire/catalogue/:itemId', async (req, res) => {
  try {
    const ok = await removeCatalogItem(req.params.itemId);
    if (!ok) return res.status(404).json({ error: 'Objet introuvable.' });
    logFromReq(req, 'objet_supprime', `A supprimé l'objet "${req.params.itemId}" du catalogue.`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Inventaires de TOUS les personnages d'un coup (le site croise ensuite avec
// la liste des profils, déjà chargée, pour afficher les noms).
app.get('/api/inventaire', async (req, res) => {
  try {
    res.json(await listAllInventories());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/inventaire/:profileId/items', async (req, res) => {
  try {
    const { itemId, quantity } = req.body || {};
    const result = await addItem(req.params.profileId, itemId, Number(quantity) || 1);
    if (!result.ok) return res.status(400).json({ error: `Objet inconnu (${itemId}).` });
    logFromReq(req, 'inventaire_ajout', `A ajouté ${Number(quantity) || 1}× "${itemId}" à l'inventaire de ${req.params.profileId}.`);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Fixe directement la quantité d'un objet (plutôt qu'ajouter/retirer un delta).
app.patch('/api/inventaire/:profileId/items/:itemId', async (req, res) => {
  try {
    const { quantity } = req.body || {};
    const result = await setItemQuantity(req.params.profileId, req.params.itemId, Number(quantity));
    if (!result.ok) return res.status(400).json({ error: `Objet inconnu (${req.params.itemId}).` });
    logFromReq(req, 'inventaire_quantite', `A mis la quantité de "${req.params.itemId}" à ${Number(quantity)} pour ${req.params.profileId}.`);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/inventaire/:profileId/items/:itemId', async (req, res) => {
  try {
    const result = await removeItem(req.params.profileId, req.params.itemId, 999999);
    if (!result.ok && result.reason === 'unknown_item') return res.status(400).json({ error: 'Objet inconnu.' });
    logFromReq(req, 'inventaire_retrait', `A retiré "${req.params.itemId}" de l'inventaire de ${req.params.profileId}.`);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || process.env.WEB_PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Site admin lancé sur http://localhost:${PORT}`);
});