const path = require('path');
const crypto = require('crypto');
const { createCanvas, loadImage } = require('canvas');
const { EQUIPMENT_SLOTS } = require('./invStore.js');

const WIDTH = 960;
const HEIGHT = 540;
const TEMPLATE_PATH = path.join(__dirname, '..', 'image', 'inventaire.png');
const FALLBACK_ICON_PATH = path.join(__dirname, '..', 'image', 'aucun.png');

// Rectangles des 6 emplacements d'équipement sur image/inventaire.png (mesurés
// pixel par pixel sur l'image fournie). Ajuste ici si tu changes le fond.
const EQUIPMENT_RECTS = {
  casque:     { x: 166, y: 63,  w: 66, h: 70 },
  plastron:   { x: 164, y: 164, w: 68, h: 71 },
  mainGauche: { x: 61,  y: 243, w: 68, h: 72 },
  mainDroite: { x: 267, y: 243, w: 69, h: 70 },
  jambes:     { x: 164, y: 324, w: 68, h: 71 },
  pieds:      { x: 164, y: 415, w: 68, h: 70 },
};

// Grille d'inventaire : 5 colonnes x 4 lignes = 20 cases par page. Ces
// tableaux sont les limites exactes (en pixels) entre les cases du fond.
const GRID_COLS_X = [374, 480, 581, 687, 793, 896];
const GRID_ROWS_Y = [42, 154, 266, 378, 487];
const COLS = GRID_COLS_X.length - 1;
const ROWS = GRID_ROWS_Y.length - 1;
const SLOTS_PER_PAGE = COLS * ROWS;

const ICON_PADDING = 8;

// Petit cache des icônes déjà chargées, pour ne pas relire/redécoder l'image à
// chaque génération. La clé est un hash pour les images envoyées depuis le
// site (data URL très longues) : si l'image d'un objet change, la clé change
// aussi, donc la nouvelle image est prise en compte tout de suite.
const iconCache = new Map();
const ICON_CACHE_MAX = 300;

function cacheKey(source) {
  return source.length > 200 ? crypto.createHash('sha1').update(source).digest('hex') : source;
}

/**
 * Charge l'image d'un objet. `item.image` peut être :
 *  - une data URL (image envoyée depuis le site, stockée dans Mongo)
 *  - une URL http(s)
 *  - un chemin relatif à la racine du bot, ex. "/image/items/xxx.png"
 * En cas d'échec (ou d'absence d'image) : image/aucun.png.
 */
async function loadIcon(item) {
  const raw = item?.image;
  const candidates = [];
  if (raw) {
    if (/^data:image\//.test(raw) || /^https?:\/\//.test(raw)) {
      candidates.push(raw);
    } else {
      // Chemin du catalogue relatif à la racine du bot, pas un chemin absolu du disque.
      candidates.push(path.join(__dirname, '..', raw.replace(/^[/\\]+/, '')));
    }
  }
  candidates.push(FALLBACK_ICON_PATH);

  for (const candidate of candidates) {
    const key = cacheKey(candidate);
    if (iconCache.has(key)) return iconCache.get(key);
    try {
      const source = candidate.startsWith('data:')
        ? Buffer.from(candidate.slice(candidate.indexOf(',') + 1), 'base64')
        : candidate;
      const img = await loadImage(source);
      if (iconCache.size >= ICON_CACHE_MAX) iconCache.clear();
      iconCache.set(key, img);
      return img;
    } catch {
      // essaie le candidat suivant (au final : image/aucun.png)
    }
  }
  return null;
}

