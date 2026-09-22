// =============================================================================
// RP Admin — logique front
// Site et API sur le même serveur : tous les appels utilisent des chemins
// relatifs ("/api/..."), pas d'IP à configurer.
// =============================================================================

const state = {
  cache: { profils: [], inventaires: [] },
  catalogue: [],
  statuts: [],
  listes: { relationFactions: [], relationLevels: [], defaultStats: [], statMax: 10 },
  collectionActuelle: null,
  itemActuel: null, // { type: 'profil' | 'catalogue' | 'inventaire', id }
};

// -----------------------------------------------------------------------
// Démarrage
// -----------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  genererEtoiles();
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fermerPanneau(); });

  Promise.allSettled([
    fetch('/api/profils').then(r => r.json()).then(d => { state.cache.profils = d; majCompteur('profils', d.length); }),
    fetch('/api/statuts').then(r => r.json()).then(d => { state.statuts = d; }),
    fetch('/api/lists').then(r => r.json()).then(d => { state.listes = d; }),
  ]).then(() => setStatutConnexion(true));
});

function genererEtoiles() {
  const conteneur = document.getElementById('particules');
  const n = window.innerWidth < 700 ? 12 : 28;
  for (let i = 0; i < n; i++) {
    const b = document.createElement('div');
    b.className = 'etoile';
    b.style.setProperty('--s', `${1.5 + Math.random() * 3}px`);
    b.style.left = `${Math.random() * 100}%`;
    b.style.setProperty('--dur-fly', `${9 + Math.random() * 10}s`);
    b.style.setProperty('--delay', `${Math.random() * 12}s`);
    b.style.setProperty('--drift', `${(Math.random() - 0.5) * 120}px`);
    conteneur.appendChild(b);
  }
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
// Chargement d'une catégorie : "Profils RP" ou "Inventaire"
// -----------------------------------------------------------------------
async function chargerDonnees(collection) {
  state.collectionActuelle = collection;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.collection === collection));

  const searchWrap = document.getElementById('search-wrap');
  searchWrap.hidden = false;
  const rechercheInput = document.getElementById('recherche');
  rechercheInput.value = '';
  rechercheInput.placeholder = 'Rechercher un personnage...';

  if (collection === 'profils') {
    document.getElementById('titre-section').textContent = 'Profils RP';
    document.getElementById('sous-titre').textContent = 'Personnages joués sur le serveur.';
    await chargerProfils();
  } else if (collection === 'inventaire') {
    document.getElementById('titre-section').textContent = 'Inventaire';
    document.getElementById('sous-titre').textContent = "Catalogue d'objets et inventaires des personnages.";
    await chargerInventairePage();
  }
}

