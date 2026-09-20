const { MongoClient } = require('mongodb');

const DB_NAME = 'westerosorigin';
const COLLECTION_AVATARS = 'avatars';
const COLLECTION_AVATARS_CONFIG = 'avatars_config';
const COLLECTION_TICKETS = 'logsticket';
const COLLECTION_FACECLAIM_INDEX = 'faceclaim_index';
const COLLECTION_TUPPERS = 'tuppers';
const COLLECTION_TUPPER_MESSAGES = 'tupper_messages';
const COLLECTION_GENERAL_TICKETS = 'general_tickets';
const COLLECTION_MAISONS_STATE = 'maisons_state';
const COLLECTION_SERVER_STATE = 'server_state';
const COLLECTION_RUMEURS = 'rumeurs';
const COLLECTION_XP = 'xp';
const COLLECTION_PROFILS = 'profils';

let client = null;
let db = null;
let connectingPromise = null;

/**
 * Ouvre (une seule fois) la connexion MongoDB et la garde en mémoire.
 * Mémoïse la promesse de connexion elle-même (pas juste `db`) pour éviter que
 * plusieurs appels concurrents au démarrage (ready) n'ouvrent chacun leur propre
 * connexion avant que la première ait fini de s'établir.
 */
async function connect() {
  if (db) return db;
  if (connectingPromise) return connectingPromise;

  connectingPromise = (async () => {
    const uri = process.env.MONGO_URI;
    if (!uri) {
      throw new Error("❌ MONGO_URI manquant dans le fichier .env");
    }

    client = new MongoClient(uri);
    await client.connect();
    db = client.db(DB_NAME);
    console.log('✅ Connecté à MongoDB (base "westerosorigin")');
    return db;
  })();

  try {
    return await connectingPromise;
  } finally {
    connectingPromise = null;
  }
}

async function getAvatarsCollection() {
  const database = await connect();
  return database.collection(COLLECTION_AVATARS);
}

async function getAvatarsConfigCollection() {
  const database = await connect();
  return database.collection(COLLECTION_AVATARS_CONFIG);
}

/**
 * Collection "logsticket" : stocke l'état de chaque ticket (réservation en cours,
 * fiche déposée, votes...). Remplace l'ancien stockage local (tickets.json) qui ne
 * survivait pas à un redéploiement sur Katabump.
 */
async function getLogTicketsCollection() {
  const database = await connect();
  return database.collection(COLLECTION_TICKETS);
}

/**
 * Collection "faceclaim_index" : garde, pour chaque thread de lettre du forum
 * faceclaims, la liste des entrées et l'ID du message d'index à éditer.
 */
async function getFaceclaimIndexCollection() {
  const database = await connect();
  return database.collection(COLLECTION_FACECLAIM_INDEX);
}

/**
 * Collection "tuppers" : les personas (tuppers) enregistrés par chaque utilisateur.
 */
async function getTuppersCollection() {
  const database = await connect();
  return database.collection(COLLECTION_TUPPERS);
}

/**
 * Collection "tupper_messages" : pour chaque message envoyé via un tupper, garde
 * l'auteur réel, le tupper utilisé et le contenu — pour permettre l'édition/suppression
 * via réaction (✏️ / ❌) et la modération.
 */
async function getTupperMessagesCollection() {
  const database = await connect();
  return database.collection(COLLECTION_TUPPER_MESSAGES);
}

/**
 * Collection "general_tickets" : tickets ouverts via le panel (animation / rumeur / support),
 * distincts des tickets de réservation de fiche (collection "logsticket").
 */
async function getGeneralTicketsCollection() {
  const database = await connect();
  return database.collection(COLLECTION_GENERAL_TICKETS);
}

/**
 * Collection "server_state" : petit stockage clé/valeur générique pour l'état du
 * serveur (ex: la date IC courante), qui doit survivre à un redéploiement.
 */
async function getServerStateCollection() {
  const database = await connect();
  return database.collection(COLLECTION_SERVER_STATE);
}

/**
 * Collection "rumeurs" : rumeurs proposées via le formulaire, en attente de
 * validation par 2 membres du staff avant publication.
 */
async function getRumeursCollection() {
  const database = await connect();
  return database.collection(COLLECTION_RUMEURS);
}
async function getXpCollection() {
  const database = await connect();
  return database.collection(COLLECTION_XP);
}

/**
 * Collection "profils" : fiche de profil détaillée de chaque personnage validé
 * (statut, garde personnelle, bourse, alliés, rivaux, renommée, notes...).
 */
async function getProfilsCollection() {
  const database = await connect();
  return database.collection(COLLECTION_PROFILS);
}

/**
 * Collection "maisons_state" : la partie MODIFIABLE d'une maison (chef, surcharges
 * de renommée/argent, historique des grandes actions). Le reste (région, croyance,
 * armée, unité spéciale) reste statique dans Data/maisons.js.
 */
async function getMaisonsStateCollection() {
  const database = await connect();
  return database.collection(COLLECTION_MAISONS_STATE);
}

/**
 * Collection "regions_state" : la partie MODIFIABLE d'une région (statut politique,
 * instabilité, historique). Le reste (capitale, richesse, climat...) reste statique
 * dans Data/regions.js.
 */
async function getRegionsStateCollection() {
  const database = await connect();
  return database.collection('regions_state');
}

module.exports = {
  connect,
  getAvatarsCollection,
  getAvatarsConfigCollection,
  getLogTicketsCollection,
  getFaceclaimIndexCollection,
  getTuppersCollection,
  getTupperMessagesCollection,
  getGeneralTicketsCollection,
  getServerStateCollection,
  getRumeursCollection,
  getXpCollection,
  getProfilsCollection,
  getMaisonsStateCollection,
  getRegionsStateCollection,
};