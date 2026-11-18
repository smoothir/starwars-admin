// Page « Factions » : troupes, chef, vaisseaux, joueurs, inventaire de faction.
// Utilise les fonctions globales de app.js : apiFetch, escapeHtml, jsAttr, toast, confirmerAction.

const facState = { gradesOpen: false, gradesEdit: false, meta: null, list: [], key: null, data: null, players: { ready: false, loading: false, players: [], profiles: [] }, roles: [], rolesReady: false, catalogue: [], catalogueLoaded: false };
const FAC_POSSESSION_KINDS = [['batiment','Bâtiment'],['zone_planetaire','Zone planétaire'],['planete','Planète'],['cantina','Cantina'],['autre','Autre']];
let facCataloguePromise = null;

async function facApi(url, method = 'GET', body) {
  const options = { method, headers: {} };
  if (body !== undefined) { options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); }
  const res = await apiFetch(url, options);
  let payload = null;
  try { payload = await res.json(); } catch { /* corps vide */ }
  if (!res.ok) throw new Error(payload?.error || `Erreur ${res.status}`);
  return payload;
}

const facNum = (n) => Number(n || 0).toLocaleString('fr-FR');

async function chargerFactionsPage() {
  const contenu = document.getElementById('contenu');
  contenu.innerHTML = '<div class="squelette"></div><div class="squelette"></div><div class="squelette"></div>';
  // Le catalogue peut être volumineux : il sera chargé uniquement à l'ouverture
  // du sélecteur d'inventaire, sans ralentir l'affichage initial de la faction.
  try {
    const [meta, list] = await Promise.all([
      facApi('/api/factions/meta'),
      facApi('/api/factions'),
    ]);
    facState.meta = meta;
    facState.list = list;
    if (!facState.key || !list.some(f => f.key === facState.key)) facState.key = list[0]?.key || null;

    // Ne pas attendre l'API Discord pour afficher la faction : les rôles sont
    // récupérés en parallèle et les sélecteurs sont complétés dès leur arrivée.
    void facChargerRoles();
    await facChargerFaction();
  } catch (err) {
    contenu.innerHTML = `<div class="etat-vide"><p>Impossible de charger les factions.</p><span class="etat-vide-sub">${escapeHtml(err.message)}</span></div>`;
  }
}

async function facChargerRoles() {
  try {
    const roleData = await facApi('/api/factions/discord-roles');
    facState.roles = roleData.roles || [];
    facState.rolesReady = Boolean(roleData.ready);
  } catch (err) {
    facState.roles = [];
    facState.rolesReady = false;
  }

  // Les rôles ne servent plus qu'à afficher un nom lisible à côté des ID saisis.
  // Ne pas écraser une édition de grades en cours.
  if (!facState.gradesEdit) facRafraichirResume();
}

function facRoleSummaryHTML(def) {
  const grades = def.grades || [];
  const { gradesOpen, gradesEdit } = facState;
  const panel = !gradesOpen ? '' : `<div class="fac-grades-panel">${gradesEdit && state.isStaff ? facGradesEditHTML(grades) : facGradesListHTML(grades)}</div>`;
  const actions = state.isStaff
    ? `<div class="fac-admin-actions"><button class="btn-secondaire" onclick="facToggleGrades()">${gradesOpen ? 'Masquer les grades' : 'Afficher les grades'} (${grades.length})</button><button class="btn-secondaire btn-danger" onclick="facSupprimerFaction()">Supprimer cette faction</button></div>`
    : `<div class="fac-admin-actions"><button class="btn-secondaire" onclick="facToggleGrades()">${gradesOpen ? 'Masquer les grades' : 'Afficher les grades'} (${grades.length})</button></div>`;
  return `<div class="fac-role-main"><div><span class="fac-label">Rôle de faction</span><strong>${escapeHtml(facRoleName(def.categoryRoleId))}</strong></div>${actions}</div>${panel}`;
}

function facRafraichirResume() {
  const summary = document.querySelector('.fac-role-summary');
  if (summary && facState.data) summary.innerHTML = facRoleSummaryHTML(facState.data.def);
}

function facToggleGrades() {
  facState.gradesOpen = !facState.gradesOpen;
  if (!facState.gradesOpen) facState.gradesEdit = false;
  facRafraichirResume();
}

// Grades affichés dans l'ordre enregistré : du plus haut (en haut) au plus bas.
function facGradesListHTML(grades) {
  const list = grades.length
    ? `<ol class="fac-grade-list">${grades.map((g, i) => `<li><span class="fac-grade-rank">${i + 1}</span><strong>${escapeHtml(g.name)}</strong><span class="fac-grade-id">${escapeHtml(facRoleName(g.id))}</span></li>`).join('')}</ol>`
    : '<span class="fac-hint">Aucun grade configuré.</span>';
  return `<div class="fac-grades-head"><span class="fac-hint">Du grade le plus élevé au plus bas.</span>${state.isStaff ? '<button class="btn-secondaire" onclick="facModifierGrades()">Modifier</button>' : ''}</div>${list}`;
}

function facGradeEditRowHTML(name = '', roleId = '') {
  return `<div class="fac-grade-row fac-grade-row-edit"><input class="fac-input" data-grade-name maxlength="80" placeholder="Nom du grade" value="${escapeAttr(name)}"><input class="fac-input" data-grade-role inputmode="numeric" maxlength="22" placeholder="ID du rôle Discord" autocomplete="off" value="${escapeAttr(roleId)}"><span class="fac-grade-move"><button type="button" class="btn-secondaire" title="Monter" onclick="facDeplacerGrade(this,-1)">↑</button><button type="button" class="btn-secondaire" title="Descendre" onclick="facDeplacerGrade(this,1)">↓</button></span><button type="button" class="btn-secondaire btn-danger" onclick="this.closest('.fac-grade-row').remove()">Supprimer</button></div>`;
}

function facGradesEditHTML(grades) {
  return `<div class="fac-grades-head"><span class="fac-hint">Du grade le plus élevé (en haut) au plus bas. Utilise ↑ ↓ pour réordonner.</span><button class="btn-secondaire" onclick="facAjouterGradeEdition()">＋ Ajouter un grade</button></div><div id="fac-edit-grades" class="fac-grade-rows">${grades.map(g => facGradeEditRowHTML(g.name, g.id)).join('')}</div><div class="fac-admin-actions"><button class="btn-secondaire" onclick="facAnnulerGrades()">Annuler</button><button class="btn-principal" onclick="facSauverGrades()">Enregistrer les grades</button></div>`;
}

function facModifierGrades() { if (!state.isStaff) return; facState.gradesEdit = true; facRafraichirResume(); }
function facAnnulerGrades() { facState.gradesEdit = false; facRafraichirResume(); }
function facAjouterGradeEdition() {
  const host = document.getElementById('fac-edit-grades');
  if (!host) return;
  host.insertAdjacentHTML('beforeend', facGradeEditRowHTML());
  host.lastElementChild?.querySelector('[data-grade-name]')?.focus();
}
function facDeplacerGrade(button, direction) {
  const row = button.closest('.fac-grade-row');
  if (!row) return;
  if (direction < 0 && row.previousElementSibling) row.parentElement.insertBefore(row, row.previousElementSibling);
  else if (direction > 0 && row.nextElementSibling) row.parentElement.insertBefore(row.nextElementSibling, row);
}

