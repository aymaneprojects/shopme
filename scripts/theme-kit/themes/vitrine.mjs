// Vitrine: a single-product store. One bottle in six colours, a landing page with the buy box on the home page.
const t = (en, fr) => ({ en, fr });
const COLOURS = [
  ['Sand', 'Sable', 'produit-01.webp', 24], ['Black', 'Noir', 'produit-02.webp', 31], ['Sage', 'Sauge', 'produit-03.webp', 17],
  ['Midnight blue', 'Bleu nuit', 'produit-04.webp', 22], ['Terracotta', 'Terracotta', 'produit-05.webp', 4], ['White', 'Blanc', 'produit-06.webp', 28],
];

export default {
  handle: 'vitrine',
  name: 'Vitrine',
  version: '1.0.0',
  date: '2026-11-06',
  header: { layout: 'split', sticky: true },
  card: { style: 'framed', ratio: 'square', align: 'center', quickAdd: false, showVendor: false },
  product: {
    layout: 'left', ratio: 'square',
    benefits: [
      { icon: 'clock', text: t('Cold for 24 hours, hot for 12', 'Froid 24 heures, chaud 12 heures') },
      { icon: 'shield', text: t('Lifetime guarantee on the steel', 'Garantie à vie sur l’acier') },
      { icon: 'truck', text: t('Free delivery and 30-day returns', 'Livraison offerte et retours sous 30 jours') },
    ],
  },
  collection: { layout: 'topbar', columns: 3, perPage: 12, infiniteScroll: false },
  fonts: { heading: 'dm-sans', body: 'inter', accent: 'dm-sans' },
  type: { h1: 440, h2: 300, headingWeight: 700, h1LineHeight: 100, lineHeight: 165, baseSize: 16 },
  colors: {
    accent: '#14284b', background: '#f6f1e7', surface: '#e9dfcb', card: '#fffdf8', text: '#14213a', sale: '#b3472b', soldOut: '#5b6270',
    swatchColors: 'Sand:#d8c7a6,Sable:#d8c7a6,Black:#1c1c1e,Noir:#1c1c1e,Sage:#9caf88,Sauge:#9caf88,Midnight blue:#14284b,Bleu nuit:#14284b,Terracotta:#c0643f,White:#f4f1ea,Blanc:#f4f1ea',
    schemes: [
      { name: 'Sand', background: '#f6f1e7', text: '#14213a', surface: '#e9dfcb', card: '#fffdf8', border: '#d9ccb2', button: '#14284b', button_label: '#f6f1e7' },
      { name: 'Midnight', background: '#14284b', text: '#f6f1e7', surface: '#1d3866', card: '#1d3866', border: '#38568a', button: '#d8c7a6', button_label: '#14284b' },
      { name: 'Dune', background: '#e4d6b8', text: '#14213a', surface: '#d8c7a2', card: '#f2e8d2', border: '#c8b68f', button: '#14284b', button_label: '#f6f1e7' },
      { name: 'Sage', background: '#dbe2d0', text: '#14213a', surface: '#cbd5bd', card: '#eef2e7', border: '#b6c3a5', button: '#14284b', button_label: '#f6f1e7' },
    ],
  },
  scale: { radius: 'pill', spacing: 'regular', pageWidth: 1280 },
  buttons: { uppercase: false, height: 54, border: 2 },
  announcement: { text: t('Free delivery. 30 days to try it, or send it back.', 'Livraison offerte. 30 jours pour l’essayer, sinon on vous rembourse.'), scheme: 'scheme-2' },
  footerScheme: 'scheme-2',
  sections: ['buy-box', 'benefit-grid', 'colour-showcase', 'craft-steps'],
  features: { breadcrumbs: true, backToTop: true, stockCounter: true, stockThreshold: 6 },
  freeShipping: 0,
  home: [
    {
      id: 'buy', type: 'buy-box',
      settings: { product: 'the-bottle', eyebrow: t('The one bottle', 'La gourde unique'), rating_text: t('4.9 out of 5, from 1,200 reviews', '4,9 sur 5, d’après 1 200 avis'), text: '', payment_note: t('Secure payment. Ships in 24 hours.', 'Paiement sécurisé. Expédié sous 24 heures.'), sticky_bar: true, color_scheme: 'scheme-1' },
      blocks: [
        { type: 'perk', settings: { icon: 'truck', text: t('Free delivery', 'Livraison offerte') } },
        { type: 'perk', settings: { icon: 'refresh', text: t('30-day returns', 'Retours sous 30 jours') } },
        { type: 'perk', settings: { icon: 'shield', text: t('Lifetime guarantee', 'Garantie à vie') } },
      ],
    },
    {
      id: 'benefits', type: 'benefit-grid',
      settings: { eyebrow: t('Why this one', 'Pourquoi celle-ci'), heading: t('Made to be the last bottle you buy', 'Faite pour être la dernière gourde que vous achetez'), text: t('One product, thought through down to the lid.', 'Un seul produit, pensé jusqu’au bouchon.'), color_scheme: 'scheme-3' },
      blocks: [
        { type: 'benefit', settings: { icon: 'clock', title: t('Cold for 24 hours', 'Froid pendant 24 heures'), text: t('Double-wall steel holds ice from morning to night, and tea hot for 12 hours.', 'L’acier double paroi garde la glace du matin au soir, et le thé chaud 12 heures.') } },
        { type: 'benefit', settings: { icon: 'drop', title: t('Tastes of nothing', 'Aucun goût'), text: t('Food-grade steel and a neutral lid: water tastes like water, even after a month.', 'Un acier alimentaire et un bouchon neutre : l’eau a goût d’eau, même après un mois.') } },
        { type: 'benefit', settings: { icon: 'check', title: t('Leak-proof, truly', 'Vraiment étanche'), text: t('Toss it in a bag upside down. The lid seals with a silicone ring you can replace.', 'Jetez-la à l’envers dans un sac. Le bouchon ferme avec un joint en silicone remplaçable.') } },
        { type: 'benefit', settings: { icon: 'leaf', title: t('Plastic-free', 'Sans plastique'), text: t('Steel body, silicone seal, bamboo-fibre cap. Packed in recycled card.', 'Corps en acier, joint en silicone, capuchon en fibre de bambou. Emballée dans du carton recyclé.') } },
        { type: 'benefit', settings: { icon: 'shield', title: t('Guaranteed for life', 'Garantie à vie'), text: t('If the steel ever fails, we replace it. Spare lids and seals are always in stock.', 'Si l’acier vous lâche un jour, nous la remplaçons. Bouchons et joints de rechange toujours disponibles.') } },
        { type: 'benefit', settings: { icon: 'sparkle', title: t('Six colours', 'Six coloris'), text: t('A powder coat that resists scratches and keeps its colour for years.', 'Un revêtement poudré qui résiste aux rayures et garde sa couleur des années.') } },
      ],
    },
    { id: 'colours', type: 'colour-showcase', settings: { product: 'the-bottle', eyebrow: t('Six colours', 'Six coloris'), heading: t('Pick the one that feels like you', 'Choisissez celle qui vous ressemble'), button_label: t('Choose', 'Choisir'), color_scheme: 'scheme-1' } },
    {
      id: 'how', type: 'craft-steps',
      settings: { eyebrow: t('How it is made', 'Comment elle est faite'), heading: t('Four steps, no shortcuts', 'Quatre étapes, aucun raccourci'), layout: 'right', color_scheme: 'scheme-4' },
      blocks: [
        { type: 'step', settings: { title: t('Pressed from one sheet', 'Emboutie dans une seule feuille'), text: t('Food-grade stainless steel is drawn into shape, with no seam on the body.', 'L’acier inoxydable alimentaire est embouti sans aucune soudure sur le corps.') } },
        { type: 'step', settings: { title: t('Vacuum sealed', 'Scellée sous vide'), text: t('Two walls with the air pumped out between them: that is what keeps drinks cold or hot.', 'Deux parois avec l’air aspiré entre elles : c’est ce qui garde les boissons fraîches ou chaudes.') } },
        { type: 'step', settings: { title: t('Coated by hand', 'Colorée à la main'), text: t('A powder coat is applied and baked, then checked for scratches under bright light.', 'Un revêtement poudré est appliqué puis cuit, et contrôlé sous une lumière vive.') } },
        { type: 'step', settings: { title: t('Tested and packed', 'Testée et emballée'), text: t('Every bottle is filled, turned upside down and weighed before it is wrapped in recycled card.', 'Chaque gourde est remplie, retournée et pesée avant d’être emballée dans du carton recyclé.') } },
      ],
    },
    {
      id: 'reviews', type: 'testimonials',
      settings: { heading: t('1,200 reviews, one bottle', '1 200 avis, une seule gourde'), color_scheme: 'scheme-1' },
      blocks: [
        { type: 'testimonial', settings: { quote: t('I put ice in at 7 in the morning and it was still there at midnight. I have stopped buying anything else.', 'J’ai mis des glaçons à 7 heures du matin, il en restait à minuit. J’ai arrêté d’acheter autre chose.'), name: 'Clara M.', detail: t('Sage', 'Sauge'), rating: 5 } },
        { type: 'testimonial', settings: { quote: t('It has been dropped down a rock face and only the paint has a mark. The lid still closes perfectly.', 'Elle a dévalé une paroi rocheuse et seule la peinture a une marque. Le bouchon ferme toujours parfaitement.'), name: 'Thomas R.', detail: t('Midnight blue', 'Bleu nuit'), rating: 5 } },
        { type: 'testimonial', settings: { quote: t('Finally one that does not taste of metal. I bought a second one in terracotta for my partner.', 'Enfin une gourde sans goût de métal. J’en ai pris une seconde en terracotta pour mon conjoint.'), name: 'Nadia K.', detail: t('Sand', 'Sable'), rating: 5 } },
      ],
    },
    {
      id: 'faq', type: 'collapsible-content', settings: { heading: t('Questions, answered', 'Vos questions, nos réponses'), open_first: true, color_scheme: 'scheme-3' },
      blocks: [
        { type: 'row', settings: { question: t('How big is it?', 'Quelle est sa taille ?'), answer: t('<p>750 ml, 26 cm tall, and 7 cm wide so it fits most cup holders and bike cages.</p>', '<p>750 ml, 26 cm de haut et 7 cm de large pour entrer dans la plupart des porte-gobelets et porte-bidons.</p>') } },
        { type: 'row', settings: { question: t('Can I put hot drinks in it?', 'Puis-je y mettre une boisson chaude ?'), answer: t('<p>Yes. Tea and coffee stay hot for 12 hours. Avoid fizzy drinks, which build pressure.</p>', '<p>Oui. Thé et café restent chauds 12 heures. Évitez les boissons gazeuses, qui font monter la pression.</p>') } },
        { type: 'row', settings: { question: t('Is it dishwasher safe?', 'Passe-t-elle au lave-vaisselle ?'), answer: t('<p>The lid and seal are. We recommend washing the body by hand to keep the colour at its best.</p>', '<p>Le bouchon et le joint, oui. Nous conseillons de laver le corps à la main pour garder la couleur intacte.</p>') } },
        { type: 'row', settings: { question: t('What if I do not like it?', 'Et si elle ne me plaît pas ?'), answer: t('<p>Send it back within 30 days, used or not, and we refund the full price.</p>', '<p>Renvoyez-la sous 30 jours, utilisée ou non, et nous remboursons le prix complet.</p>') } },
      ],
    },
    {
      id: 'final', type: 'rich-text',
      settings: { align: 'center', color_scheme: 'scheme-2', eyebrow: t('Ready when you are', 'Prête quand vous l’êtes'), heading: t('One bottle. Six colours. Thirty days to love it.', 'Une gourde. Six coloris. Trente jours pour l’adorer.'), text: t('<p>Free delivery on every order, and a lifetime guarantee on the steel.</p>', '<p>Livraison offerte sur chaque commande et garantie à vie sur l’acier.</p>'), button_label: t('Choose your colour', 'Choisir mon coloris'), button_link: '#buy' },
    },
  ],
  templates: {},
  css: `
.k-eyebrow { font: 700 .78rem/1.3 var(--f-heading); letter-spacing: .18em; text-transform: uppercase; color: var(--v-accent); }
[class*='color-scheme-'] .k-eyebrow { color: inherit; opacity: .75; }
.k-section__title { font-weight: 700; letter-spacing: -.03em; font-size: clamp(1.9rem, 3.6vw, 2.9rem); line-height: 1.06; }
.k-buybox .k-info__title { font-size: clamp(2.4rem, 5vw, 3.8rem); letter-spacing: -.04em; line-height: .98; }
.k-buybox .k-gallery__main { border-radius: calc(var(--round) * .6); background: var(--v-surface); box-shadow: none; }
.k-buybox .k-gallery__main img { object-fit: contain; padding: 4%; }
.k-buybox .k-gallery__thumb { border-radius: 18px; }
.k-logo__name { font: 800 clamp(1.3rem, 2.2vw, 1.7rem)/1 var(--f-heading); letter-spacing: -.05em; }
.k-footer__brand { font: 800 1.7rem/1 var(--f-heading); letter-spacing: -.05em; }
.k-announce { font-size: .82rem; font-weight: 600; }
.k-card__title { font-weight: 700; }
.k-listing__title { font-weight: 700; letter-spacing: -.03em; }
.k-quote { border-radius: 28px; }
`,
  info: {
    description: t(
      'A landing page for a store with a single product: the buy box with colour swatches, quantity and purchase options sits on the home page, followed by benefits, a colour showcase, how it is made, reviews and a FAQ, with a sticky add to cart bar. Collection and product pages still work. Sand and midnight blue.',
      'Une page d’atterrissage pour une boutique à produit unique : le bloc d’achat avec coloris, quantité et options d’achat est sur la page d’accueil, suivi des avantages, d’une vitrine des coloris, de la fabrication, des avis et d’une FAQ, avec une barre d’ajout au panier fixe. Les pages collection et produit restent disponibles. Sable et bleu nuit.',
    ),
    tags: ['Single product', 'Landing page', 'Minimal'],
    industries: ['single-product', 'accessories', 'outdoor'],
    catalogSize: 'one',
  },
  changelog: [
    t('First release of Vitrine, a one-product landing page theme.', 'Première version de Vitrine, un thème de page d’atterrissage pour un produit unique.'),
    t('Buy box on the home page: gallery, colour swatches, quantity, add to cart and subscriptions.', 'Bloc d’achat sur la page d’accueil : galerie, coloris, quantité, ajout au panier et abonnements.'),
    t('Sticky add to cart bar that appears once the buy button scrolls out of view.', 'Barre d’ajout au panier fixe qui apparaît quand le bouton d’achat sort de l’écran.'),
    t('New sections: buy box, benefits, colour showcase, craft steps and a countdown timer.', 'Nouvelles sections : bloc d’achat, avantages, vitrine des coloris, étapes de fabrication et compte à rebours.'),
    t('Header with the menu split on both sides of the logo, framed product cards and a collection page with a filter bar.', 'En-tête avec le menu de part et d’autre du logo, cartes produit encadrées et page collection avec barre de filtres.'),
    t('Product page with thumbnails under the photo, options, subscriptions and a low stock message.', 'Page produit avec miniatures sous la photo, options, abonnements et message de stock faible.'),
    t('Breadcrumbs, back to top button and an optional age check.', 'Fil d’Ariane, bouton retour en haut et vérification d’âge facultative.'),
    t('Section names, settings and storefront texts are translated to English and French.', 'Les noms des sections, les réglages et les textes de la boutique sont traduits en anglais et en français.'),
  ],
  demo: {
    currency: 'EUR',
    homeImages: { how: { image: 'ambiance.webp' } },
    menu: [
      { title: t('The bottle', 'La gourde'), url: '/#buy' },
      { title: t('Why this one', 'Pourquoi celle-ci'), url: '/#benefits' },
      { title: t('Colours', 'Coloris'), url: '/#colours' },
      { title: t('Shop', 'Boutique'), url: '/collections/all' },
    ],
    footerMenu: [
      { title: t('The bottle', 'La gourde'), url: '/products/the-bottle' },
      { title: t('Shop all', 'Tout voir'), url: '/collections/all' },
      { title: t('Search', 'Recherche'), url: '/search' },
    ],
    pages: [],
    collections: [
      { handle: 'the-bottle', title: t('The bottle', 'La gourde'), description: t('One bottle, six colours.', 'Une gourde, six coloris.'), products: ['the-bottle'] },
    ],
    products: [
      {
        handle: 'the-bottle', image: 'produit-01.webp', extraImages: ['produit-02.webp', 'produit-03.webp', 'produit-04.webp', 'produit-05.webp', 'produit-06.webp', 'hero.webp', 'ambiance.webp'], vendor: 'Vitrine', type: t('Bottles', 'Gourdes'), tags: ['bottle', 'steel', 'new'],
        title: t('The Bottle', 'La Gourde'),
        description: t('A 750 ml insulated steel bottle that keeps drinks cold for 24 hours and hot for 12. Leak-proof lid, scratch-resistant powder coat, no plastic in contact with your drink, and a lifetime guarantee on the steel.', 'Une gourde isotherme en acier de 750 ml qui garde les boissons froides 24 heures et chaudes 12 heures. Bouchon étanche, revêtement poudré résistant aux rayures, aucun plastique au contact de la boisson et garantie à vie sur l’acier.'),
        options: [{ name: t('Colour', 'Couleur'), values: COLOURS.map(([en, fr]) => t(en, fr)) }],
        price: 49, variants: COLOURS.map(([, , image, stock]) => ({ stock, image })),
      },
    ],
  },
};
