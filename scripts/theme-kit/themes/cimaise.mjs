// Cimaise: art, posters and gallery. Gallery white and black, lots of whitespace, editorial.
const t = (en, fr) => ({ en, fr });

export default {
  handle: 'cimaise',
  name: 'Cimaise',
  version: '1.0.0',
  date: '2026-11-06',
  header: { layout: 'centered', sticky: false },
  card: { style: 'minimal', ratio: 'portrait', align: 'left', quickAdd: false },
  product: {
    layout: 'left', ratio: 'portrait',
    benefits: [
      { icon: 'package', text: t('Shipped flat or in a rigid box, fully insured', 'Expédié à plat ou en caisse rigide, entièrement assuré') },
      { icon: 'ruler', text: t('Every size and frame shown to scale in our guide', 'Chaque format et cadre montré à l’échelle dans notre guide') },
      { icon: 'refresh', text: t('Changed your mind? Return it within 14 days', 'Vous avez changé d’avis ? Retournez-le sous 14 jours') },
    ],
  },
  collection: { layout: 'sidebar', columns: 3, perPage: 12, infiniteScroll: false },
  fonts: { heading: 'space-grotesk', body: 'inter', accent: 'playfair-display' },
  type: { h1: 440, h2: 280, headingWeight: 300, h1LineHeight: 98, lineHeight: 170, baseSize: 16 },
  colors: {
    accent: '#111111', background: '#ffffff', surface: '#f3f2ee', card: '#ffffff', text: '#111111', sale: '#b3261e', soldOut: '#6d6d6d',
    swatchColors: 'Black oak:#1c1a17,Chêne noir:#1c1a17,Natural oak:#cfb48a,Chêne naturel:#cfb48a,White:#f4f4f2,Blanc:#f4f4f2,Black:#111111,Noir:#111111',
    schemes: [
      { name: 'White', background: '#ffffff', text: '#111111', surface: '#f3f2ee', card: '#ffffff', border: '#e2e1dc', button: '#111111', button_label: '#ffffff' },
      { name: 'Paper', background: '#f3f2ee', text: '#111111', surface: '#e8e6df', card: '#fbfaf8', border: '#d9d7cf', button: '#111111', button_label: '#f3f2ee' },
      { name: 'Black', background: '#0e0e0e', text: '#f5f5f2', surface: '#1a1a1a', card: '#1a1a1a', border: '#333333', button: '#f5f5f2', button_label: '#0e0e0e' },
      { name: 'Stone', background: '#d9d6cf', text: '#111111', surface: '#cbc8c0', card: '#e6e4de', border: '#b5b2a9', button: '#111111', button_label: '#e6e4de' },
    ],
  },
  scale: { radius: 'sharp', spacing: 'airy', pageWidth: 1440 },
  buttons: { uppercase: true, height: 54, border: 1 },
  announcement: { text: t('Free insured delivery on every artwork', 'Livraison assurée offerte sur chaque œuvre'), scheme: 'scheme-3' },
  footerScheme: 'scheme-1',
  sections: ['artist-feature', 'frame-guide'],
  features: { breadcrumbs: true, backToTop: true, stockCounter: true, stockThreshold: 5 },
  freeShipping: 0,
  home: [
    {
      id: 'hero', type: 'hero',
      settings: {
        layout: 'reverse', color_scheme: 'scheme-1',
        eyebrow: t('Art, prints and objects', 'Art, tirages et objets'),
        heading: t('Bring a wall to life', 'Donnez vie à un mur'),
        text: t('Paintings, prints and sculpture chosen like an exhibition: few pieces, each given room to breathe.', 'Peintures, tirages et sculptures choisis comme une exposition : peu de pièces, chacune avec l’espace pour respirer.'),
        button_label: t('View the collection', 'Voir la collection'), button_link: '/collections/all',
        button_2_label: t('Sizes and frames', 'Formats et cadres'), button_2_link: '/pages/sizes-and-frames',
      },
    },
    { id: 'collection', type: 'featured-collection', settings: { eyebrow: t('Now showing', 'À l’affiche'), heading: t('The collection', 'La collection'), text: '', collection: 'all', products_to_show: 6, columns: '3', show_view_all: true, color_scheme: 'scheme-1' } },
    {
      id: 'artist', type: 'artist-feature',
      settings: {
        eyebrow: t('Featured artist', 'Artiste à l’honneur'), name: 'Lise Marchand', meta: t('Painter, born 1984, lives in Lyon', 'Peintre, née en 1984, vit à Lyon'),
        quote: t('I paint what is left when the colour has stopped explaining itself.', 'Je peins ce qui reste quand la couleur a cessé de s’expliquer.'),
        bio: t('<p>Lise works in oil and earth pigments on large linen canvases. Her abstract fields of ochre, rust and clay are built in thin layers over several months.</p>', '<p>Lise travaille l’huile et les pigments de terre sur de grandes toiles de lin. Ses champs abstraits d’ocre, de rouille et d’argile se construisent en couches minces sur plusieurs mois.</p>'),
        product: 'earth-tones-painting', button_label: t('View the work', 'Voir l’œuvre'), color_scheme: 'scheme-2',
      },
    },
    {
      id: 'frames', type: 'frame-guide',
      settings: { eyebrow: t('Sizes and frames', 'Formats et cadres'), heading: t('Find the right size for your wall', 'Trouvez le bon format pour votre mur'), text: t('A good rule: the work should fill about two thirds of the free wall above a sofa or a console.', 'Une bonne règle : l’œuvre doit occuper environ les deux tiers du mur libre au-dessus d’un canapé ou d’une console.'), finishes: t('Frames in black oak, natural oak or white', 'Cadres en chêne noir, chêne naturel ou blanc'), color_scheme: 'scheme-1' },
      blocks: [
        { type: 'format', settings: { label: t('Small', 'Petit'), width: 30, height: 40, text: t('Shelves, desks and small walls', 'Étagères, bureaux et petits murs') } },
        { type: 'format', settings: { label: t('Medium', 'Moyen'), width: 50, height: 70, text: t('Above a console or a bed', 'Au-dessus d’une console ou d’un lit') } },
        { type: 'format', settings: { label: t('Large', 'Grand'), width: 70, height: 100, text: t('Above a sofa, as a statement', 'Au-dessus d’un canapé, comme une affirmation') } },
        { type: 'format', settings: { label: t('Gallery', 'Galerie'), width: 100, height: 140, text: t('Tall walls and open spaces', 'Murs hauts et espaces ouverts') } },
      ],
    },
    {
      id: 'room', type: 'image-with-text',
      settings: {
        layout: 'right', color_scheme: 'scheme-3',
        eyebrow: t('In the room', 'Dans la pièce'),
        heading: t('Hang it, lean it, live with it', 'Accrochez-la, posez-la, vivez avec'),
        text: t('<p>A framed print can be hung or simply leaned on a shelf. Every frame is made to order from solid oak, with museum-grade glass and a hanging kit included.</p>', '<p>Un tirage encadré s’accroche ou se pose simplement sur une étagère. Chaque cadre est fabriqué sur commande en chêne massif, avec verre de qualité muséale et kit d’accrochage inclus.</p>'),
        button_label: t('See framed prints', 'Voir les tirages encadrés'), button_link: '/collections/prints-and-photography', product: 'botanical-print',
      },
    },
    {
      id: 'reviews', type: 'testimonials',
      settings: { heading: t('From our collectors', 'De nos collectionneurs'), color_scheme: 'scheme-1' },
      blocks: [
        { type: 'testimonial', settings: { quote: t('Better in the flesh than on screen. The colours are deeper and the frame is beautifully made.', 'Encore mieux en vrai qu’à l’écran. Les couleurs sont plus profondes et le cadre est superbement fait.'), name: 'Sophie L.', detail: t('Earth tones painting', 'Tableau aux tons terre'), rating: 5 } },
        { type: 'testimonial', settings: { quote: t('Wrapped like a museum piece and it arrived without a mark. It anchors the whole living room.', 'Emballé comme une pièce de musée et arrivé sans une marque. Il structure tout le salon.'), name: 'Marc D.', detail: t('Landscape photograph', 'Photographie de paysage'), rating: 5 } },
        { type: 'testimonial', settings: { quote: t('The size guide saved me from ordering too small. The etching looks perfect above the desk.', 'Le guide des formats m’a évité de commander trop petit. La gravure est parfaite au-dessus du bureau.'), name: 'Clara N.', detail: t('Black and white etching', 'Gravure noir et blanc'), rating: 5 } },
      ],
    },
    {
      id: 'faq', type: 'collapsible-content', settings: { heading: t('Before you order', 'Avant de commander'), open_first: true, color_scheme: '' },
      blocks: [
        { type: 'row', settings: { question: t('Are the works original?', 'Les œuvres sont-elles originales ?'), answer: t('<p>Paintings and sculptures are unique originals. Prints and photographs are limited editions, numbered and signed on the back.</p>', '<p>Les peintures et sculptures sont des originaux uniques. Les tirages et photographies sont des éditions limitées, numérotées et signées au dos.</p>') } },
        { type: 'row', settings: { question: t('How are works shipped?', 'Comment les œuvres sont-elles expédiées ?'), answer: t('<p>Framed pieces travel in a rigid crate with corner protection. Everything is insured against loss and damage.</p>', '<p>Les pièces encadrées voyagent en caisse rigide avec protection des angles. Tout est assuré contre la perte et la casse.</p>') } },
        { type: 'row', settings: { question: t('Can I return a work?', 'Puis-je retourner une œuvre ?'), answer: t('<p>Yes, within 14 days in its original packaging. We refund the full price once it is back with us.</p>', '<p>Oui, sous 14 jours dans son emballage d’origine. Nous remboursons le prix complet dès son retour.</p>') } },
      ],
    },
    { id: 'newsletter', type: 'newsletter', settings: { heading: t('Private view', 'Vernissage privé'), text: t('New works and exhibition news, before anyone else.', 'Nouvelles œuvres et actualités des expositions, avant tout le monde.'), button_label: t('Subscribe', 'S’abonner'), color_scheme: 'scheme-2' } },
  ],
  templates: {
    'page.sizes-and-frames': [
      { id: 'frames', type: 'frame-guide', settings: { eyebrow: t('Sizes and frames', 'Formats et cadres'), heading: t('A guide to scale', 'Un guide des échelles'), text: t('Each rectangle is drawn to scale. Choose the one closest to the wall you have in mind.', 'Chaque rectangle est dessiné à l’échelle. Choisissez celui qui se rapproche du mur que vous avez en tête.'), finishes: t('Frames in black oak, natural oak or white', 'Cadres en chêne noir, chêne naturel ou blanc'), color_scheme: 'scheme-1' }, blocks: [
        { type: 'format', settings: { label: 'A4', width: 21, height: 30, text: t('Desks and shelves', 'Bureaux et étagères') } },
        { type: 'format', settings: { label: 'A3', width: 30, height: 40, text: t('Small walls', 'Petits murs') } },
        { type: 'format', settings: { label: 'A2', width: 50, height: 70, text: t('Above a console', 'Au-dessus d’une console') } },
        { type: 'format', settings: { label: 'A1', width: 70, height: 100, text: t('Above a sofa', 'Au-dessus d’un canapé') } },
      ] },
    ],
  },
  css: `
.k-section__title { font-weight: 300; letter-spacing: -.02em; }
.k-hero__heading { font-weight: 300; letter-spacing: -.04em; }
.k-eyebrow { letter-spacing: .24em; }
.k-card__title { font-weight: 400; }
.k-grid { gap: 72px 32px; }
.k-announce { letter-spacing: .12em; text-transform: uppercase; font-size: .72rem; }
.k-footer { border-top: 1px solid var(--v-ink); }
`,
  info: {
    description: t(
      'An editorial storefront for art, posters and galleries: gallery white and black, a centred header, bare portrait tiles, wide whitespace, a featured artist section and a frame and size guide drawn to scale.',
      'Une boutique éditoriale pour l’art, les affiches et les galeries : blanc galerie et noir, en-tête centré, tuiles portrait épurées, larges espaces blancs, section artiste à l’honneur et guide des cadres et formats dessiné à l’échelle.',
    ),
    tags: ['Art', 'Gallery', 'Editorial'],
    industries: ['art'],
    catalogSize: 'few',
  },
  changelog: [
    t('First release of Cimaise, an editorial theme for art, posters and galleries.', 'Première version de Cimaise, un thème éditorial pour l’art, les affiches et les galeries.'),
    t('Centred logo header with a search panel and a slide-in bag.', 'En-tête à logo centré avec panneau de recherche et panier latéral.'),
    t('Bare portrait product tiles with a second photo and wide gutters.', 'Tuiles produit portrait épurées avec seconde photo et larges gouttières.'),
    t('Product page with the gallery and thumbnails on the left, options, subscriptions and a low stock message.', 'Page produit avec la galerie et ses miniatures à gauche, options, abonnements et message de stock faible.'),
    t('Collection page with filters in a side column, sorting and pagination.', 'Page collection avec filtres en colonne latérale, tri et pagination.'),
    t('New sections: featured artist, frame and size guide drawn to scale, and a countdown timer.', 'Nouvelles sections : artiste à l’honneur, guide des cadres et formats dessiné à l’échelle, et compte à rebours.'),
    t('Breadcrumbs, back to top button and an optional age check.', 'Fil d’Ariane, bouton retour en haut et vérification d’âge facultative.'),
    t('Section names, settings and storefront texts are translated to English and French.', 'Les noms des sections, les réglages et les textes de la boutique sont traduits en anglais et en français.'),
  ],
  demo: {
    currency: 'EUR',
    homeImages: { hero: { image: 'hero.webp' }, room: { image: 'ambiance.webp' } },
    menu: [
      { title: t('Shop all', 'Tout voir'), url: '/collections/all' },
      { title: t('Paintings', 'Peintures'), url: '/collections/paintings' },
      { title: t('Prints and photography', 'Tirages et photographie'), url: '/collections/prints-and-photography' },
      { title: t('Objects', 'Objets'), url: '/collections/objects' },
    ],
    footerMenu: [
      { title: t('Shop all', 'Tout voir'), url: '/collections/all' },
      { title: t('Sizes and frames', 'Formats et cadres'), url: '/pages/sizes-and-frames' },
      { title: t('Search', 'Recherche'), url: '/search' },
    ],
    pages: [{ handle: 'sizes-and-frames', title: t('Sizes and frames', 'Formats et cadres'), template: 'sizes-and-frames' }],
    collections: [
      { handle: 'paintings', title: t('Paintings', 'Peintures'), description: t('Original paintings, one of a kind.', 'Peintures originales, pièces uniques.'), products: ['earth-tones-painting', 'small-blue-painting'] },
      { handle: 'prints-and-photography', title: t('Prints and photography', 'Tirages et photographie'), description: t('Framed limited editions, numbered and signed.', 'Éditions limitées encadrées, numérotées et signées.'), products: ['botanical-print', 'landscape-photograph', 'black-white-etching'] },
      { handle: 'objects', title: t('Objects', 'Objets'), description: t('Sculpture to live with.', 'De la sculpture pour vivre avec.'), products: ['ceramic-sculpture'] },
    ],
    products: [
      {
        handle: 'earth-tones-painting', image: 'produit-01.webp', extraImages: ['ambiance.webp'], vendor: 'Cimaise', type: t('Paintings', 'Peintures'), tags: ['painting', 'abstract', 'new'],
        title: t('Earth Tones Painting', 'Tableau aux tons terre'),
        description: t('An abstract oil painting in ochre, rust and clay, built in thin layers on linen. Signed on the back and delivered with a certificate.', 'Une peinture à l’huile abstraite en ocre, rouille et argile, construite en couches minces sur lin. Signée au dos et livrée avec un certificat.'),
        options: [{ name: t('Size', 'Format'), values: ['60 x 80 cm', '90 x 120 cm'] }, { name: t('Frame', 'Cadre'), values: [t('Black oak', 'Chêne noir'), t('Natural oak', 'Chêne naturel')] }],
        price: 640, variants: [{ stock: 3 }, { stock: 2 }, { stock: 2 }, { stock: 1 }],
      },
      {
        handle: 'botanical-print', image: 'produit-02.webp', vendor: 'Cimaise', type: t('Prints', 'Tirages'), tags: ['print', 'botanical'],
        title: t('Framed Botanical Print', 'Affiche botanique encadrée'),
        description: t('A pressed-fern study printed on heavy cotton paper in a limited edition of 150, framed in solid oak behind museum glass.', 'Une étude de fougères séchées imprimée sur papier coton épais en édition limitée de 150, encadrée en chêne massif sous verre muséal.'),
        options: [{ name: t('Size', 'Format'), values: ['A3', 'A2'] }, { name: t('Frame', 'Cadre'), values: [t('Black oak', 'Chêne noir'), t('Natural oak', 'Chêne naturel')] }],
        price: 95, compareAt: 120, variants: [{ stock: 12 }, { stock: 9 }, { stock: 7 }, { stock: 4 }],
      },
      {
        handle: 'ceramic-sculpture', image: 'produit-03.webp', vendor: 'Cimaise', type: t('Sculpture', 'Sculpture'), tags: ['sculpture', 'ceramic'],
        title: t('Ceramic Sculpture', 'Sculpture en céramique'),
        description: t('A hand-built stoneware form with a matte glaze, made to be turned and looked at from every side. Each piece is unique.', 'Une forme en grès montée à la main, émail mat, faite pour être tournée et regardée sous tous les angles. Chaque pièce est unique.'),
        options: [{ name: t('Size', 'Taille'), values: [t('Small', 'Petite'), t('Large', 'Grande')] }],
        price: 220, variants: [{ stock: 4 }, { stock: 2 }],
      },
      {
        handle: 'landscape-photograph', image: 'produit-04.webp', vendor: 'Cimaise', type: t('Photography', 'Photographie'), tags: ['photography', 'landscape'],
        title: t('Framed Landscape Photograph', 'Photographie de paysage encadrée'),
        description: t('A quiet landscape at first light, printed on fine art paper in an edition of 50 and framed in oak with an off-white mount.', 'Un paysage calme à la première lumière, imprimé sur papier beaux-arts en édition de 50 et encadré en chêne avec passe-partout blanc cassé.'),
        options: [{ name: t('Size', 'Format'), values: ['50 x 70 cm', '70 x 100 cm'] }, { name: t('Frame', 'Cadre'), values: [t('Black oak', 'Chêne noir'), t('White', 'Blanc')] }],
        price: 180, variants: [{ stock: 8 }, { stock: 6 }, { stock: 5 }, { stock: 3 }],
      },
      {
        handle: 'small-blue-painting', image: 'produit-05.webp', vendor: 'Cimaise', type: t('Paintings', 'Peintures'), tags: ['painting', 'minimal'],
        title: t('Small Blue Painting', 'Petit tableau bleu'),
        description: t('A minimalist study in deep blue on a small wooden panel. It looks best alone on a wide wall, or hung low above a shelf.', 'Une étude minimaliste en bleu profond sur un petit panneau de bois. Elle se montre au mieux seule sur un grand mur, ou accrochée bas au-dessus d’une étagère.'),
        options: [{ name: t('Frame', 'Cadre'), values: [t('Unframed', 'Sans cadre'), t('Black oak', 'Chêne noir')] }],
        price: 240, compareAt: 280, variants: [{ stock: 5 }, { stock: 3 }],
      },
      {
        handle: 'black-white-etching', image: 'produit-06.webp', vendor: 'Cimaise', type: t('Prints', 'Tirages'), tags: ['print', 'etching'],
        title: t('Black and White Etching', 'Gravure noir et blanc'),
        description: t('A hand-pulled etching in deep black ink on cream paper, from an edition of 40. Numbered and signed in pencil.', 'Une gravure tirée à la main à l’encre noire profonde sur papier crème, d’une édition de 40. Numérotée et signée au crayon.'),
        options: [{ name: t('Size', 'Format'), values: ['A3', 'A2'] }, { name: t('Frame', 'Cadre'), values: [t('Black oak', 'Chêne noir'), t('White', 'Blanc')] }],
        price: 150, variants: [{ stock: 6 }, { stock: 4 }, { stock: 4 }, { stock: 2 }],
      },
    ],
  },
};
