// Routes API de la catégorie « Factions » du site (troupes, chef, vaisseaux, inventaire, joueurs).
// Les routes sont protégées par le même middleware d'authentification que le reste de /api
// (ce fichier est branché dans server.js APRÈS ce middleware).
const fs = require('fs/promises');
const path = require('path');
const store = require('../Data/factionStore.js');
const possessionStore = require('../Data/possessionStore.js');
const { SHIP_CLASSES } = require('../Data/shipClasses.js');
const config = require('../Data/config.js');
const { connect } = require('../Data/mongo.js');

const DISCORD_API = 'https://discord.com/api/v10';
const ROLES_TTL_MS = 5 * 60 * 1000;
const CLASS_META_TTL_MS = 5 * 60 * 1000;
const PLAYERS_TTL_MS = 30 * 1000;
let rolesCache = { at: 0, list: null };
let rolesPromise = null;
let classMetaCache = { at: 0, value: null };
let classMetaPromise = null;
const playersCache = new Map();

function botToken() { return process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN || ''; }
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

function isStaff(req) {
  const roles = new Set((req.session?.roles || []).map(String));
  const privileged = [config.STAFF_ROLE_ID, ...(config.ADMIN_ROLE_IDS || [])].filter(Boolean).map(String);
  return req.session?.user?.id === String(config.SUPER_ADMIN_ID) || privileged.some(id => roles.has(id));
}

function hasFactionAccess(req) {
  // Un rôle de faction (Empire, Nouvelle République, etc.) ne donne aucun accès au site.
  return isStaff(req);
}

function requireStaff(req, res) {
  if (isStaff(req)) return true;
  res.status(403).json({ error: 'Cette action est réservée au Staff.' });
  return false;
}

