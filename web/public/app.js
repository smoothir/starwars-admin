// =============================================================================
// Westeros Admin — logique front
// Site et API sur le même serveur : tous les appels utilisent des chemins
// relatifs ("/api/..."), pas d'IP à configurer.
// =============================================================================

const state = {
  cache: { maisons: [], regions: [], profils: [] },
  statuts: [],
  listes: { titres: [], regions: [], maisons: [] },
  collectionActuelle: null,
  itemActuel: null, // { collection, id }
};

const TYPES_MAISON = [
  { valeur: 'majeure', label: 'Majeure' },
  { valeur: 'mineure', label: 'Mineure' },
  { valeur: 'clan', label: 'Clan' },
];
const NIVEAUX_RICHESSE = ['Très faible', 'Faible', 'Moyenne', 'Élevée', 'Très élevée'];

// -----------------------------------------------------------------------
// Démarrage
// -----------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  genererBraises();
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fermerPanneau(); });

  // Préchargement silencieux (pour les compteurs de la sidebar et les
  // menus déroulants — ex: liste des maisons quand on édite une région).
  Promise.allSettled([
    fetch('/api/maisons').then(r => r.json()).then(d => { state.cache.maisons = d; majCompteur('maisons', d.length); }),
    fetch('/api/regions').then(r => r.json()).then(d => { state.cache.regions = d; majCompteur('regions', d.length); }),
    fetch('/api/profils').then(r => r.json()).then(d => { state.cache.profils = d; majCompteur('profils', d.length); }),
    fetch('/api/statuts').then(r => r.json()).then(d => { state.statuts = d; }),
    fetch('/api/lists').then(r => r.json()).then(d => { state.listes = d; }),
  ]).then(() => setStatutConnexion(true));
});

