// Catalogue des classes de vaisseaux + grades militaires.
// ⚠️ Ce fichier existe en DOUBLE (bot : Data/shipClasses.js, site : Data/shipClasses.js).
// Toute modification doit être reportée dans les deux dépôts.

// Grades militaires, du plus BAS au plus HAUT (rôles Discord).
const RANKS = [
  { key: 'LIEUTENANT', name: 'Lieutenant', id: '1570048029409550356' },
  { key: 'LIEUTENANT_COMMANDER', name: 'Lieutenant commander', id: '1570048091761942608' },
  { key: 'COMMANDER', name: 'Commander', id: '1570048199270469642' },
  { key: 'CAPITAINE', name: 'Capitaine', id: '1570048272037453865' },
  { key: 'COMMANDANT', name: 'Commandant', id: '1570048308746129419' },
];

// minRank : grade minimum (index dans RANKS) pour piloter la classe. Un grade plus
// haut peut piloter tout ce que peuvent piloter les grades plus bas.
// leaderOnly : réservé au chef de faction (ou, à défaut, au plus haut gradé de la bataille).
// Les statistiques par défaut servent de modèle à la création d'un vaisseau sur le site
// (tout reste modifiable vaisseau par vaisseau).
const SHIP_CLASSES = {
  TRANSPORT:        { label: 'Transport spatial',   size: '< 100 m',          squadrons: 0,   minRank: 0, defaults: { hp: 300,    shield: 100,   range: 3, crew: 20,   barrage: 5,   focus: 10 } },
  CORVETTE:         { label: 'Corvette',            size: '100 – 200 m',      squadrons: 2,   minRank: 0, defaults: { hp: 600,    shield: 250,   range: 4, crew: 60,   barrage: 12,  focus: 30 } },
  FREGATE:          { label: 'Frégate',             size: '200 – 400 m',      squadrons: 6,   minRank: 1, defaults: { hp: 1200,   shield: 500,   range: 5, crew: 200,  barrage: 25,  focus: 60 } },
  CROISEUR_LEGER:   { label: 'Croiseur léger',      size: '400 – 600 m',      squadrons: 12,  minRank: 1, defaults: { hp: 2000,   shield: 800,   range: 6, crew: 400,  barrage: 40,  focus: 100 } },
  CROISEUR_LOURD:   { label: 'Croiseur lourd',      size: '600 – 1 000 m',    squadrons: 25,  minRank: 2, defaults: { hp: 3500,   shield: 1400,  range: 7, crew: 800,  barrage: 60,  focus: 160 } },
  DESTROYER:        { label: 'Destroyer stellaire', size: '1 000 – 2 000 m',  squadrons: 80,  minRank: 3, defaults: { hp: 6000,   shield: 2500,  range: 8, crew: 2500, barrage: 100, focus: 260 } },
  CROISEUR_BATAILLE:{ label: 'Croiseur de bataille',size: '2 000 – 5 000 m',  squadrons: 130, leaderOnly: true, defaults: { hp: 10000,  shield: 4500,  range: 9, crew: 5000, barrage: 160, focus: 400 } },
  CUIRASSE:         { label: 'Cuirassé',            size: '> 5 000 m',        squadrons: 200, leaderOnly: true, defaults: { hp: 16000,  shield: 7000,  range: 10, crew: 9000, barrage: 240, focus: 600 } },
};

// Ordre de taille (du plus petit au plus grand) : utile pour le rayon tracteur plus tard.
const SHIP_CLASS_ORDER = Object.keys(SHIP_CLASSES);

/** Index du plus haut grade militaire présent dans une liste d'IDs de rôles (-1 si aucun). */
function getRankIndex(roleIds = []) {
  const set = new Set(roleIds.map(String));
  let best = -1;
  RANKS.forEach((rank, index) => { if (set.has(rank.id)) best = index; });
  return best;
}

/**
 * Un pilote peut-il se voir attribuer cette classe ?
 * @returns {{ok:boolean, reason?:string}}
 */
function canPilot(classKey, rankIndex, isLeader = false) {
  const cls = SHIP_CLASSES[classKey];
  if (!cls) return { ok: false, reason: 'Classe de vaisseau inconnue.' };
  if (cls.leaderOnly) {
    return isLeader ? { ok: true } : { ok: false, reason: `Le ${cls.label} est réservé au chef de faction.` };
  }
  if (rankIndex < 0) return { ok: false, reason: 'Ce joueur n\'a aucun grade militaire.' };
  if (rankIndex < cls.minRank) {
    return { ok: false, reason: `Grade insuffisant : il faut au moins « ${RANKS[cls.minRank].name} » pour piloter un(e) ${cls.label}.` };
  }
  return { ok: true };
}

module.exports = { RANKS, SHIP_CLASSES, SHIP_CLASS_ORDER, getRankIndex, canPilot };
