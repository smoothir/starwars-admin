// Catalogue et inventaires partagés par le bot Discord et le site admin.
// Les deux projets utilisent volontairement ce même contrat et la même
// collection MongoDB : item_catalog (catalogue) et inv (inventaires).

const { getInvCollection, getItemCatalogCollection } = require('./mongo.js');
const { applyPermanentStatChange, addTemporaryStatEffect, normalizeStatName } = require('./profileStore.js');

const EQUIPMENT_SLOTS = ['casque', 'plastron', 'mainGauche', 'mainDroite', 'jambes', 'pieds'];
const EQUIPMENT_SLOT_LABELS = {
  casque: 'Casque', plastron: 'Plastron', mainGauche: 'Main gauche',
  mainDroite: 'Main droite', jambes: 'Jambes', pieds: 'Pieds',
};
const ITEM_RARITIES = ['Épique', 'Rare', 'Peu commun', 'Commun'];
const SEED_MARKER_ID = '__seeded__';
const MIGRATION_MARKER_ID = '__migrated_equipement__';
const RARITY_MIGRATION_MARKER_ID = '__migrated_rarete__';
const MARKER_IDS = [SEED_MARKER_ID, MIGRATION_MARKER_ID, RARITY_MIGRATION_MARKER_ID];
const RESERVED_ID = /^__.*__$/;
const MAX_IMAGE_DATAURL_LENGTH = 400 * 1024;

function emptyEquipement() {
  return Object.fromEntries(EQUIPMENT_SLOTS.map(slot => [slot, null]));
}

// Source de vérité unique pour le catalogue de départ. À maintenir identique
// côté bot et site ; les documents existants ne sont jamais écrasés au seed.
const DEFAULT_CATALOG = [
  { id: 'sabre_laser', name: 'Sabre laser', emoji: '🗡️', category: 'Arme', rarity: 'Commun', description: 'Arme rituelle forgée avec un cristal kyber.', slot: 'mainDroite', image: null, usable: true, statBonus: { 'Corps-à-corps': 15 } },
  { id: 'blaster', name: 'Pistolet blaster', emoji: '🔫', category: 'Arme', rarity: 'Commun', description: 'Arme de poing standard, à énergie.', slot: 'mainDroite', image: null, usable: true, statBonus: { 'Tir & Précision': 15 } },
  { id: 'fusil_blaster', name: 'Fusil blaster', emoji: '🔫', category: 'Arme', rarity: 'Commun', description: "Arme d'épaule à longue portée.", slot: 'mainDroite', image: null, usable: true, statBonus: { 'Tir & Précision': 20 } },
  { id: 'vibrolame', name: 'Vibrolame', emoji: '🔪', category: 'Arme', rarity: 'Commun', description: 'Lame vibrante, efficace même contre une armure légère.', slot: 'mainGauche', image: null, usable: true, statBonus: { 'Corps-à-corps': 10 } },
  { id: 'grenade_thermique', name: 'Détonateur thermique', emoji: '💣', category: 'Arme', rarity: 'Commun', description: 'Explosif portatif à haut rendement.', slot: null, image: null, usable: false, statBonus: {} },
  { id: 'armure_legere', name: 'Armure légère', emoji: '🦺', category: 'Équipement', rarity: 'Commun', description: 'Protection basique, ne gêne pas la mobilité.', slot: 'plastron', image: null, usable: true, statBonus: { 'Résistance': 12 } },
  { id: 'casque', name: 'Casque de combat', emoji: '⛑️', category: 'Équipement', rarity: 'Commun', description: 'Protection crânienne avec visée intégrée.', slot: 'casque', image: null, usable: true, statBonus: { 'Résistance': 8 } },
  { id: 'jetpack', name: 'Jetpack', emoji: '🚀', category: 'Équipement', rarity: 'Commun', description: 'Propulseur dorsal, vol de courte durée.', slot: 'plastron', image: null, usable: true, statBonus: { 'Pilotage': 10 } },
  { id: 'comlink', name: 'Comlink', emoji: '📡', category: 'Équipement', rarity: 'Commun', description: 'Communicateur longue portée.', slot: null, image: null, usable: false, statBonus: {} },
  { id: 'kit_medical', name: 'Kit médical', emoji: '💉', category: 'Équipement', rarity: 'Commun', description: "Nécessaire de soin d'urgence.", slot: null, image: null, usable: false, statBonus: {} },
  { id: 'macrobinoculaire', name: 'Macrobinoculaire', emoji: '🔭', category: 'Équipement', rarity: 'Commun', description: 'Optique longue portée.', slot: null, image: null, usable: false, statBonus: {} },
  { id: 'outils_reparation', name: 'Outils de réparation', emoji: '🔧', category: 'Équipement', rarity: 'Commun', description: 'Nécessaire pour réparer droïdes et vaisseaux.', slot: null, image: null, usable: false, statBonus: {} },
  { id: 'bottes_combat', name: 'Bottes de combat', emoji: '🥾', category: 'Équipement', rarity: 'Commun', description: 'Renforcées, bonne accroche au sol.', slot: 'pieds', image: null, usable: true, statBonus: { 'Résistance': 5 } },
  { id: 'pantalon_renforce', name: 'Pantalon renforcé', emoji: '👖', category: 'Équipement', rarity: 'Commun', description: 'Protection légère pour les jambes.', slot: 'jambes', image: null, usable: true, statBonus: { 'Résistance': 7 } },
  { id: 'credits', name: 'Crédits galactiques', emoji: '💰', category: 'Ressource', rarity: 'Commun', description: 'La monnaie standard de la galaxie.', slot: null, image: null, usable: false, statBonus: {} },
  { id: 'cristal_kyber', name: 'Cristal kyber', emoji: '💎', category: 'Ressource', rarity: 'Commun', description: 'Cristal rare, sensible à la Force.', slot: null, image: null, usable: false, statBonus: {} },
  { id: 'carburant', name: 'Carburant (bidon)', emoji: '⛽', category: 'Ressource', rarity: 'Commun', description: 'Carburant pour vaisseau ou speeder.', slot: null, image: null, usable: false, statBonus: {} },
  { id: 'rations', name: 'Rations de survie', emoji: '🍱', category: 'Ressource', rarity: 'Commun', description: 'Nourriture longue conservation.', slot: null, image: null, usable: false, statBonus: {} },
  { id: 'datapad', name: 'Datapad', emoji: '📓', category: 'Divers', rarity: 'Commun', description: 'Tablette de données portable.', slot: null, image: null, usable: false, statBonus: {} },
  { id: 'holoprojecteur', name: 'Holoprojecteur', emoji: '📽️', category: 'Divers', rarity: 'Commun', description: 'Projette des messages ou cartes en hologramme.', slot: null, image: null, usable: false, statBonus: {} },
  { id: 'cape', name: 'Cape', emoji: '🧥', category: 'Divers', rarity: 'Commun', description: "Vêtement d'extérieur, souvent à capuche.", slot: null, image: null, usable: false, statBonus: {} },
];

