const fs = require('fs');
const path = require('path');
const { getMaisonsCanonCollection } = require('./mongo.js');

// Valeur de secours au démarrage : le fichier JSON historique. MAISONS n'est
// donc jamais vide, même avant qu'initMaisons() ait fini de parler à Mongo,
// et même si Mongo est injoignable. Le champ "key" de chaque maison est
// l'identifiant stable utilisé par maisonStore.js (chef de maison,
// historique...) : ne JAMAIS changer une valeur "key" existante, sinon l'état
// déjà enregistré pour cette maison en base est perdu.
const MAISONS = JSON.parse(fs.readFileSync(path.join(__dirname, 'json', 'maisons.json'), 'utf-8'));

function slugify(name) {
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function normalize(name) {
  return (name || '').replace(/^maison\s+/i, '').trim().toLowerCase();
}

function getMaisonByName(nom) {
  const target = normalize(nom);
  return MAISONS.find(m => normalize(m.nom) === target);
}

function resolveMaison(identifier) {
  return MAISONS.find(m => m.key === identifier) || getMaisonByName(identifier);
}

function totalSoldats(armee) {
  if (armee.guerriers !== undefined) {
    return armee.guerriers + armee.archers + armee.eclaireurs;
  }
  return armee.fantassins + armee.archers + armee.cavalerie;
}

function getArmeeLines(armee) {
  if (armee.guerriers !== undefined) {
    return [
      ['Guerriers', armee.guerriers.toLocaleString('fr-FR')],
      ['Archers', armee.archers.toLocaleString('fr-FR')],
      ['Éclaireurs', armee.eclaireurs.toLocaleString('fr-FR')],
      ['Total', totalSoldats(armee).toLocaleString('fr-FR')],
    ];
  }
  const flotte = armee.flotte
    ? `${armee.flotte} navires${armee.noteFlotte ? ` (${armee.noteFlotte})` : ''}`
    : 'Aucune';
  return [
    ['Fantassins', armee.fantassins.toLocaleString('fr-FR')],
    ['Archers', armee.archers.toLocaleString('fr-FR')],
    ['Cavalerie', armee.cavalerie.toLocaleString('fr-FR')],
    ['Total (terre)', totalSoldats(armee).toLocaleString('fr-FR')],
    ['Flotte', flotte],
  ];
}

/**
 * Charge la fiche "canon" de chaque maison depuis MongoDB (collection
 * "maisons_canon") — c'est désormais la source de vérité partagée par le bot
 * ET le site admin, fini les deux copies de fichier JSON qui se
 * désynchronisaient. Si la collection est vide (première mise en route), on
 * la pré-remplit avec le contenu du fichier JSON historique. En cas de souci
 * Mongo, on garde simplement les données du JSON déjà chargées ci-dessus
 * plutôt que de faire planter le démarrage.
 *
 * IMPORTANT : doit être appelée (et attendue) tout au début du démarrage,
 * avant que quoi que ce soit ne lise le contenu de MAISONS (ex : avant de
 * charger les commandes Discord qui construisent leurs menus déroulants à
 * partir de cette liste).
 */
async function initMaisons() {
  try {
    const col = await getMaisonsCanonCollection();
    let docs = await col.find({}).toArray();

    if (docs.length === 0) {
      const seed = MAISONS.map(m => ({ ...m, _id: m.key }));
      if (seed.length) await col.insertMany(seed);
      docs = seed;
    }

    MAISONS.length = 0;
    docs.forEach(({ _id, ...rest }) => MAISONS.push({ key: _id, ...rest }));
    console.log(`✅ ${MAISONS.length} maison(s) chargée(s) depuis MongoDB.`);
  } catch (err) {
    console.error('❌ Impossible de charger les maisons depuis MongoDB, utilisation du JSON local en secours :', err.message);
  }
  return MAISONS;
}

module.exports = { MAISONS, getMaisonByName, resolveMaison, totalSoldats, getArmeeLines, slugify, initMaisons };