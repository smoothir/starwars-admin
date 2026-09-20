const { getMaisonsStateCollection } = require('./mongo.js');

/**
 * Renvoie l'état modifiable d'une maison (ou un objet par défaut si elle n'a
 * jamais été éditée). key = le champ `key` de Data/maisons.js (nom brut armees.js).
 */
async function getMaisonState(key) {
  const col = await getMaisonsStateCollection();
  const state = await col.findOne({ _id: key });
  return state || { _id: key, leaderId: null, argentOverride: null, renommeeOverride: null, historique: [] };
}

async function setLeader(key, userId) {
  const col = await getMaisonsStateCollection();
  await col.updateOne({ _id: key }, { $set: { leaderId: userId } }, { upsert: true });
}

async function updateMaisonOverrides(key, fields) {
  const col = await getMaisonsStateCollection();
  await col.updateOne({ _id: key }, { $set: fields }, { upsert: true });
}

async function addHistoriqueEntry(key, { texte, auteurId = null, auteurLabel = null }) {
  const col = await getMaisonsStateCollection();
  await col.updateOne(
    { _id: key },
    { $push: { historique: { texte, auteurId, auteurLabel, date: new Date() } } },
    { upsert: true },
  );
}

module.exports = { getMaisonState, setLeader, updateMaisonOverrides, addHistoriqueEntry };
