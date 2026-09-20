// Petit site d'admin pour gérer maisons / régions / profils sans passer par Discord.
// Réutilise directement les modules du bot (Data/...) pour ne jamais dupliquer la
// logique ni risquer que le site et le bot voient des données différentes.
require('dotenv').config();
const path = require('path');
const express = require('express');

const { MAISONS, getArmeeLines, initMaisons } = require('../Data/maisons.js');
const { REGIONS, getRegionArmyLines, initRegions } = require('../Data/regions.js');
const {
  getMaisonState,
  setLeader,
  updateMaisonOverrides,
  addHistoriqueEntry,
} = require('../Data/maisonStore.js');
const {
  getRegionState,
  updateRegionOverrides,
  addRegionHistoriqueEntry,
} = require('../Data/regionStore.js');
const {
  listAllProfiles,
  getProfile,
  updateProfileFields,
  STATUTS,
} = require('../Data/profileStore.js');
const {
  getMaisonsStateCollection,
  getRegionsStateCollection,
  getMaisonsCanonCollection,
  getRegionsCanonCollection,
} = require('../Data/mongo.js');

const app = express();
app.use(express.json());

// --- Écriture des données de base dans MongoDB ------------------------------
// Les fiches "canon" de maisons/régions vivent maintenant dans MongoDB
// (collections maisons_canon / regions_canon), chargées au démarrage par
// initMaisons()/initRegions() ci-dessous. Le site les édite en mémoire
// (tableau MAISONS / REGIONS, partagé avec Data/maisons.js et
// Data/regions.js) puis persiste le document modifié dans Mongo — le bot,
// qui lit la même base, voit la modification en direct (aucun redémarrage,
// aucun fichier à recopier).
async function persistMaisonCanon(maison) {
  const col = await getMaisonsCanonCollection();
  const { key, ...rest } = maison;
  await col.replaceOne({ _id: key }, { _id: key, ...rest }, { upsert: true });
}
async function persistRegionCanon(region) {
  const col = await getRegionsCanonCollection();
  const { key, ...rest } = region;
  await col.replaceOne({ _id: key }, { _id: key, ...rest }, { upsert: true });
}
function num(v, fallback = 0) {
  if (v === '' || v === null || v === undefined) return fallback;
  const n = Number(v);
  return Number.isNaN(n) ? fallback : n;
}

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
  res.set('WWW-Authenticate', 'Basic realm="Admin Westeros Origin"');
  return res.status(401).send('Authentification requise.');
});

app.use(express.static(path.join(__dirname, 'public')));

// Le logo vit à la racine du projet (à côté du .env), pas dans web/public,
// donc il a besoin de sa propre route pour être accessible depuis le navigateur.
app.get('/logo.jpg', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'logo.jpg'));
});

// ---------------------------------------------------------------------------
// MAISONS
// ---------------------------------------------------------------------------

async function serializeMaison(m) {
  const state = await getMaisonState(m.key);
  return {
    key: m.key,
    nom: m.nom,
    type: m.type,
    region: m.region,
    croyance: m.croyance,
    uniteSpeciale: m.uniteSpeciale,
    armee: m.armee,
    armeeLines: getArmeeLines(m.armee),
    renommeeBase: m.renommee,
    argentBase: m.argent,
    leaderId: state.leaderId,
    renommeeOverride: state.renommeeOverride,
    argentOverride: state.argentOverride,
    historique: state.historique || [],
  };
}

