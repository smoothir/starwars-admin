const { getProfilsCollection } = require('./mongo.js');
const config = require('./config.js');

const STATUTS = ['Vivant', 'Blessé', 'Prisonnier', 'Mort'];
const STATUT_EMOJI = {
  Vivant: '🟢',
  Blessé: '🟠',
  Prisonnier: '⛓️',
  Mort: '💀',
};

// Statistiques toujours affichées sur la carte "Stats", même si leur valeur est 0.
// Chaque statistique est notée sur STAT_MAX (100). Le staff peut ajouter n'importe
// quel autre nom de stat via /stats, elle s'affichera en plus de celles-ci.
const DEFAULT_STATS = [
  'Éloquence & Commerce',
  'Corps-à-corps',
  'Tir & Précision',
  'Pilotage',
  'Technologie & Savoir',
  'Résistance',
];
const STAT_MAX = 100;

// Ancienne liste (notée sur 10), conservée uniquement pour la migration
// automatique ci-dessous — ne pas utiliser ailleurs dans le code.
const OLD_DEFAULT_STATS = [
  'Éloquence & Commerce',
  'Corps-à-corps',
  'Tir & Précision',
  'Pilotage',
  'Technologie & Savoir',
  'Endurance & Survie',
];
const OLD_STAT_MAX = 10;

// Document marqueur (même collection "profils") attestant que la migration
// "stats sur 100" a déjà eu lieu — une seule fois à vie, jamais renvoyé comme
// un profil (voir le filtre dans listAllProfiles ci-dessous).
const STATS_MIGRATION_MARKER_ID = '__stats_migrated_sur_100__';

/**
 * Migration "stats sur 100" : pour chaque profil déjà existant,
 *  - retire l'ancienne stat "Endurance & Survie" (supprimée, remplacée par
 *    "Résistance" qui démarre à 0 comme toute nouvelle stat) ;
 *  - multiplie par 10 les autres stats par défaut pour les faire passer de
 *    l'échelle /10 à l'échelle /100, en conservant leur valeur relative.
 * Ne touche jamais une stat custom ajoutée à la main par le staff (hors des
 * 6 stats par défaut), qui n'a de toute façon pas de maximum défini.
 * Idempotent via le marqueur : s'exécute une seule fois, même si rappelée
 * à chaque démarrage du bot et du site.
 */
async function ensureStatsMigrated() {
  const col = await getProfilsCollection();
  const dejaMigre = await col.findOne({ _id: STATS_MIGRATION_MARKER_ID });
  if (dejaMigre) return;

  const profils = await col.find({ _id: { $ne: STATS_MIGRATION_MARKER_ID }, stats: { $exists: true } }).toArray();
  for (const p of profils) {
    const stats = { ...p.stats };
    let modifie = false;

    if ('Endurance & Survie' in stats) {
      delete stats['Endurance & Survie'];
      modifie = true;
    }
    for (const key of OLD_DEFAULT_STATS) {
      if (key === 'Endurance & Survie') continue; // déjà traitée ci-dessus
      if (typeof stats[key] === 'number') {
        stats[key] = Math.min(STAT_MAX, Math.round(stats[key] * (STAT_MAX / OLD_STAT_MAX)));
        modifie = true;
      }
    }

    if (modifie) {
      await col.updateOne({ _id: p._id }, { $set: { stats, updatedAt: new Date() } });
    }
  }

  await col.updateOne(
    { _id: STATS_MIGRATION_MARKER_ID },
    { $setOnInsert: { migratedAt: new Date() } },
    { upsert: true },
  );
}

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

// Relations de départ d'un nouveau personnage avec chaque faction : Neutre (niveau 3/5).
function buildDefaultRelations() {
  return Object.fromEntries(config.RELATION_FACTIONS.map(f => [f.key, 3]));
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
    roleId: ticket.roleId,
    roleName: ticket.roleName,
    categoryId: ticket.categoryId,
    categoryName: ticket.categoryName,
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
      relations: buildDefaultRelations(),
      renommee: 0,
      notes: 'Aucune',
      stats: Object.fromEntries(DEFAULT_STATS.map(s => [s, 0])),
      createdAt: new Date(),
    });
  }

  return col.findOne({ _id: profileId });
}

/**
 * Crée (ou met à jour) le profil dès le DÉBUT de la réservation (étape 1 du
 * /reservation), avec les seules infos déjà connues à ce stade (nom, prénom,
 * surnom, fonction, faceclaim). Le reste (région, maison, fiche...) sera
 * complété plus tard par `upsertProfileFromTicket` une fois la fiche validée.
 * N'écrase jamais les champs modifiables par le joueur (statut, garde, etc.)
 * s'ils existent déjà.
 */
