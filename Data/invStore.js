// -----------------------------------------------------------------------
// ⚠️ NOTE DE SYNCHRONISATION AVEC LE BOT
// -----------------------------------------------------------------------
// Le bot Discord (Data/invStore.js de son côté) lit le catalogue d'objets
// depuis un fichier statique Data/inv.json. Ici, sur le site, le catalogue
// est stocké dans MongoDB (collection "item_catalog")  parce qu'un fichier
// modifié sur Render ne survit pas à un redéploiement.
//
// Résultat : tant que le bot n'est pas mis à jour pour lire lui aussi cette
// collection Mongo, un objet ajouté/modifié/supprimé ICI (depuis le site)
// n'apparaîtra PAS automatiquement dans les commandes Discord (/inventaire
// ajouter, etc.), et inversement. Les quantités par personnage (collection
// "inv"), elles, sont déjà partagées avec le bot  pas de souci de ce côté.
// -----------------------------------------------------------------------

const { getInvCollection, getItemCatalogCollection } = require('./mongo.js');

// Catalogue de départ, utilisé pour "amorcer" la collection Mongo la toute
// première fois (si elle est vide)  ensuite, tout passe par Mongo.
const DEFAULT_CATALOG = [
  { id: 'sabre_laser', name: 'Sabre laser', emoji: '🗡️', category: 'Arme', description: 'Arme rituelle forgée avec un cristal kyber.' },
  { id: 'blaster', name: 'Pistolet blaster', emoji: '🔫', category: 'Arme', description: 'Arme de poing standard, à énergie.' },
  { id: 'fusil_blaster', name: 'Fusil blaster', emoji: '🔫', category: 'Arme', description: "Arme d'épaule à longue portée." },
  { id: 'vibrolame', name: 'Vibrolame', emoji: '🔪', category: 'Arme', description: 'Lame vibrante, efficace même contre une armure légère.' },
  { id: 'grenade_thermique', name: 'Détonateur thermique', emoji: '💣', category: 'Arme', description: 'Explosif portatif à haut rendement.' },
  { id: 'armure_legere', name: 'Armure légère', emoji: '🦺', category: 'Équipement', description: 'Protection basique, ne gêne pas la mobilité.' },
  { id: 'casque', name: 'Casque de combat', emoji: '⛑️', category: 'Équipement', description: 'Protection crânienne avec visée intégrée.' },
  { id: 'jetpack', name: 'Jetpack', emoji: '🚀', category: 'Équipement', description: 'Propulseur dorsal, vol de courte durée.' },
  { id: 'comlink', name: 'Comlink', emoji: '📡', category: 'Équipement', description: 'Communicateur longue portée.' },
  { id: 'kit_medical', name: 'Kit médical', emoji: '💉', category: 'Équipement', description: "Nécessaire de soin d'urgence." },
  { id: 'macrobinoculaire', name: 'Macrobinoculaire', emoji: '🔭', category: 'Équipement', description: 'Optique longue portée.' },
  { id: 'outils_reparation', name: 'Outils de réparation', emoji: '🔧', category: 'Équipement', description: 'Nécessaire pour réparer droïdes et vaisseaux.' },
  { id: 'credits', name: 'Crédits galactiques', emoji: '💰', category: 'Ressource', description: 'La monnaie standard de la galaxie.' },
  { id: 'cristal_kyber', name: 'Cristal kyber', emoji: '💎', category: 'Ressource', description: 'Cristal rare, sensible à la Force.' },
  { id: 'carburant', name: 'Carburant (bidon)', emoji: '⛽', category: 'Ressource', description: 'Carburant pour vaisseau ou speeder.' },
  { id: 'rations', name: 'Rations de survie', emoji: '🍱', category: 'Ressource', description: 'Nourriture longue conservation.' },
  { id: 'datapad', name: 'Datapad', emoji: '📓', category: 'Divers', description: 'Tablette de données portable.' },
  { id: 'holoprojecteur', name: 'Holoprojecteur', emoji: '📽️', category: 'Divers', description: 'Projette des messages ou cartes en hologramme.' },
  { id: 'cape', name: 'Cape', emoji: '🧥', category: 'Divers', description: "Vêtement d'extérieur, souvent à capuche." },
];

function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Retourne le catalogue (trié par catégorie puis nom). Amorce la collection
 * avec DEFAULT_CATALOG si elle est encore vide (première utilisation).
 */
async function getCatalog() {
  const col = await getItemCatalogCollection();
  const count = await col.countDocuments();
  if (count === 0) {
    await col.insertMany(DEFAULT_CATALOG.map(it => ({ ...it, _id: it.id })));
  }
  const docs = await col.find().toArray();
  return docs
    .map(({ _id, ...rest }) => ({ id: _id, ...rest }))
    .sort((a, b) => (a.category || '').localeCompare(b.category || '') || a.name.localeCompare(b.name));
}

async function getItem(itemId) {
  const col = await getItemCatalogCollection();
  const doc = await col.findOne({ _id: itemId });
  return doc ? { id: doc._id, name: doc.name, emoji: doc.emoji, category: doc.category, description: doc.description } : null;
}

/** Ajoute un nouvel objet au catalogue. Génère un id à partir du nom si non fourni. */
async function addCatalogItem({ id, name, emoji, category, description }) {
  if (!name) throw new Error('Le nom est obligatoire.');
  const finalId = slugify(id || name);
  if (!finalId) throw new Error("Impossible de déduire un identifiant pour cet objet.");

  const col = await getItemCatalogCollection();
  const existing = await col.findOne({ _id: finalId });
  if (existing) throw new Error(`Un objet avec l'identifiant "${finalId}" existe déjà.`);

  const doc = { _id: finalId, name, emoji: emoji || '❔', category: category || 'Divers', description: description || '' };
  await col.insertOne(doc);
  return { id: finalId, ...doc, _id: undefined };
}

async function updateCatalogItem(itemId, { name, emoji, category, description }) {
  const col = await getItemCatalogCollection();
  const fields = {};
  if (name !== undefined) fields.name = name;
  if (emoji !== undefined) fields.emoji = emoji;
  if (category !== undefined) fields.category = category;
  if (description !== undefined) fields.description = description;

  const result = await col.findOneAndUpdate({ _id: itemId }, { $set: fields }, { returnDocument: 'after' });
  if (!result) throw new Error('Objet introuvable.');
  return { id: result._id, name: result.name, emoji: result.emoji, category: result.category, description: result.description };
}

/**
 * Supprime un objet du catalogue. Les personnages qui en possédaient gardent
 * l'entrée dans leur inventaire (avec une quantité), juste affichée avec un
 * nom générique  pas de suppression en cascade pour ne rien perdre en silence.
 */
async function removeCatalogItem(itemId) {
  const col = await getItemCatalogCollection();
  const result = await col.deleteOne({ _id: itemId });
  return result.deletedCount > 0;
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
  getInventory,
  listAllInventories,
  addItem,
  removeItem,
  setItemQuantity,
};
