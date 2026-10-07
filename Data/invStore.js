// -----------------------------------------------------------------------
// SYNCHRO AVEC LE BOT
// -----------------------------------------------------------------------
// Le catalogue d'objets vit dans MongoDB (collection "item_catalog"), la
// MÊME que celle lue par le bot Discord. Les marqueurs internes
// ("__seeded__", "__migrated_equipement__") et les champs slot/image/usable
// doivent rester IDENTIQUES à ceux du bot (Data/invStore.js côté bot).
// -----------------------------------------------------------------------

const { getInvCollection, getItemCatalogCollection } = require('./mongo.js');

// Catalogue de départ (copie exacte de celui du bot).
const EQUIPMENT_SLOTS = ['casque', 'plastron', 'mainGauche', 'mainDroite', 'jambes', 'pieds'];
const EQUIPMENT_SLOT_LABELS = {
  casque: 'Casque',
  plastron: 'Plastron',
  mainGauche: 'Main gauche',
  mainDroite: 'Main droite',
  jambes: 'Jambes',
  pieds: 'Pieds',
};

function emptyEquipement() {
  return Object.fromEntries(EQUIPMENT_SLOTS.map(s => [s, null]));
}

// Catalogue de départ, utilisé pour "amorcer" la collection Mongo la toute
// première fois. Garder cette liste identique à celle du site évite une
// incohérence si l'un des deux démarre avant l'autre sur une base vide.
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

const SEED_MARKER_ID = '__seeded__';
const MIGRATION_MARKER_ID = '__migrated_equipement__';
const RARITY_MIGRATION_MARKER_ID = '__migrated_rarete__';
const MARKER_IDS = [SEED_MARKER_ID, MIGRATION_MARKER_ID, RARITY_MIGRATION_MARKER_ID];

const ITEM_RARITIES = ['Épique', 'Rare', 'Peu commun', 'Commun'];

// Tout identifiant de la forme "__xxx__" est un document interne (marqueur
// posé par le bot ou le site), jamais un vrai objet : on les cache et on les
// protège TOUS, y compris ceux que le bot ajouterait plus tard.
const RESERVED_ID = /^__.*__$/;
const isReservedId = (id) => RESERVED_ID.test(String(id || ''));

// Taille max d'une image enregistrée directement en base (data URL). Le site
// réduit déjà l'image côté navigateur (≈256 px) : ceci n'est qu'un garde-fou.
const MAX_IMAGE_DATAURL_LENGTH = 400 * 1024;

function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Valide/normalise le champ "image" d'un objet. Formats acceptés :
 *  - null / '' : pas d'image (l'emoji est utilisé à la place)
 *  - data:image/(png|jpeg|webp|gif);base64,... : image envoyée depuis le site
 *  - http(s)://... : image hébergée ailleurs
 *  - /image/... : chemin relatif à la racine du bot (ancien format)
 */
function normalizeImage(image) {
  if (image === undefined) return undefined;
  if (image === null || image === '') return null;
  if (typeof image !== 'string') throw new Error("Image invalide.");
  const value = image.trim();
  if (/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value)) {
    if (value.length > MAX_IMAGE_DATAURL_LENGTH) throw new Error('Image trop lourde (max ~300 Ko).');
    return value;
  }
  if (/^https?:\/\/\S{1,500}$/.test(value)) return value;
  if (/^\/image\/[\w\-./]+$/.test(value)) return value;
  throw new Error("Image invalide (PNG, JPEG, WebP ou GIF attendu).");
}

function normalizeSlot(slot) {
  if (slot === undefined) return undefined;
  if (slot === null || slot === '') return null;
  if (!EQUIPMENT_SLOTS.includes(slot)) throw new Error(`Emplacement invalide : ${slot}`);
  return slot;
}

/** Valide/normalise le bonus de stats d'un objet : { "Nom de la stat": nombre entier, ... }. */
function normalizeRarity(rarity) {
  if (rarity === undefined || rarity === null || rarity === '') return 'Commun';
  const value = String(rarity).trim();
  if (!ITEM_RARITIES.includes(value)) throw new Error(`Rareté invalide : ${value}`);
  return value;
}