async function facSauverGrades() {
  if (!state.isStaff) return toast('Action réservée au Staff.', 'erreur');
  const def = facState.data?.def;
  if (!def) return;
  const grades = [];
  for (const row of document.querySelectorAll('#fac-edit-grades .fac-grade-row')) {
    const name = row.querySelector('[data-grade-name]')?.value.trim() || '';
    const id = row.querySelector('[data-grade-role]')?.value.trim() || '';
    if (!name && !id) continue;
    if (!name || !FAC_ID_RE.test(id)) return toast('Chaque grade doit avoir un nom et un ID de rôle valide (15 à 22 chiffres).', 'erreur');
    grades.push({ name, id });
  }
  if (new Set(grades.map(g => g.id)).size !== grades.length) return toast('Deux grades ne peuvent pas utiliser le même ID de rôle.', 'erreur');
  if (!grades.length && !(await confirmerAction({ titre: 'Supprimer tous les grades', message: `Aucun grade ne sera conservé pour « ${def.label} ». Continuer ?`, texteValider: 'Continuer' }))) return;
  try {
    await facApi(`/api/factions/definitions/${encodeURIComponent(def.key)}`, 'PUT', { grades });
    facState.gradesEdit = false;
    toast('Grades enregistrés.', 'succes');
    await facChargerFaction();
  } catch (err) { toast(err.message, 'erreur'); }
}

async function facChargerCatalogue() {
  if (facState.catalogueLoaded) return facState.catalogue;
  if (!facCataloguePromise) {
    facCataloguePromise = (async () => {
      const result = await facApi('/api/inventaire/catalogue/meta');
      facState.catalogue = Array.isArray(result) ? result : (result.items || []);
      facState.catalogueLoaded = true;
      facActualiserSelecteurObjets();
      return facState.catalogue;
    })();
  }
  try { return await facCataloguePromise; }
  finally { facCataloguePromise = null; }
}

function facActualiserSelecteurObjets() {
  const select = document.getElementById('fac-new-item');
  if (!select || !facState.data) return;
  const previous = select.value;
  const creditItem = facState.meta.creditsItemId;
  const existing = facState.data.state.items || {};
  const options = facState.catalogue
    .filter(c => String(c.id ?? c._id) !== creditItem && !(String(c.id ?? c._id) in existing))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr'))
    .map(c => `<option value="${escapeAttr(c.id ?? c._id)}">${escapeHtml((c.emoji || '') + ' ' + (c.name || c.id))}</option>`).join('');
  select.innerHTML = `<option value="">${facState.catalogueLoaded ? 'Ajouter un objet…' : 'Catalogue en cours de chargement…'}</option>${options}`;
  if (previous && [...select.options].some(option => option.value === previous)) select.value = previous;
}

async function facChargerFaction() {
  const selectedKey = facState.key;
  if (!selectedKey) { document.getElementById('contenu').innerHTML = '<div class="etat-vide"><p>Aucune faction configurée.</p></div>'; return; }
  document.getElementById('contenu').innerHTML = '<div class="squelette"></div><div class="squelette"></div><div class="squelette"></div>';
  let data;
  try {
    data = await facApi(`/api/factions/${encodeURIComponent(selectedKey)}`);
  } catch (err) {
    if (selectedKey !== facState.key) return;
    // Faction supprimée entre-temps (liste obsolète) : on recharge la liste au lieu de rester bloqué.
    if (!facState.reloading && /inconnue/i.test(err.message)) {
      facState.reloading = true;
      facState.key = null;
      try { await chargerFactionsPage(); } finally { facState.reloading = false; }
      return;
    }
    document.getElementById('contenu').innerHTML = `<div class="etat-vide"><p>Impossible de charger cette faction.</p><span class="etat-vide-sub">${escapeHtml(err.message)}</span></div>`;
    return;
  }
  // Une réponse lente d'une ancienne sélection ne doit pas écraser la faction choisie ensuite.
  if (selectedKey !== facState.key) return;
  facState.data = data;
  facState.players = { ready: false, loading: true, players: [], profiles: [] };
  facState.list = facState.list.map(f => f.key === selectedKey ? {
    ...f, troops: data.state.troops, credits: data.state.credits, reputation: data.state.reputation,
    leaderUserId: data.state.leaderUserId, shipCount: data.ships.length,
  } : f);
  facRender();
  // Discord peut prendre du temps (serveurs volumineux / pagination) : ce chargement
  // reste indépendant afin que les cartes des vaisseaux apparaissent immédiatement.
  void facChargerJoueurs(selectedKey);
}

async function facChargerJoueurs(selectedKey) {
  try {
    const players = await facApi(`/api/factions/${encodeURIComponent(selectedKey)}/joueurs`);
    if (selectedKey !== facState.key) return;
    facState.players = { ...players, loading: false, players: players.players || [] };
  } catch (err) {
    if (selectedKey !== facState.key) return;
    facState.players = { ready: false, loading: false, players: [], error: err.message };
  }
  facActualiserJoueursUI();
  if (facState.pilotPickerShipId && document.getElementById('fac-overlay')) facOuvrirMenuPilote(facState.pilotPickerShipId);
}

function facChoisir(key) {
  if (key === facState.key) return;
  facState.key = key;
  facState.gradesOpen = false; facState.gradesEdit = false;
  facChargerFaction().catch(err => toast(err.message, 'erreur'));
}

function facItemInfo(id) {
  const it = facState.catalogue.find(c => String(c.id ?? c._id) === String(id));
  return { name: it?.name || id, emoji: it?.emoji || '📦' };
}

function facLeaderControlHTML(stateData, players) {
  const playerName = players.players.find(p => p.id === stateData.leaderUserId)?.name || (stateData.leaderUserId ? `ID ${stateData.leaderUserId}` : 'Aucun chef désigné');
  if (!state.isStaff) {
    return `<div class="fac-value">${escapeHtml(playerName)}</div><div class="fac-hint">Le chef de faction est désigné par le Staff.</div>`;
  }
  if (players.loading) return '<div class="fac-hint">Chargement des joueurs Discord…</div>';
  if (players.ready) {
    return `<div class="fac-row"><select id="fac-leader" class="fac-select"><option value="">Aucun chef désigné</option>${players.players.map(p => `<option value="${escapeAttr(p.id)}" ${p.id === stateData.leaderUserId ? 'selected' : ''}>${escapeHtml(p.name)}${p.rankName ? ' · ' + escapeHtml(p.rankName) : ''}</option>`).join('')}</select><button class="btn-secondaire fac-btn" onclick="facEnregistrerChef()">Valider</button></div><div class="fac-hint">Sans chef, le plus haut gradé présent commande en bataille.</div>`;
  }
  const note = players.error
    ? `Impossible de charger les joueurs Discord : ${escapeHtml(players.error)}`
    : 'Sans chef, le plus haut gradé présent commande en bataille. Désignation sur Discord avec <code>/faction chef</code>.';
  return `<div class="fac-value">${escapeHtml(playerName)}</div><div class="fac-hint">${note}</div>`;
}

function facPlayersContentHTML(ships, players) {
  if (players.loading) return '<div class="fac-note">Chargement des profils RP de cette faction…</div>';
  if (players.ready) return facPlayersHTML(ships);
  if (players.error) return `<div class="fac-note">Impossible de charger les profils RP : ${escapeHtml(players.error)}</div>`;
  return '<div class="fac-note">Aucun profil RP rattaché à cette faction.</div>';
}

