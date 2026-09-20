// Copié depuis Data/config.js du bot (TITRES / REGIONS / MAISONS) — sert à peupler
// les listes déroulantes du site pour les champs identité d'un profil (Maison,
// Région, Rôle). Si tu ajoutes/renommes un rôle ou une maison côté Discord dans
// config.js, reporte le changement ici aussi pour que les deux restent alignés.

const TITRES = [
  { name: 'Roi / Reine', id: '1536225700682539038' },
  { name: 'Main du Roi', id: '1536225778885206016' },
  { name: 'Petit Conseil', id: '1536225779451568128' },
  { name: 'Garde Royale', id: '1536226170490720376' },
  { name: 'Prince / Princesse', id: '1536225775454392350' },
  { name: 'Lord Suprême', id: '1536225776750559334' },
  { name: 'Lord / Lady', id: '1536225778004656179' },
  { name: 'Ser', id: '1536225778390401064' },
  { name: 'Mestre', id: '1536226202996572170' },
  { name: 'Lord Commandant de la Garde de Nuit', id: '1536226261712502877' },
  { name: 'Frères jurés', id: '1536226293966700546' },
  { name: 'Khal / Khaleesi', id: '1536226324484718682' },
];

const REGIONS = [
  { name: 'Le Nord', id: '1536224454663737364' },
  { name: 'Les Terres de la Couronne', id: '1536224486838374421' },
  { name: 'Le Conflans', id: '1536224575694835732' },
  { name: 'Le Val', id: '1536224628031094864' },
  { name: 'Le Bief', id: '1536224705709871335' },
  { name: "Les Terres de l'Ouest", id: '1536224668518850610' },
  { name: "Les Terres de l'Orage", id: '1536224773951201351' },
  { name: 'Les Îles de Fer', id: '1536224835234172998' },
  { name: 'Dorne', id: '1536224804087013486' },
  { name: 'Les Cités Libres', id: '1536225012577599528' },
  { name: 'Baie des Dragons', id: '1536224944000606238' },
  { name: 'La Mer Dothrak', id: '1536225071058784366' },
  { name: 'Désert Rouge', id: '1536225121734500433' },
  { name: 'Volantis', id: '1536224981971894282' },
  { name: 'Braavos', id: '1536225036950839326' },
];

const MAISONS = [
  { name: 'Maison Targaryen', id: '1538026582021513216' },
  { name: 'Maison Stark', id: '1538026663072374875' },
  { name: 'Maison Greyjoy', id: '1538026819012395038' },
  { name: 'Maison Lannister', id: '1538027014773276732' },
  { name: 'Maison Tully', id: '1538027059459137566' },
  { name: 'Maison Arryn', id: '1538027105655201912' },
  { name: 'Maison Jardinier', id: '1538027133887062076' },
  { name: 'Maison Baratheon', id: '1538027204066279434' },
  { name: 'Maison Martell', id: '1538027240481230940' },
];

module.exports = { TITRES, REGIONS, MAISONS };