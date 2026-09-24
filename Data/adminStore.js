// Suivi des connexions au site + journal des actions, pour le panel "Admin"
// réservé au créateur (Data/config.js -> SUPER_ADMIN_ID). Rien ici n'est lu
// ni utilisé par le bot Discord : c'est uniquement pour le site web.
const { getSiteConnexionsCollection, getSiteLogsCollection } = require('./mongo.js');

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
async function logAction({ discordId, username, avatar, action, details }) {
  const col = await getSiteLogsCollection();
  await col.insertOne({
    discordId: discordId || null,
    username: username || 'Inconnu',
    avatar: avatar || null,
    action,
    details: details || '',
    timestamp: new Date(),
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

module.exports = { recordConnexion, listConnexions, logAction, listLogs };