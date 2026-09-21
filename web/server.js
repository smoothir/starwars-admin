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
const { getFactions, findGradeByRoleId } = require('../Data/factionHelper.js');
const { findAvatar, upsertAvatarImage } = require('../Data/avatarStore.js');

const app = express();
// Limite relevée (défaut Express : 100kb) pour accepter l'upload d'un portrait
// en base64 dans le corps JSON — une photo fait facilement 1-4 Mo encodée.
app.use(express.json({ limit: '10mb' }));

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
    // le site. ⚠️ Ceci ne change QUE ce qui est affiché ici — ça n'attribue
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

    res.json(await updateProfileFields(req.params.id, fields));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/statuts', (req, res) => res.json(STATUTS));

// Données de référence (factions/rôles/relations/stats) pour construire le
// panneau d'édition d'un profil côté site — copiées depuis Data/config.js et
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
// stockés en base64) — pas chargé dans la liste des profils pour rester léger.
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

const PORT = process.env.PORT || process.env.WEB_PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Site admin lancé sur http://localhost:${PORT}`);
});
