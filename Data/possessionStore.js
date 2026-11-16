// Possessions de personnages et de factions + génération périodique de ressources.
const crypto = require('crypto');
const { connect, getPossessionsCollection } = require('./mongo.js');
const inv = require('./invStore.js');
const factions = require('./factionStore.js');
const { CREDITS_ITEM_ID } = factions;

const KINDS = ['batiment', 'zone_planetaire', 'planete', 'cantina', 'autre'];
const GENERATION_TYPES = ['credits', 'item'];
const MAX_INTERVAL_MINUTES = 525600;
let generationBusy = false;
let generationTimer = null;

function cleanText(value, max = 100) { return String(value || '').trim().slice(0, max); }
function positive(value, max = 1_000_000_000) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1 || n > max) throw new Error(`La valeur doit être comprise entre 1 et ${max.toLocaleString('fr-FR')}.`);
  return n;
}
async function listPossessions(ownerType, ownerId) {
  const query = {};
  if (ownerType) query.ownerType = String(ownerType);
  if (ownerId) query.ownerId = String(ownerId);
  return (await getPossessionsCollection()).find(query).sort({ name: 1 }).toArray();
}
async function getPossession(id) {
  return (await getPossessionsCollection()).findOne({ _id: String(id || '') });
}
async function normalizePossession(body, previous = null) {
  const b = body || {};
  const name = cleanText(b.name ?? previous?.name, 100);
  const kind = String(b.kind ?? previous?.kind ?? 'autre');
  const description = cleanText(b.description ?? previous?.description, 1000);
  if (!name) throw new Error('Le nom de la possession est obligatoire.');
  if (!KINDS.includes(kind)) throw new Error('Type de possession invalide.');
  const incoming = b.generation || previous?.generation || {};
  const enabled = Boolean(incoming.enabled);
  let generation = { enabled: false, type: null, itemId: null, quantity: 0, intervalMinutes: 0 };
  if (enabled) {
    const type = String(incoming.type || 'credits');
    if (!GENERATION_TYPES.includes(type)) throw new Error('La génération doit être en crédits ou en objet.');
    const intervalMinutes = positive(incoming.intervalMinutes, MAX_INTERVAL_MINUTES);
    const quantity = positive(incoming.quantity, 1_000_000_000);
    const itemId = type === 'credits' ? CREDITS_ITEM_ID : cleanText(incoming.itemId, 100);
    if (type === 'item' && !/^[A-Za-z0-9_-]+$/.test(itemId)) throw new Error('Choisis un objet valide à générer.');
    if (type === 'item' && !(await (await connect()).collection('item_catalog').findOne({ _id: itemId }, { projection: { _id: 1 } }))) throw new Error('L’objet à générer n’existe pas dans le catalogue.');
    generation = { enabled: true, type, itemId, quantity, intervalMinutes };
  }
  return { name, kind, description, generation, updatedAt: new Date() };
}
async function createPossession(ownerType, ownerId, body) {
  ownerType = String(ownerType || ''); ownerId = String(ownerId || '').trim();
  if (!['profile', 'faction'].includes(ownerType) || !ownerId) throw new Error('Propriétaire de possession invalide.');
  if (ownerType === 'faction' && !factions.getFactionDef(ownerId)) throw new Error('Faction inconnue.');
  const fields = await normalizePossession(body);
  const now = new Date();
  const nextPayoutAt = fields.generation.enabled ? new Date(now.getTime() + fields.generation.intervalMinutes * 60_000) : null;
  const doc = { _id: `possession_${crypto.randomBytes(10).toString('hex')}`, ownerType, ownerId, ...fields, nextPayoutAt, createdAt: now };
  await (await getPossessionsCollection()).insertOne(doc);
  return doc;
}
async function updatePossession(id, body) {
  const col = await getPossessionsCollection();
  const before = await col.findOne({ _id: String(id) });
  if (!before) throw new Error('Possession introuvable.');
  const fields = await normalizePossession(body, before);
  let nextPayoutAt = before.nextPayoutAt || null;
  if (!fields.generation.enabled) nextPayoutAt = null;
  else if (!before.generation?.enabled || Number(fields.generation.intervalMinutes) !== Number(before.generation.intervalMinutes)) {
    nextPayoutAt = new Date(Date.now() + fields.generation.intervalMinutes * 60_000);
  }
  await col.updateOne({ _id: before._id }, { $set: { ...fields, nextPayoutAt } });
  return col.findOne({ _id: before._id });
}
async function deletePossession(id) {
  const col = await getPossessionsCollection();
  const possession = await col.findOne({ _id: String(id) });
  if (!possession) return false;
  const [productionUse, personnelUse] = await Promise.all([
    (await connect()).collection('production_recipes').countDocuments({ requiredPossessionId: possession._id }),
    (await connect()).collection('personnel_types').countDocuments({ requiredPossessionId: possession._id }),
  ]);
  if (productionUse || personnelUse) throw new Error('Cette possession est encore utilisée par une production ou un métier. Retire d’abord cette association.');
  await col.deleteOne({ _id: possession._id });
  return true;
}

