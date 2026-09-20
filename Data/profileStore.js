const { getProfilsCollection } = require('./mongo.js');

const STATUTS = ['Vivant', 'Blessé', 'Prisonnier', 'Mort'];
const STATUT_EMOJI = {
  Vivant: '🟢',
  Blessé: '🟠',
  Prisonnier: '⛓️',
  Mort: '💀',
};

// Statistiques toujours affichées sur la carte "Stats", même si leur valeur est 0.
// Le staff peut ajouter n'importe quel autre nom de stat via /stats, elle s'affichera
// en plus de celles-ci.
const DEFAULT_STATS = ['Force', 'Agilité', 'Intelligence', 'Charisme', 'Endurance', 'Chance'];

function slugify(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // retire les accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildProfileId(userId, nomPrenom) {
  return `${userId}_${slugify(nomPrenom)}`;
}

/**
 * Crée (ou met à jour) le profil d'un personnage à partir des infos de son ticket
 * de fiche, une fois celle-ci validée. Ne touche jamais aux champs modifiables
 * par le joueur (statut, garde personnelle, bourse, alliés, rivaux, renommée, notes)
 * s'ils existent déjà — seules les infos issues de la fiche sont (re)synchronisées.
 */
async function upsertProfileFromTicket(ticket) {
  const col = await getProfilsCollection();
  const profileId = buildProfileId(ticket.userId, ticket.nomPrenom);

  const existing = await col.findOne({ _id: profileId });

  const ficheFields = {
    userId: ticket.userId,
    nomPrenom: ticket.nomPrenom,
    surnom: ticket.surnom,
    faceclaim: ticket.faceclaim,
    regionId: ticket.regionId,
    regionName: ticket.regionName,
    maisonId: ticket.maisonId,
    maisonName: ticket.maisonName,
    roleId: ticket.roleId,
    roleName: ticket.roleName,
    ficheUrl: ticket.ficheUrl,
    reservationUrl: ticket.reservationUrl || null,
    updatedAt: new Date(),
  };

  if (existing) {
    await col.updateOne({ _id: profileId }, { $set: ficheFields });
  } else {
    await col.insertOne({
      _id: profileId,
      ...ficheFields,
      statut: 'Vivant',
      gardePersonnelle: 'Aucune',
      boursePersonnelle: 'Aucune',
      allies: 'Aucun',
      rivaux: 'Aucun',
      renommee: 0,
      notes: 'Aucune',
      stats: Object.fromEntries(DEFAULT_STATS.map(s => [s, 0])),
      createdAt: new Date(),
    });
  }

  return col.findOne({ _id: profileId });
}

async function getProfile(profileId) {
  const col = await getProfilsCollection();
  return col.findOne({ _id: profileId });
}

async function listProfilesForUser(userId) {
  const col = await getProfilsCollection();
  return col.find({ userId }).toArray();
}

/**
 * Tous les profils du serveur, tous joueurs confondus. Réservé au staff
 * (utilisé par /profil pour le staff, et par l'autocomplétion de /stats).
 */
async function listAllProfiles() {
  const col = await getProfilsCollection();
  return col.find({}).toArray();
}

/**
 * Retrouve le profil d'un joueur pour une maison précise (utilisé pour afficher
 * le nom du personnage, en plus du pseudo, du chef de maison).
 */
async function findProfileByUserAndMaison(userId, maisonName) {
  const col = await getProfilsCollection();
  return col.findOne({ userId, maisonName });
}

async function updateProfileFields(profileId, fields) {
  const col = await getProfilsCollection();
  await col.updateOne({ _id: profileId }, { $set: { ...fields, updatedAt: new Date() } });
  return getProfile(profileId);
}

module.exports = {
  STATUTS,
  STATUT_EMOJI,
  DEFAULT_STATS,
  buildProfileId,
  upsertProfileFromTicket,
  getProfile,
  listProfilesForUser,
  listAllProfiles,
  findProfileByUserAndMaison,
  updateProfileFields,
};