function facPilotControlHTML(ship, players) {
  const profiles = Array.isArray(players.profiles) ? players.profiles : [];
  const pilotProfile = profiles.find(profile => profile.id === ship.assignedProfileId);
  const owner = pilotProfile?.userId
    ? pilotProfile.ownerName || (players.players || []).find(player => player.id === pilotProfile.userId)?.name || `<@${pilotProfile.userId}>`
    : (players.players || []).find(player => player.id === ship.assignedUserId)?.name;
  const current = pilotProfile
    ? `${pilotProfile.name}${pilotProfile.roleName ? ` · ${pilotProfile.roleName}` : ''}${owner ? ` — ${owner}` : ''}`
    : (ship.assignedProfileName
      ? `${ship.assignedProfileName}${owner ? ` — ${owner}` : ''}`
      : (ship.assignedUserId ? `Ancienne attribution à ${owner || `ID ${ship.assignedUserId}`} (profil non défini)` : 'Non attribué'));
  const hasPilot = Boolean(ship.assignedProfileId || ship.assignedUserId);
  const status = players.ready ? '' : `<small>${players.loading ? 'Chargement des profils RP…' : escapeHtml(players.error || 'Liste des profils indisponible')}</small>`;
  return `<div class="fac-pilot-picker"><div><span class="fac-label">Profil pilote</span><strong>${escapeHtml(current)}</strong>${status}</div><button class="btn-secondaire" onclick="facOuvrirMenuPilote('${jsAttr(ship.id)}')">${hasPilot ? 'Changer le profil' : 'Attribuer un profil'}</button></div>`;
}

function facActualiserJoueursUI() {
  if (!facState.data) return;
  const leader = document.getElementById('fac-leader-control');
  if (leader) leader.innerHTML = facLeaderControlHTML(facState.data.state, facState.players);
  const players = document.getElementById('fac-players-content');
  if (players) players.innerHTML = facPlayersContentHTML(facState.data.ships, facState.players);
  for (const ship of facState.data.ships) {
    const pilot = document.getElementById(`fac-ship-pilot-${ship.id}`);
    if (pilot) pilot.innerHTML = facPilotControlHTML(ship, facState.players);
  }
}

function facRender() {
  const { data, players, meta, list } = facState;
  const { def, state: factionState, ships } = data;
  const isStaff = state.isStaff === true;
  const tabs = list.map(f => `<button class="fac-tab ${f.key === facState.key ? 'active' : ''}" onclick="facChoisir('${jsAttr(f.key)}')">${escapeHtml(f.label)}<small>🚀 ${f.shipCount}</small></button>`).join('');
  const creditItem = meta.creditsItemId;
  const otherItems = Object.entries(factionState.items).filter(([id]) => id !== creditItem);
  const staffSections = isStaff ? `
    <div class="fac-summary">
      <div class="fac-card"><h4>👑 Chef de faction</h4><div id="fac-leader-control">${facLeaderControlHTML(factionState, players)}</div></div>
      <div class="fac-card"><h4>🪖 Troupes</h4><div class="fac-row"><input id="fac-troops" class="fac-input" type="number" min="0" value="${factionState.troops}" placeholder="Nombre de soldats"><button class="btn-secondaire fac-btn" onclick="facEnregistrerTroupes()">Enregistrer</button></div><div class="fac-hint">Effectif total de la faction (utilisé par le recrutement et le massacre).</div></div>
      <div class="fac-card"><h4>💰 Crédits</h4><div class="fac-row"><input id="fac-credits" class="fac-input" type="number" min="0" value="${factionState.credits}" placeholder="Montant en crédits"><button class="btn-secondaire fac-btn" onclick="facEnregistrerCredits()">Enregistrer</button></div><div class="fac-hint">Trésorerie de la faction (pillée en cas de défaite).</div></div>
      <div class="fac-card"><h4>⭐ Réputation</h4><div class="fac-row"><input id="fac-reputation" class="fac-input" type="number" min="0" max="100" value="${factionState.reputation ?? 50}" placeholder="0 à 100"><button class="btn-secondaire fac-btn" onclick="facEnregistrerReputation()">Enregistrer</button></div><div class="fac-hint">Réputation diplomatique de la faction, de 0 (détestée) à 100 (prestigieuse).</div></div>
    </div>
    <div class="fac-section">
      <div class="fac-section-head"><div><h3>🏛️ Possessions (${(data.possessions || []).length})</h3><p>Bâtiments, zones planétaires, planètes, cantinas et autres propriétés. Les productions et recrutements peuvent exiger une possession.</p></div><button class="btn-principal" onclick="facOuvrirPossession(null)">＋ Nouvelle possession</button></div>
      ${(data.possessions || []).length ? `<div class="fac-possession-grid">${data.possessions.map(p => facPossessionCardHTML(p)).join('')}</div>` : '<div class="fac-note">Cette faction ne possède encore aucun lieu ou bâtiment.</div>'}
    </div>` : '';
  const factionTabs = isStaff ? `${tabs}<button type="button" class="fac-tab fac-tab-add" title="Ajouter une faction" aria-label="Ajouter une faction" onclick="facOuvrirCreationFaction()">＋</button>` : tabs;
  const staffNavNote = isStaff ? '' : '<p class="fac-access-note">Accès faction : tu peux créer des vaisseaux, définir leurs grades autorisés et attribuer leurs pilotes.</p>';
  const inventorySection = isStaff ? `
    <div class="fac-section">
      <div class="fac-section-head"><div><h3>🎒 Inventaire de faction</h3><p>Objets stockés par la faction (hors crédits).</p></div></div>
      ${otherItems.length ? `<div class="fac-items">${otherItems.map(([id, qty]) => { const info = facItemInfo(id); return `<div class="fac-item"><span>${escapeHtml(info.emoji)}</span><span class="fac-item-name" title="${escapeAttr(id)}">${escapeHtml(info.name)}</span><input class="fac-input" type="number" min="0" value="${qty}" onchange="facSetItem('${jsAttr(id)}', this.value)"></div>`; }).join('')}</div>` : '<div class="fac-note" style="margin-bottom:18px">Inventaire vide.</div>'}
      <div class="fac-add"><select id="fac-new-item" class="fac-select" onfocus="facChargerCatalogue().catch(err => toast(err.message, 'erreur'))"><option value="">${facState.catalogueLoaded ? 'Ajouter un objet…' : 'Charger le catalogue…'}</option>${facState.catalogue.map(c => `<option value="${escapeAttr(c.id ?? c._id)}">${escapeHtml((c.emoji || '') + ' ' + (c.name || c.id))}</option>`).join('')}</select><input id="fac-new-qty" class="fac-input" type="number" min="1" value="1" placeholder="Quantité"><button class="btn-secondaire fac-btn" onclick="facAjouterObjet()">Ajouter</button></div>
    </div>` : '';
  document.getElementById('contenu').innerHTML = `
    <div class="fac-tabs">${factionTabs}</div>
    ${staffNavNote}
    <div class="fac-role-summary">${facRoleSummaryHTML(def)}</div>
    ${staffSections}
    <div class="fac-section">
      <div class="fac-section-head"><div><h3>🚀 Vaisseaux (${ships.length})</h3><p>Les grades autorisés et le pilote se configurent séparément pour chaque vaisseau.</p></div><button class="btn-principal" onclick="facOuvrirVaisseau(null)">+ Nouveau vaisseau</button></div>
      ${ships.length ? `<div class="fac-ships">${ships.map(ship => facShipHTML(ship)).join('')}</div>` : '<div class="fac-note">Aucun vaisseau pour le moment. Crée le premier avec « Nouveau vaisseau ».</div>'}
    </div>
    <div class="fac-section">
      <div class="fac-section-head"><div><h3>👥 Profils RP de la faction</h3><p>Personnages rattachés à cette faction, leur propriétaire Discord et leur grade.</p></div></div>
      <div id="fac-players-content">${facPlayersContentHTML(ships, players)}</div>
    </div>
    ${inventorySection}`;
}