function drawContained(ctx, img, rect) {
  const maxW = rect.w - ICON_PADDING * 2;
  const maxH = rect.h - ICON_PADDING * 2;
  const scale = Math.min(maxW / img.width, maxH / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  const x = rect.x + (rect.w - w) / 2;
  const y = rect.y + (rect.h - h) / 2;
  ctx.drawImage(img, x, y, w, h);
}

function drawQuantityBadge(ctx, rect, quantity) {
  const text = `x${quantity}`;
  ctx.font = 'bold 14px sans-serif';
  const textWidth = ctx.measureText(text).width;
  const padX = 6;
  const badgeW = textWidth + padX * 2;
  const badgeH = 20;
  const x = rect.x + rect.w - badgeW - 4;
  const y = rect.y + rect.h - badgeH - 4;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.fillRect(x, y, badgeW, badgeH);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.fillText(text, x + padX, y + 15);
}

function gridCellRect(index) {
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  return {
    x: GRID_COLS_X[col],
    y: GRID_ROWS_Y[row],
    w: GRID_COLS_X[col + 1] - GRID_COLS_X[col],
    h: GRID_ROWS_Y[row + 1] - GRID_ROWS_Y[row],
  };
}

/**
 * Liste ordonnée des objets de l'inventaire à afficher dans la grille
 * (les objets équipés n'y sont PAS : ils sont sur la silhouette de gauche).
 * Triés par catégorie puis nom, comme le catalogue.
 */
function listGridEntries(inventory, catalog) {
  return Object.entries(inventory.items || {})
    .filter(([, qty]) => qty > 0)
    .map(([itemId, qty]) => {
      const item = catalog.find(it => it.id === itemId) || { id: itemId, name: itemId, emoji: '❔', category: 'Autre', image: null };
      return { item, qty };
    })
    .sort((a, b) => (a.item.category || '').localeCompare(b.item.category || '') || a.item.name.localeCompare(b.item.name));
}

function pageCount(inventory, catalog) {
  return Math.max(1, Math.ceil(listGridEntries(inventory, catalog).length / SLOTS_PER_PAGE));
}

/**
 * Génère l'image d'inventaire d'un personnage (Buffer PNG).
 * `page` commence à 0 ; 20 objets par page.
 */
async function generateInventoryCard({ nomPrenom, inventory, catalog, page = 0 }) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  try {
    const template = await loadImage(TEMPLATE_PATH);
    ctx.drawImage(template, 0, 0, WIDTH, HEIGHT);
  } catch (err) {
    console.error(`Impossible de charger le fond de l'inventaire (${TEMPLATE_PATH}) :`, err.message);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  // Nom du personnage, à la suite de "Inventaire de" déjà présent sur le fond.
  ctx.fillStyle = '#ffffff';
  ctx.font = '15px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(String(nomPrenom || '').slice(0, 40), 458, 31);

  // --- Équipements (silhouette de gauche) ---
  for (const slot of EQUIPMENT_SLOTS) {
    const itemId = inventory.equipement?.[slot];
    if (!itemId) continue;
    const item = catalog.find(it => it.id === itemId) || { id: itemId, image: null };
    const icon = await loadIcon(item);
    if (icon) drawContained(ctx, icon, EQUIPMENT_RECTS[slot]);
  }

  // --- Grille d'inventaire (droite) ---
  const entries = listGridEntries(inventory, catalog);
  const totalPages = Math.max(1, Math.ceil(entries.length / SLOTS_PER_PAGE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const pageEntries = entries.slice(safePage * SLOTS_PER_PAGE, (safePage + 1) * SLOTS_PER_PAGE);

  for (let i = 0; i < pageEntries.length; i++) {
    const { item, qty } = pageEntries[i];
    const rect = gridCellRect(i);
    const icon = await loadIcon(item);
    if (icon) drawContained(ctx, icon, rect);
    if (qty > 1) drawQuantityBadge(ctx, rect, qty);
  }

  // Indicateur de page si l'inventaire dépasse une page.
  if (totalPages > 1) {
    ctx.fillStyle = '#ffffff';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`Page ${safePage + 1}/${totalPages}`, 888, 31);
  }

  return { buffer: canvas.toBuffer('image/png'), page: safePage, totalPages };
}

module.exports = {
  generateInventoryCard,
  listGridEntries,
  pageCount,
  SLOTS_PER_PAGE,
};