async function upsertProfileBasicInfo({ userId, nomPrenom, surnom, age, imageUrl, roleName, roleId, categoryId, categoryName, faceclaim, reservationChannelId }) {
  const col = await getProfilsCollection();
  const profileId = buildProfileId(userId, nomPrenom);
  const existing = await col.findOne({ _id: profileId });

  const basicFields = { userId, nomPrenom, surnom, faceclaim, reservationChannelId, updatedAt: new Date() };
  // Certains champs ne sont connus qu'à des étapes différentes du panel : on ne
  // les inclut (et donc n'écrase les anciens) que quand ils sont réellement fournis.
  if (age !== undefined) basicFields.age = age;
  if (imageUrl !== undefined) basicFields.imageUrl = imageUrl;
  if (roleName !== undefined) basicFields.roleName = roleName;
  if (roleId !== undefined) basicFields.roleId = roleId;
  if (categoryId !== undefined) basicFields.categoryId = categoryId;
  if (categoryName !== undefined) basicFields.categoryName = categoryName;

  if (existing) {
    await col.updateOne({ _id: profileId }, { $set: basicFields });
  } else {
    await col.insertOne({
      _id: profileId,
      ...basicFields,
      statut: 'Vivant',
      gardePersonnelle: 'Aucune',
      boursePersonnelle: 'Aucune',
      relations: buildDefaultRelations(),
      renommee: 0,
      notes: 'Aucune',
      stats: Object.fromEntries(DEFAULT_STATS.map(s => [s, 0])),
      createdAt: new Date(),
    });
  }

  return col.findOne({ _id: profileId });
}

async function getProfile(profileId) {
  await ensureStatsMigrated();
  const col = await getProfilsCollection();
  return col.findOne({ _id: profileId });
}

async function listProfilesForUser(userId) {
  await ensureStatsMigrated();
  const col = await getProfilsCollection();
  return col.find({ userId }).toArray();
}

/**
 * Retrouve le profil en cours de création à partir du salon de réservation
 * (utilisé à l'étape 2/validation de /reservation pour retrouver toutes les
 * infos déjà saisies, sans dépendre du contenu de l'embed qui a pu changer).
 */
async function getProfileByChannel(reservationChannelId) {
  const col = await getProfilsCollection();
  return col.findOne({ reservationChannelId });
}

/**
 * Tous les profils du serveur, tous joueurs confondus. Réservé au staff
 * (utilisé par /profil pour le staff, et par l'autocomplétion de /stats).
 */
async function listAllProfiles() {
  await ensureStatsMigrated();
  const col = await getProfilsCollection();
  return col.find({ _id: { $ne: STATS_MIGRATION_MARKER_ID } }).toArray();
}

async function updateProfileFields(profileId, fields) {
  const col = await getProfilsCollection();
  await col.updateOne({ _id: profileId }, { $set: { ...fields, updatedAt: new Date() } });
  return getProfile(profileId);
}

/**
 * Modifie le niveau de relation (1 = Atroce à 5 = Excellente) d'un personnage
 * avec une faction précise, sans toucher aux autres relations.
 */
async function setRelationLevel(profileId, factionKey, level) {
  const col = await getProfilsCollection();
  const clamped = Math.max(1, Math.min(5, level));
  await col.updateOne(
    { _id: profileId },
    { $set: { [`relations.${factionKey}`]: clamped, updatedAt: new Date() } },
  );
  return getProfile(profileId);
}

/**
 * Tire des statistiques aléatoires (1 à STAT_MAX sur chacune des DEFAULT_STATS)
 * pour un personnage — utilisé par le bouton "🎲 Stats aléatoire" affiché une
 * fois la fiche validée. Ne fait rien si les stats ont déjà été tirées, pour
 * éviter qu'on puisse relancer indéfiniment en espérant de meilleures valeurs.
 * Retourne { profile, alreadyRolled }.
 */
async function rollRandomStats(profileId) {
  const col = await getProfilsCollection();
  const existing = await col.findOne({ _id: profileId });
  if (!existing) return { profile: null, alreadyRolled: false };

  if (existing.statsRolled) {
    return { profile: existing, alreadyRolled: true };
  }

  const stats = Object.fromEntries(
    DEFAULT_STATS.map(s => [s, 1 + Math.floor(Math.random() * STAT_MAX)]),
  );

  await col.updateOne(
    { _id: profileId },
    { $set: { stats, statsRolled: true, updatedAt: new Date() } },
  );

  return { profile: await col.findOne({ _id: profileId }), alreadyRolled: false };
}

module.exports = {
  STATUTS,
  STATUT_EMOJI,
  DEFAULT_STATS,
  STAT_MAX,
  buildProfileId,
  upsertProfileFromTicket,
  upsertProfileBasicInfo,
  getProfile,
  getProfileByChannel,
  listProfilesForUser,
  listAllProfiles,
  updateProfileFields,
  setRelationLevel,
  rollRandomStats,
};