/** Membres Discord de la faction et profils RP qui leur sont associés. */
async function getFactionProfiles(factionKey) {
  const def = store.getFactionDef(factionKey);
  if (!def) return { profiles: [], players: [] };
  const db = await connect();
  const profiles = await db.collection('profils').find(
    { categoryId: String(def.categoryRoleId), _id: { $not: /^__/ } },
    { projection: { _id: 1, userId: 1, nomPrenom: 1, surnom: 1, roleId: 1, roleName: 1 } },
  ).sort({ nomPrenom: 1, _id: 1 }).toArray();
  const profilesByUserId = new Map();
  for (const profile of profiles) {
    const userId = String(profile.userId || '');
    if (!userId) continue;
    if (!profilesByUserId.has(userId)) profilesByUserId.set(userId, []);
    profilesByUserId.get(userId).push(profile);
  }

  const grades = Array.isArray(def.grades) ? def.grades : [];
  const factionRoleIds = new Set([String(def.categoryRoleId), ...grades.map(grade => String(grade.id))]);
  let discordMembers = null;
  if (discordReady()) {
    const cached = playersCache.get(def.key);
    if (cached && Date.now() - cached.at < PLAYERS_TTL_MS) discordMembers = cached.members;
    else {
      const pending = [];
      let after = null;
      // Discord renvoie au maximum 1 000 membres par page. On continue jusqu'à
      // la dernière page pour ne pas limiter artificiellement les factions.
      for (let page = 0; page < 100; page += 1) {
        const query = new URLSearchParams({ limit: '1000' });
        if (after) query.set('after', after);
        const batch = await discordGet(`/guilds/${process.env.GUILD_ID}/members?${query.toString()}`);
        if (!Array.isArray(batch) || !batch.length) break;
        for (const member of batch) {
          const memberRoles = new Set((member?.roles || []).map(String));
          if (!member?.user?.bot && [...factionRoleIds].some(roleId => memberRoles.has(roleId))) pending.push(member);
        }
        if (batch.length < 1000) break;
        after = batch[batch.length - 1]?.user?.id || null;
        if (!after) break;
      }
      discordMembers = pending;
      playersCache.set(def.key, { at: Date.now(), members: discordMembers });
    }
  }

  const playersById = new Map();
  if (Array.isArray(discordMembers)) {
    for (const member of discordMembers) {
      const user = member.user;
      const userId = String(user.id);
      const roleIds = new Set((member.roles || []).map(String));
      // Les grades sont ordonnés du plus élevé au plus bas : le premier rôle
      // correspondant est donc le grade le plus élevé du membre.
      const gradeIndex = grades.findIndex(grade => roleIds.has(String(grade.id)));
      const grade = gradeIndex >= 0 ? grades[gradeIndex] : null;
      const linkedProfiles = profilesByUserId.get(userId) || [];
      playersById.set(userId, {
        id: userId,
        name: String(user.global_name || user.username || `<@${userId}>`),
        rankName: grade?.name || null,
        rankIndex: grade ? grades.length - gradeIndex : -1,
        gradeRoleIds: grades.filter(item => roleIds.has(String(item.id))).map(item => String(item.id)),
        profiles: linkedProfiles.map(profile => ({ id: String(profile._id), name: String(profile.nomPrenom || profile._id), nickname: String(profile.surnom || ''), roleName: String(profile.roleName || grade?.name || '') })),
      });
    }
  } else {
    // Mode de secours : si Discord ne répond pas, conserver les joueurs déjà
    // associés à un profil. Le contrôle d'attribution revalidera le membre côté API.
    for (const [userId, linkedProfiles] of profilesByUserId) {
      const roleIds = new Set(linkedProfiles.map(profile => String(profile.roleId || '')).filter(Boolean));
      const gradeIndex = grades.findIndex(grade => roleIds.has(String(grade.id)));
      const grade = gradeIndex >= 0 ? grades[gradeIndex] : null;
      playersById.set(userId, {
        id: userId, name: `<@${userId}>`, rankName: grade?.name || null,
        rankIndex: grade ? grades.length - gradeIndex : -1,
        gradeRoleIds: grade ? [String(grade.id)] : [],
        profiles: linkedProfiles.map(profile => ({ id: String(profile._id), name: String(profile.nomPrenom || profile._id), nickname: String(profile.surnom || ''), roleName: String(profile.roleName || grade?.name || '') })),
      });
    }
  }

  const rankById = new Map(grades.map(grade => [String(grade.id), grade.name]));
  return {
    profiles: profiles.map(profile => ({
      id: String(profile._id), name: String(profile.nomPrenom || profile._id),
      nickname: String(profile.surnom || ''), userId: profile.userId ? String(profile.userId) : null,
      roleId: profile.roleId ? String(profile.roleId) : null,
      roleName: String(profile.roleName || rankById.get(String(profile.roleId || '')) || '—'),
      inFaction: Boolean(profile.userId && Array.isArray(discordMembers) && playersById.has(String(profile.userId))),
      ownerName: profile.userId ? (playersById.get(String(profile.userId))?.name || null) : null,
    })),
    players: [...playersById.values()].sort((a, b) => b.rankIndex - a.rankIndex || a.name.localeCompare(b.name, 'fr')),
  };
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
    if (!hasFactionAccess(req)) { res.status(403).json({ error: 'Cette section est réservée au Staff.' }); return null; }
    return def;
  };

  app.get('/api/factions/meta', wrap(async (req, res) => {
    await store.loadFactionDefs();
    res.set('Cache-Control', 'no-store');
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
            ranks: [],
            classes: Object.entries(SHIP_CLASSES).map(([key, c]) => ({
              key, id: c.id, image: images[key] ? `/ship/${encodeURIComponent(images[key])}` : null,
              label: c.label, size: c.size, defaults: c.defaults,
              requirement: 'Grades autorisés définis sur le vaisseau',
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
    const visibleMeta = isStaff(req) ? meta : { ...meta, factions: meta.factions.filter(def => hasFactionAccess(req)) };
    res.json({ ...visibleMeta, discordReady: discordReady() });
  }));


  app.get('/api/factions/discord-roles', wrap(async (req, res) => {
    if (!discordReady()) return res.json({ ready: false, roles: [] });
    res.set('Cache-Control', 'private, max-age=300');
    let roles = await fetchGuildRoles();
    if (!isStaff(req)) {
      await store.loadFactionDefs();
      const allowed = new Set(store.listFactionDefs().filter(def => hasFactionAccess(req)).flatMap(def => [def.categoryRoleId, ...(def.grades || []).map(grade => grade.id)]).map(String));
      roles = roles.filter(role => allowed.has(String(role.id)));
    }
    res.json({ ready: true, roles });
  }));

  app.post('/api/factions/definitions', wrap(async (req, res) => {
    if (!requireStaff(req, res)) return;
    await store.loadFactionDefs();
    const definition = await store.createFactionDef(req.body || {});
    classMetaCache = { at: 0, value: null };
    if (logFromReq) logFromReq(req, 'faction_creee', `A créé la faction « ${definition.label} ».`);
    res.status(201).json(definition);
  }));

  app.put('/api/factions/definitions/:key', wrap(async (req, res) => {
    if (!requireStaff(req, res)) return;
    await store.loadFactionDefs();
    const before = store.getFactionDef(req.params.key);
    if (!before) return res.status(404).json({ error: 'Faction inconnue.' });
    const definition = await store.updateFactionGrades(req.params.key, req.body?.grades);
    classMetaCache = { at: 0, value: null };
    if (logFromReq) logFromReq(req, 'faction_grades', `${definition.label} : grades modifiés (${definition.grades.length}).`);
    res.json(definition);
  }));

  app.delete('/api/factions/definitions/:key', wrap(async (req, res) => {
    if (!requireStaff(req, res)) return;
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
    res.set('Cache-Control', 'no-store');
    const out = await store.listFactionSummaries();
    res.json(isStaff(req) ? out : out.filter(def => hasFactionAccess(req)).map(def => ({ key: def.key, label: def.label, shipCount: def.shipCount })));
  }));

  app.get('/api/factions/:key', wrap(async (req, res) => {
    const def = needFaction(req, res); if (!def) return;
    res.set('Cache-Control', 'no-store');
    const [factionState, ships, possessions] = await Promise.all([store.getFactionState(def.key), store.listShips(def.key), isStaff(req) ? possessionStore.listPossessions('faction', def.key) : Promise.resolve([])]);
    const safeState = isStaff(req) ? factionState : { troops: 0, credits: 0, reputation: 50, leaderUserId: null, items: {} };
    res.json({ def, state: safeState, ships, possessions });
  }));


  app.post('/api/factions/:key/possessions', wrap(async (req, res) => {
    if (!requireStaff(req, res)) return;
    const def = needFaction(req, res); if (!def) return;
    const doc = await possessionStore.createPossession('faction', def.key, req.body || {});
    if (logFromReq) logFromReq(req, 'possession_faction_creee', `${def.label} : possession « ${doc.name} » créée.`);
    res.status(201).json(doc);
  }));

  app.patch('/api/factions/:key/possessions/:id', wrap(async (req, res) => {
    if (!requireStaff(req, res)) return;
    const def = needFaction(req, res); if (!def) return;
    const before = await possessionStore.getPossession(req.params.id);
    if (!before || before.ownerType !== 'faction' || before.ownerId !== def.key) throw new Error('Possession de faction introuvable.');
    const doc = await possessionStore.updatePossession(req.params.id, req.body || {});
    res.json(doc);
  }));

  app.delete('/api/factions/:key/possessions/:id', wrap(async (req, res) => {
    if (!requireStaff(req, res)) return;
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
    if (!requireStaff(req, res)) return;
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
    if (!requireStaff(req, res)) return;
    const def = needFaction(req, res); if (!def) return;
    const state = await store.setFactionItem(def.key, req.params.itemId, req.body?.quantity);
    logFromReq(req, 'faction_inventaire', `${def.label} : ${req.params.itemId} = ${state.items[req.params.itemId] || 0}`);
    res.json(state);
  }));

  app.post('/api/factions/classes/:classKey/image', wrap(async (req, res) => {
    if (!requireStaff(req, res)) return;
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
    if (!requireStaff(req, res)) return;
    const ctx = await ownShip(req, res); if (!ctx) return;
    const beforeDocument = await store.getShipRecord(ctx.ship.id);
    const updated = await store.updateShip(ctx.ship.id, req.body);
    const afterDocument = await store.getShipRecord(ctx.ship.id);
    if (recordEntityHistory) await recordEntityHistory(req, { entityType: 'vaisseau', collectionName: 'faction_ships', beforeDocument, afterDocument, action: 'modification', entityName: updated.name });
    logFromReq(req, 'faction_vaisseau_modification', `${ctx.def.label} : ${updated.name}`);
    res.json(updated);
  }));

  app.delete('/api/factions/:key/vaisseaux/:shipId', wrap(async (req, res) => {
    if (!requireStaff(req, res)) return;
    const ctx = await ownShip(req, res); if (!ctx) return;
    const beforeDocument = await store.getShipRecord(ctx.ship.id);
    await store.deleteShip(ctx.ship.id);
    if (recordEntityHistory) await recordEntityHistory(req, { entityType: 'vaisseau', collectionName: 'faction_ships', beforeDocument, afterDocument: null, action: 'suppression', entityName: ctx.ship.name });
    logFromReq(req, 'faction_vaisseau_suppression', `${ctx.def.label} : ${ctx.ship.name}`);
    res.json({ ok: true });
  }));

  app.put('/api/factions/:key/vaisseaux/:shipId/reparer', wrap(async (req, res) => {
    if (!requireStaff(req, res)) return;
    const ctx = await ownShip(req, res); if (!ctx) return;
    const beforeDocument = await store.getShipRecord(ctx.ship.id);
    const repaired = await store.repairShip(ctx.ship.id);
    const afterDocument = await store.getShipRecord(ctx.ship.id);
    if (recordEntityHistory) await recordEntityHistory(req, { entityType: 'vaisseau', collectionName: 'faction_ships', beforeDocument, afterDocument, action: 'réparation', entityName: repaired.name });
    logFromReq(req, 'faction_vaisseau_reparation', `${ctx.def.label} : ${repaired.name} réparé`);
    res.json(repaired);
  }));

  app.put('/api/factions/:key/vaisseaux/:shipId/grades', wrap(async (req, res) => {
    const ctx = await ownShip(req, res); if (!ctx) return;
    if (!Array.isArray(req.body?.roleIds)) throw new Error('Sélection de grades invalide.');
    const beforeDocument = await store.getShipRecord(ctx.ship.id);
    let clearAssignedPilot = false;
    if (beforeDocument?.assignedProfileId) {
      // Le pilote est un profil RP : le grade à vérifier est celui du profil,
      // pas la liste brute des rôles Discord du joueur.
      const db = await connect();
      const assignedProfile = await db.collection('profils').findOne({
        _id: String(beforeDocument.assignedProfileId),
        categoryId: String(ctx.def.categoryRoleId),
      }, { projection: { userId: 1, roleId: 1 } });
      const profileRoleId = String(assignedProfile?.roleId || '');
      if (!assignedProfile?.userId || !discordReady()) {
        clearAssignedPilot = true;
      } else {
        const assignedMember = await discordGet(`/guilds/${process.env.GUILD_ID}/members/${encodeURIComponent(String(assignedProfile.userId))}`);
        const assignedRoles = new Set((assignedMember.roles || []).map(String));
        const stillInFaction = assignedRoles.has(String(ctx.def.categoryRoleId))
          || (ctx.def.grades || []).some(grade => assignedRoles.has(String(grade.id)));
        const stillAllowed = req.body.roleIds.length === 0
          || (profileRoleId && req.body.roleIds.map(String).includes(profileRoleId) && assignedRoles.has(profileRoleId));
        clearAssignedPilot = !stillInFaction || !stillAllowed;
      }
    } else if (beforeDocument?.assignedUserId) {
      // Compatibilité avec les anciens vaisseaux attribués directement à un membre Discord.
      const assigned = await discordGet(`/guilds/${process.env.GUILD_ID}/members/${encodeURIComponent(String(beforeDocument.assignedUserId))}`);
      const assignedRoles = new Set((assigned.roles || []).map(String));
      const stillInFaction = assignedRoles.has(String(ctx.def.categoryRoleId));
      const stillAllowed = req.body.roleIds.length === 0 || req.body.roleIds.some(roleId => assignedRoles.has(String(roleId)));
      clearAssignedPilot = !stillInFaction || !stillAllowed;
    }
    const updated = await store.setShipAllowedGrades(ctx.ship.id, req.body.roleIds, { clearAssignedPilot });
    const afterDocument = await store.getShipRecord(ctx.ship.id);
    if (recordEntityHistory) await recordEntityHistory(req, { entityType: 'vaisseau', collectionName: 'faction_ships', beforeDocument, afterDocument, action: 'permissions de grade modifiées', entityName: updated.name });
    logFromReq(req, 'faction_vaisseau_grades', `${ctx.def.label} : permissions de grade de ${updated.name} modifiées.`);
    res.json(updated);
  }));

  app.put('/api/factions/:key/vaisseaux/:shipId/pilote', wrap(async (req, res) => {
    const ctx = await ownShip(req, res); if (!ctx) return;
    const profileId = req.body?.profileId ? String(req.body.profileId) : null;
    let userId = null;
    let member = {};
    let profile = null;
    if (profileId) {
      const db = await connect();
      profile = await db.collection('profils').findOne({
        _id: profileId,
        categoryId: String(ctx.def.categoryRoleId),
        userId: { $exists: true, $nin: [null, ''] },
      }, { projection: { _id: 1, userId: 1, nomPrenom: 1, roleId: 1, roleName: 1 } });
      if (!profile) throw new Error('Ce profil RP ne fait pas partie de cette faction ou aucun joueur Discord ne lui est associé.');

      userId = String(profile.userId);
      if (!discordReady()) throw new Error('La connexion au bot Discord est indisponible : impossible de vérifier le propriétaire du profil.');
      const target = await discordGet(`/guilds/${process.env.GUILD_ID}/members/${encodeURIComponent(userId)}`);
      const ownerRoles = new Set((target.roles || []).map(String));
      const belongsToFaction = ownerRoles.has(String(ctx.def.categoryRoleId))
        || (ctx.def.grades || []).some(grade => ownerRoles.has(String(grade.id)));
      if (!belongsToFaction) throw new Error('Le propriétaire de ce profil ne possède plus de rôle dans cette faction.');
      member = {
        inFaction: true,
        gradeRoleIds: profile.roleId && ownerRoles.has(String(profile.roleId)) ? [String(profile.roleId)] : [],
        profileId: String(profile._id),
        profileName: String(profile.nomPrenom || profile._id),
        profileRoleName: String(profile.roleName || ''),
      };
    }
    const beforeDocument = await store.getShipRecord(ctx.ship.id);
    const updated = await store.assignShip(ctx.ship.id, userId, member);
    const afterDocument = await store.getShipRecord(ctx.ship.id);
    if (recordEntityHistory) await recordEntityHistory(req, { entityType: 'vaisseau', collectionName: 'faction_ships', beforeDocument, afterDocument, action: 'changement de pilote', entityName: updated.name });
    logFromReq(req, 'faction_vaisseau_pilote', `${ctx.def.label} : ${updated.name} → ${profile ? `${profile.nomPrenom || profile._id} (${userId})` : 'personne'}`);
    res.json(updated);
  }));
}

module.exports = { register };