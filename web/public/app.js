const state = {
  cache: { profils: [], inventaires: [], inventoryDetails: {} },
  pageFilters: {},
  selectedCatalogIds: new Set(),
  selectedProfileIds: new Set(),
  isFounder: false,
  catalogue: [],
  catalogueCategorieActive: 'Tout',
  catalogueCategories: [],
  crafts: [],
  craftActuel: null,
  productions: [],
  personnelTypes: [],
  productionActuelle: null,
  personnelTypeActuel: null,
  boutique: [],
  boutiqueActuelle: null,
  traits: [],
  traitActuel: null,
  traitActionsDraft: [],
  filtreTraits: 'tous',
  statuts: [],
  listes: { relationFactions: [], relationLevels: [], defaultStats: [], statMax: 10 },
  collectionActuelle: null,
  itemActuel: null, // { type: 'profil' | 'catalogue' | 'inventaire', id }
};

// -----------------------------------------------------------------------
// Démarrage
// -----------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (document.getElementById('confirm-overlay').classList.contains('visible')) {
      resoudreConfirm(false);
    } else if (document.getElementById('panneau-catalogue').classList.contains('ouvert')) {
      fermerCataloguePanel();
    } else {
      fermerPanneau();
    }
  });

  document.getElementById('btn-deconnexion').addEventListener('click', deconnexion);
  initialiserMenuLateral();

  afficherErreurAuthEventuelle();
  verifierSessionExistante();
});


// Navigation latérale repliable (préférence conservée sur cet appareil).
function initialiserMenuLateral() {
  const shell = document.getElementById('app-shell');
  const bouton = document.getElementById('btn-sidebar-toggle');
  const nav = document.getElementById('sidebar-nav');
  if (!shell || !bouton || !nav) return;

  let saved = null;
  try { saved = localStorage.getItem('starwars-admin-sidebar-collapsed'); } catch { /* stockage indisponible */ }
  const mobile = window.matchMedia('(max-width: 760px)').matches;

  const appliquer = (replie) => {
    shell.classList.toggle('sidebar-collapsed', replie);
    bouton.setAttribute('aria-expanded', String(!replie));
    bouton.setAttribute('aria-label', replie ? 'Agrandir le menu' : 'Réduire le menu');
    bouton.title = replie ? 'Agrandir le menu' : 'Réduire le menu';
    try { localStorage.setItem('starwars-admin-sidebar-collapsed', replie ? '1' : '0'); } catch { /* stockage indisponible */ }
  };

  appliquer(saved === null ? mobile : saved === '1');
  bouton.addEventListener('click', () => {
    appliquer(!shell.classList.contains('sidebar-collapsed'));
  });

  nav.querySelectorAll('.nav-btn').forEach((btn) => {
    const label = btn.querySelector('.nav-label')?.textContent?.trim();
    if (label) btn.title = label;
  });
}

// Si on revient d'un /auth/discord/callback qui a échoué (pas membre, pas le
// rôle Staff, requête expirée...), le serveur nous redirige vers "/?auth_error=...".
function afficherErreurAuthEventuelle() {
  const params = new URLSearchParams(window.location.search);
  const message = params.get('auth_error');
  if (!message) return;
  const erreurEl = document.getElementById('connexion-erreur');
  erreurEl.textContent = message;
  erreurEl.hidden = false;
  window.history.replaceState({}, '', window.location.pathname);
}

// Seule façon d'être déjà connecté en arrivant sur la page : un cookie de
// session Discord valide (connexion via /auth/discord), avec le rôle Staff.
async function verifierSessionExistante() {
  try {
    const meRes = await fetch('/api/me');
    const me = await meRes.json();
    if (me.authenticated) {
      afficherUtilisateurConnecte(me);
      afficherApplication();
      demarrerApplication().then(() => chargerDonnees('dashboard'));
    }
  } catch { /* pas connecté : l'écran de connexion reste affiché */ }
}

function afficherUtilisateurConnecte(me) {
  state.isFounder = me?.isFounder === true;
  const badge = document.getElementById('topbar-user');
  if (!me.username) { badge.hidden = true; return; }
  document.getElementById('user-nom').textContent = me.username;
  const avatar = document.getElementById('user-avatar');
  if (me.avatar) { avatar.src = me.avatar; avatar.hidden = false; } else { avatar.hidden = true; }
  badge.hidden = false;
  document.getElementById('nav-admin').hidden = !me.isSuperAdmin;
}

// -----------------------------------------------------------------------
// Écran de connexion - Discord uniquement (rôle Staff vérifié côté serveur)
// -----------------------------------------------------------------------
function deconnexion() {
  fetch('/auth/logout', { method: 'POST' })
    .catch(() => {})
    .finally(() => window.location.reload());
}

function afficherApplication() {
  document.getElementById('ecran-connexion').hidden = true;
  document.getElementById('app-shell').hidden = false;
}

// La session Discord vit dans un cookie envoyé automatiquement par le
// navigateur sur chaque requête same-origin : pas d'en-tête à ajouter.
function apiFetch(url, options = {}) {
  return fetch(url, options);
}

function demarrerApplication() {
  return Promise.allSettled([
    apiFetch('/api/profils').then(r => r.json()).then(d => { state.cache.profils = d; majCompteur('profils', d.length); majCompteur('inventaire', d.length); }),
    apiFetch('/api/statuts').then(r => r.json()).then(d => { state.statuts = d; }),
    apiFetch('/api/lists').then(r => r.json()).then(d => { state.listes = d; }),
  ]).then(() => setStatutConnexion(true));
}

function setStatutConnexion(ok) {
  document.getElementById('connexion-statut').textContent = ok ? 'Connecté' : 'Erreur de connexion';
  document.getElementById('status-dot').classList.toggle('erreur', !ok);
}

function majCompteur(collection, n) {
  const el = document.getElementById(`count-${collection}`);
  if (el) el.textContent = n;
}


const RARETE_ORDRE = { epique: 0, rare: 1, 'peu-commun': 2, commun: 3 };

function pagePrefs(collection) {
  if (!state.pageFilters[collection]) {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(`starwars-admin-filters:${collection}`) || '{}') || {}; } catch { saved = {}; }
    state.pageFilters[collection] = saved;
  }
  return state.pageFilters[collection];
}

function getPageFilter(collection, key, fallback = '') {
  const value = pagePrefs(collection)[key];
  return value === undefined || value === null ? fallback : String(value);
}

function setPageFilter(collection, key, value) {
  const prefs = pagePrefs(collection);
  prefs[key] = String(value ?? '');
  try { localStorage.setItem(`starwars-admin-filters:${collection}`, JSON.stringify(prefs)); } catch { /* préférences facultatives */ }
}