const isReservedId = (id) => RESERVED_ID.test(String(id || ''));
function slugify(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}
function normalizeRarity(value) {
  if (value === undefined || value === null || value === '') return 'Commun';
  const rarity = String(value).trim();
  if (!ITEM_RARITIES.includes(rarity)) throw new Error(`Rareté invalide : ${rarity}`);
  return rarity;
}
function normalizeSlot(slot) {
  if (slot === undefined) return undefined;
  if (slot === null || slot === '') return null;
  if (!EQUIPMENT_SLOTS.includes(slot)) throw new Error(`Emplacement invalide : ${slot}`);
  return slot;
}
function normalizeImage(image) {
  if (image === undefined) return undefined;
  if (image === null || image === '') return null;
  if (typeof image !== 'string') throw new Error('Image invalide.');
  const value = image.trim();
  if (/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value)) {
    if (value.length > MAX_IMAGE_DATAURL_LENGTH) throw new Error('Image trop lourde (max ~300 Ko).');
    return value;
  }
  if (/^https?:\/\/\S{1,500}$/.test(value) || /^\/(?:image|ship)\/[\w\-./]+$/.test(value)) return value;
  throw new Error('Image invalide (PNG, JPEG, WebP ou GIF attendu).');
}
function normalizeStatBonus(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Bonus de statistiques invalide.');
  const result = {};
  for (const [stat, raw] of Object.entries(value)) {
    const amount = Math.round(Number(raw));
    if (!Number.isFinite(amount) || amount === 0) continue;
    const canonicalStat = normalizeStatName(stat);
    result[canonicalStat.slice(0, 100)] = (result[canonicalStat.slice(0, 100)] || 0) + amount;
  }
  return result;
}
function normalizeUseAction(useAction) {
  if (useAction === undefined || useAction === null || useAction === '' || useAction?.type === 'aucune') return null;
  if (typeof useAction !== 'object' || Array.isArray(useAction)) throw new Error("Utilité d'objet invalide.");
  const type = String(useAction.type || 'aucune');
  if (type === 'donner_objet') {
    const itemId = String(useAction.itemId || '').trim();
    const quantity = Math.max(1, Math.floor(Number(useAction.quantity) || 1));
    if (!itemId || isReservedId(itemId)) throw new Error("L'objet à donner est obligatoire.");
    return { type, itemId, quantity };
  }
  if (type === 'message') {
    const message = String(useAction.message || '').trim();
    if (!message) throw new Error('Le message à envoyer est obligatoire.');
    return { type, message: message.slice(0, 2000) };
  }
  if (type === 'stat') {
    const stat = normalizeStatName(useAction.stat);
    const amount = Math.round(Number(useAction.amount) || 0);
    const mode = useAction.mode === 'temporaire' ? 'temporaire' : 'permanent';
    const durationMinutes = Math.max(1, Math.floor(Number(useAction.durationMinutes) || 1));
    if (!stat || !amount) throw new Error('Statistique et valeur de modification obligatoires.');
    return { type, stat: stat.slice(0, 100), amount, mode, durationMinutes };
  }
  throw new Error(`Utilité inconnue : ${type}`);
}
function toItem(doc) {
  return {
    id: String(doc._id), name: doc.name || String(doc._id), emoji: doc.emoji || '❔',
    category: doc.category || 'Divers', rarity: normalizeRarity(doc.rarity),
    description: doc.description || '', useAction: normalizeUseAction(doc.useAction),
    slot: doc.slot || null, image: doc.image || null, usable: Boolean(doc.usable),
    statBonus: normalizeStatBonus(doc.statBonus),
  };
}

