// Comptine: children and toys. Cheerful pastels, rounded and playful, kept clean.
const t = (en, fr) => ({ en, fr });

export default {
  handle: 'comptine',
  name: 'Comptine',
  version: '1.0.0',
  date: '2026-11-06',
  header: { layout: 'centered', sticky: true },
  card: { style: 'arched', ratio: 'square', align: 'center', quickAdd: true },
  product: {
    layout: 'rail', ratio: 'square',
    benefits: [
      { icon: 'shield', text: t('Tested to European toy safety standards', 'Testé selon les normes européennes de sécurité des jouets') },
      { icon: 'gift', text: t('Free gift wrapping on request', 'Emballage cadeau offert sur demande') },
      { icon: 'refresh', text: t('Not the right toy? Exchange it within 30 days', 'Ce n’est pas le bon jouet ? Échangez-le sous 30 jours') },
    ],
  },
  collection: { layout: 'topbar', columns: 4, perPage: 12, infiniteScroll: true },
  fonts: { heading: 'manrope', body: 'dm-sans', accent: 'manrope' },
  type: { h1: 380, h2: 260, headingWeight: 800, h1LineHeight: 105, lineHeight: 160, baseSize: 17 },
  colors: {
    accent: '#e0526c', background: '#fffaf2', surface: '#fdeedb', card: '#ffffff', text: '#2a2a4a', sale: '#d23b52',
    swatchColors: 'Red:#e0526c,Rouge:#e0526c,Blue:#6fb4e8,Bleu:#6fb4e8,Yellow:#f6c945,Jaune:#f6c945,Green:#7cc9a0,Vert:#7cc9a0,Natural:#e2c9a0,Naturel:#e2c9a0,Pink:#f4a9bb,Rose:#f4a9bb,Grey:#b9b9c6,Gris:#b9b9c6',
    schemes: [
      { name: 'Cream', background: '#fffaf2', text: '#2a2a4a', surface: '#fdeedb', card: '#ffffff', border: '#f1e1c8', button: '#e0526c', button_label: '#ffffff' },
      { name: 'Sky', background: '#d9edfb', text: '#1f2f55', surface: '#c6e2f6', card: '#ecf6fd', border: '#b0d4ee', button: '#1f2f55', button_label: '#ffffff' },
      { name: 'Mint', background: '#d8f1e2', text: '#1f3b30', surface: '#c4e8d3', card: '#ebf8f0', border: '#aedcc1', button: '#1f3b30', button_label: '#ffffff' },
      { name: 'Butter', background: '#ffeaa6', text: '#3a2f12', surface: '#ffe083', card: '#fff3c9', border: '#f0cf62', button: '#3a2f12', button_label: '#fff3c9' },
      { name: 'Berry', background: '#e0526c', text: '#ffffff', surface: '#d3425d', card: '#d3425d', border: '#ee7f93', button: '#ffffff', button_label: '#b73049' },
    ],
  },
  scale: { radius: 'pill', spacing: 'regular', pageWidth: 1280 },
  buttons: { uppercase: false, height: 52, border: 0 },
  announcement: { text: t('Free delivery over 50 and gift wrapping on request', 'Livraison offerte dès 50 et emballage cadeau sur demande'), scheme: 'scheme-4' },
  footerScheme: 'scheme-2',
  sections: ['age-tiles', 'safety-promise'],
  features: { breadcrumbs: true, backToTop: true, stockCounter: true, stockThreshold: 6 },
  freeShipping: 50,
  home: [
    {
      id: 'hero', type: 'hero',
      settings: {
        layout: 'full', color_scheme: 'scheme-3',
        eyebrow: t('Toys and little things', 'Jouets et petites choses'),
        heading: t('Play, the way it should be', 'Jouer, comme il se doit'),
        text: t('Wooden toys, soft friends and good books, picked for curious hands and made to be passed on.', 'Des jouets en bois, des amis tout doux et de beaux livres, choisis pour les mains curieuses et faits pour être transmis.'),
        button_label: t('Shop all toys', 'Voir tous les jouets'), button_link: '/collections/all',
        button_2_label: t('Shop by age', 'Par âge'), button_2_link: '/collections',
      },
      blocks: [
        { type: 'chip', settings: { icon: 'shield', text: t('Safety tested', 'Sécurité testée') } },
        { type: 'chip', settings: { icon: 'leaf', text: t('Natural materials', 'Matières naturelles') } },
        { type: 'chip', settings: { icon: 'gift', text: t('Gift wrapping', 'Emballage cadeau') } },
      ],
    },
    {
      id: 'ages', type: 'age-tiles',
      settings: { eyebrow: t('Shop by age', 'Par âge'), heading: t('A toy for every size of explorer', 'Un jouet pour chaque petit explorateur'), color_scheme: '' },
      blocks: [
        { type: 'age', settings: { range: '0-1', unit: t('year', 'an'), text: t('Rattles and soft friends to hold.', 'Hochets et doudous à serrer.'), link: '/collections/babies', color_scheme: 'scheme-2' } },
        { type: 'age', settings: { range: '1-3', unit: t('years', 'ans'), text: t('Blocks and trains to stack and push.', 'Cubes et trains à empiler et pousser.'), link: '/collections/building-and-play', color_scheme: 'scheme-4' } },
        { type: 'age', settings: { range: '3-5', unit: t('years', 'ans'), text: t('Stories and scooters for big days.', 'Histoires et trottinettes pour les grands jours.'), link: '/collections/stories-and-outdoors', color_scheme: 'scheme-3' } },
        { type: 'age', settings: { range: '5+', unit: t('years', 'ans'), text: t('Little builders and big readers.', 'Petits bâtisseurs et grands lecteurs.'), link: '/collections/all', color_scheme: 'scheme-5' } },
      ],
    },
    { id: 'favourites', type: 'featured-collection', settings: { eyebrow: t('Playtime favourites', 'Les chouchous'), heading: t('Gift ideas they will actually use', 'Des idées cadeaux qui servent vraiment'), text: t('Six toys that get played with long after the party.', 'Six jouets qui servent bien après la fête.'), collection: 'all', products_to_show: 4, columns: '4', show_view_all: true, color_scheme: 'scheme-1' } },
    {
      id: 'promise', type: 'safety-promise',
      settings: { eyebrow: t('Our promise', 'Notre promesse'), heading: t('Safe to chew, safe to drop', 'Sans danger, même en bouche'), text: t('Little ones test everything with their mouths and their elbows. So do we, before a toy reaches you.', 'Les tout-petits testent tout avec la bouche et les coudes. Nous aussi, avant qu’un jouet n’arrive chez vous.'), color_scheme: 'scheme-2' },
      blocks: [
        { type: 'point', settings: { title: t('Tested twice', 'Testé deux fois'), text: t('Every toy is checked for small parts, strength and sharp edges.', 'Chaque jouet est contrôlé : petites pièces, solidité, arêtes.') } },
        { type: 'point', settings: { title: t('Child-safe finishes', 'Finitions sans danger'), text: t('Water-based paints and varnishes, free of harmful substances.', 'Peintures et vernis à l’eau, sans substances nocives.') } },
        { type: 'point', settings: { title: t('Built to be handed down', 'Fait pour être transmis'), text: t('Solid beech and tight stitching, made to last through several siblings.', 'Hêtre massif et coutures serrées, pour traverser plusieurs enfants.') } },
      ],
    },
    {
      id: 'gifts', type: 'image-with-text',
      settings: {
        layout: 'left', color_scheme: 'scheme-4',
        eyebrow: t('Gift ideas', 'Idées cadeaux'),
        heading: t('Wrapped, ribboned and ready', 'Emballé, noué et prêt'),
        text: t('<p>Choose a toy, tick the box and we wrap it in recycled paper with a hand-tied ribbon. Add a short card and we write it for you.</p>', '<p>Choisissez un jouet, cochez la case et nous l’emballons dans du papier recyclé avec un ruban noué à la main. Ajoutez un petit mot, nous l’écrivons pour vous.</p>'),
        button_label: t('Browse gifts', 'Voir les cadeaux'), button_link: '/collections/all', product: 'wooden-train',
      },
    },
    {
      id: 'reviews', type: 'testimonials',
      settings: { heading: t('Parents say', 'Les parents disent'), color_scheme: 'scheme-1' },
      blocks: [
        { type: 'testimonial', settings: { quote: t('The blocks have been rebuilt into a castle every single day for a month. Sturdy and the colours are lovely.', 'Les cubes sont devenus un château tous les jours pendant un mois. Solides, et les couleurs sont superbes.'), name: 'Camille R.', detail: t('Rainbow wooden blocks', 'Cubes en bois arc-en-ciel'), rating: 5 } },
        { type: 'testimonial', settings: { quote: t('The bunny is now part of the family. Soft, washable and it survived the washing machine.', 'Le lapin fait maintenant partie de la famille. Doux, lavable, et il a survécu à la machine.'), name: 'Thomas L.', detail: t('Bunny plush', 'Peluche lapin'), rating: 5 } },
        { type: 'testimonial', settings: { quote: t('Arrived gift wrapped and my niece did not want to let go of the train. Perfect present.', 'Arrivé emballé, et ma nièce ne voulait plus lâcher le train. Le cadeau parfait.'), name: 'Inès B.', detail: t('Wooden train', 'Train en bois'), rating: 5 } },
      ],
    },
    {
      id: 'faq', type: 'collapsible-content', settings: { heading: t('Good to know', 'Bon à savoir'), open_first: true, color_scheme: '' },
      blocks: [
        { type: 'row', settings: { question: t('How do I pick the right age?', 'Comment choisir le bon âge ?'), answer: t('<p>Each toy shows the age it suits. If you are unsure, send us a line with the age and interests and we will suggest something.</p>', '<p>Chaque jouet indique l’âge qui lui convient. En cas de doute, écrivez-nous l’âge et les goûts de l’enfant et nous vous conseillons.</p>') } },
        { type: 'row', settings: { question: t('How do I clean wooden toys?', 'Comment nettoyer les jouets en bois ?'), answer: t('<p>Wipe with a damp cloth and let them dry in the air. Do not soak them, the wood would swell.</p>', '<p>Passez un chiffon humide et laissez sécher à l’air. Ne les trempez pas : le bois gonflerait.</p>') } },
        { type: 'row', settings: { question: t('Can I exchange a toy?', 'Puis-je échanger un jouet ?'), answer: t('<p>Yes, within 30 days if it is unused and in its box. We send the new one as soon as the first is back.</p>', '<p>Oui, sous 30 jours s’il est inutilisé et dans sa boîte. Nous envoyons le nouveau dès le retour du premier.</p>') } },
      ],
    },
    { id: 'newsletter', type: 'newsletter', settings: { heading: t('Little letters', 'Petites lettres'), text: t('New toys, birthday ideas and 10% off your first order.', 'Nouveaux jouets, idées d’anniversaire et 10 % sur votre première commande.'), button_label: t('Subscribe', 'S’abonner'), color_scheme: 'scheme-5' } },
  ],
  templates: {
    'page.toy-safety': [
      { id: 'promise', type: 'safety-promise', settings: { eyebrow: t('Toy safety', 'Sécurité des jouets'), heading: t('How we choose what we sell', 'Comment nous choisissons ce que nous vendons'), text: '', product: 'bunny-plush', color_scheme: 'scheme-1' }, blocks: [
        { type: 'point', settings: { title: t('Small parts', 'Petites pièces'), text: t('Nothing that can come loose and be swallowed.', 'Rien qui puisse se détacher et être avalé.') } },
        { type: 'point', settings: { title: t('Materials', 'Matières'), text: t('Solid wood, organic cotton and water-based paint.', 'Bois massif, coton bio et peinture à l’eau.') } },
        { type: 'point', settings: { title: t('Ages', 'Âges'), text: t('The age on each toy is a safety limit, not a hint.', 'L’âge indiqué sur chaque jouet est une limite de sécurité, pas une suggestion.') } },
      ] },
    ],
  },
  css: `
.k-section__title { font-weight: 800; letter-spacing: -.02em; }
.k-hero__heading { letter-spacing: -.03em; }
.k-grid { gap: 40px 22px; }
.k-announce { font-weight: 600; }
.k-chips li { background: var(--v-card); font-weight: 600; }
.k-quote { border-radius: calc(var(--round) * 1.5); }
.k-footer { border-top-left-radius: 48px; border-top-right-radius: 48px; margin-top: 32px; }
`,
  info: {
    description: t(
      'A cheerful, rounded storefront for toys and children’s goods: pastel colour schemes, arched product tiles, shop by age, a safety promise section, gift ideas and a product page with a vertical thumbnail rail.',
      'Une boutique gaie et arrondie pour les jouets et les articles pour enfants : palettes pastel, tuiles produit en arche, achat par âge, section promesse sécurité, idées cadeaux et page produit à rail de miniatures vertical.',
    ),
    tags: ['Kids', 'Toys', 'Playful'],
    industries: ['kids-toys'],
    catalogSize: 'some',
  },
  changelog: [
    t('First release of Comptine, a cheerful and rounded theme for children and toys.', 'Première version de Comptine, un thème gai et arrondi pour les enfants et les jouets.'),
    t('Centred logo header with a search panel and a slide-in bag with a free shipping progress bar.', 'En-tête à logo centré avec panneau de recherche et panier latéral avec barre de progression vers la livraison offerte.'),
    t('Arched product tiles with a second photo, colour swatches and a quick add button.', 'Tuiles produit en arche avec seconde photo, pastilles de couleur et bouton d’ajout rapide.'),
    t('Product page with a vertical rail of thumbnails, options, subscriptions and a low stock message.', 'Page produit avec rail vertical de miniatures, options, abonnements et message de stock faible.'),
    t('Collection page with filter drop-downs, sorting and infinite scroll.', 'Page collection avec filtres déroulants, tri et défilement infini.'),
    t('New sections: shop by age, safety promise, and a countdown timer.', 'Nouvelles sections : acheter par âge, promesse sécurité, et compte à rebours.'),
    t('Five pastel colour schemes, breadcrumbs, back to top button and an optional age check.', 'Cinq palettes pastel, fil d’Ariane, bouton retour en haut et vérification d’âge facultative.'),
    t('Section names, settings and storefront texts are translated to English and French.', 'Les noms des sections, les réglages et les textes de la boutique sont traduits en anglais et en français.'),
  ],
  demo: {
    currency: 'EUR',
    homeImages: { hero: { image: 'hero.webp' }, promise: { image: 'ambiance.webp' } },
    menu: [
      { title: t('Shop all', 'Tout voir'), url: '/collections/all' },
      { title: t('Babies', 'Bébés'), url: '/collections/babies' },
      { title: t('Building and play', 'Construire et jouer'), url: '/collections/building-and-play' },
      { title: t('Stories and outdoors', 'Histoires et dehors'), url: '/collections/stories-and-outdoors' },
    ],
    footerMenu: [
      { title: t('Shop all', 'Tout voir'), url: '/collections/all' },
      { title: t('Toy safety', 'Sécurité des jouets'), url: '/pages/toy-safety' },
      { title: t('Search', 'Recherche'), url: '/search' },
    ],
    pages: [{ handle: 'toy-safety', title: t('Toy safety', 'Sécurité des jouets'), template: 'toy-safety' }],
    collections: [
      { handle: 'babies', title: t('Babies', 'Bébés'), description: t('Rattles and soft friends for the very first months.', 'Hochets et doudous pour les tout premiers mois.'), products: ['wooden-rattle', 'bunny-plush'] },
      { handle: 'building-and-play', title: t('Building and play', 'Construire et jouer'), description: t('Blocks and trains for stacking, pushing and imagining.', 'Cubes et trains pour empiler, pousser et imaginer.'), products: ['rainbow-wooden-blocks', 'wooden-train'] },
      { handle: 'stories-and-outdoors', title: t('Stories and outdoors', 'Histoires et dehors'), description: t('A picture book for the evening and a scooter for the morning.', 'Un livre d’images pour le soir et une trottinette pour le matin.'), products: ['picture-board-book', 'little-scooter'] },
    ],
    products: [
      {
        handle: 'rainbow-wooden-blocks', image: 'produit-01.webp', extraImages: ['ambiance.webp'], vendor: 'Comptine', type: t('Building', 'Construction'), tags: ['building', 'wood', 'new'],
        title: t('Rainbow Wooden Blocks', 'Cubes en bois arc-en-ciel'),
        description: t('Thirty solid beech blocks in cheerful colours, sanded smooth and painted with water-based paint. They come in a cotton bag for tidying up.', 'Trente cubes en hêtre massif aux couleurs gaies, poncés et peints à l’eau. Ils se rangent dans un sac en coton.'),
        options: [{ name: t('Set', 'Lot'), values: [t('30 blocks', '30 cubes'), t('60 blocks', '60 cubes')] }],
        price: 34, variants: [{ stock: 24 }, { stock: 9 }],
      },
      {
        handle: 'bunny-plush', image: 'produit-02.webp', vendor: 'Comptine', type: t('Soft toys', 'Peluches'), tags: ['plush', 'baby', 'gift'],
        title: t('Bunny Plush', 'Peluche lapin'),
        description: t('A soft bunny with long floppy ears, filled with recycled fibre. Machine washable at 30 degrees and safe from birth.', 'Un lapin tout doux aux longues oreilles souples, garni de fibres recyclées. Lavable en machine à 30 degrés, sûr dès la naissance.'),
        options: [{ name: t('Colour', 'Couleur'), values: [t('Pink', 'Rose'), t('Grey', 'Gris')] }],
        price: 26, compareAt: 32, variants: [{ stock: 18 }, { stock: 5 }],
      },
      {
        handle: 'wooden-train', image: 'produit-03.webp', vendor: 'Comptine', type: t('Vehicles', 'Véhicules'), tags: ['wood', 'train', 'gift'],
        title: t('Wooden Train', 'Train en bois'),
        description: t('A little wooden train with a locomotive and two carriages that link with magnets. Rounded corners, smooth wheels.', 'Un petit train en bois avec une locomotive et deux wagons aimantés. Coins arrondis, roues douces.'),
        options: [{ name: t('Colour', 'Couleur'), values: [t('Red', 'Rouge'), t('Blue', 'Bleu'), t('Natural', 'Naturel')] }],
        price: 42, variants: [{ stock: 14 }, { stock: 11 }, { stock: 7 }],
      },
      {
        handle: 'picture-board-book', image: 'produit-04.webp', vendor: 'Comptine', type: t('Books', 'Livres'), tags: ['book', 'stories'],
        title: t('Picture Board Book', 'Livre cartonné illustré'),
        description: t('A sturdy board book of gentle pictures for sharing at bedtime. Thick pages, rounded corners and no words to get wrong.', 'Un solide livre cartonné d’images douces à partager au coucher. Pages épaisses, coins arrondis et pas de mots à se tromper.'),
        options: [{ name: t('Format', 'Format'), values: [t('Small', 'Petit'), t('Large', 'Grand')] }],
        price: 15, variants: [{ stock: 30 }, { stock: 16 }],
      },
      {
        handle: 'wooden-rattle', image: 'produit-05.webp', vendor: 'Comptine', type: t('Baby', 'Bébé'), tags: ['baby', 'wood', 'gift'],
        title: t('Wooden Rattle', 'Hochet en bois'),
        description: t('A light rattle in untreated beech with a gentle sound, shaped for tiny hands and sore gums.', 'Un hochet léger en hêtre brut au son doux, dessiné pour les petites mains et les gencives sensibles.'),
        options: [{ name: t('Finish', 'Finition'), values: [t('Natural', 'Naturel'), t('Painted', 'Peint')] }],
        price: 14, compareAt: 18, variants: [{ stock: 28 }, { stock: 12 }],
      },
      {
        handle: 'little-scooter', image: 'produit-06.webp', vendor: 'Comptine', type: t('Outdoors', 'Plein air'), tags: ['outdoors', 'scooter'],
        title: t('Little Scooter', 'Petite trottinette'),
        description: t('A three-wheel scooter with a wide deck and a handlebar that adjusts as your child grows. Steers by leaning.', 'Une trottinette à trois roues, plateau large et guidon réglable qui grandit avec l’enfant. Elle se dirige en penchant.'),
        options: [{ name: t('Colour', 'Couleur'), values: [t('Blue', 'Bleu'), t('Green', 'Vert'), t('Pink', 'Rose')] }],
        price: 69, variants: [{ stock: 10 }, { stock: 8 }, { stock: 3 }],
      },
    ],
  },
};
