const { getRegionsStateCollection } = require('./mongo.js');

async function getRegionState(key) {
  const col = await getRegionsStateCollection();
  const state = await col.findOne({ _id: key });
  return state || { _id: key, statutOverride: null, instabiliteOverride: null, historique: [] };
}

async function updateRegionOverrides(key, fields) {
  const col = await getRegionsStateCollection();
  await col.updateOne({ _id: key }, { $set: fields }, { upsert: true });
}

async function addRegionHistoriqueEntry(key, { texte, auteurId = null, auteurLabel = null }) {
  const col = await getRegionsStateCollection();
  await col.updateOne(
    { _id: key },
    { $push: { historique: { texte, auteurId, auteurLabel, date: new Date() } } },
    { upsert: true },
  );
}

module.exports = { getRegionState, updateRegionOverrides, addRegionHistoriqueEntry };
