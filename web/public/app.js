const state = {
  cache: { profils: [], inventaires: [] },
  catalogue: [],
  crafts: [],
  craftActuel: null,
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

  afficherErreurAuthEventuelle();
  verifierSessionExistante();
});

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
      demarrerApplication();
    }
  } catch { /* pas connecté : l'écran de connexion reste affiché */ }
}

function afficherUtilisateurConnecte(me) {
  const badge = document.getElementById('topbar-user');
  if (!me.username) { badge.hidden = true; return; }
  document.getElementById('user-nom').textContent = me.username;
  const avatar = document.getElementById('user-avatar');
  if (me.avatar) { avatar.src = me.avatar; avatar.hidden = false; } else { avatar.hidden = true; }
  badge.hidden = false;
  document.getElementById('nav-admin').hidden = !me.isSuperAdmin;
}

// -----------------------------------------------------------------------
// Écran de connexion — Discord uniquement (rôle Staff vérifié côté serveur)
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
  Promise.allSettled([
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

// -----------------------------------------------------------------------
// Chargement d'une section : Profils RP, Inventaire, Catalogue ou Admin
// -----------------------------------------------------------------------
async function chargerDonnees(collection) {
  state.collectionActuelle = collection;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.collection === collection));

  const searchWrap = document.getElementById('search-wrap');

  if (collection === 'profils') {
    searchWrap.hidden = false;
    const rechercheInput = document.getElementById('recherche');
    rechercheInput.value = '';
    rechercheInput.placeholder = 'Rechercher un personnage...';
    document.getElementById('titre-section').textContent = 'Profils RP';
    document.getElementById('sous-titre').textContent = 'Personnages joués sur le serveur.';
    await chargerProfils();
  } else if (collection === 'inventaire') {
    searchWrap.hidden = false;
    const rechercheInput = document.getElementById('recherche');
    rechercheInput.value = '';
    rechercheInput.placeholder = 'Rechercher un personnage...';
    document.getElementById('titre-section').textContent = 'Inventaire';
    document.getElementById('sous-titre').textContent = 'Inventaires individuels des personnages.';
    await chargerInventairePage();
  } else if (collection === 'catalogue') {
    searchWrap.hidden = false;
    const rechercheInput = document.getElementById('recherche');
    rechercheInput.value = '';
    rechercheInput.placeholder = 'Rechercher un objet...';
    document.getElementById('titre-section').textContent = "Catalogue d'objets";
    document.getElementById('sous-titre').textContent = 'Tous les objets du serveur, organisés par catégorie et rareté.';
    await chargerCataloguePage();
  } else if (collection === 'crafts') {
    searchWrap.hidden = false;
    const rechercheInput = document.getElementById('recherche');
    rechercheInput.value = '';
    rechercheInput.placeholder = 'Rechercher une recette...';
    document.getElementById('titre-section').textContent = 'Atelier & crafts';
    document.getElementById('sous-titre').textContent = 'Configure les recettes disponibles dans le salon Discord Atelier.';
    await chargerCraftsPage();
  } else if (collection === 'admin') {
    searchWrap.hidden = true;
    document.getElementById('titre-section').textContent = 'Admin';
    document.getElementById('sous-titre').textContent = 'Connexions et journal des actions — visible par le créateur uniquement.';
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

function renderListeProfils(data) {
  const contenuDiv = document.getElementById('contenu');
  if (!data || data.length === 0) {
    contenuDiv.innerHTML = "<div class='etat-vide'><div class='etat-vide-icone'>🕸️</div><p>Aucune donnée trouvée</p></div>";
    return;
  }
  contenuDiv.innerHTML = data.map((item, i) => ligneHTML(item, i)).join('') +
    '<div class="aucun-resultat" id="aucun-resultat" hidden>Aucun résultat pour cette recherche.</div>';
}

function ligneHTML(item, index) {
  const delay = `${Math.min(index, 14) * 35}ms`;
  const statutBadge = item.statut === 'Vivant' ? 'badge-vert' : item.statut === 'Mort' ? 'badge-sang'
    : item.statut === 'Prisonnier' ? 'badge-acier' : 'badge-or';
  return `
    <div class="ligne" style="--i:${delay}" data-nom="${escapeAttr(((item.nomPrenom || item._id) + ' ' + (item.categoryName || item.roleName || '')).toLowerCase())}">
      <div class="ligne-sigil">👤</div>
      <div class="ligne-corps">
        <div class="ligne-nom">${escapeHtml(item.nomPrenom || item._id)}</div>
        <div class="ligne-meta">
          <span class="badge ${statutBadge}">${escapeHtml(item.statut || '-')}</span>
          <span class="badge badge-defaut">${escapeHtml(item.roleName || 'Sans rôle')}${item.categoryName ? ` - ${escapeHtml(item.categoryName)}` : ''}</span>
        </div>
      </div>
      <button class="btn-modifier" onclick="ouvrirEditeur('${jsAttr(item._id)}')">Modifier</button>
    </div>`;
}

// -----------------------------------------------------------------------
// Inventaire : les inventaires des personnages s'affichent directement dans
// la page. Le catalogue d'objets possède désormais sa propre section dédiée.
// -----------------------------------------------------------------------
async function chargerInventairePage() {
  const contenuDiv = document.getElementById('contenu');
  contenuDiv.innerHTML = Array.from({ length: 4 }).map(() => '<div class="squelette"></div>').join('');

  try {
    const [catalogue, inventaires, profils] = await Promise.all([
      apiFetch('/api/inventaire/catalogue').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
      apiFetch('/api/inventaire').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
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
    (state.cache.inventaires || []).map(inv => [inv._id, Object.values(inv.items || {}).reduce((a, b) => a + b, 0)])
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
    const catalogue = await apiFetch('/api/inventaire/catalogue').then(r => {
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

  state.catalogue.forEach(item => {
    const categorie = String(item.category || 'Divers').trim() || 'Divers';
    if (!categories.has(categorie)) categories.set(categorie, []);
    categories.get(categorie).push(item);
  });

  const blocs = [...categories.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'fr'))
    .map(([categorie, items], index) => {
      items.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
      const id = `catalogue-categorie-${slugTexte(categorie)}-${index}`;
      return `
        <section class="catalogue-categorie" id="${escapeAttr(id)}">
          <div class="catalogue-categorie-header">
            <div>
              <span class="catalogue-categorie-eyebrow">Catégorie</span>
              <h3>${escapeHtml(categorie)}</h3>
            </div>
            <span class="catalogue-categorie-count">${items.length} objet${items.length > 1 ? 's' : ''}</span>
          </div>
          <div class="catalogue-grille">
            ${items.map(catalogueItemHTML).join('')}
          </div>
        </section>`;
    }).join('');

  const navigationCategories = [...categories.keys()]
    .sort((a, b) => a.localeCompare(b, 'fr'))
    .map((categorie, index) => `<a class="catalogue-categorie-chip" href="#catalogue-categorie-${slugTexte(categorie)}-${index}">${escapeHtml(categorie)}</a>`)
    .join('');

  contenuDiv.innerHTML = `
    <div class="catalogue-actions-bar">
      <div>
        <strong>📦 Catalogue complet</strong>
        <span>${state.catalogue.length} objet${state.catalogue.length > 1 ? 's' : ''} dans ${categories.size} catégorie${categories.size > 1 ? 's' : ''}</span>
      </div>
      <div class="catalogue-actions">
        <button class="btn-principal" onclick="ouvrirEditeurCatalogue(null)">＋ Ajouter un objet</button>
        <button class="btn-secondaire btn-danger" onclick="supprimerTousLesObjets()" ${state.catalogue.length ? '' : 'disabled'}>🗑️ Tout supprimer</button>
      </div>
    </div>
    ${navigationCategories ? `<div class="catalogue-categories-nav">${navigationCategories}</div>` : ''}
    ${blocs || '<div class="etat-vide"><div class="etat-vide-icone">📦</div><p>Catalogue vide.</p><span class="etat-vide-sub">Ajoute ton premier objet avec le bouton ci-dessus.</span></div>'}
    <div class="aucun-resultat" id="aucun-resultat" hidden>Aucun objet ne correspond à cette recherche.</div>
  `;
}

// -----------------------------------------------------------------------
// Recettes de craft — administration du panneau Atelier Discord.
// -----------------------------------------------------------------------
async function chargerCraftsPage() {
  const contenuDiv = document.getElementById('contenu');
  contenuDiv.innerHTML = '<div class="squelette"></div><div class="squelette"></div><div class="squelette"></div>';
  try {
    const [craftResponse, catalogueResponse] = await Promise.all([apiFetch('/api/crafts'), apiFetch('/api/inventaire/catalogue')]);
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
  const cards = state.crafts.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'fr')).map(craftCardHTML).join('');
  document.getElementById('contenu').innerHTML = `
    <div class="crafts-intro"><div class="crafts-intro-icon">🛠️</div><div><strong>Atelier de fabrication</strong><p>Configure les ingrédients, les objets produits et la durée réelle de chaque recette. Les joueurs utilisent ensuite le panneau dans le salon Discord Atelier.</p></div><button class="btn-principal" onclick="ouvrirEditeurCraft(null)">＋ Nouvelle recette</button></div>
    <div class="crafts-grid">${cards || '<div class="etat-vide"><div class="etat-vide-icone">⚙️</div><p>Aucune recette configurée.</p><span class="etat-vide-sub">Crée une recette pour la publier dans le salon Atelier.</span></div>'}</div>
    <div class="aucun-resultat" id="aucun-resultat" hidden>Aucune recette ne correspond à cette recherche.</div>`;
}

function craftCardHTML(recipe) {
  const name = recipe.name || 'Recette sans nom';
  return `<article class="craft-card" data-nom="${escapeAttr(`${name} ${recipe.description || ''}`.toLowerCase())}">
    <div class="craft-card-head"><span class="craft-icon">${escapeHtml(recipe.emoji || '⚙️')}</span><div class="craft-card-title"><h3>${escapeHtml(name)}</h3><p>${escapeHtml(recipe.description || 'Aucune description.')}</p></div><span class="craft-duration">⏱ ${escapeHtml(dureeCraftTexte(recipe.durationMinutes))}</span></div>
    <div class="craft-columns"><div class="craft-items-preview"><strong>📥 Ingrédients nécessaires</strong><ul>${craftObjetsTexte(recipe.requirements) || '<li>—</li>'}</ul></div><div class="craft-items-preview craft-output-preview"><strong>📦 Objets produits</strong><ul>${craftObjetsTexte(recipe.outputs) || '<li>—</li>'}</ul></div></div>
    <div class="craft-card-actions"><button class="btn-secondaire" onclick="ouvrirEditeurCraft('${jsAttr(recipe._id)}')">Modifier</button><button class="btn-secondaire btn-danger" onclick="supprimerCraft('${jsAttr(recipe._id)}')">Supprimer</button></div></article>`;
}

function optionsCatalogueCraft(selectedId) {
  return '<option value="">Choisir un objet…</option>' + state.catalogue.map(item =>
    `<option value="${escapeAttr(item.id)}" ${item.id === selectedId ? 'selected' : ''}>${escapeHtml(`${item.emoji || '📦'} ${item.name} — ${item.id}`)}</option>`
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
  document.getElementById('panneau-catalogue-titre').textContent = recipe ? `Modifier — ${recipe.name}` : 'Nouvelle recette de craft';
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
}

async function rafraichirCataloguePanel() {
  const [catalogue, inventaires] = await Promise.all([
    apiFetch('/api/inventaire/catalogue').then(r => r.json()),
    apiFetch('/api/inventaire').then(r => r.json()),
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
function catalogueValide(liste) {
  return (liste || []).filter(it => it && it.name && !/^__.*__$/.test(String(it.id || '')));
}

// Une image d'objet est utilisable dans le navigateur si c'est une data URL ou
// une URL http(s). Les anciens chemins "/image/items/..." (fichiers du bot)
// ne sont pas accessibles depuis le site : on retombe alors sur l'emoji.
function imageUtilisable(image) {
  return typeof image === 'string' && /^(data:image\/|https?:\/\/)/.test(image);
}

function itemVisuelHTML(item) {
  if (imageUtilisable(item?.image)) {
    return `<span class="item-emoji"><img class="item-img" src="${escapeAttr(item.image)}" alt=""></span>`;
  }
  return `<span class="item-emoji">${item?.emoji || '❔'}</span>`;
}

function classeRariete(rarity) {
  return `rarity-${slugTexte(rarity || 'Commun')}`;
}

function catalogueItemHTML(item) {
  const labelSlot = item.slot ? (state.listes.equipmentSlots || []).find(s => s.id === item.slot)?.label || item.slot : null;
  const rarity = item.rarity || 'Commun';
  return `
    <article class="catalogue-item item-row" data-nom="${escapeAttr(String(item.name || '').toLowerCase())}">
      <div class="catalogue-item-visual">${itemVisuelHTML(item)}</div>
      <div class="item-corps">
        <div class="catalogue-item-title-row">
          <div class="item-nom">${escapeHtml(item.name)}</div>
          <span class="rarity-badge ${classeRariete(rarity)}">✨ ${escapeHtml(rarity)}</span>
        </div>
        <div class="item-description">${escapeHtml(item.description || 'Aucune description.')}</div>
        <div class="item-meta">
          ${labelSlot ? `<span class="badge badge-defaut">🧷 ${escapeHtml(labelSlot)}</span>` : ''}
          ${item.usable ? '<span class="badge badge-defaut">✅ Utilisable</span>' : ''}
          ${Object.entries(item.statBonus || {}).map(([stat, val]) => `<span class="badge badge-defaut">📊 +${val} ${escapeHtml(stat)}</span>`).join('')}
        </div>
      </div>
      <div class="catalogue-item-actions">
        <button class="btn-secondaire" onclick="ouvrirEditeurCatalogue('${jsAttr(item.id)}')">Modifier</button>
        <button class="btn-secondaire btn-danger" onclick="supprimerCatalogueItem('${jsAttr(item.id)}')">Supprimer</button>
      </div>
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
  const q = document.getElementById('recherche').value.trim().toLowerCase();
  const aucun = document.getElementById('aucun-resultat');
  let visibles = 0;

  if (state.collectionActuelle === 'catalogue') {
    document.querySelectorAll('.catalogue-item').forEach(item => {
      const correspond = !q || (item.dataset.nom || '').includes(q);
      item.classList.toggle('masquee', !correspond);
      if (correspond) visibles += 1;
    });
    document.querySelectorAll('.catalogue-categorie').forEach(section => {
      const itemsVisibles = section.querySelectorAll('.catalogue-item:not(.masquee)').length;
      section.classList.toggle('masquee', itemsVisibles === 0);
    });
  } else if (state.collectionActuelle === 'crafts') {
    document.querySelectorAll('.craft-card').forEach(card => {
      const correspond = !q || (card.dataset.nom || '').includes(q);
      card.classList.toggle('masquee', !correspond);
      if (correspond) visibles += 1;
    });
  } else {
    document.querySelectorAll('.contenu .ligne').forEach(l => {
      const correspond = !q || (l.dataset.nom || '').includes(q);
      l.classList.toggle('masquee', !correspond);
      if (correspond) visibles += 1;
    });
  }

  if (aucun) aucun.hidden = visibles !== 0;
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

function formatDateLog(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
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
  const rewardOptions = state.catalogue
    .filter(it => !item || it.id !== item.id)
    .map(it => `<option value="${escapeAttr(it.id)}" ${(useType === 'donner_objet' && useAction?.itemId === it.id) ? 'selected' : ''}>${escapeHtml(it.emoji || '')} ${escapeHtml(it.name)}</option>`)
    .join('');
  const statOptions = (state.listes.defaultStats || [])
    .map(stat => `<option value="${escapeAttr(stat)}" ${(useType === 'stat' && useAction?.stat === stat) ? 'selected' : ''}>${escapeHtml(stat)}</option>`)
    .join('');

  return `
    <div class="section-titre">${isNew ? '➕ Nouvel objet' : "✏️ Modifier l'objet"}</div>
    <div class="grille-champs">
      <div class="champ"><label for="f-item-id">Identifiant (ID)</label><input type="text" id="f-item-id" value="${escapeAttr(item?.id || '')}" placeholder="ex. casque_rare" pattern="[A-Za-z0-9_-]+"><p class="section-note">L'ID permet d'avoir plusieurs objets avec le même nom. Exemple : casque_commun, casque_rare, casque_epique.</p></div>
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

async function supprimerCatalogueItem(itemId) {
  const ok = await confirmerAction({
    titre: "Supprimer l'objet",
    message: 'Supprimer cet objet du catalogue ? Les personnages qui le possèdent garderont son entrée (avec sa quantité), affichée avec un nom générique.',
    texteValider: 'Supprimer',
  });
  if (!ok) return;
  try {
    await fetchJSON(`/api/inventaire/catalogue/${encodeURIComponent(itemId)}`, null, 'DELETE');
    toast('Objet supprimé du catalogue.', 'succes');
    await rafraichirCataloguePanel();
  } catch (error) {
    toast(`Échec de la suppression : ${error.message}`, 'erreur');
  }
}

async function supprimerTousLesObjets() {
  if (!state.catalogue.length) return;
  const ok = await confirmerAction({
    titre: 'Vider le catalogue',
    message: `Supprimer les ${state.catalogue.length} objets du catalogue ? Les personnages qui en possèdent garderont leur quantité, affichée avec un nom générique. Cette action est irréversible.`,
    texteValider: 'Tout supprimer',
  });
  if (!ok) return;
  try {
    await fetchJSON('/api/inventaire/catalogue', null, 'DELETE');
    toast('Catalogue vidé.', 'succes');
    await rafraichirCataloguePanel();
  } catch (error) {
    toast(`Échec de la suppression : ${error.message}`, 'erreur');
  }
}

// -----------------------------------------------------------------------
// Panneau d'édition - inventaire d'un personnage
// -----------------------------------------------------------------------
function ouvrirInventairePersonnage(profileId) {
  const profile = state.cache.profils.find(p => p._id === profileId);
  if (!profile) return;
  const inventoryDoc = (state.cache.inventaires || []).find(inv => inv._id === profileId);

  state.itemActuel = { type: 'inventaire', id: profileId };
  document.getElementById('panneau-eyebrow').textContent = 'Inventaire';
  document.getElementById('panneau-titre').textContent = profile.nomPrenom || profile._id;
  document.getElementById('panneau-corps').innerHTML = panneauInventairePersonnage(profile, inventoryDoc);

  document.getElementById('overlay').classList.add('visible');
  document.getElementById('panneau-edition').classList.add('ouvert');
}

function panneauInventairePersonnage(profile, inventoryDoc) {
  const items = inventoryDoc?.items || {};
  const entrees = Object.entries(items);

  const lignes = entrees.map(([itemId, qty]) => {
    const catalogItem = state.catalogue.find(it => it.id === itemId) || { id: itemId, name: itemId, emoji: '❔' };
    return `
      <div class="item-row">
        ${itemVisuelHTML(catalogItem)}
        <div class="item-corps">
          <div class="item-nom">${escapeHtml(catalogItem.name)}</div>
          <div class="item-meta"><span class="badge badge-defaut">✨ ${escapeHtml(catalogItem.rarity || 'Commun')}</span></div>
        </div>
        <input type="number" min="0" class="qte-input" id="qte-${escapeAttr(itemId)}" value="${qty}">
        <button class="btn-secondaire" onclick="modifierQuantiteItem('${jsAttr(profile._id)}', '${jsAttr(itemId)}')">OK</button>
        <button class="btn-secondaire btn-danger" onclick="supprimerItemPersonnage('${jsAttr(profile._id)}', '${jsAttr(itemId)}')">✕</button>
      </div>`;
  }).join('');

  const optionsCatalogue = state.catalogue.map(it => `<option value="${escapeAttr(it.id)}">${escapeHtml(it.emoji || '')} ${escapeHtml(it.name)}</option>`).join('');

  return `
    <div class="section-titre">🎒 Objets possédés</div>
    <div id="inv-items-liste">${lignes || '<p class="section-note">Inventaire vide.</p>'}</div>

    <div class="section-titre" style="margin-top:26px">➕ Ajouter un objet</div>
    <div class="ligne-ajout">
      <select id="f-ajout-item">${optionsCatalogue || '<option value="">Catalogue vide</option>'}</select>
      <input type="number" id="f-ajout-qte" min="1" value="1" style="flex:0 0 70px">
      <button class="btn-secondaire" onclick="ajouterItemPersonnage('${jsAttr(profile._id)}')">Ajouter</button>
    </div>`;
}

async function rafraichirInventairePersonnage(profileId) {
  const inventaires = await apiFetch('/api/inventaire').then(r => r.json());
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
  const total = inv ? Object.values(inv.items || {}).reduce((a, b) => a + b, 0) : 0;
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
  await chargerProfils();
  filtrerListe();
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
// Confirmation (remplace window.confirm par une modale du même style que le
// reste du site). confirmerAction() retourne une Promise<boolean> : true si
// la personne a cliqué "Valider", false sinon (Annuler, croix, clic dehors,
// touche Échap) — s'utilise avec await, comme confirm() mais async.
// -----------------------------------------------------------------------
let _resoudreConfirmEnCours = null;

function confirmerAction({ titre = 'Confirmer', message = '', texteValider = 'Valider' } = {}) {
  document.getElementById('confirm-titre').textContent = titre;
  document.getElementById('confirm-message').textContent = message;
  document.getElementById('confirm-valider').textContent = texteValider;
  document.getElementById('confirm-overlay').classList.add('visible');

  return new Promise((resolve) => {
    _resoudreConfirmEnCours = resolve;
  });
}

function resoudreConfirm(valeur) {
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