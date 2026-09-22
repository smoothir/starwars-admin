const { getAvatarsCollection, getAvatarsConfigCollection } = require('./mongo.js');

function normalizeFaceclaim(name) {
  return (name || '').trim().toLowerCase();
}

/**
 * Cherche un avatar déjà enregistré pour ce faceclaim.
 */
async function findAvatar(faceclaim) {
  const col = await getAvatarsCollection();
  return col.findOne({ faceclaimKey: normalizeFaceclaim(faceclaim) });
}

/**
 * Télécharge l'image (lien Discord CDN, temporaire) et la stocke en base
 * pour qu'elle ne disparaisse jamais du cache. Le faceclaim est "réservé" :
 * si quelqu'un d'autre essaie de le reprendre, la réservation est refusée.
 *
 * @returns {{ ok: true, doc } | { ok: false, reason: 'already_taken', existing }}
 */
/**
 * Enregistre en base l'image d'un faceclaim réservé via /reservation (étape 2),
 * sans bloquer si le faceclaim est déjà pris par CE MÊME joueur (mise à jour).
 * Contrairement à reserveAvatar(), ne télécharge pas l'image à nouveau si elle
 * vient déjà d'être mise en cache par le salon de logs (imageUrl est déjà une
 * URL Discord CDN stable créée par le bot lui-même).
 */
async function reserveAvatar({ faceclaim, nomPrenom, userId, imageUrl, reservationUrl }) {
  const col = await getAvatarsCollection();
  const key = normalizeFaceclaim(faceclaim);

  const existing = await col.findOne({ faceclaimKey: key });
  if (existing && existing.userId !== userId) {
    return { ok: false, reason: 'already_taken', existing };
  }

  const res = await fetch(imageUrl);
  if (!res.ok) {
    throw new Error(`Téléchargement de l'image impossible (HTTP ${res.status})`);
  }
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const contentType = res.headers.get('content-type') || 'image/png';

  const doc = {
    faceclaimKey: key,
    faceclaim,
    nomPrenom,
    userId,
    reservationUrl: reservationUrl || existing?.reservationUrl || null,
    imageBase64: buffer.toString('base64'),
    contentType,
    reservedAt: existing?.reservedAt || new Date(),
    updatedAt: new Date(),
  };

  await col.updateOne({ faceclaimKey: key }, { $set: doc }, { upsert: true });

  // Statistiques globales dans avatars_config (nombre total de faceclaims réservés)
  const configCol = await getAvatarsConfigCollection();
  await configCol.updateOne(
    { _id: 'stats' },
    { $set: { updatedAt: new Date() }, $inc: { totalReserved: existing ? 0 : 1 } },
    { upsert: true },
  );

  return { ok: true, doc };
}

/**
 * Libère un faceclaim (supprime sa réservation en base). Utilisé par /faceclaim sup
 * quand une fiche est refusée/fermée et que le staff veut permettre à quelqu'un
 * d'autre de reprendre ce faceclaim.
 * @returns {boolean} true si une réservation a bien été supprimée
 */
async function releaseAvatar(faceclaim) {
  const col = await getAvatarsCollection();
  const key = normalizeFaceclaim(faceclaim);
  const result = await col.deleteOne({ faceclaimKey: key });
  return result.deletedCount > 0;
}

/**
 * Reconstruit le Buffer image à partir d'un document Mongo (pour le rattacher
 * à un message Discord comme une vraie image, pas comme un lien).
 */
function bufferFromAvatar(avatarDoc) {
  return Buffer.from(avatarDoc.imageBase64, 'base64');
}

function extensionFromContentType(contentType) {
  if (!contentType) return 'png';
  if (contentType.includes('jpeg')) return 'jpg';
  if (contentType.includes('gif')) return 'gif';
  if (contentType.includes('webp')) return 'webp';
  return 'png';
}

/**
 * Enregistre/actualise un faceclaim SANS image (utilisé par /faceclaim add, où le
 * staff saisit les infos à la main sans forcément avoir de visuel à mettre en cache).
 * Ne touche pas à une image déjà en cache si l'entrée existait déjà.
 */
async function upsertAvatarMeta({ faceclaim, nomPrenom, userId, reservationUrl }) {
  const col = await getAvatarsCollection();
  const key = normalizeFaceclaim(faceclaim);
  const existing = await col.findOne({ faceclaimKey: key });

  const doc = {
    faceclaimKey: key,
    faceclaim,
    nomPrenom,
    userId,
    reservationUrl: reservationUrl || existing?.reservationUrl || null,
    reservedAt: existing?.reservedAt || new Date(),
    updatedAt: new Date(),
  };

  await col.updateOne({ faceclaimKey: key }, { $set: doc }, { upsert: true });
  return doc;
}

/**
 * Met à jour uniquement le lien de réservation d'un avatar déjà enregistré
 * (sans retélécharger l'image), une fois que le salon de réservation existe.
 */
async function setReservationUrl(faceclaim, reservationUrl) {
  const col = await getAvatarsCollection();
  const key = normalizeFaceclaim(faceclaim);
  await col.updateOne({ faceclaimKey: key }, { $set: { reservationUrl, updatedAt: new Date() } });
}

/**
 * Tous les faceclaims actuellement réservés (utilisé par /syncavatars pour
 * reconstruire entièrement l'index des salons de lettres à partir de la vraie
 * base c'est la vraie source de vérité, pas les fiches validées).
 */
async function listAllAvatars() {
  const col = await getAvatarsCollection();
  return col.find({}).toArray();
}

/**
 * Enregistre une image envoyée directement (upload depuis le site admin,
 * buffer déjà en mémoire) contrairement à reserveAvatar(), ne télécharge
 * rien depuis une URL. Écrase l'image existante pour ce faceclaim s'il y en
 * avait déjà une (changement de portrait), sans vérifier de propriétaire :
 * c'est un outil staff, l'accès au site est déjà protégé par mot de passe.
 */
async function upsertAvatarImage({ faceclaim, nomPrenom, userId, buffer, contentType }) {
  const col = await getAvatarsCollection();
  const key = normalizeFaceclaim(faceclaim);
  const existing = await col.findOne({ faceclaimKey: key });

  const doc = {
    faceclaimKey: key,
    faceclaim,
    nomPrenom: nomPrenom || existing?.nomPrenom,
    userId: userId || existing?.userId,
    reservationUrl: existing?.reservationUrl || null,
    imageBase64: buffer.toString('base64'),
    contentType: contentType || 'image/png',
    reservedAt: existing?.reservedAt || new Date(),
    updatedAt: new Date(),
  };

  await col.updateOne({ faceclaimKey: key }, { $set: doc }, { upsert: true });

  if (!existing) {
    const configCol = await getAvatarsConfigCollection();
    await configCol.updateOne(
      { _id: 'stats' },
      { $set: { updatedAt: new Date() }, $inc: { totalReserved: 1 } },
      { upsert: true },
    );
  }

  return doc;
}

module.exports = { findAvatar, reserveAvatar, releaseAvatar, upsertAvatarMeta, upsertAvatarImage, setReservationUrl, listAllAvatars, bufferFromAvatar, extensionFromContentType, normalizeFaceclaim };