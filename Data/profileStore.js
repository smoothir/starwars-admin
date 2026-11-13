const { getProfilsCollection } = require('./mongo.js');
const config = require('./config.js');

const STATUTS = ['Vivant', 'Blessé', 'Prisonnier', 'Mort'];
const STATUT_EMOJI = {
  Vivant: '🟢',
  Blessé: '🟠',
  Prisonnier: '⛓️',
  Mort: '💀',
};

// Schéma commun bot/site : toutes les statistiques sont notées sur 100.
// Les plafonds d'allocation liés à l'âge sont conservés proportionnellement.
const DEFAULT_STATS = [
  'Éloquence & Commerce',
  'Corps-à-corps',
  'Tir & Précision',
  'Pilotage',
  'Technologie & Savoir',
  'Résistance',
];
const STAT_MAX = 100;
const STATS_SCHEMA_VERSION = 2;
const STATS_MIGRATION_MARKER_ID = '__stats_unified_sur_100_v2__';
const PREVIOUS_SITE_MIGRATION_MARKER_ID = '__stats_migrated_sur_100__';

function normalizeStatName(value) {
  const stat = String(value || '').trim();
  return stat === 'Endurance & Survie' ? 'Résistance' : stat;
}
let statsMigrationPromise = null;

/**
 * Migration idempotente vers le schéma commun /100 et la statistique « Résistance ».
 * Les profils contenant encore « Endurance & Survie » proviennent de l'ancien
 * schéma du bot (/20) : leurs valeurs sont converties x5 puis renommées. Les
 * profils déjà migrés par l'ancien site restent sur /100. Le marqueur par profil
 * empêche toute double conversion, même si bot et site démarrent ensemble.
 */
async function ensureStatsMigrated() {
  if (statsMigrationPromise) return statsMigrationPromise;
  statsMigrationPromise = (async () => {
    const col = await getProfilsCollection();
    const previousSiteMarker = await col.findOne({ _id: PREVIOUS_SITE_MIGRATION_MARKER_ID }, { projection: { _id: 1 } });
    const profiles = await col.find({
      _id: { $not: /^__/ },
      stats: { $exists: true },
      statsSchemaVersion: { $ne: STATS_SCHEMA_VERSION },
    }).toArray();

    for (const profile of profiles) {
      const stats = { ...(profile.stats || {}) };
      const hadLegacyResistance = Object.prototype.hasOwnProperty.call(stats, 'Endurance & Survie');
      // Un marqueur du précédent site signifie que ses profils déjà présents
      // ont été convertis en /100. Les profils bot encore anciens gardent
      // « Endurance & Survie », ce qui permet de les reconnaître.
      const factor = (profile.statsScale === 100 || (previousSiteMarker && !hadLegacyResistance)) ? 1 : 5;

      for (const stat of ['Éloquence & Commerce', 'Corps-à-corps', 'Tir & Précision', 'Pilotage', 'Technologie & Savoir']) {
        const value = Number(stats[stat]);
        if (Number.isFinite(value)) stats[stat] = Math.max(0, Math.min(STAT_MAX, Math.round(value * factor)));
        else stats[stat] = 0;
      }

      const legacyResistance = Number(stats['Endurance & Survie']);
      const currentResistance = Number(stats['Résistance']);
      if (hadLegacyResistance && Number.isFinite(legacyResistance)) {
        const migratedResistance = Math.max(0, Math.min(STAT_MAX, Math.round(legacyResistance * factor)));
        stats['Résistance'] = Number.isFinite(currentResistance)
          ? Math.max(0, Math.min(STAT_MAX, Math.max(currentResistance, migratedResistance)))
          : migratedResistance;
      } else if (!Number.isFinite(currentResistance)) {
        stats['Résistance'] = 0;
      }
      delete stats['Endurance & Survie'];

      // Les statistiques personnalisées sont conservées, mais ne dépassent plus
      // le plafond commun quand elles sont des nombres.
      for (const [key, value] of Object.entries(stats)) {
        if (typeof value === 'number') stats[key] = Math.max(0, Math.min(STAT_MAX, value));
      }

      await col.updateOne(
        { _id: profile._id, statsSchemaVersion: { $ne: STATS_SCHEMA_VERSION } },
        { $set: { stats, statsScale: STAT_MAX, statsSchemaVersion: STATS_SCHEMA_VERSION, statsMigratedAt: new Date(), updatedAt: new Date() } },
      );
    }

    await col.updateOne(
      { _id: STATS_MIGRATION_MARKER_ID },
      { $setOnInsert: { migratedAt: new Date(), schemaVersion: STATS_SCHEMA_VERSION } },
      { upsert: true },
    );
  })().catch(error => {
    statsMigrationPromise = null;
    throw error;
  });
  return statsMigrationPromise;
}

