// Suivi des connexions au site + journal des actions, pour le panel "Admin"
// réservé au créateur (Data/config.js -> SUPER_ADMIN_ID). Rien ici n'est lu
// ni utilisé par le bot Discord : c'est uniquement pour le site web.
const { getSiteConnexionsCollection, getSiteLogsCollection, getSiteBackupsCollection, connect } = require('./mongo.js');

// Nombre de logs conservés au total (le plus vieux est supprimé au-delà,
// pour ne pas laisser la collection grossir indéfiniment).
const MAX_LOGS = 2000;

/**
 * Appelé à chaque connexion Discord réussie (dans web/server.js, callback
 * OAuth). Incrémente le compteur de connexions de cet utilisateur et met à
 * jour sa date de dernière connexion (upsert : crée le document au premier
 * login).
 */
async function recordConnexion({ id, username, avatar }) {
  const col = await getSiteConnexionsCollection();
  const now = new Date();
  await col.updateOne(
    { _id: id },
    {
      $set: { username, avatar, lastLogin: now },
      $setOnInsert: { firstLogin: now },
      $inc: { count: 1 },
    },
    { upsert: true }
  );
}

/** Liste des utilisateurs qui se sont déjà connectés, triée par dernière connexion (plus récent d'abord). */
async function listConnexions() {
  const col = await getSiteConnexionsCollection();
  return col.find({}).sort({ lastLogin: -1 }).toArray();
}

/**
 * Ajoute une entrée au journal (connexion, déconnexion, modification d'un
 * profil/objet/inventaire...). `details` est un texte libre déjà formaté
 * (ex: "a modifié le profil de Léon St Patrick").
 */
async function logAction({ discordId, username, avatar, action, details, metadata = null }) {
  const col = await getSiteLogsCollection();
  await col.insertOne({
    discordId: discordId || null,
    username: username || 'Inconnu',
    avatar: avatar || null,
    action,
    details: details || '',
    timestamp: new Date(),
    ...(metadata && typeof metadata === 'object' ? metadata : {}),
  });

  // Purge légère : au-delà de MAX_LOGS entrées, on supprime les plus anciennes.
  // Ne bloque jamais la requête d'origine (best-effort, erreurs juste logguées).
  col.countDocuments().then(async (total) => {
    if (total <= MAX_LOGS) return;
    const trop = total - MAX_LOGS;
    const vieux = await col.find({}).sort({ timestamp: 1 }).limit(trop).project({ _id: 1 }).toArray();
    if (vieux.length) await col.deleteMany({ _id: { $in: vieux.map((d) => d._id) } });
  }).catch((err) => console.error('Purge site_logs échouée :', err.message));
}

/** Les N entrées de log les plus récentes (par défaut 200). */
async function listLogs(limit = 200) {
  const col = await getSiteLogsCollection();
  return col.find({}).sort({ timestamp: -1 }).limit(limit).toArray();
}

const BACKUP_COLLECTIONS = ['profils', 'inv', 'item_catalog', 'avatars', 'avatars_config'];
const MAX_BACKUPS = 20;
const BACKUP_BATCH_SIZE = 100;

/**
 * Cree un snapshot durable des donnees gerees par le site.
 * Les documents sont stockes un par un dans Mongo pour ne jamais depasser
 * la limite de taille d'un document BSON.
 */
