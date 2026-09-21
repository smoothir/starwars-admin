module.exports = {
  // ==========================================
  // TEMPS STAR WARS (RP)
  // ==========================================
  RP_TIME: {
    YEAR: 9,
    ERA: "ABY", // Après la Bataille de Yavin
    DISPLAY: "An 9 après la Bataille de Yavin"
  },

  // ==========================================
  // PARAMÈTRES TICKET & VALIDATION
  // ==========================================
  TICKET_CATEGORY_ID: '1545274333654683743',
  VALIDATION_PING_ROLE_ID: '1545274332941385832',
  VALIDATION_ROLE_ID: '1545274332941385832',
  STAFF_ROLE_ID: '1545274332941385831',
  REMINDER_PING_ROLE_ID: '1545274332941385832',
  DEPOT_FICHE_PING_ROLE_ID: '1545274332941385832',
  LOGS_IMG_CHANNEL_ID: '1545697604585660476',
  VOTES_REQUIRED: 1,

  // ==========================================
  // SYSTÈME DE NIVEAUX (XP)
  // ==========================================
  BOOSTER_ROLE_ID: '1545650471253971055',
  BOOSTER_XP_MULTIPLIER: 1.5,
  XP_PER_MESSAGE: 15,
  XP_PER_ATTACHMENT: 10,
  XP_MESSAGE_COOLDOWN_MS: 60 * 1000,
  XP_PER_VOICE_MINUTE: 5,

  // ==========================================
  // FORUMS ET LOGS
  // ==========================================
  FACECLAIM_FORUM_ID: '1545274335332274253',
  RESERVATION_FORUM_ID: '1545274335332274250',
  VALIDATED_FICHE_FORUM_ID: '1545274335332274254',
  LOG_TICKETS_CHANNEL_ID: '1545274333851820096',
  LOG_TUPPER_CHANNEL_ID: '1545274333851820098', // Conservation du module Tupper
  GENERAL_PANEL_CHANNEL_ID: '1545274334720036977',
  // Forum listant les personnages par faction/grade, régénéré par /synclistchara
  CHARLIST_FORUM_ID: '1546361108703739965',

  // ==========================================
  // SYSTÈME DE RUMEURS
  // ==========================================
  RUMEUR_VALIDATION_REQUIRED: 1,
  RUMEUR_PUBLISH_CHANNEL_ID: '1545274335911084051',

  // ==========================================
  // TICKETS GÉNÉRAUX
  // ==========================================
  GENERAL_TICKET_TYPES: {
    animation: {
      label: "Demande d'animation",
      emoji: '🎭',
      categoryId: '1536485225830293654',
      pingRoleId: '1519456266869538997',
      description: "Tu veux proposer ou demander une animation RP ? Décris ton idée à l'équipe d'animation, elle reviendra vers toi ici.",
    },
    rumeur: {
      label: 'Rumeur',
      emoji: '🗣️',
      categoryId: '1539127222567182386',
      pingRoleId: '1519448938795634858',
      description: 'Tu veux proposer une rumeur pour le RP ? Un formulaire va s\'ouvrir, elle sera publiée une fois validée par le staff.',
    },
    support: {
      label: 'Support',
      emoji: '🛠️',
      categoryId: '1536485177658843197',
      pingRoleId: '1519448938795634858',
      description: "Une question, un souci technique ou autre chose ? L'équipe est là pour t'aider.",
    },
  },

  // ==========================================
  // RÔLES FIXES & LIMITES PERSOS
  // ==========================================
  FIXED_ROLES: {
    ROLISTE: '1545274332614230084',
    NB_PERSOS_CATEGORY: '1545274332819755021',
  },
  NB_PERSOS_TIERS: {
    1: '1545274332819755020',
    2: '1545274332819755019',
    3: '1545274332819755018',
  },

  // ==========================================
  // RÔLES ATTRIBUÉS AUTOMATIQUEMENT À L'ARRIVÉE
  // ==========================================
  JOIN_ROLES: [
    '1545274332614230085', // Cat HORS RP
    '1545274332614230082', // membre
  ],

  // ==========================================
  // PANEL DE RÔLES AUTO (clic pour obtenir/retirer un rôle)
  // ==========================================
  ROLE_PANEL_CHANNEL_ID: '1545274334720036976',
  ROLE_PANEL_ROLES: [
    {
      id: '1545274332614230083',
      label: 'Spectateur',
      emoji: '👀',
      description: 'Permet de voir le RP sans avoir de fiche',
    },
    {
      id: '1545274332614230081',
      label: 'Demande de RP',
      emoji: '🎭',
      description: 'Reçois le ping des gens qui recherchent du RP',
    },
    {
      id: '1545274332614230080',
      label: 'Demande de Lien',
      emoji: '🔗',
      description: 'Reçois le ping des gens qui recherchent des liens avec leur personnage',
    },
  ],

  // ==========================================
  // FACTIONS POUR LA CARTE "RELATION" (image/relation.png)
  // ==========================================
  // Ordre = ordre d'affichage sur l'image (gauche->droite, haut->bas).
  RELATION_FACTIONS: [
    { key: 'NOUVELLE_REPUBLIQUE', label: 'La Nouvelle République' },
    { key: 'EMPIRE', label: "L'Empire" },
    { key: 'ORDRE_JEDI', label: "L'Ordre Jedi" },
    { key: 'CARTEL_HUTTS', label: 'Cartel des Hutts' },
    { key: 'SYNDICAT_PYKE', label: 'Syndicat Pyke' },
    { key: 'AUBE_ECARLATE', label: "L'Aube Écarlate" },
  ],
  // Niveaux du plus bas (1) au plus haut (5).
  RELATION_LEVELS: ['Atroce', 'Médiocre', 'Neutre', 'Bonne', 'Excellente'],

  // ==========================================
  // RÔLES STAR WARS (FACTIONS & GRADES) — ère 9 ABY
  // ==========================================
  // `categoryRoleId` = rôle "en-tête" de la catégorie (celui qui commence par
  // ".　 ۫ ·" côté Discord), attribué automatiquement en plus du grade choisi.
  // `grades` est ordonné du grade le plus élevé au plus bas : cet ordre sert
  // à la fois pour le menu de sélection (étape 1 de /reservation) et pour le
  // tri d'affichage dans /synclistchara.
  FACTIONS: {
    NOUVELLE_REPUBLIQUE: {
      label: 'NOUVELLE REPUBLIQUE',
      categoryRoleId: '1545274332941385830',
      grades: [
        { name: 'Sénateur / Politique', id: '1546358692033728562' },
        { name: 'Ranger de la Nouvelle République', id: '1545274332916359266' },
        { name: 'Pilote / Militaire', id: '1545274332874285092' },
        { name: 'Citoyen de la République', id: '1545274332849377416' },
      ],
    },
    EMPIRE: {
      label: "L'EMPIRE",
      categoryRoleId: '1545638856232280094',
      grades: [
        { name: 'Moff / Seigneur de la Guerre', id: '1546359076529774642' },
        { name: 'Agent du BSI', id: '1545274332916359262' },
        { name: 'Stormtrooper / Conscrit', id: '1545274332916359263' },
      ],
    },
    ORDRE_JEDI: {
      label: "L'ORDRE JEDI",
      categoryRoleId: '1546357712042987570',
      grades: [
        { name: 'Jedi', id: '1545274332941385828' },
        { name: 'Apprenti de Luke', id: '1550736647052861520' },
        { name: 'Sensible à la Force', id: '1550736718913601566' },
      ],
    },
    PEGRE: {
      label: 'LA PEGRE & INDEPENDANTS',
      categoryRoleId: '1546358136078602291',
      grades: [
        { name: 'Cartel des Hutts', id: '1545274332916359268' },
        { name: 'Syndicat Pyke', id: '1545274332916359267' },
        { name: "L'Aube Écarlate", id: '1545274332874285087' },
        { name: 'Chef de Syndicat', id: '1545274332849377414' },
        { name: 'Chasseur de Primes', id: '1545274332849377412' },
        { name: 'Mercenaire Indépendant', id: '1545274332849377411' },
        { name: 'Contrebandier / Pirate', id: '1545274332849377410' },
        { name: 'Artisan / Marchand', id: '1545274332819755027' },
      ],
    },
  },
};