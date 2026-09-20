const fs = require('fs');
const path = require('path');
const { getRegionsCanonCollection } = require('./mongo.js');

// Valeur de secours au démarrage : le fichier JSON historique (voir
// initRegions ci-dessous). Le champ "key" de chaque région est l'identifiant
// stable utilisé par regionStore.js (statut/instabilité modifiés,
// historique...) : ne JAMAIS changer une valeur "key" existante, sinon l'état
// déjà enregistré pour cette région en base est perdu.
const REGIONS = JSON.parse(fs.readFileSync(path.join(__dirname, 'json', 'regions.json'), 'utf-8'));

function slugify(name) {
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function normalize(name) {
  return (name || '').trim().toLowerCase();
}

function resolveRegion(identifier) {
  const target = normalize(identifier);
  return REGIONS.find(r => normalize(r.nom) === target || normalize(r.key) === target);
}

/**
 * Formate l'armée d'une région (agrégat de la maison dirigeante + maisons mineures
 * vassales) pour l'affichage. Renvoie null si aucune force n'est recensée pour cette
 * région (ex: Terres de la Couronne, cités libres...).
 */
function getRegionArmyLines(armee) {
  if (!armee) return null;
  const lines = [
    ['Troupes', armee.troupes.toLocaleString('fr-FR')],
    ['Archers', armee.archers.toLocaleString('fr-FR')],
  ];
  if (armee.cavalerie) lines.push(['Cavalerie', armee.cavalerie.toLocaleString('fr-FR')]);
  if (armee.eclaireurs) lines.push(['Éclaireurs', armee.eclaireurs.toLocaleString('fr-FR')]);
  lines.push(['Flotte', armee.flotte ? `${armee.flotte} navires` : 'Aucune']);
  const total = armee.troupes + armee.archers + (armee.cavalerie || 0) + (armee.eclaireurs || 0);
  lines.push(['Total', total.toLocaleString('fr-FR')]);
  return lines;
}

/**
 * Charge la fiche "canon" de chaque région depuis MongoDB (collection
 * "regions_canon") — même principe que initMaisons() dans Data/maisons.js.
 * À appeler (et attendre) tout au début du démarrage, avant que quoi que ce
 * soit ne lise le contenu de REGIONS.
 */
async function initRegions() {
  try {
    const col = await getRegionsCanonCollection();
    let docs = await col.find({}).toArray();

    if (docs.length === 0) {
      const seed = REGIONS.map(r => ({ ...r, _id: r.key }));
      if (seed.length) await col.insertMany(seed);
      docs = seed;
    }

    REGIONS.length = 0;
    docs.forEach(({ _id, ...rest }) => REGIONS.push({ key: _id, ...rest }));
    console.log(`✅ ${REGIONS.length} région(s) chargée(s) depuis MongoDB.`);
  } catch (err) {
    console.error('❌ Impossible de charger les régions depuis MongoDB, utilisation du JSON local en secours :', err.message);
  }
  return REGIONS;
}

module.exports = { REGIONS, resolveRegion, getRegionArmyLines, slugify, initRegions };