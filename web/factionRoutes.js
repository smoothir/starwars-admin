// Routes API de la catégorie « Factions » du site (troupes, chef, vaisseaux, inventaire, joueurs).
// Les routes sont protégées par le même middleware d'authentification que le reste de /api
// (ce fichier est branché dans server.js APRÈS ce middleware).
const fs = require('fs/promises');
const path = require('path');
const store = require('../Data/factionStore.js');
const possessionStore = require('../Data/possessionStore.js');
const { RANKS, SHIP_CLASSES } = require('../Data/shipClasses.js');
const { connect } = require('../Data/mongo.js');

const DISCORD_API = 'https://discord.com/api/v10';
const ROLES_TTL_MS = 5 * 60 * 1000;
const CLASS_META_TTL_MS = 5 * 60 * 1000;
let rolesCache = { at: 0, list: null };
let rolesPromise = null;
let classMetaCache = { at: 0, value: null };
let classMetaPromise = null;

function botToken() { return process.env.DISCORD_BOT_TOKEN || ''; }
function discordReady() { return Boolean(botToken() && process.env.GUILD_ID); }

async function discordGet(path) {
  const res = await fetch(`${DISCORD_API}${path}`, { headers: { Authorization: `Bot ${botToken()}` } });
  if (!res.ok) throw new Error(`Discord a répondu ${res.status}`);
  return res.json();
}

/** Rôles du serveur : petite réponse Discord, mise en cache 5 minutes. */
async function fetchGuildRoles(force = false) {
  if (!discordReady()) return [];
  if (!force && rolesCache.list && Date.now() - rolesCache.at < ROLES_TTL_MS) return rolesCache.list;
  if (rolesPromise) return rolesPromise;
  rolesPromise = (async () => {
    const roles = await discordGet(`/guilds/${process.env.GUILD_ID}/roles`);
    const list = roles
      .filter(role => role && !role.managed && role.name !== '@everyone')
      .map(role => ({ id: role.id, name: role.name, color: role.color || 0, position: role.position || 0 }))
      .sort((a, b) => b.position - a.position || a.name.localeCompare(b.name, 'fr'));
    rolesCache = { at: Date.now(), list };
    return list;
  })();
  try { return await rolesPromise; }
  finally { rolesPromise = null; }
}

/** Les membres d'une faction sont les PROFILS dont categoryId correspond au rôle de faction. */
async function getFactionProfiles(factionKey) {
  const def = store.getFactionDef(factionKey);
  if (!def) return { profiles: [], players: [] };
  const db = await connect();
  const profiles = await db.collection('profils').find(
    { categoryId: String(def.categoryRoleId), _id: { $not: /^__/ } },
    { projection: { _id: 1, userId: 1, nomPrenom: 1, surnom: 1, roleId: 1, roleName: 1 } },
  ).sort({ nomPrenom: 1, _id: 1 }).toArray();
  const rankById = new Map((def.grades || []).map((grade, index) => [String(grade.id), { name: grade.name, index }]));
  const playersById = new Map();
  for (const profile of profiles) {
    const userId = String(profile.userId || '');
    if (!userId) continue;
    const rank = rankById.get(String(profile.roleId || ''));
    const player = playersById.get(userId) || { id: userId, name: `<@${userId}>`, rankName: null, rankIndex: -1, profiles: [] };
    player.profiles.push({ id: String(profile._id), name: String(profile.nomPrenom || profile._id), nickname: String(profile.surnom || ''), roleName: String(profile.roleName || rank?.name || '') });
    if (rank && rank.index > player.rankIndex) { player.rankIndex = rank.index; player.rankName = rank.name; }
    playersById.set(userId, player);
  }
  return { profiles: profiles.map(profile => ({ id: String(profile._id), name: String(profile.nomPrenom || profile._id), nickname: String(profile.surnom || ''), userId: profile.userId ? String(profile.userId) : null, roleName: String(profile.roleName || rankById.get(String(profile.roleId || ''))?.name || '—') })), players: [...playersById.values()] };
}