function facFootprintHTML(width, length) {
  const w = Math.max(1, Math.min(6, Number(width) || 1));
  const l = Math.max(1, Math.min(10, Number(length) || 1));
  return `<div class="fac-footprint" style="--footprint-w:${w};--footprint-l:${l}" aria-label="Empreinte ${w} par ${l}">${Array.from({ length: w * l }, () => '<i></i>').join('')}</div>`;
}

function facShipHTML(s) {
  const cls = facState.meta.classes.find(c => c.key === s.classKey);
  const players = facState.players;
  const damaged = s.hp < s.hpMax || s.shield < s.shieldMax || s.crew < s.crewMax;
  const allowedIds = Array.isArray(s.allowedGradeRoleIds) ? s.allowedGradeRoleIds.map(String) : [];
  const grades = facState.data.def.grades || [];
  const allowedNames = allowedIds.length ? grades.filter(grade => allowedIds.includes(String(grade.id))).map(grade => grade.name) : ['Tous les grades'];
  const gradeMarkup = allowedNames.length ? allowedNames.map(name => `<span class="fac-grade-chip">${escapeHtml(name)}</span>`).join('') : '<span class="fac-hint">Aucun grade valide</span>';
  const staffActions = state.isStaff ? `
      <button class="btn-modifier" onclick="facOuvrirVaisseau('${jsAttr(s.id)}')">Modifier</button>
      <button class="btn-secondaire" ${damaged ? '' : 'disabled'} onclick="facReparerVaisseau('${jsAttr(s.id)}')">Réparer</button>
      <button class="btn-secondaire" onclick="ouvrirHistorique('vaisseau','${jsAttr(s.id)}','${jsAttr(s.name)}')">Historique</button>
      <button class="btn-secondaire btn-danger" onclick="facSupprimerVaisseau('${jsAttr(s.id)}')">Supprimer</button>` : '';
  return `<div class="fac-ship">
    ${cls?.image ? `<img class="fac-ship-image" src="${escapeAttr(cls.image)}" alt="Illustration ${escapeAttr(cls.label)}" loading="lazy">` : '<div class="fac-ship-image fac-ship-image-empty">Aucune image de classe</div>'}
    <div class="fac-ship-top"><strong class="fac-ship-name">${escapeHtml(s.name)}</strong><span class="fac-ship-class">${escapeHtml(s.className)}</span></div>
    <div class="fac-class-meta"><span>${escapeHtml(cls?.id || s.classId || 'ID non défini')}</span><span>${escapeHtml(cls?.size || '')}</span><span>Gabarit : ${facNum(s.mapWidth || 1)} × ${facNum(s.mapLength || 1)}</span>${facFootprintHTML(s.mapWidth, s.mapLength)}</div>
    <div class="fac-stats">
      <div><span>Points de vie</span>${facNum(s.hp)} / ${facNum(s.hpMax)}</div><div><span>Bouclier</span>${facNum(s.shield)} / ${facNum(s.shieldMax)}</div>
      <div><span>Équipage</span>${facNum(s.crew)} / ${facNum(s.crewMax)}</div><div><span>Portée</span>${s.range} cases</div>
      <div><span>Tir de barrage</span>${facNum(s.barrage)}</div><div><span>Tir ciblé</span>${facNum(s.focus)}</div>
    </div>
    <div class="fac-ship-grades"><div><span class="fac-label">Grades autorisés</span><div class="fac-grade-chips">${gradeMarkup}</div></div><button class="btn-secondaire" onclick="facOuvrirPermissionsVaisseau('${jsAttr(s.id)}')">Gérer les grades</button></div>
    <div class="fac-ship-pilot" id="fac-ship-pilot-${jsAttr(s.id)}">${facPilotControlHTML(s, players)}</div>
    <div class="fac-ship-actions">${staffActions}</div>
  </div>`;
}

function facPlayersHTML(ships) {
  // La table est construite exclusivement à partir des profils RP de la
  // faction. Un joueur Discord n'apparaît jamais sans personnage associé.
  const profiles = facState.players.profiles || [];
  const rows = profiles.map(profile => {
    const owner = profile.ownerName || (profile.userId ? `ID ${profile.userId}` : 'Propriétaire non renseigné');
    const assignedShips = ships
      .filter(ship => ship.assignedProfileId === profile.id || (!ship.assignedProfileId && profile.userId && ship.assignedUserId === profile.userId))
      .map(ship => escapeHtml(ship.name));
    return `<tr><td><strong>${escapeHtml(profile.name || profile.id)}</strong>${profile.nickname ? `<small>${escapeHtml(profile.nickname)}</small>` : ''}</td><td>${escapeHtml(owner)}</td><td>${escapeHtml(profile.roleName || 'Grade non renseigné')}</td><td>${assignedShips.join(', ') || '<span style="opacity:.5">—</span>'}</td></tr>`;
  }).join('');
  return `<div class="fac-table-wrap"><table class="fac-table"><thead><tr><th>Profil RP</th><th>Joué par</th><th>Grade</th><th>Vaisseau(x)</th></tr></thead><tbody>${rows || '<tr><td colspan="4" style="opacity:.6">Aucun profil RP rattaché à cette faction.</td></tr>'}</tbody></table></div>`;
}

// ------------------------------------------------------------------ gestion dynamique des factions et des possessions
// Exposé explicitement sur window pour garantir sa disponibilité dans les
// fonctions de rendu et les éventuels appels globaux de la page.
var facRoleName = window.facRoleName = function facRoleName(roleId) {
  if (!roleId) return 'Aucun rôle associé';
  const role = facState.roles.find(item => String(item.id) === String(roleId));
  return role ? `@${role.name} (${roleId})` : `ID ${roleId}`;
};
const FAC_ID_RE = /^\d{15,22}$/;

function facGradeRowHTML(name = '', roleId = '') {
  return `<div class="fac-grade-row"><input class="fac-input" data-grade-name maxlength="80" placeholder="Nom du grade" value="${escapeAttr(name)}"><input class="fac-input" data-grade-role inputmode="numeric" maxlength="22" placeholder="ID du rôle Discord" autocomplete="off" value="${escapeAttr(roleId)}"><button type="button" class="btn-secondaire btn-danger" onclick="this.closest('.fac-grade-row').remove()">Retirer</button></div>`;
}
function facAjouterGradeRow(name = '', roleId = '') {
  const host = document.getElementById('fac-new-grades');
  if (!host) return;
  host.insertAdjacentHTML('beforeend', facGradeRowHTML(name, roleId));
  host.lastElementChild?.querySelector('[data-grade-name]')?.focus();
}