let catalogInitializationPromise = null;
async function ensureCatalogInitialized(col) {
  if (catalogInitializationPromise) return catalogInitializationPromise;
  catalogInitializationPromise = (async () => {
    const seeded = await col.findOne({ _id: SEED_MARKER_ID }, { projection: { _id: 1 } });
    if (!seeded) {
      const operations = DEFAULT_CATALOG.map(item => ({
        updateOne: { filter: { _id: item.id }, update: { $setOnInsert: { ...item, _id: item.id } }, upsert: true },
      }));
      if (operations.length) await col.bulkWrite(operations, { ordered: false });
      await col.updateOne({ _id: SEED_MARKER_ID }, { $setOnInsert: { seededAt: new Date() } }, { upsert: true });
    }

    const migrated = await col.findOne({ _id: MIGRATION_MARKER_ID }, { projection: { _id: 1 } });
    if (!migrated) {
      const operations = DEFAULT_CATALOG.map(item => ({
        updateOne: {
          filter: { _id: item.id, usable: { $exists: false } },
          update: { $set: { slot: item.slot, image: item.image, usable: item.usable, statBonus: item.statBonus } },
        },
      }));
      if (operations.length) await col.bulkWrite(operations, { ordered: false });
      await col.updateOne({ _id: MIGRATION_MARKER_ID }, { $setOnInsert: { migratedAt: new Date() } }, { upsert: true });
    }

    const rarityMigrated = await col.findOne({ _id: RARITY_MIGRATION_MARKER_ID }, { projection: { _id: 1 } });
    if (!rarityMigrated) {
      await col.updateMany({ _id: { $not: RESERVED_ID }, rarity: { $exists: false } }, { $set: { rarity: 'Commun' } });
      await col.updateOne({ _id: RARITY_MIGRATION_MARKER_ID }, { $setOnInsert: { migratedAt: new Date() } }, { upsert: true });
    }
  })().catch(error => {
    catalogInitializationPromise = null;
    throw error;
  });
  return catalogInitializationPromise;
}
async function catalogCollection() {
  const col = await getItemCatalogCollection();
  await ensureCatalogInitialized(col);
  return col;
}
async function getCatalog() {
  const col = await catalogCollection();
  const docs = await col.find({ _id: { $not: RESERVED_ID } }).toArray();
  return docs.map(toItem).sort((a, b) => a.category.localeCompare(b.category, 'fr') || a.name.localeCompare(b.name, 'fr'));
}
async function getExistingCatalogIds(ids) {
  const col = await catalogCollection();
  const wanted = [...new Set((ids || []).map(String).filter(id => !isReservedId(id)))];
  if (!wanted.length) return new Set();
  const docs = await col.find({ _id: { $in: wanted } }, { projection: { _id: 1 } }).toArray();
  return new Set(docs.map(doc => String(doc._id)));
}
async function getCatalogMetadata() {
  const col = await catalogCollection();
  const embeddedImage = {
    $regexMatch: {
      input: { $convert: { input: '$image', to: 'string', onError: '', onNull: '' } },
      regex: '^data:image/(png|jpeg|webp|gif);base64,',
    },
  };
  const docs = await col.aggregate([
    { $match: { _id: { $not: RESERVED_ID } } },
    { $project: {
      _id: 1, name: 1, emoji: 1, category: 1, rarity: 1, description: 1,
      useAction: 1, slot: 1, usable: 1, statBonus: 1,
      image: { $cond: [embeddedImage, { $concat: ['/api/inventaire/catalogue/', { $toString: '$_id' }, '/image'] }, '$image'] },
    } },
  ]).toArray();
  return docs.map(toItem).sort((a, b) => a.category.localeCompare(b.category, 'fr') || a.name.localeCompare(b.name, 'fr'));
}
async function getCatalogImageData(itemId) {
  if (!itemId || isReservedId(itemId)) return null;
  const col = await catalogCollection();
  const doc = await col.findOne({ _id: String(itemId) }, { projection: { image: 1 } });
  if (typeof doc?.image !== 'string') return null;
  const match = doc.image.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
  return match ? { contentType: match[1], data: Buffer.from(match[2], 'base64') } : null;
}
async function getItem(itemId) {
  if (!itemId || isReservedId(itemId)) return null;
  const col = await catalogCollection();
  const doc = await col.findOne({ _id: String(itemId) });
  return doc ? toItem(doc) : null;
}