app.get('/api/maisons', async (req, res) => {
  try {
    const data = await Promise.all(MAISONS.map(serializeMaison));
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/maisons/:key', async (req, res) => {
  try {
    const { key } = req.params;
    if (!MAISONS.some(m => m.key === key)) return res.status(404).json({ error: 'Maison inconnue' });

    const { renommeeOverride, argentOverride, leaderId } = req.body;
    const fields = {};
    if (renommeeOverride !== undefined) fields.renommeeOverride = renommeeOverride === '' ? null : Number(renommeeOverride);
    if (argentOverride !== undefined) fields.argentOverride = argentOverride === '' ? null : Number(argentOverride);
    if (Object.keys(fields).length) await updateMaisonOverrides(key, fields);
    if (leaderId !== undefined) await setLeader(key, leaderId === '' ? null : leaderId);

    res.json(await serializeMaison(MAISONS.find(m => m.key === key)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Édition complète de la fiche "canon" d'une maison (tout, sauf sa clé
// stable `key`, qu'on ne touche jamais pour ne pas casser l'état lié en base).
app.patch('/api/maisons/:key/base', async (req, res) => {
  try {
    const { key } = req.params;
    const maison = MAISONS.find(m => m.key === key);
    if (!maison) return res.status(404).json({ error: 'Maison inconnue' });

    const b = req.body || {};
    if (b.nom !== undefined) maison.nom = String(b.nom);
    if (b.type !== undefined) maison.type = String(b.type);
    if (b.region !== undefined) maison.region = String(b.region);
    if (b.croyance !== undefined) maison.croyance = String(b.croyance);
    if (b.uniteSpeciale !== undefined) maison.uniteSpeciale = String(b.uniteSpeciale);
    if (b.renommee !== undefined) maison.renommee = num(b.renommee, maison.renommee);
    if (b.argent !== undefined) maison.argent = num(b.argent, 0);

    if (b.armee && typeof b.armee === 'object') {
      const a = maison.armee || {};
      ['fantassins', 'archers', 'cavalerie', 'guerriers', 'eclaireurs'].forEach((champ) => {
        if (b.armee[champ] !== undefined) a[champ] = num(b.armee[champ], 0);
      });
      if (b.armee.flotte !== undefined) a.flotte = b.armee.flotte === '' ? null : num(b.armee.flotte, 0);
      if (b.armee.noteFlotte !== undefined) a.noteFlotte = b.armee.noteFlotte || undefined;
      maison.armee = a;
    }

    await persistMaisonCanon(maison);
    res.json(await serializeMaison(maison));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/maisons/:key/historique', async (req, res) => {
  try {
    const { key } = req.params;
    if (!MAISONS.some(m => m.key === key)) return res.status(404).json({ error: 'Maison inconnue' });
    const { texte, auteurLabel } = req.body;
    if (!texte) return res.status(400).json({ error: 'Texte requis' });
    await addHistoriqueEntry(key, { texte, auteurLabel: auteurLabel || 'Site admin' });
    res.json(await serializeMaison(MAISONS.find(m => m.key === key)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// RÉGIONS
// ---------------------------------------------------------------------------

async function serializeRegion(r) {
  const state = await getRegionState(r.key);
  return {
    key: r.key,
    nom: r.nom,
    maisonDirigeante: r.maisonDirigeante,
    capitale: r.capitale,
    statutPolitiqueBase: r.statutPolitique,
    instabiliteBase: r.instabilite,
    richesse: r.richesse,
    specialite: r.specialite,
    climat: r.climat,
    armee: r.armee,
    armeeLines: getRegionArmyLines(r.armee),
    statutOverride: state.statutOverride,
    instabiliteOverride: state.instabiliteOverride,
    historique: state.historique || [],
  };
}

app.get('/api/regions', async (req, res) => {
  try {
    const data = await Promise.all(REGIONS.map(serializeRegion));
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/regions/:key', async (req, res) => {
  try {
    const { key } = req.params;
    if (!REGIONS.some(r => r.key === key)) return res.status(404).json({ error: 'Région inconnue' });

    const { statutOverride, instabiliteOverride } = req.body;
    const fields = {};
    if (statutOverride !== undefined) fields.statutOverride = statutOverride === '' ? null : statutOverride;
    if (instabiliteOverride !== undefined) fields.instabiliteOverride = instabiliteOverride === '' ? null : Number(instabiliteOverride);
    if (Object.keys(fields).length) await updateRegionOverrides(key, fields);

    res.json(await serializeRegion(REGIONS.find(r => r.key === key)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Édition complète de la fiche "canon" d'une région (tout, sauf sa clé stable `key`).
app.patch('/api/regions/:key/base', async (req, res) => {
  try {
    const { key } = req.params;
    const region = REGIONS.find(r => r.key === key);
    if (!region) return res.status(404).json({ error: 'Région inconnue' });

    const b = req.body || {};
    if (b.nom !== undefined) region.nom = String(b.nom);
    if (b.maisonDirigeante !== undefined) region.maisonDirigeante = String(b.maisonDirigeante);
    if (b.capitale !== undefined) region.capitale = String(b.capitale);
    if (b.statutPolitique !== undefined) region.statutPolitique = String(b.statutPolitique);
    if (b.instabilite !== undefined) region.instabilite = num(b.instabilite, region.instabilite);
    if (b.richesse !== undefined) region.richesse = String(b.richesse);
    if (b.specialite !== undefined) region.specialite = String(b.specialite);
    if (b.climat !== undefined) region.climat = String(b.climat);

    if (b.armee === null) {
      region.armee = null;
    } else if (b.armee && typeof b.armee === 'object') {
      const a = region.armee || {};
      ['troupes', 'archers', 'cavalerie', 'eclaireurs'].forEach((champ) => {
        if (b.armee[champ] !== undefined) a[champ] = num(b.armee[champ], 0);
      });
      if (b.armee.flotte !== undefined) a.flotte = b.armee.flotte === '' ? null : num(b.armee.flotte, 0);
      region.armee = a;
    }

    await persistRegionCanon(region);
    res.json(await serializeRegion(region));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/regions/:key/historique', async (req, res) => {
  try {
    const { key } = req.params;
    if (!REGIONS.some(r => r.key === key)) return res.status(404).json({ error: 'Région inconnue' });
    const { texte, auteurLabel } = req.body;
    if (!texte) return res.status(400).json({ error: 'Texte requis' });
    await addRegionHistoriqueEntry(key, { texte, auteurLabel: auteurLabel || 'Site admin' });
    res.json(await serializeRegion(REGIONS.find(r => r.key === key)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
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

    const allowed = [
      'statut', 'gardePersonnelle', 'boursePersonnelle', 'allies', 'rivaux', 'renommee', 'notes',
      'maisonName', 'regionName', 'roleName',
    ];
    const fields = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        fields[key] = key === 'renommee' ? Number(req.body[key]) : req.body[key];
      }
    }
    res.json(await updateProfileFields(req.params.id, fields));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/statuts', (req, res) => res.json(STATUTS));

// Listes déroulantes (Titres / Régions / Maisons) utilisées côté Discord —
// permet au site d'utiliser exactement les mêmes valeurs plutôt que du texte libre.
app.get('/api/lists', (req, res) => {
  const { TITRES, REGIONS: REGIONS_DISCORD, MAISONS: MAISONS_DISCORD } = require('../Data/discordLists.js');
  res.json({
    titres: TITRES.map(t => t.name),
    regions: REGIONS_DISCORD.map(r => r.name),
    maisons: MAISONS_DISCORD.map(m => m.name),
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

// ---------------------------------------------------------------------------
// SYNCHRONISATION
// ---------------------------------------------------------------------------
// "Au cas où" : s'assure que chaque maison et chaque région définie dans les
// fichiers JSON a bien un document d'état correspondant en base (maisons_state /
// regions_state), sans jamais écraser un état déjà existant. Utile si un fichier
// JSON a été modifié (nouvelle maison/région ajoutée) et que personne n'a encore
// interagi avec elle via le bot ou le site.
app.post('/api/sync', async (req, res) => {
  try {
    const maisonsCol = await getMaisonsStateCollection();
    const regionsCol = await getRegionsStateCollection();

    let maisonsCreated = 0;
    let regionsCreated = 0;

    for (const m of MAISONS) {
      const result = await maisonsCol.updateOne(
        { _id: m.key },
        { $setOnInsert: { leaderId: null, argentOverride: null, renommeeOverride: null, historique: [] } },
        { upsert: true },
      );
      if (result.upsertedCount > 0) maisonsCreated += 1;
    }

    for (const r of REGIONS) {
      const result = await regionsCol.updateOne(
        { _id: r.key },
        { $setOnInsert: { statutOverride: null, instabiliteOverride: null, historique: [] } },
        { upsert: true },
      );
      if (result.upsertedCount > 0) regionsCreated += 1;
    }

    res.json({
      ok: true,
      maisonsTotal: MAISONS.length,
      regionsTotal: REGIONS.length,
      maisonsCreated,
      regionsCreated,
      message: `Synchro terminée : ${maisonsCreated} maison(s) et ${regionsCreated} région(s) initialisée(s) (le reste était déjà à jour).`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// On attend que les fiches maisons/régions soient chargées depuis MongoDB
// avant d'ouvrir le port : ça évite de répondre avec des données vides sur
// les toutes premières requêtes juste après un démarrage.
(async () => {
  await initMaisons();
  await initRegions();

  const PORT = process.env.PORT || process.env.WEB_PORT || 3000;
  app.listen(PORT, () => {
    console.log(`✅ Site admin lancé sur http://localhost:${PORT}`);
  });
})();