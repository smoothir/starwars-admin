// Référentiel de factions partagé avec le bot, y compris les factions ajoutées depuis le site.
const store = require('./factionStore.js');

function getFactions() { return store.listFactionDefs(); }
function getFaction(key) { return store.getFactionDef(key); }
function findGradeByRoleId(roleId) {
  if (!roleId) return null;
  for (const faction of store.listFactionDefs()) {
    const grade = (faction.grades || []).find(g => String(g.id) === String(roleId));
    if (grade) return { faction, grade };
  }
  return null;
}
function buildFactionSelectOptions() {
  return store.listFactionDefs().map(faction => ({ label: faction.label, value: faction.key }));
}
function buildGradeSelectOptions(factionKey) {
  return (store.getFactionDef(factionKey)?.grades || []).map(grade => ({ label: grade.name, value: grade.id }));
}
module.exports = { getFactions, getFaction, findGradeByRoleId, buildFactionSelectOptions, buildGradeSelectOptions };
