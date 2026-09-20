const fs = require('fs');
const path = require('path');

// Données statiques des régions, éditables directement dans Data/regions.json
// (pas besoin de toucher au code pour changer un nom, une capitale, un statut...).
// Le champ "key" de chaque région est l'identifiant stable utilisé par regionStore.js
// (statut/instabilité modifiés, historique...) : ne JAMAIS changer une valeur "key"
// existante dans le JSON, sinon l'état déjà enregistré pour cette région en base est perdu.
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

module.exports = { REGIONS, resolveRegion, getRegionArmyLines, slugify };