async function createBackup({ discordId, username, avatar, preserveSnapshotIds = [] } = {}) {
  const col = await getSiteBackupsCollection();
  const snapshotId = `backup_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const createdAt = new Date();
  const database = await connect();
  const counts = {};

  try {
    for (const collectionName of BACKUP_COLLECTIONS) {
      const documents = await database.collection(collectionName).find({}).toArray();
      counts[collectionName] = documents.length;

      for (let i = 0; i < documents.length; i += BACKUP_BATCH_SIZE) {
        const chunk = documents.slice(i, i + BACKUP_BATCH_SIZE).map((document, offset) => ({
          _id: `${snapshotId}:data:${collectionName}:${i + offset}`,
          kind: 'data',
          snapshotId,
          collection: collectionName,
          index: i + offset,
          document,
        }));
        if (chunk.length) await col.insertMany(chunk, { ordered: true });
      }
    }

    await col.insertOne({
      _id: snapshotId,
      kind: 'meta',
      snapshotId,
      createdAt,
      createdBy: { discordId: discordId || null, username: username || 'Inconnu', avatar: avatar || null },
      collections: counts,
    });

    await pruneBackups(preserveSnapshotIds);
    return { snapshotId, createdAt, createdBy: username || 'Inconnu', collections: counts };
  } catch (err) {
    await col.deleteMany({ snapshotId }).catch(() => {});
    throw err;
  }
}

async function listBackups(limit = MAX_BACKUPS) {
  const col = await getSiteBackupsCollection();
  return col.find({ kind: 'meta' }).sort({ createdAt: -1 }).limit(limit).toArray();
}

async function getBackup(snapshotId) {
  if (!snapshotId) return null;
  const col = await getSiteBackupsCollection();
  return col.findOne({ _id: snapshotId, kind: 'meta' });
}

/**
 * Restaure une sauvegarde. Le snapshot de l'etat actuel est cree avant toute
 * suppression : un rollback accidentel reste donc lui-meme reversible.
 */
async function restoreBackup(snapshotId, actor = {}) {
  const meta = await getBackup(snapshotId);
  if (!meta) throw new Error('Sauvegarde introuvable.');

  const safetyBackup = await createBackup(actor);
  const backupCol = await getSiteBackupsCollection();
  const database = await connect();

  try {
    for (const collectionName of BACKUP_COLLECTIONS) {
      const target = database.collection(collectionName);
      const dataDocs = await backupCol.find({ kind: 'data', snapshotId, collection: collectionName })
        .sort({ index: 1 })
        .toArray();

      await target.deleteMany({});
      for (let i = 0; i < dataDocs.length; i += BACKUP_BATCH_SIZE) {
        const documents = dataDocs.slice(i, i + BACKUP_BATCH_SIZE).map((entry) => entry.document);
        if (documents.length) await target.insertMany(documents, { ordered: true });
      }
    }
  } catch (err) {
    // Tente de revenir a l'etat juste avant le rollback.
    await restoreBackupWithoutSafety(safetyBackup.snapshotId).catch((restoreErr) => {
      console.error('❌ Impossible de restaurer la sauvegarde de sécurité :', restoreErr.message);
    });
    throw err;
  }

  return { restoredSnapshotId: snapshotId, safetyBackupId: safetyBackup.snapshotId };
}

async function restoreBackupWithoutSafety(snapshotId) {
  const meta = await getBackup(snapshotId);
  if (!meta) throw new Error('Sauvegarde de sécurité introuvable.');
  const backupCol = await getSiteBackupsCollection();
  const database = await connect();

  for (const collectionName of BACKUP_COLLECTIONS) {
    const target = database.collection(collectionName);
    const dataDocs = await backupCol.find({ kind: 'data', snapshotId, collection: collectionName })
      .sort({ index: 1 })
      .toArray();
    await target.deleteMany({});
    for (let i = 0; i < dataDocs.length; i += BACKUP_BATCH_SIZE) {
      const documents = dataDocs.slice(i, i + BACKUP_BATCH_SIZE).map((entry) => entry.document);
      if (documents.length) await target.insertMany(documents, { ordered: true });
    }
  }
}

async function pruneBackups(protectedSnapshotIds = []) {
  const col = await getSiteBackupsCollection();
  const metas = await col.find({ kind: 'meta', _id: { $nin: protectedSnapshotIds } }).sort({ createdAt: -1 }).skip(MAX_BACKUPS).project({ _id: 1 }).toArray();
  if (!metas.length) return;
  const ids = metas.map((entry) => entry._id);
  await col.deleteMany({ snapshotId: { $in: ids } });
  await col.deleteMany({ _id: { $in: ids } });
}

module.exports = {
  recordConnexion,
  listConnexions,
  logAction,
  listLogs,
  createBackup,
  listBackups,
  getBackup,
  restoreBackup,
};