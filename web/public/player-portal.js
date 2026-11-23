(() => {
  'use strict';

  const state = {
    me: null,
    page: 'dashboard',
    characters: [],
    missions: [],
    primes: [],
    shop: [],
    selectedCharacter: null,
    selectedInventoryCharacterId: null,
    inventoryData: null,
    inventoryPage: 0,
    inventorySelection: null,
    heartbeat: null,
    toastTimer: null,
  };

  const LOCATIONS = {
    planets: [
      { name: 'Chandrila', id: '1552205052213461133', icon: '🌿', subtitle: 'Monde politique et paisible', places: [
        { name: 'Hanna City', id: '1552205287476297859', subtitle: 'Capitale de Chandrila' },
        { name: 'Sénat galactique', id: '1552205408771383357', subtitle: 'Centre des décisions' },
      ] },
      { name: 'Coruscant', id: '1552207074522300426', icon: '🏙️', subtitle: 'Cœur de la galaxie', places: [
        { name: 'District fédéral', id: '1552207256915808276', subtitle: 'Quartier institutionnel' },
        { name: 'Niveau 313', id: '1552207351774318632', subtitle: 'Les profondeurs urbaines' },
        { name: 'Temple Jedi abandonné', id: '1552207405461536809', subtitle: 'Ancien lieu de l’Ordre' },
      ] },
    ],
    hutt: [
      { name: 'Nar Shaddaa', id: '1552207990596042762', subtitle: 'La lune des contrebandiers' },
      { name: 'Palais Hutt', id: '1552208188370059334', subtitle: 'Pouvoir du Cartel' },
      { name: 'Oba Diah', id: '1552208328648556634', subtitle: 'Territoire des Pykes' },
      { name: 'Forteresse Pyke', id: '1552208449453035580', subtitle: 'Bastion du syndicat' },
      { name: 'Kessel', id: '1552208545792004137', subtitle: 'Monde minier' },
      { name: 'Mine d’épice', id: '1552208582336978954', subtitle: 'Exploitation de l’épice' },
    ],
    outer: [
      { name: 'Nevarro', id: '1552208750042030123', subtitle: 'Monde de la Bordure extérieure' },
      { name: 'Nevarro City', id: '1552208853612101643', subtitle: 'Centre urbain' },
      { name: 'Complexe impérial', id: '1552208961804050557', subtitle: 'Installation impériale' },
      { name: 'Tatooine', id: '1552209002006581288', subtitle: 'Monde désertique' },
      { name: 'Mos Eisley', id: '1552209086127276114', subtitle: 'Port spatial' },
      { name: 'Mos Pelgo', id: '1552209120684417094', subtitle: 'Village de la planète' },
      { name: 'Mer de dunes', id: '1552209164837851297', subtitle: 'Étendue désertique' },
      { name: 'Ossus', id: '1552209228058468365', subtitle: 'Monde lié aux Jedi' },
      { name: 'Ruines de la bibliothèque', id: '1552209267874861086', subtitle: 'Vestiges du savoir Jedi' },
      { name: 'Temple Jedi en construction', id: '1552209366197739520', subtitle: 'Nouveau sanctuaire' },
    ],
  };

  const LABELS = {
    dashboard: ['QUARTIER GÉNÉRAL', 'Tableau de bord'], characters: ['DOSSIERS PERSONNELS', 'Mes personnages'],
    inventory: ['ÉQUIPEMENT PERSONNEL', 'Mon inventaire'],
    planets: ['CARTE GALACTIQUE', 'Planètes'], hutt: ['SECTEUR HUTT & MÉDIANE', 'Espace Hutt & Médiane'],
    outer: ['BORDURES EXTÉRIEURES', 'Bordures extérieures'], core: ['RÉGION CENTRALE', 'Espace du Noyau'],
    forum: ['COMMUNAUTÉ', 'Forum'], missions: ['CONTRATS GALACTIQUES', 'Missions'],
    primes: ['AVIS DE RECHERCHE', 'Primes'], shop: ['ÉCONOMIE', 'Boutique'],
  };

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  function fmt(value) { return Number(value || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 }); }
  function discordUrl(channelId) {
    if (!channelId || !state.me?.guildId) return `https://discord.com/channels/${state.me?.guildId || '@me'}`;
    return `https://discord.com/channels/${encodeURIComponent(state.me.guildId)}/${encodeURIComponent(channelId)}`;
  }
  async function api(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) { window.location.reload(); throw new Error('Session expirée.'); }
    if (!response.ok) throw new Error(data.error || `Erreur HTTP ${response.status}`);
    return data;
  }
  function content() { return document.getElementById('player-content'); }
  function toast(message, error = false) {
    const el = document.getElementById('player-toast');
    if (!el) return;
    el.textContent = message;
    el.style.borderColor = error ? 'rgba(255,130,140,.4)' : 'rgba(111,224,177,.3)';
    el.style.background = error ? '#321c27' : '#0e2b29';
    el.classList.add('visible');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => el.classList.remove('visible'), 3200);
  }
  function loading(message = 'Synchronisation du terminal…') {
    content().innerHTML = `<div class="player-loading"><span class="player-spinner"></span>${esc(message)}</div>`;
  }
  function navMarkup() {
    const groups = [
      { label: 'PERSONNEL', rows: [['dashboard','⌂','Tableau de bord'], ['characters','◈','Mes personnages'], ['inventory','🎒','Mon inventaire']] },
      { label: 'EXPLORATION', rows: [['planets','◎','Planètes'], ['hutt','◉','Espace Hutt & Médiane'], ['outer','✧','Bordures extérieures'], ['core','✦','Espace du Noyau'], ['forum','▤','Forum']] },
      { label: 'ACTIVITÉS', rows: [['missions','⚑','Missions'], ['primes','◎','Primes'], ['shop','◇','Boutique']] },
    ];
    return groups.map(group => `<div class="player-nav-group">${group.label}</div>${group.rows.map(([id, icon, label]) => `<button type="button" class="player-nav-btn" data-page="${id}"><span class="nav-ico">${icon}</span><span>${label}</span></button>`).join('')}`).join('');
  }
  function setPageActive() {
    document.querySelectorAll('#player-nav [data-page]').forEach(btn => btn.classList.toggle('active', btn.dataset.page === state.page));
    const [crumb, title] = LABELS[state.page] || LABELS.dashboard;
    document.getElementById('player-breadcrumb').textContent = crumb;
    document.getElementById('player-current-date').textContent = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full' }).format(new Date()).toUpperCase();
  }
  function openDiscord(id) { window.open(discordUrl(id), '_blank', 'noopener,noreferrer'); }
  function locationButton(place, icon = '↗') {
    return `<button type="button" class="portal-location" data-action="open-discord" data-channel="${esc(place.id)}"><span><strong>${esc(place.name)}</strong><small>${esc(place.subtitle || 'Ouvrir le lieu sur Discord')}</small></span><em>${icon}</em></button>`;
  }
  function empty(icon, title, desc) {
    return `<div class="portal-empty"><div class="portal-empty-icon">${icon}</div><strong>${esc(title)}</strong><p>${esc(desc)}</p></div>`;
  }
  function rewardText(reward) {
    if (reward.type === 'credits') return `💰 ${fmt(reward.amount)} crédits`;
    if (reward.type === 'item') return `📦 ${Number(reward.quantity || 1)} × ${esc(reward.itemName || reward.itemId)}`;
    if (reward.type === 'reputation') return `⭐ +${fmt(reward.amount)} réputation`;
    if (reward.type === 'stat') return `📊 +${fmt(reward.amount)} ${esc(reward.stat)}`;
    return 'Récompense';
  }

  async function navigate(page, options = {}) {
    if (!LABELS[page]) page = 'dashboard';
    state.page = page;
    setPageActive();
    if (!options.keepScroll) window.scrollTo({ top: 0, behavior: 'smooth' });
    const render = {
      dashboard: renderDashboard, characters: renderCharacters, inventory: renderInventory,
      planets: () => renderLocationPage('planets'), hutt: () => renderLocationPage('hutt'),
      outer: () => renderLocationPage('outer'), core: renderCorePage, forum: renderForumPage,
      missions: renderMissions, primes: renderPrimes, shop: renderShop,
    }[page];
    await render();
  }
  window.naviguerPortail = navigate;

  async function renderDashboard() {
    loading('Chargement du tableau de bord…');
    try {
      const [dash, characters] = await Promise.all([api('/api/player/dashboard'), api('/api/player/characters')]);
      state.characters = characters;
      const online = Number(dash.onlineCount) || 0;
      content().innerHTML = `
        <section class="portal-hero"><div class="portal-hero-content">
          <div class="portal-eyebrow">TRANSMISSION PRIORITAIRE · ESPACE JOUEUR</div>
          <h1 class="portal-title">Bienvenue, ${esc(state.me.username || 'voyageur')}.</h1>
          <p class="portal-lead">Ton terminal est connecté au réseau galactique. Retrouve tes personnages, consulte les secteurs connus et prends part aux missions disponibles dans la galaxie.</p>
          <div class="portal-hero-actions"><button class="portal-button portal-button-gold" data-action="navigate" data-page="characters">◈ Mes personnages</button><button class="portal-button" data-action="navigate" data-page="missions">⚑ Voir les missions</button></div>
        </div></section>
        <section class="portal-stats-grid">
          <article class="portal-stat-card online"><span>Joueurs connectés au site</span><strong id="portal-online-count">${online}</strong><small>Actifs au cours des deux dernières minutes</small></article>
          <article class="portal-stat-card"><span>Mes personnages</span><strong>${characters.length}</strong><small>Dossiers associés à ton compte Discord</small></article>
          <article class="portal-stat-card"><span>Missions disponibles</span><strong>${Number(dash.missionsAvailable) || 0}</strong><small>Contrats ouverts à l’acceptation</small></article>
          <article class="portal-stat-card"><span>Primes actives</span><strong>${Number(dash.activeBounties) || 0}</strong><small>Avis de recherche recensés</small></article>
        </section>
        <div class="portal-section-head"><div><h3>Accès rapides</h3><p>Les principales sections de ton espace joueur.</p></div></div>
        <section class="portal-shortcuts">
          <button class="portal-shortcut" data-action="navigate" data-page="planets"><i>🌌</i><span><strong>Explorer les planètes</strong><small>Parcourir les destinations connues</small></span></button>
          <button class="portal-shortcut" data-action="navigate" data-page="missions"><i>🚀</i><span><strong>Contrats & missions</strong><small>Accepter une mission avec un personnage</small></span></button>
          <button class="portal-shortcut" data-action="navigate" data-page="primes"><i>🎯</i><span><strong>Tableau des primes</strong><small>Consulter les cibles recherchées</small></span></button>
        </section>
        ${state.me.isWhitelisted ? '' : '<div class="portal-banner">Ton compte est connecté avec le rôle membre. Le statut whitelist est géré directement sur Discord ; certaines activités RP peuvent dépendre de ce statut.</div>'}
      `;
    } catch (error) { content().innerHTML = empty('⚠️','Tableau de bord indisponible',error.message); }
  }

  async function renderCharacters() {
    loading('Lecture des dossiers personnels…');
    try {
      state.characters = await api('/api/player/characters');
      if (!state.characters.length) {
        content().innerHTML = `<div class="portal-eyebrow">DOSSIERS PERSONNELS</div><h1 class="portal-title">Mes personnages</h1><p class="portal-lead">Tous les personnages rattachés à ton compte Discord apparaîtront ici après la création de leur fiche.</p><div style="margin-top:22px">${empty('◈','Aucun personnage pour le moment','Tu n’as pas encore de personnage associé à ce compte. Consulte le serveur Discord pour suivre la procédure de création de fiche.')}</div><div class="portal-hero-actions"><button class="portal-button" data-action="open-discord">Ouvrir le serveur Discord ↗</button></div>`;
        return;
      }
      content().innerHTML = `<div class="portal-eyebrow">DOSSIERS PERSONNELS</div><h1 class="portal-title">Mes personnages</h1><p class="portal-lead">Retrouve les informations de tes personnages et ouvre leur dossier détaillé.</p><div class="portal-grid" style="margin-top:22px">${state.characters.map(character => `
        <article class="portal-card"><div class="portal-character-card">
          <img class="portal-character-avatar" src="${esc(character.imageUrl || '')}" alt="Portrait de ${esc(character.nomPrenom)}" onerror="this.style.visibility='hidden'">
          <div class="portal-character-info"><span class="portal-tag ${character.statut === 'Vivant' ? 'green' : ''}">${esc(character.statut)}</span><h3>${esc(character.nomPrenom)}</h3>
            <p>${esc(character.roleName || 'Rôle non renseigné')}</p><p>${esc(character.categoryName || 'Faction non renseignée')}</p>
            ${character.prime?.active && Number(character.prime.amount) > 0 ? `<div class="portal-character-bounty"><span>🎯 RECHERCHÉ</span><strong>${fmt(character.prime.amount)} crédits</strong>${character.prime.description ? `<small>${esc(character.prime.description)}</small>` : ''}</div>` : ''}
            <div class="portal-card-actions"><button class="portal-button" data-action="open-character" data-id="${esc(character.id)}">Ouvrir le dossier →</button></div>
          </div></div></article>`).join('')}</div>`;
    } catch (error) { content().innerHTML = empty('⚠️','Impossible de lire les personnages',error.message); }
  }

  async function openCharacter(id) {
    loading('Ouverture du dossier…');
    try {
      const data = await api(`/api/player/characters/${encodeURIComponent(id)}`);
      const c = data.character;
      state.selectedCharacter = c;
      const stats = Object.entries(c.stats || {});
      const equipped = data.equipment || [];
      const items = data.items || [];
      content().innerHTML = `
        <button class="portal-button portal-button-quiet" data-action="navigate" data-page="characters">← Retour à mes personnages</button>
        <div class="portal-detail-hero" style="margin-top:15px"><img src="${esc(c.imageUrl || '')}" alt="Portrait" onerror="this.style.visibility='hidden'"><div><div class="portal-eyebrow">DOSSIER PERSONNEL · ${esc(c.statut)}</div><h2>${esc(c.nomPrenom)}</h2><p>${esc(c.roleName || 'Rôle non renseigné')} · ${esc(c.categoryName || 'Aucune faction')}</p><p>${c.age ? `${esc(c.age)} ans` : 'Âge non renseigné'}${c.faceclaim ? ` · ${esc(c.faceclaim)}` : ''}</p>${c.prime?.active && Number(c.prime.amount) > 0 ? `<div class="portal-bounty-panel"><div><span>🎯 MISE À PRIX ACTIVE</span><strong>${fmt(c.prime.amount)} crédits</strong></div><p>${esc(c.prime.description || 'Aucun motif renseigné.')}</p>${c.prime.threadId ? `<button class="portal-button portal-button-gold" data-action="open-discord" data-channel="${esc(c.prime.threadId)}">Ouvrir le dossier de prime ↗</button>` : ''}</div>` : ''}<div class="portal-hero-actions">${c.ficheUrl ? `<a class="portal-button portal-button-gold" href="${esc(c.ficheUrl)}" target="_blank" rel="noopener">Ouvrir la fiche ↗</a>` : ''}<button class="portal-button" data-action="show-character-inventory" data-id="${esc(c.id)}">🎒 Mon inventaire</button></div></div></div>
        <div class="portal-detail-columns"><section class="portal-panel"><h3>Statistiques</h3>${stats.length ? stats.map(([name,value]) => { const n=Math.max(0,Math.min(100,Number(value)||0)); return `<div class="portal-stat-line"><span>${esc(name)}</span><div class="portal-stat-track"><i style="width:${n}%"></i></div><strong>${n}</strong></div>`; }).join('') : '<p class="portal-lead">Aucune statistique disponible.</p>'}</section>
        <section class="portal-panel"><h3>Relations & réputation</h3><div class="portal-weight"><strong>${fmt(c.renommee)} pts</strong><small>Renommée de ton personnage</small></div>${Object.entries(c.relations || {}).map(([name,value]) => `<div class="portal-inventory-row"><span>◆</span><div><strong>${esc(name.replace(/_/g,' '))}</strong><small>Relation : ${esc(value)}/5</small></div></div>`).join('') || '<p class="portal-lead">Aucune relation renseignée.</p>'}</section></div>
        <section id="character-inventory-panel" class="portal-panel" style="margin-top:15px" hidden></section>`;
    } catch (error) { content().innerHTML = empty('⚠️','Dossier inaccessible',error.message); }
  }

  async function showCharacterInventory(id) {
    state.selectedInventoryCharacterId = String(id || '');
    state.inventoryPage = 0;
    state.inventorySelection = null;
    await navigate('inventory');
  }

  const INVENTORY_EQUIPMENT_RECTS = {
    casque: { x: 101.6, y: 92.1, w: 61.1, h: 61.1, label: 'Tête' },
    plastron: { x: 101.6, y: 191.7, w: 61.1, h: 61.1, label: 'Plastron' },
    jambes: { x: 101.6, y: 291.6, w: 61.1, h: 61.1, label: 'Jambières' },
    mainGauche: { x: 160.5, y: 378.2, w: 103, h: 57.9, label: 'Main gauche' },
    mainDroite: { x: 267.3, y: 378.2, w: 103, h: 57.9, label: 'Main droite' },
    ceinture: { x: 378, y: 94.6, w: 61.1, h: 61.1, label: 'Ceinture' },
    avantBras: { x: 378, y: 190.9, w: 61.1, h: 61.1, label: 'Avant-bras' },
    pieds: { x: 378, y: 290.2, w: 61.1, h: 61.1, label: 'Bottes' },
    sac: { x: 13.9, y: 378.6, w: 90.1, h: 89.4, label: 'Sac' },
  };
  const INVENTORY_GRID_X = [548, 629, 711, 794, 876];
  const INVENTORY_GRID_Y = [37, 119, 201, 283, 365, 447];
  const INVENTORY_GRID_W = 80;
  const INVENTORY_GRID_H = 79;

  function rectStyle(rect) {
    return `left:${(rect.x / 960) * 100}%;top:${(rect.y / 540) * 100}%;width:${(rect.w / 960) * 100}%;height:${(rect.h / 540) * 100}%`;
  }
  function inventoryImageUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^(data:image\/|https?:\/\/)/i.test(raw)) return raw;
    if (raw.startsWith('/')) return raw;
    return `/${raw.replace(/^\.\//, '')}`;
  }
  function inventoryRarityRank(value) {
    const normalized = String(value || 'Commun').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return ({ epique: 0, rare: 1, 'peu commun': 2, commun: 3 })[normalized] ?? 3;
  }
  function inventoryWeightText(value) {
    const number = Math.max(0, Number(value) || 0);
    if (Number.isInteger(number)) return String(number).padStart(2, '0');
    return fmt(number).padStart(2, '0');
  }
  function sortedInventoryItems(items) {
    return [...(items || [])].sort((a, b) => inventoryRarityRank(a.rarity) - inventoryRarityRank(b.rarity)
      || String(a.name || '').localeCompare(String(b.name || ''), 'fr', { sensitivity: 'base' }));
  }
  function inventoryDetailMarkup(selection, data) {
    if (!selection) return '<div class="player-inventory-detail-empty">Sélectionne un objet ou un équipement pour afficher ses informations.</div>';
    const source = selection.kind === 'equipment'
      ? (data.equipment || []).find(item => String(item.slot) === String(selection.slot))
      : (data.items || []).find(item => String(item.id) === String(selection.id));
    if (!source) return '<div class="player-inventory-detail-empty">Cet objet n’est plus dans ton inventaire. Actualise la page.</div>';
    const image = inventoryImageUrl(source.image);
    const quantity = selection.kind === 'equipment' ? 1 : Number(source.quantity) || 0;
    const stats = Object.entries(source.statBonus || {}).filter(([, amount]) => Number(amount));
    return `<div class="player-inventory-detail-card">
      <div class="player-inventory-detail-art">${image ? `<img src="${esc(image)}" alt="${esc(source.name)}" onerror="this.style.display='none'">` : `<span>${esc(source.emoji || '📦')}</span>`}</div>
      <div class="player-inventory-detail-copy"><div class="portal-eyebrow">${selection.kind === 'equipment' ? esc(source.slotLabel || INVENTORY_EQUIPMENT_RECTS[selection.slot]?.label || 'Équipement') : esc(source.category || 'OBJET')}</div>
        <h3>${esc(source.name)}</h3><p>${esc(source.description || 'Aucune description renseignée.')}</p>
        <div class="player-inventory-detail-meta"><span>${esc(source.rarity || 'Commun')}</span><span>×${fmt(quantity)}</span><span>${fmt(source.weight)} kg / unité</span>${source.bagCapacity ? `<span>+${fmt(source.bagCapacity)} kg de charge</span>` : ''}</div>
        ${stats.length ? `<div class="player-inventory-detail-stats">${stats.map(([name, value]) => `<span>${esc(name)} : +${fmt(value)}</span>`).join('')}</div>` : ''}
        <div class="player-inventory-detail-actions">${selection.kind === 'equipment'
          ? `<button class="portal-button portal-button-quiet" data-action="inventory-unequip" data-slot="${esc(selection.slot)}">Déséquiper</button>`
          : source.slot ? `<button class="portal-button portal-button-gold" data-action="inventory-equip" data-item-id="${esc(source.id)}">Équiper · ${esc(INVENTORY_EQUIPMENT_RECTS[source.slot]?.label || source.slot)}</button>`
          : '<span class="portal-tag">Objet transporté</span>'}</div>
      </div></div>`;
  }

  async function renderInventory() {
    loading('Chargement de ton inventaire…');
    try {
      if (!state.characters.length) state.characters = await api('/api/player/characters');
      if (!state.characters.length) {
        content().innerHTML = `<div class="portal-eyebrow">ÉQUIPEMENT PERSONNEL</div><h1 class="portal-title">Mon inventaire</h1><p class="portal-lead">Choisis un personnage pour consulter son équipement et ses objets transportés.</p><div style="margin-top:22px">${empty('🎒','Aucun personnage disponible','Crée d’abord un personnage pour disposer d’un inventaire.')}</div>`;
        return;
      }
      const selected = state.characters.find(c => String(c.id) === String(state.selectedInventoryCharacterId)) || state.characters[0];
      state.selectedInventoryCharacterId = String(selected.id);
      const data = await api(`/api/player/characters/${encodeURIComponent(selected.id)}`);
      state.inventoryData = data;
      const items = sortedInventoryItems(data.items || []);
      const totalPages = Math.max(1, Math.ceil(items.length / 30));
      state.inventoryPage = Math.min(Math.max(0, Number(state.inventoryPage) || 0), totalPages - 1);
      const pageItems = items.slice(state.inventoryPage * 30, (state.inventoryPage + 1) * 30);
      const equipmentLookup = new Map((data.equipment || []).map(item => [String(item.slot), item]));
      const equipmentMarkup = Object.entries(INVENTORY_EQUIPMENT_RECTS).map(([slot, rect]) => {
        const item = equipmentLookup.get(slot);
        if (!item) return '';
        const image = inventoryImageUrl(item.image);
        return `<button type="button" class="player-inventory-equipped" style="${rectStyle(rect)}" title="${esc(rect.label)} : ${esc(item.name)}" data-action="select-inventory-item" data-kind="equipment" data-slot="${esc(slot)}">
          ${image ? `<img src="${esc(image)}" alt="${esc(item.name)}" onerror="this.style.display='none'">` : `<span class="player-inventory-fallback">${esc(item.emoji || '📦')}</span>`}
        </button>`;
      }).join('');
      const gridMarkup = pageItems.map((item, index) => {
        const cell = { x: INVENTORY_GRID_X[index % 5], y: INVENTORY_GRID_Y[Math.floor(index / 5)], w: INVENTORY_GRID_W, h: INVENTORY_GRID_H };
        const image = inventoryImageUrl(item.image);
        return `<button type="button" class="player-inventory-grid-item" style="${rectStyle(cell)}" title="${esc(item.name)} ×${fmt(item.quantity)}" data-action="select-inventory-item" data-kind="grid" data-item-id="${esc(item.id)}">
          ${image ? `<img src="${esc(image)}" alt="${esc(item.name)}" onerror="this.style.display='none'">` : `<span class="player-inventory-fallback">${esc(item.emoji || '📦')}</span>`}
          ${Number(item.quantity) > 1 ? `<b>×${fmt(item.quantity)}</b>` : ''}
        </button>`;
      }).join('');
      const load = data.load || { totalWeight: 0, maxWeight: 10, overloaded: false };
      const selectedMarkup = inventoryDetailMarkup(state.inventorySelection, data);
      const characterOptions = state.characters.map(character => `<option value="${esc(character.id)}" ${String(character.id) === String(selected.id) ? 'selected' : ''}>${esc(character.nomPrenom)}</option>`).join('');
      content().innerHTML = `
        <div class="portal-eyebrow">ÉQUIPEMENT PERSONNEL</div>
        <div class="player-inventory-titlebar"><div><h1 class="portal-title">Mon inventaire</h1><p class="portal-lead">Équipement porté, sac et objets transportés par ton personnage.</p></div><label class="player-inventory-character-select"><span>Personnage</span><select id="player-inventory-character" class="portal-select">${characterOptions}</select></label></div>
        <section class="player-inventory-visual-wrap">
          <div class="player-inventory-stage" aria-label="Inventaire visuel de ${esc(selected.nomPrenom)}">
            <div class="player-inventory-character-name">${esc(selected.nomPrenom)}</div>
            <div class="player-inventory-weight ${load.overloaded ? 'overloaded' : ''}">${inventoryWeightText(load.totalWeight)}/${inventoryWeightText(load.maxWeight)} KG</div>
            ${equipmentMarkup}${gridMarkup}
            ${totalPages > 1 ? `<div class="player-inventory-page-indicator">${state.inventoryPage + 1}/${totalPages}</div>` : ''}
          </div>
          ${totalPages > 1 ? `<div class="player-inventory-pagination"><button class="portal-button portal-button-quiet" data-action="inventory-page" data-page-index="${Math.max(0, state.inventoryPage - 1)}" ${state.inventoryPage === 0 ? 'disabled' : ''}>← Précédent</button><span>Page ${state.inventoryPage + 1} / ${totalPages}</span><button class="portal-button portal-button-quiet" data-action="inventory-page" data-page-index="${Math.min(totalPages - 1, state.inventoryPage + 1)}" ${state.inventoryPage >= totalPages - 1 ? 'disabled' : ''}>Suivant →</button></div>` : ''}
        </section>
        <section class="portal-panel player-inventory-detail-panel" id="player-inventory-details">${selectedMarkup}</section>
      `;
    } catch (error) {
      content().innerHTML = empty('⚠️', 'Inventaire indisponible', error.message);
    }
  }

  async function refreshPlayerInventory(message) {
    state.inventorySelection = null;
    await renderInventory();
    if (message) toast(message);
  }

  async function equipPlayerInventoryItem(itemId) {
    const profileId = state.selectedInventoryCharacterId;
    if (!profileId || !itemId) return;
    try {
      const result = await api(`/api/player/characters/${encodeURIComponent(profileId)}/equip`, { method: 'POST', body: JSON.stringify({ itemId }) });
      await refreshPlayerInventory(result.message || 'Équipement mis à jour.');
    } catch (error) { toast(error.message, true); }
  }

  async function unequipPlayerInventorySlot(slot) {
    const profileId = state.selectedInventoryCharacterId;
    if (!profileId || !slot) return;
    try {
      const result = await api(`/api/player/characters/${encodeURIComponent(profileId)}/unequip`, { method: 'POST', body: JSON.stringify({ slot }) });
      await refreshPlayerInventory(result.message || 'Équipement retiré.');
    } catch (error) { toast(error.message, true); }
  }

  function renderLocationPage(group) {
    if (group === 'planets') {
      content().innerHTML = `<div class="portal-eyebrow">CARTE GALACTIQUE</div><h1 class="portal-title">Planètes connues</h1><p class="portal-lead">Sélectionne une planète pour rejoindre ses lieux de jeu. Chaque destination ouvre directement son salon Discord.</p>${LOCATIONS.planets.map(planet => `<section class="portal-location-group"><h3>${planet.icon} ${esc(planet.name)} <span class="portal-tag">${planet.places.length} lieux</span></h3><div class="portal-location-grid">${locationButton({name:planet.name,id:planet.id,subtitle:planet.subtitle})}${planet.places.map(place => locationButton(place)).join('')}</div></section>`).join('')}`;
      return;
    }
    const entries = LOCATIONS[group] || [];
    const title = group === 'hutt' ? 'Espace Hutt & Médiane' : 'Bordures extérieures';
    content().innerHTML = `<div class="portal-eyebrow">CARTE GALACTIQUE · SECTEURS</div><h1 class="portal-title">${title}</h1><p class="portal-lead">Parcours les lieux de ce secteur et rejoins leur salon pour prendre part au RP.</p><section class="portal-location-group"><div class="portal-location-grid">${entries.map(place => locationButton(place)).join('')}</div></section>`;
  }

  function renderCorePage() {
    content().innerHTML = `<div class="portal-eyebrow">CARTE GALACTIQUE · RÉGION CENTRALE</div><h1 class="portal-title">Espace du Noyau</h1><p class="portal-lead">Les mondes du Noyau seront regroupés ici dès que leurs destinations de jeu seront définies.</p><div style="margin-top:25px">${empty('✦','Secteur en préparation','Aucun salon de destination n’a encore été renseigné pour cette région.')}</div>`;
  }
  function renderForumPage() {
    content().innerHTML = `<div class="portal-eyebrow">COMMUNAUTÉ</div><h1 class="portal-title">Forum & communauté</h1><p class="portal-lead">Les échanges RP et les sujets de communauté sont hébergés sur le serveur Discord. Depuis ce portail, tu peux retrouver les lieux de jeu et accéder directement au serveur.</p><div class="portal-hero" style="margin-top:22px"><div class="portal-hero-content"><div class="portal-eyebrow">RÉSEAU DE COMMUNICATION</div><h2 class="portal-title" style="font-size:27px">Le relais de la galaxie</h2><p class="portal-lead">Rejoins le serveur pour participer aux discussions, retrouver les salons de RP et suivre les annonces.</p><div class="portal-hero-actions"><button class="portal-button portal-button-gold" data-action="open-discord">Ouvrir le serveur Discord ↗</button><button class="portal-button" data-action="navigate" data-page="planets">Explorer les lieux</button></div></div></div>`;
  }

  async function renderMissions() {
    loading('Recherche des contrats disponibles…');
    try {
      const [missions, characters] = await Promise.all([api('/api/player/missions'), api('/api/player/characters')]);
      state.missions = missions; state.characters = characters;
      const available = missions.filter(m => m.status === 'available');
      const own = missions.filter(m => m.status !== 'available');
      const card = mission => {
        const claimed = mission.status !== 'available';
        const rewards = (mission.rewards || []).map(r => `<span class="portal-reward">${rewardText(r)}</span>`).join('');
        const select = !claimed && characters.length ? `<select class="portal-select" data-profile-select="${esc(mission.id)}"><option value="">Choisir un personnage…</option>${characters.map(c => `<option value="${esc(c.id)}">${esc(c.nomPrenom)}</option>`).join('')}</select>` : '';
        const linkId = claimed ? mission.acceptedThreadId : mission.publicThreadId;
        return `<article class="portal-mission-card"><div><div class="portal-eyebrow">${claimed ? 'MISSION EN COURS' : 'CONTRAT DISPONIBLE'}</div><h3>${esc(mission.title)}</h3><p>${esc(mission.description)}</p><div class="portal-rewards">${rewards || '<span class="portal-reward">Récompense à définir</span>'}</div><div class="portal-mission-controls">${claimed ? `<span class="portal-tag gold">Avec ${esc(mission.profileName || 'ton personnage')}</span>` : select}${claimed ? '' : `<button class="portal-button portal-button-gold" data-action="accept-mission" data-id="${esc(mission.id)}" ${characters.length ? '' : 'disabled'}>Accepter la mission</button>`}${linkId ? `<button class="portal-button portal-button-quiet" data-action="open-discord" data-channel="${esc(linkId)}">Suivi Discord ↗</button>` : ''}</div></div>${mission.image ? `<img class="portal-mission-image" src="${esc(mission.image)}" alt="Illustration de mission">` : '<div class="portal-mission-image" style="display:grid;place-items:center;font-size:34px">🚀</div>'}</article>`;
      };
      content().innerHTML = `<div class="portal-eyebrow">CONTRATS GALACTIQUES</div><h1 class="portal-title">Missions</h1><p class="portal-lead">Accepte un contrat avec l’un de tes personnages. Le suivi de la mission sera automatiquement synchronisé avec Discord.</p><div class="portal-section-head"><div><h3>Contrats disponibles</h3><p>${available.length} mission(s) ouverte(s).</p></div></div>${available.map(card).join('') || empty('🚀','Aucun contrat disponible','De nouvelles missions apparaîtront ici dès leur publication.')}
        <div class="portal-section-head"><div><h3>Mes missions en cours</h3><p>Les contrats acceptés avec tes personnages.</p></div></div>${own.map(card).join('') || '<p class="portal-lead">Tu n’as pas de mission en cours.</p>'}`;
    } catch (error) { content().innerHTML = empty('⚠️','Missions indisponibles',error.message); }
  }

  async function acceptMission(id) {
    const select = content().querySelector(`[data-profile-select="${CSS.escape(id)}"]`);
    const profileId = select?.value;
    if (!profileId) { toast('Choisis d’abord un personnage.', true); return; }
    try {
      await api(`/api/player/missions/${encodeURIComponent(id)}/accept`, { method: 'POST', body: JSON.stringify({ profileId }) });
      toast('Mission acceptée. Le suivi Discord va être créé.');
      await renderMissions();
    } catch (error) { toast(error.message, true); await renderMissions(); }
  }

  async function renderPrimes() {
    loading('Mise à jour des avis de recherche…');
    try {
      state.primes = await api('/api/player/primes');
      content().innerHTML = `<div class="portal-eyebrow">AVIS DE RECHERCHE</div><h1 class="portal-title">Primes galactiques</h1><p class="portal-lead">Consulte les personnages actuellement recherchés et ouvre leur dossier public sur Discord.</p><div class="portal-grid" style="margin-top:22px">${state.primes.map(prime => `<article class="portal-card">${prime.imageUrl ? `<img class="portal-card-image" src="${esc(prime.imageUrl)}" alt="">` : ''}<div class="portal-card-body"><span class="portal-tag gold">🎯 CIBLE RECHERCHÉE</span><h3 style="margin-top:10px">${esc(prime.name)}</h3><p>${esc(prime.description || 'Aucune information supplémentaire.')}</p><div class="portal-card-meta"><span class="portal-tag gold">${fmt(prime.amount)} crédits</span>${prime.faction ? `<span class="portal-tag">${esc(prime.faction)}</span>` : ''}</div></div><div class="portal-card-actions">${prime.threadId ? `<button class="portal-button portal-button-gold" data-action="open-discord" data-channel="${esc(prime.threadId)}">Ouvrir le dossier ↗</button>` : '<span class="portal-tag">Dossier Discord en préparation</span>'}</div></article>`).join('') || empty('🎯','Aucune prime active','Le tableau des primes est vide pour le moment.')}</div>`;
    } catch (error) { content().innerHTML = empty('⚠️','Primes indisponibles',error.message); }
  }

  async function renderShop() {
    loading('Inventaire des comptoirs commerciaux…');
    try {
      state.shop = await api('/api/player/shop');
      content().innerHTML = `<div class="portal-eyebrow">ÉCONOMIE GALACTIQUE</div><h1 class="portal-title">Boutique</h1><p class="portal-lead">Parcours les articles actuellement proposés. Les achats et échanges sont toujours confirmés sur le serveur Discord.</p><div class="portal-grid" style="margin-top:22px">${state.shop.map(item => `<article class="portal-card">${item.image ? `<img class="portal-card-image" src="${esc(item.image)}" alt="">` : ''}<div class="portal-card-body"><span class="portal-tag">${esc(item.category)}</span><h3 style="margin-top:9px">${esc(item.emoji || '📦')} ${esc(item.name)}</h3><p>${esc(item.description || '')}</p><div class="portal-card-meta"><span class="portal-tag ${item.stock > 0 ? 'green' : ''}">Stock : ${fmt(item.stock)}</span>${item.buyable ? `<span class="portal-tag gold">${fmt(item.minPrice)} – ${fmt(item.maxPrice)} crédits</span>` : '<span class="portal-tag">Rachat uniquement</span>'}</div></div><div class="portal-card-actions"><button class="portal-button portal-button-quiet" data-action="open-discord">Voir les échanges sur Discord ↗</button></div></article>`).join('') || empty('◇','Boutique vide','Les articles disponibles apparaîtront ici.')}</div>`;
    } catch (error) { content().innerHTML = empty('⚠️','Boutique indisponible',error.message); }
  }

  async function updateHeartbeat() {
    try {
      const data = await api('/api/player/heartbeat', { method: 'POST', body: '{}' });
      const counter = document.getElementById('portal-online-count');
      if (counter) counter.textContent = Number(data.onlineCount) || 0;
    } catch { /* l'affichage actuel reste utilisable si la présence est indisponible */ }
  }

  function initEvents() {
    const nav = document.getElementById('player-nav');
    if (nav && !nav.dataset.bound) {
      nav.dataset.bound = '1';
      nav.innerHTML = navMarkup();
      nav.addEventListener('click', event => {
        const btn = event.target.closest('[data-page]');
        if (btn) navigate(btn.dataset.page);
      });
    }
    const body = content();
    if (body && !body.dataset.bound) {
      body.dataset.bound = '1';
      body.addEventListener('click', async event => {
        const btn = event.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        if (action === 'navigate') return navigate(btn.dataset.page);
        if (action === 'open-character') return openCharacter(btn.dataset.id);
        if (action === 'show-character-inventory') return showCharacterInventory(btn.dataset.id);
        if (action === 'select-inventory-item') {
          state.inventorySelection = { kind: btn.dataset.kind, id: btn.dataset.itemId || '', slot: btn.dataset.slot || '' };
          const details = document.getElementById('player-inventory-details');
          if (details && state.inventoryData) details.innerHTML = inventoryDetailMarkup(state.inventorySelection, state.inventoryData);
          return;
        }
        if (action === 'inventory-equip') return equipPlayerInventoryItem(btn.dataset.itemId);
        if (action === 'inventory-unequip') return unequipPlayerInventorySlot(btn.dataset.slot);
        if (action === 'inventory-page') { state.inventoryPage = Number(btn.dataset.pageIndex) || 0; return renderInventory(); }
        if (action === 'accept-mission') return acceptMission(btn.dataset.id);
        if (action === 'open-discord') return openDiscord(btn.dataset.channel || null);
      });
      body.addEventListener('change', event => {
        if (event.target?.id === 'player-inventory-character') {
          state.selectedInventoryCharacterId = String(event.target.value || '');
          state.inventoryPage = 0;
          state.inventorySelection = null;
          renderInventory();
        }
      });
    }
  }

  function initialiserPortailJoueur(me) {
    state.me = me || {};
    const username = document.getElementById('player-username');
    const badge = document.getElementById('player-role-badge');
    const avatar = document.getElementById('player-avatar');
    if (username) username.textContent = state.me.username || 'Joueur';
    if (badge) badge.textContent = state.me.isStaff ? 'STAFF' : (state.me.isWhitelisted ? 'WHITELIST' : 'MEMBRE');
    if (avatar) { avatar.src = state.me.avatar || ''; avatar.alt = state.me.username || ''; }
    initEvents();
    navigate('dashboard');
    if (state.heartbeat) clearInterval(state.heartbeat);
    state.heartbeat = setInterval(updateHeartbeat, 45_000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) updateHeartbeat(); });
  }
  window.initialiserPortailJoueur = initialiserPortailJoueur;

  document.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('click', event => {
      const btn = event.target.closest('[data-action="open-discord-global"]');
      if (btn) openDiscord(btn.dataset.channel || null);
    });
  });
})();
