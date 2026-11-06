// Foyer: home and decor. Warm cream and linen, rounded.
const t = (en, fr) => ({ en, fr });

export default {
  handle: 'foyer',
  name: 'Foyer',
  version: '1.0.0',
  date: '2026-11-06',
  header: { layout: 'centered', sticky: true },
  card: { style: 'rounded', ratio: 'square', align: 'left', quickAdd: true },
  product: {
    layout: 'left',
    benefits: [
      { icon: 'package', text: t('Packed with care, delivered in 3 to 5 days', 'Emballé avec soin, livré en 3 à 5 jours') },
      { icon: 'leaf', text: t('Natural materials, made to last', 'Matières naturelles, faites pour durer') },
      { icon: 'home', text: t('Not right at home? Return it within 30 days', 'Pas à sa place chez vous ? Retournez-le sous 30 jours') },
    ],
  },
  collection: { layout: 'topbar', columns: 3, perPage: 12, infiniteScroll: false },
  fonts: { heading: 'lora', body: 'dm-sans', accent: 'lora' },
  type: { h1: 350, h2: 240, headingWeight: 500, h1LineHeight: 110, lineHeight: 165, baseSize: 16 },
  colors: {
    accent: '#a8603a', background: '#f8f2e7', surface: '#efe5d2', card: '#fffaf0', text: '#3a3127', sale: '#a8432b',
    swatchColors: 'Cream:#efe6d2,Crème:#efe6d2,Oat:#d6c7a6,Avoine:#d6c7a6,Natural:#d9c9a8,Naturel:#d9c9a8,Ink:#2e3440,Encre:#2e3440,Sand:#d6c4a0,Sable:#d6c4a0,Clay:#b4704b,Argile:#b4704b,Ivory:#f3ecdc,Ivoire:#f3ecdc,Natural linen:#d8c9ad,Lin naturel:#d8c9ad',
    schemes: [
      { name: 'Cream', background: '#f8f2e7', text: '#3a3127', surface: '#efe5d2', card: '#fffaf0', border: '#e2d6bd', button: '#a8603a', button_label: '#fffaf0' },
      { name: 'Linen', background: '#ebe0ca', text: '#3a3127', surface: '#e1d4b9', card: '#f6efe0', border: '#d3c4a5', button: '#3a3127', button_label: '#f8f2e7' },
      { name: 'Clay', background: '#6a4430', text: '#f8f2e7', surface: '#7a5139', card: '#7a5139', border: '#92684d', button: '#f8f2e7', button_label: '#6a4430' },
      { name: 'Sage', background: '#dfe2cc', text: '#2f3523', surface: '#d1d5ba', card: '#eceed9', border: '#bfc4a4', button: '#2f3523', button_label: '#eceed9' },
    ],
  },
  scale: { radius: 'pill', spacing: 'regular', pageWidth: 1240 },
  buttons: { uppercase: false, height: 50, border: 1 },
  announcement: { text: t('Free delivery on orders over 60', 'Livraison offerte dès 60 d’achat'), scheme: 'scheme-2' },
  footerScheme: 'scheme-2',
  sections: ['room-tiles', 'materials'],
  features: { breadcrumbs: true, backToTop: true, stockCounter: true, stockThreshold: 8 },
  freeShipping: 60,
  home: [
    {
      id: 'hero', type: 'hero',
      settings: {
        layout: 'reverse', color_scheme: 'scheme-1',
        eyebrow: t('Home and decor', 'Maison et décoration'),
        heading: t('Soft things for slow rooms', 'Des douceurs pour les pièces calmes'),
        text: t('Linen, wool, stoneware and wicker, chosen to make a home feel lived in. Warm colours, honest materials, nothing shouting.', 'Lin, laine, grès et osier, choisis pour qu’une maison se sente habitée. Des couleurs chaudes, des matières franches, rien de criard.'),
        button_label: t('Shop the collection', 'Voir la collection'), button_link: '/collections/all',
        button_2_label: t('Shop by room', 'Acheter par pièce'), button_2_link: '/collections',
        product: 'boucle-cushion',
      },
      blocks: [
        { type: 'chip', settings: { icon: 'leaf', text: t('Natural materials', 'Matières naturelles') } },
        { type: 'chip', settings: { icon: 'package', text: t('Careful packing', 'Emballage soigné') } },
        { type: 'chip', settings: { icon: 'home', text: t('Made to last', 'Faits pour durer') } },
      ],
    },
    {
      id: 'rooms', type: 'room-tiles',
      settings: { eyebrow: t('Room by room', 'Pièce par pièce'), heading: t('Find your corner', 'Trouvez votre coin'), color_scheme: '' },
      blocks: [
        { type: 'room', settings: { title: t('Living room', 'Salon'), link: '/collections/textiles', product: 'braided-wool-throw' } },
        { type: 'room', settings: { title: t('Bedroom', 'Chambre'), link: '/collections/lighting-and-storage', product: 'linen-table-lamp' } },
        { type: 'room', settings: { title: t('Table and shelf', 'Table et étagère'), link: '/collections/ceramics-and-candles', product: 'matte-ceramic-vase' } },
        { type: 'room', settings: { title: t('Small gifts', 'Petits cadeaux'), link: '/collections/ceramics-and-candles', product: 'stoneware-candle' } },
      ],
    },
    { id: 'favourites', type: 'featured-collection', settings: { eyebrow: t('Our favourites', 'Nos préférés'), heading: t('Things to live with', 'Des choses avec qui vivre'), text: t('Six pieces our customers keep coming back for.', 'Six pièces que nos clients reviennent chercher.'), collection: 'all', products_to_show: 6, columns: '3', show_view_all: true, color_scheme: 'scheme-1' } },
    {
      id: 'materials', type: 'materials',
      settings: { eyebrow: t('Good to know', 'Bon à savoir'), heading: t('Materials we trust', 'Des matières de confiance'), text: t('Everything we sell is made from materials that look better with age.', 'Tout ce que nous vendons est fait de matières qui embellissent avec le temps.'), color_scheme: 'scheme-4' },
      blocks: [
        { type: 'material', settings: { icon: 'leaf', title: t('Washed linen', 'Lin lavé'), text: t('Softened by stone washing, it gets better with every wash.', 'Adouci par lavage à la pierre, il s’améliore à chaque lavage.') } },
        { type: 'material', settings: { icon: 'sun', title: t('Warm light', 'Lumière chaude'), text: t('Linen shades that turn a lamp into a glow.', 'Des abat-jour en lin qui transforment une lampe en halo.') } },
        { type: 'material', settings: { icon: 'drop', title: t('Matte stoneware', 'Grès mat'), text: t('Hand-glazed, food safe and different every time.', 'Émaillé à la main, alimentaire et différent à chaque fois.') } },
        { type: 'material', settings: { icon: 'refresh', title: t('Natural wicker', 'Osier naturel'), text: t('Woven by hand from sustainably grown willow.', 'Tressé à la main avec du saule cultivé durablement.') } },
      ],
    },
    {
      id: 'story', type: 'image-with-text',
      settings: {
        layout: 'right', color_scheme: 'scheme-1',
        eyebrow: t('Our story', 'Notre histoire'),
        heading: t('A home is built slowly', 'Une maison se construit lentement'),
        text: t('<p>Foyer started with a single cushion and a stubborn idea: that the things in your home should be pleasant to touch. We work with small studios and weavers, and we only sell what we would keep ourselves.</p>', '<p>Foyer est né d’un seul coussin et d’une idée têtue : les objets d’une maison doivent être agréables au toucher. Nous travaillons avec de petits ateliers et des tisserands, et ne vendons que ce que nous garderions nous-mêmes.</p>'),
        button_label: t('Read our story', 'Lire notre histoire'), button_link: '/pages/about-us',
      },
    },
    {
      id: 'reviews', type: 'testimonials',
      settings: { heading: t('Said about the shop', 'Dit de la boutique'), color_scheme: 'scheme-2' },
      blocks: [
        { type: 'testimonial', settings: { quote: t('The throw is even softer than it looks. It lives on our sofa now and nobody is allowed to move it.', 'Le plaid est encore plus doux qu’il n’en a l’air. Il vit sur notre canapé et personne n’a le droit de le déplacer.'), name: 'Marion D.', detail: t('Braided wool throw', 'Plaid en laine tressée'), rating: 5 } },
        { type: 'testimonial', settings: { quote: t('Beautifully packed and the vase is a gorgeous matte clay. It looks wonderful with dried flowers.', 'Superbement emballé, et le vase est d’une magnifique terre mate. Il est superbe avec des fleurs séchées.'), name: 'Julien P.', detail: t('Matte ceramic vase', 'Vase en céramique mate'), rating: 5 } },
        { type: 'testimonial', settings: { quote: t('The lamp gives the softest light for the bedroom. Exactly the warmth I wanted.', 'La lampe donne la lumière la plus douce pour la chambre. Exactement la chaleur que je voulais.'), name: 'Salomé T.', detail: t('Linen table lamp', 'Lampe à poser en lin'), rating: 5 } },
      ],
    },
    {
      id: 'faq', type: 'collapsible-content', settings: { heading: t('Before you order', 'Avant de commander'), open_first: true, color_scheme: '' },
      blocks: [
        { type: 'row', settings: { question: t('How are fragile items packed?', 'Comment sont emballés les objets fragiles ?'), answer: t('<p>Ceramics and candles travel in recycled paper and a double-walled box. If anything arrives damaged, send us a photo and we replace it.</p>', '<p>Les céramiques et bougies voyagent dans du papier recyclé et un carton à double paroi. Si quelque chose arrive abîmé, envoyez-nous une photo et nous le remplaçons.</p>') } },
        { type: 'row', settings: { question: t('How do I care for linen and wool?', 'Comment entretenir le lin et la laine ?'), answer: t('<p>Wash linen at 30 degrees and air dry. Wool throws prefer a gentle cycle or a dry clean once a year.</p>', '<p>Lavez le lin à 30 degrés et laissez sécher à l’air. Les plaids en laine préfèrent un cycle délicat ou un nettoyage à sec une fois par an.</p>') } },
        { type: 'row', settings: { question: t('Can I return something that does not suit my home?', 'Puis-je retourner un objet qui ne convient pas chez moi ?'), answer: t('<p>Yes, within 30 days in its original packaging. We refund the full price once it is back with us.</p>', '<p>Oui, sous 30 jours dans son emballage d’origine. Nous remboursons le prix complet dès son retour.</p>') } },
      ],
    },
    { id: 'newsletter', type: 'newsletter', settings: { heading: t('Letters from the Foyer', 'Lettres du Foyer'), text: t('New arrivals, small studios and 10% off your first order.', 'Nouveautés, petits ateliers et 10 % sur votre première commande.'), button_label: t('Subscribe', 'S’abonner'), color_scheme: 'scheme-3' } },
  ],
  templates: {
    'page.care-guide': [
      { id: 'care', type: 'materials', settings: { eyebrow: t('Care guide', 'Guide d’entretien'), heading: t('Keeping your things beautiful', 'Garder vos objets beaux'), text: '', color_scheme: 'scheme-1' }, blocks: [{ type: 'material', settings: { icon: 'drop', title: t('Wash gently', 'Laver doucement'), text: t('Cool water and a mild soap are enough for most pieces.', 'De l’eau fraîche et un savon doux suffisent pour la plupart des pièces.') } }, { type: 'material', settings: { icon: 'sun', title: t('Dry in the air', 'Sécher à l’air'), text: t('Keep natural fibres away from direct heat.', 'Éloignez les fibres naturelles de toute chaleur directe.') } }, { type: 'material', settings: { icon: 'refresh', title: t('Use it, again', 'Réutiliser'), text: t('Most of our pieces soften and improve with use.', 'La plupart de nos pièces s’adoucissent et s’améliorent à l’usage.') } }] },
    ],
  },
  css: `
.k-section__title { font-weight: 500; letter-spacing: -.01em; }
.k-hero::before { width: 640px; height: 640px; right: auto; left: -200px; top: -200px; }
.k-hero .k-arch { border-radius: calc(var(--round) * 3) calc(var(--round) * 3) calc(var(--round) * 3) calc(var(--round) * 3); aspect-ratio: 5 / 6; }
.k-hero__heading { max-width: 13ch; letter-spacing: -.02em; }
.k-hero__product { border-radius: var(--round); }
.k-chips li { background: var(--v-card); }
.k-grid { gap: 44px 26px; }
.k-announce { font-size: .86rem; }
.k-tile, .k-room__link { border-radius: var(--round); }
.k-story__media { border-radius: calc(var(--round) * 2); aspect-ratio: 1 / 1; }
.k-quote { box-shadow: none; border: 1px solid var(--v-line); }
.k-newsletter-band__inner { background: var(--v-surface); }
.k-footer { border-top-left-radius: calc(var(--round) * 1.5); border-top-right-radius: calc(var(--round) * 1.5); margin-top: 32px; }
.k-listing__title { font-weight: 500; }
`,
  info: {
    description: t(
      'A warm, rounded storefront for home and decor: cream and linen colour schemes, a centred header, soft product tiles, shop-by-room tiles, a materials and care section and a thumbnail-led product page.',
      'Une boutique chaleureuse et arrondie pour la maison et la décoration : palettes crème et lin, en-tête centré, tuiles produit douces, achat par pièce, section matières et entretien et page produit à miniatures.',
    ),
    tags: ['Home', 'Decor', 'Lifestyle'],
    industries: ['home-decor'],
    catalogSize: 'some',
  },
  changelog: [
    t('First release of Foyer, a warm and rounded theme for home and decor.', 'Première version de Foyer, un thème chaleureux et arrondi pour la maison et la décoration.'),
    t('Centred logo header with the menu on its own row, a search panel and a slide-in bag with a free shipping progress bar.', 'En-tête à logo centré avec le menu sur sa propre ligne, panneau de recherche et panier latéral avec barre de progression vers la livraison offerte.'),
    t('Rounded product tiles that lift on hover, with a second photo, colour swatches and a quick add button.', 'Tuiles produit arrondies qui se soulèvent au survol, avec seconde photo, pastilles de couleur et bouton d’ajout rapide.'),
    t('Product page with the gallery and thumbnails on the left, options, subscriptions and a low stock message.', 'Page produit avec la galerie et ses miniatures à gauche, options, abonnements et message de stock faible.'),
    t('Collection page with filter drop-downs, sorting and pagination.', 'Page collection avec filtres déroulants, tri et pagination.'),
    t('New sections: shop by room, materials and care, and a countdown timer.', 'Nouvelles sections : acheter par pièce, matières et entretien, et compte à rebours.'),
    t('Breadcrumbs, back to top button and an optional age check.', 'Fil d’Ariane, bouton retour en haut et vérification d’âge facultative.'),
    t('Section names, settings and storefront texts are translated to English and French.', 'Les noms des sections, les réglages et les textes de la boutique sont traduits en anglais et en français.'),
  ],
  demo: {
    currency: 'EUR',
    homeImages: { hero: { image: 'ambiance.webp' }, 'rooms.room-1': { image: 'hero.webp' }, 'rooms.room-2': { image: 'ambiance.webp' }, story: { image: 'hero.webp' } },
    menu: [
      { title: t('Shop all', 'Tout voir'), url: '/collections/all' },
      { title: t('Textiles', 'Textiles'), url: '/collections/textiles' },
      { title: t('Ceramics and candles', 'Céramiques et bougies'), url: '/collections/ceramics-and-candles' },
      { title: t('Lighting and storage', 'Luminaires et rangements'), url: '/collections/lighting-and-storage' },
    ],
    footerMenu: [
      { title: t('Shop all', 'Tout voir'), url: '/collections/all' },
      { title: t('Care guide', 'Guide d’entretien'), url: '/pages/care-guide' },
      { title: t('Search', 'Recherche'), url: '/search' },
    ],
    pages: [{ handle: 'care-guide', title: t('Care guide', 'Guide d’entretien'), template: 'care-guide' }],
    collections: [
      { handle: 'textiles', title: t('Textiles', 'Textiles'), description: t('Cushions and throws in natural fibres.', 'Coussins et plaids en fibres naturelles.'), products: ['boucle-cushion', 'braided-wool-throw'] },
      { handle: 'ceramics-and-candles', title: t('Ceramics and candles', 'Céramiques et bougies'), description: t('Matte stoneware to hold flowers and flames.', 'Du grès mat pour les fleurs et les flammes.'), products: ['matte-ceramic-vase', 'stoneware-candle'] },
      { handle: 'lighting-and-storage', title: t('Lighting and storage', 'Luminaires et rangements'), description: t('Warm light and woven baskets.', 'Lumière chaude et paniers tressés.'), products: ['linen-table-lamp', 'wicker-basket'] },
    ],
    products: [
      {
        handle: 'boucle-cushion', image: 'produit-01.webp', extraImages: ['ambiance.webp'], vendor: 'Foyer', type: t('Cushions', 'Coussins'), tags: ['textiles', 'cushion', 'new'],
        title: t('Boucle Cushion', 'Coussin en bouclette'),
        description: t('A plump cushion in cream boucle with a removable cover and a feather-and-down inner. Soft to the touch, it holds its shape.', 'Un coussin généreux en bouclette crème, housse amovible et garnissage plumes et duvet. Doux au toucher, il garde sa forme.'),
        options: [{ name: t('Size', 'Taille'), values: ['45 x 45 cm', '60 x 60 cm'] }, { name: t('Colour', 'Couleur'), values: [t('Cream', 'Crème'), t('Oat', 'Avoine')] }],
        price: 39, variants: [{ stock: 22 }, { stock: 14 }, { stock: 9 }, { stock: 4 }],
      },
      {
        handle: 'braided-wool-throw', image: 'produit-02.webp', extraImages: ['hero.webp'], vendor: 'Foyer', type: t('Throws', 'Plaids'), tags: ['textiles', 'wool'],
        title: t('Braided Wool Throw', 'Plaid en laine tressée'),
        description: t('A chunky throw braided from merino wool, heavy and warm. It drapes over a sofa or the foot of a bed.', 'Un plaid épais tressé en laine mérinos, lourd et chaud. Il se drape sur un canapé ou au pied d’un lit.'),
        options: [{ name: t('Colour', 'Couleur'), values: [t('Natural', 'Naturel'), t('Ink', 'Encre')] }],
        price: 89, compareAt: 109, variants: [{ stock: 11 }, { stock: 6 }],
      },
      {
        handle: 'matte-ceramic-vase', image: 'produit-03.webp', vendor: 'Foyer', type: t('Vases', 'Vases'), tags: ['ceramics', 'vase'],
        title: t('Matte Ceramic Vase', 'Vase en céramique mate'),
        description: t('A hand-thrown vase with a soft matte glaze and a narrow neck, made for a few stems or dried flowers.', 'Un vase tourné à la main, émail mat et col étroit, fait pour quelques tiges ou des fleurs séchées.'),
        options: [{ name: t('Size', 'Taille'), values: [t('Small', 'Petit'), t('Large', 'Grand')] }, { name: t('Colour', 'Couleur'), values: [t('Sand', 'Sable'), t('Clay', 'Argile')] }],
        price: 54, variants: [{ stock: 15 }, { stock: 8 }, { stock: 10 }, { stock: 3 }],
      },
      {
        handle: 'stoneware-candle', image: 'produit-04.webp', vendor: 'Foyer', type: t('Candles', 'Bougies'), tags: ['candles', 'gift'],
        title: t('Stoneware Candle', 'Bougie en pot de grès'),
        description: t('A soy wax candle poured by hand into a reusable stoneware jar. Around 45 hours of slow, even burning.', 'Une bougie en cire de soja coulée à la main dans un pot en grès réutilisable. Environ 45 heures de combustion lente et régulière.'),
        options: [{ name: t('Scent', 'Parfum'), values: [t('Fig', 'Figue'), t('Cedar', 'Cèdre'), t('Fresh linen', 'Linge frais')] }],
        price: 28, compareAt: 34, variants: [{ stock: 25 }, { stock: 18 }, { stock: 7 }],
      },
      {
        handle: 'linen-table-lamp', image: 'produit-05.webp', vendor: 'Foyer', type: t('Lighting', 'Luminaires'), tags: ['lighting', 'linen'],
        title: t('Linen Table Lamp', 'Lampe à poser en lin'),
        description: t('A ceramic base with a pleated linen shade that gives off a soft, warm glow. Comes with a fabric cord.', 'Un pied en céramique et un abat-jour en lin plissé qui diffuse une lumière douce et chaude. Livrée avec un cordon en tissu.'),
        options: [{ name: t('Shade', 'Abat-jour'), values: [t('Natural linen', 'Lin naturel'), t('Ivory', 'Ivoire')] }],
        price: 119, variants: [{ stock: 9 }, { stock: 5 }],
      },
      {
        handle: 'wicker-basket', image: 'produit-06.webp', vendor: 'Foyer', type: t('Storage', 'Rangements'), tags: ['storage', 'wicker'],
        title: t('Wicker Basket', 'Panier en osier'),
        description: t('A woven willow basket with two handles. Good for logs, blankets or a trailing plant.', 'Un panier en saule tressé à deux anses. Pour des bûches, des plaids ou une plante retombante.'),
        options: [{ name: t('Size', 'Taille'), values: [t('Small', 'Petit'), t('Medium', 'Moyen'), t('Large', 'Grand')] }],
        price: 46, variants: [{ stock: 20 }, { stock: 12 }, { stock: 5 }],
      },
    ],
  },
};
