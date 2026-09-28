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
  { id: 'sabre_laser', name: 'Sabre laser', emoji: '🗡️', category: 'Arme', description: 'Arme rituelle forgée avec un cristal kyber.', slot: 'mainDroite', image: null, usable: true },
  { id: 'blaster', name: 'Pistolet blaster', emoji: '🔫', category: 'Arme', description: 'Arme de poing standard, à énergie.', slot: 'mainDroite', image: null, usable: true },
  { id: 'fusil_blaster', name: 'Fusil blaster', emoji: '🔫', category: 'Arme', description: "Arme d'épaule à longue portée.", slot: 'mainDroite', image: null, usable: true },
  { id: 'vibrolame', name: 'Vibrolame', emoji: '🔪', category: 'Arme', description: 'Lame vibrante, efficace même contre une armure légère.', slot: 'mainGauche', image: null, usable: true },
  { id: 'grenade_thermique', name: 'Détonateur thermique', emoji: '💣', category: 'Arme', description: 'Explosif portatif à haut rendement.', slot: null, image: null, usable: false },
  { id: 'armure_legere', name: 'Armure légère', emoji: '🦺', category: 'Équipement', description: 'Protection basique, ne gêne pas la mobilité.', slot: 'plastron', image: null, usable: true },
  { id: 'casque', name: 'Casque de combat', emoji: '⛑️', category: 'Équipement', description: 'Protection crânienne avec visée intégrée.', slot: 'casque', image: null, usable: true },
  { id: 'jetpack', name: 'Jetpack', emoji: '🚀', category: 'Équipement', description: 'Propulseur dorsal, vol de courte durée.', slot: 'plastron', image: null, usable: true },
  { id: 'comlink', name: 'Comlink', emoji: '📡', category: 'Équipement', description: 'Communicateur longue portée.', slot: null, image: null, usable: false },
  { id: 'kit_medical', name: 'Kit médical', emoji: '💉', category: 'Équipement', description: "Nécessaire de soin d'urgence.", slot: null, image: null, usable: false },
  { id: 'macrobinoculaire', name: 'Macrobinoculaire', emoji: '🔭', category: 'Équipement', description: 'Optique longue portée.', slot: null, image: null, usable: false },
  { id: 'outils_reparation', name: 'Outils de réparation', emoji: '🔧', category: 'Équipement', description: 'Nécessaire pour réparer droïdes et vaisseaux.', slot: null, image: null, usable: false },
  { id: 'bottes_combat', name: 'Bottes de combat', emoji: '🥾', category: 'Équipement', description: 'Renforcées, bonne accroche au sol.', slot: 'pieds', image: null, usable: true },
  { id: 'pantalon_renforce', name: 'Pantalon renforcé', emoji: '👖', category: 'Équipement', description: 'Protection légère pour les jambes.', slot: 'jambes', image: null, usable: true },
  { id: 'credits', name: 'Crédits galactiques', emoji: '💰', category: 'Ressource', description: 'La monnaie standard de la galaxie.', slot: null, image: null, usable: false },
  { id: 'cristal_kyber', name: 'Cristal kyber', emoji: '💎', category: 'Ressource', description: 'Cristal rare, sensible à la Force.', slot: null, image: null, usable: false },
  { id: 'carburant', name: 'Carburant (bidon)', emoji: '⛽', category: 'Ressource', description: 'Carburant pour vaisseau ou speeder.', slot: null, image: null, usable: false },
  { id: 'rations', name: 'Rations de survie', emoji: '🍱', category: 'Ressource', description: 'Nourriture longue conservation.', slot: null, image: null, usable: false },
  { id: 'datapad', name: 'Datapad', emoji: '📓', category: 'Divers', description: 'Tablette de données portable.', slot: null, image: null, usable: false },
  { id: 'holoprojecteur', name: 'Holoprojecteur', emoji: '📽️', category: 'Divers', description: 'Projette des messages ou cartes en hologramme.', slot: null, image: null, usable: false },
  { id: 'cape', name: 'Cape', emoji: '🧥', category: 'Divers', description: "Vêtement d'extérieur, souvent à capuche.", slot: null, image: null, usable: false },
];

const SEED_MARKER_ID = '__seeded__';
const MIGRATION_MARKER_ID = '__migrated_equipement__';
const MARKER_IDS = [SEED_MARKER_ID, MIGRATION_MARKER_ID];

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

function toItem(doc) {
  return {
    id: doc._id,
    name: doc.name,
    emoji: doc.emoji,
    category: doc.category,
    description: doc.description,
    slot: doc.slot || null,
    image: doc.image || null,
    usable: Boolean(doc.usable),
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

  const docs = await col.find({ _id: { $nin: MARKER_IDS } }).toArray();
  return docs
    .map(toItem)
    .sort((a, b) => (a.category || '').localeCompare(b.category || '') || a.name.localeCompare(b.name));
}

async function getItem(itemId) {
  if (!itemId || MARKER_IDS.includes(itemId)) return null;
  const col = await getItemCatalogCollection();
  const doc = await col.findOne({ _id: itemId });
  return doc ? toItem(doc) : null;
}

/** Ajoute un nouvel objet au catalogue. Génère un id à partir du nom si non fourni. */
async function addCatalogItem({ id, name, emoji, category, description, image }) {
  if (!name) throw new Error('Le nom est obligatoire.');
  const finalId = slugify(id || name);
  if (!finalId || MARKER_IDS.includes(finalId)) throw new Error("Impossible de déduire un identifiant valide pour cet objet.");

  const col = await getItemCatalogCollection();
  const existing = await col.findOne({ _id: finalId });
  if (existing) throw new Error(`Un objet avec l'identifiant "${finalId}" existe déjà.`);

  const doc = {
    _id: finalId,
    name,
    emoji: emoji || '❔',
    category: category || 'Divers',
    description: description || '',
    slot: null,
    image: normalizeImage(image) || null,
    usable: false,
  };
  await col.insertOne(doc);
  return toItem(doc);
}

/** Met à jour un objet. Un champ `undefined` est laissé tel quel (slot/usable ne sont jamais touchés ici). */
async function updateCatalogItem(itemId, { name, emoji, category, description, image }) {
  const col = await getItemCatalogCollection();
  const fields = {};
  if (name !== undefined) fields.name = name;
  if (emoji !== undefined) fields.emoji = emoji;
  if (category !== undefined) fields.category = category;
  if (description !== undefined) fields.description = description;
  if (image !== undefined) fields.image = normalizeImage(image);

  const result = await col.findOneAndUpdate({ _id: itemId }, { $set: fields }, { returnDocument: 'after' });
  if (!result) throw new Error('Objet introuvable.');
  return toItem(result);
}

/**
 * Supprime un objet du catalogue. Les personnages qui en possédaient gardent
 * l'entrée dans leur inventaire (avec une quantité), juste affichée avec un
 * nom générique — pas de suppression en cascade.
 */
async function removeCatalogItem(itemId) {
  if (MARKER_IDS.includes(itemId)) return false;
  const col = await getItemCatalogCollection();
  const result = await col.deleteOne({ _id: itemId });
  return result.deletedCount > 0;
}

/** Supprime tout le catalogue d'un coup, SAUF les marqueurs (sinon le bot/site réamorcerait les objets par défaut). */
async function clearCatalog() {
  const col = await getItemCatalogCollection();
  const result = await col.deleteMany({ _id: { $nin: MARKER_IDS } });
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