function getStatPointLimits(ageValue) {
  const match = String(ageValue ?? '').match(/\d{1,3}/);
  if (!match) return null;
  const age = Number(match[0]);
  if (!Number.isInteger(age) || age < 15) return null;

  if (age <= 20) return { age, ageBand: '15–20 ans', maxTotal: 100, maxPerStat: 25 };
  if (age <= 30) return { age, ageBand: '21–30 ans', maxTotal: 150, maxPerStat: 50 };
  if (age <= 45) return { age, ageBand: '31–45 ans', maxTotal: 200, maxPerStat: 75 };
  return { age, ageBand: '46 ans et plus', maxTotal: 225, maxPerStat: 100 };
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
  await ensureStatsMigrated();
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
      statsScale: STAT_MAX,
      statsSchemaVersion: STATS_SCHEMA_VERSION,
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
  await ensureStatsMigrated();
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
      statsScale: STAT_MAX,
      statsSchemaVersion: STATS_SCHEMA_VERSION,
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
  await ensureStatsMigrated();
  const col = await getProfilsCollection();
  return col.findOne({ reservationChannelId });
}

/**
 * Tous les profils du serveur, tous joueurs confondus. Réservé au staff
 * (utilisé par /profil pour le staff, et par l'autocomplétion de /stats).
 */
async function deleteProfile(profileId) {
  if (String(profileId).startsWith('__')) return false;
  const col = await getProfilsCollection();
  const result = await col.deleteOne({ _id: profileId });
  return result.deletedCount > 0;
}

async function listAllProfiles() {
  await ensureStatsMigrated();
  const col = await getProfilsCollection();
  return col.find({ _id: { $not: /^__/ } }).toArray();
}


/**
 * Nettoie les effets temporaires expirés et calcule les statistiques finales
 * (stats de base + effets temporaires encore actifs).
 */
async function getEffectiveStats(profileOrId) {
  if (typeof profileOrId === 'string') await ensureStatsMigrated();
  const col = await getProfilsCollection();
  const profile = typeof profileOrId === 'string'
    ? await col.findOne({ _id: profileOrId })
    : profileOrId;
  if (!profile) return null;

  const now = Date.now();
  const effects = Array.isArray(profile.statEffects) ? profile.statEffects : [];
  const actifs = effects.filter(effect => !effect?.expiresAt || new Date(effect.expiresAt).getTime() > now);

  if (typeof profileOrId === 'string' && actifs.length !== effects.length) {
    await col.updateOne(
      { _id: profile._id },
      { $set: { statEffects: actifs, updatedAt: new Date() } },
    );
  }

  const stats = { ...(profile.stats || {}) };
  if (Object.prototype.hasOwnProperty.call(stats, 'Endurance & Survie')) {
    stats['Résistance'] = Math.max(Number(stats['Résistance']) || 0, Number(stats['Endurance & Survie']) || 0);
    delete stats['Endurance & Survie'];
  }
  for (const effect of actifs) {
    const stat = normalizeStatName(effect.stat);
    const amount = Number(effect.amount) || 0;
    if (!stat || !amount) continue;
    stats[stat] = stats[stat] ?? 0;
    stats[stat] += amount;
  }

  // Les traits d'addiction appliquent leur malus lorsque la date limite est
  // dépassée. Une dose consommée via l'inventaire repousse cette échéance de
  // trois jours réels et retire automatiquement le malus de l'affichage.
  const nowMs = Date.now();
  for (const addiction of Array.isArray(profile.traitAddictions) ? profile.traitAddictions : []) {
    const due = addiction?.nextDoseDueAt ? new Date(addiction.nextDoseDueAt).getTime() : 0;
    const stat = normalizeStatName(addiction?.stat);
    const amount = Math.min(-1, Number(addiction?.amount) || -10);
    if (!stat || !due || due > nowMs) continue;
    stats[stat] = (Number(stats[stat]) || 0) + amount;
  }

  for (const [stat, value] of Object.entries(stats)) {
    stats[stat] = Math.max(0, Math.min(STAT_MAX, Number(value) || 0));
  }

  return stats;
}