function register(app, { logFromReq, recordEntityHistory }) {
  const wrap = (handler) => async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      console.error('Erreur route factions :', err.message);
      res.status(400).json({ error: err.message || 'Erreur' });
    }
  };
  const needFaction = (req, res) => {
    const def = store.getFactionDef(req.params.key);
    if (!def) { res.status(404).json({ error: 'Faction inconnue.' }); return null; }
    return def;
  };

  app.get('/api/factions/meta', wrap(async (req, res) => {
    await store.loadFactionDefs();
    res.set('Cache-Control', 'private, max-age=60');
    let meta = classMetaCache.value;
    if (!meta || Date.now() - classMetaCache.at > CLASS_META_TTL_MS) {
      if (!classMetaPromise) {
        classMetaPromise = (async () => {
          // Ne jamais synchroniser les fichiers d'images pendant l'ouverture de la page.
          // La migration est inutile pour construire les métadonnées et provoquait une
          // série de lectures MongoDB + disque (une par classe) à chaque expiration du cache.
          const images = await store.listShipClassImages();
          return {
            factions: store.listFactionDefs(),
            ranks: RANKS.map(r => ({ key: r.key, name: r.name })),
            classes: Object.entries(SHIP_CLASSES).map(([key, c]) => ({
              key, id: c.id, image: images[key] ? `/ship/${encodeURIComponent(images[key])}` : null,
              label: c.label, size: c.size, defaults: c.defaults,
              requirement: c.leaderOnly ? 'Chef de faction' : RANKS[c.minRank].name,
            })),
            creditsItemId: store.CREDITS_ITEM_ID,
          };
        })();
      }
      try {
        meta = await classMetaPromise;
        classMetaCache = { at: Date.now(), value: meta };
      } finally {
        classMetaPromise = null;
      }
    }
    res.json({ ...meta, discordReady: discordReady() });
  }));


  app.get('/api/factions/discord-roles', wrap(async (req, res) => {
    if (!discordReady()) return res.json({ ready: false, roles: [] });
    res.set('Cache-Control', 'private, max-age=300');
    res.json({ ready: true, roles: await fetchGuildRoles() });
  }));

  app.post('/api/factions/definitions', wrap(async (req, res) => {
    await store.loadFactionDefs();
    const definition = await store.createFactionDef(req.body || {});
    classMetaCache = { at: 0, value: null };
    if (logFromReq) logFromReq(req, 'faction_creee', `A créé la faction « ${definition.label} ».`);
    res.status(201).json(definition);
  }));

  app.delete('/api/factions/definitions/:key', wrap(async (req, res) => {
    await store.loadFactionDefs();
    const definition = store.getFactionDef(req.params.key);
    if (!definition) return res.status(404).json({ error: 'Faction inconnue.' });
    await store.deleteFactionDef(req.params.key);
    classMetaCache = { at: 0, value: null };
    if (logFromReq) logFromReq(req, 'faction_supprimee', `A supprimé la faction « ${definition.label} ».`);
    res.json({ ok: true });
  }));

  app.get('/api/factions', wrap(async (req, res) => {
    await store.loadFactionDefs();
    res.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
    const out = await store.listFactionSummaries();
    res.json(out);
  }));

  app.get('/api/factions/:key', wrap(async (req, res) => {
    const def = needFaction(req, res); if (!def) return;
    res.set('Cache-Control', 'no-store');
    const [state, ships, possessions] = await Promise.all([store.getFactionState(def.key), store.listShips(def.key), possessionStore.listPossessions('faction', def.key)]);
    res.json({ def, state, ships, possessions });
  }));


  app.post('/api/factions/:key/possessions', wrap(async (req, res) => {
    const def = needFaction(req, res); if (!def) return;
    const doc = await possessionStore.createPossession('faction', def.key, req.body || {});
    if (logFromReq) logFromReq(req, 'possession_faction_creee', `${def.label} : possession « ${doc.name} » créée.`);
    res.status(201).json(doc);
  }));

  app.patch('/api/factions/:key/possessions/:id', wrap(async (req, res) => {
    const def = needFaction(req, res); if (!def) return;
    const before = await possessionStore.getPossession(req.params.id);
    if (!before || before.ownerType !== 'faction' || before.ownerId !== def.key) throw new Error('Possession de faction introuvable.');
    const doc = await possessionStore.updatePossession(req.params.id, req.body || {});
    res.json(doc);
  }));

  app.delete('/api/factions/:key/possessions/:id', wrap(async (req, res) => {
    const def = needFaction(req, res); if (!def) return;
    const before = await possessionStore.getPossession(req.params.id);
    if (!before || before.ownerType !== 'faction' || before.ownerId !== def.key) throw new Error('Possession de faction introuvable.');
    await possessionStore.deletePossession(req.params.id);
    res.json({ ok: true });
  }));

  app.get('/api/factions/:key/joueurs', wrap(async (req, res) => {
    const def = needFaction(req, res); if (!def) return;
    res.set('Cache-Control', 'no-store');
    const [{ profiles, players }, state] = await Promise.all([getFactionProfiles(def.key), store.getFactionState(def.key)]);
    const enriched = players.map(player => ({ ...player, isLeader: state.leaderUserId === player.id }))
      .sort((a, b) => b.rankIndex - a.rankIndex || a.name.localeCompare(b.name, 'fr'));
    res.json({ ready: true, profiles, players: enriched });
  }));

  app.put('/api/factions/:key', wrap(async (req, res) => {
    const def = needFaction(req, res); if (!def) return;
    const body = req.body || {};
    if (body.troops !== undefined) {
      await store.setTroops(def.key, body.troops);
      logFromReq(req, 'faction_troupes', `${def.label} : troupes = ${Math.max(0, Math.floor(Number(body.troops) || 0))}`);
    }
    if (body.leaderUserId !== undefined) {
      const leaderId = body.leaderUserId ? String(body.leaderUserId) : null;
      if (leaderId && discordReady()) {
        const { players } = await getFactionProfiles(def.key);
        if (!players.some(player => player.id === leaderId)) throw new Error('Aucun profil de cette faction n’est associé à ce joueur.');
      }
      await store.setLeader(def.key, leaderId);
      logFromReq(req, 'faction_chef', `${def.label} : chef = ${leaderId || 'aucun'}`);
    }
    if (body.reputation !== undefined) {
      const state = await store.setReputation(def.key, body.reputation);
      logFromReq(req, 'faction_reputation', `${def.label} : réputation = ${state.reputation}/100`);
    }
    res.json(await store.getFactionState(def.key));
  }));

  app.put('/api/factions/:key/inventaire/:itemId', wrap(async (req, res) => {
    const def = needFaction(req, res); if (!def) return;
    const state = await store.setFactionItem(def.key, req.params.itemId, req.body?.quantity);
    logFromReq(req, 'faction_inventaire', `${def.label} : ${req.params.itemId} = ${state.items[req.params.itemId] || 0}`);
    res.json(state);
  }));

  app.post('/api/factions/classes/:classKey/image', wrap(async (req, res) => {
    const classKey = String(req.params.classKey || '');
    const cls = SHIP_CLASSES[classKey];
    if (!cls) throw new Error('Classe de vaisseau inconnue.');
    const imageData = String(req.body?.imageData || '');
    const match = imageData.match(/^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/i);
    if (!match) throw new Error('Format d’image invalide (PNG, JPEG, WEBP ou GIF attendu).');
    const mime = match[1].toLowerCase();
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length || buffer.length > 4 * 1024 * 1024) throw new Error('L’image doit peser 4 Mo maximum.');
    const signatures = {
      png: buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
      jpeg: buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
      webp: buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP',
      gif: ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString()),
    };
    if (!signatures[mime]) throw new Error('Le contenu du fichier ne correspond pas à son format annoncé.');
    const ext = mime === 'jpeg' ? 'jpg' : mime;
    const filename = `${cls.id}.${ext}`;
    const directory = path.join(__dirname, 'ship');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, filename), buffer, { flag: 'w' });
    const image = await store.setShipClassImage(classKey, filename, buffer);
    classMetaCache = { at: 0, value: null };
    for (const baseName of new Set([cls.id, cls.imageBaseName])) {
      for (const oldExt of ['png', 'jpg', 'jpeg', 'webp', 'gif']) {
        const previousFilename = `${baseName}.${oldExt}`;
        if (previousFilename !== filename) await fs.unlink(path.join(directory, previousFilename)).catch(() => {});
      }
    }
    logFromReq(req, 'faction_classe_image', `Image de classe remplacée : ${cls.label} (${cls.id})`);
    res.json({ ok: true, image });
  }));

  app.post('/api/factions/:key/vaisseaux', wrap(async (req, res) => {
    const def = needFaction(req, res); if (!def) return;
    const ship = await store.createShip(def.key, req.body);
    const afterDocument = await store.getShipRecord(ship.id);
    if (recordEntityHistory) await recordEntityHistory(req, { entityType: 'vaisseau', collectionName: 'faction_ships', beforeDocument: null, afterDocument, action: 'creation', entityName: ship.name });
    logFromReq(req, 'faction_vaisseau_creation', `${def.label} : ${ship.name} (${ship.className})`);
    res.status(201).json(ship);
  }));

  const ownShip = async (req, res) => {
    const def = needFaction(req, res); if (!def) return null;
    const ship = await store.getShip(req.params.shipId);
    if (!ship || ship.factionKey !== def.key) { res.status(404).json({ error: 'Vaisseau introuvable dans cette faction.' }); return null; }
    return { def, ship };
  };

  app.put('/api/factions/:key/vaisseaux/:shipId', wrap(async (req, res) => {
    const ctx = await ownShip(req, res); if (!ctx) return;
    const beforeDocument = await store.getShipRecord(ctx.ship.id);
    const updated = await store.updateShip(ctx.ship.id, req.body);
    const afterDocument = await store.getShipRecord(ctx.ship.id);
    if (recordEntityHistory) await recordEntityHistory(req, { entityType: 'vaisseau', collectionName: 'faction_ships', beforeDocument, afterDocument, action: 'modification', entityName: updated.name });
    logFromReq(req, 'faction_vaisseau_modification', `${ctx.def.label} : ${updated.name}`);
    res.json(updated);
  }));

  app.delete('/api/factions/:key/vaisseaux/:shipId', wrap(async (req, res) => {
    const ctx = await ownShip(req, res); if (!ctx) return;
    const beforeDocument = await store.getShipRecord(ctx.ship.id);
    await store.deleteShip(ctx.ship.id);
    if (recordEntityHistory) await recordEntityHistory(req, { entityType: 'vaisseau', collectionName: 'faction_ships', beforeDocument, afterDocument: null, action: 'suppression', entityName: ctx.ship.name });
    logFromReq(req, 'faction_vaisseau_suppression', `${ctx.def.label} : ${ctx.ship.name}`);
    res.json({ ok: true });
  }));

  app.put('/api/factions/:key/vaisseaux/:shipId/reparer', wrap(async (req, res) => {
    const ctx = await ownShip(req, res); if (!ctx) return;
    const beforeDocument = await store.getShipRecord(ctx.ship.id);
    const repaired = await store.repairShip(ctx.ship.id);
    const afterDocument = await store.getShipRecord(ctx.ship.id);
    if (recordEntityHistory) await recordEntityHistory(req, { entityType: 'vaisseau', collectionName: 'faction_ships', beforeDocument, afterDocument, action: 'réparation', entityName: repaired.name });
    logFromReq(req, 'faction_vaisseau_reparation', `${ctx.def.label} : ${repaired.name} réparé`);
    res.json(repaired);
  }));

  app.put('/api/factions/:key/vaisseaux/:shipId/pilote', wrap(async (req, res) => {
    const ctx = await ownShip(req, res); if (!ctx) return;
    const userId = req.body?.userId ? String(req.body.userId) : null;
    let member = {};
    if (userId) {
      const { players } = await getFactionProfiles(ctx.def.key);
      const target = players.find(player => player.id === userId);
      const state = await store.getFactionState(ctx.def.key);
      member = { inFaction: Boolean(target), rankIndex: target ? target.rankIndex : -1, isLeader: state.leaderUserId === userId };
    }
    const beforeDocument = await store.getShipRecord(ctx.ship.id);
    const updated = await store.assignShip(ctx.ship.id, userId, member);
    const afterDocument = await store.getShipRecord(ctx.ship.id);
    if (recordEntityHistory) await recordEntityHistory(req, { entityType: 'vaisseau', collectionName: 'faction_ships', beforeDocument, afterDocument, action: 'changement de pilote', entityName: updated.name });
    logFromReq(req, 'faction_vaisseau_pilote', `${ctx.def.label} : ${updated.name} → ${userId || 'personne'}`);
    res.json(updated);
  }));
}

module.exports = { register };
