// Page « Factions » : troupes, chef, vaisseaux, joueurs, inventaire de faction.
// Utilise les fonctions globales de app.js : apiFetch, escapeHtml, jsAttr, toast, confirmerAction.

const facState = { meta: null, list: [], key: null, data: null, players: { ready: false, players: [] }, catalogue: [] };

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
  try {
    const [meta, list, catalogue] = await Promise.all([
      facApi('/api/factions/meta'),
      facApi('/api/factions'),
      facApi('/api/inventaire/catalogue/meta').catch(() => []),
    ]);
    facState.meta = meta;
    facState.list = list;
    facState.catalogue = Array.isArray(catalogue) ? catalogue : (catalogue.items || []);
    if (!facState.key || !list.some(f => f.key === facState.key)) facState.key = list[0]?.key || null;
    await facChargerFaction();
  } catch (err) {
    contenu.innerHTML = `<div class="etat-vide"><p>Impossible de charger les factions.</p><span class="etat-vide-sub">${escapeHtml(err.message)}</span></div>`;
  }
}

async function facChargerFaction() {
  if (!facState.key) { document.getElementById('contenu').innerHTML = '<div class="etat-vide"><p>Aucune faction configurée.</p></div>'; return; }
  const [data, players, list] = await Promise.all([
    facApi(`/api/factions/${encodeURIComponent(facState.key)}`),
    facApi(`/api/factions/${encodeURIComponent(facState.key)}/joueurs`).catch(() => ({ ready: false, players: [] })),
    facApi('/api/factions'),
  ]);
  facState.data = data;
  facState.players = players;
  facState.list = list;
  facRender();
}

function facChoisir(key) { facState.key = key; facChargerFaction().catch(err => toast(err.message, 'erreur')); }

function facItemInfo(id) {
  const it = facState.catalogue.find(c => String(c.id ?? c._id) === String(id));
  return { name: it?.name || id, emoji: it?.emoji || '📦' };
}

function facRender() {
  const { data, players, meta, list } = facState;
  const { def, state, ships } = data;
  const playerName = (id) => players.players.find(p => p.id === id)?.name || (id ? `ID ${id}` : '');

  const tabs = list.map(f => `<button class="fac-tab ${f.key === facState.key ? 'active' : ''}" onclick="facChoisir('${jsAttr(f.key)}')">${escapeHtml(f.label)}<small>🚀 ${f.shipCount}</small></button>`).join('');

  const leaderControl = players.ready
    ? `<div class="fac-row"><select id="fac-leader" class="fac-select"><option value="">Aucun chef désigné</option>${players.players.map(p => `<option value="${escapeAttr(p.id)}" ${p.id === state.leaderUserId ? 'selected' : ''}>${escapeHtml(p.name)}${p.rankName ? ' · ' + escapeHtml(p.rankName) : ''}</option>`).join('')}</select><button class="btn-secondaire fac-btn" onclick="facEnregistrerChef()">Valider</button></div><div class="fac-hint">Sans chef, le plus haut gradé présent commande en bataille.</div>`
    : `<div class="fac-value">${state.leaderUserId ? escapeHtml(playerName(state.leaderUserId)) : 'Aucun chef désigné'}</div><div class="fac-hint">Sans chef, le plus haut gradé présent commande en bataille. Désignation sur Discord avec <code>/faction chef</code>.</div>`;

  const creditItem = meta.creditsItemId;
  const otherItems = Object.entries(state.items).filter(([id]) => id !== creditItem);
  const itemOptions = facState.catalogue
    .filter(c => String(c.id ?? c._id) !== creditItem && !(String(c.id ?? c._id) in state.items))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr'))
    .map(c => `<option value="${escapeAttr(c.id ?? c._id)}">${escapeHtml((c.emoji || '') + ' ' + (c.name || c.id))}</option>`).join('');

  document.getElementById('contenu').innerHTML = `
    <div class="fac-tabs">${tabs}</div>

    <div class="fac-summary">
      <div class="fac-card"><h4>👑 Chef de faction</h4>${leaderControl}</div>
      <div class="fac-card"><h4>🪖 Troupes</h4><div class="fac-row"><input id="fac-troops" class="fac-input" type="number" min="0" value="${state.troops}" placeholder="Nombre de soldats"><button class="btn-secondaire fac-btn" onclick="facEnregistrerTroupes()">Enregistrer</button></div><div class="fac-hint">Effectif total de la faction (utilisé par le recrutement et le massacre).</div></div>
      <div class="fac-card"><h4>💰 Crédits</h4><div class="fac-row"><input id="fac-credits" class="fac-input" type="number" min="0" value="${state.credits}" placeholder="Montant en crédits"><button class="btn-secondaire fac-btn" onclick="facEnregistrerCredits()">Enregistrer</button></div><div class="fac-hint">Trésorerie de la faction (pillée en cas de défaite).</div></div>
    </div>

    <div class="fac-section">
      <div class="fac-section-head"><div><h3>🚀 Vaisseaux (${ships.length})</h3><p>Propriété de la faction, attribués à un joueur selon son grade.</p></div><button class="btn-principal" onclick="facOuvrirVaisseau(null)">+ Nouveau vaisseau</button></div>
      ${ships.length ? `<div class="fac-ships">${ships.map(s => facShipHTML(s)).join('')}</div>` : '<div class="fac-note">Aucun vaisseau pour le moment. Crée le premier avec « Nouveau vaisseau ».</div>'}
    </div>

    <div class="fac-section">
      <div class="fac-section-head"><div><h3>👥 Joueurs de la faction</h3><p>Grades militaires lus depuis les rôles Discord.</p></div></div>
      ${players.ready ? facPlayersHTML(ships) : '<div class="fac-note">Pour lister les joueurs et attribuer des vaisseaux depuis le site, ajoute <code>DISCORD_BOT_TOKEN</code> dans le fichier <code>.env</code> du site. En attendant, utilise <code>/faction joueurs</code> et <code>/faction attribuer</code> sur Discord.</div>'}
    </div>

    <div class="fac-section">
      <div class="fac-section-head"><div><h3>🎒 Inventaire de faction</h3><p>Objets stockés par la faction (hors crédits).</p></div></div>
      ${otherItems.length ? `<div class="fac-items">${otherItems.map(([id, qty]) => { const info = facItemInfo(id); return `<div class="fac-item"><span>${escapeHtml(info.emoji)}</span><span class="fac-item-name" title="${escapeAttr(id)}">${escapeHtml(info.name)}</span><input class="fac-input" type="number" min="0" value="${qty}" onchange="facSetItem('${jsAttr(id)}', this.value)"></div>`; }).join('')}</div>` : '<div class="fac-note" style="margin-bottom:18px">Inventaire vide.</div>'}
      <div class="fac-add"><select id="fac-new-item" class="fac-select"><option value="">Ajouter un objet…</option>${itemOptions}</select><input id="fac-new-qty" class="fac-input" type="number" min="1" value="1" placeholder="Quantité"><button class="btn-secondaire fac-btn" onclick="facAjouterObjet()">Ajouter</button></div>
    </div>`;
}