// Clé technique proposée automatiquement à partir du nom, tant qu'elle n'a pas été modifiée à la main.
function facSuggererCle() {
  const key = document.getElementById('fac-new-key');
  const label = document.getElementById('fac-new-label');
  if (!key || !label || key.dataset.touched === '1') return;
  key.value = label.value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
}

function facOuvrirCreationFaction() {
  if (!state.isStaff) return toast('Action réservée au Staff.', 'erreur');
  facFermerModale();
  const overlay = document.createElement('div');
  overlay.id = 'fac-overlay';
  overlay.className = 'fac-overlay';
  overlay.onclick = e => { if (e.target === overlay) facFermerModale(); };
  overlay.innerHTML = `<div class="fac-modal fac-create-modal">
    <h3>Nouvelle faction</h3>
    <div class="fac-form">
      <label><span class="fac-label">Nom affiché</span><input id="fac-new-label" class="fac-input" maxlength="80" placeholder="Résistance" autocomplete="off" oninput="facSuggererCle()"></label>
      <label><span class="fac-label">Clé</span><input id="fac-new-key" class="fac-input" maxlength="48" placeholder="RESISTANCE" autocomplete="off" oninput="this.dataset.touched='1'"></label>
      <label class="full"><span class="fac-label">ID du rôle Discord de la faction</span><input id="fac-new-role" class="fac-input" inputmode="numeric" maxlength="22" placeholder="Ex. 123456789012345678" autocomplete="off"></label>
      <div class="full fac-grade-editor">
        <div class="fac-grade-editor-head"><span class="fac-label">Grades (nom + ID du rôle Discord)</span><button type="button" class="btn-secondaire" onclick="facAjouterGradeRow()">＋ Ajouter un grade</button></div>
        <div id="fac-new-grades" class="fac-grade-rows">${facGradeRowHTML()}</div>
        <span class="fac-hint">Du grade le plus élevé au plus bas. Les lignes laissées vides sont ignorées.</span>
      </div>
    </div>
    <div class="fac-modal-actions"><button class="btn-secondaire" onclick="facFermerModale()">Annuler</button><button class="btn-principal" onclick="facCreerFaction()">Créer la faction</button></div>
  </div>`;
  document.body.appendChild(overlay);
  document.getElementById('fac-new-label').focus();
}

async function facCreerFaction() {
  if (!state.isStaff) return toast('Action réservée au Staff.', 'erreur');
  const val = id => (document.getElementById(id)?.value || '').trim();
  const categoryRoleId = val('fac-new-role');
  if (!val('fac-new-label') || !val('fac-new-key')) return toast('Le nom et la clé sont obligatoires.', 'erreur');
  if (!FAC_ID_RE.test(categoryRoleId)) return toast('L’ID du rôle de la faction doit contenir 15 à 22 chiffres.', 'erreur');
  const grades = [];
  for (const row of document.querySelectorAll('#fac-new-grades .fac-grade-row')) {
    const name = row.querySelector('[data-grade-name]')?.value.trim() || '';
    const id = row.querySelector('[data-grade-role]')?.value.trim() || '';
    if (!name && !id) continue;
    if (!name || !FAC_ID_RE.test(id)) return toast('Chaque grade doit avoir un nom et un ID de rôle valide (15 à 22 chiffres).', 'erreur');
    grades.push({ name, id });
  }
  try {
    const result = await facApi('/api/factions/definitions', 'POST', { key: val('fac-new-key'), label: val('fac-new-label'), categoryRoleId, grades });
    facFermerModale();
    toast(`Faction « ${result.label} » créée.`, 'succes');
    facState.key = result.key;
    await chargerFactionsPage();
  } catch (err) { toast(err.message, 'erreur'); }
}

async function facSupprimerFaction() {
  if (!state.isStaff) return toast('Action réservée au Staff.', 'erreur');
  const def = facState.data?.def;
  if (!def) return toast('Faction introuvable.', 'erreur');
  const ok = await confirmerAction({ titre: 'Supprimer la faction', message: `Supprimer « ${def.label} » ? Les factions qui possèdent encore des personnages, vaisseaux, possessions ou batailles en cours ne peuvent pas être supprimées.`, texteValider: 'Supprimer' });
  if (!ok) return;
  try {
    await facApi(`/api/factions/definitions/${encodeURIComponent(def.key)}`, 'DELETE');
    facState.key = null; toast('Faction supprimée.', 'succes'); await chargerFactionsPage();
  } catch (err) { toast(err.message, 'erreur'); }
}

function facPossessionCardHTML(p) {
  const kind = FAC_POSSESSION_KINDS.find(([key]) => key === p.kind)?.[1] || 'Autre';
  const generation = p.generation?.enabled
    ? `${p.generation.type === 'credits' ? 'Crédits' : facItemInfo(p.generation.itemId).name} · ${facNum(p.generation.quantity)} toutes les ${facNum(p.generation.intervalMinutes)} min`
    : 'Aucune génération automatique';
  return `<article class="fac-possession-card"><div><strong>${escapeHtml(p.name)}</strong><span>${escapeHtml(kind)} · ${escapeHtml(generation)}</span><small>${escapeHtml(p.description || 'Aucune description.')}</small><small class="fac-possession-id">ID : ${escapeHtml(p._id)}</small></div><div class="fac-possession-actions"><button class="btn-secondaire" onclick="facOuvrirPossession('${jsAttr(p._id)}')">Modifier</button><button class="btn-secondaire btn-danger" onclick="facSupprimerPossession('${jsAttr(p._id)}')">Supprimer</button></div></article>`;
}