async function chargerProfils() {
  const contenuDiv = document.getElementById('contenu');
  contenuDiv.innerHTML = Array.from({ length: 5 }).map(() => '<div class="squelette"></div>').join('');

  try {
    const response = await fetch('/api/profils');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.cache.profils = data;
    majCompteur('profils', data.length);
    renderListeProfils(data);
    setStatutConnexion(true);
  } catch (error) {
    contenuDiv.innerHTML = `<div class="etat-vide"><div class="etat-vide-icone">⚠️</div><p>Erreur de connexion à l'API</p><span class="etat-vide-sub">${escapeHtml(error.message)} — vérifie que le serveur (web/server.js) tourne et que tu es bien authentifié.</span></div>`;
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
          <span class="badge ${statutBadge}">${escapeHtml(item.statut || '—')}</span>
          <span class="badge badge-defaut">${escapeHtml(item.roleName || 'Sans rôle')}${item.categoryName ? ` — ${escapeHtml(item.categoryName)}` : ''}</span>
        </div>
      </div>
      <button class="btn-modifier" onclick="ouvrirEditeur('${jsAttr(item._id)}')">Modifier</button>
    </div>`;
}

// -----------------------------------------------------------------------
// Inventaire : catalogue d'objets (haut de page) + inventaire par personnage
// -----------------------------------------------------------------------
async function chargerInventairePage() {
  const contenuDiv = document.getElementById('contenu');
  contenuDiv.innerHTML = Array.from({ length: 3 }).map(() => '<div class="squelette"></div>').join('');

  try {
    const [catalogue, inventaires, profils] = await Promise.all([
      fetch('/api/inventaire/catalogue').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
      fetch('/api/inventaire').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
      state.cache.profils.length ? Promise.resolve(state.cache.profils) : fetch('/api/profils').then(r => r.json()),
    ]);
    state.catalogue = catalogue;
    state.cache.inventaires = inventaires;
    state.cache.profils = profils;
    majCompteur('inventaire', profils.length);

    const quantiteParProfil = new Map(
      inventaires.map(inv => [inv._id, Object.values(inv.items || {}).reduce((a, b) => a + b, 0)])
    );

    contenuDiv.innerHTML = `
      <div class="section-titre">📦 Catalogue d'objets</div>
      <div id="catalogue-liste">${catalogue.map(catalogueItemHTML).join('') || '<p class="section-note">Catalogue vide.</p>'}</div>
      <button class="btn-secondaire" onclick="ouvrirEditeurCatalogue(null)">+ Ajouter un objet</button>

      <div class="section-titre" style="margin-top:34px">👤 Inventaires par personnage</div>
      <div id="liste-personnages">
        ${profils.map((p, i) => ligneInventaireHTML(p, quantiteParProfil.get(p._id) || 0, i)).join('') || "<div class='etat-vide'><p>Aucun personnage.</p></div>"}
      </div>
      <div class="aucun-resultat" id="aucun-resultat" hidden>Aucun résultat pour cette recherche.</div>
    `;
    setStatutConnexion(true);
  } catch (error) {
    contenuDiv.innerHTML = `<div class="etat-vide"><div class="etat-vide-icone">⚠️</div><p>Erreur de connexion à l'API</p><span class="etat-vide-sub">${escapeHtml(error.message)}</span></div>`;
    setStatutConnexion(false);
    console.error('Erreur Fetch:', error);
  }
}

function catalogueItemHTML(item) {
  return `
    <div class="item-row">
      <span class="item-emoji">${item.emoji || '❔'}</span>
      <div class="item-corps">
        <div class="item-nom">${escapeHtml(item.name)}</div>
        <div class="item-meta"><span class="badge badge-defaut">${escapeHtml(item.category || 'Divers')}</span></div>
      </div>
      <button class="btn-secondaire" onclick="ouvrirEditeurCatalogue('${jsAttr(item.id)}')">Modifier</button>
      <button class="btn-secondaire btn-danger" onclick="supprimerCatalogueItem('${jsAttr(item.id)}')">Supprimer</button>
    </div>`;
}

