// Portail galactique Joueur + Staff. Réutilise directement les modules du bot
// (Data/...) afin que le portail et Discord partagent les mêmes données.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const crypto = require('crypto');
const { ObjectId } = require('mongodb');

const {
  listAllProfiles,
  listProfilesForUser,
  getProfile,
  updateProfileFields,
  STATUTS,
  DEFAULT_STATS,
  STAT_MAX,
} = require('../Data/profileStore.js');
const config = require('../Data/config.js');
const FOUNDER_DISCORD_ID = '391515665271357441';

// Traits de départ. Ils ne sont insérés que si la collection est vide ; une fois
// le site configuré, les choix du staff sont la source de vérité partagée avec le bot.
const DEFAULT_CHARACTER_TRAITS = [
  { _id: 'mise-a-prix', name: 'Mise à Prix', description: 'Prime de 2 500 crédits pour avoir volé la Nouvelle République ; +1 relation avec l’Empire.', points: 5, enabled: true, effects: { bounty: { amount: 2500, description: 'Recherché pour avoir volé la Nouvelle République.' }, relations: [{ factionKey: 'EMPIRE', mode: 'add', value: 1 }] } },
  { _id: 'dette-d-hutt', name: 'Dette d’Hutt', description: 'Dette de 2 000 crédits auprès du Cartel des Hutts et relation diminuée.', points: 6, enabled: true, effects: { debts: [{ creditor: 'Cartel des Hutts', amount: 2000 }], credits: { amount: -2000 }, relations: [{ factionKey: 'CARTEL_HUTTS', mode: 'add', value: -1 }] } },
  { _id: 'veteran-des-guerres', name: 'Vétéran des Guerres', description: 'Reçoit un équipement Peu commun au hasard.', points: -4, enabled: true, effects: { randomItems: [{ rarity: 'Peu commun', categoryIncludes: 'équipement', quantity: 1 }] } },
  { _id: 'connaisseur-des-bas-fonds', name: 'Connaisseur des Bas-Fonds', description: '+5 Éloquence & Commerce.', points: -2, enabled: true, effects: { stats: [{ stat: 'Éloquence & Commerce', amount: 5 }] } },
  { _id: 'accro-aux-batons-de-la-mort', name: 'Accro aux Bâtons de la Mort', description: '-10 Résistance si aucune dose n’est consommée tous les 3 jours réels.', points: 6, enabled: true, effects: { addictions: [{ itemId: 'batons_de_la_mort', itemNameContains: 'bâton de la mort', stat: 'Résistance', amount: -10, intervalDays: 3 }] } },
  { _id: 'sequelle-de-guerre', name: 'Séquelle de Guerre', description: '-10 Tir & Précision.', points: 2, enabled: true, effects: { stats: [{ stat: 'Tir & Précision', amount: -10 }] } },
  { _id: 'capitaine-de-chasseur-stellaire', name: 'Capitaine de chasseur stellaire', description: 'Reçoit un chasseur stellaire de rareté Rare.', points: -8, enabled: true, effects: { items: [{ itemId: 'chasseur_stellaire', fallbackName: 'chasseur stellaire', rarity: 'Rare', quantity: 1 }] } },
  { _id: 'as-du-vol-spatial', name: 'As du Vol Spatial', description: '+10 Pilotage.', points: -6, enabled: true, effects: { stats: [{ stat: 'Pilotage', amount: 10 }] } },
  { _id: 'infiltre-du-syndicat', name: 'Infiltré du Syndicat', description: 'La relation avec le Syndicat Pyke passe à 5.', points: -6, enabled: true, effects: { relations: [{ factionKey: 'SYNDICAT_PYKE', mode: 'set', value: 5 }] } },
  { _id: 'fonds-de-roulement', name: 'Fonds de Roulement', description: 'Reçoit 1 500 crédits.', points: -4, enabled: true, effects: { items: [{ itemId: 'credits_de_la_nouvelle_republique', fallbackName: 'crédits', quantity: 1500 }] } },
  { _id: 'diplomate-celebre', name: 'Diplomate Célèbre', description: 'La Nouvelle République OU l’Ordre Jedi passe à 3 (Favorable) ; +5 Éloquence & Commerce.', points: -2, enabled: true, effects: { stats: [{ stat: 'Éloquence & Commerce', amount: 5 }], relationChoice: { prompt: 'Choisis la faction qui commence à une relation de 3 (Favorable).', options: [{ factionKey: 'NOUVELLE_REPUBLIQUE', label: 'La Nouvelle République', level: 3 }, { factionKey: 'ORDRE_JEDI', label: 'L’Ordre Jedi', level: 3 }] } } },
];
const { getFactions, findGradeByRoleId } = require('../Data/factionHelper.js');
const factionStore = require('../Data/factionStore.js');
const { findAvatar, upsertAvatarImage } = require('../Data/avatarStore.js');
const {
  EQUIPMENT_SLOTS,
  EQUIPMENT_SLOT_LABELS,
  ITEM_RARITIES,
  getCatalog,
  getItem,
  getExistingCatalogIds,
  getCatalogMetadata,
  getCatalogImageData,
  getInventory,
  getInventoryLoad,
  addCatalogItem,
  updateCatalogItem,
  removeCatalogItem,
  clearCatalog,
  listAllInventories,
  addItem,
  removeItem,
  setItemQuantity,
  equipItem,
  unequipSlot,
} = require('../Data/invStore.js');
const { recordConnexion, listConnexions, logAction, listLogs, createBackup, listBackups, restoreBackup, deleteBackup } = require('../Data/adminStore.js');
const { connect, getItemCatalogCollection, getBoutiqueItemsCollection, getBoutiqueStateCollection, getMissionsCollection, getMissionStateCollection, getPossessionsCollection, getProductionRecipesCollection, getPersonnelTypesCollection, getInvCollection, getCharacterTraitsCollection } = require('../Data/mongo.js');
const possessionStore = require('../Data/possessionStore.js');

const app = express();
// Limite relevée (défaut Express : 100kb) pour accepter l'upload d'un portrait
// en base64 dans le corps JSON  une photo fait facilement 1-4 Mo encodée.
// Seules les routes qui reçoivent des images en base64 (portraits, images du catalogue)
// acceptent un gros corps JSON ; partout ailleurs la limite est de 1 Mo.
// L'ordre compte : le 1er parser qui correspond lit le corps, les suivants l'ignorent.
const bigJson = express.json({ limit: '10mb' });
app.use('/api/profils', bigJson);
app.use('/api/inventaire/catalogue', bigJson);
app.use('/api/factions/classes', bigJson);
app.use(express.json({ limit: '1mb' }));

// En-têtes de sécurité de base (équivalent minimal de helmet, sans dépendance).
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'same-origin');
  next();
});

// Limiteur de débit simple en mémoire (par IP) : suffit pour une instance unique.
function createRateLimiter({ windowMs, max, message }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.reset <= now) hits.delete(key);
  }, windowMs).unref();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || 'inconnu';
    let entry = hits.get(key);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.reset - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    next();
  };
}
app.use('/auth', createRateLimiter({ windowMs: 10 * 60 * 1000, max: 40, message: 'Trop de tentatives de connexion, réessaie dans quelques minutes.' }));
app.use('/api', createRateLimiter({ windowMs: 60 * 1000, max: 600, message: 'Trop de requêtes, ralentis un peu.' }));

// --- Connexion Discord : membres whitelist, membres et Staff autorisés. ---
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
    touchAfter: 24 * 3600, // ne réécrit la session en base qu'une fois par jour (au lieu de chaque requête)
  }),
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    // 'auto' : secure dès que la requête arrive en HTTPS (via trust proxy sur Render),
    // sans dépendre de NODE_ENV=production.
    secure: 'auto',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

// Le site (HTML/CSS/JS/logo) reste public : c'est l'ecran de connexion custom
// de la page elle-meme qui gere l'authentification, pas le navigateur. Seules
// les routes /api/* sont protegees, et sans en-tete WWW-Authenticate, pour ne
// jamais declencher la popup native du navigateur par-dessus notre ecran.
// Les anciennes images d'objets vivent dans le dossier /image du bot. On les
// sert à la même URL pour conserver les chemins déjà enregistrés en base.
const imageDirCandidats = [
  process.env.ITEM_IMAGE_DIR,
  process.env.BOT_IMAGE_DIR,
  path.resolve(__dirname, '..', '..', 'image'),
  path.resolve(__dirname, '..', 'image'),
  path.resolve(process.cwd(), 'image'),
].filter(Boolean).map(dir => path.resolve(dir));
const itemImageDir = imageDirCandidats.find(dir => {
  try { return fs.statSync(dir).isDirectory(); } catch { return false; }
});
if (itemImageDir) {
  console.log(`🖼️ Images du catalogue servies depuis : ${itemImageDir}`);
  app.use('/image', express.static(itemImageDir, { maxAge: '1d' }));
} else {
  console.warn('⚠️ Aucun dossier image trouvé. Définis ITEM_IMAGE_DIR ou BOT_IMAGE_DIR si nécessaire.');
}
// Icone du bouton de navigation : le fichier est placé à la racine de web/.
app.get('/iconpages.png', (req, res) => {
  const iconPath = path.join(__dirname, 'iconpages.png');
  if (!fs.existsSync(iconPath)) return res.sendStatus(404);
  return res.sendFile(iconPath);
});

app.use('/ship', express.static(path.join(__dirname, 'ship'), { maxAge: '1d' }));
// Fond de l'inventaire du portail joueur : servi explicitement depuis le dossier
// image du site pour éviter de dépendre du dossier image du bot.
app.use('/site-image', express.static(path.join(__dirname, '..', 'image'), { maxAge: '1d' }));
app.use(express.static(path.join(__dirname, 'public')));

// /api/me reste avant le middleware d'authentification général : le client
// doit pouvoir vérifier la session avant d'afficher le portail joueur ou Staff.
// Les rôles Discord sont mémorisés dans la session au retour OAuth2.
async function canAccessAdmin(req) {
  const user = req.session?.user;
  if (!user) return false;
  if (user.id === config.SUPER_ADMIN_ID) return true;
  const allowed = new Set((config.ADMIN_ROLE_IDS || []).map(String));
  if (!Array.isArray(req.session.roles)) {
    const botToken = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN;
    if (!botToken || !process.env.GUILD_ID) return false;
    try {
      const r = await fetch(`https://discord.com/api/v10/guilds/${process.env.GUILD_ID}/members/${user.id}`, { headers: { Authorization: `Bot ${botToken}` } });
      if (!r.ok) return false;
      const member = await r.json();
      req.session.roles = Array.isArray(member.roles) ? member.roles.map(String) : [];
    } catch (err) {
      console.error('Lecture des rôles Discord impossible :', err.message);
      return false;
    }
  }
  return req.session.roles.some(id => allowed.has(String(id)));
}

function hasStaffSiteAccess(req) {
  const user = req.session?.user;
  if (!user) return false;
  if (config.SUPER_ADMIN_ID && String(user.id) === String(config.SUPER_ADMIN_ID)) return true;
  const allowedRoleIds = [config.STAFF_ROLE_ID, ...(config.ADMIN_ROLE_IDS || [])]
    .filter(Boolean).map(String);
  const memberRoleIds = Array.isArray(req.session?.roles) ? req.session.roles.map(String) : [];
  return memberRoleIds.some(roleId => allowedRoleIds.includes(roleId));
}

// Les deux rôles transmis pour le portail joueur : whitelist et membre non whitelist.
// Le rôle Staff/Admin reste indépendant et donne accès aux deux espaces.
const PLAYER_WHITELIST_ROLE_ID = String(config.FIXED_ROLES?.ROLISTE || '1545274332614230084');
const PLAYER_MEMBER_ROLE_ID = '1545274332614230082';
function hasPlayerSiteAccess(req) {
  if (hasStaffSiteAccess(req)) return true;
  if (!req.session?.user) return false;
  const roles = Array.isArray(req.session.roles) ? req.session.roles.map(String) : [];
  return roles.includes(PLAYER_WHITELIST_ROLE_ID) || roles.includes(PLAYER_MEMBER_ROLE_ID);
}

