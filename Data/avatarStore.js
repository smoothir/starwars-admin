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
async function reserveAvatar({ faceclaim, nomPrenom, userId, imageUrl }) {
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

module.exports = { findAvatar, reserveAvatar, releaseAvatar, bufferFromAvatar, extensionFromContentType, normalizeFaceclaim };