/** Valide/normalise l'action déclenchée par le bouton "Utiliser". */
function normalizeUseAction(useAction) {
  if (useAction === undefined || useAction === null || useAction === '' || useAction?.type === 'aucune') return null;
  if (typeof useAction !== 'object' || Array.isArray(useAction)) throw new Error('Utilité d\'objet invalide.');

  const type = String(useAction.type || 'aucune');
  if (type === 'donner_objet') {
    const rewardItemId = String(useAction.itemId || '').trim();
    const quantity = Math.max(1, Math.floor(Number(useAction.quantity) || 1));
    if (!rewardItemId) throw new Error('L\'objet à donner est obligatoire.');
    return { type, itemId: rewardItemId, quantity };
  }

  if (type === 'message') {
    const message = String(useAction.message || '').trim();
    if (!message) throw new Error('Le message à envoyer est obligatoire.');
    return { type, message: message.slice(0, 2000) };
  }

  if (type === 'stat') {
    const stat = String(useAction.stat || '').trim();
    const amount = Math.round(Number(useAction.amount) || 0);
    const mode = useAction.mode === 'temporaire' ? 'temporaire' : 'permanent';
    const durationMinutes = Math.max(1, Math.floor(Number(useAction.durationMinutes) || 1));
    if (!stat) throw new Error('La statistique est obligatoire.');
    if (!amount) throw new Error('La valeur de modification de statistique ne peut pas être 0.');
    return { type, stat: stat.slice(0, 100), amount, mode, durationMinutes };
  }

  throw new Error(`Utilité inconnue : ${type}`);
}

function normalizeStatBonus(statBonus) {
  if (statBonus === undefined || statBonus === null) return {};
  if (typeof statBonus !== 'object' || Array.isArray(statBonus)) throw new Error('Bonus de stats invalide.');
  const out = {};
  for (const [stat, value] of Object.entries(statBonus)) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n) || n === 0) continue; // 0/vide = pas de bonus sur cette stat, inutile de le stocker
    out[String(stat).slice(0, 60)] = n;
  }
  return out;
}

function toItem(doc) {
  return {
    id: doc._id,
    name: doc.name,
    emoji: doc.emoji,
    category: doc.category,
    rarity: normalizeRarity(doc.rarity),
    description: doc.description,
    useAction: normalizeUseAction(doc.useAction),
    slot: doc.slot || null,
    image: doc.image || null,
    usable: Boolean(doc.usable),
    statBonus: doc.statBonus || {},
  };
}

/**
 * Retourne le catalogue (trié par catégorie puis nom). Amorçage et migration
 * identiques à ceux du bot (une seule fois à vie, marqueurs dédiés).
 */
async function getCatalog() {
  const col = await getItemCatalogCollection();
  const dejaAmorce = await col.findOne({ _id: SEED_MARKER_ID });
  if (!dejaAmorce) {
    if (DEFAULT_CATALOG.length > 0) {
      const operations = DEFAULT_CATALOG.map(it => ({
        updateOne: { filter: { _id: it.id }, update: { $setOnInsert: { ...it, _id: it.id } }, upsert: true },
      }));
      await col.bulkWrite(operations, { ordered: false });
    }
    await col.updateOne({ _id: SEED_MARKER_ID }, { $setOnInsert: { seededAt: new Date() } }, { upsert: true });
  }

  const dejaMigre = await col.findOne({ _id: MIGRATION_MARKER_ID });
  if (!dejaMigre) {
    const migration = DEFAULT_CATALOG.map(it => ({
      updateOne: {
        filter: { _id: it.id, usable: { $exists: false } },
        update: { $set: { slot: it.slot, image: it.image, usable: it.usable } },
      },
    }));
    if (migration.length > 0) await col.bulkWrite(migration, { ordered: false });
    await col.updateOne({ _id: MIGRATION_MARKER_ID }, { $setOnInsert: { migratedAt: new Date() } }, { upsert: true });
  }

  const dejaMigreRarete = await col.findOne({ _id: RARITY_MIGRATION_MARKER_ID });
  if (!dejaMigreRarete) {
    await col.updateMany(
      { _id: { $not: RESERVED_ID }, rarity: { $exists: false } },
      { $set: { rarity: 'Commun' } },
    );
    await col.updateOne(
      { _id: RARITY_MIGRATION_MARKER_ID },
      { $setOnInsert: { migratedAt: new Date() } },
      { upsert: true },
    );
  }

  const docs = (await col.find({ _id: { $not: RESERVED_ID } }).toArray()).filter(d => !isReservedId(d._id));
  return docs
    .map(toItem)
    .sort((a, b) => (a.category || '').localeCompare(b.category || '') || a.name.localeCompare(b.name));
}