function optionsFiltre(options, current) {
  return options.map(option => {
    const value = typeof option === 'string' ? option : option.value;
    const label = typeof option === 'string' ? option : option.label;
    return `<option value="${escapeAttr(value)}" ${String(current) === String(value) ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('');
}

function selectFiltreHTML(collection, key, label, options, fallback = '') {
  return `<label class="filter-control"><span>${escapeHtml(label)}</span><select onchange="changerFiltrePage('${collection}','${key}',this.value)">${optionsFiltre(options, getPageFilter(collection, key, fallback))}</select></label>`;
}

function toolbarFiltreHTML(collection, controls, extraClass = '') {
  return `<div class="filters-toolbar ${extraClass}">${controls.join('')}</div>`;
}

function changerFiltrePage(collection, key, value) {
  setPageFilter(collection, key, value);
  if (collection === 'catalogue' && key === 'category') {
    selectionnerCategorieCatalogue(value || 'Tout');
    return;
  }
  const renderers = {
    profils: () => renderListeProfils(state.cache.profils || []),
    catalogue: renderCataloguePage,
    crafts: renderCraftsPage,
    production: renderProductionPage,
    personnel: renderPersonnelPage,
    boutique: renderBoutiquePage,
  };
  renderers[collection]?.();
  filtrerListe();
}

function recentDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

function afficherListeRecenteDashboard(rows) {
  if (!rows?.length) return `<div class="etat-vide dashboard-empty"><p>Aucune modification récente.</p></div>`;
  return `<div class="dashboard-recent-list">${rows.map(row => `
    <article class="dashboard-recent-item">
      <span class="dashboard-recent-icon">${LOG_ICONES[row.action] || '•'}</span>
      <div><strong>${escapeHtml(row.username || 'Inconnu')}</strong><p>${escapeHtml(row.details || row.action || 'Action')}</p><time>${escapeHtml(recentDate(row.timestamp))}</time></div>
    </article>`).join('')}</div>`;
}

async function chargerDashboardPage() {
  const contenuDiv = document.getElementById('contenu');
  document.getElementById('search-wrap').hidden = true;
  contenuDiv.innerHTML = '<div class="squelette"></div><div class="squelette"></div><div class="squelette"></div>';
  try {
    const response = await apiFetch('/api/dashboard');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const cards = [
      ['profils', '👤', 'Personnages', 'profils'], ['objets', '📦', 'Objets', 'catalogue'],
      ['crafts', '🛠️', 'Recettes de craft', 'crafts'], ['productions', '🏭', 'Productions', 'production'],
      ['personnel', '👷', 'Métiers', 'personnel'], ['boutique', '🛒', 'Articles boutique', 'boutique'],
    ];
    contenuDiv.innerHTML = `
      <section class="dashboard-welcome"><div><span class="dashboard-eyebrow">CENTRE DE CONTRÔLE</span><h3>Bienvenue dans Mirage Admin</h3><p>Vue d’ensemble du serveur et accès rapide aux outils de gestion.</p></div><button type="button" class="btn-secondaire" onclick="chargerDashboardPage()">↻ Actualiser</button></section>
      <section class="dashboard-stats">${cards.map(([key, icon, label, page]) => `<button type="button" class="dashboard-stat-card" onclick="chargerDonnees('${page}')"><span>${icon}</span><strong>${Number(data.counts?.[key]) || 0}</strong><small>${label}</small></button>`).join('')}</section>
      <section class="dashboard-shortcuts"><div class="section-titre">⚡ Accès rapides</div><div class="dashboard-shortcuts-grid">
        <button class="dashboard-shortcut" onclick="chargerDonnees('profils')">👤 Gérer les profils</button><button class="dashboard-shortcut" onclick="chargerDonnees('inventaire')">🎒 Ouvrir les inventaires</button><button class="dashboard-shortcut" onclick="chargerDonnees('catalogue')">📦 Gérer les objets</button><button class="dashboard-shortcut" onclick="chargerDonnees('crafts')">🛠️ Configurer les crafts</button><button class="dashboard-shortcut" onclick="chargerDonnees('production')">🏭 Gérer les productions</button><button class="dashboard-shortcut" onclick="chargerDonnees('personnel')">👷 Gérer le personnel</button><button class="dashboard-shortcut" onclick="chargerDonnees('boutique')">🛒 Configurer la boutique</button>
      </div></section>
      <section class="dashboard-recent"><div class="section-titre">🕘 Dernières modifications</div>${afficherListeRecenteDashboard(data.recent)}</section>`;
    setStatutConnexion(true);
  } catch (error) {
    contenuDiv.innerHTML = `<div class="etat-vide"><div class="etat-vide-icone">⚠️</div><p>Tableau de bord indisponible</p><span class="etat-vide-sub">${escapeHtml(error.message)}</span></div>`;
  }
}

// -----------------------------------------------------------------------
// Chargement d'une section : Profils RP, Inventaire, Catalogue ou Admin
// -----------------------------------------------------------------------
async function chargerDonnees(collection) {
  state.collectionActuelle = collection;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.collection === collection));

  const searchWrap = document.getElementById('search-wrap');

  if (collection === 'dashboard') {
    document.getElementById('titre-section').textContent = 'Accueil';
    document.getElementById('sous-titre').textContent = 'Vue générale et raccourcis d’administration.';
    await chargerDashboardPage();
  } else if (collection === 'profils') {
    searchWrap.hidden = false;
    const rechercheInput = document.getElementById('recherche');
    rechercheInput.value = getPageFilter('profils', 'q', '');
    rechercheInput.placeholder = 'Rechercher un personnage...';
    document.getElementById('titre-section').textContent = 'Profils RP';
    document.getElementById('sous-titre').textContent = 'Personnages joués sur le serveur.';
    await chargerProfils();
  } else if (collection === 'inventaire') {
    searchWrap.hidden = false;
    const rechercheInput = document.getElementById('recherche');
    rechercheInput.value = getPageFilter('inventaire', 'q', '');
    rechercheInput.placeholder = 'Rechercher un personnage...';
    document.getElementById('titre-section').textContent = 'Inventaire';
    document.getElementById('sous-titre').textContent = 'Inventaires individuels des personnages.';
    await chargerInventairePage();
  } else if (collection === 'catalogue') {
    searchWrap.hidden = false;
    const rechercheInput = document.getElementById('recherche');
    rechercheInput.value = getPageFilter('catalogue', 'q', '');
    rechercheInput.placeholder = 'Rechercher par nom ou ID...';
    document.getElementById('titre-section').textContent = "Catalogue d'objets";
    document.getElementById('sous-titre').textContent = 'Tous les objets du serveur, organisés par catégorie et rareté.';
    await chargerCataloguePage();
  } else if (collection === 'crafts') {
    searchWrap.hidden = false;
    const rechercheInput = document.getElementById('recherche');
    rechercheInput.value = getPageFilter('crafts', 'q', '');
    rechercheInput.placeholder = 'Rechercher une recette ou un ID...';
    document.getElementById('titre-section').textContent = 'Atelier & crafts';
    document.getElementById('sous-titre').textContent = 'Configure les recettes disponibles dans le salon Discord Atelier.';
    await chargerCraftsPage();
  } else if (collection === 'production') {
    searchWrap.hidden = false;
    const rechercheInput = document.getElementById('recherche');
    rechercheInput.value = getPageFilter('production', 'q', '');
    rechercheInput.placeholder = 'Rechercher une production ou un ID...';
    document.getElementById('titre-section').textContent = 'Production';
    document.getElementById('sous-titre').textContent = 'Configure les recettes de production proposées aux joueurs dans Discord.';
    await chargerProductionPage();
  } else if (collection === 'personnel') {
    searchWrap.hidden = false;
    const rechercheInput = document.getElementById('recherche');
    rechercheInput.value = getPageFilter('personnel', 'q', '');
    rechercheInput.placeholder = 'Rechercher un métier ou un ID...';
    document.getElementById('titre-section').textContent = 'Personnel & métiers';
    document.getElementById('sous-titre').textContent = 'Configure les membres du personnel achetables, leurs coûts, leurs tâches et leur entretien quotidien.';
    await chargerPersonnelPage();
  } else if (collection === 'boutique') {
    searchWrap.hidden = false;
    const rechercheInput = document.getElementById('recherche');
    rechercheInput.value = getPageFilter('boutique', 'q', '');
    rechercheInput.placeholder = 'Rechercher un objet ou un ID...';
    document.getElementById('titre-section').textContent = 'Boutique';
    document.getElementById('sous-titre').textContent = 'Objets, prix et stock de la boutique Discord. Les achats et ventes se font sur le bot.';
    await chargerBoutiquePage();
  } else if (collection === 'traits') {
    searchWrap.hidden = false;
    const rechercheInput = document.getElementById('recherche');
    rechercheInput.value = '';
    rechercheInput.placeholder = 'Rechercher un bonus ou un malus...';
    document.getElementById('titre-section').textContent = 'Bonus / malus';
    document.getElementById('sous-titre').textContent = 'Configure les traits proposés à l’étape 4 de création des personnages et leurs effets.';
    await chargerTraitsPage();
  } else if (collection === 'primes') {
    searchWrap.hidden = false;
    const rechercheInput = document.getElementById('recherche');
    rechercheInput.value = '';
    rechercheInput.placeholder = 'Rechercher un personnage...';
    document.getElementById('titre-section').textContent = 'Primes';
    document.getElementById('sous-titre').textContent = 'Gère les primes des personnages. Les fiches actives sont publiées automatiquement dans le forum Discord des primes.';
    await chargerPrimesPage();
  } else if (collection === 'admin') {
    searchWrap.hidden = true;
    document.getElementById('titre-section').textContent = 'Admin';
    document.getElementById('sous-titre').textContent = 'Connexions et journal des actions - visible par le créateur uniquement.';
    await chargerAdminPage();
  }
}

async function chargerProfils() {
  const contenuDiv = document.getElementById('contenu');
  contenuDiv.innerHTML = Array.from({ length: 5 }).map(() => '<div class="squelette"></div>').join('');

  try {
    const response = await apiFetch('/api/profils');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.cache.profils = data;
    majCompteur('profils', data.length);
    majCompteur('inventaire', data.length);
    renderListeProfils(data);
    setStatutConnexion(true);
  } catch (error) {
    contenuDiv.innerHTML = `<div class="etat-vide"><div class="etat-vide-icone">⚠️</div><p>Erreur de connexion à l'API</p><span class="etat-vide-sub">${escapeHtml(error.message)} - vérifie que le serveur (web/server.js) tourne et que tu es bien authentifié.</span></div>`;
    setStatutConnexion(false);
    console.error('Erreur Fetch:', error);
  }
}

function champsProfilManquants(profile) {
  const required = [
    ['Nom', profile.nomPrenom],
    ['Faction', profile.categoryName || profile.categoryId],
    ['Grade', profile.roleName || profile.roleId],
    ['Statut', profile.statut],
    ['Faceclaim', profile.faceclaim],
  ];
  return required.filter(([, value]) => value === undefined || value === null || String(value).trim() === '').map(([label]) => label);
}

function toolbarFiltresProfilsHTML() {
  const factions = [{ value: '', label: 'Toutes les factions' }, ...(state.listes.factions || []).map(f => ({ value: String(f.categoryRoleId || ''), label: f.label }))];
  const roles = [{ value: '', label: 'Tous les grades' }, ...(state.listes.factions || []).flatMap(f => (f.grades || []).map(g => ({ value: String(g.id), label: `${f.label} — ${g.name}` })))];
  const statuts = [{ value: '', label: 'Tous les statuts' }, ...(state.statuts || ['Vivant', 'Blessé', 'Prisonnier', 'Mort']).map(value => ({ value, label: value }))];
  return toolbarFiltreHTML('profils', [
    selectFiltreHTML('profils', 'faction', 'Faction', factions),
    selectFiltreHTML('profils', 'grade', 'Grade', roles),
    selectFiltreHTML('profils', 'statut', 'Statut', statuts),
    selectFiltreHTML('profils', 'completude', 'Fiche', [{ value: '', label: 'Toutes les fiches' }, { value: 'incomplete', label: 'Incomplètes uniquement' }, { value: 'complete', label: 'Complètes uniquement' }]),
    `<div class="filter-actions"><span id="compare-selection-count">${state.selectedProfileIds.size} sélectionné(s)</span><button type="button" class="btn-secondaire" id="btn-compare-profils" onclick="ouvrirComparaisonProfils()" ${state.selectedProfileIds.size < 2 ? 'disabled' : ''}>⇄ Comparer</button><button type="button" class="btn-secondaire" onclick="viderComparaisonProfils()" ${state.selectedProfileIds.size ? '' : 'disabled'}>Effacer la sélection</button></div>`,
  ], 'profiles-filter-toolbar');
}

function renderListeProfils(data) {
  const contenuDiv = document.getElementById('contenu');
  const rows = data || [];
  contenuDiv.innerHTML = toolbarFiltresProfilsHTML() +
    (rows.length ? rows.map((item, i) => ligneHTML(item, i)).join('') : "<div class='etat-vide'><div class='etat-vide-icone'>🕸️</div><p>Aucune donnée trouvée</p></div>") +
    '<div class="aucun-resultat" id="aucun-resultat" hidden>Aucun résultat pour ces filtres.</div>';
  filtrerListe();
}

function ligneHTML(item, index) {
  const delay = `${Math.min(index, 14) * 20}ms`;
  const statutBadge = item.statut === 'Vivant' ? 'badge-vert' : item.statut === 'Mort' ? 'badge-sang'
    : item.statut === 'Prisonnier' ? 'badge-acier' : 'badge-or';
  const missing = champsProfilManquants(item);
  const profileId = String(item._id);
  return `
    <div class="ligne profil-ligne" style="--i:${delay}" data-id="${escapeAttr(profileId)}" data-faction="${escapeAttr(item.categoryId || '')}" data-grade="${escapeAttr(item.roleId || '')}" data-statut="${escapeAttr(item.statut || '')}" data-incomplet="${missing.length ? '1' : '0'}" data-nom="${escapeAttr(((item.nomPrenom || profileId) + ' ' + profileId + ' ' + (item.surnom || '') + ' ' + (item.faceclaim || '') + ' ' + (item.categoryName || '') + ' ' + (item.roleName || '')).toLowerCase())}">
      <label class="profile-compare-check" title="Sélectionner pour comparaison"><input type="checkbox" ${state.selectedProfileIds.has(profileId) ? 'checked' : ''} onchange="toggleCompareProfil('${jsAttr(profileId)}', this.checked)"><span></span></label>
      <div class="ligne-sigil">👤</div>
      <div class="ligne-corps">
        <div class="ligne-nom">${escapeHtml(item.nomPrenom || profileId)} ${item.surnom ? `<span class="profile-nickname">« ${escapeHtml(item.surnom)} »</span>` : ''}</div>
        <div class="ligne-meta">
          <span class="badge ${statutBadge}">${escapeHtml(item.statut || '-')}</span>
          <span class="badge badge-defaut">${escapeHtml(item.roleName || 'Sans rôle')}${item.categoryName ? ` — ${escapeHtml(item.categoryName)}` : ''}</span>
          ${item.age !== undefined && item.age !== '' ? `<span class="badge badge-defaut">Âge : ${escapeHtml(item.age)}</span>` : ''}
          ${item.faceclaim ? `<span class="badge badge-defaut">Faceclaim : ${escapeHtml(item.faceclaim)}</span>` : ''}
          ${item.renommee !== undefined ? `<span class="badge badge-defaut">Renommée : ${escapeHtml(item.renommee)}</span>` : ''}
          ${missing.length ? `<span class="badge badge-incomplet" title="À compléter : ${escapeAttr(missing.join(', '))}">⚠ Fiche incomplète (${missing.length})</span>` : '<span class="badge badge-complet">✓ Fiche complète</span>'}
        </div>
      </div>
      <div class="ligne-actions-profil"><button class="btn-secondaire" onclick="ouvrirHistorique('profil','${jsAttr(profileId)}','${jsAttr(item.nomPrenom || profileId)}')">Historique</button><button class="btn-modifier" onclick="ouvrirEditeur('${jsAttr(profileId)}')">Modifier</button></div>
    </div>`;
}

function toggleCompareProfil(id, checked) {
  if (checked) {
    if (state.selectedProfileIds.size >= 4 && !state.selectedProfileIds.has(id)) {
      toast('Tu peux comparer jusqu’à 4 profils à la fois.', 'erreur');
      const checkbox = [...document.querySelectorAll('.profile-compare-check input')].find(input => input.getAttribute('onchange')?.includes(`'${id}'`));
      if (checkbox) checkbox.checked = false;
      return;
    }
    state.selectedProfileIds.add(id);
  } else state.selectedProfileIds.delete(id);
  const count = document.getElementById('compare-selection-count');
  const compare = document.getElementById('btn-compare-profils');
  if (count) count.textContent = `${state.selectedProfileIds.size} sélectionné(s)`;
  if (compare) compare.disabled = state.selectedProfileIds.size < 2;
  document.querySelectorAll('.profile-compare-check').forEach(label => {
    const input = label.querySelector('input');
    if (input) input.disabled = state.selectedProfileIds.size >= 4 && !input.checked;
  });
}

function viderComparaisonProfils() {
  state.selectedProfileIds.clear();
  renderListeProfils(state.cache.profils || []);
}

function ouvrirComparaisonProfils() {
  const selected = [...state.selectedProfileIds].map(id => state.cache.profils.find(profile => String(profile._id) === id)).filter(Boolean);
  if (selected.length < 2) return toast('Sélectionne au moins deux profils à comparer.', 'erreur');
  const fields = [
    ['Faction', p => p.categoryName || '—'], ['Grade', p => p.roleName || '—'], ['Statut', p => p.statut || '—'],
    ['Âge', p => p.age || '—'], ['Faceclaim', p => p.faceclaim || '—'], ['Surnom', p => p.surnom || '—'],
    ['Renommée', p => p.renommee ?? '—'], ['Garde personnelle', p => p.gardePersonnelle || '—'],
    ['Bourse personnelle', p => p.boursePersonnelle || '—'], ['Notes', p => p.notes || '—'],
    ['Stats', p => Object.entries(p.stats || {}).map(([key, value]) => `${key}: ${value}`).join('\n') || '—'],
  ];
  document.getElementById('profile-compare-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'profile-compare-overlay';
  overlay.className = 'profile-compare-overlay';
  overlay.innerHTML = `<div class="profile-compare-modal" role="dialog" aria-modal="true"><div class="profile-compare-head"><div><span class="panneau-eyebrow">Comparaison</span><h3>Comparer ${selected.length} profils</h3></div><button type="button" class="btn-fermer" onclick="fermerComparaisonProfils()" aria-label="Fermer">✕</button></div><div class="profile-compare-table-wrap"><table class="profile-compare-table"><thead><tr><th>Champ</th>${selected.map(p => `<th>${escapeHtml(p.nomPrenom || p._id)}</th>`).join('')}</tr></thead><tbody>${fields.map(([label, getter]) => `<tr><th>${escapeHtml(label)}</th>${selected.map(p => `<td>${escapeHtml(getter(p))}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
  overlay.addEventListener('click', event => { if (event.target === overlay) fermerComparaisonProfils(); });
  document.body.appendChild(overlay);
}

function fermerComparaisonProfils() { document.getElementById('profile-compare-overlay')?.remove(); }

// -----------------------------------------------------------------------
// Inventaire : les inventaires des personnages s'affichent directement dans
// la page. Le catalogue d'objets possède désormais sa propre section dédiée.
// -----------------------------------------------------------------------
async function chargerInventairePage() {
  const contenuDiv = document.getElementById('contenu');
  contenuDiv.innerHTML = Array.from({ length: 4 }).map(() => '<div class="squelette"></div>').join('');

  try {
    const [catalogue, inventaires, profils] = await Promise.all([
      apiFetch('/api/inventaire/catalogue/meta').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
      apiFetch('/api/inventaire/resumes').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
      state.cache.profils.length ? Promise.resolve(state.cache.profils) : apiFetch('/api/profils').then(r => r.json()),
    ]);
    state.catalogue = catalogueValide(catalogue);
    state.cache.inventaires = inventaires;
    state.cache.profils = profils;
    majCompteur('inventaire', profils.length);
    renderInventairePage();
    setStatutConnexion(true);
  } catch (error) {
    contenuDiv.innerHTML = `<div class="etat-vide"><div class="etat-vide-icone">⚠️</div><p>Erreur de connexion à l'API</p><span class="etat-vide-sub">${escapeHtml(error.message)}</span></div>`;
    setStatutConnexion(false);
    console.error('Erreur Fetch:', error);
  }
}

function renderInventairePage() {
  const quantiteParProfil = new Map(
    (state.cache.inventaires || []).map(inv => [inv._id, Number.isFinite(Number(inv.total)) ? Number(inv.total) : Object.values(inv.items || {}).reduce((a, b) => a + b, 0)])
  );

  document.getElementById('contenu').innerHTML = `
    <div class="page-intro-card">
      <span class="page-intro-icon">🎒</span>
      <div>
        <strong>Inventaires des personnages</strong>
        <p>Choisis un personnage pour consulter et modifier les objets qu'il possède.</p>
      </div>
    </div>
    <div class="liste-personnages-inventaire">
      ${state.cache.profils.map((p, i) => ligneInventaireHTML(p, quantiteParProfil.get(p._id) || 0, i)).join('') || "<div class='etat-vide'><p>Aucun personnage.</p></div>"}
    </div>
    <div class="aucun-resultat" id="aucun-resultat" hidden>Aucun résultat pour cette recherche.</div>
  `;
}

// -----------------------------------------------------------------------
// Catalogue : page principale indépendante de la page Inventaire.
// -----------------------------------------------------------------------
async function chargerCataloguePage() {
  const contenuDiv = document.getElementById('contenu');
  contenuDiv.innerHTML = Array.from({ length: 4 }).map(() => '<div class="squelette"></div>').join('');

  try {
    const catalogue = await apiFetch('/api/inventaire/catalogue/meta').then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
    state.catalogue = catalogueValide(catalogue);
    majCompteur('catalogue', state.catalogue.length);
    renderCataloguePage();
    setStatutConnexion(true);
  } catch (error) {
    contenuDiv.innerHTML = `<div class="etat-vide"><div class="etat-vide-icone">⚠️</div><p>Erreur de chargement du catalogue</p><span class="etat-vide-sub">${escapeHtml(error.message)}</span></div>`;
    setStatutConnexion(false);
    console.error('Erreur catalogue:', error);
  }
}

function renderCataloguePage() {
  const contenuDiv = document.getElementById('contenu');
  const categories = new Map();
  const currentCategory = getPageFilter('catalogue', 'category', state.catalogueCategorieActive || 'Tout');
  state.catalogueCategorieActive = currentCategory || 'Tout';
  state.catalogue.forEach(item => {
    const category = String(item.category || 'Divers').trim() || 'Divers';
    if (!categories.has(category)) categories.set(category, []);
    categories.get(category).push(item);
  });
  if (state.catalogueCategorieActive !== 'Tout' && !categories.has(state.catalogueCategorieActive)) state.catalogueCategorieActive = 'Tout';

  const sort = getPageFilter('catalogue', 'sort', 'rarity');
  const comparerObjets = (a, b) => {
    const rarityA = RARETE_ORDRE[slugTexte(a.rarity || 'Commun')] ?? 99;
    const rarityB = RARETE_ORDRE[slugTexte(b.rarity || 'Commun')] ?? 99;
    if (sort === 'name-desc') return String(b.name || '').localeCompare(String(a.name || ''), 'fr') || String(a.id).localeCompare(String(b.id));
    if (sort === 'id') return String(a.id || '').localeCompare(String(b.id || ''), 'fr', { numeric: true });
    if (sort === 'name-asc') return String(a.name || '').localeCompare(String(b.name || ''), 'fr') || rarityA - rarityB;
    return rarityA - rarityB || String(a.name || '').localeCompare(String(b.name || ''), 'fr') || String(a.id || '').localeCompare(String(b.id || ''));
  };
  const categoriesTriees = [...categories.entries()].sort(([a], [b]) => a.localeCompare(b, 'fr'));
  categoriesTriees.forEach(([, items]) => items.sort(comparerObjets));
  state.catalogueCategories = categoriesTriees;

  const navigationCategories = [
    `<button type="button" class="catalogue-categorie-chip${state.catalogueCategorieActive === 'Tout' ? ' active' : ''}" data-categorie="__TOUT__" aria-pressed="${state.catalogueCategorieActive === 'Tout'}">Tout</button>`,
    ...categoriesTriees.map(([category]) => `<button type="button" class="catalogue-categorie-chip${state.catalogueCategorieActive === category ? ' active' : ''}" data-categorie="${escapeAttr(category)}" aria-pressed="${state.catalogueCategorieActive === category}">${escapeHtml(category)}</button>`),
  ].join('');
  const slotOptions = [{ value: '', label: 'Tous les emplacements' }, ...(state.listes.equipmentSlots || []).map(slot => ({ value: slot.id, label: slot.label }))];
  const countSelected = state.selectedCatalogIds.size;

  contenuDiv.innerHTML = `
    <div class="catalogue-actions-bar">
      <div class="catalogue-actions-summary"><strong>📦 Catalogue complet</strong><span>${state.catalogue.length} objet${state.catalogue.length > 1 ? 's' : ''} dans ${categories.size} catégorie${categories.size > 1 ? 's' : ''}</span></div>
      <div class="catalogue-actions">
        <button type="button" class="btn-principal" onclick="ouvrirEditeurCatalogue(null)">＋ Ajouter un objet</button>
        ${state.isFounder ? `<button type="button" class="btn-secondaire btn-danger" onclick="supprimerTousLesObjets()" ${state.catalogue.length ? '' : 'disabled'}>🗑️ Tout supprimer</button>` : ''}
      </div>
    </div>
    ${toolbarFiltreHTML('catalogue', [
      selectFiltreHTML('catalogue', 'rarity', 'Rareté', [{ value: '', label: 'Toutes les raretés' }, 'Épique', 'Rare', 'Peu commun', 'Commun']),
      selectFiltreHTML('catalogue', 'slot', 'Emplacement', slotOptions),
      selectFiltreHTML('catalogue', 'usage', 'Utilisabilité', [{ value: '', label: 'Tous les types' }, { value: 'usable', label: 'Utilisables' }, { value: 'not-usable', label: 'Non utilisables' }, { value: 'equipable', label: 'Équipement' }, { value: 'action', label: 'Avec effet à l’utilisation' }]),
      selectFiltreHTML('catalogue', 'sort', 'Trier par', [{ value: 'rarity', label: 'Rareté : épique → commun' }, { value: 'name-asc', label: 'Nom A → Z' }, { value: 'name-desc', label: 'Nom Z → A' }, { value: 'id', label: 'Identifiant' }], 'rarity'),
    ])}
    <div class="catalogue-bulk-toolbar"><div><strong>☑ Sélection en masse</strong><span id="catalogue-selection-count">${countSelected} objet(s) sélectionné(s)</span></div><div class="catalogue-bulk-actions"><button type="button" class="btn-secondaire" onclick="ouvrirEditionMasseCatalogue()" ${countSelected ? '' : 'disabled'}>Modifier la sélection</button><button type="button" class="btn-secondaire btn-danger" onclick="supprimerSelectionCatalogue()" ${countSelected ? '' : 'disabled'}>Supprimer la sélection</button><button type="button" class="btn-secondaire" onclick="viderSelectionCatalogue()" ${countSelected ? '' : 'disabled'}>Désélectionner</button></div></div>
    <div class="catalogue-categories-nav" aria-label="Filtrer par catégorie">${navigationCategories}</div>
    <div id="catalogue-categories-contenu"></div>
    <div class="aucun-resultat" id="aucun-resultat" hidden>Aucun objet ne correspond à cette recherche ou à ces filtres.</div>`;
  contenuDiv.querySelectorAll('.catalogue-categorie-chip').forEach(button => button.addEventListener('click', () => selectionnerCategorieCatalogue(button.dataset.categorie === '__TOUT__' ? 'Tout' : button.dataset.categorie)));
  renderCatalogueCategoriesContent();
  filtrerListe();
}

function renderCatalogueCategoriesContent() {
  const target = document.getElementById('catalogue-categories-contenu');
  if (!target) return;
  const categories = state.catalogueCategories || [];
  const visibleCategories = state.catalogueCategorieActive === 'Tout' ? categories : categories.filter(([category]) => category === state.catalogueCategorieActive);
  if (!visibleCategories.length) {
    target.innerHTML = '<div class="etat-vide"><div class="etat-vide-icone">📦</div><p>Aucun objet dans cette catégorie.</p></div>';
    return;
  }
  target.innerHTML = visibleCategories.map(([category, items]) => {
    const id = `catalogue-categorie-${slugTexte(category)}`;
    return `<section class="catalogue-categorie" data-categorie="${escapeAttr(category)}" id="${escapeAttr(id)}"><div class="catalogue-categorie-header"><div><span class="catalogue-categorie-eyebrow">Catégorie</span><h3>${escapeHtml(category)}</h3></div><span class="catalogue-categorie-count">${items.length} objet${items.length > 1 ? 's' : ''}</span></div><div class="catalogue-grille">${items.map(catalogueItemHTML).join('')}</div></section>`;
  }).join('');
}

function selectionnerCategorieCatalogue(category) {
  state.catalogueCategorieActive = category || 'Tout';
  setPageFilter('catalogue', 'category', state.catalogueCategorieActive);
  document.querySelectorAll('.catalogue-categorie-chip').forEach(button => {
    const active = button.dataset.categorie === (state.catalogueCategorieActive === 'Tout' ? '__TOUT__' : state.catalogueCategorieActive);
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  renderCatalogueCategoriesContent();
  filtrerListe();
}

function toggleCatalogueSelection(id, checked) {
  if (checked) state.selectedCatalogIds.add(String(id)); else state.selectedCatalogIds.delete(String(id));
  const count = document.getElementById('catalogue-selection-count');
  if (count) count.textContent = `${state.selectedCatalogIds.size} objet(s) sélectionné(s)`;
  const toolbar = document.querySelector('.catalogue-bulk-toolbar');
  toolbar?.querySelectorAll('button').forEach(button => { if (!button.textContent.includes('Désélectionner')) button.disabled = !state.selectedCatalogIds.size; else button.disabled = !state.selectedCatalogIds.size; });
}

function viderSelectionCatalogue() {
  state.selectedCatalogIds.clear();
  renderCataloguePage();
}

function ouvrirEditionMasseCatalogue() {
  const ids = [...state.selectedCatalogIds];
  if (!ids.length) return toast('Sélectionne au moins un objet.', 'erreur');
  document.getElementById('overlay-catalogue').classList.add('visible');
  document.getElementById('panneau-catalogue').classList.add('ouvert');
  document.getElementById('panneau-catalogue-titre').textContent = `Modifier ${ids.length} objet(s)`;
  document.getElementById('panneau-catalogue-corps').innerHTML = `
    <div class="section-titre">🧩 Modification en masse</div><p class="section-note">Les champs laissés sur « Ne pas modifier » seront conservés pour chaque objet sélectionné.</p>
    <div class="champ"><label for="f-bulk-rarity">Rareté</label><select id="f-bulk-rarity"><option value="">Ne pas modifier</option><option>Épique</option><option>Rare</option><option>Peu commun</option><option>Commun</option></select></div>
    <div class="champ"><label for="f-bulk-category">Catégorie</label><input id="f-bulk-category" type="text" maxlength="100" placeholder="Laisser vide pour ne pas modifier"></div>
    <div class="champ"><label for="f-bulk-usable">Statut d’utilisation</label><select id="f-bulk-usable"><option value="">Ne pas modifier</option><option value="1">Utilisable depuis Discord</option><option value="0">Non utilisable</option></select></div>
    <div class="actions-panneau"><button type="button" class="btn-principal" id="btn-appliquer-bulk-catalogue" onclick="appliquerEditionMasseCatalogue()">Appliquer aux ${ids.length} objets</button></div>`;
}

async function appliquerEditionMasseCatalogue() {
  const btn = document.getElementById('btn-appliquer-bulk-catalogue');
  if (!btn) return;
  const original = btn.textContent; btn.disabled = true; btn.textContent = 'Application…';
  try {
    const fields = {};
    const rarity = val('f-bulk-rarity');
    const category = val('f-bulk-category');
    const usable = val('f-bulk-usable');
    if (rarity) fields.rarity = rarity;
    if (category.trim()) fields.category = category.trim();
    if (usable !== '') fields.usable = usable === '1';
    if (!Object.keys(fields).length) throw new Error('Choisis au moins un champ à modifier.');
    const result = await fetchJSON('/api/inventaire/catalogue/bulk', { ids: [...state.selectedCatalogIds], fields }, 'PATCH');
    toast(`${result.updated} objet(s) modifié(s).`, 'succes');
    state.selectedCatalogIds.clear();
    fermerCataloguePanel();
    await chargerCataloguePage();
  } catch (error) { toast(`Échec : ${error.message}`, 'erreur'); }
  finally { btn.disabled = false; btn.textContent = original; }
}

async function supprimerSelectionCatalogue() {
  const ids = [...state.selectedCatalogIds];
  if (!ids.length) return;
  try {
    const usageResponse = await apiFetch('/api/inventaire/catalogue/usage');
    if (!usageResponse.ok) throw new Error(`Impossible de vérifier les références (HTTP ${usageResponse.status}).`);
    const usageData = await usageResponse.json();
    const usageById = new Map((usageData.items || []).map(item => [String(item.id), item]));
    const usages = ids.map(id => ({ id, ...(usageById.get(String(id)) || { total: 0 }) }));
    const used = usages.filter(item => Number(item.total) > 0);
    const detail = used.slice(0, 8).map(item => `${item.id}: ${item.inventories?.length || 0} inventaire(s), ${item.crafts?.length || 0} craft(s), ${item.productions?.length || 0} production(s), ${item.boutique ? 'boutique' : 'pas de boutique'}`).join('\n');
    const message = `Supprimer ${ids.length} objet(s) ?${used.length ? `\n\n${used.length} objet(s) sont utilisés. Les références dans les inventaires, crafts, productions, effets d'objets et boutique seront nettoyées. Les recettes devenues invalides seront désactivées.\n\n${detail}${used.length > 8 ? '\n…' : ''}` : ''}`;
    if (!await confirmerAction({ titre: 'Supprimer la sélection', message, texteValider: used.length ? 'Nettoyer et supprimer' : 'Supprimer' })) return;
    const result = await fetchJSON('/api/inventaire/catalogue/bulk', { ids, repairReferences: used.length > 0 }, 'DELETE');
    toast(`${result.deleted} objet(s) supprimé(s).`, 'succes');
    state.selectedCatalogIds.clear();
    await chargerCataloguePage();
  } catch (error) { toast(`Suppression impossible : ${error.message}`, 'erreur'); }
}

// -----------------------------------------------------------------------
// Recettes de craft - administration du panneau Atelier Discord.
// -----------------------------------------------------------------------
async function chargerCraftsPage() {
  const contenuDiv = document.getElementById('contenu');
  contenuDiv.innerHTML = '<div class="squelette"></div><div class="squelette"></div><div class="squelette"></div>';
  try {
    const [craftResponse, catalogueResponse] = await Promise.all([apiFetch('/api/crafts'), apiFetch('/api/inventaire/catalogue/meta')]);
    if (!craftResponse.ok) throw new Error(`HTTP ${craftResponse.status}`);
    if (!catalogueResponse.ok) throw new Error(`HTTP ${catalogueResponse.status}`);
    state.crafts = await craftResponse.json();
    state.crafts = Array.isArray(state.crafts) ? state.crafts : [];
    state.catalogue = catalogueValide(await catalogueResponse.json());
    majCompteur('crafts', state.crafts.length);
    renderCraftsPage();
    setStatutConnexion(true);
  } catch (error) {
    contenuDiv.innerHTML = `<div class="etat-vide"><div class="etat-vide-icone">⚠️</div><p>Erreur de chargement des crafts</p><span class="etat-vide-sub">${escapeHtml(error.message)}</span></div>`;
    setStatutConnexion(false);
    console.error('Erreur crafts:', error);
  }
}

function dureeCraftTexte(value) {
  let minutes = Math.max(0, Math.floor(Number(value) || 0));
  const jours = Math.floor(minutes / 1440); minutes %= 1440;
  const heures = Math.floor(minutes / 60); minutes %= 60;
  const parts = [];
  if (jours) parts.push(`${jours} j`);
  if (heures) parts.push(`${heures} h`);
  if (minutes || !parts.length) parts.push(`${minutes} min`);
  return parts.join(' ');
}

function craftObjetsTexte(rows) {
  return (Array.isArray(rows) ? rows : []).map(row => {
    const item = state.catalogue.find(it => it.id === row.itemId);
    return `<li>${escapeHtml(item?.emoji || '📦')} ${escapeHtml(item?.name || row.itemId)} <span>×${Number(row.quantity) || 1}</span></li>`;
  }).join('');
}

function renderCraftsPage() {
  const sort = getPageFilter('crafts', 'sort', 'name-asc');
  const recipes = state.crafts.slice().sort((a, b) => {
    if (sort === 'duration-asc') return (Number(a.durationMinutes) || 0) - (Number(b.durationMinutes) || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'fr');
    if (sort === 'duration-desc') return (Number(b.durationMinutes) || 0) - (Number(a.durationMinutes) || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'fr');
    if (sort === 'name-desc') return String(b.name || '').localeCompare(String(a.name || ''), 'fr');
    return String(a.name || '').localeCompare(String(b.name || ''), 'fr');
  });
  const cards = recipes.map(craftCardHTML).join('');
  document.getElementById('contenu').innerHTML = `
    <div class="crafts-intro"><div class="crafts-intro-icon">🛠️</div><div><strong>Atelier de fabrication</strong><p>Configure les ingrédients, les objets produits et la durée réelle de chaque recette.</p></div><button class="btn-principal" onclick="ouvrirEditeurCraft(null)">＋ Nouvelle recette</button></div>
    ${toolbarFiltreHTML('crafts', [selectFiltreHTML('crafts', 'enabled', 'Statut', [{ value: '', label: 'Tous les statuts' }, { value: '1', label: 'Actives' }, { value: '0', label: 'Désactivées' }]), selectFiltreHTML('crafts', 'sort', 'Trier par', [{ value: 'name-asc', label: 'Nom A → Z' }, { value: 'name-desc', label: 'Nom Z → A' }, { value: 'duration-asc', label: 'Durée croissante' }, { value: 'duration-desc', label: 'Durée décroissante' }], 'name-asc')])}
    <div class="crafts-grid">${cards || '<div class="etat-vide"><div class="etat-vide-icone">⚙️</div><p>Aucune recette configurée.</p><span class="etat-vide-sub">Crée une recette pour la publier dans le salon Atelier.</span></div>'}</div>
    <div class="aucun-resultat" id="aucun-resultat" hidden>Aucune recette ne correspond à cette recherche ou à ces filtres.</div>`;
  filtrerListe();
}

function craftCardHTML(recipe) {
  const name = recipe.name || 'Recette sans nom';
  const searchable = `${name} ${recipe._id || ''} ${recipe.description || ''}`.toLowerCase();
  return `<article class="craft-card" data-id="${escapeAttr(recipe._id)}" data-nom="${escapeAttr(searchable)}" data-duration="${Number(recipe.durationMinutes) || 0}" data-enabled="${recipe.enabled === false ? '0' : '1'}">
    <div class="craft-card-head"><span class="craft-icon">${escapeHtml(recipe.emoji || '⚙️')}</span><div class="craft-card-title"><h3>${escapeHtml(name)}</h3><p>${escapeHtml(recipe.description || 'Aucune description.')}</p></div><span class="craft-duration">⏱ ${escapeHtml(dureeCraftTexte(recipe.durationMinutes))}</span></div>
    <div class="craft-columns"><div class="craft-items-preview"><strong>📥 Ingrédients nécessaires</strong><ul>${craftObjetsTexte(recipe.requirements) || '<li>-</li>'}</ul></div><div class="craft-items-preview craft-output-preview"><strong>📦 Objets produits</strong><ul>${craftObjetsTexte(recipe.outputs) || '<li>-</li>'}</ul></div></div>
    <div class="craft-card-actions"><button class="btn-secondaire" onclick="ouvrirHistorique('craft','${jsAttr(recipe._id)}','${jsAttr(name)}')">Historique</button><button class="btn-secondaire" onclick="ouvrirEditeurCraft('${jsAttr(recipe._id)}')">Modifier</button><button class="btn-secondaire btn-danger" onclick="supprimerCraft('${jsAttr(recipe._id)}')">Supprimer</button></div></article>`;
}

function optionsCatalogueCraft(selectedId) {
  return '<option value="">Choisir un objet…</option>' + catalogueTrie().map(item =>
    `<option value="${escapeAttr(item.id)}" ${item.id === selectedId ? 'selected' : ''}>${escapeHtml(`${item.emoji || '📦'} ${item.name} - ${item.id}`)}</option>`
  ).join('');
}

function ligneObjetCraftHTML(kind, row = {}) {
  return `<div class="craft-item-row" data-kind="${kind}"><select class="craft-item-select" aria-label="Objet">${optionsCatalogueCraft(row.itemId || '')}</select><input class="craft-item-quantity" type="number" min="1" step="1" value="${Math.max(1, Number(row.quantity) || 1)}" aria-label="Quantité"><button type="button" class="btn-secondaire btn-danger" onclick="supprimerLigneCraft(this)" title="Retirer cet objet">✕</button></div>`;
}

function ouvrirEditeurCraft(recipeId) {
  const recipe = recipeId ? state.crafts.find(item => item._id === recipeId) : null;
  if (recipeId && !recipe) { toast('Recette introuvable.', 'erreur'); return; }
  state.craftActuel = recipe?._id || null;
  document.getElementById('overlay-catalogue').classList.add('visible');
  document.getElementById('panneau-catalogue').classList.add('ouvert');
  document.getElementById('panneau-catalogue-titre').textContent = recipe ? `Modifier - ${recipe.name}` : 'Nouvelle recette de craft';
  const duration = Math.max(1, Number(recipe?.durationMinutes) || 60);
  const requirements = recipe?.requirements?.length ? recipe.requirements : [{ itemId: '', quantity: 1 }];
  const outputs = recipe?.outputs?.length ? recipe.outputs : [{ itemId: '', quantity: 1 }];
  document.getElementById('panneau-catalogue-corps').innerHTML = `
    <div class="section-titre">${recipe ? '✏️ Modifier la recette' : '➕ Créer une recette'}</div>
    <div class="grille-champs"><div class="champ"><label for="f-craft-name">Nom de la recette</label><input id="f-craft-name" type="text" maxlength="100" value="${escapeAttr(recipe?.name || '')}" placeholder="Ex. Fabriquer un blaster"></div><div class="champ"><label for="f-craft-emoji">Emoji</label><input id="f-craft-emoji" type="text" maxlength="8" value="${escapeAttr(recipe?.emoji || '⚙️')}"></div></div>
    <div class="champ"><label for="f-craft-description">Description</label><textarea id="f-craft-description" maxlength="1500" placeholder="Décris le résultat ou le processus.">${escapeHtml(recipe?.description || '')}</textarea></div>
    <div class="section-titre">⏱️ Durée de fabrication réelle</div><p class="section-note">Le compte à rebours utilise le temps réel. Les horaires et la notification utilisent l'heure de France métropolitaine, y compris aux changements d'heure.</p>
    <div class="grille-champs craft-duration-fields"><div class="champ"><label for="f-craft-hours">Heures</label><input id="f-craft-hours" type="number" min="0" max="87600" step="1" value="${Math.floor(duration / 60)}"></div><div class="champ"><label for="f-craft-minutes">Minutes</label><input id="f-craft-minutes" type="number" min="0" max="59" step="1" value="${duration % 60}"></div></div>
    <div class="section-titre">📥 Objets nécessaires</div><p class="section-note">Les ingrédients sont retirés de l'inventaire au démarrage. Ajoute autant de lignes que nécessaire.</p>
    <div id="craft-requirements" class="craft-item-list">${requirements.map(row => ligneObjetCraftHTML('requirements', row)).join('')}</div><button type="button" class="btn-secondaire craft-add-row" onclick="ajouterLigneCraft('requirements')">＋ Ajouter un ingrédient</button>
    <div class="section-titre">📦 Objets donnés à la fin</div><p class="section-note">Tous les objets produits seront ajoutés à l'inventaire du personnage lorsque le délai sera écoulé.</p>
    <div id="craft-outputs" class="craft-item-list">${outputs.map(row => ligneObjetCraftHTML('outputs', row)).join('')}</div><button type="button" class="btn-secondaire craft-add-row" onclick="ajouterLigneCraft('outputs')">＋ Ajouter un objet produit</button>
    <div class="actions-panneau"><button class="btn-principal" id="btn-enregistrer-craft" onclick="sauvegarderCraft()">${recipe ? 'Enregistrer les modifications' : 'Créer la recette'}</button></div>`;
}

function ajouterLigneCraft(kind) {
  if (!['requirements', 'outputs'].includes(kind)) return;
  const target = document.getElementById(kind === 'requirements' ? 'craft-requirements' : 'craft-outputs');
  target?.insertAdjacentHTML('beforeend', ligneObjetCraftHTML(kind, { itemId: '', quantity: 1 }));
}

function supprimerLigneCraft(button) { button.closest('.craft-item-row')?.remove(); }

function collecterObjetsCraft(containerId) {
  return Array.from(document.querySelectorAll(`#${containerId} .craft-item-row`)).map(row => ({
    itemId: row.querySelector('.craft-item-select')?.value || '',
    quantity: Number(row.querySelector('.craft-item-quantity')?.value) || 0,
  })).filter(row => row.itemId && row.quantity > 0);
}

async function sauvegarderCraft() {
  const button = document.getElementById('btn-enregistrer-craft');
  if (!button) return;
  const originalText = button.textContent;
  button.disabled = true; button.textContent = 'Enregistrement…';
  try {
    const durationMinutes = (Number(val('f-craft-hours')) || 0) * 60 + (Number(val('f-craft-minutes')) || 0);
    const payload = { name: val('f-craft-name'), emoji: val('f-craft-emoji'), description: val('f-craft-description'), durationMinutes, requirements: collecterObjetsCraft('craft-requirements'), outputs: collecterObjetsCraft('craft-outputs') };
    if (!payload.name?.trim()) throw new Error('Le nom de la recette est obligatoire.');
    if (durationMinutes < 1) throw new Error('La durée minimale est de 1 minute.');
    if (!payload.requirements.length) throw new Error('Ajoute au moins un ingrédient nécessaire.');
    if (!payload.outputs.length) throw new Error('Ajoute au moins un objet produit.');
    const id = state.craftActuel;
    await fetchJSON(id ? `/api/crafts/${encodeURIComponent(id)}` : '/api/crafts', payload, id ? 'PATCH' : 'POST');
    toast(id ? 'Recette modifiée.' : 'Recette créée.', 'succes');
    fermerCataloguePanel();
    await chargerCraftsPage();
  } catch (error) {
    toast(`Échec de la sauvegarde : ${error.message}`, 'erreur');
    console.error(error);
  } finally { button.disabled = false; button.textContent = originalText; }
}

async function supprimerCraft(recipeId) {
  const recipe = state.crafts.find(item => item._id === recipeId);
  const ok = await confirmerAction({ titre: 'Supprimer la recette', message: `Supprimer « ${recipe?.name || recipeId} » ? Les crafts déjà lancés continueront jusqu'à la fin.`, texteValider: 'Supprimer' });
  if (!ok) return;
  try {
    await fetchJSON(`/api/crafts/${encodeURIComponent(recipeId)}`, null, 'DELETE');
    toast('Recette supprimée.', 'succes');
    await chargerCraftsPage();
  } catch (error) { toast(`Échec de la suppression : ${error.message}`, 'erreur'); }
}

function slugTexte(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'divers';
}

function fermerCataloguePanel() {
  document.getElementById('overlay-catalogue').classList.remove('visible');
  document.getElementById('panneau-catalogue').classList.remove('ouvert');
  state.craftActuel = null;
  state.productionActuelle = null;
  state.personnelTypeActuel = null;
  state.traitActuel = null;
}

async function rafraichirCataloguePanel() {
  const [catalogue, inventaires] = await Promise.all([
    apiFetch('/api/inventaire/catalogue/meta').then(r => r.json()),
    apiFetch('/api/inventaire/resumes').then(r => r.json()),
  ]);
  state.catalogue = catalogueValide(catalogue);
  state.cache.inventaires = inventaires;
  majCompteur('catalogue', state.catalogue.length);
  if (state.collectionActuelle === 'inventaire') renderInventairePage();
  if (state.collectionActuelle === 'catalogue') renderCataloguePage();
}

// Sécurité : ignore les documents internes (id "__xxx__") ou sans nom qu'un
// serveur pas à jour pourrait renvoyer, pour qu'ils n'apparaissent jamais
// comme de faux objets vides dans le catalogue.
// Catalogue trié par ordre alphabétique (nom, puis ID) pour les listes déroulantes.
function catalogueTrie() {
  return state.catalogue.slice().sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), 'fr', { sensitivity: 'base', numeric: true })
    || String(a.id || '').localeCompare(String(b.id || ''), 'fr', { numeric: true }));
}

function catalogueValide(liste) {
  return (liste || []).filter(it => it && it.name && !/^__.*__$/.test(String(it.id || '')));
}

// Une image peut être une data URL, une URL distante ou un chemin du dossier
// /image partagé avec le bot. Les chemins relatifs image/... sont normalisés.
function normaliserImageNavigateur(image) {
  if (typeof image !== 'string' || !image.trim()) return null;
  const value = image.trim();
  if (/^https?:\/\//i.test(value) || /^data:image\//i.test(value)) return value;
  if (/^\/api\/inventaire\/catalogue\/[A-Za-z0-9_-]+\/image$/i.test(value)) return value;
  if (/^\/?image\//i.test(value)) return `/${encodeURI(value.replace(/^\/+/, ''))}`;
  return null;
}

function imageUtilisable(image) {
  return !!normaliserImageNavigateur(image);
}

function itemVisuelHTML(item) {
  const imageSrc = normaliserImageNavigateur(item?.image);
  if (imageSrc) {
    return `<span class="item-emoji"><img class="item-img" src="${escapeAttr(imageSrc)}" alt="" loading="lazy" decoding="async"></span>`;
  }
  return `<span class="item-emoji">${item?.emoji || '❔'}</span>`;
}

function classeRariete(rarity) {
  return `rarity-${slugTexte(rarity || 'Commun')}`;
}

function catalogueItemHTML(item) {
  const labelSlot = item.slot ? (state.listes.equipmentSlots || []).find(slot => slot.id === item.slot)?.label || item.slot : null;
  const rarity = item.rarity || 'Commun';
  const itemId = String(item.id);
  const searchable = `${item.name || ''} ${item.id || ''} ${item.category || ''} ${rarity} ${labelSlot || ''}`.toLowerCase();
  return `<article class="catalogue-item item-row" data-id="${escapeAttr(itemId)}" data-nom="${escapeAttr(searchable)}" data-category="${escapeAttr(item.category || 'Divers')}" data-rarity="${escapeAttr(rarity)}" data-slot="${escapeAttr(item.slot || '')}" data-usable="${item.usable ? '1' : '0'}" data-use-action="${item.useAction ? '1' : '0'}">
    <label class="catalogue-item-select" title="Sélectionner pour modification en masse"><input type="checkbox" ${state.selectedCatalogIds.has(itemId) ? 'checked' : ''} onchange="toggleCatalogueSelection('${jsAttr(itemId)}',this.checked)"><span></span></label>
    <div class="catalogue-item-visual">${itemVisuelHTML(item)}</div>
    <div class="item-corps"><div class="catalogue-item-title-row"><div class="item-nom">${escapeHtml(item.name)}</div><span class="rarity-badge ${classeRariete(rarity)}">✨ ${escapeHtml(rarity)}</span></div><div class="item-description">${escapeHtml(item.description || 'Aucune description.')}</div><div class="item-meta">${labelSlot ? `<span class="badge badge-defaut">🧷 ${escapeHtml(labelSlot)}</span>` : ''}${item.usable ? '<span class="badge badge-defaut">✅ Utilisable</span>' : ''}<span class="badge badge-defaut">ID : ${escapeHtml(item.id)}</span>${Object.entries(item.statBonus || {}).map(([stat, value]) => `<span class="badge badge-defaut">📊 ${value > 0 ? '+' : ''}${value} ${escapeHtml(stat)}</span>`).join('')}</div></div>
    <div class="catalogue-item-actions"><button class="btn-secondaire" onclick="ouvrirHistorique('catalogue','${jsAttr(itemId)}','${jsAttr(item.name)}')">Historique</button><button class="btn-secondaire" onclick="ouvrirEditeurCatalogue('${jsAttr(itemId)}')">Modifier</button><button class="btn-secondaire btn-danger" onclick="supprimerCatalogueItem('${jsAttr(itemId)}')">Supprimer</button></div>
  </article>`;
}

function ligneInventaireHTML(profile, quantiteTotale, index) {
  const delay = `${Math.min(index, 14) * 35}ms`;
  return `
    <div class="ligne ligne-personnage" style="--i:${delay}" data-id="${escapeAttr(profile._id)}" data-nom="${escapeAttr((profile.nomPrenom || profile._id).toLowerCase())}">
      <div class="ligne-sigil">🎒</div>
      <div class="ligne-corps">
        <div class="ligne-nom">${escapeHtml(profile.nomPrenom || profile._id)}</div>
        <div class="ligne-meta">
          <span class="badge badge-defaut">${quantiteTotale} objet${quantiteTotale > 1 ? 's' : ''}</span>
        </div>
      </div>
      <button class="btn-modifier" onclick="ouvrirInventairePersonnage('${jsAttr(profile._id)}')">Voir l'inventaire</button>
    </div>`;
}

function filtrerListe() {
  const recherche = document.getElementById('recherche');
  const q = (recherche?.value || '').trim().toLowerCase();
  if (['profils', 'inventaire', 'catalogue', 'crafts', 'production', 'personnel', 'boutique'].includes(state.collectionActuelle)) {
    setPageFilter(state.collectionActuelle, 'q', q);
  }
  const aucun = document.getElementById('aucun-resultat');
  let visibles = 0;
  const prefs = pagePrefs(state.collectionActuelle || '');

  if (state.collectionActuelle === 'catalogue') {
    const rarity = prefs.rarity || '';
    const slot = prefs.slot || '';
    const usage = prefs.usage || '';
    document.querySelectorAll('.catalogue-item').forEach(item => {
      const section = item.closest('.catalogue-categorie');
      const categoryOk = state.catalogueCategorieActive === 'Tout' || section?.dataset.categorie === state.catalogueCategorieActive;
      const queryOk = !q || (item.dataset.nom || '').includes(q);
      const rarityOk = !rarity || item.dataset.rarity === rarity;
      const slotOk = !slot || item.dataset.slot === slot;
      const usableOk = usage === 'usable' ? item.dataset.usable === '1'
        : usage === 'not-usable' ? item.dataset.usable !== '1'
        : usage === 'equipable' ? Boolean(item.dataset.slot)
        : usage === 'action' ? item.dataset.useAction === '1' : true;
      const matches = categoryOk && queryOk && rarityOk && slotOk && usableOk;
      item.classList.toggle('masquee', !matches);
      if (matches) visibles += 1;
    });
    document.querySelectorAll('.catalogue-categorie').forEach(section => {
      const anyVisible = section.querySelectorAll('.catalogue-item:not(.masquee)').length > 0;
      section.classList.toggle('masquee', !anyVisible);
    });
  } else if (state.collectionActuelle === 'profils') {
    const faction = prefs.faction || '';
    const grade = prefs.grade || '';
    const status = prefs.statut || '';
    const completion = prefs.completude || '';
    document.querySelectorAll('.profil-ligne').forEach(card => {
      const queryOk = !q || (card.dataset.nom || '').includes(q);
      const factionOk = !faction || card.dataset.faction === faction;
      const gradeOk = !grade || card.dataset.grade === grade;
      const statusOk = !status || card.dataset.statut === status;
      const completenessOk = !completion || (completion === 'incomplete' ? card.dataset.incomplet === '1' : card.dataset.incomplet !== '1');
      const matches = queryOk && factionOk && gradeOk && statusOk && completenessOk;
      card.classList.toggle('masquee', !matches);
      if (matches) visibles += 1;
    });
  } else if (state.collectionActuelle === 'crafts' || state.collectionActuelle === 'production') {
    const selector = state.collectionActuelle === 'crafts' ? '.craft-card' : '.production-card';
    const enabled = prefs.enabled || '';
    document.querySelectorAll(selector).forEach(card => {
      const queryOk = !q || (card.dataset.nom || '').includes(q);
      const enabledOk = !enabled || card.dataset.enabled === enabled;
      const matches = queryOk && enabledOk;
      card.classList.toggle('masquee', !matches);
      if (matches) visibles += 1;
    });
  } else if (state.collectionActuelle === 'boutique') {
    const category = prefs.category || '';
    const rarity = prefs.rarity || '';
    const side = prefs.side || '';
    const enabled = prefs.enabled || '';
    document.querySelectorAll('.boutique-tuile').forEach(card => {
      const queryOk = !q || (card.dataset.nom || '').includes(q);
      const categoryOk = !category || card.dataset.category === category;
      const rarityOk = !rarity || card.dataset.rarity === rarity;
      const sideOk = !side || card.dataset.side === side;
      const enabledOk = !enabled || card.dataset.enabled === enabled;
      const matches = queryOk && categoryOk && rarityOk && sideOk && enabledOk;
      card.classList.toggle('masquee', !matches);
      if (matches) visibles += 1;
    });
  } else if (state.collectionActuelle === 'personnel') {
    const production = prefs.production || '';
    const enabled = prefs.enabled || '';
    document.querySelectorAll('.personnel-type-card').forEach(card => {
      const queryOk = !q || (card.dataset.nom || '').includes(q);
      const productionOk = !production || (production === '__GENERAL__' ? card.dataset.hasProduction !== '1' : card.dataset.production === production);
      const enabledOk = !enabled || card.dataset.enabled === enabled;
      const matches = queryOk && productionOk && enabledOk;
      card.classList.toggle('masquee', !matches);
      if (matches) visibles += 1;
    });
  } else if (state.collectionActuelle === 'traits') {
    const typeFilter = state.filtreTraits || 'tous';
    document.querySelectorAll('.trait-card').forEach(card => {
      const queryOk = !q || (card.dataset.nom || '').includes(q);
      const typeOk = typeFilter === 'tous' || card.dataset.traitType === typeFilter;
      const correspond = queryOk && typeOk;
      card.classList.toggle('masquee', !correspond);
      if (correspond) visibles += 1;
    });
  } else if (state.collectionActuelle === 'primes') {
    document.querySelectorAll('.prime-row').forEach(card => {
      const correspond = !q || (card.dataset.nom || '').includes(q);
      card.classList.toggle('masquee', !correspond);
      if (correspond) visibles += 1;
    });
  } else {
    document.querySelectorAll('.contenu .ligne').forEach(card => {
      const matches = !q || (card.dataset.nom || '').includes(q);
      card.classList.toggle('masquee', !matches);
      if (matches) visibles += 1;
    });
  }
  if (aucun) aucun.hidden = visibles !== 0;
}

// -----------------------------------------------------------------------
// Bonus / malus configurables et gestion des primes des personnages.
// -----------------------------------------------------------------------
async function chargerTraitsPage() {
  const contenuDiv = document.getElementById('contenu');
  contenuDiv.innerHTML = '<div class="squelette"></div><div class="squelette"></div><div class="squelette"></div>';
  try {
    const response = await apiFetch('/api/traits');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.traits = await response.json();
    renderTraitsPage();
    setStatutConnexion(true);
  } catch (error) {
    contenuDiv.innerHTML = `<div class="etat-vide"><div class="etat-vide-icone">⚠️</div><p>Erreur de chargement des bonus/malus</p><span class="etat-vide-sub">${escapeHtml(error.message)}</span></div>`;
    setStatutConnexion(false);
  }
}

function pointsTraitTexte(points) {
  const n = Number(points) || 0;
  return `${n > 0 ? '+' : ''}${n} pts`;
}

const TRAIT_CURRENCY_ID = 'credits_de_la_nouvelle_republique';
const TRAIT_ACTION_TYPES = [
  ['moneyAdd', 'Ajouter de l’argent'],
  ['moneyRemove', 'Retirer de l’argent'],
  ['relationAdd', 'Ajouter une relation'],
  ['relationRemove', 'Retirer une relation'],
  ['relationSet', 'Définir un niveau de relation'],
  ['bounty', 'Ajouter une prime'],
  ['debt', 'Ajouter une dette'],
  ['item', 'Ajouter un item'],
  ['randomItem', 'Ajouter un item aléatoire'],
  ['stat', 'Modifier une statistique'],
  ['addiction', 'Ajouter une addiction'],
  ['relationChoice', 'Choix d’une relation de départ'],
];

function resumeEffetsTrait(effects) {
  const e = effects || {};
  const parts = [];
  if (Number(e.credits?.amount)) parts.push(`Argent : ${Number(e.credits.amount) > 0 ? '+' : ''}${Number(e.credits.amount).toLocaleString('fr-FR')} crédits`);
  if (e.bounty) parts.push(`Prime : ${Number(e.bounty.amount) || 0} crédits`);
  for (const item of e.debts || []) parts.push(`Dette : ${Number(item.amount) || 0} crédits (${item.creditor || 'créancier'})`);
  for (const s of e.stats || []) parts.push(`${Number(s.amount) > 0 ? '+' : ''}${s.amount} ${s.stat}`);
  for (const r of e.relations || []) parts.push(`Relation ${r.factionKey}: ${r.mode === 'set' ? '→' : Number(r.value) > 0 ? '+' : ''}${r.value}`);
  for (const i of e.items || []) {
    if (String(i.itemId || '').toLowerCase() === TRAIT_CURRENCY_ID) parts.push(`Argent : +${Number(i.quantity) || 1} crédits`);
    else parts.push(`Objet : ${i.fallbackName || i.itemId} ×${i.quantity || 1}`);
  }
  for (const i of e.randomItems || []) parts.push(`Objet aléatoire : ${i.rarity || 'Peu commun'} ×${i.quantity || 1}`);
  for (const a of e.addictions || []) parts.push(`Addiction : ${a.stat || 'Résistance'} ${a.amount || -10}, tous les ${a.intervalDays || 3} jours`);
  if (e.relationChoice) parts.push('Choix de relation');
  return parts.join(' · ') || 'Aucun effet configuré.';
}

function renderTraitsPage() {
  const contenuDiv = document.getElementById('contenu');
  const filtre = state.filtreTraits || 'tous';
  // Ordre par défaut : bonus (points négatifs) du plus fort au plus faible,
  // puis traits neutres, puis malus (points positifs) du plus élevé au plus faible.
  const traitsTries = [...state.traits].sort((a, b) => {
    const pointsA = Number(a.points) || 0;
    const pointsB = Number(b.points) || 0;
    const groupeA = pointsA < 0 ? 0 : pointsA === 0 ? 1 : 2;
    const groupeB = pointsB < 0 ? 0 : pointsB === 0 ? 1 : 2;
    if (groupeA !== groupeB) return groupeA - groupeB;
    if (groupeA === 0) return pointsA - pointsB || String(a.name || '').localeCompare(String(b.name || ''), 'fr');
    if (groupeA === 2) return pointsB - pointsA || String(a.name || '').localeCompare(String(b.name || ''), 'fr');
    return String(a.name || '').localeCompare(String(b.name || ''), 'fr');
  });
  contenuDiv.innerHTML = `
    <div class="catalogue-actions-bar">
      <div><strong>🎭 Traits de création</strong><span>${state.traits.length} bonus / malus configuré(s) · les points doivent se totaliser à 0</span></div>
      <div class="catalogue-actions"><button class="btn-principal" onclick="ouvrirEditeurTrait(null)">＋ Ajouter un trait</button></div>
    </div>
    <div class="trait-filtres" role="group" aria-label="Filtrer les bonus et malus">
      <button type="button" class="trait-filtre-bouton ${filtre === 'tous' ? 'actif' : ''}" data-filtre-trait="tous" onclick="choisirFiltreTraits('tous')">Tous</button>
      <button type="button" class="trait-filtre-bouton ${filtre === 'bonus' ? 'actif' : ''}" data-filtre-trait="bonus" onclick="choisirFiltreTraits('bonus')">Bonus</button>
      <button type="button" class="trait-filtre-bouton ${filtre === 'malus' ? 'actif' : ''}" data-filtre-trait="malus" onclick="choisirFiltreTraits('malus')">Malus</button>
    </div>
    <div class="trait-grid">
      ${traitsTries.map(trait => {
        const points = Number(trait.points) || 0;
        const type = points > 0 ? 'malus' : points < 0 ? 'bonus' : 'neutre';
        return `
        <article class="trait-card ${trait.enabled === false ? 'trait-inactif' : ''}" data-trait-type="${type}" data-nom="${escapeAttr(`${trait.name} ${trait._id} ${trait.description || ''}`.toLowerCase())}">
          <div class="trait-card-head"><span class="trait-point ${points > 0 ? 'trait-point-malus' : 'trait-point-bonus'}">${escapeHtml(pointsTraitTexte(points))}</span><span class="badge ${trait.enabled === false ? 'badge-sang' : 'badge-vert'}">${trait.enabled === false ? 'Désactivé' : 'Actif'}</span></div>
          <h3>${escapeHtml(trait.name)}</h3>
          <p>${escapeHtml(trait.description || 'Aucune description.')}</p>
          <div class="trait-effets"><strong>Actions configurées</strong><span>${escapeHtml(resumeEffetsTrait(trait.effects))}</span></div>
          <div class="trait-actions"><button class="btn-secondaire" onclick="ouvrirEditeurTrait('${jsAttr(trait._id)}')">Modifier</button><button class="btn-secondaire btn-danger" onclick="supprimerTrait('${jsAttr(trait._id)}')">Supprimer</button></div>
        </article>`;
      }).join('') || '<div class="etat-vide"><p>Aucun trait configuré.</p></div>'}
    </div>
    <div class="aucun-resultat" id="aucun-resultat" hidden>Aucun trait ne correspond à cette recherche ou à ce filtre.</div>
  `;
  filtrerListe();
}

function choisirFiltreTraits(filtre) {
  state.filtreTraits = ['bonus', 'malus'].includes(filtre) ? filtre : 'tous';
  document.querySelectorAll('[data-filtre-trait]').forEach(btn => btn.classList.toggle('actif', btn.dataset.filtreTrait === state.filtreTraits));
  filtrerListe();
}

async function chargerOptionsEditeurTrait() {
  const jobs = [];
  if (!state.listes?.relationFactions?.length) jobs.push(apiFetch('/api/lists').then(async r => { if (!r.ok) throw new Error('Impossible de charger les factions.'); state.listes = await r.json(); }));
  if (!state.catalogue?.length) jobs.push(apiFetch('/api/inventaire/catalogue/meta').then(async r => { if (!r.ok) throw new Error('Impossible de charger les objets du catalogue.'); state.catalogue = catalogueValide(await r.json()); }));
  await Promise.all(jobs);
}

async function ouvrirEditeurTrait(id) {
  try {
    await chargerOptionsEditeurTrait();
    const trait = id ? state.traits.find(t => String(t._id) === String(id)) : null;
    if (id && !trait) { toast('Trait introuvable.', 'erreur'); return; }
    state.traitActuel = trait?._id || null;
    state.traitActionsDraft = trait ? actionsTraitDepuisEffets(trait.effects || {}) : [{ type: 'moneyAdd', amount: '' }];
    document.getElementById('overlay-catalogue').classList.add('visible');
    document.getElementById('panneau-catalogue').classList.add('ouvert');
    document.getElementById('panneau-catalogue-titre').textContent = trait ? trait.name : 'Nouveau bonus / malus';
    document.getElementById('panneau-catalogue-corps').innerHTML = panneauTraitHTML(trait);
  } catch (error) {
    toast(`Impossible d’ouvrir l’éditeur : ${error.message}`, 'erreur');
  }
}

function nomObjetTrait(id) {
  return state.catalogue.find(item => String(item.id) === String(id))?.name || String(id || '');
}

function actionsTraitDepuisEffets(effects) {
  const e = effects || {};
  const actions = [];
  const relations = Array.isArray(e.relations) ? e.relations : [];
  const relationsUtilisees = new Set();
  const debts = Array.isArray(e.debts) ? e.debts : [];

  debts.forEach(debt => {
    let relationIndex = relations.findIndex((r, i) => !relationsUtilisees.has(i) && r.mode !== 'set' && Number(r.value) < 0);
    let factionKey = '';
    let relationPenalty = '';
    if (relationIndex >= 0) {
      const relation = relations[relationIndex];
      relationsUtilisees.add(relationIndex);
      factionKey = relation.factionKey || '';
      relationPenalty = Math.abs(Number(relation.value) || 0);
    } else if (/hutt/i.test(String(debt.creditor || ''))) {
      factionKey = 'CARTEL_HUTTS';
      relationPenalty = 1;
    }
    actions.push({ type: 'debt', amount: Math.max(1, Math.floor(Number(debt.amount) || 1)), creditor: debt.creditor || '', factionKey, relationPenalty });
  });

  const hasCreditEffect = Object.prototype.hasOwnProperty.call(e.credits || {}, 'amount');
  const creditAmount = Number(e.credits?.amount) || 0;
  const debtTotal = debts.reduce((sum, debt) => sum + Math.max(0, Math.floor(Number(debt.amount) || 0)), 0);
  const creditRemainder = debts.length ? (hasCreditEffect ? creditAmount + debtTotal : 0) : creditAmount;
  if (creditRemainder) actions.push({ type: creditRemainder > 0 ? 'moneyAdd' : 'moneyRemove', amount: Math.abs(creditRemainder) });

  for (let i = 0; i < relations.length; i += 1) {
    if (relationsUtilisees.has(i)) continue;
    const r = relations[i] || {};
    if (r.mode === 'set') actions.push({ type: 'relationSet', factionKey: r.factionKey || '', level: Math.max(1, Math.min(5, Number(r.value) || 3)) });
    else actions.push({ type: Number(r.value) < 0 ? 'relationRemove' : 'relationAdd', factionKey: r.factionKey || '', amount: Math.max(1, Math.abs(Number(r.value) || 1)) });
  }

  if (e.bounty) actions.push({ type: 'bounty', amount: Math.max(1, Math.floor(Number(e.bounty.amount) || 1)), description: e.bounty.description || '' });
  for (const row of Array.isArray(e.items) ? e.items : []) {
    if (String(row.itemId || '').toLowerCase() === TRAIT_CURRENCY_ID) {
      actions.push({ type: 'moneyAdd', amount: Math.max(1, Math.floor(Number(row.quantity) || 1)) });
    } else {
      const wanted = String(row.fallbackName || row.itemId || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const matched = state.catalogue.find(item => String(item.id) === String(row.itemId || '')) || state.catalogue.find(item => String(item.name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(wanted));
      actions.push({ type: 'item', itemId: matched?.id || row.itemId || '', fallbackName: row.fallbackName || matched?.name || row.itemId || '', rarity: row.rarity || '', quantity: Math.max(1, Math.floor(Number(row.quantity) || 1)) });
    }
  }
  for (const row of Array.isArray(e.randomItems) ? e.randomItems : []) actions.push({ type: 'randomItem', rarity: row.rarity || 'Peu commun', categoryIncludes: row.categoryIncludes || '', quantity: Math.max(1, Math.floor(Number(row.quantity) || 1)) });
  for (const row of Array.isArray(e.stats) ? e.stats : []) actions.push({ type: 'stat', stat: row.stat || '', amount: Number(row.amount) || 0 });
  for (const row of Array.isArray(e.addictions) ? e.addictions : []) actions.push({ type: 'addiction', itemId: row.itemId || '', itemNameContains: row.itemNameContains || '', stat: row.stat || 'Résistance', amount: Math.min(-1, Number(row.amount) || -10), intervalDays: Math.max(1, Math.floor(Number(row.intervalDays) || 3)) });
  if (e.relationChoice) actions.push({ type: 'relationChoice', prompt: e.relationChoice.prompt || '', options: (e.relationChoice.options || []).map(o => ({ factionKey: o.factionKey, label: o.label, level: Number(o.level) || 3 })), level: Number(e.relationChoice.options?.[0]?.level) || 3 });
  return actions.length ? actions : [{ type: 'moneyAdd', amount: '' }];
}

function optionsFactionTrait(selected = '') {
  return `<option value="">Choisir une faction…</option>${(state.listes.relationFactions || []).map(f => `<option value="${escapeAttr(f.key)}" ${String(selected) === String(f.key) ? 'selected' : ''}>${escapeHtml(f.label || f.key)}</option>`).join('')}`;
}

function optionsObjetTrait(selected = '', { includeCurrency = false, fallbackName = '' } = {}) {
  const items = catalogueTrie().filter(item => includeCurrency || String(item.id).toLowerCase() !== TRAIT_CURRENCY_ID);
  let html = '<option value="">Choisir un item…</option>';
  const found = items.some(item => String(item.id) === String(selected));
  if (selected && !found) html += `<option value="${escapeAttr(selected)}" selected>${escapeHtml(`${fallbackName || nomObjetTrait(selected)} (${selected})`)}</option>`;
  return html + items.map(item => `<option value="${escapeAttr(item.id)}" ${String(selected) === String(item.id) ? 'selected' : ''}>${escapeHtml(`${item.emoji || '📦'} ${item.name} — ${item.id}`)}</option>`).join('');
}

function optionsStatTrait(selected = '') {
  const stats = new Set([...(state.listes.defaultStats || []), ...(selected ? [selected] : [])]);
  return `<option value="">Choisir une statistique…</option>${Array.from(stats).map(stat => `<option value="${escapeAttr(stat)}" ${String(selected) === String(stat) ? 'selected' : ''}>${escapeHtml(stat)}</option>`).join('')}`;
}

function optionsRareteTrait(selected = 'Peu commun') {
  const defaultRarities = ['Commun', 'Peu commun', 'Rare', 'Épique'];
  const rarities = state.listes.itemRarities?.length ? state.listes.itemRarities : defaultRarities;
  const all = [...new Set([...rarities, ...(selected ? [selected] : [])])];
  return all.map(value => `<option value="${escapeAttr(value)}" ${String(selected) === String(value) ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('');
}

function champActionTrait(index, label, key, value, { type = 'text', min, max, step = '1', placeholder = '', required = false, help = '' } = {}) {
  return `<div class="champ"><label for="f-ta-${index}-${key}">${label}</label><input id="f-ta-${index}-${key}" type="${type}" value="${escapeAttr(value ?? '')}" ${min !== undefined ? `min="${min}"` : ''} ${max !== undefined ? `max="${max}"` : ''} step="${step}" ${placeholder ? `placeholder="${escapeAttr(placeholder)}"` : ''} ${required ? 'required' : ''} oninput="majActionTrait(${index}, '${key}', this.value)">${help ? `<p class="section-note">${help}</p>` : ''}</div>`;
}

function champSelectActionTrait(index, label, key, value, options, { help = '' } = {}) {
  return `<div class="champ"><label for="f-ta-${index}-${key}">${label}</label><select id="f-ta-${index}-${key}" onchange="majActionTrait(${index}, '${key}', this.value)">${options}</select>${help ? `<p class="section-note">${help}</p>` : ''}</div>`;
}

function actionTraitParDefaut(type) {
  switch (type) {
    case 'moneyAdd': case 'moneyRemove': return { type, amount: '' };
    case 'relationAdd': case 'relationRemove': return { type, factionKey: '', amount: 1 };
    case 'relationSet': return { type, factionKey: '', level: 3 };
    case 'bounty': return { type, amount: '', description: '' };
    case 'debt': return { type, amount: '', creditor: '', factionKey: '', relationPenalty: 1 };
    case 'item': return { type, itemId: '', quantity: 1 };
    case 'randomItem': return { type, rarity: 'Peu commun', categoryIncludes: '', quantity: 1 };
    case 'stat': return { type, stat: '', amount: '' };
    case 'addiction': return { type, itemId: '', itemNameContains: '', stat: 'Résistance', amount: -10, intervalDays: 3 };
    case 'relationChoice': return { type, prompt: 'Choisis une faction de départ.', options: [], level: 3 };
    default: return { type: 'moneyAdd', amount: '' };
  }
}

function majActionTrait(index, key, value) {
  const action = state.traitActionsDraft?.[index];
  if (!action) return;
  action[key] = value;
  if (key === 'itemId') {
    action.itemNameContains = nomObjetTrait(value);
    if (action.type === 'item') action.rarity = '';
  }
}

function changerTypeActionTrait(index, type) {
  if (!state.traitActionsDraft?.[index]) return;
  state.traitActionsDraft[index] = actionTraitParDefaut(type);
  renderActionTraitEditeur();
}

function ajouterActionTrait() {
  state.traitActionsDraft = state.traitActionsDraft || [];
  state.traitActionsDraft.push({ type: 'moneyAdd', amount: '' });
  renderActionTraitEditeur();
}

function supprimerActionTrait(index) {
  state.traitActionsDraft?.splice(index, 1);
  renderActionTraitEditeur();
}

function majOptionRelationTrait(index, factionKey, checked) {
  const action = state.traitActionsDraft?.[index];
  if (!action) return;
  const options = Array.isArray(action.options) ? action.options : [];
  if (checked && !options.some(o => o.factionKey === factionKey)) {
    const faction = (state.listes.relationFactions || []).find(f => f.key === factionKey);
    options.push({ factionKey, label: faction?.label || factionKey, level: Number(action.level) || 3 });
  } else if (!checked) {
    action.options = options.filter(o => o.factionKey !== factionKey);
  }
  if (checked) action.options = options;
}

function renderActionTraitHTML(action, index) {
  const title = TRAIT_ACTION_TYPES.find(([type]) => type === action.type)?.[1] || 'Action';
  const typesOptions = `<option value="">Choisir une action…</option>${TRAIT_ACTION_TYPES.map(([type, label]) => `<option value="${type}" ${action.type === type ? 'selected' : ''}>${label}</option>`).join('')}`;
  let fields = '';
  if (action.type === 'moneyAdd' || action.type === 'moneyRemove') {
    fields = champActionTrait(index, 'Somme en crédits', 'amount', action.amount, { type: 'number', min: 1, max: 100000000, required: true, placeholder: 'Ex. 1500' });
  } else if (action.type === 'relationAdd' || action.type === 'relationRemove') {
    fields = `<div class="grille-champs">${champSelectActionTrait(index, 'Faction concernée', 'factionKey', action.factionKey, optionsFactionTrait(action.factionKey))}${champActionTrait(index, `Niveaux à ${action.type === 'relationAdd' ? 'ajouter' : 'retirer'}`, 'amount', action.amount, { type: 'number', min: 1, max: 4, required: true })}</div><p class="section-note">Les relations restent comprises entre 1 et 5.</p>`;
  } else if (action.type === 'relationSet') {
    fields = `<div class="grille-champs">${champSelectActionTrait(index, 'Faction concernée', 'factionKey', action.factionKey, optionsFactionTrait(action.factionKey))}${champActionTrait(index, 'Niveau de relation (1 à 5)', 'level', action.level, { type: 'number', min: 1, max: 5, required: true })}</div>`;
  } else if (action.type === 'bounty') {
    fields = `${champActionTrait(index, 'Montant de la prime (crédits)', 'amount', action.amount, { type: 'number', min: 1, max: 100000000, required: true })}${champActionTrait(index, 'Motif de la prime', 'description', action.description || '', { placeholder: 'Ex. Vol de la Nouvelle République' })}<p class="section-note">La prime est publiée dans le forum Discord lorsque la création du personnage est validée.</p>`;
  } else if (action.type === 'debt') {
    fields = `<div class="grille-champs">${champActionTrait(index, 'Montant de la dette (crédits)', 'amount', action.amount, { type: 'number', min: 1, max: 100000000, required: true })}${champActionTrait(index, 'Créancier', 'creditor', action.creditor || '', { required: true, placeholder: 'Ex. Cartel des Hutts' })}</div><div class="grille-champs">${champSelectActionTrait(index, 'Faction dont la relation baisse', 'factionKey', action.factionKey, optionsFactionTrait(action.factionKey))}${champActionTrait(index, 'Niveaux de relation retirés', 'relationPenalty', action.relationPenalty, { type: 'number', min: 1, max: 4, required: true })}</div><p class="section-note">Cette action enregistre la dette, retire son montant des crédits de départ et réduit la relation avec la faction choisie.</p>`;
  } else if (action.type === 'item') {
    fields = `<div class="grille-champs">${champSelectActionTrait(index, 'Item du catalogue', 'itemId', action.itemId, optionsObjetTrait(action.itemId, { fallbackName: action.fallbackName }))}${champActionTrait(index, 'Quantité', 'quantity', action.quantity ?? 1, { type: 'number', min: 1, max: 100000, required: true })}</div>`;
  } else if (action.type === 'randomItem') {
    fields = `<div class="grille-champs">${champSelectActionTrait(index, 'Rareté', 'rarity', action.rarity || 'Peu commun', optionsRareteTrait(action.rarity || 'Peu commun'))}${champActionTrait(index, 'Quantité', 'quantity', action.quantity ?? 1, { type: 'number', min: 1, max: 100, required: true })}</div>${champActionTrait(index, 'Catégorie (facultative)', 'categoryIncludes', action.categoryIncludes || '', { placeholder: 'Ex. équipement' })}<p class="section-note">Le bot choisira au hasard un objet de cette rareté, éventuellement dans la catégorie indiquée.</p>`;
  } else if (action.type === 'stat') {
    fields = `<div class="grille-champs">${champSelectActionTrait(index, 'Statistique', 'stat', action.stat, optionsStatTrait(action.stat))}${champActionTrait(index, 'Valeur ajoutée/retirée', 'amount', action.amount, { type: 'number', min: -100, max: 100, required: true })}</div><p class="section-note">Utilise une valeur positive pour augmenter la statistique et une valeur négative pour la diminuer.</p>`;
  } else if (action.type === 'addiction') {
    fields = `${champSelectActionTrait(index, 'Item à consommer', 'itemId', action.itemId, optionsObjetTrait(action.itemId, { includeCurrency: true }))}<div class="grille-champs">${champSelectActionTrait(index, 'Statistique pénalisée', 'stat', action.stat || 'Résistance', optionsStatTrait(action.stat || 'Résistance'))}${champActionTrait(index, 'Malus (valeur négative)', 'amount', action.amount ?? -10, { type: 'number', min: -100, max: -1, required: true })}</div>${champActionTrait(index, 'Délai maximum sans dose (jours)', 'intervalDays', action.intervalDays ?? 3, { type: 'number', min: 1, max: 365, required: true })}<p class="section-note">Le bot applique le malus si le personnage ne consomme pas l’item avant la fin du délai.</p>`;
  } else if (action.type === 'relationChoice') {
    const selected = new Set((action.options || []).map(o => o.factionKey));
    const factions = (state.listes.relationFactions || []).map(f => `<label class="trait-relation-choice"><input type="checkbox" ${selected.has(f.key) ? 'checked' : ''} onchange="majOptionRelationTrait(${index}, '${jsAttr(f.key)}', this.checked)"><span>${escapeHtml(f.label || f.key)}</span></label>`).join('');
    fields = `${champActionTrait(index, 'Texte affiché au joueur', 'prompt', action.prompt || 'Choisis une faction de départ.', { required: true })}${champActionTrait(index, 'Niveau attribué à la faction choisie (1 à 5)', 'level', action.level ?? 3, { type: 'number', min: 1, max: 5, required: true })}<div class="trait-relation-options"><strong>Factions proposées au joueur</strong>${factions}</div><p class="section-note">Sélectionne au moins deux factions pour proposer un choix au joueur.</p>`;
  }

  return `<div class="trait-action-card"><div class="trait-action-entete"><strong>Action ${index + 1}</strong><button type="button" class="btn-secondaire btn-danger" onclick="supprimerActionTrait(${index})">Supprimer</button></div><div class="champ"><label for="f-ta-${index}-type">Action à appliquer</label><select id="f-ta-${index}-type" onchange="changerTypeActionTrait(${index}, this.value)">${typesOptions}</select></div>${fields}</div>`;
}

function renderActionTraitEditeur() {
  const host = document.getElementById('trait-actions-container');
  if (!host) return;
  host.innerHTML = (state.traitActionsDraft || []).map(renderActionTraitHTML).join('') || '<p class="section-note">Aucune action. Ajoute au moins une action pour définir le bonus/malus.</p>';
}

function panneauTraitHTML(trait) {
  return `
    <div class="section-titre">${trait ? '✏️ Modifier le trait' : '➕ Nouveau trait'}</div>
    <div class="champ"><label for="f-trait-id">Identifiant</label><input type="text" id="f-trait-id" value="${escapeAttr(trait?._id || '')}" placeholder="ex. veteran-des-guerres" ${trait ? 'disabled' : ''} pattern="[A-Za-z0-9_-]+"><p class="section-note">Identifiant stable utilisé par le bot ; il ne peut plus être changé après création.</p></div>
    <div class="champ"><label for="f-trait-name">Nom</label><input type="text" id="f-trait-name" maxlength="100" value="${escapeAttr(trait?.name || '')}" required></div>
    <div class="champ"><label for="f-trait-points">Points du trait (malus positif, bonus négatif)</label><input type="number" id="f-trait-points" min="-100" max="100" step="1" value="${Number(trait?.points) || 0}" required><p class="section-note">Le joueur commence à 0 et doit arriver exactement à 0, ou choisir « Aucun trait ». Un trait positif en points est un malus ; un trait négatif est un bonus.</p></div>
    <div class="champ"><label for="f-trait-description">Description affichée aux joueurs</label><textarea id="f-trait-description" maxlength="1000">${escapeHtml(trait?.description || '')}</textarea></div>
    <div class="section-titre trait-actions-titre">⚙️ Actions et prérequis</div>
    <p class="section-note">Ajoute une ou plusieurs actions. Chaque action affiche les champs requis selon son type. Une dette retire ses crédits de départ et diminue la relation avec la faction choisie.</p>
    <div id="trait-actions-container" class="trait-actions-liste">${(state.traitActionsDraft || []).map(renderActionTraitHTML).join('')}</div>
    <div class="trait-ajouter-action"><button type="button" class="btn-secondaire" onclick="ajouterActionTrait()">＋ Ajouter une action</button></div>
    <div class="champ champ-case"><label class="case-label"><input type="checkbox" id="f-trait-enabled" ${trait?.enabled === false ? '' : 'checked'}> Trait disponible à l’étape 4</label></div>
    <div class="actions-panneau"><button class="btn-principal" id="btn-enregistrer-trait" onclick="sauvegarderTrait()">${trait ? 'Enregistrer les modifications' : 'Créer le trait'}</button></div>
  `;
}

function construireEffetsTrait(actions) {
  if (!Array.isArray(actions) || !actions.length) throw new Error('Ajoute au moins une action au bonus/malus.');
  const effects = {};
  let credits = 0;
  let bountyCount = 0;
  let relationChoiceCount = 0;
  const existingRelations = new Set((state.listes.relationFactions || []).map(f => f.key));
  const existingItems = new Set((state.catalogue || []).map(item => String(item.id)));

  const entierPositif = (value, label, max = 100000000) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`${label} doit être un entier entre 1 et ${max.toLocaleString('fr-FR')}.`);
    return n;
  };

  for (const action of actions) {
    if (!action?.type) throw new Error('Choisis un type pour chaque action.');
    if (action.type === 'moneyAdd' || action.type === 'moneyRemove') {
      const amount = entierPositif(action.amount, 'La somme en crédits');
      credits += action.type === 'moneyAdd' ? amount : -amount;
    } else if (action.type === 'relationAdd' || action.type === 'relationRemove') {
      const factionKey = String(action.factionKey || '');
      if (!existingRelations.has(factionKey)) throw new Error('Choisis une faction pour chaque action de relation.');
      const amount = entierPositif(action.amount, 'Le changement de relation', 4);
      effects.relations = effects.relations || [];
      effects.relations.push({ factionKey, mode: 'add', value: action.type === 'relationAdd' ? amount : -amount });
    } else if (action.type === 'relationSet') {
      const factionKey = String(action.factionKey || '');
      const level = Number(action.level);
      if (!existingRelations.has(factionKey)) throw new Error('Choisis une faction pour définir la relation.');
      if (!Number.isFinite(level) || level < 1 || level > 5) throw new Error('Le niveau de relation doit être compris entre 1 et 5.');
      effects.relations = effects.relations || [];
      effects.relations.push({ factionKey, mode: 'set', value: level });
    } else if (action.type === 'bounty') {
      bountyCount += 1;
      if (bountyCount > 1) throw new Error('Un trait ne peut configurer qu’une seule prime.');
      effects.bounty = { amount: entierPositif(action.amount, 'Le montant de la prime'), description: String(action.description || '').trim().slice(0, 1000) };
    } else if (action.type === 'debt') {
      const amount = entierPositif(action.amount, 'Le montant de la dette');
      const creditor = String(action.creditor || '').trim();
      const factionKey = String(action.factionKey || '');
      const relationPenalty = entierPositif(action.relationPenalty, 'Le malus de relation', 4);
      if (!creditor) throw new Error('Indique le créancier de la dette.');
      if (!existingRelations.has(factionKey)) throw new Error('Choisis la faction dont la relation baissera à cause de la dette.');
      effects.debts = effects.debts || [];
      effects.debts.push({ creditor: creditor.slice(0, 100), amount });
      credits -= amount;
      effects.relations = effects.relations || [];
      effects.relations.push({ factionKey, mode: 'add', value: -relationPenalty });
    } else if (action.type === 'item') {
      let itemId = String(action.itemId || '');
      const fallbackName = String(action.fallbackName || '').trim();
      let item = state.catalogue.find(row => String(row.id) === itemId);
      if (!item && fallbackName) {
        const wanted = fallbackName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        item = state.catalogue.find(row => String(row.name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(wanted));
        if (item) itemId = String(item.id);
      }
      if (!itemId || (!existingItems.has(itemId) && !fallbackName)) throw new Error('Choisis un item existant dans le catalogue.');
      if (itemId.toLowerCase() === TRAIT_CURRENCY_ID) throw new Error('Utilise l’action « Ajouter de l’argent » pour la monnaie.');
      effects.items = effects.items || [];
      effects.items.push({ itemId, fallbackName: item?.name || fallbackName || itemId, ...(action.rarity ? { rarity: action.rarity } : {}), quantity: entierPositif(action.quantity, 'La quantité', 100000) });
    } else if (action.type === 'randomItem') {
      const rarity = String(action.rarity || '').trim();
      if (!rarity) throw new Error('Choisis la rareté de l’item aléatoire.');
      effects.randomItems = effects.randomItems || [];
      effects.randomItems.push({ rarity, categoryIncludes: String(action.categoryIncludes || '').trim(), quantity: entierPositif(action.quantity, 'La quantité', 100) });
    } else if (action.type === 'stat') {
      const stat = String(action.stat || '').trim();
      const amount = Number(action.amount);
      if (!stat) throw new Error('Choisis une statistique.');
      if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 100) throw new Error('La valeur de statistique doit être un entier entre -100 et 100, sauf 0.');
      effects.stats = effects.stats || [];
      effects.stats.push({ stat, amount });
    } else if (action.type === 'addiction') {
      const itemId = String(action.itemId || '').trim();
      const stat = String(action.stat || '').trim();
      const amount = Number(action.amount);
      const intervalDays = entierPositif(action.intervalDays, 'Le délai sans dose', 365);
      if (!itemId) throw new Error('Choisis l’item consommé pour l’addiction.');
      if (!stat) throw new Error('Choisis la statistique pénalisée par l’addiction.');
      if (!Number.isInteger(amount) || amount >= 0 || amount < -100) throw new Error('Le malus d’addiction doit être une valeur négative entre -1 et -100.');
      effects.addictions = effects.addictions || [];
      effects.addictions.push({ itemId, itemNameContains: String(action.itemNameContains || nomObjetTrait(itemId)).slice(0, 100), stat, amount, intervalDays });
    } else if (action.type === 'relationChoice') {
      relationChoiceCount += 1;
      if (relationChoiceCount > 1) throw new Error('Un trait ne peut proposer qu’un seul choix de relation.');
      const selectedOptions = (action.options || []).filter(o => existingRelations.has(String(o.factionKey)));
      if (selectedOptions.length < 2) throw new Error('Sélectionne au moins deux factions pour le choix de relation.');
      const level = Number(action.level);
      if (!Number.isInteger(level) || level < 1 || level > 5) throw new Error('Le niveau choisi doit être compris entre 1 et 5.');
      effects.relationChoice = {
        prompt: String(action.prompt || 'Choisis une faction de départ.').trim().slice(0, 300),
        options: selectedOptions.map(o => ({ factionKey: o.factionKey, label: (state.listes.relationFactions.find(f => f.key === o.factionKey)?.label || o.label || o.factionKey), level })),
      };
    } else {
      throw new Error('Une action sélectionnée n’est pas reconnue.');
    }
  }

  if (credits) effects.credits = { amount: credits };
  return effects;
}

async function sauvegarderTrait() {
  const btn = document.getElementById('btn-enregistrer-trait');
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = 'Enregistrement…';
  try {
    const rawId = state.traitActuel || val('f-trait-id');
    if (!rawId) throw new Error('L’identifiant est obligatoire.');
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(rawId)) throw new Error('L’identifiant doit contenir uniquement des lettres, chiffres, tirets ou tirets bas.');
    const name = String(val('f-trait-name') || '').trim();
    if (!name) throw new Error('Le nom du bonus/malus est obligatoire.');
    const points = Number(val('f-trait-points'));
    if (!Number.isInteger(points) || points === 0 || Math.abs(points) > 100) throw new Error('Les points doivent être un entier entre -100 et 100, différent de 0.');
    const effects = construireEffetsTrait(state.traitActionsDraft || []);
    const payload = { id: rawId, name, points, description: val('f-trait-description'), effects, enabled: document.getElementById('f-trait-enabled').checked };
    if (state.traitActuel) await fetchJSON(`/api/traits/${encodeURIComponent(state.traitActuel)}`, payload, 'PATCH');
    else await fetchJSON('/api/traits', payload, 'POST');
    toast('Bonus / malus enregistré.', 'succes');
    fermerCataloguePanel();
    await chargerTraitsPage();
  } catch (error) { toast(`Échec de l’enregistrement : ${error.message}`, 'erreur'); }
  finally { if (btn.isConnected) { btn.disabled = false; btn.textContent = original; } }
}

async function supprimerTrait(id) {
  const trait = state.traits.find(t => String(t._id) === String(id));
  const ok = await confirmerAction({ titre: 'Supprimer le trait', message: `Supprimer « ${trait?.name || id} » du choix de création ? Les personnages qui l’ont déjà choisi conservent leurs effets enregistrés.`, texteValider: 'Supprimer' });
  if (!ok) return;
  try { await fetchJSON(`/api/traits/${encodeURIComponent(id)}`, null, 'DELETE'); toast('Bonus / malus supprimé.', 'succes'); await chargerTraitsPage(); }
  catch (error) { toast(`Échec : ${error.message}`, 'erreur'); }
}

async function chargerPrimesPage() {
  const contenuDiv = document.getElementById('contenu');
  contenuDiv.innerHTML = '<div class="squelette"></div><div class="squelette"></div><div class="squelette"></div>';
  try {
    const profils = state.cache.profils.length ? state.cache.profils : await apiFetch('/api/profils').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
    state.cache.profils = profils;
    renderPrimesPage();
  } catch (error) {
    contenuDiv.innerHTML = `<div class="etat-vide"><div class="etat-vide-icone">⚠️</div><p>Erreur de chargement des primes</p><span class="etat-vide-sub">${escapeHtml(error.message)}</span></div>`;
  }
}

function renderPrimesPage() {
  const contenuDiv = document.getElementById('contenu');
  const profiles = (state.cache.profils || []).slice().sort((a, b) => String(a.nomPrenom || '').localeCompare(String(b.nomPrenom || ''), 'fr', { sensitivity: 'base' }));
  const activeCount = profiles.filter(p => p.prime?.active && Number(p.prime.amount) > 0).length;
  contenuDiv.innerHTML = `
    <div class="catalogue-actions-bar"><div><strong>🎯 Avis de recherche</strong><span>${activeCount} prime(s) active(s) · publication automatique dans le forum Discord</span></div><button class="btn-secondaire" onclick="chargerPrimesPage()">Actualiser</button></div>
    <div class="liste-personnages-inventaire">
      ${profiles.map(p => {
        const prime = p.prime || {};
        const active = prime.active && Number(prime.amount) > 0;
        return `<div class="ligne prime-row" data-nom="${escapeAttr(`${p.nomPrenom || ''} ${p.surnom || ''} ${p._id}`.toLowerCase())}">
          <div class="ligne-sigil">${active ? '🎯' : '👤'}</div>
          <div class="ligne-corps"><div class="ligne-nom">${escapeHtml(p.nomPrenom || p._id)}${p.surnom && p.surnom !== 'Aucun' ? ` (${escapeHtml(p.surnom)})` : ''}</div>
          <div class="ligne-meta"><span class="badge ${active ? 'badge-sang' : 'badge-defaut'}">${active ? `${Math.floor(Number(prime.amount)).toLocaleString('fr-FR')} crédits` : 'Sans prime'}</span>${prime.description ? `<span class="badge badge-defaut">${escapeHtml(prime.description.slice(0, 80))}</span>` : ''}${active && prime.discordThreadId ? '<span class="badge badge-vert">Forum synchronisé</span>' : active ? '<span class="badge badge-or">Publication en attente</span>' : ''}</div></div>
          <button class="btn-modifier" onclick="ouvrirEditeur('${jsAttr(p._id)}')">${active ? 'Modifier' : 'Ajouter une prime'}</button>
        </div>`;
      }).join('') || "<div class='etat-vide'><p>Aucun personnage trouvé.</p></div>"}
    </div><div class="aucun-resultat" id="aucun-resultat" hidden>Aucun personnage ne correspond à cette recherche.</div>`;
  filtrerListe();
}

// -----------------------------------------------------------------------
// Panel Admin (créateur uniquement) : qui se connecte, combien de fois, et
// journal des actions faites sur le site.
// -----------------------------------------------------------------------
async function chargerAdminPage() {
  const contenuDiv = document.getElementById('contenu');
  contenuDiv.innerHTML = Array.from({ length: 4 }).map(() => '<div class="squelette"></div>').join('');

  try {
    const [connexions, logs, backups] = await Promise.all([
      apiFetch('/api/admin/connexions').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
      apiFetch('/api/admin/logs').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
      apiFetch('/api/admin/backups').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
    ]);

    contenuDiv.innerHTML = `
      <div class="admin-backup-bar">
        <div>
          <strong>💾 Sauvegarde</strong>
          <p>Enregistre les profils, inventaires, catalogue et avatars dans MongoDB pour pouvoir restaurer l'état du site.</p>
        </div>
        <button class="btn-principal admin-backup-btn" onclick="creerBackup()">Créer une sauvegarde</button>
      </div>

      <div class="section-titre">💾 Sauvegardes disponibles (${backups.length})</div>
      <div class="backup-liste">
        ${backups.map(backupLigneHTML).join('') || "<p class='section-note'>Aucune sauvegarde enregistrée.</p>"}
      </div>

      <div class="section-titre">👥 Connexions (${connexions.length})</div>
      <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:34px;">
        ${connexions.map(connexionLigneHTML).join('') || "<div class='etat-vide'><p>Personne ne s'est encore connecté.</p></div>"}
      </div>

      <div class="section-titre">📜 Journal des actions</div>
      <div class="log-liste">
        ${logs.map(logLigneHTML).join('') || "<p class='section-note'>Aucune action enregistrée pour le moment.</p>"}
      </div>
    `;
    setStatutConnexion(true);
  } catch (error) {
    contenuDiv.innerHTML = `<div class="etat-vide"><div class="etat-vide-icone">⚠️</div><p>Erreur de connexion à l'API</p><span class="etat-vide-sub">${escapeHtml(error.message)}</span></div>`;
    setStatutConnexion(false);
    console.error('Erreur Fetch:', error);
  }
}

function connexionLigneHTML(c) {
  return `
    <div class="ligne">
      ${c.avatar ? `<img src="${escapeAttr(c.avatar)}" class="ligne-avatar" alt="">` : '<div class="ligne-sigil">👤</div>'}
      <div class="ligne-corps">
        <div class="ligne-nom">${escapeHtml(c.username || c._id)}</div>
        <div class="ligne-meta">
          <span class="badge badge-defaut">${c.count || 0} connexion${(c.count || 0) > 1 ? 's' : ''}</span>
          <span class="badge badge-defaut">Dernière : ${formatDateLog(c.lastLogin)}</span>
        </div>
      </div>
    </div>`;
}

const LOG_ICONES = {
  login: '🔓',
  logout: '🔒',
  profil_modifie: '✏️',
  objet_cree: '➕',
  objet_modifie: '✏️',
  objet_supprime: '🗑️',
  catalogue_vide: '🧹',
  inventaire_ajout: '📥',
  inventaire_quantite: '🔢',
  inventaire_retrait: '📤',
  backup_created: '💾',
  backup_restored: '↩️',
  craft_cree: '🛠️',
  craft_modifie: '✏️',
  craft_supprime: '🗑️',
  production_creee: '🏭',
  production_modifiee: '✏️',
  production_supprimee: '🗑️',
  personnel_type_cree: '👷',
  personnel_type_modifie: '✏️',
  personnel_type_supprime: '🗑️',
};

function logLigneHTML(entry) {
  const icone = LOG_ICONES[entry.action] || '•';
  const actionBackup = entry.action === 'backup_created' || entry.action === 'backup_restored';
  const boutonRestore = actionBackup && entry.backupId
    ? `<button class="btn-secondaire btn-backup-restore" onclick="restaurerBackup('${jsAttr(entry.backupId)}')">Restaurer</button>`
    : '';
  return `
    <div class="log-entry">
      <span class="log-icone">${icone}</span>
      <div class="log-corps">
        <div class="log-details"><strong>${escapeHtml(entry.username || 'Inconnu')}</strong> ${escapeHtml(entry.details || entry.action)}</div>
        <div class="log-date">${formatDateLog(entry.timestamp)}</div>
      </div>
      ${boutonRestore}
    </div>`;
}

function backupLigneHTML(backup) {
  const collections = Object.entries(backup.collections || {})
    .map(([name, count]) => `${escapeHtml(name)}: ${Number(count) || 0}`)
    .join(' · ');
  return `
    <div class="backup-ligne">
      <div class="backup-icone">💾</div>
      <div class="backup-corps">
        <div class="backup-nom">${escapeHtml(backup.snapshotId || backup._id || 'Sauvegarde')}</div>
        <div class="backup-meta">${formatDateLog(backup.createdAt)} · ${escapeHtml(backup.createdBy?.username || 'Inconnu')}</div>
        <div class="backup-meta">${collections}</div>
      </div>
      <button class="btn-secondaire btn-backup-restore" onclick="restaurerBackup('${jsAttr(backup.snapshotId || backup._id)}')">Restaurer</button>
    </div>`;
}

async function creerBackup() {
  const ok = await confirmerAction({
    titre: 'Créer une sauvegarde',
    message: 'Créer un instantané des profils, inventaires, catalogue et avatars actuels ?',
    texteValider: 'Sauvegarder',
  });
  if (!ok) return;
  try {
    const r = await apiFetch('/api/admin/backups', { method: 'POST' });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    toast('Sauvegarde créée avec succès.', 'succes');
    await chargerAdminPage();
  } catch (error) {
    toast(`Échec de la sauvegarde : ${error.message}`, 'erreur');
  }
}

async function restaurerBackup(backupId) {
  const ok = await confirmerAction({
    titre: 'Restaurer cette sauvegarde ?',
    message: 'Le contenu actuel sera remplacé. Une sauvegarde de sécurité de l’état actuel sera créée automatiquement avant la restauration.',
    texteValider: 'Restaurer',
  });
  if (!ok) return;
  try {
    const r = await apiFetch(`/api/admin/backups/${encodeURIComponent(backupId)}/restore`, { method: 'POST' });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    toast('Sauvegarde restaurée. Une sauvegarde de sécurité a été créée.', 'succes');
    await chargerAdminPage();
  } catch (error) {
    toast(`Échec de la restauration : ${error.message}`, 'erreur');
  }
}

function ouvrirHistorique(entityType, entityId, entityName = '') {
  state.currentHistory = { entityType, entityId: String(entityId), entityName };
  document.getElementById('overlay-catalogue').classList.add('visible');
  document.getElementById('panneau-catalogue').classList.add('ouvert');
  document.getElementById('panneau-catalogue-titre').textContent = `Historique — ${entityName || entityId}`;
  document.getElementById('panneau-catalogue-corps').innerHTML = '<div class="squelette"></div><div class="squelette"></div><div class="squelette"></div>';
  chargerHistorique(entityType, String(entityId));
}

async function chargerHistorique(entityType, entityId) {
  const body = document.getElementById('panneau-catalogue-corps');
  if (!body) return;
  try {
    const response = await apiFetch(`/api/history?type=${encodeURIComponent(entityType)}&id=${encodeURIComponent(entityId)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const entries = await response.json();
    if (state.currentHistory?.entityType !== entityType || state.currentHistory?.entityId !== entityId) return;
    body.innerHTML = `<div class="history-panel-intro"><strong>🕘 Modifications enregistrées</strong><p>Les snapshots permettent de rétablir une version précise sans restaurer toute la base.</p></div>${entries.map(historyCardHTML).join('') || '<div class="etat-vide"><p>Aucune modification historique trouvée.</p></div>'}`;
  } catch (error) {
    body.innerHTML = `<div class="etat-vide"><p>Impossible de charger l’historique.</p><span class="etat-vide-sub">${escapeHtml(error.message)}</span></div>`;
  }
}

function historyCardHTML(entry) {
  const changes = (entry.changes || []).map(change => `<div class="history-change"><strong>${escapeHtml(change.field)}</strong><div class="history-change-values"><span class="history-old">${escapeHtml(change.before || '—')}</span><span class="history-arrow">→</span><span class="history-new">${escapeHtml(change.after || '—')}</span></div></div>`).join('');
  const actor = entry.actor?.username || 'Inconnu';
  const action = String(entry.action || 'modification').replace(/_/g, ' ');
  return `<article class="history-card"><div class="history-card-head"><div><strong>${escapeHtml(actor)}</strong><span class="history-action-label">${escapeHtml(action)}</span></div><time>${escapeHtml(formatDateLog(entry.timestamp))}</time></div><div class="history-diff-list">${changes || '<p class="section-note">Aucun champ affichable dans le détail.</p>'}</div><div class="history-card-actions">${entry.canRestore ? `<button type="button" class="btn-secondaire" onclick="restaurerHistorique('${jsAttr(entry.id)}','${jsAttr(entry.entityType)}','${jsAttr(entry.entityId)}')">↶ Restaurer cette version</button>` : ''}</div></article>`;
}

async function restaurerHistorique(historyId, entityType, entityId) {
  const ok = await confirmerAction({ titre: 'Restaurer cette version', message: 'Cette action rétablit uniquement cet objet, cette recette, cet inventaire ou ce profil à l’état enregistré. L’état actuel sera lui aussi conservé dans l’historique.', texteValider: 'Restaurer cette version' });
  if (!ok) return;
  try {
    await fetchJSON(`/api/history/${encodeURIComponent(historyId)}/restore`, {}, 'POST');
    toast('Version restaurée. L’opération reste visible dans l’historique.', 'succes');
    if (entityType === 'catalogue') {
      await chargerCataloguePage();
    } else if (entityType === 'inventaire') {
      await chargerInventairePage();
      if (state.cache.profils.some(profile => String(profile._id) === String(entityId))) ouvrirInventairePersonnage(String(entityId));
    } else if (entityType === 'profil') {
      await chargerProfils();
    } else if (entityType === 'craft') {
      await chargerCraftsPage();
    } else if (entityType === 'production') {
      await chargerProductionPage();
    } else if (entityType === 'personnel') {
      await chargerPersonnelPage();
    } else if (entityType === 'boutique') {
      await chargerBoutiquePage();
    }
    if (state.currentHistory) await chargerHistorique(state.currentHistory.entityType, state.currentHistory.entityId);
  } catch (error) { toast(`Restauration impossible : ${error.message}`, 'erreur'); }
}

function formatDateLog(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// -----------------------------------------------------------------------
// Panneau d'édition - profil
// -----------------------------------------------------------------------
function ouvrirEditeur(id) {
  const item = state.cache.profils.find(x => x._id === id);
  if (!item) return;

  state.itemActuel = { type: 'profil', id };
  state.pendingPortraitDataUrl = null;
  document.getElementById('panneau-eyebrow').textContent = 'Profil';
  document.getElementById('panneau-titre').textContent = item.nomPrenom || item._id;

  const corps = document.getElementById('panneau-corps');
  corps.innerHTML = panneauProfil(item);
  chargerPortraitActuel(item._id);

  document.getElementById('overlay').classList.add('visible');
  document.getElementById('panneau-edition').classList.add('ouvert');
}

// Le portrait vit derrière l'API protégée : on le récupère via fetch (avec
// l'en-tête d'authentification) puis on le transforme en URL locale, plutôt
// que de le mettre en src="" direct (qui n'enverrait pas l'authentification).
async function chargerPortraitActuel(profileId) {
  const img = document.getElementById('apercu-portrait');
  if (!img) return;
  try {
    const r = await apiFetch(`/api/profils/${encodeURIComponent(profileId)}/avatar`);
    if (!r.ok) throw new Error('pas de portrait');
    const blob = await r.blob();
    img.src = URL.createObjectURL(blob);
    img.closest('.portrait-profil').classList.remove('sans-image');
  } catch {
    img.closest('.portrait-profil').classList.add('sans-image');
  }
}

function fermerPanneau() {
  document.getElementById('overlay').classList.remove('visible');
  document.getElementById('panneau-edition').classList.remove('ouvert');
  fermerCataloguePanel();
  state.itemActuel = null;
}

// ---------- Gabarit du formulaire profil ----------
function panneauProfil(p) {
  const optionsStatut = (state.statuts.length ? state.statuts : ['Vivant', 'Blessé', 'Prisonnier', 'Mort'])
    .map(s => `<option value="${s}" ${p.statut === s ? 'selected' : ''}>${s}</option>`).join('');

  const factions = state.listes.factions || [];
  const factionActuelle = factions.find(f => f.categoryRoleId === p.categoryId) || factions[0] || null;
  const optionsFaction = factions.map(f =>
    `<option value="${escapeAttr(f.key)}" ${factionActuelle && f.key === factionActuelle.key ? 'selected' : ''}>${escapeHtml(f.label)}</option>`
  ).join('');
  const optionsRole = optionsRoleHTML(factionActuelle, p.roleId);

  const relations = p.relations || {};
  const relationsHTML = (state.listes.relationFactions || []).map(f => {
    const niveau = relations[f.key] ?? 3;
    const options = (state.listes.relationLevels || []).map((label, i) => {
      const val = i + 1;
      return `<option value="${val}" ${niveau === val ? 'selected' : ''}>${val} - ${escapeHtml(label)}</option>`;
    }).join('');
    return `<div class="champ"><label for="f-relation-${jsAttr(f.key)}">${escapeHtml(f.label)}</label>
      <select id="f-relation-${escapeAttr(f.key)}" data-relation-key="${escapeAttr(f.key)}">${options}</select></div>`;
  }).join('');

  const stats = p.stats || {};
  const statMax = state.listes.statMax || 10;
  const statsHTML = (state.listes.defaultStats || []).map((label, i) => {
    const val = stats[label] ?? 0;
    return `<div class="champ"><label for="f-stat-${i}">${escapeHtml(label)}</label>
      <input type="number" id="f-stat-${i}" data-stat-key="${escapeAttr(label)}" min="0" max="${statMax}" value="${val}"></div>`;
  }).join('');

  return `
    <div class="portrait-profil sans-image">
      <img id="apercu-portrait" alt="Portrait de ${escapeAttr(p.nomPrenom || '')}">
      <div class="portrait-fallback">🖼️</div>
    </div>
    <div class="champ champ-image">
      <label for="f-portrait">Changer l'image</label>
      <input type="file" id="f-portrait" accept="image/*" onchange="previewPortrait(this)">
    </div>

    <div class="section-titre">🪶 Identité</div>
    <p class="section-note">⚠️ Modifier le rôle/faction ici ne change QUE ce qui est affiché, ça n'attribue pas le rôle Discord réel au joueur (à faire en plus sur Discord si besoin).</p>
    <div class="grille-champs">
      <div class="champ"><label for="f-nomPrenom">Nom</label><input type="text" id="f-nomPrenom" value="${escapeAttr(p.nomPrenom || '')}"></div>
      <div class="champ"><label for="f-surnom">Surnom</label><input type="text" id="f-surnom" value="${escapeAttr(p.surnom || '')}"></div>
      <div class="champ"><label for="f-age">Âge</label><input type="text" id="f-age" value="${escapeAttr(p.age ?? '')}"></div>
      <div class="champ"><label for="f-faceclaim">Faceclaim</label><input type="text" id="f-faceclaim" value="${escapeAttr(p.faceclaim || '')}"></div>
      <div class="champ"><label for="f-faction">Faction</label><select id="f-faction" onchange="onFactionChange()">${optionsFaction}</select></div>
      <div class="champ"><label for="f-roleId">Rôle</label><select id="f-roleId">${optionsRole}</select></div>
    </div>

    <div class="section-titre">✒️ Fiche modifiable</div>
    <div class="grille-champs">
      <div class="champ"><label for="f-statut">Statut</label><select id="f-statut">${optionsStatut}</select></div>
      <div class="champ"><label for="f-renommee">Renommée</label><input type="number" id="f-renommee" value="${p.renommee ?? 0}"></div>
      <div class="champ"><label for="f-gardePersonnelle">Garde personnelle</label><input type="text" id="f-gardePersonnelle" value="${escapeAttr(p.gardePersonnelle || '')}"></div>
      <div class="champ"><label for="f-boursePersonnelle">Bourse personnelle</label><input type="text" id="f-boursePersonnelle" value="${escapeAttr(p.boursePersonnelle || '')}"></div>
    </div>
    <div class="champ"><label for="f-notes">Notes</label><textarea id="f-notes">${escapeHtml(p.notes || '')}</textarea></div>

    <div class="section-titre">🎯 Prime & avis de recherche</div>
    <p class="section-note">Quand une prime est activée, le bot crée ou actualise automatiquement une fiche dans le forum Discord des primes. La fiche utilise le nom, le surnom, la description et la photo du personnage.</p>
    <div class="champ champ-case">
      <label class="case-label"><input type="checkbox" id="f-prime-active" ${(p.prime?.active && Number(p.prime?.amount) > 0) ? 'checked' : ''}> Prime active</label>
    </div>
    <div class="grille-champs">
      <div class="champ"><label for="f-prime-amount">Montant (crédits)</label><input type="number" id="f-prime-amount" min="0" step="1" value="${Math.max(0, Math.floor(Number(p.prime?.amount) || 0))}"></div>
      <div class="champ"><label>État Discord</label><input type="text" value="${p.prime?.active && p.prime?.discordThreadId ? 'Publiée / synchronisée' : p.prime?.active ? 'Publication en attente' : 'Inactive'}" disabled></div>
    </div>
    <div class="champ"><label for="f-prime-description">Description de la prime</label><textarea id="f-prime-description" maxlength="1000" placeholder="Motif de la mise à prix...">${escapeHtml(p.prime?.description || '')}</textarea></div>

    <div class="section-titre">🤝 Relations avec les factions</div>
    <div class="grille-champs">${relationsHTML || '<p class="section-note">Aucune faction configurée.</p>'}</div>

    <div class="section-titre">📊 Stats (sur ${statMax})</div>
    <div class="grille-champs">${statsHTML || '<p class="section-note">Aucune stat configurée.</p>'}</div>

    <div class="actions-panneau">
      <button class="btn-principal" id="btn-enregistrer" onclick="sauvegarder()">Enregistrer les modifications</button>
    </div>`;
}

function optionsRoleHTML(faction, roleIdActuel) {
  if (!faction) return '<option value="">-</option>';
  return faction.grades.map(g =>
    `<option value="${escapeAttr(g.id)}" ${g.id === roleIdActuel ? 'selected' : ''}>${escapeHtml(g.name)}</option>`
  ).join('');
}

// Rechargement du menu "Rôle" quand on change de faction dans l'éditeur.
function onFactionChange() {
  const factionKey = val('f-faction');
  const faction = (state.listes.factions || []).find(f => f.key === factionKey);
  document.getElementById('f-roleId').innerHTML = optionsRoleHTML(faction, null);
}

// Aperçu + mise en mémoire de la nouvelle image choisie (envoyée en base64
// avec le reste du formulaire au moment d'enregistrer, pas avant).
function previewPortrait(input) {
  const fichier = input.files && input.files[0];
  if (!fichier) return;
  const lecteur = new FileReader();
  lecteur.onload = () => {
    state.pendingPortraitDataUrl = lecteur.result;
    const img = document.getElementById('apercu-portrait');
    img.src = lecteur.result;
    img.closest('.portrait-profil').classList.remove('sans-image');
  };
  lecteur.readAsDataURL(fichier);
}

// -----------------------------------------------------------------------
// Panneau d'édition - objet du catalogue (ajout ou modification)
// -----------------------------------------------------------------------
function ouvrirEditeurCatalogue(itemId) {
  const item = itemId ? state.catalogue.find(it => it.id === itemId) : null;
  state.itemActuel = { type: 'catalogue', id: itemId };
  state.pendingItemImage = undefined; // undefined = image inchangée, null = retirée, texte = nouvelle image

  document.getElementById('overlay-catalogue').classList.add('visible');
  document.getElementById('panneau-catalogue').classList.add('ouvert');
  document.getElementById('panneau-catalogue-titre').textContent = item ? item.name : 'Nouvel objet';
  document.getElementById('panneau-catalogue-corps').innerHTML = panneauCatalogueItem(item);
}

function panneauCatalogueItem(item) {
  const isNew = !item;
  const useAction = item?.useAction || null;
  const useType = useAction?.type || 'aucune';
  const rewardOptions = catalogueTrie()
    .filter(it => !item || it.id !== item.id)
    .map(it => `<option value="${escapeAttr(it.id)}" ${(useType === 'donner_objet' && useAction?.itemId === it.id) ? 'selected' : ''}>${escapeHtml(it.emoji || '')} ${escapeHtml(it.name)}</option>`)
    .join('');
  const statOptions = (state.listes.defaultStats || [])
    .map(stat => `<option value="${escapeAttr(stat)}" ${(useType === 'stat' && useAction?.stat === stat) ? 'selected' : ''}>${escapeHtml(stat)}</option>`)
    .join('');

  return `
    <div class="section-titre">${isNew ? '➕ Nouvel objet' : "✏️ Modifier l'objet"}</div>
    <div class="grille-champs">
      <div class="champ"><label for="f-item-id">Identifiant (ID)</label><input type="text" id="f-item-id" value="${escapeAttr(item?.id || '')}" placeholder="ex. casque_rare" pattern="[A-Za-z0-9_-]+"></div>
      <div class="champ"><label for="f-item-name">Nom</label><input type="text" id="f-item-name" value="${escapeAttr(item?.name || '')}"></div>
      <div class="champ"><label for="f-item-emoji">Emoji</label><input type="text" id="f-item-emoji" value="${escapeAttr(item?.emoji || '')}" maxlength="4"></div>
      <div class="champ"><label for="f-item-category">Catégorie</label><input type="text" id="f-item-category" value="${escapeAttr(item?.category || '')}" placeholder="Arme, Équipement, Ressource..."></div>
      <div class="champ"><label for="f-item-rarity">Rareté</label><select id="f-item-rarity">${(state.listes.itemRarities || ['Épique', 'Rare', 'Peu commun', 'Commun']).map(r => `<option value="${escapeAttr(r)}" ${((item?.rarity || 'Commun') === r) ? 'selected' : ''}>${escapeHtml(r)}</option>`).join('')}</select></div>
    </div>
    <div class="champ"><label for="f-item-description">Description</label><textarea id="f-item-description">${escapeHtml(item?.description || '')}</textarea></div>

    <div class="champ">
      <label for="f-item-image">Image de l'objet</label>
      <div class="image-objet-zone">
        <div class="image-objet-apercu" id="apercu-image-objet">${apercuImageObjetHTML(item?.image, item?.emoji)}</div>
        <div class="image-objet-actions">
          <input type="file" id="f-item-image" accept="image/png,image/jpeg,image/webp,image/gif" onchange="choisirImageObjet(this)">
          <button type="button" class="btn-secondaire" id="btn-retirer-image" onclick="retirerImageObjet()" ${imageUtilisable(item?.image) ? '' : 'hidden'}>Retirer l'image</button>
          <p class="section-note">Réduite automatiquement (256 px max). Sans image, l'emoji est utilisé.</p>
        </div>
      </div>
    </div>

    <div class="champ">
      <label for="f-item-slot">Emplacement d'équipement</label>
      <select id="f-item-slot" onchange="onSlotObjetChange()">
        <option value="">Aucun (objet non équipable)</option>
        ${(state.listes.equipmentSlots || []).map(s => `<option value="${escapeAttr(s.id)}" ${item?.slot === s.id ? 'selected' : ''}>${escapeHtml(s.label)}</option>`).join('')}
      </select>
    </div>
    <div class="champ champ-case">
      <label class="case-label">
        <input type="checkbox" id="f-item-usable" ${item?.usable || useType !== 'aucune' ? 'checked' : ''} ${item?.slot ? 'disabled' : ''}>
        Utilisable depuis Discord
      </label>
      <p class="section-note" id="note-usable-slot" ${item?.slot ? '' : 'hidden'}>Coché automatiquement : un objet équipable est toujours utilisable.</p>
    </div>

    <div class="section-titre" style="margin-top:26px">⚡ Utilité lors de l'utilisation</div>
    <p class="section-note">Choisis ce que le bouton « Utiliser » fait pour cet objet. Une utilité personnalisée remplace le comportement d'équipement classique de cet objet.</p>
    <div class="champ">
      <label for="f-item-use-action">Action</label>
      <select id="f-item-use-action" onchange="onItemUseActionChange()">
        <option value="aucune" ${useType === 'aucune' ? 'selected' : ''}>Aucune</option>
        <option value="donner_objet" ${useType === 'donner_objet' ? 'selected' : ''}>Donner un objet</option>
        <option value="message" ${useType === 'message' ? 'selected' : ''}>Envoyer un message dans le salon</option>
        <option value="stat" ${useType === 'stat' ? 'selected' : ''}>Modifier une statistique</option>
      </select>
    </div>

    <div id="use-action-donner" ${useType === 'donner_objet' ? '' : 'hidden'}>
      <div class="grille-champs">
        <div class="champ">
          <label for="f-use-reward-item">Objet donné</label>
          <select id="f-use-reward-item">
            <option value="">Choisir un objet...</option>
            ${rewardOptions}
          </select>
        </div>
        <div class="champ">
          <label for="f-use-reward-qty">Quantité</label>
          <input type="number" id="f-use-reward-qty" min="1" value="${useAction?.quantity || 1}">
        </div>
      </div>
    </div>

    <div id="use-action-message" ${useType === 'message' ? '' : 'hidden'}>
      <div class="champ">
        <label for="f-use-message">Message à envoyer</label>
        <textarea id="f-use-message" maxlength="2000" placeholder="Message exact envoyé dans le salon...">${escapeHtml(useAction?.message || '')}</textarea>
        <p class="section-note">Variables optionnelles : <code>{joueur}</code>, <code>{personnage}</code>, <code>{objet}</code>.</p>
      </div>
    </div>

    <div id="use-action-stat" ${useType === 'stat' ? '' : 'hidden'}>
      <div class="grille-champs">
        <div class="champ">
          <label for="f-use-stat">Statistique</label>
          <select id="f-use-stat">
            ${statOptions}
          </select>
        </div>
        <div class="champ">
          <label for="f-use-amount">Modification</label>
          <input type="number" id="f-use-amount" value="${useAction?.amount || 1}" step="1">
        </div>
      </div>
      <div class="grille-champs">
        <div class="champ">
          <label for="f-use-stat-mode">Durée</label>
          <select id="f-use-stat-mode" onchange="onItemUseStatModeChange()">
            <option value="permanent" ${(useAction?.mode || 'permanent') === 'permanent' ? 'selected' : ''}>Permanent</option>
            <option value="temporaire" ${useAction?.mode === 'temporaire' ? 'selected' : ''}>Temporaire</option>
          </select>
        </div>
        <div class="champ" id="use-stat-duration-wrap" ${useAction?.mode === 'temporaire' ? '' : 'hidden'}>
          <label for="f-use-duration">Durée (minutes)</label>
          <input type="number" id="f-use-duration" min="1" value="${useAction?.durationMinutes || 60}">
        </div>
      </div>
    </div>

    <div class="section-titre" style="margin-top:26px">📊 Bonus de stats (si équipé)</div>
    <p class="section-note">Laisse à 0 les stats que cet objet ne modifie pas. S'applique uniquement quand l'objet est équipé (pas juste possédé).</p>
    <div class="grille-champs" id="bonus-stats-grille">
      ${(state.listes.defaultStats || []).map((stat, i) => `
        <div class="champ">
          <label for="f-bonus-${i}">${escapeHtml(stat)}</label>
          <input type="number" id="f-bonus-${i}" data-bonus-stat="${escapeAttr(stat)}" value="${item?.statBonus?.[stat] || 0}">
        </div>`).join('')}
    </div>

    <div class="actions-panneau">
      <button class="btn-principal" id="btn-enregistrer" onclick="sauvegarderCatalogueItem(${isNew ? 'null' : `'${jsAttr(item.id)}'`})">${isNew ? "Créer l'objet" : 'Enregistrer les modifications'}</button>
    </div>`;
}

function onItemUseActionChange() {
  const type = val('f-item-use-action') || 'aucune';
  const donner = document.getElementById('use-action-donner');
  const message = document.getElementById('use-action-message');
  const stat = document.getElementById('use-action-stat');
  if (donner) donner.hidden = type !== 'donner_objet';
  if (message) message.hidden = type !== 'message';
  if (stat) stat.hidden = type !== 'stat';

  const usable = document.getElementById('f-item-usable');
  if (usable && type !== 'aucune') usable.checked = true;
}

function onItemUseStatModeChange() {
  const mode = val('f-use-stat-mode') || 'permanent';
  const duration = document.getElementById('use-stat-duration-wrap');
  if (duration) duration.hidden = mode !== 'temporaire';
}

function apercuImageObjetHTML(image, emoji) {
  if (imageUtilisable(image)) return `<img src="${escapeAttr(image)}" alt="">`;
  return `<span class="apercu-emoji">${escapeHtml(emoji || '❔')}</span>`;
}

// Réduit l'image choisie (256 px max) et la convertit en data URL : c'est ce
// qui est enregistré en base, donc visible aussi par le bot Discord.
function reduireImageEnDataUrl(file, maxSize = 256) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      let data = canvas.toDataURL('image/png');
      if (data.length > 380 * 1024) data = canvas.toDataURL('image/webp', 0.85);
      resolve(data);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Impossible de lire cette image.')); };
    img.src = url;
  });
}

async function choisirImageObjet(input) {
  const fichier = input.files && input.files[0];
  if (!fichier) return;
  try {
    const data = await reduireImageEnDataUrl(fichier);
    if (data.length > 400 * 1024) throw new Error('Image trop lourde, choisis-en une plus simple.');
    state.pendingItemImage = data;
    document.getElementById('apercu-image-objet').innerHTML = apercuImageObjetHTML(data);
    document.getElementById('btn-retirer-image').hidden = false;
  } catch (error) {
    input.value = '';
    toast(error.message, 'erreur');
  }
}

function retirerImageObjet() {
  state.pendingItemImage = null;
  const input = document.getElementById('f-item-image');
  if (input) input.value = '';
  document.getElementById('apercu-image-objet').innerHTML = apercuImageObjetHTML(null, val('f-item-emoji'));
  document.getElementById('btn-retirer-image').hidden = true;
}

function onSlotObjetChange() {
  const aUnSlot = !!val('f-item-slot');
  const caseUsable = document.getElementById('f-item-usable');
  const note = document.getElementById('note-usable-slot');
  caseUsable.disabled = aUnSlot;
  if (aUnSlot) caseUsable.checked = true;
  note.hidden = !aUnSlot;
}

function construireUtiliteObjet() {
  const type = val('f-item-use-action') || 'aucune';
  if (type === 'aucune') return null;
  if (type === 'donner_objet') {
    return {
      type,
      itemId: val('f-use-reward-item') || '',
      quantity: Number(val('f-use-reward-qty')) || 1,
    };
  }
  if (type === 'message') {
    return {
      type,
      message: val('f-use-message') || '',
    };
  }
  return {
    type: 'stat',
    stat: val('f-use-stat') || '',
    amount: Number(val('f-use-amount')) || 0,
    mode: val('f-use-stat-mode') || 'permanent',
    durationMinutes: Number(val('f-use-duration')) || 60,
  };
}

async function sauvegarderCatalogueItem(itemId) {
  const btn = document.getElementById('btn-enregistrer');
  const texteOriginal = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span>Enregistrement...';

  try {
    const payload = {
      id: val('f-item-id'),
      name: val('f-item-name'),
      emoji: val('f-item-emoji'),
      category: val('f-item-category'),
      rarity: val('f-item-rarity') || 'Commun',
      description: val('f-item-description'),
      slot: val('f-item-slot') || null,
      usable: document.getElementById('f-item-usable').checked || (val('f-item-use-action') || 'aucune') !== 'aucune',
      useAction: construireUtiliteObjet(),
      statBonus: Object.fromEntries(
        Array.from(document.querySelectorAll('[data-bonus-stat]'))
          .map(el => [el.dataset.bonusStat, Number(el.value) || 0])
      ),
    };
    if (state.pendingItemImage !== undefined) payload.image = state.pendingItemImage;
    if (itemId) {
      await fetchJSON(`/api/inventaire/catalogue/${encodeURIComponent(itemId)}`, payload, 'PATCH');
    } else {
      await fetchJSON('/api/inventaire/catalogue', payload, 'POST');
    }
    toast('Objet enregistré avec succès.', 'succes');
    await rafraichirCataloguePanel();
    fermerCataloguePanel();
  } catch (error) {
    toast(`Échec de la sauvegarde : ${error.message}`, 'erreur');
    console.error(error);
  } finally {
    btn.disabled = false;
    btn.textContent = texteOriginal;
  }
}

function texteReferencesObjet(usage) {
  if (!usage || !Number(usage.total)) return 'Aucune référence détectée.';
  const lines = [];
  if (usage.inventories?.length) lines.push(`Inventaires (${usage.inventories.length}) : ${usage.inventories.slice(0, 5).map(row => `${row.profileName} ×${row.quantity || 0}${row.equipmentSlots?.length ? ` [équipé : ${row.equipmentSlots.join(', ')}]` : ''}`).join(', ')}${usage.inventories.length > 5 ? ', …' : ''}`);
  if (usage.crafts?.length) lines.push(`Crafts (${usage.crafts.length}) : ${usage.crafts.slice(0, 5).map(row => row.name).join(', ')}${usage.crafts.length > 5 ? ', …' : ''}`);
  if (usage.productions?.length) lines.push(`Productions (${usage.productions.length}) : ${usage.productions.slice(0, 5).map(row => row.name).join(', ')}${usage.productions.length > 5 ? ', …' : ''}`);
  if (usage.boutique) lines.push(`Boutique : stock ${usage.boutique.stock || 0}`);
  if (usage.itemUseActions?.length) lines.push(`Effets d’objets (${usage.itemUseActions.length}) : ${usage.itemUseActions.slice(0, 5).map(row => row.name).join(', ')}`);
  return lines.join('\n');
}

async function supprimerCatalogueItem(itemId) {
  try {
    const usageResponse = await apiFetch(`/api/inventaire/catalogue/${encodeURIComponent(itemId)}/usage`);
    if (!usageResponse.ok) throw new Error(`Impossible de vérifier les références (HTTP ${usageResponse.status}).`);
    const usage = await usageResponse.json();
    const hasReferences = Number(usage.total) > 0;
    const message = hasReferences
      ? `Supprimer cet objet du catalogue ? Il est encore utilisé :\n\n${texteReferencesObjet(usage)}\n\nSi tu continues, ces références seront nettoyées automatiquement. Les recettes qui n’auront plus d’ingrédients ou de résultats seront désactivées.`
      : 'Supprimer cet objet du catalogue ? Aucune référence active n’a été détectée.';
    const ok = await confirmerAction({ titre: "Supprimer l'objet", message, texteValider: hasReferences ? 'Nettoyer les références et supprimer' : 'Supprimer' });
    if (!ok) return;
    await fetchJSON(`/api/inventaire/catalogue/${encodeURIComponent(itemId)}`, hasReferences ? { repairReferences: true } : null, 'DELETE');
    toast('Objet supprimé du catalogue.', 'succes');
    state.selectedCatalogIds.delete(String(itemId));
    await chargerCataloguePage();
  } catch (error) {
    toast(`Échec de la suppression : ${error.message}`, 'erreur');
  }
}

async function supprimerTousLesObjets() {
  if (!state.catalogue.length || !state.isFounder) return;
  try {
    const usageResponse = await apiFetch('/api/inventaire/catalogue/usage');
    const usageData = usageResponse.ok ? await usageResponse.json() : { items: [] };
    const used = (usageData.items || []).filter(entry => Number(entry.total) > 0);
    const totalReferences = used.reduce((sum, entry) => sum + Number(entry.total || 0), 0);
    const summary = used.slice(0, 8).map(entry => `${entry.name || entry.id} : ${entry.total} référence(s)`).join('\n');
    const message = `Supprimer les ${state.catalogue.length} objets du catalogue ? Cette action est irréversible.\n\n${used.length ? `${used.length} objet(s) sont encore référencés (${totalReferences} références). Les inventaires, recettes, effets d’objets et réglages boutique seront nettoyés ; les recettes invalidées seront désactivées.\n\n${summary}${used.length > 8 ? '\n…' : ''}` : 'Aucune référence active n’a été détectée.'}`;
    const ok = await confirmerAction({ titre: 'Vider le catalogue', message, texteValider: 'Nettoyer et tout supprimer' });
    if (!ok) return;
    await fetchJSON('/api/inventaire/catalogue', { repairReferences: used.length > 0 }, 'DELETE');
    toast('Catalogue vidé.', 'succes');
    state.selectedCatalogIds.clear();
    await chargerCataloguePage();
  } catch (error) { toast(`Échec : ${error.message}`, 'erreur'); }
}

// -----------------------------------------------------------------------
// Panneau d'édition - inventaire d'un personnage
// -----------------------------------------------------------------------
async function ouvrirInventairePersonnage(profileId) {
  const profile = state.cache.profils.find(p => p._id === profileId);
  if (!profile) return;

  state.itemActuel = { type: 'inventaire', id: profileId };
  document.getElementById('panneau-eyebrow').textContent = 'Inventaire';
  document.getElementById('panneau-titre').textContent = profile.nomPrenom || profile._id;
  document.getElementById('panneau-corps').innerHTML = '<div class="squelette"></div><div class="squelette"></div>';
  document.getElementById('overlay').classList.add('visible');
  document.getElementById('panneau-edition').classList.add('ouvert');

  try {
    const response = await apiFetch(`/api/inventaire/${encodeURIComponent(profileId)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const inventoryDoc = await response.json();
    if (state.itemActuel?.type !== 'inventaire' || state.itemActuel.id !== profileId) return;
    const current = state.cache.inventaires || [];
    const summary = current.find(inv => inv._id === profileId);
    state.cache.inventaires = [
      ...current.filter(inv => inv._id !== profileId),
      { ...inventoryDoc, total: summary?.total ?? Object.values(inventoryDoc.items || {}).reduce((a, b) => a + b, 0) },
    ];
    document.getElementById('panneau-corps').innerHTML = panneauInventairePersonnage(profile, inventoryDoc);
  } catch (error) {
    document.getElementById('panneau-corps').innerHTML = `<div class="etat-vide"><p>Impossible de charger cet inventaire.</p><span class="etat-vide-sub">${escapeHtml(error.message)}</span></div>`;
  }
}

function panneauInventairePersonnage(profile, inventoryDoc) {
  const items = inventoryDoc?.items || {};
  const entries = Object.entries(items).sort(([idA], [idB]) => {
    const a = state.catalogue.find(item => item.id === idA) || { id: idA, rarity: 'Commun', name: idA };
    const b = state.catalogue.find(item => item.id === idB) || { id: idB, rarity: 'Commun', name: idB };
    return (RARETE_ORDRE[slugTexte(a.rarity)] ?? 9) - (RARETE_ORDRE[slugTexte(b.rarity)] ?? 9) || String(a.name).localeCompare(String(b.name), 'fr');
  });

  const lignes = entries.map(([itemId, qty]) => {
    const catalogItem = state.catalogue.find(item => item.id === itemId) || { id: itemId, name: itemId, emoji: '❔' };
    return `<div class="item-row inventory-bulk-row" data-item-id="${escapeAttr(itemId)}"><label class="bulk-check-label" title="Sélectionner pour modification groupée"><input class="bulk-existing-check" type="checkbox" data-item-id="${escapeAttr(itemId)}"><span></span></label>${itemVisuelHTML(catalogItem)}<div class="item-corps"><div class="item-nom">${escapeHtml(catalogItem.name)}</div><div class="item-meta"><span class="badge badge-defaut">✨ ${escapeHtml(catalogItem.rarity || 'Commun')}</span><span class="badge badge-defaut">ID : ${escapeHtml(itemId)}</span></div></div><input type="number" min="0" max="1000000" class="qte-input" id="qte-${escapeAttr(itemId)}" value="${Math.max(0, Number(qty) || 0)}"><button class="btn-secondaire" onclick="modifierQuantiteItem('${jsAttr(profile._id)}', '${jsAttr(itemId)}')">OK</button><button class="btn-secondaire btn-danger" onclick="supprimerItemPersonnage('${jsAttr(profile._id)}', '${jsAttr(itemId)}')">✕</button></div>`;
  }).join('');

  const optionsCatalogue = catalogueTrie().map(item => `<option value="${escapeAttr(item.id)}">${escapeHtml(item.emoji || '')} ${escapeHtml(item.name)} — ${escapeHtml(item.id)}</option>`).join('');
  const bulkAddRows = catalogueTrie().map(item => `<label class="inventory-bulk-add-row"><input class="bulk-add-check" type="checkbox" data-item-id="${escapeAttr(item.id)}"><span class="inventory-bulk-add-name">${escapeHtml(item.emoji || '📦')} ${escapeHtml(item.name)} <small>${escapeHtml(item.id)}</small></span><input type="number" class="bulk-add-quantity" data-item-id="${escapeAttr(item.id)}" min="1" max="1000000" value="1" aria-label="Quantité de ${escapeAttr(item.name)}"></label>`).join('');

  return `
    <div class="inventory-panel-heading"><div class="section-titre">🎒 Objets possédés</div><button class="btn-secondaire" onclick="ouvrirHistorique('inventaire','${jsAttr(profile._id)}','Inventaire ${jsAttr(profile.nomPrenom || profile._id)}')">Historique</button></div>
    <div id="inv-items-liste">${lignes || '<p class="section-note">Inventaire vide.</p>'}</div>
    ${entries.length ? `<div class="inventory-bulk-actions"><span>Sélectionne plusieurs objets pour changer leurs quantités.</span><button type="button" class="btn-secondaire" onclick="modifierQuantitesSelectionnees('${jsAttr(profile._id)}')">Enregistrer les quantités sélectionnées</button></div>` : ''}
    <details class="inventory-bulk-add"><summary>＋ Ajouter plusieurs objets en une fois</summary><div class="inventory-bulk-add-list">${bulkAddRows || '<p class="section-note">Catalogue vide.</p>'}</div><button type="button" class="btn-principal" onclick="ajouterPlusieursItemsPersonnage('${jsAttr(profile._id)}')">Ajouter la sélection à l’inventaire</button></details>
    <div class="section-titre" style="margin-top:26px">➕ Ajouter un objet</div>
    <div class="ligne-ajout"><select id="f-ajout-item">${optionsCatalogue || '<option value="">Catalogue vide</option>'}</select><input type="number" id="f-ajout-qte" min="1" max="1000000" value="1" style="flex:0 0 70px"><button class="btn-secondaire" onclick="ajouterItemPersonnage('${jsAttr(profile._id)}')">Ajouter</button></div>`;
}

async function rafraichirInventairePersonnage(profileId) {
  const inventaires = await apiFetch('/api/inventaire/resumes').then(r => r.json());
  state.cache.inventaires = inventaires;
  majBadgeQuantitePersonnage(profileId);
  ouvrirInventairePersonnage(profileId);
}

// Met à jour le badge "X objets" de la ligne du personnage sur la page
// principale, sans recharger toute la liste (le panneau reste ouvert à côté).
function majBadgeQuantitePersonnage(profileId) {
  const ligne = document.querySelector(`.ligne-personnage[data-id="${cssAttrEscape(profileId)}"]`);
  if (!ligne) return;
  const inv = (state.cache.inventaires || []).find(i => i._id === profileId);
  const total = inv ? (Number.isFinite(Number(inv.total)) ? Number(inv.total) : Object.values(inv.items || {}).reduce((a, b) => a + b, 0)) : 0;
  const badge = ligne.querySelector('.badge');
  if (badge) badge.textContent = `${total} objet${total > 1 ? 's' : ''}`;
}

function cssAttrEscape(str) {
  return String(str ?? '').replace(/["\\]/g, '\\$&');
}

async function modifierQuantiteItem(profileId, itemId) {
  const input = document.getElementById(`qte-${itemId}`);
  const quantity = Number(input.value);
  try {
    await fetchJSON(`/api/inventaire/${encodeURIComponent(profileId)}/items/${encodeURIComponent(itemId)}`, { quantity }, 'PATCH');
    toast('Quantité mise à jour.', 'succes');
    await rafraichirInventairePersonnage(profileId);
  } catch (error) {
    toast(`Échec : ${error.message}`, 'erreur');
  }
}

async function supprimerItemPersonnage(profileId, itemId) {
  try {
    await fetchJSON(`/api/inventaire/${encodeURIComponent(profileId)}/items/${encodeURIComponent(itemId)}`, null, 'DELETE');
    toast('Objet retiré.', 'succes');
    await rafraichirInventairePersonnage(profileId);
  } catch (error) {
    toast(`Échec : ${error.message}`, 'erreur');
  }
}

async function ajouterItemPersonnage(profileId) {
  const itemId = val('f-ajout-item');
  const quantity = Number(val('f-ajout-qte')) || 1;
  if (!itemId) { toast('Choisis un objet dans le catalogue.', 'erreur'); return; }
  try {
    await fetchJSON(`/api/inventaire/${encodeURIComponent(profileId)}/items`, { itemId, quantity }, 'POST');
    toast('Objet ajouté.', 'succes');
    await rafraichirInventairePersonnage(profileId);
  } catch (error) {
    toast(`Échec : ${error.message}`, 'erreur');
  }
}

async function modifierQuantitesSelectionnees(profileId) {
  const selected = [...document.querySelectorAll('.bulk-existing-check:checked')];
  const items = selected.map(check => ({ itemId: check.dataset.itemId, quantity: Number(document.getElementById(`qte-${check.dataset.itemId}`)?.value) }));
  if (!items.length) return toast('Sélectionne au moins un objet à modifier.', 'erreur');
  if (items.some(row => !Number.isFinite(row.quantity) || row.quantity < 0 || row.quantity > 1000000)) return toast('Toutes les quantités doivent être comprises entre 0 et 1 000 000.', 'erreur');
  try {
    await fetchJSON(`/api/inventaire/${encodeURIComponent(profileId)}/items/bulk`, { items }, 'PATCH');
    toast(`${items.length} quantité(s) mise(s) à jour.`, 'succes');
    await rafraichirInventairePersonnage(profileId);
  } catch (error) { toast(`Échec : ${error.message}`, 'erreur'); }
}

async function ajouterPlusieursItemsPersonnage(profileId) {
  const selected = [...document.querySelectorAll('.bulk-add-check:checked')];
  const items = selected.map(check => ({ itemId: check.dataset.itemId, quantity: Number(document.querySelector(`.bulk-add-quantity[data-item-id="${cssAttrEscape(check.dataset.itemId)}"]`)?.value) }));
  if (!items.length) return toast('Sélectionne au moins un objet à ajouter.', 'erreur');
  if (items.some(row => !Number.isFinite(row.quantity) || row.quantity < 1 || row.quantity > 1000000)) return toast('Toutes les quantités doivent être comprises entre 1 et 1 000 000.', 'erreur');
  try {
    await fetchJSON(`/api/inventaire/${encodeURIComponent(profileId)}/items/bulk`, { items }, 'POST');
    toast(`${items.length} type(s) d’objet(s) ajouté(s).`, 'succes');
    await rafraichirInventairePersonnage(profileId);
  } catch (error) { toast(`Échec : ${error.message}`, 'erreur'); }
}

// -----------------------------------------------------------------------
// Sauvegarde - profil
// -----------------------------------------------------------------------
function val(id) { const el = document.getElementById(id); return el ? el.value : undefined; }

async function sauvegarder() {
  if (!state.itemActuel) return;
  const { id } = state.itemActuel;
  const btn = document.getElementById('btn-enregistrer');
  const texteOriginal = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span>Enregistrement...';

  try {
    const relations = {};
    document.querySelectorAll('[data-relation-key]').forEach(el => { relations[el.dataset.relationKey] = el.value; });

    const stats = {};
    document.querySelectorAll('[data-stat-key]').forEach(el => { stats[el.dataset.statKey] = el.value; });

    await fetchJSON(`/api/profils/${encodeURIComponent(id)}`, {
      nomPrenom: val('f-nomPrenom'),
      surnom: val('f-surnom'),
      age: val('f-age'),
      faceclaim: val('f-faceclaim'),
      roleId: val('f-roleId'),
      statut: val('f-statut'),
      renommee: val('f-renommee'),
      gardePersonnelle: val('f-gardePersonnelle'),
      boursePersonnelle: val('f-boursePersonnelle'),
      notes: val('f-notes'),
      prime: {
        active: document.getElementById('f-prime-active')?.checked === true,
        amount: Math.max(0, Math.floor(Number(val('f-prime-amount')) || 0)),
        description: val('f-prime-description') || '',
      },
      relations,
      stats,
      portraitDataUrl: state.pendingPortraitDataUrl || undefined,
    }, 'PATCH');

    state.pendingPortraitDataUrl = null;
    toast('Modifications enregistrées avec succès.', 'succes');
    await rafraichirEtRouvrir();
  } catch (error) {
    toast(`Échec de la sauvegarde : ${error.message}`, 'erreur');
    console.error(error);
  } finally {
    btn.disabled = false;
    btn.textContent = texteOriginal;
  }
}

async function rafraichirEtRouvrir() {
  const { id } = state.itemActuel;
  const sectionAvant = state.collectionActuelle;
  await chargerProfils();
  if (sectionAvant === 'primes') renderPrimesPage();
  else filtrerListe();
  ouvrirEditeur(id);
}

async function fetchJSON(url, body, method = 'PATCH') {
  // Pas de corps du tout pour les suppressions (body === null) : envoyer le
  // texte "null" avec Content-Type: application/json fait échouer le
  // parseur JSON d'Express (mode strict, qui n'accepte que { ou [ en
  // premier caractère) avec une page d'erreur HTML brute, pas les 404/400
  // JSON propres attendus par le code plus bas.
  const options = { method };
  if (body !== null && body !== undefined) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body);
  }
  const response = await apiFetch(url, options);
  if (!response.ok) {
    const texte = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} ${texte}`.trim());
  }
  return response.json();
}

// -----------------------------------------------------------------------
// Production & personnel automatique - administrés depuis le site.
// La durée de chaque production et de chaque métier est configurable ; les
// besoins et les sorties sont multipliés par la quantité lancée côté bot.
// -----------------------------------------------------------------------
async function chargerProductionPage() {
  await chargerDefinitionsProduction('production');
}

async function chargerPersonnelPage() {
  await chargerDefinitionsProduction('personnel');
}

async function chargerDefinitionsProduction(section) {
  const contenuDiv = document.getElementById('contenu');
  contenuDiv.innerHTML = '<div class="squelette"></div><div class="squelette"></div><div class="squelette"></div>';
  try {
    const [productionResponse, personnelResponse, catalogueResponse] = await Promise.all([
      apiFetch('/api/productions'),
      apiFetch('/api/personnel-types'),
      apiFetch('/api/inventaire/catalogue/meta'),
    ]);
    for (const response of [productionResponse, personnelResponse, catalogueResponse]) {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    }
    state.productions = await productionResponse.json();
    state.personnelTypes = await personnelResponse.json();
    state.catalogue = catalogueValide(await catalogueResponse.json());
    state.productions = Array.isArray(state.productions) ? state.productions : [];
    state.personnelTypes = Array.isArray(state.personnelTypes) ? state.personnelTypes : [];
    majCompteur('production', state.productions.length);
    majCompteur('personnel', state.personnelTypes.length);
    if (section === 'personnel') renderPersonnelPage();
    else renderProductionPage();
    setStatutConnexion(true);
  } catch (error) {
    contenuDiv.innerHTML = `<div class="etat-vide"><div class="etat-vide-icone">⚠️</div><p>Erreur de chargement</p><span class="etat-vide-sub">${escapeHtml(error.message)}</span></div>`;
    setStatutConnexion(false);
    console.error('Erreur chargement production/personnel:', error);
  }
}

function formaterDureeProduction(minutesValue) {
  let minutes = Math.max(1, Math.floor(Number(minutesValue) || 30));
  const days = Math.floor(minutes / 1440);
  minutes %= 1440;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const parts = [];
  if (days) parts.push(`${days} j`);
  if (hours) parts.push(`${hours} h`);
  if (mins) parts.push(`${mins} min`);
  return parts.join(' ') || '1 min';
}

function objetsProductionHTML(rows) {
  const values = Array.isArray(rows) ? rows : [];
  if (!values.length) return '<li>-</li>';
  return values.map(row => {
    const item = state.catalogue.find(entry => entry.id === row.itemId);
    return `<li>${escapeHtml(item?.emoji || '📦')} ${escapeHtml(item?.name || row.itemId)} <span>×${Number(row.quantity) || 1}</span></li>`;
  }).join('');
}

function productionCardHTML(recipe) {
  const duration = formaterDureeProduction(recipe.minutesPerUnit || 30);
  const searchable = `${recipe.name || ''} ${recipe._id || ''} ${recipe.description || ''}`.toLowerCase();
  return `<article class="production-card" data-id="${escapeAttr(recipe._id)}" data-nom="${escapeAttr(searchable)}" data-duration="${Number(recipe.minutesPerUnit) || 30}" data-enabled="${recipe.enabled === false ? '0' : '1'}">
    <div class="production-card-head"><span class="production-icon">${escapeHtml(recipe.emoji || '🏭')}</span><div class="production-card-title"><h3>${escapeHtml(recipe.name || 'Production sans nom')}</h3><p>${escapeHtml(recipe.description || 'Aucune description.')}</p></div><span class="production-time">⏱ ${escapeHtml(duration)} / unité</span></div>
    <div class="production-columns"><div class="production-preview"><strong>📥 Nécessaire par unité</strong><ul>${objetsProductionHTML(recipe.requirements)}</ul></div><div class="production-preview"><strong>📦 Produit par unité</strong><ul>${objetsProductionHTML(recipe.outputs)}</ul></div></div>
    <div class="production-actions"><button class="btn-secondaire" onclick="ouvrirHistorique('production','${jsAttr(recipe._id)}','${jsAttr(recipe.name || 'Production')}')">Historique</button><button class="btn-secondaire" onclick="ouvrirEditeurProduction('${jsAttr(recipe._id)}')">Modifier</button><button class="btn-secondaire btn-danger" onclick="supprimerProduction('${jsAttr(recipe._id)}')">Supprimer</button></div>
  </article>`;
}

function personnelTypeCardHTML(type) {
  const production = state.productions.find(item => String(item._id) === String(type.productionRecipeId || ''));
  const affectation = production
    ? `<strong>${escapeHtml(production.emoji || '🏭')} ${escapeHtml(production.name)}</strong><p class="personnel-role-general">Ce métier travaillera automatiquement sur cette production.</p>`
    : '<strong>Aucune production automatique</strong><p class="personnel-role-general">Métier général : il peut être recruté sans lancer de cycle de production.</p>';
  const cols = `<div class="production-preview"><strong>🪙 Coût de recrutement</strong><ul>${type.purchaseCost?.length ? objetsProductionHTML(type.purchaseCost) : '<li>Gratuit</li>'}</ul></div><div class="production-preview"><strong>🌙 Entretien quotidien à 00 h (Paris)</strong><ul>${objetsProductionHTML(type.dailyUpkeep)}</ul></div><div class="production-preview"><strong>🏭 Production associée par le staff</strong>${affectation}</div>`;
  const searchable = `${type.name || ''} ${type._id || ''} ${type.description || ''} ${production?.name || ''}`.toLowerCase();
  return `<article class="personnel-type-card" data-id="${escapeAttr(type._id)}" data-nom="${escapeAttr(searchable)}" data-production="${escapeAttr(type.productionRecipeId || '')}" data-has-production="${production ? '1' : '0'}" data-enabled="${type.enabled === false ? '0' : '1'}" data-cost="${(type.purchaseCost || []).reduce((sum, row) => sum + (Number(row.quantity) || 0), 0)}">
    <div class="production-card-head"><span class="production-icon">${escapeHtml(type.emoji || '👷')}</span><div class="production-card-title"><h3>${escapeHtml(type.name || 'Personnel')}</h3><p>${escapeHtml(type.description || 'Aucune description.')}</p></div><span class="production-time">${production ? `🏭 ${escapeHtml(production.name)}` : 'Métier général'}</span></div>
    <div class="production-columns production-columns-three">${cols}</div>
    <div class="production-actions"><button class="btn-secondaire" onclick="ouvrirHistorique('personnel','${jsAttr(type._id)}','${jsAttr(type.name || 'Personnel')}')">Historique</button><button class="btn-secondaire" onclick="ouvrirEditeurPersonnelType('${jsAttr(type._id)}')">Modifier</button><button class="btn-secondaire btn-danger" onclick="supprimerPersonnelType('${jsAttr(type._id)}')">Supprimer</button></div>
  </article>`;
}

function renderProductionPage() {
  const sort = getPageFilter('production', 'sort', 'name-asc');
  const productions = state.productions.slice().sort((a, b) => {
    if (sort === 'duration-asc') return (Number(a.minutesPerUnit) || 0) - (Number(b.minutesPerUnit) || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'fr');
    if (sort === 'duration-desc') return (Number(b.minutesPerUnit) || 0) - (Number(a.minutesPerUnit) || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'fr');
    if (sort === 'name-desc') return String(b.name || '').localeCompare(String(a.name || ''), 'fr');
    return String(a.name || '').localeCompare(String(b.name || ''), 'fr');
  });
  document.getElementById('contenu').innerHTML = `
    <div class="production-intro"><div class="production-intro-icon">🏭</div><div><strong>Production</strong><p>Les joueurs choisissent une recette et une quantité dans le salon Discord dédié. Chaque recette possède sa propre durée configurable.</p></div></div>
    <div class="production-section-heading"><div><h3>🏭 Productions disponibles</h3><p>Configure les ingrédients, les résultats et le temps nécessaire par unité.</p></div><button class="btn-principal" onclick="ouvrirEditeurProduction(null)">＋ Nouvelle production</button></div>
    ${toolbarFiltreHTML('production', [selectFiltreHTML('production', 'enabled', 'Statut', [{ value: '', label: 'Tous les statuts' }, { value: '1', label: 'Actives' }, { value: '0', label: 'Désactivées' }]), selectFiltreHTML('production', 'sort', 'Trier par', [{ value: 'name-asc', label: 'Nom A → Z' }, { value: 'name-desc', label: 'Nom Z → A' }, { value: 'duration-asc', label: 'Durée croissante' }, { value: 'duration-desc', label: 'Durée décroissante' }], 'name-asc')])}
    <div class="production-grid">${productions.map(productionCardHTML).join('') || '<div class="etat-vide"><p>Aucune production configurée.</p><span class="etat-vide-sub">Crée une production à proposer aux joueurs.</span></div>'}</div><div class="aucun-resultat" id="aucun-resultat" hidden>Aucun résultat pour cette recherche ou ces filtres.</div>`;
  filtrerListe();
}

function renderPersonnelPage() {
  const sort = getPageFilter('personnel', 'sort', 'name-asc');
  const types = state.personnelTypes.slice().sort((a, b) => {
    if (sort === 'cost-asc') return (a.purchaseCost || []).reduce((sum, row) => sum + Number(row.quantity || 0), 0) - (b.purchaseCost || []).reduce((sum, row) => sum + Number(row.quantity || 0), 0) || String(a.name || '').localeCompare(String(b.name || ''), 'fr');
    if (sort === 'cost-desc') return (b.purchaseCost || []).reduce((sum, row) => sum + Number(row.quantity || 0), 0) - (a.purchaseCost || []).reduce((sum, row) => sum + Number(row.quantity || 0), 0) || String(a.name || '').localeCompare(String(b.name || ''), 'fr');
    if (sort === 'name-desc') return String(b.name || '').localeCompare(String(a.name || ''), 'fr');
    return String(a.name || '').localeCompare(String(b.name || ''), 'fr');
  });
  const productionOptions = [{ value: '', label: 'Tous les métiers' }, { value: '__GENERAL__', label: 'Métier général' }, ...state.productions.map(row => ({ value: String(row._id), label: row.name || row._id }))];
  document.getElementById('contenu').innerHTML = `
    <div class="production-intro"><div class="production-intro-icon">👥</div><div><strong>Personnel & métiers</strong><p>Configure les métiers achetables, leurs coûts, leurs tâches et leur entretien quotidien.</p></div></div>
    <div class="production-section-heading"><div><h3>👷 Personnel achetable</h3><p>Chaque métier peut être associé à une production sur le site.</p></div><button class="btn-principal" onclick="ouvrirEditeurPersonnelType(null)">＋ Nouveau type de personnel</button></div>
    ${toolbarFiltreHTML('personnel', [selectFiltreHTML('personnel', 'production', 'Affectation', productionOptions), selectFiltreHTML('personnel', 'enabled', 'Statut', [{ value: '', label: 'Tous les statuts' }, { value: '1', label: 'Actifs' }, { value: '0', label: 'Désactivés' }]), selectFiltreHTML('personnel', 'sort', 'Trier par', [{ value: 'name-asc', label: 'Nom A → Z' }, { value: 'name-desc', label: 'Nom Z → A' }, { value: 'cost-asc', label: 'Coût de recrutement croissant' }, { value: 'cost-desc', label: 'Coût de recrutement décroissant' }], 'name-asc')])}
    <div class="personnel-types-grid">${types.map(personnelTypeCardHTML).join('') || '<div class="etat-vide"><p>Aucun personnel configuré.</p><span class="etat-vide-sub">Crée un type de personnel pour le rendre achetable dans Discord.</span></div>'}</div><div class="aucun-resultat" id="aucun-resultat" hidden>Aucun résultat pour cette recherche ou ces filtres.</div>`;
  filtrerListe();
}

function optionsCatalogueProduction(selectedId) {
  return '<option value="">Choisir un objet…</option>' + catalogueTrie().map(item =>
    `<option value="${escapeAttr(item.id)}" ${item.id === selectedId ? 'selected' : ''}>${escapeHtml(`${item.emoji || '📦'} ${item.name} - ${item.id}`)}</option>`
  ).join('');
}

function ligneObjetProductionHTML(kind, row = {}) {
  return `<div class="production-item-row" data-kind="${escapeAttr(kind)}"><select class="production-item-select" aria-label="Objet">${optionsCatalogueProduction(row.itemId || '')}</select><input class="production-item-quantity" type="number" min="1" max="1000000" step="1" value="${Math.max(1, Number(row.quantity) || 1)}" aria-label="Quantité"><button type="button" class="btn-secondaire btn-danger" onclick="supprimerLigneProduction(this)" title="Retirer cet objet">✕</button></div>`;
}

function collecterLignesProduction(containerId) {
  return Array.from(document.querySelectorAll(`#${containerId} .production-item-row`)).map(row => ({
    itemId: row.querySelector('.production-item-select')?.value || '',
    quantity: Number(row.querySelector('.production-item-quantity')?.value) || 0,
  })).filter(row => row.itemId && row.quantity > 0);
}

function ajouterLigneProduction(kind) {
  const estPersonnel = !!document.getElementById('personnel-requirements');
  const targets = {
    requirements: document.getElementById(estPersonnel ? 'personnel-requirements' : 'production-requirements'),
    outputs: document.getElementById(estPersonnel ? 'personnel-outputs' : 'production-outputs'),
    dailyUpkeep: document.getElementById('personnel-daily-upkeep'),
    purchaseCost: document.getElementById('personnel-purchase-cost'),
  };
  const target = targets[kind];
  if (target) target.insertAdjacentHTML('beforeend', ligneObjetProductionHTML(kind, { itemId: '', quantity: 1 }));
}

function supprimerLigneProduction(button) { button.closest('.production-item-row')?.remove(); }

function ouvrirEditeurProduction(recipeId) {
  const recipe = recipeId ? state.productions.find(item => item._id === recipeId) : null;
  if (recipeId && !recipe) return toast('Production introuvable.', 'erreur');
  state.productionActuelle = recipe?._id || null;
  state.personnelTypeActuel = null;
  document.getElementById('overlay-catalogue').classList.add('visible');
  document.getElementById('panneau-catalogue').classList.add('ouvert');
  document.getElementById('panneau-catalogue-titre').textContent = recipe ? `Modifier - ${recipe.name}` : 'Nouvelle production';
  const requirements = recipe?.requirements?.length ? recipe.requirements : [{ itemId: '', quantity: 1 }];
  const outputs = recipe?.outputs?.length ? recipe.outputs : [{ itemId: '', quantity: 1 }];
  document.getElementById('panneau-catalogue-corps').innerHTML = `
    <div class="section-titre">${recipe ? '✏️ Modifier la production' : '➕ Créer une production'}</div>
    <div class="grille-champs"><div class="champ"><label for="f-production-name">Nom</label><input id="f-production-name" type="text" maxlength="100" value="${escapeAttr(recipe?.name || '')}" placeholder="Ex. Raffiner du minerai"></div><div class="champ"><label for="f-production-emoji">Emoji</label><input id="f-production-emoji" type="text" maxlength="8" value="${escapeAttr(recipe?.emoji || '🏭')}"></div></div>
    <div class="champ"><label for="f-production-description">Description</label><textarea id="f-production-description" maxlength="1500">${escapeHtml(recipe?.description || '')}</textarea></div>
    <div class="section-titre">⏱️ Durée de production</div><div class="champ"><label for="f-production-duration">Durée par unité (minutes)</label><input id="f-production-duration" type="number" min="1" max="525600" step="1" value="${Math.max(1, Number(recipe?.minutesPerUnit) || 30)}"></div><p class="section-note">La durée totale est multipliée par la quantité choisie par le joueur.</p>
    <div class="section-titre">📥 Ingrédients nécessaires par unité</div><div id="production-requirements" class="production-item-list">${requirements.map(row => ligneObjetProductionHTML('requirements', row)).join('')}</div><button type="button" class="btn-secondaire production-add-row" onclick="ajouterLigneProduction('requirements')">＋ Ajouter un ingrédient</button>
    <div class="section-titre">📦 Objets produits par unité</div><div id="production-outputs" class="production-item-list">${outputs.map(row => ligneObjetProductionHTML('outputs', row)).join('')}</div><button type="button" class="btn-secondaire production-add-row" onclick="ajouterLigneProduction('outputs')">＋ Ajouter un objet produit</button>
    <div class="actions-panneau"><button class="btn-principal" id="btn-enregistrer-production" onclick="sauvegarderProduction()">${recipe ? 'Enregistrer les modifications' : 'Créer la production'}</button></div>`;
}

function ouvrirEditeurPersonnelType(typeId) {
  const type = typeId ? state.personnelTypes.find(item => item._id === typeId) : null;
  if (typeId && !type) return toast('Type de personnel introuvable.', 'erreur');
  state.productionActuelle = null;
  state.personnelTypeActuel = type?._id || null;
  document.getElementById('overlay-catalogue').classList.add('visible');
  document.getElementById('panneau-catalogue').classList.add('ouvert');
  document.getElementById('panneau-catalogue-titre').textContent = type ? `Modifier - ${type.name}` : 'Nouveau personnel';
  const purchaseCost = type?.purchaseCost || [];
  const dailyUpkeep = type?.dailyUpkeep?.length ? type.dailyUpkeep : [{ itemId: '', quantity: 1 }];
  const productionOptions = state.productions.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'fr'))
    .map(production => `<option value="${escapeAttr(production._id)}" ${String(type?.productionRecipeId || '') === String(production._id) ? 'selected' : ''}>${escapeHtml(`${production.emoji || '🏭'} ${production.name}`)}</option>`).join('');
  document.getElementById('panneau-catalogue-corps').innerHTML = `
    <div class="section-titre">${type ? '✏️ Modifier le personnel' : '➕ Créer un type de personnel'}</div>
    <div class="grille-champs"><div class="champ"><label for="f-personnel-name">Nom du personnel / métier</label><input id="f-personnel-name" type="text" maxlength="100" value="${escapeAttr(type?.name || '')}" placeholder="Ex. Mineur, Pilote, Droïde"></div><div class="champ"><label for="f-personnel-emoji">Emoji</label><input id="f-personnel-emoji" type="text" maxlength="8" value="${escapeAttr(type?.emoji || '👷')}"></div></div>
    <div class="champ"><label for="f-personnel-description">Description / rôle</label><textarea id="f-personnel-description" maxlength="1500">${escapeHtml(type?.description || '')}</textarea></div>
    <div class="section-titre">🪙 Coût d’achat / recrutement (prélevé une seule fois)</div><p class="section-note">Laisse vide si le recrutement est gratuit. Les objets configurés seront retirés de l’inventaire du personnage choisi.</p>
    <div id="personnel-purchase-cost" class="production-item-list">${purchaseCost.map(row => ligneObjetProductionHTML('purchaseCost', row)).join('')}</div><button type="button" class="btn-secondaire production-add-row" onclick="ajouterLigneProduction('purchaseCost')">＋ Ajouter un objet au coût d’achat</button>
    <div class="section-titre">🌙 Entretien quotidien</div><p class="section-note">Ces objets sont consommés une fois par jour à 00 h, heure de Paris. S’ils manquent, le personnel est mis en pause jusqu’au ravitaillement.</p>
    <div id="personnel-daily-upkeep" class="production-item-list">${dailyUpkeep.map(row => ligneObjetProductionHTML('dailyUpkeep', row)).join('')}</div><button type="button" class="btn-secondaire production-add-row" onclick="ajouterLigneProduction('dailyUpkeep')">＋ Ajouter un consommable quotidien</button>
    <div class="section-titre">🏭 Production associée (configurée par le staff)</div>
    <div class="champ"><label for="f-personnel-production">Production sur laquelle ce métier travaille</label><select id="f-personnel-production"><option value="">Aucune - métier général sans production automatique</option>${productionOptions}</select></div>
    <p class="section-note">Exemple : associe « Mineur » à « Kessel ». Tous les mineurs recrutés travailleront automatiquement sur Kessel, avec ses ingrédients, ses résultats et sa durée configurés dans l’onglet Production. Laisse « Aucune » pour un métier général sans production automatique.</p>
    <div class="actions-panneau"><button class="btn-principal" id="btn-enregistrer-personnel" onclick="sauvegarderPersonnelType()">${type ? 'Enregistrer les modifications' : 'Créer le personnel'}</button></div>`;
}

async function sauvegarderProduction() {
  const button = document.getElementById('btn-enregistrer-production');
  if (!button) return;
  const original = button.textContent;
  button.disabled = true; button.textContent = 'Enregistrement…';
  try {
    const payload = {
      name: val('f-production-name'), emoji: val('f-production-emoji'), description: val('f-production-description'),
      minutesPerUnit: Number(val('f-production-duration')) || 30,
      requirements: collecterLignesProduction('production-requirements'), outputs: collecterLignesProduction('production-outputs'),
    };
    if (!payload.name?.trim()) throw new Error('Le nom de la production est obligatoire.');
    if (!payload.requirements.length) throw new Error('Ajoute au moins un ingrédient.');
    if (!payload.outputs.length) throw new Error('Ajoute au moins un objet produit.');
    const id = state.productionActuelle;
    await fetchJSON(id ? `/api/productions/${encodeURIComponent(id)}` : '/api/productions', payload, id ? 'PATCH' : 'POST');
    toast(id ? 'Production modifiée.' : 'Production créée.', 'succes');
    fermerCataloguePanel();
    await chargerProductionPage();
  } catch (error) { toast(`Échec : ${error.message}`, 'erreur'); }
  finally { button.disabled = false; button.textContent = original; }
}

async function sauvegarderPersonnelType() {
  const button = document.getElementById('btn-enregistrer-personnel');
  if (!button) return;
  const original = button.textContent;
  button.disabled = true; button.textContent = 'Enregistrement…';
  try {
    const id = state.personnelTypeActuel;
    const ancienneDefinition = state.personnelTypes.find(type => type._id === id);
    const payload = {
      name: val('f-personnel-name'), emoji: val('f-personnel-emoji'), description: val('f-personnel-description'),
      purchaseCost: collecterLignesProduction('personnel-purchase-cost'),
      dailyUpkeep: collecterLignesProduction('personnel-daily-upkeep'),
      productionRecipeId: val('f-personnel-production') || null,
      // Conservé uniquement pour compatibilité avec les anciennes définitions.
      requirements: ancienneDefinition?.requirements || [],
      outputs: ancienneDefinition?.outputs || [],
      minutesPerCycle: Number(ancienneDefinition?.minutesPerCycle) || 30,
    };
    if (!payload.name?.trim()) throw new Error('Le nom du personnel est obligatoire.');
    if (!payload.dailyUpkeep.length) throw new Error('Ajoute au moins un consommable quotidien.');
    await fetchJSON(id ? `/api/personnel-types/${encodeURIComponent(id)}` : '/api/personnel-types', payload, id ? 'PATCH' : 'POST');
    toast(id ? 'Personnel modifié.' : 'Type de personnel créé.', 'succes');
    fermerCataloguePanel();
    await chargerPersonnelPage();
  } catch (error) { toast(`Échec : ${error.message}`, 'erreur'); }
  finally { button.disabled = false; button.textContent = original; }
}

async function supprimerProduction(id) {
  const recipe = state.productions.find(item => item._id === id);
  const ok = await confirmerAction({ titre: 'Supprimer la production', message: `Supprimer « ${recipe?.name || id} » ? Les productions déjà lancées continueront jusqu'à la fin.`, texteValider: 'Supprimer' });
  if (!ok) return;
  try { await fetchJSON(`/api/productions/${encodeURIComponent(id)}`, null, 'DELETE'); toast('Production supprimée.', 'succes'); await chargerProductionPage(); }
  catch (error) { toast(`Échec : ${error.message}`, 'erreur'); }
}

async function supprimerPersonnelType(id) {
  const type = state.personnelTypes.find(item => item._id === id);
  const ok = await confirmerAction({ titre: 'Supprimer le personnel', message: `Supprimer le type « ${type?.name || id} » de la liste de recrutement ?`, texteValider: 'Supprimer' });
  if (!ok) return;
  try { await fetchJSON(`/api/personnel-types/${encodeURIComponent(id)}`, null, 'DELETE'); toast('Type de personnel supprimé.', 'succes'); await chargerPersonnelPage(); }
  catch (error) { toast(`Échec : ${error.message}`, 'erreur'); }
}

// -----------------------------------------------------------------------
// Confirmation (remplace window.confirm par une modale du même style que le
// reste du site). confirmerAction() retourne une Promise<boolean> : true si
// la personne a cliqué "Valider", false sinon (Annuler, croix, clic dehors,
// touche Échap) - s'utilise avec await, comme confirm() mais async.
// -----------------------------------------------------------------------
let _resoudreConfirmEnCours = null;

function confirmerAction({ titre = 'Confirmer', message = '', texteValider = 'Valider', caseLabel = '' } = {}) {
  document.getElementById('confirm-titre').textContent = titre;
  document.getElementById('confirm-message').textContent = message;
  document.getElementById('confirm-valider').textContent = texteValider;
  // Case à cocher optionnelle (ex. « Ne plus afficher ce message »).
  let ligneCase = document.getElementById('confirm-case-ligne');
  if (!ligneCase) {
    ligneCase = document.createElement('label');
    ligneCase.id = 'confirm-case-ligne';
    ligneCase.className = 'confirm-case';
    ligneCase.innerHTML = '<input type="checkbox" id="confirm-case"> <span id="confirm-case-texte"></span>';
    document.querySelector('#confirm-overlay .confirm-actions').before(ligneCase);
  }
  document.getElementById('confirm-case').checked = false;
  document.getElementById('confirm-case-texte').textContent = caseLabel;
  ligneCase.hidden = !caseLabel;
  confirmerAction.caseCochee = false;
  document.getElementById('confirm-overlay').classList.add('visible');

  return new Promise((resolve) => {
    _resoudreConfirmEnCours = resolve;
  });
}

function resoudreConfirm(valeur) {
  confirmerAction.caseCochee = !!document.getElementById('confirm-case')?.checked;
  document.getElementById('confirm-overlay').classList.remove('visible');
  if (_resoudreConfirmEnCours) {
    _resoudreConfirmEnCours(valeur);
    _resoudreConfirmEnCours = null;
  }
}

// -----------------------------------------------------------------------
// Notifications
// -----------------------------------------------------------------------
function toast(message, type = 'succes') {
  const conteneur = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${type === 'succes' ? '✅' : '⚠️'}</span><span>${escapeHtml(message)}</span>`;
  conteneur.appendChild(el);
  setTimeout(() => {
    el.classList.add('sortie');
    setTimeout(() => el.remove(), 280);
  }, 3200);
}

// -----------------------------------------------------------------------
// Utilitaires d'échappement (évite l'injection HTML depuis les données)
// -----------------------------------------------------------------------
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(str) { return escapeHtml(str); }
function jsAttr(str) { return String(str ?? '').replace(/'/g, "\\'"); }

// -----------------------------------------------------------------------
// BOUTIQUE : objets, prix et stock (affichage / achats / ventes sur Discord)
// -----------------------------------------------------------------------
async function chargerBoutiquePage() {
  const contenuDiv = document.getElementById('contenu');
  contenuDiv.innerHTML = '<div class="squelette"></div><div class="squelette"></div><div class="squelette"></div>';
  try {
    const [boutiqueResponse, catalogueResponse] = await Promise.all([
      apiFetch('/api/boutique'),
      apiFetch('/api/inventaire/catalogue/meta'),
    ]);
    for (const response of [boutiqueResponse, catalogueResponse]) {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    }
    const items = await boutiqueResponse.json();
    state.boutique = Array.isArray(items) ? items : [];
    state.catalogue = catalogueValide(await catalogueResponse.json());
    majCompteur('boutique', state.boutique.length);
    renderBoutiquePage();
    setStatutConnexion(true);
  } catch (error) {
    contenuDiv.innerHTML = `<div class="etat-vide"><div class="etat-vide-icone">⚠️</div><p>Erreur de chargement</p><span class="etat-vide-sub">${escapeHtml(error.message)}</span></div>`;
    setStatutConnexion(false);
    console.error('Erreur chargement boutique:', error);
  }
}

function formaterCreditsBoutique(value) {
  return `${Math.max(0, Math.round(Number(value) || 0)).toLocaleString('fr-FR')} 💰`;
}

function fourchetteBoutique(min, max) {
  return Number(min) === Number(max) ? formaterCreditsBoutique(min) : `${formaterCreditsBoutique(min)} → ${formaterCreditsBoutique(max)}`;
}

// Un objet de la boutique peut être achetable, vendable (rachat) ou les deux
// (type "mixte"). Le stock est unique : partagé entre l'achat et la revente.
// Les anciens objets sans type avaient achat + rachat : ils sont "mixte".
function typeBoutique(entry) {
  if (entry?.type === 'achetable' || entry?.type === 'vendable') return entry.type;
  return 'mixte';
}
const estAchetable = entry => typeBoutique(entry) !== 'vendable';
const estVendable = entry => typeBoutique(entry) !== 'achetable';

// Tuile compacte : icône, nom et stock. Tout le détail est dans « Modifier ».
function boutiqueCardHTML(entry, side) {
  const item = state.catalogue.find(it => it.id === entry.id);
  const nom = item?.name || entry.id;
  const masque = entry.enabled === false;
  const stock = Math.max(0, Number(entry.stock) || 0);
  const etat = masque ? '🚫 Masqué' : stock > 0 ? `📦 ${stock}` : '❌ Rupture';
  const typeLabel = typeBoutique(entry);
  const searchable = `${nom} ${entry.id} ${item?.category || ''} ${item?.rarity || ''} ${typeLabel}`.toLowerCase();
  return `<button type="button" class="boutique-tuile${masque ? ' boutique-masque' : ''}" onclick="ouvrirEditeurBoutique('${jsAttr(entry.id)}', '${side}')" data-id="${escapeAttr(entry.id)}" data-nom="${escapeAttr(searchable)}" data-category="${escapeAttr(item?.category || 'Divers')}" data-rarity="${escapeAttr(item?.rarity || 'Commun')}" data-side="${side}" data-type="${typeLabel}" data-stock="${stock}" data-enabled="${masque ? '0' : '1'}" data-price="${Number(side === 'vendable' ? entry.rachatMinPrice : entry.minPrice) || 0}" title="${escapeAttr(nom)}">
    <span class="boutique-tuile-icone">${escapeHtml(item?.emoji || '📦')}</span><span class="boutique-tuile-nom">${escapeHtml(nom)}</span><span class="boutique-tuile-stock">${etat}</span><span class="boutique-tuile-id">${escapeHtml(entry.id)} · ${escapeHtml(item?.rarity || 'Commun')}</span>
  </button>`;
}

function renderBoutiquePage() {
  const sort = getPageFilter('boutique', 'sort', 'price-asc');
  const nomDe = entry => String(state.catalogue.find(item => item.id === entry.id)?.name || entry.id);
  const compare = (a, b, side) => {
    if (sort === 'name-desc') return nomDe(b).localeCompare(nomDe(a), 'fr');
    if (sort === 'name-asc') return nomDe(a).localeCompare(nomDe(b), 'fr');
    if (sort === 'stock-desc') return (Number(b.stock) || 0) - (Number(a.stock) || 0) || nomDe(a).localeCompare(nomDe(b), 'fr');
    if (sort === 'stock-asc') return (Number(a.stock) || 0) - (Number(b.stock) || 0) || nomDe(a).localeCompare(nomDe(b), 'fr');
    const key = side === 'vendable' ? 'rachatMinPrice' : 'minPrice';
    return (Number(a[key]) || 0) - (Number(b[key]) || 0) || nomDe(a).localeCompare(nomDe(b), 'fr');
  };
  const achetables = state.boutique.filter(estAchetable).sort((a, b) => compare(a, b, 'achetable'));
  const vendables = state.boutique.filter(estVendable).sort((a, b) => compare(a, b, 'vendable'));
  const categories = [...new Set(state.boutique.map(entry => state.catalogue.find(item => item.id === entry.id)?.category || 'Divers'))].sort((a, b) => a.localeCompare(b, 'fr'));
  const rarities = ['Épique', 'Rare', 'Peu commun', 'Commun'];
  const categoryOptions = [{ value: '', label: 'Toutes les catégories' }, ...categories.map(value => ({ value, label: value }))];
  const vide = text => `<div class="etat-vide boutique-vide"><p>${text}</p></div>`;
  document.getElementById('contenu').innerHTML = `
    <div class="production-intro"><div class="production-intro-icon">🛒</div><div><strong>Boutique</strong><p>Configure les objets proposés, leur stock partagé et les fourchettes de prix qui sont utilisées par le marchand Discord.</p></div></div>
    ${toolbarFiltreHTML('boutique', [selectFiltreHTML('boutique', 'category', 'Catégorie', categoryOptions), selectFiltreHTML('boutique', 'rarity', 'Rareté', [{ value: '', label: 'Toutes les raretés' }, ...rarities.map(value => ({ value, label: value }))]), selectFiltreHTML('boutique', 'side', 'Type', [{ value: '', label: 'Achetable et vendable' }, { value: 'achetable', label: 'Achetable' }, { value: 'vendable', label: 'Vendable' }]), selectFiltreHTML('boutique', 'enabled', 'Visibilité', [{ value: '', label: 'Tous' }, { value: '1', label: 'Visibles' }, { value: '0', label: 'Masqués' }]), selectFiltreHTML('boutique', 'sort', 'Trier par', [{ value: 'price-asc', label: 'Prix croissant' }, { value: 'stock-desc', label: 'Stock décroissant' }, { value: 'stock-asc', label: 'Stock croissant' }, { value: 'name-asc', label: 'Nom A → Z' }, { value: 'name-desc', label: 'Nom Z → A' }], 'price-asc')])}
    <div class="production-section-heading"><div><h3>🛒 Achetable</h3></div><button class="btn-principal" onclick="ouvrirEditeurBoutique(null, 'achetable')">＋ Ajouter</button></div><div class="boutique-grille">${achetables.map(entry => boutiqueCardHTML(entry, 'achetable')).join('') || vide('Aucun objet achetable.')}</div>
    <div class="production-section-heading"><div><h3>💰 Vendable</h3></div><button class="btn-principal" onclick="ouvrirEditeurBoutique(null, 'vendable')">＋ Ajouter</button></div><div class="boutique-grille">${vendables.map(entry => boutiqueCardHTML(entry, 'vendable')).join('') || vide('Aucun objet vendable.')}</div>
    <div class="aucun-resultat" id="aucun-resultat" hidden>Aucun objet ne correspond à cette recherche ou à ces filtres.</div>`;
  filtrerListe();
}

function ouvrirEditeurBoutique(itemId, side = 'achetable') {
  const entry = itemId ? state.boutique.find(it => it.id === itemId) : null;
  if (itemId && !entry) return toast('Objet introuvable dans la boutique.', 'erreur');
  state.boutiqueActuelle = entry?.id || null;
  // Case(s) cochée(s) : celles de l'objet, plus la section depuis laquelle on ajoute.
  const coche = {
    achetable: entry ? estAchetable(entry) : false,
    vendable: entry ? estVendable(entry) : false,
  };
  coche[side === 'vendable' ? 'vendable' : 'achetable'] = true;
  state.boutiqueStockInitial = entry ? Math.max(0, Number(entry.stock) || 0) : null;

  document.getElementById('overlay-catalogue').classList.add('visible');
  document.getElementById('panneau-catalogue').classList.add('ouvert');
  const catItem = entry ? state.catalogue.find(it => it.id === entry.id) : null;
  document.getElementById('panneau-catalogue-titre').textContent = entry ? `Modifier - ${catItem?.name || entry.id}` : 'Ajouter à la boutique';

  // Pour ajouter à une section, on propose tous les objets pas encore présents
  // dans CETTE section (un objet déjà en achat peut donc être ajouté en rachat).
  const dansSection = new Set(state.boutique.filter(it => side === 'vendable' ? estVendable(it) : estAchetable(it)).map(it => it.id));
  const options = '<option value="">Choisir un objet…</option>' + catalogueTrie()
    .filter(it => String(it.id).toLowerCase() !== 'credits_de_la_nouvelle_republique' && !dansSection.has(it.id))
    .map(it => `<option value="${escapeAttr(it.id)}">${escapeHtml(`${it.emoji || '📦'} ${it.name} - ${it.id}`)}</option>`).join('');
  const champObjet = entry
    ? `<div class="champ"><label>Objet</label><input type="text" value="${escapeAttr(`${catItem?.emoji || '📦'} ${catItem?.name || entry.id}`)}" disabled></div>`
    : `<div class="champ"><label for="f-boutique-item">Objet du catalogue</label><select id="f-boutique-item" onchange="choisirObjetBoutique(this.value, '${side === 'vendable' ? 'vendable' : 'achetable'}')">${options}</select></div>`;
  const nb = (id, label, value) => `<div class="champ"><label for="${id}">${label}</label><input id="${id}" type="number" min="1" step="1" value="${Math.max(1, Number(value) || 1)}"></div>`;
  document.getElementById('panneau-catalogue-corps').innerHTML = `
    <div class="section-titre">${entry ? '✏️ Modifier l\'objet' : '➕ Ajouter un objet'}</div>
    ${champObjet}
    <div class="grille-champs"><div class="champ"><label for="f-boutique-stock">Stock du marchand (achat et rachat)</label><input id="f-boutique-stock" type="number" min="0" max="1000000" step="1" value="${Math.max(0, Number(entry?.stock) || 0)}"></div><div class="champ"><label for="f-boutique-enabled">Visibilité</label><select id="f-boutique-enabled"><option value="1" ${entry?.enabled === false ? '' : 'selected'}>Visible dans la boutique</option><option value="0" ${entry?.enabled === false ? 'selected' : ''}>Masqué</option></select></div></div>
    <label class="boutique-case"><input type="checkbox" id="f-boutique-achetable" ${coche.achetable ? 'checked' : ''} onchange="basculerSideBoutique()"> 🛒 Achetable (le joueur achète au marchand)</label>
    <div id="bloc-boutique-achat" ${coche.achetable ? '' : 'hidden'}>
      <div class="grille-champs">${nb('f-boutique-min', 'Prix minimum (stock élevé)', entry?.minPrice ?? 100)}${nb('f-boutique-max', 'Prix maximum (rupture)', entry?.maxPrice ?? 250)}</div>
    </div>
    <label class="boutique-case"><input type="checkbox" id="f-boutique-vendable" ${coche.vendable ? 'checked' : ''} onchange="basculerSideBoutique()"> 💰 Vendable (le marchand rachète au joueur)</label>
    <div id="bloc-boutique-vente" ${coche.vendable ? '' : 'hidden'}>
      <div class="grille-champs">${nb('f-boutique-rachat-min', 'Rachat minimum (stock élevé)', entry?.rachatMinPrice ?? 50)}${nb('f-boutique-rachat-max', 'Rachat maximum (rupture)', entry?.rachatMaxPrice ?? 125)}</div>
    </div>
    <div class="actions-panneau">
      <button class="btn-principal" id="btn-enregistrer-boutique" onclick="sauvegarderBoutiqueItem()">${entry ? 'Enregistrer les modifications' : 'Ajouter à la boutique'}</button>
      ${entry ? `<button class="btn-secondaire btn-danger" onclick="retirerBoutiqueItem('${jsAttr(entry.id)}')">Retirer de la boutique</button>` : ''}
    </div>`;
}

// Choisir dans la liste un objet déjà présent dans l'autre section : on rouvre
// l'éditeur sur cet objet pour reprendre son stock (partagé) et ses prix.
function choisirObjetBoutique(id, side) {
  if (id && state.boutique.some(it => it.id === id)) ouvrirEditeurBoutique(id, side);
}

function basculerSideBoutique() {
  const achat = document.getElementById('f-boutique-achetable')?.checked;
  const vente = document.getElementById('f-boutique-vendable')?.checked;
  const blocAchat = document.getElementById('bloc-boutique-achat');
  const blocVente = document.getElementById('bloc-boutique-vente');
  if (blocAchat) blocAchat.hidden = !achat;
  if (blocVente) blocVente.hidden = !vente;
}

const CLE_MASQUER_INFO_STOCK = 'boutique:masquerInfoStock';

async function sauvegarderBoutiqueItem() {
  const button = document.getElementById('btn-enregistrer-boutique');
  if (!button) return;
  const original = button.textContent;
  button.disabled = true; button.textContent = 'Enregistrement…';
  try {
    const id = state.boutiqueActuelle || val('f-boutique-item');
    if (!id) throw new Error('Choisis un objet du catalogue.');
    const achetable = document.getElementById('f-boutique-achetable').checked;
    const vendable = document.getElementById('f-boutique-vendable').checked;
    if (!achetable && !vendable) throw new Error('Coche au moins « Achetable » ou « Vendable ».');
    const stock = Number(val('f-boutique-stock'));
    const payload = { achetable, vendable, stock, enabled: val('f-boutique-enabled') !== '0' };
    if (achetable) { payload.minPrice = Number(val('f-boutique-min')); payload.maxPrice = Number(val('f-boutique-max')); }
    if (vendable) { payload.rachatMinPrice = Number(val('f-boutique-rachat-min')); payload.rachatMaxPrice = Number(val('f-boutique-rachat-max')); }

    // Quantité modifiée : on rappelle que le stock est commun à l'achat et à la revente.
    let masquer = false;
    try { masquer = localStorage.getItem(CLE_MASQUER_INFO_STOCK) === '1'; } catch (_) { /* stockage indisponible */ }
    if (state.boutiqueStockInitial !== null && stock !== state.boutiqueStockInitial && !masquer) {
      const ok = await confirmerAction({
        titre: 'Modifier le stock',
        message: `Le stock est partagé entre l'achat et la revente : passer de ${state.boutiqueStockInitial} à ${stock} change la quantité disponible à l'achat ET celle qui fait varier le prix de rachat.`,
        texteValider: 'Enregistrer',
        caseLabel: 'Ne plus afficher ce message',
      });
      if (!ok) return;
      if (confirmerAction.caseCochee) { try { localStorage.setItem(CLE_MASQUER_INFO_STOCK, '1'); } catch (_) { /* ignoré */ } }
    }

    await fetchJSON(`/api/boutique/${encodeURIComponent(id)}`, payload, 'PUT');
    toast(state.boutiqueActuelle ? 'Objet de la boutique modifié.' : 'Objet ajouté à la boutique.', 'succes');
    fermerCataloguePanel();
    await chargerBoutiquePage();
  } catch (error) { toast(`Échec : ${error.message}`, 'erreur'); }
  finally { button.disabled = false; button.textContent = original; }
}

async function retirerBoutiqueItem(id) {
  const item = state.catalogue.find(it => it.id === id);
  const ok = await confirmerAction({ titre: 'Retirer de la boutique', message: `Retirer « ${item?.name || id} » de la boutique (achat et rachat) ? L'objet reste dans le catalogue.`, texteValider: 'Retirer' });
  if (!ok) return;
  try { await fetchJSON(`/api/boutique/${encodeURIComponent(id)}`, null, 'DELETE'); toast('Objet retiré de la boutique.', 'succes'); fermerCataloguePanel(); await chargerBoutiquePage(); }
  catch (error) { toast(`Échec : ${error.message}`, 'erreur'); }
}

// -----------------------------------------------------------------------
// LISTES DÉROULANTES AVEC RECHERCHE
// Toute liste déroulante d'au moins SEUIL_RECHERCHE choix reçoit un champ de
// recherche (sans accent, sans casse). Le <select> d'origine reste dans la page
// (caché) : sa valeur et ses événements "change" fonctionnent comme avant.
// Pour désactiver sur une liste : data-no-search sur le <select>.
// -----------------------------------------------------------------------
const SEUIL_RECHERCHE = 8;
const _selectValueDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');

function normaliserRecherche(texte) {
  return String(texte || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function ameliorerSelect(select) {
  if (!(select instanceof HTMLSelectElement)) return;
  if (select.dataset.recherche === 'ok' || select.hasAttribute('data-no-search') || select.multiple) return;
  if (select.options.length < SEUIL_RECHERCHE || !select.parentNode) return;
  select.dataset.recherche = 'ok';

  const wrap = document.createElement('div');
  wrap.className = 'select-recherche';
  select.parentNode.insertBefore(wrap, select);
  wrap.appendChild(select);
  select.classList.add('select-recherche-natif');

  const bouton = document.createElement('button');
  bouton.type = 'button';
  bouton.className = 'select-recherche-bouton';
  bouton.setAttribute('aria-haspopup', 'listbox');
  const libelle = document.createElement('span');
  libelle.className = 'select-recherche-libelle';
  const fleche = document.createElement('span');
  fleche.className = 'select-recherche-fleche';
  fleche.textContent = '▾';
  bouton.append(libelle, fleche);
  wrap.appendChild(bouton);

  let panneau = null, champ = null, liste = null, actifIndex = -1, visibles = [];

  function synchroniser() {
    const opt = select.options[select.selectedIndex];
    libelle.textContent = opt ? opt.textContent : '';
    libelle.classList.toggle('placeholder', !opt || opt.value === '');
    bouton.disabled = select.disabled;
  }

  function positionner() {
    if (!panneau) return;
    const r = bouton.getBoundingClientRect();
    const hauteurMax = 320;
    const dessous = window.innerHeight - r.bottom - 8;
    const dessus = r.top - 8;
    const enHaut = dessous < 200 && dessus > dessous;
    panneau.style.left = `${r.left}px`;
    panneau.style.width = `${r.width}px`;
    panneau.style.maxHeight = `${Math.min(hauteurMax, Math.max(140, enHaut ? dessus : dessous))}px`;
    if (enHaut) { panneau.style.top = 'auto'; panneau.style.bottom = `${window.innerHeight - r.top + 4}px`; }
    else { panneau.style.bottom = 'auto'; panneau.style.top = `${r.bottom + 4}px`; }
  }

  function remplirListe() {
    const q = normaliserRecherche(champ.value);
    liste.innerHTML = '';
    visibles = [];
    Array.from(select.options).forEach(opt => {
      if (opt.disabled) return;
      if (q && opt.value !== '' && !normaliserRecherche(opt.textContent).includes(q)) return;
      if (q && opt.value === '') return;
      visibles.push(opt);
    });
    if (!visibles.length) {
      const vide = document.createElement('li');
      vide.className = 'select-recherche-vide';
      vide.textContent = 'Aucun résultat';
      liste.appendChild(vide);
      actifIndex = -1;
      return;
    }
    const courant = select.selectedIndex;
    visibles.forEach((opt, i) => {
      const li = document.createElement('li');
      li.className = 'select-recherche-option' + (opt.index === courant ? ' selectionne' : '') + (opt.value === '' ? ' placeholder' : '');
      li.textContent = opt.textContent;
      li.setAttribute('role', 'option');
      li.addEventListener('mousedown', e => { e.preventDefault(); choisir(opt); });
      li.addEventListener('mousemove', () => definirActif(i, false));
      liste.appendChild(li);
    });
    const indexSelectionne = visibles.findIndex(o => o.index === courant);
    definirActif(q ? 0 : Math.max(0, indexSelectionne), true);
  }

  function definirActif(i, defiler) {
    actifIndex = i;
    Array.from(liste.querySelectorAll('.select-recherche-option')).forEach((li, idx) => {
      li.classList.toggle('actif', idx === i);
      if (idx === i && defiler) li.scrollIntoView({ block: 'nearest' });
    });
  }

  function choisir(opt) {
    const change = select.value !== opt.value;
    _selectValueDesc.set.call(select, opt.value);
    synchroniser();
    fermer();
    if (change) select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function surClicExterieur(e) {
    if (panneau && !panneau.contains(e.target) && !bouton.contains(e.target)) fermer();
  }
  function surDefilement(e) {
    if (panneau && !panneau.contains(e.target)) positionner();
  }

  function ouvrir() {
    if (panneau || select.disabled) return;
    panneau = document.createElement('div');
    panneau.className = 'select-recherche-panneau';
    champ = document.createElement('input');
    champ.type = 'text';
    champ.className = 'select-recherche-champ';
    champ.placeholder = '🔎 Rechercher…';
    champ.autocomplete = 'off';
    liste = document.createElement('ul');
    liste.className = 'select-recherche-liste';
    liste.setAttribute('role', 'listbox');
    panneau.append(champ, liste);
    document.body.appendChild(panneau);
    positionner();
    remplirListe();
    champ.focus();
    champ.addEventListener('input', remplirListe);
    champ.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (visibles.length) definirActif(Math.min(visibles.length - 1, actifIndex + 1), true); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (visibles.length) definirActif(Math.max(0, actifIndex - 1), true); }
      else if (e.key === 'Enter') { e.preventDefault(); if (visibles[actifIndex]) choisir(visibles[actifIndex]); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fermer(); bouton.focus(); }
      else if (e.key === 'Tab') fermer();
    });
    document.addEventListener('mousedown', surClicExterieur, true);
    window.addEventListener('scroll', surDefilement, true);
    window.addEventListener('resize', positionner);
    bouton.setAttribute('aria-expanded', 'true');
  }

  function fermer() {
    if (!panneau) return;
    document.removeEventListener('mousedown', surClicExterieur, true);
    window.removeEventListener('scroll', surDefilement, true);
    window.removeEventListener('resize', positionner);
    panneau.remove();
    panneau = champ = liste = null;
    bouton.setAttribute('aria-expanded', 'false');
  }

  bouton.addEventListener('click', () => (panneau ? fermer() : ouvrir()));
  bouton.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); ouvrir(); }
  });

  // Reste synchronisé avec le <select> d'origine (options remplacées, valeur
  // changée par le code, désactivation).
  Object.defineProperty(select, 'value', {
    configurable: true,
    get() { return _selectValueDesc.get.call(this); },
    set(v) { _selectValueDesc.set.call(this, v); synchroniser(); },
  });
  new MutationObserver(() => { synchroniser(); if (panneau) remplirListe(); })
    .observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'selected'] });
  select.addEventListener('change', synchroniser);
  synchroniser();
}

function ameliorerSelectsDans(racine) {
  if (!racine || racine.nodeType !== 1) return;
  if (racine.tagName === 'SELECT') ameliorerSelect(racine);
  racine.querySelectorAll?.('select').forEach(ameliorerSelect);
}

(function initSelectsRecherche() {
  let planifie = false;
  const aTraiter = new Set();
  new MutationObserver(mutations => {
    for (const m of mutations) m.addedNodes.forEach(n => { if (n.nodeType === 1) aTraiter.add(n); });
    if (planifie || !aTraiter.size) return;
    planifie = true;
    requestAnimationFrame(() => {
      planifie = false;
      const noeuds = Array.from(aTraiter); aTraiter.clear();
      noeuds.forEach(ameliorerSelectsDans);
    });
  }).observe(document.body, { childList: true, subtree: true });
  ameliorerSelectsDans(document.body);
})();