function ligneInventaireHTML(profile, quantiteTotale, index) {
  const delay = `${Math.min(index, 14) * 35}ms`;
  return `
    <div class="ligne" style="--i:${delay}" data-nom="${escapeAttr((profile.nomPrenom || profile._id).toLowerCase())}">
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
  const lignes = document.querySelectorAll('.ligne');
  let visibles = 0;
  lignes.forEach(l => {
    const correspond = !q || (l.dataset.nom || '').includes(q);
    l.classList.toggle('masquee', !correspond);
    if (correspond) visibles += 1;
  });
  const aucun = document.getElementById('aucun-resultat');
  if (aucun) aucun.hidden = visibles !== 0;
}

// -----------------------------------------------------------------------
// Panneau d'édition — profil
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

  document.getElementById('overlay').classList.add('visible');
  document.getElementById('panneau-edition').classList.add('ouvert');
}

function fermerPanneau() {
  document.getElementById('overlay').classList.remove('visible');
  document.getElementById('panneau-edition').classList.remove('ouvert');
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
      return `<option value="${val}" ${niveau === val ? 'selected' : ''}>${val} — ${escapeHtml(label)}</option>`;
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
    <div class="portrait-profil">
      <img id="apercu-portrait" src="/api/profils/${encodeURIComponent(p._id)}/avatar" alt="Portrait de ${escapeAttr(p.nomPrenom || '')}"
           onerror="this.closest('.portrait-profil').classList.add('sans-image')">
      <div class="portrait-fallback">🖼️</div>
    </div>
    <div class="champ champ-image">
      <label for="f-portrait">Changer l'image</label>
      <input type="file" id="f-portrait" accept="image/*" onchange="previewPortrait(this)">
    </div>

    <div class="section-titre">🪶 Identité</div>
    <p class="section-note">⚠️ Modifier le rôle/faction ici ne change QUE ce qui est affiché — ça n'attribue pas le rôle Discord réel au joueur (à faire en plus sur Discord si besoin).</p>
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
  if (!faction) return '<option value="">—</option>';
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
// Panneau d'édition — objet du catalogue (ajout ou modification)
// -----------------------------------------------------------------------
function ouvrirEditeurCatalogue(itemId) {
  const item = itemId ? state.catalogue.find(it => it.id === itemId) : null;
  state.itemActuel = { type: 'catalogue', id: itemId };

  document.getElementById('panneau-eyebrow').textContent = 'Catalogue';
  document.getElementById('panneau-titre').textContent = item ? item.name : 'Nouvel objet';
  document.getElementById('panneau-corps').innerHTML = panneauCatalogueItem(item);

  document.getElementById('overlay').classList.add('visible');
  document.getElementById('panneau-edition').classList.add('ouvert');
}

function panneauCatalogueItem(item) {
  const isNew = !item;
  return `
    <div class="section-titre">${isNew ? '➕ Nouvel objet' : "✏️ Modifier l'objet"}</div>
    <div class="grille-champs">
      <div class="champ"><label for="f-item-name">Nom</label><input type="text" id="f-item-name" value="${escapeAttr(item?.name || '')}"></div>
      <div class="champ"><label for="f-item-emoji">Emoji</label><input type="text" id="f-item-emoji" value="${escapeAttr(item?.emoji || '')}" maxlength="4"></div>
      <div class="champ"><label for="f-item-category">Catégorie</label><input type="text" id="f-item-category" value="${escapeAttr(item?.category || '')}" placeholder="Arme, Équipement, Ressource..."></div>
    </div>
    <div class="champ"><label for="f-item-description">Description</label><textarea id="f-item-description">${escapeHtml(item?.description || '')}</textarea></div>

    <div class="actions-panneau">
      <button class="btn-principal" id="btn-enregistrer" onclick="sauvegarderCatalogueItem(${isNew ? 'null' : `'${jsAttr(item.id)}'`})">${isNew ? "Créer l'objet" : 'Enregistrer les modifications'}</button>
    </div>`;
}

async function sauvegarderCatalogueItem(itemId) {
  const btn = document.getElementById('btn-enregistrer');
  const texteOriginal = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span>Enregistrement...';

  try {
    const payload = {
      name: val('f-item-name'),
      emoji: val('f-item-emoji'),
      category: val('f-item-category'),
      description: val('f-item-description'),
    };
    if (itemId) {
      await fetchJSON(`/api/inventaire/catalogue/${encodeURIComponent(itemId)}`, payload, 'PATCH');
    } else {
      await fetchJSON('/api/inventaire/catalogue', payload, 'POST');
    }
    toast('Objet enregistré avec succès.', 'succes');
    fermerPanneau();
    await chargerInventairePage();
  } catch (error) {
    toast(`Échec de la sauvegarde : ${error.message}`, 'erreur');
    console.error(error);
  } finally {
    btn.disabled = false;
    btn.textContent = texteOriginal;
  }
}

async function supprimerCatalogueItem(itemId) {
  if (!confirm('Supprimer cet objet du catalogue ? Les personnages qui le possèdent garderont son entrée (avec sa quantité), affichée avec un nom générique.')) return;
  try {
    await fetchJSON(`/api/inventaire/catalogue/${encodeURIComponent(itemId)}`, null, 'DELETE');
    toast('Objet supprimé du catalogue.', 'succes');
    await chargerInventairePage();
  } catch (error) {
    toast(`Échec de la suppression : ${error.message}`, 'erreur');
  }
}

// -----------------------------------------------------------------------
// Panneau d'édition — inventaire d'un personnage
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
        <span class="item-emoji">${catalogItem.emoji || '❔'}</span>
        <div class="item-corps"><div class="item-nom">${escapeHtml(catalogItem.name)}</div></div>
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
  await chargerInventairePage();
  ouvrirInventairePersonnage(profileId);
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
// Sauvegarde — profil
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
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const texte = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} ${texte}`.trim());
  }
  return response.json();
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