function facShipHTML(s) {
  const cls = facState.meta.classes.find(c => c.key === s.classKey);
  const players = facState.players;
  const pilotSelect = players.ready
    ? `<div><span class="fac-label">Pilote</span><select class="fac-select" onchange="facAssigner('${jsAttr(s.id)}', this.value)"><option value="">Non attribué</option>${players.players.map(p => `<option value="${escapeAttr(p.id)}" ${p.id === s.assignedUserId ? 'selected' : ''}>${escapeHtml(p.name)}${p.rankName ? ' · ' + escapeHtml(p.rankName) : ''}</option>`).join('')}</select></div>`
    : `<div><span class="fac-label">Pilote</span><div class="fac-hint">${s.assignedUserId ? 'ID ' + escapeHtml(s.assignedUserId) : 'Non attribué'}</div></div>`;
  return `<div class="fac-ship">
    <div class="fac-ship-top"><strong class="fac-ship-name">${escapeHtml(s.name)}</strong><span class="fac-ship-class">${escapeHtml(s.className)}</span></div>
    <div class="fac-stats">
      <div><span>Points de vie</span>${facNum(s.hp)} / ${facNum(s.hpMax)}</div><div><span>Bouclier</span>${facNum(s.shield)} / ${facNum(s.shieldMax)}</div>
      <div><span>Équipage</span>${facNum(s.crew)} / ${facNum(s.crewMax)}</div><div><span>Portée</span>${s.range} cases</div>
      <div><span>Tir de barrage</span>${facNum(s.barrage)}</div><div><span>Tir ciblé</span>${facNum(s.focus)}</div>
      <div><span>Escadrons</span>${facNum(s.squadrons)}</div><div><span>Grade requis</span>${escapeHtml(cls?.requirement || '—')}</div>
    </div>
    ${pilotSelect}
    <div class="fac-ship-actions"><button class="btn-modifier" onclick="facOuvrirVaisseau('${jsAttr(s.id)}')">Modifier</button><button class="btn-secondaire btn-danger" onclick="facSupprimerVaisseau('${jsAttr(s.id)}')">Supprimer</button></div>
  </div>`;
}