async function facOuvrirPossession(possessionId = null) {
  const possession = possessionId ? (facState.data?.possessions || []).find(p => p._id === possessionId) : null;
  if (possessionId && !possession) return toast('Possession introuvable.', 'erreur');
  try { await facChargerCatalogue(); } catch (err) { return toast(err.message, 'erreur'); }
  facFermerModale();
  const overlay = document.createElement('div'); overlay.id = 'fac-overlay'; overlay.className = 'fac-overlay';
  overlay.onclick = e => { if (e.target === overlay) facFermerModale(); };
  const itemOptions = facState.catalogue.map(item => {
    const itemId = String(item.id ?? item._id);
    return `<option value="${escapeAttr(itemId)}" ${itemId === String(possession?.generation?.itemId || '') ? 'selected' : ''}>${escapeHtml(`${item.emoji || '📦'} ${item.name || itemId}`)}</option>`;
  }).join('');
  overlay.innerHTML = `<div class="fac-modal fac-possession-modal"><h3>${possession ? 'Modifier la possession' : 'Nouvelle possession de faction'}</h3><div class="fac-form">
    <label class="full"><span class="fac-label">Nom</span><input id="fp-name" class="fac-input" maxlength="100" value="${escapeAttr(possession?.name || '')}" placeholder="Ex. Chantier naval de Corellia"></label>
    <label><span class="fac-label">Type</span><select id="fp-kind" class="fac-select">${FAC_POSSESSION_KINDS.map(([key,label]) => `<option value="${key}" ${possession?.kind === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
    <label class="full"><span class="fac-label">Description</span><textarea id="fp-description" class="fac-input" rows="2">${escapeHtml(possession?.description || '')}</textarea></label>
    <label class="full fac-possession-toggle"><input id="fp-generation-enabled" type="checkbox" ${possession?.generation?.enabled ? 'checked' : ''} onchange="document.getElementById('fp-generation-fields').hidden = !this.checked"><span>Activer la génération automatique</span></label>
    <div id="fp-generation-fields" class="fac-form full" ${possession?.generation?.enabled ? '' : 'hidden'}>
      <label><span class="fac-label">Ressource générée</span><select id="fp-generation-type" class="fac-select" onchange="document.getElementById('fp-item-row').hidden = this.value !== 'item'"><option value="credits" ${possession?.generation?.type !== 'item' ? 'selected' : ''}>Crédits</option><option value="item" ${possession?.generation?.type === 'item' ? 'selected' : ''}>Objet</option></select></label>
      <label id="fp-item-row" ${possession?.generation?.type === 'item' ? '' : 'hidden'}><span class="fac-label">Objet</span><select id="fp-item" class="fac-select">${itemOptions}</select></label>
      <label><span class="fac-label">Quantité par versement</span><input id="fp-quantity" class="fac-input" type="number" min="1" value="${Math.max(1, Number(possession?.generation?.quantity) || 1)}"></label>
      <label><span class="fac-label">Intervalle (minutes)</span><input id="fp-interval" class="fac-input" type="number" min="1" max="525600" value="${Math.max(1, Number(possession?.generation?.intervalMinutes) || 1440)}"></label>
    </div>
  </div><p class="fac-hint">Une possession de faction peut être utilisée pour la production ou le recrutement uniquement par le chef de faction. Il peut aussi y affecter du personnel.</p><div class="fac-modal-actions"><button class="btn-secondaire" onclick="facFermerModale()">Annuler</button><button class="btn-principal" onclick="facSauverPossession(${possession ? `'${jsAttr(possession._id)}'` : 'null'})">${possession ? 'Enregistrer' : 'Créer'}</button></div></div>`;
  document.body.appendChild(overlay);
}

async function facSauverPossession(possessionId = null) {
  const type = document.getElementById('fp-generation-type')?.value || 'credits';
  const enabled = !!document.getElementById('fp-generation-enabled')?.checked;
  const payload = {
    name: document.getElementById('fp-name')?.value || '',
    kind: document.getElementById('fp-kind')?.value || 'autre',
    description: document.getElementById('fp-description')?.value || '',
    generation: { enabled, type, itemId: type === 'item' ? document.getElementById('fp-item')?.value : null,
      quantity: Number(document.getElementById('fp-quantity')?.value) || 1,
      intervalMinutes: Number(document.getElementById('fp-interval')?.value) || 1440 },
  };
  try {
    await facApi(facUrl(`/possessions${possessionId ? `/${encodeURIComponent(possessionId)}` : ''}`), possessionId ? 'PATCH' : 'POST', payload);
    facFermerModale(); toast(possessionId ? 'Possession modifiée.' : 'Possession créée.', 'succes'); await facChargerFaction();
  } catch (err) { toast(err.message, 'erreur'); }
}

async function facSupprimerPossession(possessionId) {
  const possession = facState.data?.possessions?.find(p => p._id === possessionId);
  const ok = await confirmerAction({ titre: 'Supprimer la possession', message: `Supprimer « ${possession?.name || possessionId} » ?`, texteValider: 'Supprimer' });
  if (!ok) return;
  return facAction(() => facApi(facUrl(`/possessions/${encodeURIComponent(possessionId)}`), 'DELETE'), 'Possession supprimée.');
}

// ------------------------------------------------------------------ actions
async function facAction(promiseFactory, messageSucces) {
  try {
    await promiseFactory();
    if (messageSucces) toast(messageSucces);
    await facChargerFaction();
  } catch (err) {
    toast(err.message, 'erreur');
    await facChargerFaction().catch(() => {});
  }
}
const facUrl = (suffix = '') => `/api/factions/${encodeURIComponent(facState.key)}${suffix}`;

function facEnregistrerTroupes() { return facAction(() => facApi(facUrl(), 'PUT', { troops: Number(document.getElementById('fac-troops').value) }), 'Troupes enregistrées.'); }
function facEnregistrerChef() { return facAction(() => facApi(facUrl(), 'PUT', { leaderUserId: document.getElementById('fac-leader').value || null }), 'Chef de faction enregistré.'); }
function facEnregistrerCredits() { return facAction(() => facApi(facUrl(`/inventaire/${encodeURIComponent(facState.meta.creditsItemId)}`), 'PUT', { quantity: Number(document.getElementById('fac-credits').value) }), 'Crédits enregistrés.'); }
function facEnregistrerReputation() { const value = Number(document.getElementById('fac-reputation').value); if (!Number.isInteger(value) || value < 0 || value > 100) return toast('La réputation doit être comprise entre 0 et 100.', 'erreur'); return facAction(() => facApi(facUrl(), 'PUT', { reputation: value }), 'Réputation enregistrée.'); }
function facSetItem(id, qty) { return facAction(() => facApi(facUrl(`/inventaire/${encodeURIComponent(id)}`), 'PUT', { quantity: Number(qty) }), 'Inventaire mis à jour.'); }
function facAjouterObjet() {
  if (!facState.catalogueLoaded) return toast('Le catalogue est encore en cours de chargement.', 'erreur');
  const id = document.getElementById('fac-new-item').value;
  const qty = Number(document.getElementById('fac-new-qty').value);
  if (!id) return toast('Choisis un objet.', 'erreur');
  return facSetItem(id, qty);
}
async function facAssigner(shipId, profileId) {
  try {
    await facApi(facUrl(`/vaisseaux/${encodeURIComponent(shipId)}/pilote`), 'PUT', { profileId: profileId || null });
    facFermerModale();
    toast(profileId ? 'Profil pilote attribué.' : 'Pilote retiré.');
    await facChargerFaction();
  } catch (err) { toast(err.message, 'erreur'); }
}

function facOuvrirMenuPilote(shipId) {
  const ship = facState.data?.ships.find(item => item.id === shipId);
  if (!ship) return toast('Vaisseau introuvable.', 'erreur');
  facFermerModale();
  facState.pilotPickerShipId = shipId;
  const overlay = document.createElement('div');
  overlay.id = 'fac-overlay';
  overlay.className = 'fac-overlay';
  overlay.onclick = event => { if (event.target === overlay) facFermerModale(); };
  let memberRows = '<div class="fac-picker-empty">Chargement des profils RP…</div>';
  if (facState.players.ready) {
    const profiles = Array.isArray(facState.players.profiles) ? facState.players.profiles : [];
    memberRows = profiles.length ? profiles.map(profile => {
      const owner = profile.userId
        ? profile.ownerName || (facState.players.players || []).find(player => player.id === profile.userId)?.name || `<@${profile.userId}>`
        : 'Aucun joueur Discord associé';
      const grade = profile.roleName || 'Aucun grade renseigné';
      const secondary = `${grade} · Joueur : ${owner}`;
      const selected = profile.id === ship.assignedProfileId;
      const allowedIds = (ship.allowedGradeRoleIds || []).map(String);
      const hasOwner = Boolean(profile.userId);
      const ownerInGuild = profile.ownerInGuild !== false;
      const belongsToFaction = profile.inFaction === true;
      const hasAllowedGrade = !allowedIds.length || (profile.roleId && allowedIds.includes(String(profile.roleId)));
      const canPilot = hasOwner && ownerInGuild && belongsToFaction && hasAllowedGrade;
      const note = !hasOwner
        ? secondary
        : (!ownerInGuild ? `${secondary} · Joueur absent du serveur Discord` : (!belongsToFaction ? `${secondary} · Profil hors faction` : (hasAllowedGrade ? secondary : `${secondary} · Grade non autorisé`)));
      const search = `${profile.name} ${profile.nickname || ''} ${note}`.toLocaleLowerCase('fr');
      const avatarLetter = String(profile.name || '?').trim().slice(0, 1).toUpperCase();
      return `<button type="button" class="fac-member-option ${selected ? 'selected' : ''}" data-member-search="${escapeAttr(search)}" ${canPilot ? '' : 'disabled'} ${canPilot ? `onclick="facAssigner('${jsAttr(ship.id)}','${jsAttr(profile.id)}')"` : ''}><span class="fac-member-avatar">${escapeHtml(avatarLetter)}</span><span><strong>${escapeHtml(profile.name || profile.id)}</strong><small>${escapeHtml(note)}</small></span>${selected ? '<span class="fac-member-current">Pilote actuel</span>' : ''}</button>`;
    }).join('') : '<div class="fac-picker-empty">Aucun profil RP trouvé dans cette faction.</div>';
  } else if (facState.players.error) {
    memberRows = `<div class="fac-picker-empty">${escapeHtml(facState.players.error)}</div>`;
  }
  const clearPilotButton = facState.players.ready ? `<button class="btn-secondaire fac-clear-pilot" onclick="facAssigner('${jsAttr(ship.id)}',null)">Retirer le pilote</button>` : '';
  overlay.innerHTML = `<div class="fac-modal fac-picker-modal"><div class="fac-modal-title-row"><div><h3>Attribuer un pilote</h3><p>${escapeHtml(ship.name)}</p></div><button class="btn-secondaire" onclick="facFermerModale()">✕</button></div><input class="fac-input fac-picker-search" type="search" placeholder="Rechercher un profil RP ou un joueur…" oninput="facFiltrerPilotes(this.value)">${clearPilotButton}<div class="fac-member-list">${memberRows}</div></div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('.fac-picker-search')?.focus();
}

function facFiltrerPilotes(query) {
  const needle = String(query || '').trim().toLocaleLowerCase('fr');
  document.querySelectorAll('[data-member-search]').forEach(button => {
    button.hidden = !String(button.dataset.memberSearch || '').includes(needle);
  });
}

function facToggleTousGrades(checked) {
  document.querySelectorAll('[data-ship-grade]').forEach(input => { input.disabled = checked; if (checked) input.checked = false; });
}

function facOuvrirPermissionsVaisseau(shipId) {
  const ship = facState.data?.ships.find(item => item.id === shipId);
  if (!ship) return toast('Vaisseau introuvable.', 'erreur');
  const grades = facState.data.def.grades || [];
  const allowed = Array.isArray(ship.allowedGradeRoleIds) ? ship.allowedGradeRoleIds.map(String) : [];
  const all = allowed.length === 0;
  facFermerModale();
  const overlay = document.createElement('div');
  overlay.id = 'fac-overlay';
  overlay.className = 'fac-overlay';
  overlay.onclick = event => { if (event.target === overlay) facFermerModale(); };
  const gradeRows = grades.length ? grades.map(grade => `<label class="fac-grade-option"><input type="checkbox" data-ship-grade value="${escapeAttr(grade.id)}" ${allowed.includes(String(grade.id)) ? 'checked' : ''} ${all ? 'disabled' : ''}><span><strong>${escapeHtml(grade.name)}</strong><small>${escapeHtml(facRoleName(grade.id))}</small></span></label>`).join('') : '<div class="fac-picker-empty">Aucun grade n’est configuré pour cette faction. Tous les membres pourront piloter ce vaisseau.</div>';
  overlay.innerHTML = `<div class="fac-modal fac-picker-modal"><div class="fac-modal-title-row"><div><h3>Grades autorisés</h3><p>${escapeHtml(ship.name)}</p></div><button class="btn-secondaire" onclick="facFermerModale()">✕</button></div><label class="fac-grade-option fac-grade-all"><input id="fac-all-grades" type="checkbox" ${all ? 'checked' : ''} onchange="facToggleTousGrades(this.checked)"><span><strong>Tous les grades de la faction</strong><small>Autoriser chaque membre de cette faction</small></span></label><div class="fac-grade-picker-list">${gradeRows}</div><p class="fac-hint">Décoche « Tous les grades », puis sélectionne un ou plusieurs grades. Un vaisseau sans restriction est accessible à tous les grades de la faction.</p><div class="fac-modal-actions"><button class="btn-secondaire" onclick="facFermerModale()">Annuler</button><button class="btn-principal" onclick="facSauverPermissionsVaisseau('${jsAttr(ship.id)}')">Enregistrer</button></div></div>`;
  document.body.appendChild(overlay);
}

async function facSauverPermissionsVaisseau(shipId) {
  const all = document.getElementById('fac-all-grades')?.checked;
  const roleIds = all ? [] : [...document.querySelectorAll('[data-ship-grade]:checked')].map(input => input.value);
  if (!all && !roleIds.length) return toast('Choisis au moins un grade ou réactive « Tous les grades ».', 'erreur');
  try {
    await facApi(facUrl(`/vaisseaux/${encodeURIComponent(shipId)}/grades`), 'PUT', { roleIds });
    facFermerModale();
    toast('Grades autorisés enregistrés.');
    await facChargerFaction();
  } catch (err) { toast(err.message, 'erreur'); }
}


async function facReparerVaisseau(shipId) {
  if (!state.isStaff) return toast('Action réservée au Staff.', 'erreur');
  const ship = facState.data.ships.find(s => s.id === shipId);
  const ok = await confirmerAction({ titre: 'Réparer le vaisseau', message: `Restaurer les PV, le bouclier et l’équipage de « ${ship?.name || shipId} » à leur maximum ?`, texteValider: 'Réparer' });
  if (!ok) return;
  return facAction(() => facApi(facUrl(`/vaisseaux/${encodeURIComponent(shipId)}/reparer`), 'PUT', {}), 'Vaisseau réparé.');
}

async function facSupprimerVaisseau(shipId) {
  if (!state.isStaff) return toast('Action réservée au Staff.', 'erreur');
  const ship = facState.data.ships.find(s => s.id === shipId);
  const ok = await confirmerAction({ titre: 'Supprimer le vaisseau', message: `Supprimer définitivement « ${ship?.name || shipId} » ?`, texteValider: 'Supprimer' });
  if (!ok) return;
  return facAction(() => facApi(facUrl(`/vaisseaux/${encodeURIComponent(shipId)}`), 'DELETE'), 'Vaisseau supprimé.');
}

// ------------------------------------------------------------------ modale vaisseau
function facFermerModale() { document.getElementById('fac-overlay')?.remove(); facState.pilotPickerShipId = null; }

function facOuvrirVaisseau(shipId) {
  if (shipId && !state.isStaff) return toast('La modification des caractéristiques est réservée au Staff.', 'erreur');
  const ship = shipId ? facState.data.ships.find(s => s.id === shipId) : null;
  const classes = facState.meta.classes;
  const base = ship || { classKey: classes[0].key, ...Object.fromEntries(Object.entries(classes[0].defaults).map(([k, v]) => [k, v])), mapWidth: classes[0].defaults.mapWidth, mapLength: classes[0].defaults.mapLength };
  const v = ship ? { name: ship.name, classKey: ship.classKey, hpMax: ship.hpMax, shieldMax: ship.shieldMax, range: ship.range, crewMax: ship.crewMax, mapWidth: ship.mapWidth, mapLength: ship.mapLength, barrage: ship.barrage, focus: ship.focus }
    : { name: '', classKey: base.classKey, hpMax: base.hp, shieldMax: base.shield, range: base.range, crewMax: base.crew, mapWidth: base.mapWidth, mapLength: base.mapLength, barrage: base.barrage, focus: base.focus };
  facFermerModale();
  const overlay = document.createElement('div');
  overlay.id = 'fac-overlay';
  overlay.className = 'fac-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) facFermerModale(); };
  const field = (id, label, value, extra = '') => `<label><span class="fac-label">${label}</span><input id="${id}" class="fac-input" type="number" min="0" value="${value}" ${extra}></label>`;
  overlay.innerHTML = `<div class="fac-modal">
    <h3>${ship ? 'Modifier le vaisseau' : 'Nouveau vaisseau'}</h3>
    <div class="fac-form">
      <label class="full"><span class="fac-label">Nom du vaisseau</span><input id="fv-name" class="fac-input" type="text" maxlength="60" value="${escapeAttr(v.name)}" placeholder="Ex. Vengeance, Faucon d'Argent…" autocomplete="off"></label>
      <label class="full"><span class="fac-label">Classe</span><select id="fv-class" class="fac-select" onchange="facAppliquerClasse()">${classes.map(c => `<option value="${escapeAttr(c.key)}" ${c.key === v.classKey ? 'selected' : ''}>${escapeHtml(c.label)} (${escapeHtml(c.size)}) — ${escapeHtml(c.requirement)}</option>`).join('')}</select></label>
      <div class="fac-class-preview full" id="fv-class-preview"></div>
      ${state.isStaff ? '<label class="full"><span class="fac-label">Illustration de cette catégorie</span><input id="fv-class-image" class="fac-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onchange="facUploaderImageClasse(this)"><span class="fac-hint">PNG, JPEG, WEBP ou GIF · 4 Mo maximum. L’image sera enregistrée dans web/ship.</span></label>' : ''}
      ${field('fv-hp', 'PV max', v.hpMax, 'min="1"')}${field('fv-shield', 'Bouclier max', v.shieldMax)}
      ${field('fv-crew', 'Équipage max', v.crewMax)}${field('fv-range', 'Portée (cases)', v.range, 'min="1"')}
      ${field('fv-barrage', 'Dégâts tir de barrage', v.barrage)}${field('fv-focus', 'Dégâts tir ciblé', v.focus)}
      ${field('fv-map-width', 'Cases en largeur (X)', v.mapWidth, 'min="1" max="10"')}${field('fv-map-length', 'Cases en longueur (Y)', v.mapLength, 'min="1" max="10"')}
    </div>
    ${ship ? '<p class="fac-hint" style="margin-top:14px">Les PV, boucliers et l’équipage actuels sont conservés. Utilise « Réparer » pour les restaurer.</p>' : '<p class="fac-hint" style="margin-top:14px">Le gabarit reprend la taille par défaut de la classe, mais peut être ajusté pour ce vaisseau.</p>'}
    <div class="fac-modal-actions"><button class="btn-secondaire" onclick="facFermerModale()">Annuler</button><button class="btn-principal" onclick="facSauverVaisseau(${ship ? `'${jsAttr(ship.id)}'` : 'null'})">${ship ? 'Enregistrer' : 'Créer'}</button></div>
  </div>`;
  document.body.appendChild(overlay);
  facMettreAJourApercuClasse();
  document.getElementById('fv-name').focus();
}

function facMettreAJourApercuClasse() {
  const key = document.getElementById('fv-class')?.value;
  const cls = facState.meta.classes.find(c => c.key === key);
  const target = document.getElementById('fv-class-preview');
  if (!cls || !target) return;
  const width = cls.defaults.mapWidth || 1;
  const length = cls.defaults.mapLength || 1;
  target.innerHTML = `${cls.image ? `<img src="${escapeAttr(cls.image)}" alt="${escapeAttr(cls.label)}">` : '<div class="fac-class-preview-empty">Illustration non définie</div>'}<div class="fac-class-preview-info"><strong>${escapeHtml(cls.label)}</strong><span>ID : ${escapeHtml(cls.id)}</span><span>Longueur réelle : ${escapeHtml(cls.size)}</span><span>Empreinte : ${width} × ${length} cases</span>${facFootprintHTML(width, length)}</div>`;
}

async function facUploaderImageClasse(input) {
  const file = input?.files?.[0];
  if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) { toast('Format accepté : PNG, JPEG, WEBP ou GIF.', 'erreur'); input.value = ''; return; }
  if (file.size > 4 * 1024 * 1024) { toast('L’image doit peser 4 Mo maximum.', 'erreur'); input.value = ''; return; }
  try {
    const imageData = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Lecture de l’image impossible.'));
      reader.readAsDataURL(file);
    });
    const classKey = document.getElementById('fv-class').value;
    const result = await facApi(`/api/factions/classes/${encodeURIComponent(classKey)}/image`, 'POST', { imageData });
    const cls = facState.meta.classes.find(c => c.key === classKey);
    if (cls) cls.image = result.image;
    facMettreAJourApercuClasse();
    toast('Illustration de classe enregistrée.');
  } catch (err) { toast(err.message, 'erreur'); }
  finally { input.value = ''; }
}

