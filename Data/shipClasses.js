// Catalogue canonique des classes de vaisseaux et des grades militaires.
// Le gabarit de carte est défini ici, jamais individuellement sur un vaisseau.
const RANKS = [
  { key: 'LIEUTENANT', name: 'Lieutenant', id: '1570048029409550356' },
  { key: 'LIEUTENANT_COMMANDER', name: 'Lieutenant commander', id: '1570048091761942608' },
  { key: 'COMMANDER', name: 'Commander', id: '1570048199270469642' },
  { key: 'CAPITAINE', name: 'Capitaine', id: '1570048272037453865' },
  { key: 'COMMANDANT', name: 'Commandant', id: '1570048308746129419' },
];

// mapWidth = largeur X ; mapLength = longueur Y. Identifiants stables pour les données RP.
const SHIP_CLASSES = {
  TRANSPORT: { id: 'SW-SHIP-TRN-001', imageBaseName: 'transport-spatial', label: 'Transport spatial', size: '< 100 m', squadrons: 0, minRank: 0, defaults: { hp: 300, shield: 100, range: 3, crew: 20, barrage: 5, focus: 10, mapWidth: 1, mapLength: 1 } },
  CORVETTE: { id: 'SW-SHIP-COR-001', imageBaseName: 'corvette', label: 'Corvette', size: '100 – 200 m', squadrons: 2, minRank: 0, defaults: { hp: 600, shield: 250, range: 4, crew: 60, barrage: 12, focus: 30, mapWidth: 1, mapLength: 2 } },
  FREGATE: { id: 'SW-SHIP-FRG-001', imageBaseName: 'fregate', label: 'Frégate', size: '200 – 400 m', squadrons: 6, minRank: 1, defaults: { hp: 1200, shield: 500, range: 5, crew: 200, barrage: 25, focus: 60, mapWidth: 2, mapLength: 3 } },
  CROISEUR_LEGER: { id: 'SW-SHIP-CRL-001', imageBaseName: 'croiseur-leger', label: 'Croiseur léger', size: '400 – 600 m', squadrons: 12, minRank: 1, defaults: { hp: 2000, shield: 800, range: 6, crew: 400, barrage: 40, focus: 100, mapWidth: 2, mapLength: 4 } },
  CROISEUR_LOURD: { id: 'SW-SHIP-CRL-002', imageBaseName: 'croiseur-lourd', label: 'Croiseur lourd', size: '600 – 1 000 m', squadrons: 25, minRank: 2, defaults: { hp: 3500, shield: 1400, range: 7, crew: 800, barrage: 60, focus: 160, mapWidth: 3, mapLength: 4 } },
  DESTROYER: { id: 'SW-SHIP-DSR-001', imageBaseName: 'destroyer-stellaire', label: 'Destroyer stellaire', size: '1 000 – 2 000 m', squadrons: 80, minRank: 3, defaults: { hp: 6000, shield: 2500, range: 8, crew: 2500, barrage: 100, focus: 260, mapWidth: 3, mapLength: 5 } },
  CROISEUR_BATAILLE: { id: 'SW-SHIP-CB-001', imageBaseName: 'croiseur-de-bataille', label: 'Croiseur de bataille', size: '2 000 – 5 000 m', squadrons: 130, leaderOnly: true, defaults: { hp: 10000, shield: 4500, range: 9, crew: 5000, barrage: 160, focus: 400, mapWidth: 4, mapLength: 6 } },
  CUIRASSE: { id: 'SW-SHIP-CUI-001', imageBaseName: 'cuirasse', label: 'Cuirassé', size: '> 5 000 m', squadrons: 200, leaderOnly: true, defaults: { hp: 16000, shield: 7000, range: 10, crew: 9000, barrage: 240, focus: 600, mapWidth: 4, mapLength: 7 } },
};
const SHIP_CLASS_ORDER = Object.keys(SHIP_CLASSES);
function getRankIndex(roleIds = []) {
  const set = new Set(roleIds.map(String));
  let best = -1;
  RANKS.forEach((rank, index) => { if (set.has(rank.id)) best = index; });
  return best;
}
function canPilot(classKey, rankIndex, isLeader = false) {
  const cls = SHIP_CLASSES[classKey];
  if (!cls) return { ok: false, reason: 'Classe de vaisseau inconnue.' };
  if (cls.leaderOnly) return isLeader ? { ok: true } : { ok: false, reason: `Le ${cls.label} est réservé au chef de faction.` };
  if (rankIndex < 0) return { ok: false, reason: "Ce joueur n\'a aucun grade militaire." };
  if (rankIndex < cls.minRank) return { ok: false, reason: `Grade insuffisant : il faut au moins « ${RANKS[cls.minRank].name} » pour piloter un(e) ${cls.label}.` };
  return { ok: true };
}
module.exports = { RANKS, SHIP_CLASSES, SHIP_CLASS_ORDER, getRankIndex, canPilot };