async function addCatalogItem({ id, name, emoji, category, rarity, description, image, slot, usable, statBonus, useAction }) {
  if (!String(name || '').trim()) throw new Error('Le nom est obligatoire.');
  const finalId = slugify(id || name);
  if (!finalId || isReservedId(finalId)) throw new Error('Identifiant de catalogue invalide.');
  const finalSlot = normalizeSlot(slot);
  const normalizedUseAction = normalizeUseAction(useAction);
  const col = await catalogCollection();
  if (normalizedUseAction?.type === 'donner_objet' && !(await col.findOne({ _id: normalizedUseAction.itemId }))) {
    throw new Error("L'objet à donner n'existe pas dans le catalogue.");
  }
  if (await col.findOne({ _id: finalId }, { projection: { _id: 1 } })) throw new Error(`Un objet avec l'identifiant "${finalId}" existe déjà.`);
  const doc = {
    _id: finalId, name: String(name).trim().slice(0, 100), emoji: String(emoji || '❔').slice(0, 32),
    category: String(category || 'Divers').slice(0, 80), rarity: normalizeRarity(rarity),
    description: String(description || '').slice(0, 2000), useAction: normalizedUseAction,
    slot: finalSlot || null, image: normalizeImage(image) || null,
    usable: finalSlot ? true : Boolean(usable), statBonus: normalizeStatBonus(statBonus),
    createdAt: new Date(), updatedAt: new Date(),
  };
  await col.insertOne(doc);
  return toItem(doc);
}

