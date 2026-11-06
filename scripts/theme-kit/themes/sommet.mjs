// Sommet: sport and outdoor. Cold blues with a bright orange, energetic and bold.
const t = (en, fr) => ({ en, fr });
const stock = (...n) => n.map((stock) => ({ stock }));

export default {
  handle: 'sommet',
  name: 'Sommet',
  version: '1.0.0',
  date: '2026-11-06',
  header: { layout: 'mega', sticky: true },
  card: { style: 'rounded', ratio: 'square', align: 'left', quickAdd: true, showVendor: false },
  product: {
    layout: 'stacked', ratio: 'square',
    benefits: [
      { icon: 'shield', text: t('Five-year guarantee on every piece of kit', 'Garantie cinq ans sur chaque équipement') },
      { icon: 'refresh', text: t('Try it on a trail: 60-day returns', 'Essayez-le sur un sentier : retours sous 60 jours') },
      { icon: 'truck', text: t('Free delivery from 75', 'Livraison offerte dès 75') },
    ],
  },
  collection: { layout: 'sidebar', columns: 4, perPage: 16, infiniteScroll: true },
  fonts: { heading: 'space-grotesk', body: 'inter', accent: 'space-grotesk' },
  type: { h1: 480, h2: 300, headingWeight: 700, h1LineHeight: 92, headingCase: 'uppercase', lineHeight: 160, baseSize: 16 },
  colors: {
    accent: '#ff6a13', background: '#eef3f8', surface: '#d9e5f0', card: '#ffffff', text: '#0b1d33', sale: '#d3321c', soldOut: '#4d5d70',
    swatchColors: 'Navy:#0f2a4a,Bleu nuit:#0f2a4a,Orange:#ff6a13,Steel:#8d9bab,Acier:#8d9bab,Black:#0b1d33,Noir:#0b1d33,Blue:#2f7fd1,Bleu:#2f7fd1',
    schemes: [
      { name: 'Ice', background: '#eef3f8', text: '#0b1d33', surface: '#d9e5f0', card: '#ffffff', border: '#c3d3e2', button: '#ff6a13', button_label: '#0b1d33' },
      { name: 'Night', background: '#0b1d33', text: '#eaf2fa', surface: '#12304f', card: '#12304f', border: '#25496e', button: '#ff6a13', button_label: '#0b1d33' },
      { name: 'Blaze', background: '#ff6a13', text: '#0b1d33', surface: '#ff8236', card: '#ff8236', border: '#d9540a', button: '#0b1d33', button_label: '#ffffff' },
      { name: 'Glacier', background: '#c9dcec', text: '#0b1d33', surface: '#b7cfe4', card: '#e6f0f8', border: '#9db9d1', button: '#0b1d33', button_label: '#eef3f8' },
    ],
  },
  scale: { radius: 'sharp', spacing: 'compact', pageWidth: 1360 },
  buttons: { uppercase: true, height: 52, border: 2, font: 'heading' },
  announcement: { text: t('Free delivery from 75. Five-year guarantee. 60-day trail returns.', 'Livraison offerte dès 75. Garantie cinq ans. Retours sous 60 jours.'), scheme: 'scheme-3' },
  footerScheme: 'scheme-2',
  sections: ['activity-tiles', 'spec-compare', 'trail-promise'],
  features: { breadcrumbs: true, backToTop: true, stockCounter: true, stockThreshold: 8 },
  freeShipping: 75,
  home: [
    {
      id: 'hero', type: 'hero',
      settings: {
        layout: 'full', color_scheme: 'scheme-2',
        eyebrow: t('Hike. Run. Camp.', 'Rando. Course. Bivouac.'),
        heading: t('Go higher', 'Visez plus haut'),
        text: t('Light, tough gear for long days outside, tested on the trails before it reaches you.', 'Un équipement léger et solide pour les longues journées dehors, testé sur les sentiers avant de vous parvenir.'),
        button_label: t('Shop the gear', 'Voir l’équipement'), button_link: '/collections/all',
        button_2_label: t('By activity', 'Par activité'), button_2_link: '/collections/hike',
      },
      blocks: [
        { type: 'chip', settings: { icon: 'shield', text: t('Five-year guarantee', 'Garantie cinq ans') } },
        { type: 'chip', settings: { icon: 'refresh', text: t('60-day trail returns', 'Retours sous 60 jours') } },
        { type: 'chip', settings: { icon: 'package', text: t('Light by design', 'Léger par conception') } },
      ],
    },
    {
      id: 'activities', type: 'activity-tiles',
      settings: { eyebrow: t('Pick your day', 'Choisissez votre journée'), heading: t('Shop by activity', 'Acheter par activité'), color_scheme: 'scheme-1' },
      blocks: [
        { type: 'activity', settings: { title: t('Hike', 'Rando'), text: t('Packs, poles and layers for long days.', 'Sacs, bâtons et couches pour les longues journées.'), product: 'hiking-backpack-30l', link: '/collections/hike' } },
        { type: 'activity', settings: { title: t('Run', 'Course'), text: t('Shoes and bottles built for speed.', 'Chaussures et gourdes conçues pour la vitesse.'), product: 'trail-running-shoes', link: '/collections/run' } },
        { type: 'activity', settings: { title: t('Camp', 'Bivouac'), text: t('Light and heat when the sun goes down.', 'De la lumière et de la chaleur quand le soleil se couche.'), product: 'led-headlamp', link: '/collections/camp' } },
      ],
    },
    { id: 'gear', type: 'featured-collection', settings: { eyebrow: t('Just landed', 'Tout juste arrivé'), heading: t('Fresh gear', 'Équipement tout neuf'), text: '', collection: 'all', products_to_show: 4, columns: '4', show_view_all: true, color_scheme: 'scheme-1' } },
    {
      id: 'specs', type: 'spec-compare',
      settings: { eyebrow: t('Tech specs', 'Fiche technique'), heading: t('Compare before you go', 'Comparez avant de partir'), label_1: t('Weight', 'Poids'), label_2: t('Best for', 'Idéal pour'), label_3: t('Weather rating', 'Protection météo'), label_4: t('Warranty', 'Garantie'), button_label: t('View', 'Voir'), color_scheme: 'scheme-4' },
      blocks: [
        { type: 'item', settings: { product: 'hiking-backpack-30l', badge: t('Best seller', 'Meilleure vente'), value_1: t('980 g', '980 g'), value_2: t('Day hikes, 30 L', 'Randos à la journée, 30 L'), value_3: t('Rain cover included', 'Housse de pluie incluse'), value_4: t('5 years', '5 ans') } },
        { type: 'item', settings: { product: 'light-windbreaker-jacket', badge: '', value_1: t('190 g', '190 g'), value_2: t('Ridge lines and wind', 'Crêtes et vent'), value_3: t('Wind and showerproof', 'Coupe-vent, résiste aux averses'), value_4: t('5 years', '5 ans') } },
        { type: 'item', settings: { product: 'trail-running-shoes', badge: t('New', 'Nouveau'), value_1: t('270 g each', '270 g chacune'), value_2: t('Rocky and muddy trails', 'Sentiers rocheux et boueux'), value_3: t('Quick-dry mesh', 'Maille à séchage rapide'), value_4: t('2 years', '2 ans') } },
      ],
    },
    {
      id: 'promise', type: 'trail-promise',
      settings: { eyebrow: t('Trail tested', 'Testé sur le terrain'), heading: t('Tested where it counts', 'Testé là où ça compte'), text: t('Every piece goes through a season of real use before it reaches the shop. If it fails on a trail, it does not ship.', 'Chaque pièce traverse une saison d’usage réel avant d’arriver en boutique. Si elle lâche sur un sentier, elle n’est pas vendue.'), button_label: t('Our promise', 'Notre promesse'), button_link: '/pages/about-us', color_scheme: 'scheme-3' },
      blocks: [
        { type: 'stat', settings: { value: t('500 km', '500 km'), label: t('walked by every prototype', 'parcourus par chaque prototype') } },
        { type: 'stat', settings: { value: t('3 seasons', '3 saisons'), label: t('of field testing', 'de tests sur le terrain') } },
        { type: 'stat', settings: { value: t('5 years', '5 ans'), label: t('guarantee on every piece', 'de garantie sur chaque pièce') } },
      ],
    },
    {
      id: 'story', type: 'image-with-text',
      settings: {
        layout: 'right', color_scheme: 'scheme-1',
        eyebrow: t('On the trail', 'Sur le sentier'),
        heading: t('Built by people who run in the rain', 'Conçu par des gens qui courent sous la pluie'),
        text: t('<p>Sommet started with a few friends who were tired of kit that failed halfway up a mountain. We design for the first hour and the tenth, and we repair what we sell.</p>', '<p>Sommet est né de quelques amis lassés d’un équipement qui lâche à mi-pente. Nous concevons pour la première heure comme pour la dixième, et nous réparons ce que nous vendons.</p>'),
        button_label: t('Read our story', 'Lire notre histoire'), button_link: '/pages/about-us',
      },
    },
    {
      id: 'reviews', type: 'testimonials',
      settings: { heading: t('Out there with Sommet', 'Dehors avec Sommet'), color_scheme: 'scheme-1' },
      blocks: [
        { type: 'testimonial', settings: { quote: t('The pack carried everything for a three-day trek and never rubbed. Best straps I have used.', 'Le sac a tout porté pour trois jours de trek sans jamais frotter. Les meilleures bretelles que j’aie essayées.'), name: 'Julien P.', detail: t('Hiking backpack 30 L', 'Sac à dos de randonnée 30 L'), rating: 5 } },
        { type: 'testimonial', settings: { quote: t('Grip on wet rock is excellent and they dry in minutes after a stream crossing.', 'L’adhérence sur roche mouillée est excellente et elles sèchent en quelques minutes après un gué.'), name: 'Inès B.', detail: t('Trail running shoes', 'Chaussures de trail'), rating: 5 } },
        { type: 'testimonial', settings: { quote: t('Bright enough for a night descent and light enough to forget it is on my head.', 'Assez puissante pour une descente de nuit et assez légère pour l’oublier sur la tête.'), name: 'Marc T.', detail: t('LED headlamp', 'Lampe frontale'), rating: 5 } },
      ],
    },
    { id: 'newsletter', type: 'newsletter', settings: { heading: t('Join the summit list', 'Rejoignez la liste Sommet'), text: t('Trail guides, new gear and 10% off your first order.', 'Guides de sentiers, nouveautés et 10 % sur votre première commande.'), button_label: t('Subscribe', 'S’abonner'), color_scheme: 'scheme-3' } },
  ],
  templates: {
    'page.trail-promise': [
      { id: 'promise', type: 'trail-promise', settings: { eyebrow: t('Trail tested', 'Testé sur le terrain'), heading: t('Our promise', 'Notre promesse'), text: t('Every piece goes through a season of real use before it reaches the shop. If it fails on a trail, it does not ship.', 'Chaque pièce traverse une saison d’usage réel avant d’arriver en boutique. Si elle lâche sur un sentier, elle n’est pas vendue.'), button_label: t('Shop the gear', 'Voir l’équipement'), button_link: '/collections/all', color_scheme: 'scheme-3' }, blocks: [
        { type: 'stat', settings: { value: t('500 km', '500 km'), label: t('walked by every prototype', 'parcourus par chaque prototype') } },
        { type: 'stat', settings: { value: t('3 seasons', '3 saisons'), label: t('of field testing', 'de tests sur le terrain') } },
        { type: 'stat', settings: { value: t('5 years', '5 ans'), label: t('guarantee on every piece', 'de garantie sur chaque pièce') } },
      ] },
    ],
  },
  css: `
.k-eyebrow { font: 700 .8rem/1.3 var(--f-heading); letter-spacing: .2em; text-transform: uppercase; color: var(--v-accent); }
.k-section__title { font-weight: 700; letter-spacing: -.02em; line-height: 1; font-size: clamp(2rem, 4vw, 3.2rem); }
.k-hero__heading { font-weight: 700; letter-spacing: -.035em; line-height: .92; text-transform: uppercase; font-size: clamp(3.4rem, 10vw, 7rem); max-width: 10ch; }
.k-hero--full .k-arch img { object-position: 72% 40%; }
.k-hero__text { font-size: 1.15rem; }
.k-chips li { border-radius: 0; text-transform: uppercase; letter-spacing: .08em; font-size: .72rem; font-weight: 700; }
.k-announce { font: 700 .76rem/1.3 var(--f-heading); letter-spacing: .14em; text-transform: uppercase; }
.k-card__title { font: 700 1rem/1.2 var(--f-heading); text-transform: uppercase; letter-spacing: .01em; }
.k-price { font-weight: 700; }
.k-logo__name { font: 700 clamp(1.4rem, 2.4vw, 1.9rem)/1 var(--f-heading); letter-spacing: -.03em; text-transform: uppercase; }
.k-footer__brand { font: 700 1.9rem/1 var(--f-heading); text-transform: uppercase; letter-spacing: -.03em; }
.k-badge { border-radius: 0; text-transform: uppercase; font-weight: 700; letter-spacing: .08em; }
.k-quote { border-radius: 0; border-left: 6px solid var(--v-accent); }
.k-pdp--stacked .k-info__title { font-size: clamp(1.9rem, 3.4vw, 2.8rem); text-transform: uppercase; letter-spacing: -.02em; line-height: 1; }
.k-listing__title { text-transform: uppercase; letter-spacing: -.02em; }
.k-newsletter-band__inner { border-radius: 0; }
`,
  info: {
    description: t(
      'A bold storefront for sport and outdoor gear: a mega menu header, rounded product cards, a product page with every photo in a column, a sidebar of filters with infinite scroll, activity tiles, a specs comparison and a trail-tested promise. Cold blues with a bright orange.',
      'Une boutique tonique pour le sport et le plein air : en-tête à méga-menu, cartes produit arrondies, page produit avec toutes les photos en colonne, filtres latéraux avec défilement infini, tuiles d’activités, comparatif technique et promesse testée sur le terrain. Bleus froids et orange vif.',
    ),
    tags: ['Sports', 'Outdoor', 'Bold'],
    industries: ['sports', 'outdoor'],
    catalogSize: 'some',
  },
  changelog: [
    t('First release of Sommet, a bold theme for sport and outdoor shops.', 'Première version de Sommet, un thème tonique pour les boutiques de sport et de plein air.'),
    t('Header with the logo on the left, a mega menu that opens columns of links, a search panel and a slide-in bag.', 'En-tête avec le logo à gauche, méga-menu qui ouvre des colonnes de liens, panneau de recherche et panier latéral.'),
    t('Rounded product cards with a second photo on hover, colour swatches and a quick add button.', 'Cartes produit arrondies avec seconde photo au survol, pastilles de couleur et bouton d’ajout rapide.'),
    t('Product page with every photo in a column while the details stay in view, options, subscriptions and a low stock message.', 'Page produit avec toutes les photos en colonne pendant que les détails restent visibles, options, abonnements et message de stock faible.'),
    t('Collection page with a sidebar of filters, sorting and infinite scroll.', 'Page collection avec barre latérale de filtres, tri et défilement infini.'),
    t('New sections: activity tiles, specs comparison, trail-tested promise and a countdown timer.', 'Nouvelles sections : tuiles d’activités, comparatif technique, promesse testée sur le terrain et compte à rebours.'),
    t('Breadcrumbs, back to top button and an optional age check.', 'Fil d’Ariane, bouton retour en haut et vérification d’âge facultative.'),
    t('Section names, settings and storefront texts are translated to English and French.', 'Les noms des sections, les réglages et les textes de la boutique sont traduits en anglais et en français.'),
  ],
  demo: {
    currency: 'EUR',
    homeImages: { hero: { image: 'hero.webp' }, story: { image: 'ambiance.webp' } },
    menu: [
      { title: t('Hike', 'Rando'), url: '/collections/hike', children: [
        { title: t('Carry', 'Porter'), url: '/collections/hike', children: [{ title: t('Hiking backpack 30 L', 'Sac à dos de randonnée 30 L'), url: '/products/hiking-backpack-30l' }, { title: t('Folding trekking poles', 'Bâtons de marche pliants'), url: '/products/folding-trekking-poles' }] },
        { title: t('Explore', 'Explorer'), url: '/collections/all', children: [{ title: t('All hiking gear', 'Tout pour la rando'), url: '/collections/hike' }, { title: t('Our promise', 'Notre promesse'), url: '/pages/trail-promise' }] },
      ] },
      { title: t('Run', 'Course'), url: '/collections/run', children: [
        { title: t('Run', 'Courir'), url: '/collections/run', children: [{ title: t('Trail running shoes', 'Chaussures de trail'), url: '/products/trail-running-shoes' }, { title: t('Light windbreaker jacket', 'Veste coupe-vent légère'), url: '/products/light-windbreaker-jacket' }] },
        { title: t('Explore', 'Explorer'), url: '/collections/all', children: [{ title: t('All running gear', 'Tout pour la course'), url: '/collections/run' }] },
      ] },
      { title: t('Camp', 'Bivouac'), url: '/collections/camp', children: [
        { title: t('Camp', 'Bivouac'), url: '/collections/camp', children: [{ title: t('LED headlamp', 'Lampe frontale'), url: '/products/led-headlamp' }, { title: t('Insulated steel bottle', 'Gourde isotherme en acier'), url: '/products/insulated-steel-bottle' }] },
        { title: t('Explore', 'Explorer'), url: '/collections/all', children: [{ title: t('All camping gear', 'Tout pour le bivouac'), url: '/collections/camp' }] },
      ] },
      { title: t('Our promise', 'Notre promesse'), url: '/pages/trail-promise' },
    ],
    footerMenu: [
      { title: t('Shop all', 'Tout voir'), url: '/collections/all' },
      { title: t('Our promise', 'Notre promesse'), url: '/pages/trail-promise' },
      { title: t('Search', 'Recherche'), url: '/search' },
    ],
    pages: [{ handle: 'trail-promise', title: t('Our promise', 'Notre promesse'), template: 'trail-promise' }],
    collections: [
      { handle: 'hike', title: t('Hike', 'Rando'), description: t('Packs, poles and layers for long days.', 'Sacs, bâtons et couches pour les longues journées.'), products: ['hiking-backpack-30l', 'folding-trekking-poles', 'light-windbreaker-jacket', 'led-headlamp'] },
      { handle: 'run', title: t('Run', 'Course'), description: t('Shoes, layers and bottles built for speed.', 'Chaussures, couches et gourdes conçues pour la vitesse.'), products: ['trail-running-shoes', 'light-windbreaker-jacket', 'insulated-steel-bottle'] },
      { handle: 'camp', title: t('Camp', 'Bivouac'), description: t('Light, heat and water when the sun goes down.', 'Lumière, chaleur et eau quand le soleil se couche.'), products: ['led-headlamp', 'insulated-steel-bottle', 'hiking-backpack-30l'] },
    ],
    products: [
      {
        handle: 'hiking-backpack-30l', image: 'produit-01.webp', extraImages: ['hero.webp', 'ambiance.webp'], vendor: 'Sommet', type: t('Packs', 'Sacs'), tags: ['hike', 'backpack', 'new'],
        title: t('Hiking Backpack 30 L', 'Sac à dos de randonnée 30 L'),
        description: t('A 30 litre day pack with a ventilated back, padded hip belt, two bottle pockets and a rain cover in its own pocket. 980 g.', 'Un sac de 30 litres pour la journée avec dos ventilé, ceinture rembourrée, deux poches à gourde et housse de pluie dans sa poche. 980 g.'),
        options: [{ name: t('Colour', 'Couleur'), values: [t('Navy', 'Bleu nuit'), t('Orange', 'Orange')] }],
        price: 129, variants: stock(14, 9),
      },
      {
        handle: 'insulated-steel-bottle', image: 'produit-02.webp', vendor: 'Sommet', type: t('Bottles', 'Gourdes'), tags: ['run', 'camp', 'bottle', 'gift'],
        title: t('Insulated Steel Bottle', 'Gourde isotherme en acier'),
        description: t('Double-wall stainless steel that keeps drinks cold for 24 hours or hot for 12. Leak-proof lid, fits standard bottle pockets.', 'Acier inoxydable double paroi : boissons fraîches 24 heures ou chaudes 12 heures. Bouchon étanche, se glisse dans les poches à gourde.'),
        options: [{ name: t('Size', 'Contenance'), values: ['500 ml', '750 ml'] }],
        price: 29, variants: stock(40, 26),
      },
      {
        handle: 'light-windbreaker-jacket', image: 'produit-03.webp', vendor: 'Sommet', type: t('Jackets', 'Vestes'), tags: ['hike', 'run', 'jacket'],
        title: t('Light Windbreaker Jacket', 'Veste coupe-vent légère'),
        description: t('A 190 g windbreaker that packs into its own pocket. Wind-proof, showerproof and cut long in the back for a pack.', 'Un coupe-vent de 190 g qui se range dans sa poche. Protège du vent, résiste aux averses et coupé long dans le dos pour le sac.'),
        options: [{ name: t('Size', 'Taille'), values: ['S', 'M', 'L', 'XL'] }],
        price: 89, compareAt: 109, variants: stock(8, 14, 11, 6),
      },
      {
        handle: 'trail-running-shoes', image: 'produit-04.webp', vendor: 'Sommet', type: t('Shoes', 'Chaussures'), tags: ['run', 'shoes', 'new'],
        title: t('Trail Running Shoes', 'Chaussures de trail'),
        description: t('Grippy lugged outsole, a rock plate and quick-dry mesh for mud, roots and stream crossings. 270 g each.', 'Semelle crantée adhérente, protège-pierres et maille à séchage rapide pour la boue, les racines et les gués. 270 g chacune.'),
        options: [{ name: t('Size', 'Pointure'), values: ['40', '41', '42', '43', '44', '45'] }],
        price: 139, variants: stock(6, 10, 12, 11, 7, 3),
      },
      {
        handle: 'folding-trekking-poles', image: 'produit-05.webp', vendor: 'Sommet', type: t('Poles', 'Bâtons'), tags: ['hike', 'poles'],
        title: t('Folding Trekking Poles', 'Bâtons de marche pliants'),
        description: t('A pair of carbon poles that fold to 38 cm in seconds, with cork grips and a quick-lock strap. 480 g the pair.', 'Une paire de bâtons en carbone qui se plie à 38 cm en quelques secondes, avec poignées liège et dragonne à verrouillage rapide. 480 g la paire.'),
        options: [],
        price: 79, variants: stock(21),
      },
      {
        handle: 'led-headlamp', image: 'produit-06.webp', vendor: 'Sommet', type: t('Lights', 'Éclairage'), tags: ['camp', 'light', 'gift'],
        title: t('LED Headlamp', 'Lampe frontale'),
        description: t('A rechargeable headlamp with 400 lumens, a red night mode and a battery that lasts a full night descent. 85 g.', 'Une lampe frontale rechargeable de 400 lumens avec mode nuit rouge et une batterie qui tient toute une descente de nuit. 85 g.'),
        options: [{ name: t('Colour', 'Couleur'), values: [t('Black', 'Noir'), t('Orange', 'Orange')] }],
        price: 39, variants: stock(30, 18),
      },
    ],
  },
};