// Pré-remplit les statistiques avec le modèle de la classe choisie.
function facAppliquerClasse() {
  const cls = facState.meta.classes.find(c => c.key === document.getElementById('fv-class').value);
  if (!cls) return;
  const set = (id, value) => { document.getElementById(id).value = value; };
  set('fv-hp', cls.defaults.hp); set('fv-shield', cls.defaults.shield); set('fv-crew', cls.defaults.crew);
  set('fv-range', cls.defaults.range); set('fv-barrage', cls.defaults.barrage); set('fv-focus', cls.defaults.focus);
  facMettreAJourApercuClasse();
}

async function facSauverVaisseau(shipId) {
  const val = (id) => document.getElementById(id).value;
  const body = {
    name: val('fv-name'), classKey: val('fv-class'),
    hpMax: Number(val('fv-hp')), shieldMax: Number(val('fv-shield')), crewMax: Number(val('fv-crew')),
    range: Number(val('fv-range')), barrage: Number(val('fv-barrage')), focus: Number(val('fv-focus')),
    mapWidth: Number(val('fv-map-width')), mapLength: Number(val('fv-map-length')),
  };
  try {
    if (shipId) await facApi(facUrl(`/vaisseaux/${encodeURIComponent(shipId)}`), 'PUT', body);
    else await facApi(facUrl('/vaisseaux'), 'POST', body);
    facFermerModale();
    toast(shipId ? 'Vaisseau modifié.' : 'Vaisseau créé.');
    await facChargerFaction();
  } catch (err) {
    toast(err.message, 'erreur');
  }
}
