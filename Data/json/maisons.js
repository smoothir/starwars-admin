const fs = require('fs');
const path = require('path');

// Données statiques des maisons, éditables directement dans Data/maisons.json
// (pas besoin de toucher au code pour changer un nom, une armée, une région...).
// Le champ "key" de chaque maison est l'identifiant stable utilisé par maisonStore.js
// (chef de maison, historique...) : ne JAMAIS changer une valeur "key" existante dans
// le JSON, sinon l'état déjà enregistré pour cette maison en base est perdu.
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

module.exports = { MAISONS, getMaisonByName, resolveMaison, totalSoldats, getArmeeLines, slugify };