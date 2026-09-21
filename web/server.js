// Petit site d'admin pour gérer les profils de personnages sans passer par
// Discord. Réutilise directement les modules du bot (Data/...) pour ne jamais
// dupliquer la logique ni risquer que le site et le bot voient des données
// différentes.
require('dotenv').config();
const path = require('path');
const express = require('express');

const {
  listAllProfiles,
  getProfile,
  updateProfileFields,
  STATUTS,
  DEFAULT_STATS,
  STAT_MAX,
} = require('../Data/profileStore.js');
const config = require('../Data/config.js');

const app = express();
app.use(express.json());

// --- Authentification basique (identifiants dans .env, jamais dans le code) ---
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_USER || !ADMIN_PASSWORD) {
  console.error('❌ ADMIN_USER / ADMIN_PASSWORD manquants dans le .env — le site ne peut pas démarrer sans ça.');
  process.exit(1);
}

app.use((req, res, next) => {
  const header = req.headers.authorization;
  if (header) {
    const [scheme, encoded] = header.split(' ');
    if (scheme === 'Basic' && encoded) {
      const [user, pass] = Buffer.from(encoded, 'base64').toString('utf-8').split(':');
      if (user === ADMIN_USER && pass === ADMIN_PASSWORD) {
        return next();
      }
    }
  }
  res.set('WWW-Authenticate', 'Basic realm="Admin RP"');
  return res.status(401).send('Authentification requise.');
});

app.use(express.static(path.join(__dirname, 'public')));

// Le logo vit à la racine du projet (à côté du .env), pas dans web/public,
// donc il a besoin de sa propre route pour être accessible depuis le navigateur.
app.get('/logo.jpg', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'logo.jpg'));
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

    // Champs modifiables depuis le site : la "fiche modifiable" du personnage
    // (jamais son identité — nom, rôle, faceclaim... — qui vient de la fiche
    // validée côté Discord et ne doit pas se désynchroniser des rôles réels).
    const fields = {};
    const b = req.body || {};

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

    res.json(await updateProfileFields(req.params.id, fields));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/statuts', (req, res) => res.json(STATUTS));

// Données de référence (factions/relations/stats) pour construire le panneau
// d'édition d'un profil côté site — copiées depuis Data/config.js et
// Data/profileStore.js pour rester exactement alignées avec le bot.
app.get('/api/lists', (req, res) => {
  res.json({
    relationFactions: config.RELATION_FACTIONS,
    relationLevels: config.RELATION_LEVELS,
    defaultStats: DEFAULT_STATS,
    statMax: STAT_MAX,
  });
});

// Portrait (faceclaim) d'un personnage, servi à la volée depuis Mongo (avatars
// stockés en base64) — pas chargé dans la liste des profils pour rester léger.
app.get('/api/profils/:id/avatar', async (req, res) => {
  try {
    const profile = await getProfile(req.params.id);
    if (!profile || !profile.faceclaim) return res.status(404).end();

    const { findAvatar } = require('../Data/avatarStore.js');
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

const PORT = process.env.PORT || process.env.WEB_PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Site admin lancé sur http://localhost:${PORT}`);
});
