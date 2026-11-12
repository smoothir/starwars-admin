// Données des factions : troupes, chef, inventaire/crédits, vaisseaux.
// ⚠️ Ce fichier existe en DOUBLE (bot : Data/factionStore.js, site : Data/factionStore.js).
// Toute modification doit être reportée dans les deux dépôts : les deux utilisent
// les mêmes collections MongoDB ("factions" et "faction_ships").
const crypto = require('crypto');
const config = require('./config.js');
const { connect } = require('./mongo.js');
const { SHIP_CLASSES, canPilot } = require('./shipClasses.js');

const COLLECTION_FACTIONS = 'factions';
const COLLECTION_SHIPS = 'faction_ships';
const CREDITS_ITEM_ID = 'credits_de_la_nouvelle_republique';

async function factionsCol() { return (await connect()).collection(COLLECTION_FACTIONS); }
async function shipsCol() { return (await connect()).collection(COLLECTION_SHIPS); }
async function catalogCol() { return (await connect()).collection('item_catalog'); }

/** Factions jouables = celles déclarées dans config.FACTIONS (catégories de rôles Discord). */
function listFactionDefs() {
  return Object.entries(config.FACTIONS).map(([key, f]) => ({ key, label: f.label, categoryRoleId: f.categoryRoleId }));
}
function getFactionDef(key) {
  const f = config.FACTIONS[key];
  return f ? { key, label: f.label, categoryRoleId: f.categoryRoleId } : null;
}

function toInt(value, { min = 0, max = 1_000_000_000, fallback = 0 } = {}) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// ---------------------------------------------------------------- état de faction
function normalizeState(key, doc) {
  const items = {};
  for (const [id, qty] of Object.entries(doc?.items || {})) {
    const q = Number(qty);
    if (Number.isFinite(q) && q > 0) items[id] = Math.floor(q);
  }
  return {
    key,
    troops: toInt(doc?.troops),
    leaderUserId: doc?.leaderUserId || null,
    items,
    credits: items[CREDITS_ITEM_ID] || 0,
  };
}

async function getFactionState(key) {
  if (!getFactionDef(key)) return null;
  const col = await factionsCol();
  return normalizeState(key, await col.findOne({ _id: key }));
}

async function setTroops(key, troops) {
  if (!getFactionDef(key)) throw new Error('Faction inconnue.');
  const col = await factionsCol();
  await col.updateOne({ _id: key }, { $set: { troops: toInt(troops), updatedAt: new Date() } }, { upsert: true });
  return getFactionState(key);
}

/** Ajoute / retire des troupes de façon atomique (jamais sous 0). Renvoie le nouveau total. */
async function adjustTroops(key, delta) {
  if (!getFactionDef(key)) throw new Error('Faction inconnue.');
  const col = await factionsCol();
  const res = await col.findOneAndUpdate(
    { _id: key },
    [{ $set: { troops: { $max: [0, { $add: [{ $ifNull: ['$troops', 0] }, Math.trunc(Number(delta) || 0)] }] }, updatedAt: new Date() } }],
    { upsert: true, returnDocument: 'after' },
  );
  const doc = res && 'lastErrorObject' in res ? res.value : res;
  return toInt(doc?.troops);
}

async function setLeader(key, userId) {
  if (!getFactionDef(key)) throw new Error('Faction inconnue.');
  const col = await factionsCol();
  await col.updateOne({ _id: key }, { $set: { leaderUserId: userId ? String(userId) : null, updatedAt: new Date() } }, { upsert: true });
  return getFactionState(key);
}

// ---------------------------------------------------------------- inventaire de faction
async function setFactionItem(key, itemId, quantity) {
  if (!getFactionDef(key)) throw new Error('Faction inconnue.');
  const id = String(itemId || '').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Identifiant d\'objet invalide.');
  const catalog = await catalogCol();
  if (!(await catalog.findOne({ _id: id }, { projection: { _id: 1 } }))) throw new Error(`Objet inconnu (${id}).`);
  const col = await factionsCol();
  const qty = toInt(quantity);
  const update = qty > 0
    ? { $set: { [`items.${id}`]: qty, updatedAt: new Date() } }
    : { $unset: { [`items.${id}`]: '' }, $set: { updatedAt: new Date() } };
  await col.updateOne({ _id: key }, update, { upsert: true });
  return getFactionState(key);
}