function facPlayersHTML(ships) {
  const rows = facState.players.players.map(p => {
    const mine = ships.filter(s => s.assignedUserId === p.id).map(s => escapeHtml(s.name));
    return `<tr><td>${p.avatar ? `<img class="fac-avatar" src="${escapeAttr(p.avatar)}" alt="">` : ''}${escapeHtml(p.name)}${p.isLeader ? ' 👑' : ''}</td><td>${p.rankName ? `<span class="fac-badge">${escapeHtml(p.rankName)}</span>` : '<span style="opacity:.5">—</span>'}</td><td>${mine.join(', ') || '<span style="opacity:.5">—</span>'}</td></tr>`;
  }).join('');
  return `<div class="fac-table-wrap"><table class="fac-table"><thead><tr><th>Joueur</th><th>Grade</th><th>Vaisseau(x)</th></tr></thead><tbody>${rows || '<tr><td colspan="3" style="opacity:.6">Aucun joueur trouvé.</td></tr>'}</tbody></table></div>`;
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
function facSetItem(id, qty) { return facAction(() => facApi(facUrl(`/inventaire/${encodeURIComponent(id)}`), 'PUT', { quantity: Number(qty) }), 'Inventaire mis à jour.'); }
function facAjouterObjet() {
  const id = document.getElementById('fac-new-item').value;
  const qty = Number(document.getElementById('fac-new-qty').value);
  if (!id) return toast('Choisis un objet.', 'erreur');
  return facSetItem(id, qty);
}
function facAssigner(shipId, userId) { return facAction(() => facApi(facUrl(`/vaisseaux/${encodeURIComponent(shipId)}/pilote`), 'PUT', { userId: userId || null }), userId ? 'Vaisseau attribué.' : 'Vaisseau retiré à son pilote.'); }

async function facSupprimerVaisseau(shipId) {
  const ship = facState.data.ships.find(s => s.id === shipId);
  const ok = await confirmerAction({ titre: 'Supprimer le vaisseau', message: `Supprimer définitivement « ${ship?.name || shipId} » ?`, texteValider: 'Supprimer' });
  if (!ok) return;
  return facAction(() => facApi(facUrl(`/vaisseaux/${encodeURIComponent(shipId)}`), 'DELETE'), 'Vaisseau supprimé.');
}

// ------------------------------------------------------------------ modale vaisseau
function facFermerModale() { document.getElementById('fac-overlay')?.remove(); }

function facOuvrirVaisseau(shipId) {
  const ship = shipId ? facState.data.ships.find(s => s.id === shipId) : null;
  const classes = facState.meta.classes;
  const base = ship || { classKey: classes[0].key, ...Object.fromEntries(Object.entries(classes[0].defaults).map(([k, v]) => [k, v])), squadrons: classes[0].squadrons };
  const v = ship ? { name: ship.name, classKey: ship.classKey, hpMax: ship.hpMax, shieldMax: ship.shieldMax, range: ship.range, crewMax: ship.crewMax, squadrons: ship.squadrons, barrage: ship.barrage, focus: ship.focus }
    : { name: '', classKey: base.classKey, hpMax: base.hp, shieldMax: base.shield, range: base.range, crewMax: base.crew, squadrons: base.squadrons, barrage: base.barrage, focus: base.focus };
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
      ${field('fv-hp', 'PV max', v.hpMax, 'min="1"')}${field('fv-shield', 'Bouclier max', v.shieldMax)}
      ${field('fv-crew', 'Équipage max', v.crewMax)}${field('fv-range', 'Portée (cases)', v.range, 'min="1"')}
      ${field('fv-barrage', 'Dégâts tir de barrage', v.barrage)}${field('fv-focus', 'Dégâts tir ciblé', v.focus)}
      ${field('fv-squadrons', 'Escadrons de chasseurs', v.squadrons)}
    </div>
    ${ship ? '<p class="fac-hint" style="margin-top:14px">Enregistrer remet les PV, le bouclier et l\'équipage au maximum.</p>' : '<p class="fac-hint" style="margin-top:14px">Choisir une classe pré-remplit des statistiques de départ : tu peux toutes les modifier.</p>'}
    <div class="fac-modal-actions"><button class="btn-secondaire" onclick="facFermerModale()">Annuler</button><button class="btn-principal" onclick="facSauverVaisseau(${ship ? `'${jsAttr(ship.id)}'` : 'null'})">${ship ? 'Enregistrer' : 'Créer'}</button></div>
  </div>`;
  document.body.appendChild(overlay);
  document.getElementById('fv-name').focus();
}

// Pré-remplit les statistiques avec le modèle de la classe choisie.
function facAppliquerClasse() {
  const cls = facState.meta.classes.find(c => c.key === document.getElementById('fv-class').value);
  if (!cls) return;
  const set = (id, value) => { document.getElementById(id).value = value; };
  set('fv-hp', cls.defaults.hp); set('fv-shield', cls.defaults.shield); set('fv-crew', cls.defaults.crew);
  set('fv-range', cls.defaults.range); set('fv-barrage', cls.defaults.barrage); set('fv-focus', cls.defaults.focus);
  set('fv-squadrons', cls.squadrons);
}

async function facSauverVaisseau(shipId) {
  const val = (id) => document.getElementById(id).value;
  const body = {
    name: val('fv-name'), classKey: val('fv-class'),
    hpMax: Number(val('fv-hp')), shieldMax: Number(val('fv-shield')), crewMax: Number(val('fv-crew')),
    range: Number(val('fv-range')), barrage: Number(val('fv-barrage')), focus: Number(val('fv-focus')),
    squadrons: Number(val('fv-squadrons')),
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