async function updateCatalogItem(itemId, { id, name, emoji, category, rarity, description, image, slot, usable, statBonus, useAction }) {
  const col = await catalogCollection();
  const oldDoc = await col.findOne({ _id: String(itemId) });
  if (!oldDoc || isReservedId(oldDoc._id)) throw new Error('Objet introuvable.');
  const requestedId = id === undefined || id === null || String(id).trim() === '' ? itemId : id;
  const newId = slugify(requestedId);
  if (!newId || isReservedId(newId)) throw new Error('Identifiant invalide.');
  if (newId !== String(itemId) && await col.findOne({ _id: newId }, { projection: { _id: 1 } })) {
    throw new Error(`Un objet avec l'identifiant "${newId}" existe déjà.`);
  }

  const fields = {};
  if (name !== undefined) fields.name = String(name).trim().slice(0, 100);
  if (emoji !== undefined) fields.emoji = String(emoji || '❔').slice(0, 32);
  if (category !== undefined) fields.category = String(category || 'Divers').slice(0, 80);
  if (rarity !== undefined) fields.rarity = normalizeRarity(rarity);
  if (description !== undefined) fields.description = String(description || '').slice(0, 2000);
  if (image !== undefined) fields.image = normalizeImage(image);
  if (slot !== undefined) { fields.slot = normalizeSlot(slot); if (fields.slot) fields.usable = true; }
  if (usable !== undefined) fields.usable = Boolean(usable);
  if (statBonus !== undefined) fields.statBonus = normalizeStatBonus(statBonus);
  if (useAction !== undefined) fields.useAction = normalizeUseAction(useAction);
  if (fields.useAction?.type === 'donner_objet' && !(await col.findOne({ _id: fields.useAction.itemId }))) {
    throw new Error("L'objet à donner n'existe pas dans le catalogue.");
  }
  fields.updatedAt = new Date();

  if (newId === String(itemId)) {
    const result = await col.findOneAndUpdate({ _id: String(itemId) }, { $set: fields }, { returnDocument: 'after' });
    const doc = result?.value || result;
    if (!doc) throw new Error('Objet introuvable.');
    return toItem(doc);
  }

  // Renommage : migre inventaires, emplacements et actions donnant cet objet.
  const newDoc = { ...oldDoc, ...fields, _id: newId };
  await col.insertOne(newDoc);
  try {
    const invCol = await getInvCollection();
    await invCol.updateMany({ [`items.${itemId}`]: { $exists: true } }, { $rename: { [`items.${itemId}`]: `items.${newId}` }, $set: { updatedAt: new Date() } });
    for (const slotName of EQUIPMENT_SLOTS) {
      await invCol.updateMany({ [`equipement.${slotName}`]: String(itemId) }, { $set: { [`equipement.${slotName}`]: newId, updatedAt: new Date() } });
    }
    await col.updateMany({ 'useAction.itemId': String(itemId) }, { $set: { 'useAction.itemId': newId, updatedAt: new Date() } });
    await col.deleteOne({ _id: String(itemId) });
  } catch (error) {
    await col.deleteOne({ _id: newId }).catch(() => {});
    throw error;
  }
  return toItem(newDoc);
}
async function removeCatalogItem(itemId) {
  if (isReservedId(itemId)) return false;
  const col = await catalogCollection();
  const result = await col.deleteOne({ _id: String(itemId) });
  return result.deletedCount > 0;
}
async function clearCatalog() {
  const col = await catalogCollection();
  const result = await col.deleteMany({ _id: { $not: RESERVED_ID } });
  return result.deletedCount || 0;
}

async function getInventory(profileId) {
  const col = await getInvCollection();
  const doc = await col.findOne({ _id: String(profileId) });
  return { _id: String(profileId), items: doc?.items || {}, equipement: { ...emptyEquipement(), ...(doc?.equipement || {}) }, updatedAt: doc?.updatedAt || null };
}
async function listAllInventories() {
  const col = await getInvCollection();
  return col.find({}).toArray();
}
async function addItem(profileId, itemId, quantity = 1) {
  const item = await getItem(itemId);
  if (!item) return { ok: false, reason: 'unknown_item' };
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));
  const col = await getInvCollection();
  await col.updateOne({ _id: String(profileId) }, { $inc: { [`items.${item.id}`]: qty }, $set: { updatedAt: new Date() } }, { upsert: true });
  const doc = await col.findOne({ _id: String(profileId) });
  return { ok: true, item, quantity: Number(doc?.items?.[item.id]) || 0 };
}
async function removeItem(profileId, itemId, quantity = 1, { exact = false } = {}) {
  const item = await getItem(itemId);
  if (!item) return { ok: false, reason: 'unknown_item' };
  const col = await getInvCollection();
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));
  const path = `items.${item.id}`;
  for (let attempt = 0; attempt < 8; attempt++) {
    const doc = await col.findOne({ _id: String(profileId) }, { projection: { [path]: 1 } });
    const current = Number(doc?.items?.[item.id]) || 0;
    if (current <= 0) return { ok: false, reason: 'not_owned', item };
    if (exact && current < qty) return { ok: false, reason: 'insufficient', item, owned: current };
    const removed = Math.min(qty, current);
    const remaining = current - removed;
    const update = remaining > 0
      ? { $set: { [path]: remaining, updatedAt: new Date() } }
      : { $unset: { [path]: '' }, $set: { updatedAt: new Date() } };
    const result = await col.updateOne({ _id: String(profileId), [path]: current }, update);
    if (result.matchedCount === 1) return { ok: true, item, quantity: remaining, removed };
  }
  return { ok: false, reason: 'conflict', item };
}
async function setItemQuantity(profileId, itemId, quantity) {
  const item = await getItem(itemId);
  if (!item) return { ok: false, reason: 'unknown_item' };
  const qty = Math.max(0, Math.floor(Number(quantity) || 0));
  const col = await getInvCollection();
  const update = qty > 0
    ? { $set: { [`items.${item.id}`]: qty, updatedAt: new Date() } }
    : { $unset: { [`items.${item.id}`]: '' }, $set: { updatedAt: new Date() } };
  await col.updateOne({ _id: String(profileId) }, update, { upsert: true });
  return { ok: true, item, quantity: qty };
}