/** Modifie définitivement une statistique et la maintient dans la plage 0..STAT_MAX. */
async function applyPermanentStatChange(profileId, stat, amount) {
  stat = normalizeStatName(stat);
  await ensureStatsMigrated();
  const col = await getProfilsCollection();
  const profile = await col.findOne({ _id: profileId });
  if (!profile) return null;

  const current = Number(profile.stats?.[stat] ?? 0) || 0;
  const next = Math.max(0, Math.min(STAT_MAX, current + (Number(amount) || 0)));
  await col.updateOne(
    { _id: profileId },
    { $set: { [`stats.${stat}`]: next, updatedAt: new Date() } },
  );
  return { before: current, after: next, profile: await col.findOne({ _id: profileId }) };
}

/** Ajoute un effet temporaire de statistique, valable pendant `durationMinutes`. */
async function addTemporaryStatEffect(profileId, stat, amount, durationMinutes) {
  stat = normalizeStatName(stat);
  await ensureStatsMigrated();
  const col = await getProfilsCollection();
  const profile = await col.findOne({ _id: profileId });
  if (!profile) return null;

  const now = Date.now();
  const currentEffects = (Array.isArray(profile.statEffects) ? profile.statEffects : [])
    .filter(effect => !effect?.expiresAt || new Date(effect.expiresAt).getTime() > now);
  const effect = {
    id: `effect_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    stat: String(stat).slice(0, 100),
    amount: Number(amount) || 0,
    createdAt: new Date(),
    expiresAt: new Date(now + Math.max(1, Number(durationMinutes) || 1) * 60 * 1000),
  };

  await col.updateOne(
    { _id: profileId },
    { $set: { statEffects: [...currentEffects, effect], updatedAt: new Date() } },
  );
  return { effect, profile: await col.findOne({ _id: profileId }) };
}

async function updateProfileFields(profileId, fields) {
  await ensureStatsMigrated();
  const col = await getProfilsCollection();
  await col.updateOne({ _id: profileId }, { $set: { ...fields, updatedAt: new Date() } });
  return getProfile(profileId);
}

/**
 * Modifie le niveau de relation (1 = Atroce à 5 = Excellente) d'un personnage
 * avec une faction précise, sans toucher aux autres relations.
 */
async function setRelationLevel(profileId, factionKey, level) {
  await ensureStatsMigrated();
  const col = await getProfilsCollection();
  const clamped = Math.max(1, Math.min(5, level));
  await col.updateOne(
    { _id: profileId },
    { $set: { [`relations.${factionKey}`]: clamped, updatedAt: new Date() } },
  );
  return getProfile(profileId);
}

/**
 * Enregistre la répartition initiale des statistiques choisie par le joueur.
 * Les plafonds sont recalculés depuis l'âge stocké dans le profil : ils ne
 * dépendent jamais des valeurs envoyées par l'interaction Discord.
 */
async function savePlayerStatAllocation(profileId, values) {
  await ensureStatsMigrated();
  const col = await getProfilsCollection();
  const existing = await col.findOne({ _id: profileId });
  if (!existing) return { ok: false, code: 'profile_not_found' };
  if (existing.statsAllocated) return { ok: false, code: 'already_allocated', profile: existing };
  if (existing.traitsApplied) return { ok: false, code: 'traits_already_applied', profile: existing };

  const limits = getStatPointLimits(existing.age);
  if (!limits) return { ok: false, code: 'invalid_age', profile: existing };

  const stats = { ...(existing.stats || {}) };
  for (const stat of DEFAULT_STATS) {
    const value = values?.[stat];
    if (!Number.isInteger(value) || value < 0) {
      return { ok: false, code: 'invalid_value', stat, limits, profile: existing };
    }
    if (value > limits.maxPerStat) {
      return { ok: false, code: 'stat_limit_exceeded', stat, value, limits, profile: existing };
    }
    stats[stat] = value;
  }

  const pointsUsed = DEFAULT_STATS.reduce((sum, stat) => sum + stats[stat], 0);
  if (pointsUsed > limits.maxTotal) {
    return { ok: false, code: 'total_limit_exceeded', pointsUsed, limits, profile: existing };
  }

  const result = await col.updateOne(
    { _id: profileId, statsAllocated: { $ne: true }, traitsApplied: { $ne: true } },
    {
      $set: {
        stats,
        statsScale: STAT_MAX,
        statsSchemaVersion: STATS_SCHEMA_VERSION,
        statsAllocated: true,
        statsRolled: true,
        statsPointsUsed: pointsUsed,
        statsAllocation: {
          age: limits.age,
          ageBand: limits.ageBand,
          maxTotal: limits.maxTotal,
          maxPerStat: limits.maxPerStat,
          pointsUsed,
        },
        statsAllocatedAt: new Date(),
        updatedAt: new Date(),
      },
    },
  );

  if (!result.matchedCount) {
    const latest = await col.findOne({ _id: profileId });
    return {
      ok: false,
      code: latest?.traitsApplied ? 'traits_already_applied' : 'already_allocated',
      profile: latest,
    };
  }

  return { ok: true, profile: await col.findOne({ _id: profileId }), limits, pointsUsed };
}

/**
 * Tire des statistiques aléatoires (1 à STAT_MAX sur chacune des DEFAULT_STATS)
 * pour un personnage — utilisé par le bouton "🎲 Stats aléatoire" affiché une
 * fois la fiche validée. Ne fait rien si les stats ont déjà été tirées, pour
 * éviter qu'on puisse relancer indéfiniment en espérant de meilleures valeurs.
 * Retourne { profile, alreadyRolled }.
 */
async function rollRandomStats(profileId) {
  await ensureStatsMigrated();
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
    { $set: { stats, statsScale: STAT_MAX, statsSchemaVersion: STATS_SCHEMA_VERSION, statsRolled: true, updatedAt: new Date() } },
  );

  return { profile: await col.findOne({ _id: profileId }), alreadyRolled: false };
}

module.exports = {
  STATUTS,
  STATUT_EMOJI,
  DEFAULT_STATS,
  STAT_MAX,
  STATS_SCHEMA_VERSION,
  normalizeStatName,
  ensureStatsMigrated,
  getStatPointLimits,
  savePlayerStatAllocation,
  buildProfileId,
  upsertProfileFromTicket,
  upsertProfileBasicInfo,
  getProfile,
  getProfileByChannel,
  listProfilesForUser,
  listAllProfiles,
  deleteProfile,
  updateProfileFields,
  getEffectiveStats,
  applyPermanentStatChange,
  addTemporaryStatEffect,
  setRelationLevel,
  rollRandomStats,
};