app.get('/api/me', async (req, res) => {
  if (!hasPlayerSiteAccess(req)) {
    if (req.session?.user) {
      return req.session.destroy(() => {
        res.clearCookie('rpadmin.sid');
        res.json({ authenticated: false });
      });
    }
    return res.json({ authenticated: false });
  }
  const roles = Array.isArray(req.session.roles) ? req.session.roles.map(String) : [];
  const isStaff = hasStaffSiteAccess(req);
  return res.json({
    authenticated: true,
    via: 'discord',
    ...req.session.user,
    isStaff,
    isPlayer: true,
    isWhitelisted: roles.includes(PLAYER_WHITELIST_ROLE_ID),
    playerRole: roles.includes(PLAYER_WHITELIST_ROLE_ID) ? 'whitelist' : (roles.includes(PLAYER_MEMBER_ROLE_ID) ? 'member' : (isStaff ? 'staff' : 'unknown')),
    guildId: GUILD_ID,
    factionKeys: [],
    isSuperAdmin: await canAccessAdmin(req),
    isFounder: req.session.user.id === FOUNDER_DISCORD_ID,
  });
});

// Sondes de santé : /healthz confirme que Node/Express répond ; /readyz vérifie aussi MongoDB.
// Elles ne révèlent aucune donnée métier et restent accessibles sans session Discord.
app.get('/healthz', (_req, res) => res.json({ ok: true, service: 'starwars-admin' }));
app.get('/readyz', async (_req, res) => {
  try {
    await connect();
    return res.json({ ok: true, service: 'starwars-admin', database: 'connected' });
  } catch (err) {
    console.error('Vérification MongoDB (/readyz) impossible :', err);
    return res.status(503).json({ ok: false, service: 'starwars-admin', database: 'unavailable' });
  }
});

// API du portail joueur : accessibles aux rôles whitelist / membre et au Staff.
// Elles sont déclarées avant le middleware /api général, qui reste strictement Staff.
app.use('/api/player', (req, res, next) => {
  if (!req.session?.user) return res.status(401).json({ error: 'Authentification requise.' });
  if (!hasPlayerSiteAccess(req)) return res.status(403).json({ error: 'Accès au portail joueur refusé.' });
  next();
});

async function touchPlayerPresence(req) {
  const user = req.session.user;
  const col = (await connect()).collection('site_presence');
  await col.updateOne(
    { _id: String(user.id) },
    { $set: { username: String(user.username || 'Joueur').slice(0, 100), avatar: user.avatar || null, lastSeen: new Date() } },
    { upsert: true },
  );
  return col;
}

function safePlayerCharacter(profile) {
  return {
    id: String(profile._id),
    nomPrenom: profile.nomPrenom || profile.surnom || 'Personnage sans nom',
    surnom: profile.surnom || '',
    age: profile.age || '',
    faceclaim: profile.faceclaim || '',
    imageUrl: profile.imageUrl || null,
    roleName: profile.roleName || '',
    categoryName: profile.categoryName || '',
    statut: profile.statut || 'Vivant',
    stats: profile.stats || {},
    relations: profile.relations || {},
    renommee: Number(profile.renommee) || 0,
    ficheUrl: profile.ficheUrl || null,
    prime: profile.prime?.active && Number(profile.prime.amount) > 0
      ? { active: true, amount: Number(profile.prime.amount), description: profile.prime.description || '' }
      : { active: false, amount: 0, description: '' },
  };
}

app.get('/api/player/dashboard', async (req, res) => {
  try {
    const presence = await touchPlayerPresence(req);
    const onlineSince = new Date(Date.now() - 2 * 60 * 1000);
    const [onlineCount, characters, missionsAvailable, activeBounties] = await Promise.all([
      presence.countDocuments({ lastSeen: { $gte: onlineSince } }),
      listProfilesForUser(String(req.session.user.id)),
      (await getMissionsCollection()).countDocuments({ status: 'available' }),
      (await connect()).collection('profils').countDocuments({ 'prime.active': true, 'prime.amount': { $gt: 0 }, _id: { $not: /^__/ } }),
    ]);
    res.set('Cache-Control', 'no-store');
    res.json({ onlineCount, characterCount: characters.length, missionsAvailable, activeBounties, serverTime: new Date().toISOString() });
  } catch (err) {
    console.error('Dashboard joueur indisponible :', err);
    res.status(500).json({ error: 'Impossible de charger le tableau de bord.' });
  }
});

app.post('/api/player/heartbeat', async (req, res) => {
  try {
    const presence = await touchPlayerPresence(req);
    const onlineCount = await presence.countDocuments({ lastSeen: { $gte: new Date(Date.now() - 2 * 60 * 1000) } });
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, onlineCount });
  } catch (err) {
    res.status(500).json({ error: 'Présence momentanément indisponible.' });
  }
});

app.get('/api/player/characters', async (req, res) => {
  try {
    const profiles = await listProfilesForUser(String(req.session.user.id));
    res.set('Cache-Control', 'private, no-store');
    res.json(profiles.filter(profile => !String(profile._id).startsWith('__')).map(safePlayerCharacter));
  } catch (err) {
    console.error('Personnages joueur indisponibles :', err);
    res.status(500).json({ error: 'Impossible de charger tes personnages.' });
  }
});

app.get('/api/player/characters/:profileId', async (req, res) => {
  try {
    const profile = await getProfile(String(req.params.profileId));
    if (!profile || String(profile.userId) !== String(req.session.user.id)) return res.status(404).json({ error: 'Personnage introuvable.' });
    const [inventory, catalog, load] = await Promise.all([
      getInventory(String(profile._id)), getCatalog(), getInventoryLoad(String(profile._id)),
    ]);
    const lookup = new Map(catalog.map(item => [String(item.id), item]));
    const items = Object.entries(inventory.items || {}).filter(([, quantity]) => Number(quantity) > 0).map(([id, quantity]) => {
      const item = lookup.get(id);
      return {
        id, name: item?.name || id, emoji: item?.emoji || '📦', image: item?.image || null,
        quantity: Number(quantity), weight: Number(item?.weight) || 0,
        rarity: item?.rarity || 'Commun', category: item?.category || 'Divers',
        description: item?.description || '', slot: item?.slot || null,
        usable: Boolean(item?.usable), statBonus: item?.statBonus || {}, bagCapacity: Number(item?.bagCapacity) || 0,
      };
    });
    const equipment = Object.entries(inventory.equipement || {}).filter(([, id]) => id).map(([slot, id]) => {
      const item = lookup.get(String(id));
      return {
        slot, slotLabel: (EQUIPMENT_SLOT_LABELS[slot] || slot), id: String(id),
        name: item?.name || String(id), image: item?.image || null, emoji: item?.emoji || '🧰',
        weight: Number(item?.weight) || 0, description: item?.description || '',
        rarity: item?.rarity || 'Commun', statBonus: item?.statBonus || {}, bagCapacity: Number(item?.bagCapacity) || 0,
      };
    });
    res.set('Cache-Control', 'private, no-store');
    res.json({ character: safePlayerCharacter(profile), items, equipment, load });
  } catch (err) {
    console.error('Détail du personnage joueur indisponible :', err);
    res.status(500).json({ error: 'Impossible de charger ce personnage.' });
  }
});

async function getOwnedPlayerProfile(req, res) {
  const profile = await getProfile(String(req.params.profileId));
  if (!profile || String(profile.userId) !== String(req.session.user.id)) {
    res.status(404).json({ error: 'Personnage introuvable.' });
    return null;
  }
  return profile;
}

app.post('/api/player/characters/:profileId/equip', async (req, res) => {
  try {
    const profile = await getOwnedPlayerProfile(req, res);
    if (!profile) return;
    const itemId = String(req.body?.itemId || '').trim();
    if (!itemId) return res.status(400).json({ error: 'Objet à équiper manquant.' });
    const result = await equipItem(String(profile._id), itemId);
    if (!result.ok) return res.status(400).json({ error: result.message || 'Cet objet ne peut pas être équipé.' });
    const load = await getInventoryLoad(String(profile._id));
    res.set('Cache-Control', 'private, no-store');
    res.json({ ok: true, load, message: `${result.item?.name || 'Objet'} équipé.` });
  } catch (err) {
    console.error('Équipement depuis le portail joueur impossible :', err);
    res.status(500).json({ error: 'Impossible d’équiper cet objet.' });
  }
});

app.post('/api/player/characters/:profileId/unequip', async (req, res) => {
  try {
    const profile = await getOwnedPlayerProfile(req, res);
    if (!profile) return;
    const slot = String(req.body?.slot || '').trim();
    if (!EQUIPMENT_SLOTS.includes(slot)) return res.status(400).json({ error: 'Emplacement d’équipement invalide.' });
    const result = await unequipSlot(String(profile._id), slot);
    if (!result.ok) return res.status(400).json({ error: result.message || 'Cet emplacement ne peut pas être déséquipé.' });
    const load = await getInventoryLoad(String(profile._id));
    res.set('Cache-Control', 'private, no-store');
    res.json({ ok: true, load, message: `${result.item?.name || 'Objet'} déséquipé.` });
  } catch (err) {
    console.error('Déséquipement depuis le portail joueur impossible :', err);
    res.status(500).json({ error: 'Impossible de déséquiper cet objet.' });
  }
});

app.get('/api/player/missions', async (req, res) => {
  try {
    const docs = await (await getMissionsCollection()).find({
      $or: [{ status: 'available' }, { claimedByUserId: String(req.session.user.id) }],
    }).sort({ createdAt: -1 }).toArray();
    res.set('Cache-Control', 'private, no-store');
    res.json(docs.map(({ _id, ...mission }) => ({
      id: String(_id), title: mission.title || 'Mission', description: mission.description || '',
      image: mission.image || null, rewards: Array.isArray(mission.rewards) ? mission.rewards : [],
      status: mission.status, profileId: mission.claimedByUserId === String(req.session.user.id) ? mission.profileId || null : null,
      profileName: mission.claimedByUserId === String(req.session.user.id) ? mission.profileName || '' : '',
      publicThreadId: mission.publicThreadId || null,
      acceptedThreadId: mission.claimedByUserId === String(req.session.user.id) ? mission.acceptedThreadId || null : null,
      createdAt: mission.createdAt || null,
    })));
  } catch (err) {
    console.error('Missions joueur indisponibles :', err);
    res.status(500).json({ error: 'Impossible de charger les missions.' });
  }
});

app.post('/api/player/missions/:missionId/accept', async (req, res) => {
  try {
    if (!ObjectId.isValid(String(req.params.missionId))) return res.status(400).json({ error: 'Identifiant de mission invalide.' });
    const profileId = String(req.body?.profileId || '').trim();
    if (!profileId) return res.status(400).json({ error: 'Choisis un personnage pour cette mission.' });
    const profile = await getProfile(profileId);
    if (!profile || String(profile.userId) !== String(req.session.user.id)) return res.status(403).json({ error: 'Ce personnage ne t’appartient pas.' });

    const col = await getMissionsCollection();
    const filter = { _id: new ObjectId(String(req.params.missionId)), status: 'available' };
    const claimedAt = new Date();
    const update = await col.updateOne(filter, { $set: {
      status: 'in_progress',
      claimedByUserId: String(req.session.user.id),
      claimedByName: String(req.session.user.username || req.session.user.id),
      guildId: String(GUILD_ID || ''),
      profileId: String(profile._id),
      profileName: String(profile.nomPrenom || profile.surnom || profile._id),
      claimedAt,
      updatedAt: claimedAt,
    } });
    if (!update.matchedCount) return res.status(409).json({ error: 'Cette mission vient d’être prise ou n’est plus disponible.' });
    // Le bot surveille cette version et crée automatiquement le fil de suivi Discord.
    await (await getMissionStateCollection()).updateOne(
      { _id: 'meta' }, { $inc: { version: 1 }, $setOnInsert: { createdAt: new Date() } }, { upsert: true },
    );
    const mission = await col.findOne({ _id: filter._id });
    res.status(201).json({ ok: true, mission: { id: String(mission._id), title: mission.title, profileName: mission.profileName } });
  } catch (err) {
    console.error('Acceptation de mission joueur impossible :', err);
    res.status(500).json({ error: 'La mission n’a pas pu être acceptée.' });
  }
});

