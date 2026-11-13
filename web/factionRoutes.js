// Routes API de la catégorie « Factions » du site (troupes, chef, vaisseaux, inventaire, joueurs).
// Les routes sont protégées par le même middleware d'authentification que le reste de /api
// (ce fichier est branché dans server.js APRÈS ce middleware).
const fs = require('fs/promises');
const path = require('path');
const store = require('../Data/factionStore.js');
const { RANKS, SHIP_CLASSES, getRankIndex } = require('../Data/shipClasses.js');

const DISCORD_API = 'https://discord.com/api/v10';
const MEMBERS_TTL_MS = 60 * 1000;
const CLASS_META_TTL_MS = 5 * 60 * 1000;
let membersCache = { at: 0, list: null };
let membersPromise = null;
let classMetaCache = { at: 0, value: null };
let classMetaPromise = null;

function botToken() { return process.env.DISCORD_BOT_TOKEN || ''; }
function discordReady() { return Boolean(botToken() && process.env.GUILD_ID); }

async function discordGet(path) {
  const res = await fetch(`${DISCORD_API}${path}`, { headers: { Authorization: `Bot ${botToken()}` } });
  if (!res.ok) throw new Error(`Discord a répondu ${res.status}`);
  return res.json();
}

/** Tous les membres du serveur (pagination par 1000), mis en cache 60 s. */
async function fetchGuildMembers(force = false) {
  if (!discordReady()) return [];
  if (!force && membersCache.list && Date.now() - membersCache.at < MEMBERS_TTL_MS) return membersCache.list;
  if (membersPromise) return membersPromise;
  membersPromise = (async () => {
    const all = [];
    let after = '0';
    for (let page = 0; page < 10; page++) {
      const batch = await discordGet(`/guilds/${process.env.GUILD_ID}/members?limit=1000&after=${after}`);
      all.push(...batch);
      if (batch.length < 1000) break;
      after = batch[batch.length - 1].user.id;
    }
    membersCache = { at: Date.now(), list: all };
    return all;
  })();
  try { return await membersPromise; }
  finally { membersPromise = null; }
}

function memberView(m) {
  const user = m.user || {};
  return {
    id: user.id,
    name: m.nick || user.global_name || user.username || user.id,
    avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64` : null,
    roles: m.roles || [],
  };
}

async function getFactionMembers(factionKey) {
  const def = store.getFactionDef(factionKey);
  const members = (await fetchGuildMembers()).filter(m => !m.user?.bot && (m.roles || []).includes(def.categoryRoleId));
  return members.map(memberView);
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
              label: c.label, size: c.size, squadrons: c.squadrons, defaults: c.defaults,
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

  app.get('/api/factions', wrap(async (req, res) => {
    res.set('Cache-Control', 'private, max-age=15, stale-while-revalidate=30');
    const out = await store.listFactionSummaries();
    res.json(out);
  }));

  app.get('/api/factions/:key', wrap(async (req, res) => {
    const def = needFaction(req, res); if (!def) return;
    res.set('Cache-Control', 'no-store');
    const [state, ships] = await Promise.all([store.getFactionState(def.key), store.listShips(def.key)]);
    res.json({ def, state, ships });
  }));

  app.get('/api/factions/:key/joueurs', wrap(async (req, res) => {
    const def = needFaction(req, res); if (!def) return;
    res.set('Cache-Control', 'no-store');
    if (!discordReady()) return res.json({ ready: false, players: [] });
    const [members, state] = await Promise.all([getFactionMembers(def.key), store.getFactionState(def.key)]);
    const players = members.map(m => {
      const rank = getRankIndex(m.roles);
      return { id: m.id, name: m.name, avatar: m.avatar, rankIndex: rank, rankName: rank >= 0 ? RANKS[rank].name : null, isLeader: state.leaderUserId === m.id };
    }).sort((a, b) => b.rankIndex - a.rankIndex || a.name.localeCompare(b.name, 'fr'));
    res.json({ ready: true, players });
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
        const members = await getFactionMembers(def.key);
        if (!members.some(m => m.id === leaderId)) throw new Error('Ce joueur ne fait pas partie de la faction.');
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
      if (!discordReady()) throw new Error('Ajoute DISCORD_BOT_TOKEN au .env du site pour attribuer un vaisseau depuis le site (ou utilise /faction attribuer sur Discord).');
      const members = await getFactionMembers(ctx.def.key);
      const target = members.find(m => m.id === userId);
      const state = await store.getFactionState(ctx.def.key);
      member = { inFaction: Boolean(target), rankIndex: target ? getRankIndex(target.roles) : -1, isLeader: state.leaderUserId === userId };
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