async function useItem(profileId, itemId, options = {}) {
  const item = await getItem(itemId);
  if (!item) return { ok: false, reason: 'unknown_item' };
  const inventory = await getInventory(profileId);
  if (!(Number(inventory.items[itemId]) > 0)) return { ok: false, reason: 'not_owned', item };
  if (!item.usable) return { ok: false, reason: 'not_usable', item };

  if (item.useAction) {
    const action = item.useAction;
    if (action.type === 'message') {
      if (typeof options.sendMessage !== 'function') return { ok: false, reason: 'message_sender_missing', item };
      const variables = options.variables || {};
      const content = action.message.replaceAll('{joueur}', variables.joueur || '')
        .replaceAll('{personnage}', variables.personnage || '').replaceAll('{objet}', item.name || '');
      const removed = await removeItem(profileId, itemId, 1);
      if (!removed.ok) return removed;
      try { await options.sendMessage(content); }
      catch (error) { await addItem(profileId, itemId, 1); return { ok: false, reason: 'message_failed', item, error }; }
      return { ok: true, item, consumed: true, quantity: removed.quantity, actionType: 'message' };
    }
    if (action.type === 'donner_objet') {
      const reward = await getItem(action.itemId);
      if (!reward) return { ok: false, reason: 'reward_unknown', item };
      const removed = await removeItem(profileId, itemId, 1);
      if (!removed.ok) return removed;
      const added = await addItem(profileId, reward.id, action.quantity || 1);
      if (!added.ok) { await addItem(profileId, itemId, 1); return { ok: false, reason: 'reward_failed', item }; }
      return { ok: true, item, consumed: true, quantity: removed.quantity, actionType: 'donner_objet', reward, rewardQuantity: action.quantity || 1, rewardTotalQuantity: added.quantity };
    }
    if (action.type === 'stat') {
      const removed = await removeItem(profileId, itemId, 1);
      if (!removed.ok) return removed;
      try {
        const statResult = action.mode === 'temporaire'
          ? await addTemporaryStatEffect(profileId, action.stat, action.amount, action.durationMinutes)
          : await applyPermanentStatChange(profileId, action.stat, action.amount);
        if (!statResult) throw new Error('Profil introuvable.');
        return { ok: true, item, consumed: true, quantity: removed.quantity, actionType: 'stat', stat: action.stat, amount: action.amount, mode: action.mode, durationMinutes: action.durationMinutes, statResult };
      } catch (error) {
        await addItem(profileId, itemId, 1).catch(() => {});
        return { ok: false, reason: 'stat_failed', item, error };
      }
    }
  }
  if (item.slot) return equipItem(profileId, itemId);
  const removed = await removeItem(profileId, itemId, 1);
  return removed.ok ? { ok: true, item, consumed: true, quantity: removed.quantity } : removed;
}
async function equipItem(profileId, itemId) {
  const item = await getItem(itemId);
  if (!item) return { ok: false, reason: 'unknown_item' };
  if (!item.slot) return { ok: false, reason: 'not_equipable', item };
  const inventory = await getInventory(profileId);
  if (!(Number(inventory.items[itemId]) > 0)) return { ok: false, reason: 'not_owned', item };
  const previousItemId = inventory.equipement[item.slot] || null;
  const removed = await removeItem(profileId, itemId, 1);
  if (!removed.ok) return removed;
  const col = await getInvCollection();
  await col.updateOne({ _id: String(profileId) }, { $set: { [`equipement.${item.slot}`]: itemId, updatedAt: new Date() } }, { upsert: true });
  if (previousItemId) await addItem(profileId, previousItemId, 1);
  return { ok: true, item, slot: item.slot, previousItem: previousItemId ? await getItem(previousItemId) : null };
}
async function unequipSlot(profileId, slot) {
  if (!EQUIPMENT_SLOTS.includes(slot)) return { ok: false, reason: 'invalid_slot' };
  const inventory = await getInventory(profileId);
  const itemId = inventory.equipement[slot];
  if (!itemId) return { ok: false, reason: 'empty_slot' };
  const col = await getInvCollection();
  await col.updateOne({ _id: String(profileId) }, { $set: { [`equipement.${slot}`]: null, updatedAt: new Date() } }, { upsert: true });
  await addItem(profileId, itemId, 1);
  return { ok: true, item: await getItem(itemId), slot };
}
async function getEquippedStatBonuses(profileId) {
  const inventory = await getInventory(profileId);
  const ids = EQUIPMENT_SLOTS.map(slot => inventory.equipement[slot]).filter(Boolean);
  if (!ids.length) return {};
  const items = await Promise.all(ids.map(getItem));
  const result = {};
  for (const item of items) for (const [stat, value] of Object.entries(item?.statBonus || {})) {
    const amount = Number(value) || 0;
    if (amount) result[stat] = (result[stat] || 0) + amount;
  }
  return result;
}
async function giveItem(fromProfileId, toProfileId, itemId, quantity = 1) {
  const removed = await removeItem(fromProfileId, itemId, quantity, { exact: true });
  if (!removed.ok) return removed;
  const added = await addItem(toProfileId, itemId, removed.removed);
  if (!added.ok) { await addItem(fromProfileId, itemId, removed.removed); return added; }
  return { ok: true, item: removed.item, quantity: removed.removed, quantityDestinataire: added.quantity };
}
async function formatInventory(profileId, nomPrenom) {
  const inventory = await getInventory(profileId);
  const catalog = await getCatalog();
  const lookup = new Map(catalog.map(item => [item.id, item]));
  const entries = Object.entries(inventory.items || {}).filter(([, quantity]) => Number(quantity) > 0);
  const lines = [`# 🎒 Inventaire - ${nomPrenom}`, ''];
  if (!entries.length) lines.push('*Inventaire vide.*');
  else {
    const grouped = new Map();
    for (const [id, quantity] of entries) {
      const item = lookup.get(id) || { id, name: id, emoji: '❔', category: 'Autre' };
      if (!grouped.has(item.category || 'Autre')) grouped.set(item.category || 'Autre', []);
      grouped.get(item.category || 'Autre').push({ item, quantity });
    }
    for (const [category, items] of grouped) {
      lines.push(`**${category}**`);
      for (const { item, quantity } of items) lines.push(`${item.emoji || '❔'} ${item.name} - x${quantity}`);
      lines.push('');
    }
  }
  const equipped = EQUIPMENT_SLOTS.map(slot => [slot, inventory.equipement[slot]]).filter(([, id]) => id);
  if (equipped.length) {
    lines.push('**Équipé**');
    for (const [slot, id] of equipped) {
      const item = lookup.get(id) || { name: id, emoji: '❔' };
      lines.push(`${item.emoji} ${EQUIPMENT_SLOT_LABELS[slot]} : ${item.name}`);
    }
  }
  return lines.join('\n').trim();
}

module.exports = {
  EQUIPMENT_SLOTS, EQUIPMENT_SLOT_LABELS, ITEM_RARITIES, DEFAULT_CATALOG,
  normalizeUseAction, getCatalog, getExistingCatalogIds, getCatalogMetadata, getCatalogImageData,
  getItem, addCatalogItem, updateCatalogItem, removeCatalogItem, clearCatalog,
  getInventory, listAllInventories, addItem, removeItem, setItemQuantity,
  useItem, equipItem, unequipSlot, getEquippedStatBonuses, giveItem, formatInventory,
};