async function getItem(itemId) {
  if (!itemId || isReservedId(itemId)) return null;
  const col = await getItemCatalogCollection();
  const doc = await col.findOne({ _id: itemId });
  return doc ? toItem(doc) : null;
}

/** Ajoute un nouvel objet au catalogue. Génère un id à partir du nom si non fourni. */
async function addCatalogItem({ id, name, emoji, category, rarity, description, image, slot, usable, statBonus, useAction }) {
  if (!name) throw new Error('Le nom est obligatoire.');
  const finalId = slugify(id || name);
  if (!finalId || isReservedId(finalId)) throw new Error("Impossible de déduire un identifiant valide pour cet objet.");
  const finalSlot = normalizeSlot(slot);
  const normalizedUseAction = normalizeUseAction(useAction);

  const col = await getItemCatalogCollection();
  if (normalizedUseAction?.type === 'donner_objet') {
    const reward = await col.findOne({ _id: normalizedUseAction.itemId });
    if (!reward || isReservedId(reward._id)) throw new Error("L'objet à donner n'existe pas dans le catalogue.");
  }
  const existing = await col.findOne({ _id: finalId });
  if (existing) throw new Error(`Un objet avec l'identifiant "${finalId}" existe déjà.`);

  const doc = {
    _id: finalId,
    name,
    emoji: emoji || '❔',
    category: category || 'Divers',
    rarity: normalizeRarity(rarity),
    description: description || '',
    useAction: normalizedUseAction,
    slot: finalSlot,
    image: normalizeImage(image) || null,
    usable: finalSlot ? true : Boolean(usable),
    statBonus: normalizeStatBonus(statBonus),
  };
  await col.insertOne(doc);
  return toItem(doc);
}

/** Met à jour un objet. Un champ `undefined` est laissé tel quel (slot/usable ne sont jamais touchés ici). */
async function updateCatalogItem(itemId, { id, name, emoji, category, rarity, description, image, slot, usable, statBonus, useAction }) {
  if (isReservedId(itemId)) throw new Error('Objet introuvable.');
  const col = await getItemCatalogCollection();
  const oldDoc = await col.findOne({ _id: itemId });
  if (!oldDoc) throw new Error('Objet introuvable.');

  const requestedId = id === undefined || id === null || String(id).trim() === '' ? itemId : id;
  const newId = slugify(requestedId);
  if (!newId || isReservedId(newId)) throw new Error('Identifiant invalide. Utilise uniquement des lettres, chiffres, tirets ou underscores.');

  if (newId !== itemId) {
    const conflict = await col.findOne({ _id: newId });
    if (conflict) throw new Error(`Un objet avec l'identifiant "${newId}" existe déjà.`);
  }

  const fields = {};
  if (name !== undefined) fields.name = name;
  if (emoji !== undefined) fields.emoji = emoji;
  if (category !== undefined) fields.category = category;
  if (rarity !== undefined) fields.rarity = normalizeRarity(rarity);
  if (useAction !== undefined) fields.useAction = normalizeUseAction(useAction);
  if (description !== undefined) fields.description = description;
  if (image !== undefined) fields.image = normalizeImage(image);
  if (slot !== undefined) {
    fields.slot = normalizeSlot(slot);
    if (fields.slot) fields.usable = true;
  }
  if (usable !== undefined) fields.usable = Boolean(usable);
  if (statBonus !== undefined) fields.statBonus = normalizeStatBonus(statBonus);

  if (fields.useAction?.type === 'donner_objet') {
    const reward = await col.findOne({ _id: fields.useAction.itemId });
    if (!reward || isReservedId(reward._id)) throw new Error("L'objet à donner n'existe pas dans le catalogue.");
  }

  if (newId === itemId) {
    const result = await col.findOneAndUpdate({ _id: itemId }, { $set: fields }, { returnDocument: 'after' });
    if (!result) throw new Error('Objet introuvable.');
    return toItem(result);
  }

  // MongoDB interdit de modifier directement _id : on recrée le document sous
  // le nouvel ID puis on migre les références connues (inventaires, équipement
  // et utilités « donner un objet ») avant de supprimer l'ancien document.
  const newDoc = { ...oldDoc, ...fields, _id: newId };
  await col.insertOne(newDoc);

  try {
    const invCol = await getInvCollection();
    await invCol.updateMany(
      { [`items.${itemId}`]: { $exists: true } },
      { $rename: { [`items.${itemId}`]: `items.${newId}` }, $set: { updatedAt: new Date() } }
    );

    for (const slotName of EQUIPMENT_SLOTS) {
      await invCol.updateMany(
        { [`equipement.${slotName}`]: itemId },
        { $set: { [`equipement.${slotName}`]: newId, updatedAt: new Date() } }
      );
    }

    await col.updateMany(
      { 'useAction.itemId': itemId },
      { $set: { 'useAction.itemId': newId } }
    );

    await col.deleteOne({ _id: itemId });
  } catch (err) {
    // Si la migration des références échoue, on supprime le doublon créé et
    // laisse l'ancien objet intact pour éviter une perte de catalogue.
    await col.deleteOne({ _id: newId }).catch(() => {});
    throw err;
  }

  return toItem(newDoc);
}
/**
 * Supprime un objet du catalogue. Les personnages qui en possédaient gardent
 * l'entrée dans leur inventaire (avec une quantité), juste affichée avec un
 * nom générique — pas de suppression en cascade.
 */