app.get('/api/player/primes', async (req, res) => {
  try {
    const docs = await (await connect()).collection('profils').find({
      _id: { $not: /^__/ }, 'prime.active': true, 'prime.amount': { $gt: 0 },
    }).sort({ 'prime.amount': -1 }).toArray();
    res.set('Cache-Control', 'private, no-store');
    res.json(docs.map(profile => ({
      id: String(profile._id), name: profile.nomPrenom || profile.surnom || 'Cible inconnue',
      faction: profile.categoryName || '', role: profile.roleName || '', faceclaim: profile.faceclaim || '',
      imageUrl: profile.imageUrl || null, amount: Math.max(0, Number(profile.prime?.amount) || 0),
      description: String(profile.prime?.description || '').slice(0, 1000),
      threadId: profile.prime?.discordThreadId || null,
    })));
  } catch (err) {
    console.error('Primes joueur indisponibles :', err);
    res.status(500).json({ error: 'Impossible de charger les primes.' });
  }
});

app.get('/api/player/shop', async (req, res) => {
  try {
    const [catalog, shopDocs, categoryDoc] = await Promise.all([
      getCatalog(), getBoutiqueItemsCollection().then(col => col.find({ enabled: { $ne: false } }).toArray()),
      getBoutiqueStateCollection().then(col => col.findOne({ _id: 'categories' })),
    ]);
    const lookup = new Map(catalog.map(item => [String(item.id), item]));
    const categories = Array.isArray(categoryDoc?.items) ? categoryDoc.items : [];
    res.set('Cache-Control', 'private, no-store');
    res.json(shopDocs.map(({ _id, ...row }) => {
      const item = lookup.get(String(_id));
      return item ? {
        id: String(_id), name: item.name, emoji: item.emoji, description: item.description,
        image: item.image, category: categories.find(category => category.id === row.categoryId)?.name || 'Autres',
        stock: Number(row.stock) || 0, buyable: ['achetable', 'mixte'].includes(row.type),
        minPrice: Number(row.minPrice) || 0, maxPrice: Number(row.maxPrice) || 0,
      } : null;
    }).filter(Boolean));
  } catch (err) {
    console.error('Boutique joueur indisponible :', err);
    res.status(500).json({ error: 'Impossible de charger la boutique.' });
  }
});

// Toutes les API d’administration restent réservées aux comptes Staff autorisés.
// Les comptes joueur ne peuvent jamais appeler les routes de gestion ci-dessous.
app.use('/api', (req, res, next) => {
  if (!req.session?.user) return res.status(401).json({ error: 'Authentification requise.' });
  if (!hasStaffSiteAccess(req)) return res.status(403).json({ error: 'Cette section est réservée au Staff.' });
  return next();
});


