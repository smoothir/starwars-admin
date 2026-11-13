// Stockage commun des factions et des vaisseaux (bot + site).
const crypto = require('crypto');
const config = require('./config.js');
const { connect } = require('./mongo.js');
const { SHIP_CLASSES, canPilot } = require('./shipClasses.js');
const COLLECTION_FACTIONS = 'factions';
const COLLECTION_SHIPS = 'faction_ships';
const COLLECTION_CLASS_SETTINGS = 'ship_class_settings';
const CREDITS_ITEM_ID = 'credits_de_la_nouvelle_republique';
async function factionsCol() { return (await connect()).collection(COLLECTION_FACTIONS); }
async function shipsCol() { return (await connect()).collection(COLLECTION_SHIPS); }
async function catalogCol() { return (await connect()).collection('item_catalog'); }
function listFactionDefs() { return Object.entries(config.FACTIONS).map(([key, f]) => ({ key, label: f.label, categoryRoleId: f.categoryRoleId })); }
function getFactionDef(key) { const f = config.FACTIONS[key]; return f ? { key, label: f.label, categoryRoleId: f.categoryRoleId } : null; }
function toInt(value, { min = 0, max = 1_000_000_000, fallback = 0 } = {}) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
function normalizeState(key, doc) {
  const items = {};
  for (const [id, qty] of Object.entries(doc?.items || {})) { const q = Number(qty); if (Number.isFinite(q) && q > 0) items[id] = Math.floor(q); }
  return { key, troops: toInt(doc?.troops), leaderUserId: doc?.leaderUserId || null, reputation: toInt(doc?.reputation, { min: 0, max: 100, fallback: 50 }), items, credits: items[CREDITS_ITEM_ID] || 0 };
}
async function getFactionState(key) {
  if (!getFactionDef(key)) return null;
  const col = await factionsCol();
  return normalizeState(key, await col.findOne({ _id: key }));
}
async function setTroops(key, troops) {
  if (!getFactionDef(key)) throw new Error('Faction inconnue.');
  await (await factionsCol()).updateOne({ _id: key }, { $set: { troops: toInt(troops), updatedAt: new Date() } }, { upsert: true });
  return getFactionState(key);
}
async function adjustTroops(key, delta) {
  if (!getFactionDef(key)) throw new Error('Faction inconnue.');
  const res = await (await factionsCol()).findOneAndUpdate({ _id: key }, [{ $set: { troops: { $max: [0, { $add: [{ $ifNull: ['$troops', 0] }, Math.trunc(Number(delta) || 0)] }] }, updatedAt: new Date() } }], { upsert: true, returnDocument: 'after' });
  const doc = res && 'lastErrorObject' in res ? res.value : res;
  return toInt(doc?.troops);
}
async function setLeader(key, userId) {
  if (!getFactionDef(key)) throw new Error('Faction inconnue.');
  await (await factionsCol()).updateOne({ _id: key }, { $set: { leaderUserId: userId ? String(userId) : null, updatedAt: new Date() } }, { upsert: true });
  return getFactionState(key);
}
async function setReputation(key, value) {
  if (!getFactionDef(key)) throw new Error('Faction inconnue.');
  const reputation = toInt(value, { min: 0, max: 100, fallback: 50 });
  await (await factionsCol()).updateOne({ _id: key }, { $set: { reputation, updatedAt: new Date() } }, { upsert: true });
  return getFactionState(key);
}
async function setFactionItem(key, itemId, quantity) {
  if (!getFactionDef(key)) throw new Error('Faction inconnue.');
  const id = String(itemId || '').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Identifiant d'objet invalide.");
  if (!(await (await catalogCol()).findOne({ _id: id }, { projection: { _id: 1 } }))) throw new Error(`Objet inconnu (${id}).`);
  const qty = toInt(quantity);
  const update = qty > 0 ? { $set: { [`items.${id}`]: qty, updatedAt: new Date() } } : { $unset: { [`items.${id}`]: '' }, $set: { updatedAt: new Date() } };
  await (await factionsCol()).updateOne({ _id: key }, update, { upsert: true });
  return getFactionState(key);
}
async function adjustFactionItem(key, itemId, delta) {
  if (!getFactionDef(key)) throw new Error('Faction inconnue.');
  const id = String(itemId || '').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Identifiant d'objet invalide.");
  await (await factionsCol()).updateOne({ _id: key }, [{ $set: { [`items.${id}`]: { $max: [0, { $add: [{ $ifNull: [`$items.${id}`, 0] }, Math.trunc(Number(delta) || 0)] }] }, updatedAt: new Date() } }], { upsert: true });
  return getFactionState(key);
}
async function assertShipNotInBattle(shipId) {
  const db = await connect();
  const active = await db.collection('battles').findOne({ status: { $in: ['preparation', 'active'] }, 'ships.id': String(shipId) }, { projection: { _id: 1, status: 1 } });
  if (active) throw new Error(`Modification impossible : ce vaisseau participe à la bataille ${active._id} (${active.status}).`);
}
function normalizeShipFields(body, { partial = false, resetClassDefaults = false } = {}) {
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
  const fallback = { hpMax: d.hp, shieldMax: d.shield, crewMax: d.crew, range: d.range, barrage: d.barrage, focus: d.focus, squadrons: cls?.squadrons };
  const limits = { hpMax: { min: 1, max: 1_000_000 }, shieldMax: { max: 1_000_000 }, crewMax: { max: 1_000_000 }, range: { min: 1, max: 50 }, barrage: { max: 100_000 }, focus: { max: 100_000 }, squadrons: { max: 1000 } };
  for (const field of Object.keys(fallback)) {
    if (partial && !resetClassDefaults && b[field] === undefined) continue;
    const raw = b[field] === undefined || b[field] === null || b[field] === '' ? fallback[field] : b[field];
    out[field] = toInt(raw, { ...limits[field], fallback: fallback[field] ?? 0 });
  }
  return out;
}
function shipFromDoc(doc) {
  if (!doc) return null;
  const cls = SHIP_CLASSES[doc.classKey];
  return {
    id: String(doc._id), factionKey: doc.factionKey, name: doc.name, classKey: doc.classKey,
    classId: cls?.id || null, className: cls?.label || doc.classKey,
    hpMax: toInt(doc.hpMax), hp: toInt(doc.hp ?? doc.hpMax),
    shieldMax: toInt(doc.shieldMax), shield: toInt(doc.shield ?? doc.shieldMax),
    crewMax: toInt(doc.crewMax), crew: toInt(doc.crew ?? doc.crewMax),
    squadrons: toInt(doc.squadrons),
    mapWidth: toInt(cls?.defaults?.mapWidth, { min: 1, max: 6, fallback: 1 }),
    mapLength: toInt(cls?.defaults?.mapLength, { min: 1, max: 10, fallback: 1 }),
    range: toInt(doc.range, { min: 1, max: 50, fallback: 1 }), barrage: toInt(doc.barrage), focus: toInt(doc.focus),
    assignedUserId: doc.assignedUserId || null,
  };
}
async function listShips(factionKey) {
  const docs = await (await shipsCol()).find(factionKey ? { factionKey } : {}).sort({ name: 1 }).toArray();
  return docs.map(shipFromDoc);
}
async function getShipRecord(shipId) { return (await shipsCol()).findOne({ _id: String(shipId) }); }
async function getShip(shipId) { return shipFromDoc(await getShipRecord(shipId)); }
async function createShip(factionKey, body) {
  if (!getFactionDef(factionKey)) throw new Error('Faction inconnue.');
  const fields = normalizeShipFields(body);
  const now = new Date();
  const doc = { _id: `ship_${crypto.randomBytes(6).toString('hex')}`, factionKey, ...fields, hp: fields.hpMax, shield: fields.shieldMax, crew: fields.crewMax, assignedUserId: null, createdAt: now, updatedAt: now };
  await (await shipsCol()).insertOne(doc);
  return shipFromDoc(doc);
}
async function updateShip(shipId, body) {
  await assertShipNotInBattle(shipId);
  const col = await shipsCol();
  const before = await col.findOne({ _id: String(shipId) });
  if (!before) throw new Error('Vaisseau introuvable.');
  const classKey = body?.classKey === undefined ? before.classKey : String(body.classKey);
  const classChanged = classKey !== before.classKey;
  const fields = normalizeShipFields({ classKey: before.classKey, ...body }, { partial: true, resetClassDefaults: classChanged });
  const set = { ...fields, updatedAt: new Date() };
  if (fields.hpMax !== undefined) set.hp = Math.min(toInt(before.hp ?? before.hpMax), fields.hpMax);
  if (fields.shieldMax !== undefined) set.shield = Math.min(toInt(before.shield ?? before.shieldMax), fields.shieldMax);
  if (fields.crewMax !== undefined) set.crew = Math.min(toInt(before.crew ?? before.crewMax), fields.crewMax);
  // Les anciens mapWidth/mapLength restent ignorés : l'empreinte vient de SHIP_CLASSES.
  await col.updateOne({ _id: String(shipId) }, { $set: set, $unset: { mapWidth: '', mapLength: '' } });
  return getShip(shipId);
}
async function deleteShip(shipId) {
  await assertShipNotInBattle(shipId);
  const res = await (await shipsCol()).deleteOne({ _id: String(shipId) });
  return res.deletedCount === 1;
}
async function assignShip(shipId, userId, member = {}) {
  await assertShipNotInBattle(shipId);
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
async function repairShip(shipId) {
  await assertShipNotInBattle(shipId);
  const col = await shipsCol();
  const ship = await col.findOne({ _id: String(shipId) });
  if (!ship) return null;
  await col.updateOne({ _id: ship._id }, { $set: { hp: ship.hpMax, shield: ship.shieldMax, crew: ship.crewMax, updatedAt: new Date() } });
  return getShip(shipId);
}
async function transferShip(shipId, newFactionKey) {
  if (!getFactionDef(newFactionKey)) throw new Error('Faction inconnue.');
  await assertShipNotInBattle(shipId);
  const col = await shipsCol();
  const ship = await col.findOne({ _id: String(shipId) });
  if (!ship) return null;
  await col.updateOne({ _id: ship._id }, { $set: { factionKey: newFactionKey, assignedUserId: null, hp: ship.hpMax, shield: ship.shieldMax, crew: ship.crewMax, updatedAt: new Date() } });
  return getShip(shipId);
}
async function listShipClassImages() {
  const docs = await (await connect()).collection(COLLECTION_CLASS_SETTINGS).find({}).toArray();
  return Object.fromEntries(docs.filter(d => d.filename).map(d => [d._id, d.filename]));
}
function imageValueToBuffer(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value.buffer && (Buffer.isBuffer(value.buffer) || value.buffer instanceof Uint8Array)) {
    const length = Number.isInteger(value.position) ? value.position : value.buffer.length;
    return Buffer.from(value.buffer).subarray(0, length);
  }
  if (typeof value.value === 'function') {
    try { return Buffer.from(value.value(true)); } catch { /* format BSON alternatif */ }
  }
  try { return Buffer.from(value); } catch { return null; }
}
async function getShipClassImageBuffer(classKey) {
  if (!SHIP_CLASSES[classKey]) return null;
  const doc = await (await connect()).collection(COLLECTION_CLASS_SETTINGS).findOne(
    { _id: classKey }, { projection: { imageData: 1 } },
  );
  return imageValueToBuffer(doc?.imageData);
}
async function setShipClassImage(classKey, filename, imageData = null) {
  if (!SHIP_CLASSES[classKey]) throw new Error('Classe de vaisseau inconnue.');
  const safe = String(filename || '');
  const allowedBases = [SHIP_CLASSES[classKey].id, SHIP_CLASSES[classKey].imageBaseName]
    .filter(Boolean).map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!new RegExp(`^(?:${allowedBases.join('|')})\\.(?:png|jpe?g|webp|gif)$`, 'i').test(safe)) throw new Error('Nom de fichier d’image invalide.');
  const fields = { filename: safe, updatedAt: new Date() };
  if (imageData !== null && imageData !== undefined) {
    const buffer = Buffer.from(imageData);
    if (!buffer.length || buffer.length > 4 * 1024 * 1024) throw new Error('L’image doit peser 4 Mo maximum.');
    fields.imageData = buffer;
    fields.imageSize = buffer.length;
    fields.contentType = ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' })[safe.split('.').pop().toLowerCase()] || 'application/octet-stream';
  }
  await (await connect()).collection(COLLECTION_CLASS_SETTINGS).updateOne({ _id: classKey }, { $set: fields }, { upsert: true });
  return `/ship/${encodeURIComponent(safe)}`;
}
module.exports = {
  repairShip, transferShip, assertShipNotInBattle, getShipRecord, listShipClassImages, getShipClassImageBuffer, setShipClassImage,
  CREDITS_ITEM_ID, listFactionDefs, getFactionDef, getFactionState, setTroops, adjustTroops, setLeader, setReputation,
  setFactionItem, adjustFactionItem, listShips, getShip, createShip, updateShip, deleteShip, assignShip,
};