async function removeCatalogItem(itemId) {
  if (isReservedId(itemId)) return false;
  const col = await getItemCatalogCollection();
  const result = await col.deleteOne({ _id: itemId });
  return result.deletedCount > 0;
}

/** Supprime tout le catalogue d'un coup, SAUF les marqueurs (sinon le bot/site réamorcerait les objets par défaut). */
async function clearCatalog() {
  const col = await getItemCatalogCollection();
  const result = await col.deleteMany({ _id: { $not: RESERVED_ID } });
  return result.deletedCount || 0;
}

/** Inventaire brut d'un profil (jamais null : { _id, items: {} } si rien n'existe encore). */
async function getInventory(profileId) {
  const col = await getInvCollection();
  const doc = await col.findOne({ _id: profileId });
  return doc || { _id: profileId, items: {} };
}

/** Inventaires de TOUS les profils d'un coup (pour la liste "Inventaire" du site). */
async function listAllInventories() {
  const col = await getInvCollection();
  return col.find().toArray();
}

async function addItem(profileId, itemId, quantity = 1) {
  const item = await getItem(itemId);
  if (!item) return { ok: false, reason: 'unknown_item' };

  const qty = Math.max(1, Math.floor(quantity) || 1);
  const col = await getInvCollection();
  await col.updateOne(
    { _id: profileId },
    { $inc: { [`items.${item.id}`]: qty }, $set: { updatedAt: new Date() } },
    { upsert: true },
  );

  const doc = await col.findOne({ _id: profileId });
  return { ok: true, item, quantity: doc.items[item.id] };
}

async function removeItem(profileId, itemId, quantity = 1) {
  const item = await getItem(itemId);
  if (!item) return { ok: false, reason: 'unknown_item' };

  const col = await getInvCollection();
  const doc = await col.findOne({ _id: profileId });
  const current = doc?.items?.[item.id] || 0;
  if (current <= 0) return { ok: false, reason: 'not_owned', item };

  const qty = Math.max(1, Math.floor(quantity) || 1);
  const removed = Math.min(qty, current);
  const remaining = current - removed;

  if (remaining > 0) {
    await col.updateOne({ _id: profileId }, { $set: { [`items.${item.id}`]: remaining, updatedAt: new Date() } });
  } else {
    await col.updateOne({ _id: profileId }, { $unset: { [`items.${item.id}`]: '' }, $set: { updatedAt: new Date() } });
  }
  return { ok: true, item, quantity: remaining, removed };
}

/** Fixe directement la quantité d'un objet (au lieu d'incrémenter/décrémenter). */
async function setItemQuantity(profileId, itemId, quantity) {
  const item = await getItem(itemId);
  if (!item) return { ok: false, reason: 'unknown_item' };

  const qty = Math.max(0, Math.floor(quantity) || 0);
  const col = await getInvCollection();

  if (qty <= 0) {
    await col.updateOne({ _id: profileId }, { $unset: { [`items.${item.id}`]: '' }, $set: { updatedAt: new Date() } }, { upsert: true });
  } else {
    await col.updateOne({ _id: profileId }, { $set: { [`items.${item.id}`]: qty, updatedAt: new Date() } }, { upsert: true });
  }
  return { ok: true, item, quantity: qty };
}

module.exports = {
  EQUIPMENT_SLOTS,
  EQUIPMENT_SLOT_LABELS,
  ITEM_RARITIES,
  normalizeUseAction,
  getCatalog,
  getItem,
  addCatalogItem,
  updateCatalogItem,
  removeCatalogItem,
  clearCatalog,
  getInventory,
  listAllInventories,
  addItem,
  removeItem,
  setItemQuantity,
};