/** Ajoute (delta > 0) ou retire (delta < 0) un objet, de façon atomique et sans passer sous 0. */
async function adjustFactionItem(key, itemId, delta) {
  if (!getFactionDef(key)) throw new Error('Faction inconnue.');
  const id = String(itemId || '').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Identifiant d\'objet invalide.');
  const col = await factionsCol();
  await col.updateOne(
    { _id: key },
    [{ $set: { [`items.${id}`]: { $max: [0, { $add: [{ $ifNull: [`$items.${id}`, 0] }, Math.trunc(Number(delta) || 0)] }] }, updatedAt: new Date() } }],
    { upsert: true },
  );
  return getFactionState(key);
}

// ---------------------------------------------------------------- vaisseaux
function normalizeShipFields(body, { partial = false } = {}) {
  const b = body || {};
  const out = {};
  if (!partial || b.name !== undefined) {
    const name = String(b.name || '').trim().slice(0, 60);
    if (!name) throw new Error('Le nom du vaisseau est obligatoire.');
    out.name = name;
  }
  if (!partial || b.classKey !== undefined) {
    const classKey = String(b.classKey || '').trim();
    if (!SHIP_CLASSES[classKey]) throw new Error('Classe de vaisseau invalide.');
    out.classKey = classKey;
  }
  const cls = SHIP_CLASSES[out.classKey || b.classKey];
  const d = cls?.defaults || {};
  // Valeurs par défaut de la classe, indexées par le nom du champ du vaisseau.
  const fallback = { hpMax: d.hp, shieldMax: d.shield, crewMax: d.crew, range: d.range, barrage: d.barrage, focus: d.focus, squadrons: cls?.squadrons, mapWidth: d.mapWidth, mapLength: d.mapLength };
  const limits = { hpMax: { min: 1, max: 1_000_000 }, shieldMax: { max: 1_000_000 }, crewMax: { max: 1_000_000 }, range: { min: 1, max: 50 }, barrage: { max: 100_000 }, focus: { max: 100_000 }, squadrons: { max: 1000 }, mapWidth: { min: 1, max: 6 }, mapLength: { min: 1, max: 10 } };
  for (const field of Object.keys(fallback)) {
    if (partial && b[field] === undefined) continue;
    const raw = b[field] === undefined || b[field] === null || b[field] === '' ? fallback[field] : b[field];
    out[field] = toInt(raw, { ...limits[field], fallback: fallback[field] ?? 0 });
  }
  return out;
}

function shipFromDoc(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    factionKey: doc.factionKey,
    name: doc.name,
    classKey: doc.classKey,
    className: SHIP_CLASSES[doc.classKey]?.label || doc.classKey,
    hpMax: toInt(doc.hpMax), hp: toInt(doc.hp ?? doc.hpMax),
    shieldMax: toInt(doc.shieldMax), shield: toInt(doc.shield ?? doc.shieldMax),
    crewMax: toInt(doc.crewMax), crew: toInt(doc.crew ?? doc.crewMax),
    squadrons: toInt(doc.squadrons),
    mapWidth: toInt(doc.mapWidth, { min: 1, max: 6, fallback: SHIP_CLASSES[doc.classKey]?.defaults?.mapWidth || 1 }),
    mapLength: toInt(doc.mapLength, { min: 1, max: 10, fallback: SHIP_CLASSES[doc.classKey]?.defaults?.mapLength || 1 }),
    range: toInt(doc.range, { min: 1, max: 50, fallback: 1 }),
    barrage: toInt(doc.barrage), focus: toInt(doc.focus),
    assignedUserId: doc.assignedUserId || null,
  };
}

async function listShips(factionKey) {
  const col = await shipsCol();
  const docs = await col.find(factionKey ? { factionKey } : {}).sort({ name: 1 }).toArray();
  return docs.map(shipFromDoc);
}
async function getShip(shipId) {
  const col = await shipsCol();
  return shipFromDoc(await col.findOne({ _id: String(shipId) }));
}

