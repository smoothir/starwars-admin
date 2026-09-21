const config = require('./config.js');

/**
 * Aplati config.FACTIONS pour un accès simple : liste des factions, dans
 * l'ordre déclaré, avec leur rôle de catégorie et leurs grades (déjà triés
 * du plus haut au plus bas, tel que défini dans Data/config.js).
 */
function getFactions() {
  return Object.entries(config.FACTIONS).map(([key, faction]) => ({
    key,
    label: faction.label,
    categoryRoleId: faction.categoryRoleId,
    grades: faction.grades,
  }));
}

function getFaction(key) {
  const faction = config.FACTIONS[key];
  if (!faction) return null;
  return { key, label: faction.label, categoryRoleId: faction.categoryRoleId, grades: faction.grades };
}

/**
 * Retrouve la faction + le grade correspondant à un ID de rôle Discord.
 * Utilisé pour :
 * - relier automatiquement un grade choisi (étape 1 de /reservation) à sa
 *   catégorie (ex : "Maître Jedi" → catégorie "L'ORDRE JEDI") ;
 * - ranger un profil dans le bon salon lors de /synclistchara.
 */
function findGradeByRoleId(roleId) {
  if (!roleId) return null;

  for (const [key, faction] of Object.entries(config.FACTIONS)) {
    const grade = faction.grades.find(g => g.id === roleId);
    if (grade) {
      return {
        faction: { key, label: faction.label, categoryRoleId: faction.categoryRoleId, grades: faction.grades },
        grade,
      };
    }
  }

  return null;
}

/**
 * Options du menu déroulant "choisir sa faction" (étape 1 de /reservation).
 */
function buildFactionSelectOptions() {
  return Object.entries(config.FACTIONS).map(([key, faction]) => ({
    label: faction.label,
    value: key,
  }));
}

/**
 * Options du menu déroulant "choisir son grade", une fois la faction choisie.
 */
function buildGradeSelectOptions(factionKey) {
  const faction = config.FACTIONS[factionKey];
  if (!faction) return [];

  return faction.grades.map(g => ({
    label: g.name,
    value: g.id,
  }));
}

module.exports = {
  getFactions,
  getFaction,
  findGradeByRoleId,
  buildFactionSelectOptions,
  buildGradeSelectOptions,
};