async function checkRequiredPossession(profile, possessionId, userId) {
  if (!possessionId) return { ok: true, possession: null };
  const possession = await getPossession(possessionId);
  if (!possession) throw new Error('La possession requise n’existe plus. Contacte le staff.');
  if (possession.ownerType === 'profile') {
    if (String(possession.ownerId) !== String(profile?._id) || String(profile?.userId) !== String(userId)) {
      throw new Error(`La production nécessite la possession « ${possession.name} » de ce personnage.`);
    }
    return { ok: true, possession };
  }
  if (possession.ownerType === 'faction') {
    await factions.loadFactionDefs();
    const def = factions.getFactionDef(possession.ownerId);
    if (!def || String(profile?.categoryId || '') !== String(def.categoryRoleId)) {
      throw new Error(`La production nécessite la possession de faction « ${possession.name} ».`);
    }
    const state = await factions.getFactionState(possession.ownerId);
    if (String(state?.leaderUserId || '') !== String(userId)) {
      throw new Error(`Seul le chef de faction peut utiliser « ${possession.name} » ou affecter du personnel à cette possession.`);
    }
    return { ok: true, possession };
  }
  throw new Error('Propriétaire de possession invalide.');
}

async function processDueGeneration(now = new Date()) {
  if (generationBusy) return;
  generationBusy = true;
  try {
    const col = await getPossessionsCollection();
    const due = await col.find({ 'generation.enabled': true, nextPayoutAt: { $lte: now } }).limit(100).toArray();
    for (const possession of due) {
      const intervalMs = Math.max(60_000, Number(possession.generation?.intervalMinutes) * 60_000 || 60_000);
      let next = new Date((possession.nextPayoutAt instanceof Date ? possession.nextPayoutAt : new Date(possession.nextPayoutAt)).getTime() + intervalMs);
      while (next <= now) next = new Date(next.getTime() + intervalMs); // pas de paiement massif après une longue indisponibilité
      const claim = await col.updateOne(
        { _id: possession._id, nextPayoutAt: possession.nextPayoutAt, 'generation.enabled': true },
        { $set: { nextPayoutAt: next, lastPayoutAt: now } },
      );
      if (!claim.modifiedCount) continue;
      try {
        if (possession.ownerType === 'profile') {
          await inv.addItem(String(possession.ownerId), String(possession.generation.itemId), Number(possession.generation.quantity));
        } else if (possession.ownerType === 'faction') {
          await factions.adjustFactionItem(String(possession.ownerId), String(possession.generation.itemId), Number(possession.generation.quantity));
        }
      } catch (err) {
        await col.updateOne({ _id: possession._id, nextPayoutAt: next }, { $set: { nextPayoutAt: possession.nextPayoutAt } });
        console.error(`[POSSESSION] Génération impossible pour ${possession._id}:`, err?.message || err);
      }
    }
  } finally { generationBusy = false; }
}

function init() {
  if (generationTimer) return;
  processDueGeneration().catch(err => console.error('[POSSESSION] Démarrage génération:', err?.message || err));
  generationTimer = setInterval(() => processDueGeneration().catch(err => console.error('[POSSESSION] Génération:', err?.message || err)), 60_000);
  generationTimer.unref?.();
}

module.exports = { KINDS, listPossessions, getPossession, createPossession, updatePossession, deletePossession, checkRequiredPossession, processDueGeneration, init };