app.get('/api/dashboard', async (req, res) => {
  try {
    const db = await connect();
    const [profiles, objects, productions, personnel, boutique, missions, recent] = await Promise.all([
      db.collection('profils').countDocuments({}),
      db.collection('item_catalog').countDocuments({ _id: { $not: /^__/ } }),
      db.collection('production_recipes').countDocuments({}),
      db.collection('personnel_types').countDocuments({}),
      db.collection('boutique_items').countDocuments({}),
      db.collection('missions').countDocuments({}),
      listLogs(10),
    ]);
    res.set('Cache-Control', 'no-store');
    res.json({ counts: { profils: profiles, objets: objects, productions, personnel, boutique, missions }, recent: recent.map(row => ({ username: row.username, action: row.action, details: row.details, timestamp: row.timestamp })) });
  } catch (err) {
    console.error('Chargement du tableau de bord impossible :', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/history', async (req, res) => {
  try {
    const entityType = String(req.query.type || '').trim();
    const entityId = String(req.query.id || '').trim();
    if (!entityType || !entityId) return res.status(400).json({ error: 'Type et identifiant requis.' });
    const history = (await connect()).collection(HISTORY_COLLECTION);
    const rows = await history.find({ entityType, $or: [{ entityId }, { beforeId: entityId }, { afterId: entityId }] }).sort({ timestamp: -1 }).limit(50).toArray();
    res.json(rows.map(row => ({
      id: String(row._id), entityType: row.entityType, entityId: row.entityId, entityName: row.entityName,
      action: row.action, actor: row.actor, timestamp: row.timestamp,
      changes: historyDiff(row.beforeDocument, row.afterDocument),
      beforeExists: row.beforeDocument != null,
      afterExists: row.afterDocument != null,
      canRestore: Object.prototype.hasOwnProperty.call(row, 'beforeDocument'),
    })));
  } catch (err) {
    console.error('Chargement de l’historique impossible :', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/history/:historyId/restore', async (req, res) => {
  try {
    const db = await connect();
    const historyCol = db.collection(HISTORY_COLLECTION);
    const event = await historyCol.findOne({ _id: String(req.params.historyId) });
    if (!event) return res.status(404).json({ error: 'Entrée d’historique introuvable.' });
    if (!HISTORY_ALLOWED_COLLECTIONS.has(event.collectionName) || !Object.prototype.hasOwnProperty.call(event, 'beforeDocument')) {
      return res.status(400).json({ error: 'Cette modification ne peut pas être restaurée individuellement.' });
    }
    const collection = db.collection(event.collectionName);
    const beforeCurrent = event.afterId || event.entityId;
    const currentDoc = beforeCurrent ? await collection.findOne({ _id: beforeCurrent }) : null;
    const snapshot = event.beforeDocument;
    let restoredDoc = null;

    if (event.collectionName === 'item_catalog') {
      if (snapshot == null) {
        if (currentDoc) {
          const usage = await usageOfCatalogItem(String(currentDoc._id));
          if (usage.total > 0) {
            return res.status(409).json({ error: `Impossible d’annuler cette création : l’objet est encore utilisé (${usage.total} référence(s)). Supprime ou corrige d’abord ces références depuis le catalogue.`, usage });
          }
          await removeCatalogItem(String(currentDoc._id));
        }
      } else {
        const payload = snapshotCatalogPayload(snapshot);
        if (currentDoc) restoredDoc = await updateCatalogItem(String(currentDoc._id), payload);
        else restoredDoc = await addCatalogItem(payload);
        restoredDoc = await collection.findOne({ _id: String(restoredDoc?.id || payload.id) });
      }
    } else {
      if (snapshot == null) {
        if (currentDoc) await collection.deleteOne({ _id: currentDoc._id });
      } else {
        if (currentDoc && String(currentDoc._id) !== String(snapshot._id)) await collection.deleteOne({ _id: currentDoc._id });
        await collection.replaceOne({ _id: snapshot._id }, snapshot, { upsert: true });
        restoredDoc = snapshot;
      }
    }

    await recordEntityHistory(req, {
      entityType: event.entityType, collectionName: event.collectionName,
      beforeDocument: currentDoc || null, afterDocument: restoredDoc,
      action: 'restauration_individuelle', entityName: event.entityName,
    });
    await historyCol.updateOne({ _id: event._id }, { $set: { restoredAt: new Date(), restoredBy: req.session.user?.id || null } });
    await logAction({ ...req.session.user, action: 'historique_restaure', details: `A restauré une modification de ${event.entityName}.` });
    res.json({ ok: true, entityType: event.entityType, entityId: String(restoredDoc?._id || snapshot?._id || event.entityId) });
  } catch (err) {
    console.error('Restauration individuelle impossible :', err);
    res.status(500).json({ error: err.message });
  }
});

// Petit raccourci pour journaliser une action depuis une route : reprend
// automatiquement l'identité de la personne connectée (req.session.user).
function logFromReq(req, action, details) {
  logAction({ ...req.session.user, action, details }).catch((err) => console.error('logAction échoué :', err.message));
}


const HISTORY_COLLECTION = 'site_change_history';
const HISTORY_ALLOWED_COLLECTIONS = new Set(['profils', 'item_catalog', 'production_recipes', 'personnel_types', 'boutique_items', 'missions', 'inv', 'faction_ships']);

async function recordEntityHistory(req, { entityType, collectionName, beforeDocument, afterDocument, action, entityName }) {
  try {
    const history = (await connect()).collection(HISTORY_COLLECTION);
    const before = beforeDocument === undefined ? null : beforeDocument;
    const after = afterDocument === undefined ? null : afterDocument;
    const beforeId = before?._id != null ? String(before._id) : null;
    const afterId = after?._id != null ? String(after._id) : null;
    await history.insertOne({
      _id: `change_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`,
      entityType,
      collectionName,
      entityId: afterId || beforeId || '',
      beforeId,
      afterId,
      entityName: String(entityName || after?.name || before?.name || after?.nomPrenom || before?.nomPrenom || afterId || beforeId || 'Élément'),
      action,
      beforeDocument: before,
      afterDocument: after,
      actor: {
        discordId: req.session.user?.id || null,
        username: req.session.user?.username || 'Inconnu',
        avatar: req.session.user?.avatar || null,
      },
      timestamp: new Date(),
    });
  } catch (error) {
    // L’historique ne doit pas faire échouer l’opération principale.
    console.error('Enregistrement de l’historique impossible :', error?.message || error);
  }
}

function historyValue(value, key = '') {
  if (value === undefined) return '—';
  if (key.toLowerCase().includes('image')) return value ? 'Image présente' : 'Aucune image';
  if (value === null || value === '') return '—';
  if (value instanceof Date) return value.toLocaleString('fr-FR');
  if (typeof value === 'object') {
    const text = JSON.stringify(value);
    return text.length > 500 ? `${text.slice(0, 497)}…` : text;
  }
  const text = String(value);
  return text.length > 500 ? `${text.slice(0, 497)}…` : text;
}

function historyDiff(before, after) {
  const oldDoc = before && typeof before === 'object' ? before : {};
  const newDoc = after && typeof after === 'object' ? after : {};
  const keys = [...new Set([...Object.keys(oldDoc), ...Object.keys(newDoc)])]
    .filter(key => !['_id', 'createdAt', 'updatedAt', '__v'].includes(key));
  return keys.map(key => {
    const oldValue = historyValue(oldDoc[key], key);
    const newValue = historyValue(newDoc[key], key);
    return oldValue === newValue ? null : { field: key, before: oldValue, after: newValue };
  }).filter(Boolean).slice(0, 30);
}

function snapshotCatalogPayload(document) {
  if (!document) return null;
  const { _id, name, emoji, category, rarity, description, image, slot, usable, statBonus, useAction, weight, bagCapacity } = document;
  return { id: String(_id), name, emoji, category, rarity, description, image: image ?? null, slot: slot ?? null, usable: Boolean(usable), statBonus: statBonus || {}, useAction: useAction ?? null, weight: Number(weight) || 0, bagCapacity: Number(bagCapacity) || 0 };
}

async function usageOfCatalogItems(itemIds) {
  const ids = [...new Set((itemIds || []).map(value => String(value || '')).filter(Boolean))];
  const result = new Map(ids.map(id => [id, { inventories: [], productions: [], boutique: null, itemUseActions: [], total: 0 }]));
  if (!ids.length) return result;
  const idSet = new Set(ids);
  const [inventories, profiles, productions, shopDocs, itemUseActions] = await Promise.all([
    (await getInvCollection()).find({}, { projection: { _id: 1, items: 1, equipement: 1 } }).toArray(),
    listAllProfiles(),
    (await getProductionRecipesCollection()).find({ $or: [{ requirements: { $elemMatch: { itemId: { $in: ids } } } }, { outputs: { $elemMatch: { itemId: { $in: ids } } } }] }, { projection: { _id: 1, name: 1, requirements: 1, outputs: 1, enabled: 1 } }).toArray(),
    (await getBoutiqueItemsCollection()).find({ _id: { $in: ids } }, { projection: { _id: 1, enabled: 1, type: 1, stock: 1 } }).toArray(),
    (await getItemCatalogCollection()).find({ 'useAction.itemId': { $in: ids } }, { projection: { _id: 1, name: 1, 'useAction.itemId': 1 } }).toArray(),
  ]);
  const profileMap = new Map(profiles.map(profile => [String(profile._id), profile]));
  for (const inventory of inventories) {
    const equippedById = new Map();
    for (const [slot, itemId] of Object.entries(inventory.equipement || {})) {
      const id = String(itemId || '');
      if (idSet.has(id)) equippedById.set(id, [...(equippedById.get(id) || []), slot]);
    }
    const heldIds = new Set();
    for (const [rawId, rawQuantity] of Object.entries(inventory.items || {})) {
      const id = String(rawId);
      const quantity = Number(rawQuantity) || 0;
      if (!idSet.has(id) || (!quantity && !equippedById.has(id))) continue;
      const profile = profileMap.get(String(inventory._id));
      result.get(id).inventories.push({ profileId: String(inventory._id), profileName: profile?.nomPrenom || String(inventory._id), quantity, equipmentSlots: equippedById.get(id) || [] });
      heldIds.add(id);
    }
    for (const [id, equipmentSlots] of equippedById.entries()) {
      if (heldIds.has(id)) continue;
      const profile = profileMap.get(String(inventory._id));
      result.get(id).inventories.push({ profileId: String(inventory._id), profileName: profile?.nomPrenom || String(inventory._id), quantity: 0, equipmentSlots });
    }
  }
  const appendRecipeUsage = (rows, targetKey) => {
    for (const row of rows) {
      const referenced = new Set([...(row.requirements || []), ...(row.outputs || [])].map(item => String(item.itemId || '')).filter(id => idSet.has(id)));
      for (const id of referenced) result.get(id)[targetKey].push({ id: String(row._id), name: row.name || String(row._id), enabled: row.enabled !== false });
    }
  };
  appendRecipeUsage(productions, 'productions');
  for (const doc of shopDocs) result.get(String(doc._id)).boutique = { id: String(doc._id), stock: Number(doc.stock) || 0, enabled: doc.enabled !== false };
  for (const doc of itemUseActions) {
    const id = String(doc.useAction?.itemId || '');
    if (result.has(id)) result.get(id).itemUseActions.push({ id: String(doc._id), name: doc.name || String(doc._id) });
  }
  for (const usage of result.values()) usage.total = usage.inventories.length + usage.productions.length + (usage.boutique ? 1 : 0) + usage.itemUseActions.length;
  return result;
}

async function usageOfCatalogItem(itemId) {
  const result = await usageOfCatalogItems([String(itemId || '')]);
  return result.get(String(itemId || '')) || { inventories: [], productions: [], boutique: null, itemUseActions: [], total: 0 };
}

async function repairCatalogItemReferences(itemId) {
  const id = String(itemId || '');
  const now = new Date();
  const invCol = await getInvCollection();
  await invCol.updateMany({ [`items.${id}`]: { $exists: true } }, { $unset: { [`items.${id}`]: '' }, $set: { updatedAt: now } });
  for (const slot of EQUIPMENT_SLOTS) {
    await invCol.updateMany({ [`equipement.${slot}`]: id }, { $unset: { [`equipement.${slot}`]: '' }, $set: { updatedAt: now } });
  }

  const recipeCollections = [await getProductionRecipesCollection()];
  for (const col of recipeCollections) {
    const docs = await col.find({ $or: [{ requirements: { $elemMatch: { itemId: id } } }, { outputs: { $elemMatch: { itemId: id } } }] }).toArray();
    for (const doc of docs) {
      const requirements = (Array.isArray(doc.requirements) ? doc.requirements : []).filter(row => String(row.itemId) !== id);
      const outputs = (Array.isArray(doc.outputs) ? doc.outputs : []).filter(row => String(row.itemId) !== id);
      const update = { requirements, outputs, updatedAt: now };
      if (!requirements.length || !outputs.length) update.enabled = false;
      await col.updateOne({ _id: doc._id }, { $set: update });
    }
  }
  await (await getItemCatalogCollection()).updateMany({ 'useAction.itemId': id }, { $set: { useAction: null, updatedAt: now } });
  const shop = await getBoutiqueItemsCollection();
  const shopResult = await shop.deleteOne({ _id: id });
  if (shopResult.deletedCount) await (await getBoutiqueStateCollection()).updateOne({ _id: 'meta' }, { $inc: { version: 1 }, $setOnInsert: { categoryThreads: {} } }, { upsert: true });
}


// ---------------------------------------------------------------------------
// PANEL ADMIN (créateur uniquement) : qui se connecte, combien de fois, et
// journal de toutes les actions faites sur le site.
// ---------------------------------------------------------------------------
app.use('/api/admin', async (req, res, next) => {
  if (await canAccessAdmin(req)) return next();
  return res.status(403).json({ error: 'Accès réservé aux rôles autorisés du serveur.' });
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

app.get('/api/admin/backups', async (req, res) => {
  try {
    res.json(await listBackups());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/backups', async (req, res) => {
  try {
    const backup = await createBackup(req.session.user);
    const details = `A créé une sauvegarde complète des données applicatives (${Object.entries(backup.collections).map(([name, count]) => `${name}: ${count}`).join(', ')}).`;
    await logAction({
      ...req.session.user,
      action: 'backup_created',
      details,
      metadata: { backupId: backup.snapshotId },
    });
    res.json({ ok: true, backup });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/backups/:backupId/restore', async (req, res) => {
  try {
    const backupId = String(req.params.backupId || '');
    if (!/^backup_[A-Za-z0-9_-]+$/.test(backupId)) return res.status(400).json({ error: 'Identifiant de sauvegarde invalide.' });
    const result = await restoreBackup(backupId, { ...req.session.user, preserveSnapshotIds: [backupId] });
    await logAction({
      ...req.session.user,
      action: 'backup_restored',
      details: `A restauré la sauvegarde ${backupId}. Une sauvegarde de sécurité a été créée automatiquement.`,
      metadata: { backupId, safetyBackupId: result.safetyBackupId },
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/backups/:backupId', async (req, res) => {
  try {
    const backupId = String(req.params.backupId || '');
    const result = await deleteBackup(backupId);
    await logAction({
      ...req.session.user,
      action: 'backup_deleted',
      details: `A supprimé la sauvegarde ${backupId}.`,
      metadata: { backupId },
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GESTION DES DONNÉES MONGO (créateur uniquement, protégée par /api/admin).
// Cette page ne propose que les collections opérationnelles explicitement
// autorisées : aucune collection système/session/log/backups n'est exposée.
// ---------------------------------------------------------------------------
const DATA_MANAGER_TYPES = new Set([
  'reservations', 'profils', 'personnel', 'productions', 'tickets', 'rumeurs',
]);

const DATA_MANAGER_LABELS = {
  reservations: 'Réservations',
  profils: 'Profils RP',
  personnel: 'Personnel acheté',
  productions: 'Productions en cours',
  tickets: 'Autres tickets',
  rumeurs: 'Rumeurs',
};

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

    const memberRoleIds = Array.isArray(member.roles) ? member.roles.map(String) : [];
    const canPlayer = memberRoleIds.includes(PLAYER_WHITELIST_ROLE_ID) || memberRoleIds.includes(PLAYER_MEMBER_ROLE_ID);
    const canStaff = memberRoleIds.includes(String(config.STAFF_ROLE_ID))
      || (config.ADMIN_ROLE_IDS || []).map(String).some(id => memberRoleIds.includes(id))
      || String(me.id) === String(config.SUPER_ADMIN_ID);
    if (!canPlayer && !canStaff) {
      return res.redirect('/?auth_error=' + encodeURIComponent("Ton compte n'a pas de rôle autorisé pour accéder au portail joueur ou au Staff."));
    }

    const sessionUser = {
      id: me.id,
      username: me.global_name || me.username,
      avatar: me.avatar ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=64` : null,
    };
    // Nouvel identifiant de session à la connexion (anti « session fixation »).
    await new Promise((resolve, reject) => req.session.regenerate(err => (err ? reject(err) : resolve())));
    req.session.user = sessionUser;
    req.session.roles = memberRoleIds;
    await new Promise((resolve, reject) => req.session.save(err => (err ? reject(err) : resolve())));

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


app.get('/api/possessions/all', async (req, res) => {
  try { res.set('Cache-Control', 'no-store'); res.json(await possessionStore.listPossessions()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/possessions', async (req, res) => {
  try {
    const ownerType = String(req.query.ownerType || '');
    const ownerId = String(req.query.ownerId || '');
    if (!['profile', 'faction'].includes(ownerType) || !ownerId) return res.status(400).json({ error: 'Propriétaire requis.' });
    if (ownerType === 'profile' && !await getProfile(ownerId)) return res.status(404).json({ error: 'Profil introuvable.' });
    res.json(await possessionStore.listPossessions(ownerType, ownerId));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/possessions', async (req, res) => {
  try {
    const doc = await possessionStore.createPossession(req.body?.ownerType, req.body?.ownerId, req.body || {});
    logFromReq(req, 'possession_creee', `A créé la possession « ${doc.name} » (${doc.ownerType}).`);
    res.status(201).json(doc);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.patch('/api/possessions/:id', async (req, res) => {
  try {
    const doc = await possessionStore.updatePossession(req.params.id, req.body || {});
    logFromReq(req, 'possession_modifiee', `A modifié la possession « ${doc.name} ».`);
    res.json(doc);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/possessions/:id', async (req, res) => {
  try {
    const before = await possessionStore.getPossession(req.params.id);
    if (!before) return res.status(404).json({ error: 'Possession introuvable.' });
    await possessionStore.deletePossession(req.params.id);
    logFromReq(req, 'possession_supprimee', `A supprimé la possession « ${before.name} ».`);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.get('/api/profils/:id/possessions', async (req, res) => {
  try {
    const profile = await getProfile(req.params.id);
    if (!profile) return res.status(404).json({ error: 'Profil introuvable.' });
    res.json(await possessionStore.listPossessions('profile', String(profile._id)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/profils/:id/possessions', async (req, res) => {
  try {
    const profile = await getProfile(req.params.id);
    if (!profile) return res.status(404).json({ error: 'Profil introuvable.' });
    const doc = await possessionStore.createPossession('profile', String(profile._id), req.body || {});
    res.status(201).json(doc);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

function estIndisponibiliteMongo(err) {
  const name = String(err?.name || '');
  const code = String(err?.code || '');
  return /Mongo(ServerSelection|Network|NotConnected|TopologyClosed|PoolCleared)/i.test(name)
    || ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'].includes(code);
}

app.get('/api/profils', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await listAllProfiles());
  } catch (err) {
    console.error('Chargement des profils impossible :', err);
    res.status(estIndisponibiliteMongo(err) ? 503 : 500).json({
      error: estIndisponibiliteMongo(err)
        ? 'La base MongoDB est temporairement indisponible. Vérifie la connexion MONGO_URI et les journaux du serveur.'
        : (err.message || 'Erreur lors du chargement des profils.'),
    });
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

    // Prime de personnage. On conserve les champs internes de synchronisation
    // Discord afin de mettre à jour le fil du forum existant au lieu d'en créer un nouveau.
    if (b.prime && typeof b.prime === 'object' && !Array.isArray(b.prime)) {
      const oldPrime = profile.prime && typeof profile.prime === 'object' ? profile.prime : {};
      const amount = Math.max(0, Math.floor(Number(b.prime.amount) || 0));
      fields.prime = {
        ...oldPrime,
        active: Boolean(b.prime.active) && amount > 0,
        amount,
        description: String(b.prime.description || '').trim().slice(0, 1000),
        updatedAt: new Date(),
      };
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
    await recordEntityHistory(req, { entityType: 'profil', collectionName: 'profils', beforeDocument: profile, afterDocument: updated, action: 'modifie', entityName: updated?.nomPrenom || profile.nomPrenom || req.params.id });
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
app.get('/api/lists', async (req, res) => {
  try {
    await factionStore.loadFactionDefs();
    const dynamicRelations = factionStore.listFactionDefs().map(f => ({ key: f.key, label: f.label }));
    res.set('Cache-Control', 'no-store');
    res.json({
      factions: getFactions(),
      relationFactions: dynamicRelations,
      relationLevels: config.RELATION_LEVELS,
      defaultStats: DEFAULT_STATS,
      statMax: STAT_MAX,
      equipmentSlots: EQUIPMENT_SLOTS.map(id => ({ id, label: EQUIPMENT_SLOT_LABELS[id] || id })),
      itemRarities: ITEM_RARITIES,
    });
  } catch (err) {
    // Express 4 ne récupère pas automatiquement les rejets des routes async.
    // Sans ce try/catch, une panne MongoDB sur /api/lists peut faire tomber tout Node.
    console.error('Chargement des listes de référence impossible :', err);
    const indisponible = estIndisponibiliteMongo(err);
    res.status(indisponible ? 503 : 500).json({
      error: indisponible
        ? 'La base MongoDB est temporairement indisponible. Vérifie MONGO_URI et les journaux du serveur.'
        : (err.message || 'Erreur lors du chargement des listes.'),
    });
  }
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
// BONUS / MALUS — définitions configurables du système de création du personnage.
// ---------------------------------------------------------------------------
async function ensureCharacterTraitsSeeded() {
  const col = await getCharacterTraitsCollection();
  const markerId = '__character_traits_seeded__';
  const alreadySeeded = await col.findOne({ _id: markerId }, { projection: { _id: 1 } });
  if (!alreadySeeded) {
    const now = new Date();
    await col.bulkWrite(DEFAULT_CHARACTER_TRAITS.map(t => ({ updateOne: { filter: { _id: t._id }, update: { $setOnInsert: { ...t, createdAt: now, updatedAt: now } }, upsert: true } })), { ordered: false });
    await col.updateOne({ _id: markerId }, { $setOnInsert: { seededAt: new Date(), internal: true } }, { upsert: true });
  }

  // Met à niveau l'ancien trait dette sans écraser ses autres effets.
  const huttDebt = await col.findOne({ _id: 'dette-d-hutt' });
  const effects = huttDebt?.effects || {};
  const debt = (Array.isArray(effects.debts) ? effects.debts : []).find(row => /hutt/i.test(String(row.creditor || '')) && Number(row.amount) > 0);
  const relations = Array.isArray(effects.relations) ? effects.relations : [];
  const debtPenaltyAlreadySet = relations.some(row => row.factionKey === 'CARTEL_HUTTS' && row.mode !== 'set' && Number(row.value) < 0);
  if (huttDebt && debt && !debtPenaltyAlreadySet) {
    const previousCredits = Number(effects.credits?.amount) || 0;
    const debtAmount = Math.floor(Number(debt.amount));
    const creditAmount = previousCredits === -debtAmount ? previousCredits : previousCredits - debtAmount;
    const update = {
      'effects.credits': { amount: creditAmount },
      'effects.relations': [...relations, { factionKey: 'CARTEL_HUTTS', mode: 'add', value: -1 }],
      updatedAt: new Date(),
    };
    const legacyDescriptions = [
      'Le personnage doit 2 000 crédits au Cartel des Hutts.',
      'Dette de 2 000 crédits auprès du Cartel des Hutts.',
    ];
    if (legacyDescriptions.includes(String(huttDebt.description || ''))) {
      update.description = 'Le personnage doit 2 000 crédits au Cartel des Hutts et sa relation avec lui baisse.';
    }
    await col.updateOne({ _id: 'dette-d-hutt' }, { $set: update });
  }
}

function normalizeCharacterTrait(body, idFromRoute = null) {
  const b = body || {};
  const name = String(b.name || '').trim();
  if (!name) throw new Error('Le nom du trait est obligatoire.');
  const points = Math.round(Number(b.points));
  if (!Number.isFinite(points) || points === 0 || Math.abs(points) > 100) throw new Error('Les points doivent être un entier entre -100 et 100, différent de 0.');
  if (!b.effects || typeof b.effects !== 'object' || Array.isArray(b.effects)) throw new Error('Les effets doivent être un objet JSON valide.');
  return {
    name: name.slice(0, 100),
    description: String(b.description || '').trim().slice(0, 1000),
    points,
    effects: b.effects,
    enabled: b.enabled !== false,
    updatedAt: new Date(),
  };
}

app.get('/api/traits', async (req, res) => {
  try {
    await ensureCharacterTraitsSeeded();
    const traits = await (await getCharacterTraitsCollection()).find({ _id: { $ne: '__character_traits_seeded__' } }).sort({ points: -1, name: 1 }).toArray();
    res.set('Cache-Control', 'no-store');
    res.json(traits);
  } catch (err) {
    console.error('Chargement des bonus/malus impossible :', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/traits', async (req, res) => {
  try {
    const col = await getCharacterTraitsCollection();
    const requested = String(req.body?.id || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    const id = requested || `trait_${crypto.randomBytes(8).toString('hex')}`;
    if (!/^[a-z0-9_-]{1,80}$/.test(id) || id.startsWith('__')) return res.status(400).json({ error: 'Identifiant de trait invalide.' });
    const trait = normalizeCharacterTrait(req.body);
    const existing = await col.findOne({ _id: id });
    if (existing) return res.status(409).json({ error: `Un trait avec l'identifiant « ${id} » existe déjà.` });
    const document = { _id: id, ...trait, createdAt: new Date() };
    await col.insertOne(document);
    logFromReq(req, 'trait_cree', `A créé le bonus/malus « ${document.name} » (${document.points} points).`);
    res.status(201).json(document);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/traits/:id', async (req, res) => {
  try {
    const col = await getCharacterTraitsCollection();
    const trait = normalizeCharacterTrait(req.body, req.params.id);
    const result = await col.findOneAndUpdate({ _id: req.params.id }, { $set: trait }, { returnDocument: 'after' });
    if (!result) return res.status(404).json({ error: 'Trait introuvable.' });
    logFromReq(req, 'trait_modifie', `A modifié le bonus/malus « ${result.name} » (${result.points} points).`);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/traits/:id', async (req, res) => {
  try {
    const col = await getCharacterTraitsCollection();
    const trait = await col.findOne({ _id: req.params.id });
    if (!trait) return res.status(404).json({ error: 'Trait introuvable.' });
    await col.deleteOne({ _id: req.params.id });
    logFromReq(req, 'trait_supprime', `A supprimé le bonus/malus « ${trait.name} ».`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// PRODUCTION & PERSONNEL — définitions partagées avec le bot Discord.
// Chaque recette et chaque métier possède une durée configurable. Le personnel
// a un coût de recrutement, des consommables journaliers et une activité facultative.
// ---------------------------------------------------------------------------
async function normaliserListeProduction(values, fieldName, obligatoire = true) {
  if (!Array.isArray(values)) throw new Error(`${fieldName} doit être une liste d'objets.`);
  const merged = new Map();
  for (const entry of values) {
    const itemId = String(entry?.itemId || '').trim();
    const quantity = Math.floor(Number(entry?.quantity));
    if (!itemId || !/^[A-Za-z0-9_-]+$/.test(itemId)) throw new Error(`Identifiant d'objet invalide dans « ${fieldName} ».`);
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 1000000) throw new Error(`Chaque quantité de « ${fieldName} » doit être comprise entre 1 et 1 000 000.`);
    merged.set(itemId, (merged.get(itemId) || 0) + quantity);
  }
  const rows = [...merged.entries()].map(([itemId, quantity]) => ({ itemId, quantity }));
  if (obligatoire && !rows.length) throw new Error(`Ajoute au moins un objet dans « ${fieldName} ».`);
  const known = await getExistingCatalogIds(rows.map(row => row.itemId));
  for (const row of rows) if (!known.has(row.itemId)) throw new Error(`L'objet « ${row.itemId} » n'existe pas dans le catalogue.`);
  return rows;
}

function texteDefinitionProduction(body, fallbackEmoji) {
  const b = body || {};
  const name = String(b.name || '').trim();
  if (!name) throw new Error('Le nom est obligatoire.');
  return {
    name: name.slice(0, 100),
    emoji: String(b.emoji || fallbackEmoji).trim().slice(0, 8) || fallbackEmoji,
    description: String(b.description || '').trim().slice(0, 1500),
    enabled: b.enabled !== false,
    updatedAt: new Date(),
  };
}

function normaliserDuree(value, label, fallback = 30) {
  const minutes = Math.floor(Number(value));
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 525600) {
    if (value === undefined || value === null || value === '') return fallback;
    throw new Error(`${label} doit être comprise entre 1 minute et 365 jours.`);
  }
  return minutes;
}

async function normaliserProduction(body) {
  const base = texteDefinitionProduction(body, '🏭');
  const requirements = await normaliserListeProduction(body?.requirements, 'Objets nécessaires');
  const outputs = await normaliserListeProduction(body?.outputs, 'Objets produits');
  const minutesPerUnit = normaliserDuree(body?.minutesPerUnit, 'La durée par unité');
  const requiredPossessionId = String(body?.requiredPossessionId || '').trim() || null;
  if (requiredPossessionId && !await possessionStore.getPossession(requiredPossessionId)) throw new Error('La possession requise est introuvable.');
  return { ...base, requirements, outputs, minutesPerUnit, requiredPossessionId };
}

async function normaliserPersonnelType(body) {
  const base = texteDefinitionProduction(body, '👷');
  const purchaseCost = await normaliserListeProduction(body?.purchaseCost || [], 'Coût de recrutement', false);
  const requirements = await normaliserListeProduction(body?.requirements || [], 'Ingrédients par cycle', false);
  const outputs = await normaliserListeProduction(body?.outputs || [], 'Objets produits par cycle', false);
  const dailyUpkeep = await normaliserListeProduction(body?.dailyUpkeep, 'Consommation quotidienne');
  const minutesPerCycle = normaliserDuree(body?.minutesPerCycle, 'La durée du cycle');
  const productionRecipeId = String(body?.productionRecipeId || '').trim() || null;
  const requiredPossessionId = String(body?.requiredPossessionId || '').trim() || null;
  if (requiredPossessionId && !await possessionStore.getPossession(requiredPossessionId)) throw new Error('La possession requise est introuvable.');
  if (productionRecipeId) {
    const production = await (await getProductionRecipesCollection()).findOne({ _id: productionRecipeId });
    if (!production || production.enabled === false) {
      throw new Error('La production associée est introuvable ou désactivée. Choisis une production disponible.');
    }
  }
  if (outputs.length && !requirements.length) {
    // Les activités peuvent produire sans consommable de cycle ; les besoins
    // quotidiens restent configurés séparément dans dailyUpkeep.
  }
  return { ...base, purchaseCost, requirements, outputs, dailyUpkeep, minutesPerCycle, productionRecipeId, requiredPossessionId };
}

app.get('/api/productions', async (req, res) => {
  try {
    const col = await getProductionRecipesCollection();
    res.json(await col.find({}).sort({ name: 1 }).toArray());
  } catch (err) {
    console.error('Chargement des productions impossible :', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/productions', async (req, res) => {
  try {
    const col = await getProductionRecipesCollection();
    const definition = await normaliserProduction(req.body);
    const document = { _id: `production_${crypto.randomBytes(10).toString('hex')}`, ...definition, createdAt: new Date() };
    await col.insertOne(document);
    await recordEntityHistory(req, { entityType: 'production', collectionName: 'production_recipes', beforeDocument: null, afterDocument: document, action: 'cree', entityName: document.name });
    logFromReq(req, 'production_creee', `A créé la production « ${document.name} ».`)
    res.status(201).json(document);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/productions/:id', async (req, res) => {
  try {
    const col = await getProductionRecipesCollection();
    const before = await col.findOne({ _id: req.params.id });
    if (!before) return res.status(404).json({ error: 'Production introuvable.' });
    const definition = await normaliserProduction(req.body);
    const result = await col.findOneAndUpdate({ _id: req.params.id }, { $set: definition }, { returnDocument: 'after' });
    if (!result) return res.status(404).json({ error: 'Production introuvable.' });
    await recordEntityHistory(req, { entityType: 'production', collectionName: 'production_recipes', beforeDocument: before, afterDocument: result, action: 'modifie', entityName: result.name });
    logFromReq(req, 'production_modifiee', `A modifié la production « ${result.name} ».`)
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/productions/:id', async (req, res) => {
  try {
    const col = await getProductionRecipesCollection();
    const item = await col.findOne({ _id: req.params.id });
    if (!item) return res.status(404).json({ error: 'Production introuvable.' });
    await col.deleteOne({ _id: req.params.id });
    await recordEntityHistory(req, { entityType: 'production', collectionName: 'production_recipes', beforeDocument: item, afterDocument: null, action: 'supprime', entityName: item.name });
    // Retire aussi l'association depuis les types de personnel ; un métier qui
    // pointait vers une recette supprimée redevient un métier général.
    await (await getPersonnelTypesCollection()).updateMany(
      { productionRecipeId: req.params.id },
      { $set: { productionRecipeId: null, updatedAt: new Date() } },
    );
    logFromReq(req, 'production_supprimee', `A supprimé la production « ${item.name} ».`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/personnel-types', async (req, res) => {
  try {
    const col = await getPersonnelTypesCollection();
    res.json(await col.find({}).sort({ name: 1 }).toArray());
  } catch (err) {
    console.error('Chargement du personnel impossible :', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/personnel-types', async (req, res) => {
  try {
    const col = await getPersonnelTypesCollection();
    const definition = await normaliserPersonnelType(req.body);
    const document = { _id: `personnel_type_${crypto.randomBytes(10).toString('hex')}`, ...definition, createdAt: new Date() };
    await col.insertOne(document);
    await recordEntityHistory(req, { entityType: 'personnel', collectionName: 'personnel_types', beforeDocument: null, afterDocument: document, action: 'cree', entityName: document.name });
    logFromReq(req, 'personnel_type_cree', `A créé le type de personnel « ${document.name} ».`)
    res.status(201).json(document);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/personnel-types/:id', async (req, res) => {
  try {
    const col = await getPersonnelTypesCollection();
    const before = await col.findOne({ _id: req.params.id });
    if (!before) return res.status(404).json({ error: 'Type de personnel introuvable.' });
    const definition = await normaliserPersonnelType(req.body);
    const result = await col.findOneAndUpdate({ _id: req.params.id }, { $set: definition }, { returnDocument: 'after' });
    if (!result) return res.status(404).json({ error: 'Type de personnel introuvable.' });
    await recordEntityHistory(req, { entityType: 'personnel', collectionName: 'personnel_types', beforeDocument: before, afterDocument: result, action: 'modifie', entityName: result.name });
    logFromReq(req, 'personnel_type_modifie', `A modifié le type de personnel « ${result.name} ».`)
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/personnel-types/:id', async (req, res) => {
  try {
    const col = await getPersonnelTypesCollection();
    const item = await col.findOne({ _id: req.params.id });
    if (!item) return res.status(404).json({ error: 'Type de personnel introuvable.' });
    await col.deleteOne({ _id: req.params.id });
    await recordEntityHistory(req, { entityType: 'personnel', collectionName: 'personnel_types', beforeDocument: item, afterDocument: null, action: 'supprime', entityName: item.name });
    logFromReq(req, 'personnel_type_supprime', `A supprimé le type de personnel « ${item.name} ».`)
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// INVENTAIRE catalogue d'objets + inventaires par personnage
// ---------------------------------------------------------------------------

// Métadonnées du catalogue pour les pages de listes : les images base64 sont
// servies à part afin d'éviter de transférer plusieurs mégaoctets à chaque page.
app.get('/api/inventaire/catalogue/meta', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await getCatalogMetadata());
  } catch (err) {
    console.error('Chargement des métadonnées du catalogue impossible :', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/inventaire/catalogue/usage', async (req, res) => {
  try {
    const docs = await (await getItemCatalogCollection()).find({ _id: { $not: /^__/ } }, { projection: { _id: 1, name: 1 } }).toArray();
    const usages = await usageOfCatalogItems(docs.map(doc => String(doc._id)));
    const items = docs.map(doc => ({ id: String(doc._id), name: doc.name || String(doc._id), ...(usages.get(String(doc._id)) || { total: 0 }) }));
    res.set('Cache-Control', 'no-store');
    res.json({ items });
  } catch (err) {
    console.error('Chargement des références du catalogue impossible :', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/inventaire/catalogue/:itemId/usage', async (req, res) => {
  try {
    const itemId = String(req.params.itemId || '');
    const raw = await (await getItemCatalogCollection()).findOne({ _id: itemId }, { projection: { _id: 1 } });
    if (!raw) return res.status(404).json({ error: 'Objet introuvable.' });
    res.set('Cache-Control', 'no-store');
    res.json(await usageOfCatalogItem(itemId));
  } catch (err) {
    console.error('Vérification des références de l’objet impossible :', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/inventaire/catalogue/:itemId/image', async (req, res) => {
  try {
    const image = await getCatalogImageData(req.params.itemId);
    if (!image) return res.sendStatus(404);
    res.set('Content-Type', image.contentType);
    res.set('Cache-Control', 'private, max-age=60');
    res.set('X-Content-Type-Options', 'nosniff');
    return res.send(image.data);
  } catch (err) {
    console.error('Chargement de l’image du catalogue impossible :', err);
    return res.sendStatus(500);
  }
});

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
    const { id, name, emoji, category, rarity, description, image, slot, usable, statBonus, useAction, weight, bagCapacity } = req.body || {};
    const created = await addCatalogItem({ id, name, emoji, category, rarity, description, image, slot, usable, statBonus, useAction, weight, bagCapacity });
    const after = await (await getItemCatalogCollection()).findOne({ _id: created.id });
    await recordEntityHistory(req, { entityType: 'catalogue', collectionName: 'item_catalog', beforeDocument: null, afterDocument: after, action: 'cree', entityName: created.name });
    logFromReq(req, 'objet_cree', `A ajouté l'objet "${name}" au catalogue.`);
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/inventaire/catalogue/bulk', async (req, res) => {
  try {
    const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(value => String(value || '').trim()).filter(id => id && /^[A-Za-z0-9_-]+$/.test(id)))];
    const fields = req.body?.fields || {};
    if (!ids.length || ids.length > 500) return res.status(400).json({ error: 'Sélectionne entre 1 et 500 objets.' });
    const allowedFields = ['rarity', 'category', 'usable'];
    const changes = {};
    if (fields.rarity !== undefined) {
      if (!ITEM_RARITIES.includes(String(fields.rarity))) return res.status(400).json({ error: 'Rareté invalide.' });
      changes.rarity = String(fields.rarity);
    }
    if (fields.category !== undefined) changes.category = String(fields.category || 'Divers').trim().slice(0, 100) || 'Divers';
    if (fields.usable !== undefined) changes.usable = Boolean(fields.usable);
    if (!Object.keys(changes).length || Object.keys(changes).some(key => !allowedFields.includes(key))) return res.status(400).json({ error: 'Choisis au moins un champ à modifier.' });
    const col = await getItemCatalogCollection();
    if (changes.usable === false) {
      const equippedItems = await col.find({ _id: { $in: ids }, slot: { $nin: [null, ''] } }, { projection: { _id: 1, name: 1 } }).toArray();
      if (equippedItems.length) {
        return res.status(400).json({ error: `Les objets équipables doivent rester utilisables : ${equippedItems.slice(0, 5).map(item => item.name || item._id).join(', ')}${equippedItems.length > 5 ? ', …' : ''}.` });
      }
    }
    const results = [];
    for (const id of ids) {
      const before = await col.findOne({ _id: id });
      if (!before || String(id).startsWith('__')) continue;
      const updated = await updateCatalogItem(id, changes);
      const after = await col.findOne({ _id: updated.id });
      await recordEntityHistory(req, { entityType: 'catalogue', collectionName: 'item_catalog', beforeDocument: before, afterDocument: after, action: 'modification_masse', entityName: after?.name || id });
      results.push(String(updated.id));
    }
    logFromReq(req, 'objets_modifies_masse', `A modifié ${results.length} objet(s) en masse dans le catalogue.`);
    res.json({ ok: true, updated: results.length, ids: results });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/inventaire/catalogue/bulk', async (req, res) => {
  try {
    const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(value => String(value || '').trim()).filter(id => id && /^[A-Za-z0-9_-]+$/.test(id) && !id.startsWith('__')))];
    if (!ids.length || ids.length > 500) return res.status(400).json({ error: 'Sélectionne entre 1 et 500 objets.' });
    const col = await getItemCatalogCollection();
    const beforeDocs = await col.find({ _id: { $in: ids } }).toArray();
    if (!beforeDocs.length) return res.status(404).json({ error: 'Aucun objet trouvé dans la sélection.' });
    const usages = await usageOfCatalogItems(beforeDocs.map(doc => String(doc._id)));
    const usageById = beforeDocs.map(doc => ({ id: String(doc._id), name: doc.name || String(doc._id), usage: usages.get(String(doc._id)) }));
    const hasReferences = usageById.some(entry => entry.usage.total > 0);
    if (hasReferences && req.body?.repairReferences !== true) {
      return res.status(409).json({ error: 'Certains objets sont encore utilisés. Confirme le nettoyage des références avant suppression.', usage: usageById });
    }
    for (const doc of beforeDocs) {
      const id = String(doc._id);
      if (req.body?.repairReferences === true && (usages.get(id)?.total || 0) > 0) await repairCatalogItemReferences(id);
      await removeCatalogItem(id);
      await recordEntityHistory(req, { entityType: 'catalogue', collectionName: 'item_catalog', beforeDocument: doc, afterDocument: null, action: 'supprime_en_masse', entityName: doc.name || id });
    }
    logFromReq(req, 'objets_supprimes_masse', `A supprimé ${beforeDocs.length} objet(s) du catalogue${hasReferences ? ' après nettoyage des références' : ''}.`);
    res.json({ ok: true, deleted: beforeDocs.length, referencesCleaned: hasReferences });
  } catch (err) {
    console.error('Suppression en masse impossible :', err);
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/inventaire/catalogue/:itemId', async (req, res) => {
  try {
    const { id, name, emoji, category, rarity, description, image, slot, usable, statBonus, useAction, weight, bagCapacity } = req.body || {};
    const rawCol = await getItemCatalogCollection();
    const before = await rawCol.findOne({ _id: req.params.itemId });
    if (!before) return res.status(404).json({ error: 'Objet introuvable.' });
    const updated = await updateCatalogItem(req.params.itemId, { id, name, emoji, category, rarity, description, image, slot, usable, statBonus, useAction, weight, bagCapacity });
    const after = await rawCol.findOne({ _id: updated.id });
    await recordEntityHistory(req, { entityType: 'catalogue', collectionName: 'item_catalog', beforeDocument: before, afterDocument: after, action: 'modifie', entityName: updated.name });
    const imageInfo = image === undefined ? '' : (image ? ' (image modifiée)' : ' (image retirée)');
    logFromReq(req, 'objet_modifie', `A modifié l'objet "${name || req.params.itemId}" du catalogue${imageInfo}.`);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/inventaire/catalogue', async (req, res) => {
  if (req.session.user?.id !== FOUNDER_DISCORD_ID) return res.status(403).json({ error: 'Action réservée au fondateur.' });
  try {
    const col = await getItemCatalogCollection();
    const docs = await col.find({ _id: { $not: /^__/ } }).toArray();
    const usageMap = await usageOfCatalogItems(docs.map(doc => String(doc._id)));
    const uses = docs.map(doc => ({ id: String(doc._id), name: doc.name || String(doc._id), usage: usageMap.get(String(doc._id)) })).filter(entry => entry.usage?.total > 0);
    if (uses.length && req.body?.repairReferences !== true) {
      return res.status(409).json({ error: 'Des objets sont encore utilisés. Confirme le nettoyage des références avant de vider le catalogue.', usage: uses.slice(0, 100), affectedObjects: uses.length });
    }
    for (const doc of docs) {
      if (req.body?.repairReferences === true && (usageMap.get(String(doc._id))?.total || 0) > 0) await repairCatalogItemReferences(String(doc._id));
      await recordEntityHistory(req, { entityType: 'catalogue', collectionName: 'item_catalog', beforeDocument: doc, afterDocument: null, action: 'catalogue_vide', entityName: doc.name || String(doc._id) });
    }
    const nb = await clearCatalog();
    logFromReq(req, 'catalogue_vide', `A vidé tout le catalogue (${nb} objet${nb > 1 ? 's' : ''} supprimé${nb > 1 ? 's' : ''}).`);
    res.json({ ok: true, deleted: nb, referencesCleaned: uses.length > 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/inventaire/catalogue/:itemId', async (req, res) => {
  try {
    const id = String(req.params.itemId || '');
    const col = await getItemCatalogCollection();
    const before = await col.findOne({ _id: id });
    if (!before || id.startsWith('__')) return res.status(404).json({ error: 'Objet introuvable.' });
    const usage = await usageOfCatalogItem(id);
    if (usage.total > 0 && req.body?.repairReferences !== true) {
      return res.status(409).json({ error: 'Cet objet est encore utilisé. Consulte les références puis confirme leur nettoyage.', usage });
    }
    if (req.body?.repairReferences === true) await repairCatalogItemReferences(id);
    const ok = await removeCatalogItem(id);
    if (!ok) return res.status(404).json({ error: 'Objet introuvable.' });
    await recordEntityHistory(req, { entityType: 'catalogue', collectionName: 'item_catalog', beforeDocument: before, afterDocument: null, action: 'supprime', entityName: before.name || id });
    logFromReq(req, 'objet_supprime', `A supprimé l'objet "${id}" du catalogue${usage.total ? ' après nettoyage des références' : ''}.`);
    res.json({ ok: true, referencesCleaned: usage.total > 0 });
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

// La page Inventaire n'a besoin que du total par personnage. L'agrégation
// évite d'envoyer chaque item de chaque inventaire au navigateur d'un coup.
app.get('/api/inventaire/resumes', async (req, res) => {
  try {
    const col = await getInvCollection();
    const summaries = await col.aggregate([
      { $project: { _id: 1, entries: { $objectToArray: { $ifNull: ['$items', {}] } } } },
      { $project: { _id: 1, total: { $sum: '$entries.v' } } },
    ]).toArray();
    res.set('Cache-Control', 'no-store');
    res.json(summaries);
  } catch (err) {
    console.error('Chargement des résumés d’inventaire impossible :', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/inventaire/:profileId', async (req, res) => {
  try {
    const inventory = await getInventory(req.params.profileId);
    res.set('Cache-Control', 'no-store');
    res.json(inventory);
  } catch (err) {
    console.error('Chargement d’un inventaire impossible :', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/inventaire/:profileId/items/bulk', async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!rows.length || rows.length > 200) return res.status(400).json({ error: 'Sélectionne entre 1 et 200 objets.' });
    const normalized = rows.map(row => ({ itemId: String(row?.itemId || '').trim(), quantity: Math.floor(Number(row?.quantity)) }))
      .filter(row => row.itemId && /^[A-Za-z0-9_-]+$/.test(row.itemId) && Number.isFinite(row.quantity) && row.quantity >= 1 && row.quantity <= 1000000);
    if (normalized.length !== rows.length) return res.status(400).json({ error: 'Un identifiant ou une quantité est invalide.' });
    const known = await getExistingCatalogIds(normalized.map(row => row.itemId));
    const unknown = normalized.find(row => !known.has(row.itemId));
    if (unknown) return res.status(400).json({ error: `Objet inconnu : ${unknown.itemId}.` });
    const before = await getInventory(req.params.profileId);
    for (const row of normalized) {
      const result = await addItem(req.params.profileId, row.itemId, row.quantity);
      if (!result.ok) throw new Error(result.message || `Impossible d’ajouter ${row.itemId}.`);
    }
    const after = await getInventory(req.params.profileId);
    await recordEntityHistory(req, { entityType: 'inventaire', collectionName: 'inv', beforeDocument: before, afterDocument: after, action: 'ajout_masse', entityName: `Inventaire ${req.params.profileId}` });
    logFromReq(req, 'inventaire_ajout_masse', `A ajouté ${normalized.length} type(s) d’objet à l’inventaire de ${req.params.profileId}.`);
    res.json({ ok: true, count: normalized.length, inventory: after });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/inventaire/:profileId/items/bulk', async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!rows.length || rows.length > 200) return res.status(400).json({ error: 'Sélectionne entre 1 et 200 objets.' });
    const normalized = rows.map(row => ({ itemId: String(row?.itemId || '').trim(), quantity: Math.floor(Number(row?.quantity)) }))
      .filter(row => row.itemId && /^[A-Za-z0-9_-]+$/.test(row.itemId) && Number.isFinite(row.quantity) && row.quantity >= 0 && row.quantity <= 1000000);
    if (normalized.length !== rows.length) return res.status(400).json({ error: 'Un identifiant ou une quantité est invalide.' });
    const known = await getExistingCatalogIds(normalized.map(row => row.itemId));
    const unknown = normalized.find(row => !known.has(row.itemId));
    if (unknown) return res.status(400).json({ error: `Objet inconnu : ${unknown.itemId}.` });
    const before = await getInventory(req.params.profileId);
    for (const row of normalized) {
      const result = await setItemQuantity(req.params.profileId, row.itemId, row.quantity);
      if (!result.ok) throw new Error(result.message || `Impossible de modifier ${row.itemId}.`);
    }
    const after = await getInventory(req.params.profileId);
    await recordEntityHistory(req, { entityType: 'inventaire', collectionName: 'inv', beforeDocument: before, afterDocument: after, action: 'quantites_masse', entityName: `Inventaire ${req.params.profileId}` });
    logFromReq(req, 'inventaire_quantites_masse', `A modifié les quantités de ${normalized.length} objet(s) dans l’inventaire de ${req.params.profileId}.`);
    res.json({ ok: true, count: normalized.length, inventory: after });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/inventaire/:profileId/items', async (req, res) => {
  try {
    const { itemId, quantity } = req.body || {};
    const before = await getInventory(req.params.profileId);
    const result = await addItem(req.params.profileId, itemId, Number(quantity) || 1);
    if (!result.ok) return res.status(400).json({ error: result.message || `Objet inconnu (${itemId}).` });
    const after = await getInventory(req.params.profileId);
    await recordEntityHistory(req, { entityType: 'inventaire', collectionName: 'inv', beforeDocument: before, afterDocument: after, action: 'ajout', entityName: `Inventaire ${req.params.profileId}` });
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
    const before = await getInventory(req.params.profileId);
    const result = await setItemQuantity(req.params.profileId, req.params.itemId, Number(quantity));
    if (!result.ok) return res.status(400).json({ error: result.message || `Objet inconnu (${req.params.itemId}).` });
    const after = await getInventory(req.params.profileId);
    await recordEntityHistory(req, { entityType: 'inventaire', collectionName: 'inv', beforeDocument: before, afterDocument: after, action: 'quantite_modifiee', entityName: `Inventaire ${req.params.profileId}` });
    logFromReq(req, 'inventaire_quantite', `A mis la quantité de "${req.params.itemId}" à ${Number(quantity)} pour ${req.params.profileId}.`);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/inventaire/:profileId/items/:itemId', async (req, res) => {
  try {
    const before = await getInventory(req.params.profileId);
    const result = await removeItem(req.params.profileId, req.params.itemId, 999999);
    if (!result.ok && result.reason === 'unknown_item') return res.status(400).json({ error: 'Objet inconnu.' });
    const after = await getInventory(req.params.profileId);
    await recordEntityHistory(req, { entityType: 'inventaire', collectionName: 'inv', beforeDocument: before, afterDocument: after, action: 'retrait', entityName: `Inventaire ${req.params.profileId}` });
    logFromReq(req, 'inventaire_retrait', `A retiré "${req.params.itemId}" de l'inventaire de ${req.params.profileId}.`)
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || process.env.WEB_PORT || 3000;
// ---------------------------------------------------------------------------
// BOUTIQUE — objets, prix et stock gérés ici ; le bot Discord affiche la
// boutique et gère les achats / ventes / échanges (il met à jour le stock).
// Chaque modification incrémente "version" : le bot la détecte (≈30 s) et
// réactualise les sujets persistants de chaque catégorie dans le forum Discord.
// ---------------------------------------------------------------------------
const BOUTIQUE_CURRENCY_ITEM_ID = 'credits_de_la_nouvelle_republique';
const DEFAULT_BOUTIQUE_CATEGORIES = [
  { id: 'nourriture', name: 'Nourriture' },
  { id: 'armes-equipements-outils', name: 'Armes & équipements & outils' },
  { id: 'ressources', name: 'Ressources' },
  { id: 'soins', name: 'Soins' },
  { id: 'vaisseaux-transport', name: 'Vaisseaux et transport' },
  { id: 'autres', name: 'Autres' },
];

function slugCategorieBoutique(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

async function lireCategoriesBoutique() {
  const col = await getBoutiqueStateCollection();
  await col.updateOne({ _id: 'categories' }, { $setOnInsert: { items: DEFAULT_BOUTIQUE_CATEGORIES, updatedAt: new Date() } }, { upsert: true });
  const doc = await col.findOne({ _id: 'categories' });
  return Array.isArray(doc?.items) ? doc.items : DEFAULT_BOUTIQUE_CATEGORIES;
}

function entierBoutique(value, label, { min = 0, max = 100000000 } = {}) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`${label} doit être un nombre entier entre ${min.toLocaleString('fr-FR')} et ${max.toLocaleString('fr-FR')}.`);
  }
  return n;
}

async function normaliserBoutiqueItem(itemId, body) {
  const id = String(itemId || '').trim();
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Identifiant d\'objet invalide.');
  if (id.toLowerCase() === BOUTIQUE_CURRENCY_ITEM_ID) throw new Error('La monnaie ne peut pas être vendue dans la boutique.');
  const known = await getExistingCatalogIds([id]);
  if (!known.has(id)) throw new Error(`L'objet « ${id} » n'existe pas dans le catalogue.`);

  const b = body || {};
  const categories = await lireCategoriesBoutique();
  const categoryId = String(b.categoryId || 'autres').trim();
  if (!categories.some(category => category.id === categoryId)) throw new Error('Choisis une catégorie définie dans la boutique.');
  // Un objet peut être achetable, vendable (rachat) ou les deux. Le stock est
  // UNIQUE : il est partagé entre l'achat et la revente.
  const achetable = b.achetable === true;
  const vendable = b.vendable === true;
  if (!achetable && !vendable) throw new Error('Coche au moins « Achetable » ou « Vendable ».');
  const type = achetable && vendable ? 'mixte' : achetable ? 'achetable' : 'vendable';
  const data = { type, categoryId, stock: entierBoutique(b.stock, 'Le stock', { min: 0, max: 1000000 }), enabled: b.enabled !== false, updatedAt: new Date() };
  const unset = {};

  if (achetable) {
    const minPrice = entierBoutique(b.minPrice, 'Le prix d\'achat minimum', { min: 1 });
    const maxPrice = entierBoutique(b.maxPrice, 'Le prix d\'achat maximum', { min: 1 });
    if (minPrice > maxPrice) throw new Error('Le prix d\'achat minimum ne peut pas dépasser le maximum.');
    data.minPrice = minPrice;
    data.maxPrice = maxPrice;
  } else {
    unset.minPrice = '';
    unset.maxPrice = '';
  }
  if (vendable) {
    const rachatMinPrice = entierBoutique(b.rachatMinPrice, 'Le prix de rachat minimum', { min: 1 });
    const rachatMaxPrice = entierBoutique(b.rachatMaxPrice, 'Le prix de rachat maximum', { min: 1 });
    if (rachatMinPrice > rachatMaxPrice) throw new Error('Le prix de rachat minimum ne peut pas dépasser le maximum.');
    data.rachatMinPrice = rachatMinPrice;
    data.rachatMaxPrice = rachatMaxPrice;
  } else {
    unset.rachatMinPrice = '';
    unset.rachatMaxPrice = '';
  }
  return { id, data, unset };
}

async function signalerChangementBoutique() {
  await (await getBoutiqueStateCollection()).updateOne(
    { _id: 'meta' }, { $inc: { version: 1 }, $setOnInsert: { categoryThreads: {} } }, { upsert: true },
  );
}

app.get('/api/boutique/categories', async (req, res) => {
  try { res.json(await lireCategoriesBoutique()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/boutique/categories', async (req, res) => {
  try {
    const source = Array.isArray(req.body?.categories) ? req.body.categories : [];
    if (!source.length || source.length > 30) throw new Error('Il faut définir entre 1 et 30 catégories.');
    const categories = [];
    const ids = new Set();
    for (const row of source) {
      const name = String(row?.name || '').trim().slice(0, 80);
      const id = slugCategorieBoutique(row?.id || name);
      if (!name || !id) throw new Error('Chaque catégorie doit avoir un nom valide.');
      if (ids.has(id)) throw new Error(`La catégorie « ${name} » est en double.`);
      ids.add(id);
      categories.push({ id, name });
    }
    const itemCategoryFilter = ids.has('autres')
      ? { categoryId: { $exists: true, $nin: [...ids] } }
      : { $or: [{ categoryId: { $exists: false } }, { categoryId: { $nin: [...ids] } }] };
    const shopItems = await (await getBoutiqueItemsCollection()).find(itemCategoryFilter, { projection: { _id: 1, categoryId: 1 } }).limit(1).toArray();
    if (shopItems.length) {
      if (!shopItems[0].categoryId && !ids.has('autres')) throw new Error('Des objets existants sans catégorie enregistrée sont encore rangés dans « Autres ». Affecte-les à une autre catégorie avant de supprimer « Autres ».');
      throw new Error(`La catégorie utilisée par « ${shopItems[0]._id} » ne peut pas être supprimée avant de réaffecter cet objet.`);
    }
    const col = await getBoutiqueStateCollection();
    await col.updateOne({ _id: 'categories' }, { $set: { items: categories, updatedAt: new Date() } }, { upsert: true });
    await signalerChangementBoutique();
    logFromReq(req, 'boutique_categories_modifiees', 'A modifié les catégories de la boutique.');
    res.json(categories);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.get('/api/boutique', async (req, res) => {
  try {
    const docs = await (await getBoutiqueItemsCollection()).find({}).toArray();
    res.json(docs.map(({ _id, ...rest }) => ({ id: String(_id), ...rest })));
  } catch (err) {
    console.error('Chargement de la boutique impossible :', err);
    res.status(500).json({ error: err.message });
  }
});

// Ajout ou modification d'un objet de la boutique (upsert).
app.put('/api/boutique/:itemId', async (req, res) => {
  try {
    const { id, data, unset } = await normaliserBoutiqueItem(req.params.itemId, req.body);
    const col = await getBoutiqueItemsCollection();
    const before = await col.findOne({ _id: id });
    await col.updateOne({ _id: id }, { $set: data, $unset: unset, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
    const after = await col.findOne({ _id: id });
    await recordEntityHistory(req, { entityType: 'boutique', collectionName: 'boutique_items', beforeDocument: before, afterDocument: after, action: before ? 'modifie' : 'cree', entityName: id });
    await signalerChangementBoutique();
    logFromReq(req, before ? 'boutique_modifiee' : 'boutique_ajoutee', `${before ? 'A modifié' : 'A ajouté'} l'objet « ${id} » dans la boutique.`);
    res.json({ id, ...data });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/boutique/:itemId', async (req, res) => {
  try {
    const col = await getBoutiqueItemsCollection();
    const before = await col.findOne({ _id: req.params.itemId });
    if (!before) return res.status(404).json({ error: 'Objet introuvable dans la boutique.' });
    const result = await col.deleteOne({ _id: req.params.itemId });
    if (!result.deletedCount) return res.status(404).json({ error: 'Objet introuvable dans la boutique.' });
    await recordEntityHistory(req, { entityType: 'boutique', collectionName: 'boutique_items', beforeDocument: before, afterDocument: null, action: 'supprime', entityName: req.params.itemId });
    await signalerChangementBoutique();
    logFromReq(req, 'boutique_retiree', `A retiré l'objet « ${req.params.itemId} » de la boutique.`);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});



// ---------------------------------------------------------------------------
// MISSIONS — le site crée les missions dans MongoDB ; le bot les publie dans
// les forums Discord et gère leur prise, leur suivi et l'attribution des gains.
// ---------------------------------------------------------------------------
function nettoyerTexteMission(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function validerImageMission(value) {
  const image = nettoyerTexteMission(value, 2000);
  if (!image) return null;
  let url;
  try { url = new URL(image); } catch { throw new Error('L’image doit être une URL HTTP(S) valide.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('L’image doit être une URL HTTP(S) valide.');
  return url.toString();
}

async function normaliserRecompensesMission(rewards) {
  if (!Array.isArray(rewards) || rewards.length > 25) throw new Error('Une mission peut avoir jusqu’à 25 récompenses.');
  const normalized = [];
  for (const row of rewards) {
    const type = String(row?.type || '');
    const id = ObjectId.isValid(String(row?.id || '')) ? String(row.id) : new ObjectId().toString();
    if (type === 'credits' || type === 'reputation') {
      const amount = Math.floor(Number(row.amount));
      const max = type === 'credits' ? 100000000 : 200;
      if (!Number.isInteger(amount) || amount < 1 || amount > max) throw new Error(type === 'credits' ? 'Le montant de crédits doit être compris entre 1 et 100 000 000.' : 'Les points de réputation doivent être compris entre 1 et 200.');
      normalized.push({ id, type, amount });
      continue;
    }
    if (type === 'item') {
      const itemId = String(row.itemId || '').trim();
      const item = itemId ? await getItem(itemId) : null;
      if (!item) throw new Error(`L’objet « ${itemId || 'inconnu'} » n’existe pas dans le catalogue.`);
      const quantity = Math.floor(Number(row.quantity));
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000) throw new Error('La quantité d’objet doit être comprise entre 1 et 100 000.');
      normalized.push({ id, type, itemId, itemName: item.name, quantity });
      continue;
    }
    if (type === 'stat') {
      const stat = String(row.stat || '').trim();
      if (!DEFAULT_STATS.includes(stat)) throw new Error(`Statistique inconnue : ${stat || 'vide'}.`);
      const amount = Math.floor(Number(row.amount));
      if (!Number.isInteger(amount) || amount < 1 || amount > STAT_MAX) throw new Error(`Les points de statistique doivent être compris entre 1 et ${STAT_MAX}.`);
      normalized.push({ id, type, stat, amount });
      continue;
    }
    throw new Error('Type de récompense inconnu.');
  }
  return normalized;
}

async function signalerChangementMissions() {
  await (await getMissionStateCollection()).updateOne(
    { _id: 'meta' },
    { $inc: { version: 1 }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true },
  );
}

app.get('/api/missions', async (req, res) => {
  try {
    const docs = await (await getMissionsCollection()).find({}).sort({ createdAt: -1 }).toArray();
    res.set('Cache-Control', 'no-store');
    res.json(docs.map(({ _id, ...mission }) => ({ id: String(_id), ...mission })));
  } catch (err) {
    console.error('Chargement des missions impossible :', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/missions', async (req, res) => {
  try {
    const title = nettoyerTexteMission(req.body?.title, 100);
    const description = nettoyerTexteMission(req.body?.description, 4000);
    if (!title) throw new Error('Le titre de la mission est obligatoire.');
    if (!description) throw new Error('La description de la mission est obligatoire.');
    const document = {
      _id: new ObjectId(),
      title,
      description,
      image: validerImageMission(req.body?.image),
      rewards: await normaliserRecompensesMission(req.body?.rewards || []),
      status: 'available',
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: req.session.user?.id || null,
      createdByName: req.session.user?.username || req.session.user?.global_name || null,
      publicThreadId: null,
      acceptedThreadId: null,
    };
    await (await getMissionsCollection()).insertOne(document);
    await signalerChangementMissions();
    await recordEntityHistory(req, { entityType: 'mission', collectionName: 'missions', beforeDocument: null, afterDocument: document, action: 'cree', entityName: title });
    logFromReq(req, 'mission_creee', `A créé la mission « ${title} ».`);
    const { _id, ...data } = document;
    res.status(201).json({ id: String(_id), ...data });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.patch('/api/missions/:id', async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Identifiant de mission invalide.' });
    const col = await getMissionsCollection();
    const filter = { _id: new ObjectId(req.params.id) };
    const before = await col.findOne(filter);
    if (!before) return res.status(404).json({ error: 'Mission introuvable.' });
    if (before.status !== 'available') return res.status(409).json({ error: 'Une mission déjà acceptée ne peut plus être modifiée depuis le site. Modifie ses récompenses dans son salon Discord.' });
    const title = req.body?.title !== undefined ? nettoyerTexteMission(req.body.title, 100) : before.title;
    const description = req.body?.description !== undefined ? nettoyerTexteMission(req.body.description, 4000) : before.description;
    if (!title) throw new Error('Le titre de la mission est obligatoire.');
    if (!description) throw new Error('La description de la mission est obligatoire.');
    const fields = { title, description, updatedAt: new Date() };
    if (req.body?.image !== undefined) fields.image = validerImageMission(req.body.image);
    if (req.body?.rewards !== undefined) fields.rewards = await normaliserRecompensesMission(req.body.rewards);
    await col.updateOne({ ...filter, status: 'available' }, { $set: fields });
    const after = await col.findOne(filter);
    await signalerChangementMissions();
    await recordEntityHistory(req, { entityType: 'mission', collectionName: 'missions', beforeDocument: before, afterDocument: after, action: 'modifiee', entityName: after.title });
    logFromReq(req, 'mission_modifiee', `A modifié la mission « ${after.title} ».`);
    const { _id, ...data } = after;
    res.json({ id: String(_id), ...data });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/missions/:id', async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'Identifiant de mission invalide.' });
    const col = await getMissionsCollection();
    const filter = { _id: new ObjectId(req.params.id) };
    const before = await col.findOne(filter);
    if (!before) return res.status(404).json({ error: 'Mission introuvable.' });
    if (before.status !== 'available') return res.status(409).json({ error: 'Seules les missions encore disponibles peuvent être retirées depuis le site.' });
    await col.updateOne({ ...filter, status: 'available' }, { $set: { status: 'cancelled', closedAt: new Date(), updatedAt: new Date() } });
    const after = await col.findOne(filter);
    await signalerChangementMissions();
    await recordEntityHistory(req, { entityType: 'mission', collectionName: 'missions', beforeDocument: before, afterDocument: after, action: 'annulee', entityName: before.title });
    logFromReq(req, 'mission_annulee', `A retiré la mission « ${before.title} » des missions disponibles.`);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Catégorie « Factions » (troupes, chef, vaisseaux, inventaire) — protégée par le middleware /api ci-dessus.
require('./factionRoutes.js').register(app, { logFromReq, recordEntityHistory });

app.listen(PORT, () => {
  console.log(`✅ Site admin lancé sur http://localhost:${PORT}`);
});