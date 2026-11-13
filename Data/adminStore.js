// Suivi des connexions au site + journal des actions, pour le panel "Admin"
// réservé au créateur (Data/config.js -> SUPER_ADMIN_ID). Rien ici n'est lu
// ni utilisé par le bot Discord : c'est uniquement pour le site web.
const { getSiteConnexionsCollection, getSiteLogsCollection, getSiteBackupsCollection, connect } = require('./mongo.js');
const fs = require('fs/promises');
const path = require('path');

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

const BACKUP_EXCLUDED_COLLECTIONS = new Set(['site_backups', 'site_sessions', 'sessions']);
const MAX_BACKUPS = 20;
const BACKUP_BATCH_SIZE = 100;

async function listBackupCollections(database) {
  const entries = await database.listCollections({}, { nameOnly: true }).toArray();
  return entries.map(entry => entry.name)
    .filter(name => name && !name.startsWith('system.') && !BACKUP_EXCLUDED_COLLECTIONS.has(name))
    .sort((a, b) => a.localeCompare(b, 'en'));
}

/** Snapshot complet des collections applicatives du bot et du site.
 * Les sessions d'authentification et la collection qui contient les snapshots
 * sont exclues volontairement : restaurer une ancienne session pourrait
 * réactiver un accès révoqué, et sauvegarder les sauvegardes créerait une boucle.
 */
async function createBackup({ discordId, username, avatar, preserveSnapshotIds = [] } = {}) {
  const col = await getSiteBackupsCollection();
  const snapshotId = `backup_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const createdAt = new Date();
  const database = await connect();
  const counts = {};
  try {
    const collectionNames = await listBackupCollections(database);
    for (const collectionName of collectionNames) {
      const cursor = database.collection(collectionName).find({}).batchSize(BACKUP_BATCH_SIZE);
      let chunk = [];
      let index = 0;
      while (await cursor.hasNext()) {
        const document = await cursor.next();
        chunk.push({ _id: `${snapshotId}:data:${collectionName}:${index}`, kind: 'data', snapshotId, collection: collectionName, index, document });
        index++;
        if (chunk.length >= BACKUP_BATCH_SIZE) {
          await col.insertMany(chunk, { ordered: true });
          chunk = [];
        }
      }
      if (chunk.length) await col.insertMany(chunk, { ordered: true });
      counts[collectionName] = index;
    }

    // Les illustrations de classes sont des fichiers locaux, pas des documents
    // Mongo : elles sont donc intégrées au snapshot pour qu'une restauration
    // complète remette aussi les images de web/ship.
    const shipDirectory = path.join(__dirname, '..', 'web', 'ship');
    const files = [];
    try {
      for (const filename of await fs.readdir(shipDirectory)) {
        if (!/^[a-z0-9-]+\.(?:png|jpe?g|webp|gif)$/i.test(filename)) continue;
        const data = await fs.readFile(path.join(shipDirectory, filename));
        await col.insertOne({ _id: `${snapshotId}:file:${filename}`, kind: 'file', snapshotId, filename, data });
        files.push(filename);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    await col.insertOne({
      _id: snapshotId, kind: 'meta', snapshotId, createdAt,
      createdBy: { discordId: discordId || null, username: username || 'Inconnu', avatar: avatar || null },
      fullSnapshot: true, databaseName: database.databaseName, collections: counts, files,
    });
    await pruneBackups(preserveSnapshotIds);
    return { snapshotId, createdAt, createdBy: username || 'Inconnu', fullSnapshot: true, collections: counts };
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
  const safetyBackup = await createBackup({ ...actor, preserveSnapshotIds: [snapshotId] });
  try {
    await restoreBackupWithoutSafety(snapshotId);
  } catch (err) {
    await restoreBackupWithoutSafety(safetyBackup.snapshotId).catch((restoreErr) => {
      console.error('❌ Impossible de restaurer la sauvegarde de sécurité :', restoreErr.message);
    });
    throw err;
  }
  return { restoredSnapshotId: snapshotId, safetyBackupId: safetyBackup.snapshotId };
}

async function restoreBackupWithoutSafety(snapshotId) {
  const meta = await getBackup(snapshotId);
  if (!meta) throw new Error('Sauvegarde introuvable.');
  const backupCol = await getSiteBackupsCollection();
  const database = await connect();
  const snapshotCollections = Object.keys(meta.collections || {}).filter(name =>
    name && !name.startsWith('system.') && !BACKUP_EXCLUDED_COLLECTIONS.has(name)
  );
  if (meta.fullSnapshot === true) {
    const currentCollections = await listBackupCollections(database);
    const keep = new Set(snapshotCollections);
    for (const collectionName of currentCollections) {
      if (!keep.has(collectionName)) {
        await database.collection(collectionName).drop().catch(err => {
          if (err.codeName !== 'NamespaceNotFound' && err.code !== 26) throw err;
        });
      }
    }
  }
  for (const collectionName of snapshotCollections) {
    const target = database.collection(collectionName);
    await target.deleteMany({});
    const cursor = backupCol.find({ kind: 'data', snapshotId, collection: collectionName }).sort({ index: 1 }).batchSize(BACKUP_BATCH_SIZE);
    let documents = [];
    while (await cursor.hasNext()) {
      const entry = await cursor.next();
      documents.push(entry.document);
      if (documents.length >= BACKUP_BATCH_SIZE) {
        await target.insertMany(documents, { ordered: true });
        documents = [];
      }
    }
    if (documents.length) await target.insertMany(documents, { ordered: true });
  }

  // Restaure les images de classes associées au snapshot. Les fichiers README
  // et tout autre contenu non image du dossier sont préservés.
  if (meta.fullSnapshot === true) {
    const shipDirectory = path.join(__dirname, '..', 'web', 'ship');
    await fs.mkdir(shipDirectory, { recursive: true });
    const retained = new Set((meta.files || []).filter(name => /^[a-z0-9-]+\.(?:png|jpe?g|webp|gif)$/i.test(name)));
    for (const filename of await fs.readdir(shipDirectory)) {
      if (/^[a-z0-9-]+\.(?:png|jpe?g|webp|gif)$/i.test(filename) && !retained.has(filename)) {
        await fs.unlink(path.join(shipDirectory, filename)).catch(() => {});
      }
    }
    for (const filename of retained) {
      const saved = await backupCol.findOne({ kind: 'file', snapshotId, filename });
      if (saved?.data) await fs.writeFile(path.join(shipDirectory, filename), saved.data);
    }
  }
}

async function deleteBackup(snapshotId) {
  const id = String(snapshotId || '');
  if (!/^backup_[A-Za-z0-9_-]+$/.test(id)) throw new Error('Identifiant de sauvegarde invalide.');
  const col = await getSiteBackupsCollection();
  const meta = await col.findOne({ _id: id, kind: 'meta' });
  if (!meta) throw new Error('Sauvegarde introuvable.');
  await col.deleteMany({ snapshotId: id });
  await col.deleteOne({ _id: id, kind: 'meta' });
  return { deletedSnapshotId: id };
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
  deleteBackup,
};