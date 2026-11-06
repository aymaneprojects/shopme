// Serre: garden and plants. Deep greens and terracotta, botanical.
const t = (en, fr) => ({ en, fr });

export default {
  handle: 'serre',
  name: 'Serre',
  version: '1.0.0',
  date: '2026-11-06',
  header: { layout: 'centered', sticky: true },
  card: { style: 'arched', ratio: 'portrait', align: 'center', quickAdd: true },
  product: {
    layout: 'rail', ratio: 'portrait',
    benefits: [
      { icon: 'leaf', text: t('Grown without peat, packed in recycled card', 'Cultivé sans tourbe, emballé dans du carton recyclé') },
      { icon: 'shield', text: t('Arrives healthy or we replace it', 'Arrive en bonne santé ou nous la remplaçons') },
      { icon: 'truck', text: t('Free delivery from 60', 'Livraison offerte dès 60') },
    ],
  },
  collection: { layout: 'sidebar', columns: 3, perPage: 12, infiniteScroll: true },
  fonts: { heading: 'playfair-display', body: 'manrope', accent: 'lora' },
  type: { h1: 420, h2: 280, headingWeight: 500, h1LineHeight: 104, lineHeight: 170, baseSize: 16 },
  colors: {
    accent: '#2f6040', background: '#f4f2e9', surface: '#e2e8d4', card: '#fcfbf5', text: '#1b2a20', sale: '#b4452a', soldOut: '#5d6a5f',
    swatchColors: 'Terracotta:#c4693f,Terre cuite:#c4693f,Green:#2f6040,Vert:#2f6040,Sage:#9db08a,Sauge:#9db08a,Cream:#f1e9d6,Crème:#f1e9d6,Metal:#8d9a9c,Métal:#8d9a9c',
    schemes: [
      { name: 'Leaf', background: '#f4f2e9', text: '#1b2a20', surface: '#e2e8d4', card: '#fcfbf5', border: '#cfd6bd', button: '#2f6040', button_label: '#f4f2e9' },
      { name: 'Forest', background: '#1f3d2b', text: '#eef0e0', surface: '#2a4d37', card: '#2a4d37', border: '#436b53', button: '#d98558', button_label: '#1f2a20' },
      { name: 'Terracotta', background: '#c4693f', text: '#fff7ec', surface: '#d07a50', card: '#d07a50', border: '#a85430', button: '#1f3d2b', button_label: '#fff7ec' },
      { name: 'Clay', background: '#ecdcc4', text: '#2b2118', surface: '#e1cdb0', card: '#f6ebd9', border: '#cdb893', button: '#2f6040', button_label: '#f6ebd9' },
    ],
  },
  scale: { radius: 'round', spacing: 'regular', pageWidth: 1220, arch: true },
  buttons: { uppercase: false, height: 50, border: 1 },
  announcement: { text: t('Free delivery from 60. Every plant arrives healthy or we replace it.', 'Livraison offerte dès 60. Chaque plante arrive en bonne santé ou nous la remplaçons.'), scheme: 'scheme-2' },
  footerScheme: 'scheme-2',
  sections: ['care-levels', 'planting-calendar', 'plant-finder'],
  features: { breadcrumbs: true, backToTop: true, stockCounter: true, stockThreshold: 6 },
  freeShipping: 60,
  home: [
    {
      id: 'hero', type: 'hero',
      settings: {
        layout: 'center', color_scheme: 'scheme-4',
        eyebrow: t('Plants and garden', 'Plantes et jardin'),
        heading: t('Bring the greenhouse home', 'Ramenez la serre à la maison'),
        text: t('Healthy houseplants, terracotta pots and well-made garden tools, chosen by people who actually grow things.', 'Des plantes d’intérieur en pleine santé, des pots en terre cuite et de bons outils de jardin, choisis par des gens qui cultivent vraiment.'),
        button_label: t('Shop plants', 'Voir les plantes'), button_link: '/collections/plants',
        button_2_label: t('Garden tools', 'Outils de jardin'), button_2_link: '/collections/garden-tools',
        product: 'potted-monstera',
      },
      blocks: [
        { type: 'chip', settings: { icon: 'leaf', text: t('Peat-free soil', 'Terreau sans tourbe') } },
        { type: 'chip', settings: { icon: 'shield', text: t('Healthy on arrival', 'Saines à l’arrivée') } },
        { type: 'chip', settings: { icon: 'drop', text: t('Care advice included', 'Conseils d’entretien inclus') } },
      ],
    },
    {
      id: 'finder', type: 'plant-finder',
      settings: { eyebrow: t('Plant finder', 'Trouver sa plante'), heading: t('Which room are you planting for?', 'Pour quelle pièce cherchez-vous ?'), text: t('Pick a spot and we will show you what thrives there.', 'Choisissez un endroit, nous vous montrons ce qui s’y plaît.'), color_scheme: 'scheme-1' },
      blocks: [
        { type: 'room', settings: { title: t('Bright living room', 'Salon lumineux'), light: t('Bright, indirect light', 'Lumière vive, indirecte'), icon: 'sun', product: 'potted-monstera', link: '/collections/bright-room' } },
        { type: 'room', settings: { title: t('Sunny windowsill', 'Rebord de fenêtre ensoleillé'), light: t('Direct sun, little water', 'Plein soleil, peu d’eau'), icon: 'sun', product: 'terracotta-cactus', link: '/collections/sunny-windowsill' } },
        { type: 'room', settings: { title: t('Shady corner', 'Coin d’ombre'), light: t('Low light, hanging planters', 'Peu de lumière, suspensions'), icon: 'moon', product: 'macrame-plant-hanger', link: '/collections/shady-corner' } },
        { type: 'room', settings: { title: t('Balcony garden', 'Jardin de balcon'), light: t('Outdoors, all seasons', 'Dehors, toute l’année'), icon: 'leaf', product: 'seed-packet', link: '/collections/balcony-garden' } },
      ],
    },
    { id: 'plants', type: 'featured-collection', settings: { eyebrow: t('This week', 'Cette semaine'), heading: t('Fresh from the greenhouse', 'Tout frais de la serre'), text: t('Six things to grow, water and prune.', 'Six choses à cultiver, arroser et tailler.'), collection: 'all', products_to_show: 6, columns: '3', show_view_all: true, color_scheme: 'scheme-1' } },
    {
      id: 'care', type: 'care-levels',
      settings: { eyebrow: t('Easy to live with', 'Facile à vivre'), heading: t('How much care does it need?', 'Quel entretien demande-t-elle ?'), light_label: t('Light', 'Lumière'), water_label: t('Water', 'Arrosage'), color_scheme: 'scheme-4' },
      blocks: [
        { type: 'plant', settings: { product: 'potted-monstera', light: 2, water: 2, note: t('Likes a bright spot out of the midday sun. Water when the top soil is dry.', 'Aime une place lumineuse à l’abri du soleil de midi. Arrosez quand la terre est sèche en surface.') } },
        { type: 'plant', settings: { product: 'terracotta-cactus', light: 3, water: 1, note: t('Full sun and a drink once a fortnight in summer, less in winter.', 'Plein soleil et un verre d’eau tous les quinze jours l’été, moins l’hiver.') } },
      ],
    },
    {
      id: 'story', type: 'image-with-text',
      settings: {
        layout: 'left', color_scheme: 'scheme-1',
        eyebrow: t('The greenhouse', 'La serre'),
        heading: t('Good roots, good plants', 'De bonnes racines, de belles plantes'),
        text: t('<p>Every plant is repotted by hand in a peat-free mix and given a week to settle before it ships. We grow with small nurseries nearby and never sell what we would not keep on our own windowsill.</p>', '<p>Chaque plante est rempotée à la main dans un terreau sans tourbe et laissée une semaine au repos avant l’expédition. Nous travaillons avec de petites pépinières voisines et ne vendons rien que nous ne garderions pas sur notre propre rebord de fenêtre.</p>'),
        button_label: t('Read our story', 'Lire notre histoire'), button_link: '/pages/about-us',
      },
    },
    {
      id: 'calendar', type: 'planting-calendar',
      settings: { eyebrow: t('Season by season', 'Saison après saison'), heading: t('What to plant and when', 'Quoi planter et quand'), color_scheme: 'scheme-1' },
      blocks: [
        { type: 'season', settings: { title: t('Spring', 'Printemps'), months: t('March to May', 'De mars à mai'), icon: 'leaf', task_1: t('Sow seeds indoors', 'Semer à l’intérieur'), task_2: t('Repot houseplants', 'Rempoter les plantes d’intérieur'), task_3: t('Start feeding monthly', 'Reprendre l’engrais mensuel'), link: '/collections/all' } },
        { type: 'season', settings: { title: t('Summer', 'Été'), months: t('June to August', 'De juin à août'), icon: 'sun', task_1: t('Water early in the morning', 'Arroser tôt le matin'), task_2: t('Move plants from direct sun', 'Écarter les plantes du plein soleil'), task_3: t('Harvest herbs often', 'Cueillir les aromatiques souvent'), link: '/collections/balcony-garden' } },
        { type: 'season', settings: { title: t('Autumn', 'Automne'), months: t('September to November', 'De septembre à novembre'), icon: 'drop', task_1: t('Plant bulbs and hardy shrubs', 'Planter bulbes et arbustes rustiques'), task_2: t('Cut back and tidy beds', 'Couper et nettoyer les massifs'), task_3: t('Bring tender plants in', 'Rentrer les plantes fragiles'), link: '/collections/garden-tools' } },
        { type: 'season', settings: { title: t('Winter', 'Hiver'), months: t('December to February', 'De décembre à février'), icon: 'moon', task_1: t('Water less, keep the light', 'Moins d’eau, mais de la lumière'), task_2: t('Clean dusty leaves', 'Dépoussiérer les feuilles'), task_3: t('Plan next year’s beds', 'Préparer les massifs de l’an prochain'), link: '/collections/shady-corner' } },
      ],
    },
    { id: 'categories', type: 'collection-list', settings: { eyebrow: t('Browse', 'Parcourir'), heading: t('Shop by corner of the garden', 'Acheter par coin de jardin'), columns: '3', collections: [], color_scheme: 'scheme-1' } },
    {
      id: 'reviews', type: 'testimonials',
      settings: { heading: t('Grown with Serre', 'Cultivé avec Serre'), color_scheme: 'scheme-4' },
      blocks: [
        { type: 'testimonial', settings: { quote: t('The monstera arrived upright, glossy and already showing a new leaf. The care card was spot on.', 'Le monstera est arrivé droit, brillant, avec déjà une nouvelle feuille. La fiche d’entretien était parfaite.'), name: 'Camille R.', detail: t('Potted monstera', 'Monstera en pot'), rating: 5 } },
        { type: 'testimonial', settings: { quote: t('Finally a watering can that pours where you aim. It looks great on the balcony, too.', 'Enfin un arrosoir qui verse là où on vise. Il est beau sur le balcon, en plus.'), name: 'Paul D.', detail: t('Metal watering can', 'Arrosoir en métal'), rating: 5 } },
        { type: 'testimonial', settings: { quote: t('The secateurs cut clean and feel solid in the hand. I pruned the whole rose bed in an afternoon.', 'Le sécateur coupe net et tient bien en main. J’ai taillé tout le massif de rosiers en un après-midi.'), name: 'Sophie L.', detail: t('Pruning secateurs', 'Sécateur'), rating: 5 } },
      ],
    },
    { id: 'newsletter', type: 'newsletter', settings: { heading: t('The Serre letter', 'La lettre de Serre'), text: t('Monthly planting tips, what to sow now and 10% off your first order.', 'Chaque mois, des conseils de plantation, quoi semer maintenant et 10 % sur votre première commande.'), button_label: t('Subscribe', 'S’abonner'), color_scheme: 'scheme-2' } },
  ],
  templates: {
    'page.planting-calendar': [
      { id: 'calendar', type: 'planting-calendar', settings: { eyebrow: t('Season by season', 'Saison après saison'), heading: t('The planting calendar', 'Le calendrier de plantation'), color_scheme: 'scheme-1' }, blocks: [
        { type: 'season', settings: { title: t('Spring', 'Printemps'), months: t('March to May', 'De mars à mai'), icon: 'leaf', task_1: t('Sow seeds indoors', 'Semer à l’intérieur'), task_2: t('Repot houseplants', 'Rempoter les plantes d’intérieur'), task_3: t('Start feeding monthly', 'Reprendre l’engrais mensuel') } },
        { type: 'season', settings: { title: t('Summer', 'Été'), months: t('June to August', 'De juin à août'), icon: 'sun', task_1: t('Water early in the morning', 'Arroser tôt le matin'), task_2: t('Move plants from direct sun', 'Écarter les plantes du plein soleil'), task_3: t('Harvest herbs often', 'Cueillir les aromatiques souvent') } },
        { type: 'season', settings: { title: t('Autumn', 'Automne'), months: t('September to November', 'De septembre à novembre'), icon: 'drop', task_1: t('Plant bulbs and hardy shrubs', 'Planter bulbes et arbustes rustiques'), task_2: t('Cut back and tidy beds', 'Couper et nettoyer les massifs'), task_3: t('Bring tender plants in', 'Rentrer les plantes fragiles') } },
        { type: 'season', settings: { title: t('Winter', 'Hiver'), months: t('December to February', 'De décembre à février'), icon: 'moon', task_1: t('Water less, keep the light', 'Moins d’eau, mais de la lumière'), task_2: t('Clean dusty leaves', 'Dépoussiérer les feuilles'), task_3: t('Plan next year’s beds', 'Préparer les massifs de l’an prochain') } },
      ] },
    ],
  },
  css: `
.k-eyebrow { font: italic 500 1.12rem/1.3 var(--f-accent); color: var(--v-accent); }
.k-section__title { font-weight: 500; letter-spacing: -.015em; font-size: clamp(1.9rem, 3.4vw, 2.7rem); }
.k-hero__heading { font-weight: 500; letter-spacing: -.02em; font-style: italic; }
.k-card__title { font: 600 1.05rem/1.25 var(--f-heading); }
.k-price { font-weight: 600; }
.k-logo__name { font: italic 600 clamp(1.6rem, 3vw, 2.1rem)/1 var(--f-heading); letter-spacing: -.01em; }
.k-footer__brand { font: italic 600 1.8rem/1 var(--f-heading); }
.k-chips li { border-radius: var(--pill); }
.k-hero--center .k-hero__visual { display: block; width: min(100%, 1000px); margin-top: 44px; }
.k-hero--center .k-arch { aspect-ratio: 21 / 9; border-radius: 999px 999px var(--round) var(--round); }
.k-hero--center .k-arch img { width: 100%; height: 100%; object-fit: cover; object-position: 70% 40%; }
.k-hero--center .k-hero__product { display: none; }
@media (max-width: 699px) { .k-hero--center .k-arch { aspect-ratio: 4 / 3; border-radius: 999px 999px var(--round) var(--round); } }
.k-announce { font-size: .86rem; letter-spacing: .02em; }
.k-pdp--rail .k-info__title { font-style: italic; font-weight: 500; }
.k-listing__title { font-style: italic; font-weight: 500; }
`,
  info: {
    description: t(
      'A botanical storefront for plants, pots and garden tools: a centred header, arched product cards, a product page with a thumbnail rail, a sidebar of filters with infinite scroll, a plant finder by room, plant care levels and a seasonal planting calendar. Deep greens and terracotta.',
      'Une boutique botanique pour plantes, pots et outils de jardin : en-tête centré, cartes produit en arche, page produit à rail de miniatures, filtres latéraux avec défilement infini, recherche de plante par pièce, niveaux d’entretien et calendrier de plantation. Verts profonds et terre cuite.',
    ),
    tags: ['Garden', 'Plants', 'Home'],
    industries: ['garden', 'home'],
    catalogSize: 'few',
  },
  changelog: [
    t('First release of Serre, a botanical theme for plant, pot and garden tool shops.', 'Première version de Serre, un thème botanique pour les boutiques de plantes, de pots et d’outils de jardin.'),
    t('Centred header with search on the left, a slide-in bag and a menu on its own row.', 'En-tête centré avec recherche à gauche, panier latéral et menu sur sa propre ligne.'),
    t('Arched product cards with a second photo on hover, colour swatches and a quick add button.', 'Cartes produit en arche avec seconde photo au survol, pastilles de couleur et bouton d’ajout rapide.'),
    t('Product page with a vertical rail of thumbnails, options, subscriptions and a low stock message.', 'Page produit avec un rail vertical de miniatures, options, abonnements et message de stock faible.'),
    t('Collection page with a sidebar of filters, sorting and infinite scroll.', 'Page collection avec barre latérale de filtres, tri et défilement infini.'),
    t('New sections: plant finder by room, plant care levels, seasonal planting calendar and a countdown timer.', 'Nouvelles sections : recherche de plante par pièce, niveaux d’entretien, calendrier de plantation saisonnier et compte à rebours.'),
    t('Breadcrumbs, back to top button and an optional age check.', 'Fil d’Ariane, bouton retour en haut et vérification d’âge facultative.'),
    t('Section names, settings and storefront texts are translated to English and French.', 'Les noms des sections, les réglages et les textes de la boutique sont traduits en anglais et en français.'),
  ],
  demo: {
    currency: 'EUR',
    homeImages: { hero: { image: 'hero.webp' }, story: { image: 'ambiance.webp' } },
    menu: [
      { title: t('Plants', 'Plantes'), url: '/collections/plants' },
      { title: t('Garden tools', 'Outils de jardin'), url: '/collections/garden-tools' },
      { title: t('By room', 'Par pièce'), url: '/collections/bright-room' },
      { title: t('Calendar', 'Calendrier'), url: '/pages/planting-calendar' },
    ],
    footerMenu: [
      { title: t('Shop all', 'Tout voir'), url: '/collections/all' },
      { title: t('Planting calendar', 'Calendrier de plantation'), url: '/pages/planting-calendar' },
      { title: t('Search', 'Recherche'), url: '/search' },
    ],
    pages: [{ handle: 'planting-calendar', title: t('Planting calendar', 'Calendrier de plantation'), template: 'planting-calendar' }],
    collections: [
      { handle: 'plants', title: t('Plants', 'Plantes'), description: t('Houseplants and succulents, repotted by hand.', 'Plantes d’intérieur et succulentes, rempotées à la main.'), products: ['potted-monstera', 'terracotta-cactus'] },
      { handle: 'garden-tools', title: t('Garden tools', 'Outils de jardin'), description: t('Tools and seeds that earn their place in the shed.', 'Des outils et des graines qui ont leur place dans la cabane.'), products: ['metal-watering-can', 'pruning-secateurs', 'seed-packet'] },
      { handle: 'bright-room', title: t('Bright living room', 'Salon lumineux'), description: t('Statement plants for bright, indirect light.', 'Des plantes décoratives pour une lumière vive et indirecte.'), products: ['potted-monstera', 'metal-watering-can'] },
      { handle: 'sunny-windowsill', title: t('Sunny windowsill', 'Rebord de fenêtre ensoleillé'), description: t('Sun lovers that ask for very little water.', 'Des amoureuses du soleil qui demandent très peu d’eau.'), products: ['terracotta-cactus', 'seed-packet'] },
      { handle: 'shady-corner', title: t('Shady corner', 'Coin d’ombre'), description: t('Hanging planters and shade-tolerant greens.', 'Suspensions et plantes qui supportent l’ombre.'), products: ['macrame-plant-hanger', 'potted-monstera'] },
      { handle: 'balcony-garden', title: t('Balcony garden', 'Jardin de balcon'), description: t('Seeds and tools for a small outdoor space.', 'Graines et outils pour un petit espace extérieur.'), products: ['seed-packet', 'metal-watering-can', 'pruning-secateurs'] },
    ],
    products: [
      {
        handle: 'potted-monstera', image: 'produit-01.webp', extraImages: ['hero.webp', 'ambiance.webp'], vendor: 'Serre', type: t('Plants', 'Plantes'), tags: ['plants', 'houseplant', 'new'],
        title: t('Potted Monstera', 'Monstera en pot'),
        description: t('A full monstera deliciosa in a 21 cm pot, with the split leaves that make it famous. Bright, indirect light and a weekly drink are all it asks.', 'Un monstera deliciosa bien fourni en pot de 21 cm, avec les feuilles découpées qui font sa réputation. Une lumière vive et indirecte et un arrosage par semaine lui suffisent.'),
        options: [{ name: t('Size', 'Taille'), values: [t('Medium', 'Moyen'), t('Large', 'Grand')] }],
        price: 39, variants: [{ stock: 14 }, { stock: 5 }],
      },
      {
        handle: 'terracotta-cactus', image: 'produit-02.webp', vendor: 'Serre', type: t('Plants', 'Plantes'), tags: ['plants', 'cactus', 'gift'],
        title: t('Cactus in Terracotta', 'Cactus en terre cuite'),
        description: t('A sturdy cactus in a hand-finished terracotta pot with a drainage saucer. Full sun, a drink every two weeks, and it keeps going for years.', 'Un cactus robuste dans un pot en terre cuite fini à la main, avec soucoupe de drainage. Plein soleil, un verre d’eau tous les quinze jours, et il dure des années.'),
        options: [{ name: t('Pot', 'Pot'), values: [t('Terracotta', 'Terre cuite'), t('Cream', 'Crème')] }],
        price: 19, variants: [{ stock: 22 }, { stock: 9 }],
      },
      {
        handle: 'metal-watering-can', image: 'produit-03.webp', vendor: 'Serre', type: t('Garden tools', 'Outils de jardin'), tags: ['tools', 'watering', 'gift'],
        title: t('Metal Watering Can', 'Arrosoir en métal'),
        description: t('A 2 litre galvanised can with a long, slim spout that pours exactly where you aim, and a removable rose for seedlings.', 'Un arrosoir galvanisé de 2 litres au long bec fin qui verse exactement où l’on vise, avec pomme amovible pour les semis.'),
        options: [{ name: t('Finish', 'Finition'), values: [t('Metal', 'Métal'), t('Green', 'Vert')] }],
        price: 34, compareAt: 42, variants: [{ stock: 18 }, { stock: 7 }],
      },
      {
        handle: 'seed-packet', image: 'produit-04.webp', vendor: 'Serre', type: t('Seeds', 'Graines'), tags: ['seeds', 'balcony', 'gift'],
        title: t('Flower Seed Packet', 'Sachet de graines de fleurs'),
        description: t('A mix of open-pollinated annual flowers for pots and borders, sown from April. Good for bees, easy for beginners.', 'Un mélange de fleurs annuelles non hybrides pour pots et massifs, à semer dès avril. Bon pour les abeilles, facile pour les débutants.'),
        options: [],
        price: 4.5, variants: [{ stock: 80 }],
      },
      {
        handle: 'macrame-plant-hanger', image: 'produit-05.webp', vendor: 'Serre', type: t('Pots and hangers', 'Pots et suspensions'), tags: ['hanger', 'decor', 'gift'],
        title: t('Macramé Plant Hanger', 'Suspension macramé'),
        description: t('A hand-knotted cotton hanger that carries a 15 to 22 cm pot. Hang it by a bright window and let trailing plants spill over.', 'Une suspension en coton nouée à la main qui porte un pot de 15 à 22 cm. Accrochez-la près d’une fenêtre lumineuse et laissez retomber les plantes.'),
        options: [{ name: t('Colour', 'Couleur'), values: [t('Cream', 'Crème'), t('Sage', 'Sauge')] }],
        price: 24, variants: [{ stock: 16 }, { stock: 11 }],
      },
      {
        handle: 'pruning-secateurs', image: 'produit-06.webp', vendor: 'Serre', type: t('Garden tools', 'Outils de jardin'), tags: ['tools', 'pruning'],
        title: t('Pruning Secateurs', 'Sécateur'),
        description: t('Bypass secateurs with hardened steel blades and a soft-grip handle. Cuts stems up to 20 mm cleanly, and the blades can be replaced.', 'Sécateur à lames franches en acier trempé et poignée souple. Coupe net les tiges jusqu’à 20 mm, lames remplaçables.'),
        options: [],
        price: 29, variants: [{ stock: 25 }],
      },
    ],
  },
};