function genererBraises() {
  const conteneur = document.getElementById('particules');
  const n = window.innerWidth < 700 ? 10 : 22;
  for (let i = 0; i < n; i++) {
    const b = document.createElement('div');
    b.className = 'braise';
    b.style.setProperty('--s', `${2 + Math.random() * 4}px`);
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
// Chargement d'une catégorie
// -----------------------------------------------------------------------
async function chargerDonnees(collection) {
  state.collectionActuelle = collection;

  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.collection === collection));

  const titres = {
    profils: ['Profils RP', 'Personnages joués sur le serveur.'],
    maisons: ['Les Grandes Maisons', 'Maisons majeures, mineures et clans de Westeros.'],
    regions: ['Régions de Westeros & Essos', 'Territoires, politiques et forces en présence.'],
  };
  document.getElementById('titre-section').textContent = titres[collection][0];
  document.getElementById('sous-titre').textContent = titres[collection][1];

  const searchWrap = document.getElementById('search-wrap');
  searchWrap.hidden = false;
  const rechercheInput = document.getElementById('recherche');
  rechercheInput.value = '';
  rechercheInput.placeholder = collection === 'profils' ? 'Rechercher un personnage...' : 'Rechercher un nom...';

  const contenuDiv = document.getElementById('contenu');
  contenuDiv.innerHTML = Array.from({ length: 5 }).map(() => '<div class="squelette"></div>').join('');

  try {
    const response = await fetch(`/api/${collection}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.cache[collection] = data;
    majCompteur(collection, data.length);
    renderListe(collection, data);
    setStatutConnexion(true);
  } catch (error) {
    contenuDiv.innerHTML = `<div class="etat-vide"><div class="etat-vide-icone">⚠️</div><p>Erreur de connexion à l'API</p><span class="etat-vide-sub">${escapeHtml(error.message)} — vérifie que le serveur (web/server.js) tourne et que tu es bien authentifié.</span></div>`;
    setStatutConnexion(false);
    console.error('Erreur Fetch:', error);
  }
}

function renderListe(collection, data) {
  const contenuDiv = document.getElementById('contenu');
  if (!data || data.length === 0) {
    contenuDiv.innerHTML = "<div class='etat-vide'><div class='etat-vide-icone'>🕸️</div><p>Aucune donnée trouvée</p></div>";
    return;
  }
  contenuDiv.innerHTML = data.map((item, i) => ligneHTML(collection, item, i)).join('') +
    '<div class="aucun-resultat" id="aucun-resultat" hidden>Aucun résultat pour cette recherche.</div>';
}

function ligneHTML(collection, item, index) {
  const delay = `${Math.min(index, 14) * 35}ms`;
  if (collection === 'maisons') {
    const typeLabel = (TYPES_MAISON.find(t => t.valeur === item.type) || { label: item.type }).label;
    const typeBadge = item.type === 'majeure' ? 'badge-or' : item.type === 'clan' ? 'badge-vert' : 'badge-acier';
    return `
      <div class="ligne" style="--i:${delay}" data-nom="${escapeAttr((item.nom + ' ' + item.region).toLowerCase())}">
        <div class="ligne-sigil">🏰</div>
        <div class="ligne-corps">
          <div class="ligne-nom">${escapeHtml(item.nom)}</div>
          <div class="ligne-meta">
            <span class="badge ${typeBadge}">${escapeHtml(typeLabel)}</span>
            <span class="badge badge-defaut">${escapeHtml(item.region)}</span>
          </div>
        </div>
        <button class="btn-modifier" onclick="ouvrirEditeur('maisons', '${jsAttr(item.key)}')">Modifier</button>
      </div>`;
  }
  if (collection === 'regions') {
    const richesseBadge = ['Élevée', 'Très élevée'].includes(item.richesse) ? 'badge-or'
      : item.richesse === 'Moyenne' ? 'badge-acier' : 'badge-sang';
    return `
      <div class="ligne" style="--i:${delay}" data-nom="${escapeAttr((item.nom + ' ' + (item.maisonDirigeante || '')).toLowerCase())}">
        <div class="ligne-sigil">🗺️</div>
        <div class="ligne-corps">
          <div class="ligne-nom">${escapeHtml(item.nom)}</div>
          <div class="ligne-meta">
            <span class="badge ${richesseBadge}">${escapeHtml(item.richesse || '—')}</span>
            <span class="badge badge-defaut">${escapeHtml(item.maisonDirigeante || 'Aucune maison')}</span>
          </div>
        </div>
        <button class="btn-modifier" onclick="ouvrirEditeur('regions', '${jsAttr(item.key)}')">Modifier</button>
      </div>`;
  }
  // profils
  const statutBadge = item.statut === 'Vivant' ? 'badge-vert' : item.statut === 'Mort' ? 'badge-sang'
    : item.statut === 'Prisonnier' ? 'badge-acier' : 'badge-or';
  return `
    <div class="ligne" style="--i:${delay}" data-nom="${escapeAttr(((item.nomPrenom || item._id) + ' ' + (item.maisonName || '')).toLowerCase())}">
      <div class="ligne-sigil">👤</div>
      <div class="ligne-corps">
        <div class="ligne-nom">${escapeHtml(item.nomPrenom || item._id)}</div>
        <div class="ligne-meta">
          <span class="badge ${statutBadge}">${escapeHtml(item.statut || '—')}</span>
          <span class="badge badge-defaut">${escapeHtml(item.maisonName || 'Sans maison')}</span>
        </div>
      </div>
      <button class="btn-modifier" onclick="ouvrirEditeur('profils', '${jsAttr(item._id)}')">Modifier</button>
    </div>`;
}

function filtrerListe() {
  const q = document.getElementById('recherche').value.trim().toLowerCase();
  const lignes = document.querySelectorAll('.ligne');
  let visibles = 0;
  lignes.forEach(l => {
    const correspond = !q || l.dataset.nom.includes(q);
    l.classList.toggle('masquee', !correspond);
    if (correspond) visibles += 1;
  });
  const aucun = document.getElementById('aucun-resultat');
  if (aucun) aucun.hidden = visibles !== 0;
}

// -----------------------------------------------------------------------
// Panneau d'édition
// -----------------------------------------------------------------------
function ouvrirEditeur(collection, id) {
  const item = state.cache[collection].find(x => (collection === 'profils' ? x._id : x.key) === id);
  if (!item) return;

  state.itemActuel = { collection, id };
  document.getElementById('panneau-eyebrow').textContent =
    collection === 'maisons' ? 'Maison' : collection === 'regions' ? 'Région' : 'Profil';
  document.getElementById('panneau-titre').textContent =
    collection === 'profils' ? (item.nomPrenom || item._id) : item.nom;

  const corps = document.getElementById('panneau-corps');
  corps.innerHTML = collection === 'maisons' ? panneauMaison(item)
    : collection === 'regions' ? panneauRegion(item)
    : panneauProfil(item);

  document.getElementById('overlay').classList.add('visible');
  document.getElementById('panneau-edition').classList.add('ouvert');
}

function fermerPanneau() {
  document.getElementById('overlay').classList.remove('visible');
  document.getElementById('panneau-edition').classList.remove('ouvert');
  state.itemActuel = null;
}

// ---------- Gabarits des formulaires ----------
function tuileArmee(icone, label, id, valeur) {
  return `
    <div class="armee-tile">
      <span class="armee-icone">${icone}</span>
      <span class="armee-label">${label}</span>
      <input type="number" id="${id}" value="${valeur ?? 0}" min="0">
    </div>`;
}

function panneauMaison(m) {
  const estClan = m.armee && m.armee.guerriers !== undefined;
  const optionsType = TYPES_MAISON.map(t => `<option value="${t.valeur}" ${m.type === t.valeur ? 'selected' : ''}>${t.label}</option>`).join('')
    + (TYPES_MAISON.some(t => t.valeur === m.type) ? '' : `<option value="${escapeAttr(m.type)}" selected>${escapeHtml(m.type)}</option>`);
  const regionsOptions = [...new Set(state.cache.regions.map(r => r.nom))];
  const optionsRegionMaison = regionsOptions.map(n => `<option value="${escapeAttr(n)}" ${m.region === n ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')
    + (regionsOptions.includes(m.region) ? '' : `<option value="${escapeAttr(m.region || '')}" selected>${escapeHtml(m.region || '(vide)')}</option>`);

  const armeeHTML = estClan ? `
      <div class="armee-grid">
        ${tuileArmee('⚔️', 'Guerriers', 'f-armee-guerriers', m.armee.guerriers)}
        ${tuileArmee('🏹', 'Archers', 'f-armee-archers', m.armee.archers)}
        ${tuileArmee('🐺', 'Éclaireurs', 'f-armee-eclaireurs', m.armee.eclaireurs)}
      </div>` : `
      <div class="armee-grid">
        ${tuileArmee('🛡️', 'Fantassins', 'f-armee-fantassins', m.armee?.fantassins)}
        ${tuileArmee('🏹', 'Archers', 'f-armee-archers', m.armee?.archers)}
        ${tuileArmee('🐎', 'Cavalerie', 'f-armee-cavalerie', m.armee?.cavalerie)}
        ${tuileArmee('⛵', 'Flotte', 'f-armee-flotte', m.armee?.flotte)}
      </div>
      <div class="champ" style="margin-top:10px;">
        <label for="f-armee-noteFlotte">Note sur la flotte (optionnel)</label>
        <input type="text" id="f-armee-noteFlotte" value="${escapeAttr(m.armee?.noteFlotte || '')}" placeholder="ex : Redwyne">
      </div>`;

  return `
    <div class="section-titre">🏛️ Fiche officielle</div>
    <div class="grille-champs">
      <div class="champ"><label for="f-nom">Nom de la maison</label><input type="text" id="f-nom" value="${escapeAttr(m.nom)}"></div>
      <div class="champ"><label for="f-type">Type</label>
        <select id="f-type">${optionsType}</select>
      </div>
      <div class="champ"><label for="f-region">Région</label>
        <select id="f-region">${optionsRegionMaison}</select>
      </div>
      <div class="champ"><label for="f-croyance">Croyance</label><input type="text" id="f-croyance" value="${escapeAttr(m.croyance)}"></div>
      <div class="champ"><label for="f-uniteSpeciale">Unité spéciale</label><input type="text" id="f-uniteSpeciale" value="${escapeAttr(m.uniteSpeciale)}"></div>
      <div class="champ"><label for="f-renommee">Renommée (de base)</label><input type="number" id="f-renommee" value="${m.renommeeBase}"></div>
      <div class="champ"><label for="f-argent">Argent (en nombre)</label><input type="number" id="f-argent" value="${Number.isFinite(m.argentBase) ? m.argentBase : 0}"></div>
    </div>

    <div class="section-titre">⚔️ Armée</div>
    ${armeeHTML}

    <div class="section-titre">⚡ État de partie (override)</div>
    <p class="section-note">Si rempli, une valeur ici prend le pas sur la fiche officielle côté Discord (utile pour un ajustement temporaire sans toucher au canon).</p>
    <div class="grille-champs">
      <div class="champ"><label for="f-renommeeOverride">Renommée (override)</label><input type="number" id="f-renommeeOverride" value="${m.renommeeOverride ?? ''}" placeholder="—"></div>
      <div class="champ"><label for="f-argentOverride">Argent (override)</label><input type="number" id="f-argentOverride" value="${m.argentOverride ?? ''}" placeholder="—"></div>
    </div>
    <div class="champ"><label for="f-leaderId">ID Discord du chef de maison</label><input type="text" id="f-leaderId" value="${escapeAttr(m.leaderId || '')}" placeholder="—"></div>

    <div class="section-titre">📜 Historique</div>
    ${historiqueHTML(m.historique)}

    <div class="actions-panneau">
      <button class="btn-principal" id="btn-enregistrer" onclick="sauvegarder()">Enregistrer les modifications</button>
    </div>`;
}

function panneauRegion(r) {
  const noArmee = r.armee === null || r.armee === undefined;
  const maisonsOptions = [...new Set(state.cache.maisons.map(m => m.nom))];
  const specialesDirigeante = ['Aucune', 'La Couronne (aucune maison fixe)'];
  const toutesOptionsDirigeante = [...specialesDirigeante, ...maisonsOptions];
  const optionsMaisonDirigeante = toutesOptionsDirigeante
    .map(n => `<option value="${escapeAttr(n)}" ${r.maisonDirigeante === n ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')
    + (toutesOptionsDirigeante.includes(r.maisonDirigeante) ? '' : `<option value="${escapeAttr(r.maisonDirigeante || '')}" selected>${escapeHtml(r.maisonDirigeante || '(vide)')}</option>`);
  const climatsDatalist = [...new Set(state.cache.regions.map(x => x.climat).filter(Boolean))];
  const optionsRichesse = NIVEAUX_RICHESSE.map(niv => `<option value="${niv}" ${r.richesse === niv ? 'selected' : ''}>${niv}</option>`).join('')
    + (NIVEAUX_RICHESSE.includes(r.richesse) ? '' : `<option value="${escapeAttr(r.richesse)}" selected>${escapeHtml(r.richesse)}</option>`);

  return `
    <div class="section-titre">🏛️ Fiche officielle</div>
    <div class="grille-champs">
      <div class="champ"><label for="f-nom">Nom de la région</label><input type="text" id="f-nom" value="${escapeAttr(r.nom)}"></div>
      <div class="champ"><label for="f-maisonDirigeante">Maison dirigeante</label>
        <select id="f-maisonDirigeante">${optionsMaisonDirigeante}</select>
      </div>
      <div class="champ"><label for="f-capitale">Capitale</label><input type="text" id="f-capitale" value="${escapeAttr(r.capitale || '')}"></div>
      <div class="champ"><label for="f-climat">Climat</label>
        <input type="text" id="f-climat" value="${escapeAttr(r.climat || '')}" list="dl-climats">
        <datalist id="dl-climats">${climatsDatalist.map(c => `<option value="${escapeAttr(c)}">`).join('')}</datalist>
      </div>
      <div class="champ"><label for="f-specialite">Spécialité</label><input type="text" id="f-specialite" value="${escapeAttr(r.specialite || '')}"></div>
      <div class="champ"><label for="f-richesse">Richesse</label><select id="f-richesse">${optionsRichesse}</select></div>
    </div>
    <div class="champ"><label for="f-statutPolitique">Statut politique</label><textarea id="f-statutPolitique">${escapeHtml(r.statutPolitiqueBase || '')}</textarea></div>
    <div class="champ" style="max-width:220px;"><label for="f-instabilite">Instabilité (0-100)</label><input type="number" id="f-instabilite" min="0" max="100" value="${r.instabiliteBase ?? 0}"></div>

    <div class="section-titre">⚔️ Armée</div>
    <div class="champ" style="display:flex; align-items:center; gap:8px; flex-direction:row;">
      <input type="checkbox" id="f-armee-vide" style="width:auto;" ${noArmee ? 'checked' : ''} onchange="document.getElementById('bloc-armee-region').style.opacity = this.checked ? 0.35 : 1; document.getElementById('bloc-armee-region').style.pointerEvents = this.checked ? 'none' : 'auto';">
      <label for="f-armee-vide" style="margin:0; text-transform:none; font-size:0.82rem; color:var(--text-secondary);">Aucune force armée recensée pour cette région</label>
    </div>
    <div id="bloc-armee-region" class="armee-grid" style="${noArmee ? 'opacity:0.35; pointer-events:none;' : ''}">
      ${tuileArmee('🛡️', 'Troupes', 'f-armee-troupes', r.armee?.troupes)}
      ${tuileArmee('🏹', 'Archers', 'f-armee-archers', r.armee?.archers)}
      ${tuileArmee('🐎', 'Cavalerie', 'f-armee-cavalerie', r.armee?.cavalerie)}
      ${tuileArmee('🐺', 'Éclaireurs', 'f-armee-eclaireurs', r.armee?.eclaireurs)}
      ${tuileArmee('⛵', 'Flotte', 'f-armee-flotte', r.armee?.flotte)}
    </div>

    <div class="section-titre">⚡ État de partie (override)</div>
    <p class="section-note">Si rempli, prend le pas sur la fiche officielle côté Discord.</p>
    <div class="champ"><label for="f-statutOverride">Statut politique (override)</label><textarea id="f-statutOverride" placeholder="—">${escapeHtml(r.statutOverride || '')}</textarea></div>
    <div class="champ" style="max-width:220px;"><label for="f-instabiliteOverride">Instabilité (override)</label><input type="number" id="f-instabiliteOverride" min="0" max="100" value="${r.instabiliteOverride ?? ''}" placeholder="—"></div>

    <div class="section-titre">📜 Historique</div>
    ${historiqueHTML(r.historique)}

    <div class="actions-panneau">
      <button class="btn-principal" id="btn-enregistrer" onclick="sauvegarder()">Enregistrer les modifications</button>
    </div>`;
}

function panneauProfil(p) {
  const optionsStatut = (state.statuts.length ? state.statuts : ['Vivant', 'Blessé', 'Prisonnier', 'Mort'])
    .map(s => `<option value="${s}" ${p.statut === s ? 'selected' : ''}>${s}</option>`).join('');

  const optionsMaison = state.listes.maisons
    .map(m => `<option value="${escapeAttr(m)}" ${p.maisonName === m ? 'selected' : ''}>${m}</option>`).join('');
  const optionsRegion = state.listes.regions
    .map(r => `<option value="${escapeAttr(r)}" ${p.regionName === r ? 'selected' : ''}>${r}</option>`).join('');
  const optionsRole = state.listes.titres
    .map(t => `<option value="${escapeAttr(t)}" ${p.roleName === t ? 'selected' : ''}>${t}</option>`).join('');

  return `
    <div class="portrait-profil">
      <img src="/api/profils/${encodeURIComponent(p._id)}/avatar" alt="Portrait de ${escapeAttr(p.nomPrenom || '')}"
           onerror="this.closest('.portrait-profil').classList.add('sans-image')">
      <div class="portrait-fallback">🖼️</div>
    </div>

    <div class="section-titre">🪶 Identité</div>
    <div class="grille-champs">
      <div class="champ"><label>Nom</label><input type="text" value="${escapeAttr(p.nomPrenom || '')}" disabled></div>
      <div class="champ"><label>Surnom</label><input type="text" value="${escapeAttr(p.surnom || '')}" disabled></div>
      <div class="champ"><label for="f-maisonName">Maison</label><select id="f-maisonName">${optionsMaison}</select></div>
      <div class="champ"><label for="f-regionName">Région</label><select id="f-regionName">${optionsRegion}</select></div>
      <div class="champ"><label for="f-roleName">Rôle</label><select id="f-roleName">${optionsRole}</select></div>
    </div>

    <div class="section-titre">✒️ Fiche modifiable</div>
    <div class="grille-champs">
      <div class="champ"><label for="f-statut">Statut</label><select id="f-statut">${optionsStatut}</select></div>
      <div class="champ"><label for="f-renommee">Renommée</label><input type="number" id="f-renommee" value="${p.renommee ?? 0}"></div>
      <div class="champ"><label for="f-gardePersonnelle">Garde personnelle</label><input type="text" id="f-gardePersonnelle" value="${escapeAttr(p.gardePersonnelle || '')}"></div>
      <div class="champ"><label for="f-boursePersonnelle">Bourse personnelle</label><input type="text" id="f-boursePersonnelle" value="${escapeAttr(p.boursePersonnelle || '')}"></div>
      <div class="champ"><label for="f-allies">Alliés</label><input type="text" id="f-allies" value="${escapeAttr(p.allies || '')}"></div>
      <div class="champ"><label for="f-rivaux">Rivaux</label><input type="text" id="f-rivaux" value="${escapeAttr(p.rivaux || '')}"></div>
    </div>
    <div class="champ"><label for="f-notes">Notes</label><textarea id="f-notes">${escapeHtml(p.notes || '')}</textarea></div>

    <div class="actions-panneau">
      <button class="btn-principal" id="btn-enregistrer" onclick="sauvegarder()">Enregistrer les modifications</button>
    </div>`;
}

function historiqueHTML(historique) {
  const lignes = (historique || []).map(h =>
    `<li>${escapeHtml(h.texte)} <span>— ${escapeHtml(h.auteurLabel || 'Inconnu')}</span></li>`
  ).join('');
  return `
    <ul class="historique-liste">${lignes || '<li class="historique-vide">Aucune entrée pour l\'instant.</li>'}</ul>
    <div class="ligne-ajout">
      <input type="text" id="f-nouvelle-entree" placeholder="Ajouter un évènement à l'historique...">
      <button class="btn-secondaire" onclick="ajouterHistorique()">Ajouter</button>
    </div>`;
}

// -----------------------------------------------------------------------
// Sauvegarde
// -----------------------------------------------------------------------
function val(id) { const el = document.getElementById(id); return el ? el.value : undefined; }

async function sauvegarder() {
  if (!state.itemActuel) return;
  const { collection, id } = state.itemActuel;
  const btn = document.getElementById('btn-enregistrer');
  const texteOriginal = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span>Enregistrement...';

  try {
    if (collection === 'maisons') {
      const armee = {};
      ['fantassins', 'archers', 'cavalerie', 'flotte', 'guerriers', 'eclaireurs'].forEach(champ => {
        const v = val(`f-armee-${champ}`);
        if (v !== undefined) armee[champ] = v;
      });
      const noteFlotte = val('f-armee-noteFlotte');
      if (noteFlotte !== undefined) armee.noteFlotte = noteFlotte;

      await Promise.all([
        fetchJSON(`/api/maisons/${encodeURIComponent(id)}/base`, {
          nom: val('f-nom'), type: val('f-type'), region: val('f-region'),
          croyance: val('f-croyance'), uniteSpeciale: val('f-uniteSpeciale'),
          renommee: val('f-renommee'), argent: val('f-argent'), armee,
        }),
        fetchJSON(`/api/maisons/${encodeURIComponent(id)}`, {
          renommeeOverride: val('f-renommeeOverride'), argentOverride: val('f-argentOverride'), leaderId: val('f-leaderId'),
        }),
      ]);
    } else if (collection === 'regions') {
      const armeeVide = document.getElementById('f-armee-vide').checked;
      const armee = armeeVide ? null : {
        troupes: val('f-armee-troupes'), archers: val('f-armee-archers'),
        cavalerie: val('f-armee-cavalerie'), eclaireurs: val('f-armee-eclaireurs'), flotte: val('f-armee-flotte'),
      };
      await Promise.all([
        fetchJSON(`/api/regions/${encodeURIComponent(id)}/base`, {
          nom: val('f-nom'), maisonDirigeante: val('f-maisonDirigeante'), capitale: val('f-capitale'),
          climat: val('f-climat'), specialite: val('f-specialite'), richesse: val('f-richesse'),
          statutPolitique: val('f-statutPolitique'), instabilite: val('f-instabilite'), armee,
        }),
        fetchJSON(`/api/regions/${encodeURIComponent(id)}`, {
          statutOverride: val('f-statutOverride'), instabiliteOverride: val('f-instabiliteOverride'),
        }),
      ]);
    } else {
      await fetchJSON(`/api/profils/${encodeURIComponent(id)}`, {
        statut: val('f-statut'), renommee: val('f-renommee'), gardePersonnelle: val('f-gardePersonnelle'),
        boursePersonnelle: val('f-boursePersonnelle'), allies: val('f-allies'), rivaux: val('f-rivaux'), notes: val('f-notes'),
        maisonName: val('f-maisonName'), regionName: val('f-regionName'), roleName: val('f-roleName'),
      }, 'PATCH');
    }

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

async function ajouterHistorique() {
  if (!state.itemActuel) return;
  const { collection, id } = state.itemActuel;
  if (collection === 'profils') return;
  const input = document.getElementById('f-nouvelle-entree');
  const texte = input.value.trim();
  if (!texte) return;

  try {
    await fetchJSON(`/api/${collection}/${encodeURIComponent(id)}/historique`, { texte }, 'POST');
    toast('Entrée ajoutée à l\'historique.', 'succes');
    await rafraichirEtRouvrir();
  } catch (error) {
    toast(`Erreur : ${error.message}`, 'erreur');
  }
}

async function rafraichirEtRouvrir() {
  const { collection, id } = state.itemActuel;
  const response = await fetch(`/api/${collection}`);
  const data = await response.json();
  state.cache[collection] = data;
  renderListe(collection, data);
  filtrerListe();
  ouvrirEditeur(collection, id);
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
// Synchronisation manuelle (bouton sidebar)
// -----------------------------------------------------------------------
// Ne "récupère" pas des données depuis le bot : le site et le bot lisent déjà
// la même base Mongo en direct. Ce bouton s'assure juste que chaque maison/
// région définie dans les fichiers JSON a bien un document d'état en base
// (utile après l'ajout d'une nouvelle maison/région, par ex.), sans jamais
// écraser un état déjà existant.
async function synchroniser() {
  const btn = document.getElementById('btn-sync');
  const icone = document.getElementById('sync-icone');
  btn.disabled = true;
  icone.textContent = '';
  icone.classList.add('tournant');
  icone.textContent = '🔄';

  try {
    const result = await fetchJSON('/api/sync', {}, 'POST');
    toast(result.message || 'Synchronisation terminée.', 'succes');

    // Si une section est déjà ouverte, on la recharge pour refléter d'éventuels ajouts
    if (state.collectionActuelle) {
      await chargerDonnees(state.collectionActuelle);
    }
  } catch (error) {
    toast(`Échec de la synchronisation : ${error.message}`, 'erreur');
    console.error(error);
  } finally {
    btn.disabled = false;
    icone.classList.remove('tournant');
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