async function createShip(factionKey, body) {
  if (!getFactionDef(factionKey)) throw new Error('Faction inconnue.');
  const fields = normalizeShipFields(body);
  const now = new Date();
  const doc = {
    _id: `ship_${crypto.randomBytes(6).toString('hex')}`,
    factionKey,
    ...fields,
    hp: fields.hpMax, shield: fields.shieldMax, crew: fields.crewMax,
    assignedUserId: null,
    createdAt: now, updatedAt: now,
  };
  const col = await shipsCol();
  await col.insertOne(doc);
  return shipFromDoc(doc);
}

async function updateShip(shipId, body) {
  const col = await shipsCol();
  const before = await col.findOne({ _id: String(shipId) });
  if (!before) throw new Error('Vaisseau introuvable.');
  const fields = normalizeShipFields({ classKey: before.classKey, ...body }, { partial: true });
  // Les valeurs « actuelles » (PV, bouclier, équipage) sont remises au maximum à chaque modification.
  const set = { ...fields, updatedAt: new Date() };
  if (fields.hpMax !== undefined) set.hp = fields.hpMax;
  if (fields.shieldMax !== undefined) set.shield = fields.shieldMax;
  if (fields.crewMax !== undefined) set.crew = fields.crewMax;
  await col.updateOne({ _id: String(shipId) }, { $set: set });
  return getShip(shipId);
}

async function deleteShip(shipId) {
  const col = await shipsCol();
  const res = await col.deleteOne({ _id: String(shipId) });
  return res.deletedCount === 1;
}

/**
 * Attribue (ou retire, userId = null) un vaisseau à un joueur, en vérifiant le grade.
 * @param {object} member  { rankIndex:number, inFaction:boolean, isLeader:boolean } du joueur ciblé
 */
async function assignShip(shipId, userId, member = {}) {
  const col = await shipsCol();
  const ship = await col.findOne({ _id: String(shipId) });
  if (!ship) throw new Error('Vaisseau introuvable.');
  if (!userId) {
    await col.updateOne({ _id: ship._id }, { $set: { assignedUserId: null, updatedAt: new Date() } });
    return getShip(shipId);
  }
  if (!member.inFaction) throw new Error('Ce joueur ne fait pas partie de la faction du vaisseau.');
  const check = canPilot(ship.classKey, member.rankIndex ?? -1, Boolean(member.isLeader));
  if (!check.ok) throw new Error(check.reason);
  await col.updateOne({ _id: ship._id }, { $set: { assignedUserId: String(userId), updatedAt: new Date() } });
  return getShip(shipId);
}

/** Remet PV, bouclier et équipage d'un vaisseau au maximum (réparations après une bataille). */
async function repairShip(shipId) {
  const col = await shipsCol();
  const ship = await col.findOne({ _id: String(shipId) });
  if (!ship) return null;
  await col.updateOne({ _id: ship._id }, { $set: { hp: ship.hpMax, shield: ship.shieldMax, crew: ship.crewMax, updatedAt: new Date() } });
  return getShip(shipId);
}

/** Change un vaisseau de faction (capture) : il n'a plus de pilote et est remis en état. */
async function transferShip(shipId, newFactionKey) {
  if (!getFactionDef(newFactionKey)) throw new Error('Faction inconnue.');
  const col = await shipsCol();
  const ship = await col.findOne({ _id: String(shipId) });
  if (!ship) return null;
  await col.updateOne({ _id: ship._id }, { $set: { factionKey: newFactionKey, assignedUserId: null, hp: ship.hpMax, shield: ship.shieldMax, crew: ship.crewMax, updatedAt: new Date() } });
  return getShip(shipId);
}

module.exports = {
  repairShip, transferShip,
  CREDITS_ITEM_ID,
  listFactionDefs, getFactionDef,
  getFactionState, setTroops, adjustTroops, setLeader,
  setFactionItem, adjustFactionItem,
  listShips, getShip, createShip, updateShip, deleteShip, assignShip,
};
