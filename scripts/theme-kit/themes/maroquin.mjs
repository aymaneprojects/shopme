// Maroquin: bags, shoes and accessories. Camel, black and cream, refined.
const t = (en, fr) => ({ en, fr });

export default {
  handle: 'maroquin',
  name: 'Maroquin',
  version: '1.0.0',
  date: '2026-11-06',
  header: { layout: 'mega', sticky: true },
  card: { style: 'framed', ratio: 'square', align: 'left', quickAdd: true },
  product: {
    layout: 'rail', ratio: 'square',
    benefits: [
      { icon: 'shield', text: t('Full-grain leather, guaranteed for two years', 'Cuir pleine fleur, garanti deux ans') },
      { icon: 'scissors', text: t('Hand-stitched in small batches', 'Cousu main en petites séries') },
      { icon: 'truck', text: t('Free delivery, insured and tracked', 'Livraison offerte, assurée et suivie') },
    ],
  },
  collection: { layout: 'sidebar', columns: 3, perPage: 12, infiniteScroll: false },
  fonts: { heading: 'manrope', body: 'inter', accent: 'playfair-display' },
  type: { h1: 320, h2: 220, headingWeight: 300, h1LineHeight: 112, headingCase: 'uppercase', lineHeight: 165, baseSize: 16 },
  colors: {
    accent: '#a8743a', background: '#faf6ee', surface: '#efe6d6', card: '#fffdf8', text: '#1b1713', sale: '#a02a1c', soldOut: '#5a544c',
    swatchColors: 'Camel:#b07a42,Black:#1b1713,Noir:#1b1713,Cognac:#8a4a24,Tan:#c99a64,Fauve:#c99a64,Navy:#27364f',
    schemes: [
      { name: 'Cream', background: '#faf6ee', text: '#1b1713', surface: '#efe6d6', card: '#fffdf8', border: '#ded3bd', button: '#1b1713', button_label: '#faf6ee' },
      { name: 'Camel', background: '#b07a42', text: '#1b1713', surface: '#bd8a55', card: '#c4935f', border: '#8f6130', button: '#1b1713', button_label: '#faf6ee' },
      { name: 'Black', background: '#17130f', text: '#f3ecdd', surface: '#241e18', card: '#241e18', border: '#3a3128', button: '#b07a42', button_label: '#17130f' },
      { name: 'Sand', background: '#ebdfc7', text: '#1b1713', surface: '#e0d1b3', card: '#f4ecda', border: '#cdbd9c', button: '#1b1713', button_label: '#ebdfc7' },
    ],
  },
  scale: { radius: 'soft', spacing: 'regular', pageWidth: 1280 },
  buttons: { uppercase: true, height: 50, border: 1 },
  announcement: { text: t('Free delivery, insured and tracked. Two-year guarantee.', 'Livraison offerte, assurée et suivie. Garantie deux ans.'), scheme: 'scheme-3' },
  footerScheme: 'scheme-3',
  sections: ['craft-steps', 'gift-guide'],
  features: { breadcrumbs: true, backToTop: true, stockCounter: true, stockThreshold: 5 },
  freeShipping: 0,
  home: [
    {
      id: 'hero', type: 'hero',
      settings: {
        layout: 'split', color_scheme: 'scheme-1',
        eyebrow: t('Leather goods', 'Maroquinerie'),
        heading: t('Leather that gets better with time', 'Un cuir qui s’embellit avec le temps'),
        text: t('Bags, shoes and small leather goods in camel, black and cream. Full-grain hides, stitched by hand and made to be repaired, not replaced.', 'Sacs, chaussures et petite maroquinerie en camel, noir et crème. Des peaux pleine fleur, cousues main et faites pour être réparées, pas remplacées.'),
        button_label: t('Discover the collection', 'Découvrir la collection'), button_link: '/collections/all',
        button_2_label: t('The gift guide', 'Le guide cadeaux'), button_2_link: '/collections/all?filter.v.price.lte=100',
        product: 'camel-leather-tote',
      },
      blocks: [
        { type: 'chip', settings: { icon: 'shield', text: t('Two-year guarantee', 'Garantie deux ans') } },
        { type: 'chip', settings: { icon: 'scissors', text: t('Hand-stitched', 'Cousu main') } },
        { type: 'chip', settings: { icon: 'refresh', text: t('Repairs for life', 'Réparations à vie') } },
      ],
    },
    { id: 'essentials', type: 'featured-collection', settings: { eyebrow: t('The essentials', 'Les essentiels'), heading: t('Pieces for every day', 'Des pièces pour chaque jour'), text: t('Six classics, made in the same leather and the same colours.', 'Six classiques, dans le même cuir et les mêmes couleurs.'), collection: 'all', products_to_show: 6, columns: '3', show_view_all: true, color_scheme: '' } },
    {
      id: 'craft', type: 'craft-steps',
      settings: { eyebrow: t('The workshop', 'L’atelier'), heading: t('How a bag is made', 'Comment naît un sac'), layout: 'left', color_scheme: 'scheme-4', product: 'camel-leather-tote' },
      blocks: [
        { type: 'step', settings: { title: t('Choose the hide', 'Choisir la peau'), text: t('Full-grain leather from a tannery we have worked with for years, vegetable-tanned for a rich patina.', 'Cuir pleine fleur d’une tannerie avec laquelle nous travaillons depuis des années, tanné au végétal pour une patine riche.') } },
        { type: 'step', settings: { title: t('Cut by hand', 'Découper à la main'), text: t('Each panel is cut around the best part of the hide, never stamped out.', 'Chaque pièce est découpée autour de la meilleure partie de la peau, jamais emboutie.') } },
        { type: 'step', settings: { title: t('Stitch and edge', 'Coudre et border'), text: t('Saddle-stitched with waxed thread, edges burnished until they glow.', 'Piqûre sellier au fil ciré, tranches lissées jusqu’à ce qu’elles brillent.') } },
        { type: 'step', settings: { title: t('Check and send', 'Contrôler et expédier'), text: t('Every piece is inspected by the person who made it, then signed and packed.', 'Chaque pièce est contrôlée par celle ou celui qui l’a faite, puis signée et emballée.') } },
      ],
    },
    {
      id: 'gifts', type: 'gift-guide',
      settings: { eyebrow: t('Gift guide', 'Guide cadeaux'), heading: t('Find the right gift', 'Trouvez le bon cadeau'), text: t('Choose a budget and we will show you what fits.', 'Choisissez un budget et nous vous montrons ce qui convient.'), color_scheme: '' },
      blocks: [
        { type: 'budget', settings: { label: t('Under 100', 'Moins de 100'), text: t('Wallets, belts and small leather goods.', 'Portefeuilles, ceintures et petite maroquinerie.'), link: '/collections/all?filter.v.price.lte=100', color_scheme: 'scheme-1' } },
        { type: 'budget', settings: { label: t('100 to 200', 'De 100 à 200'), text: t('Sneakers, loafers and everyday bags.', 'Baskets, mocassins et sacs de tous les jours.'), link: '/collections/all?filter.v.price.gte=100&filter.v.price.lte=200', color_scheme: 'scheme-4' } },
        { type: 'budget', settings: { label: t('Over 200', 'Plus de 200'), text: t('The pieces that last a lifetime.', 'Les pièces qui durent toute une vie.'), link: '/collections/all?filter.v.price.gte=200', color_scheme: 'scheme-3' } },
      ],
    },
    {
      id: 'repair', type: 'rich-text',
      settings: { align: 'center', color_scheme: 'scheme-1', eyebrow: t('For life', 'Pour la vie'), heading: t('Repair, resole, restore', 'Réparer, ressemeler, restaurer'), text: t('<p>Send a piece back after ten years and we will clean it, stitch it and polish it for the cost of the postage. Good leather deserves a long life.</p>', '<p>Renvoyez une pièce après dix ans et nous la nettoierons, la recoudrons et la lustrerons pour le prix de l’envoi. Un bon cuir mérite une longue vie.</p>'), button_label: t('Our repair promise', 'Notre promesse de réparation'), button_link: '/pages/leather-care' },
    },
    {
      id: 'reviews', type: 'testimonials',
      settings: { heading: t('Carried and trusted', 'Portés et approuvés'), color_scheme: 'scheme-4' },
      blocks: [
        { type: 'testimonial', settings: { quote: t('The tote has the most beautiful colour and the stitching is flawless. It is already softening nicely.', 'Le cabas a une couleur sublime et les coutures sont impeccables. Il s’assouplit déjà joliment.'), name: 'Hélène V.', detail: t('Camel leather tote', 'Sac cabas en cuir camel'), rating: 5 } },
        { type: 'testimonial', settings: { quote: t('Comfortable from the first day. The loafers fit true to size and look better each week.', 'Confortables dès le premier jour. Les mocassins taillent juste et sont plus beaux chaque semaine.'), name: 'Antoine M.', detail: t('Leather loafers', 'Mocassins en cuir'), rating: 5 } },
        { type: 'testimonial', settings: { quote: t('A lovely belt, solid brass buckle, and it arrived in a beautiful box. A perfect gift.', 'Une très belle ceinture, boucle en laiton massif, arrivée dans un joli coffret. Un cadeau parfait.'), name: 'Laure G.', detail: t('Leather belt', 'Ceinture en cuir'), rating: 5 } },
      ],
    },
    { id: 'newsletter', type: 'newsletter', settings: { heading: t('The Maroquin letter', 'La lettre Maroquin'), text: t('New pieces, workshop notes and care advice, once a month.', 'Nouvelles pièces, notes d’atelier et conseils d’entretien, une fois par mois.'), button_label: t('Subscribe', 'S’abonner'), color_scheme: 'scheme-4' } },
  ],
  templates: {
    'page.leather-care': [
      { id: 'care', type: 'materials', settings: { eyebrow: t('Leather care', 'Entretien du cuir'), heading: t('Looking after your leather', 'Prendre soin de votre cuir'), text: t('A little care once or twice a year is all it needs.', 'Un peu d’entretien une ou deux fois par an suffit.'), color_scheme: 'scheme-4' }, blocks: [{ type: 'material', settings: { icon: 'drop', title: t('Keep it dry', 'Le garder au sec'), text: t('If it gets wet, let it dry slowly, away from heat.', 'S’il est mouillé, laissez-le sécher lentement, loin de toute chaleur.') } }, { type: 'material', settings: { icon: 'sun', title: t('Feed it', 'Le nourrir'), text: t('Rub in a little neutral conditioner twice a year.', 'Appliquez un peu de crème neutre deux fois par an.') } }, { type: 'material', settings: { icon: 'refresh', title: t('Bring it back', 'Le ramener'), text: t('Send it to us for a clean, a stitch and a polish.', 'Envoyez-le-nous pour un nettoyage, une couture et un lustrage.') } }] },
    ],
  },
  css: `
.k-eyebrow { font: italic 400 1.1rem/1.3 var(--f-accent); color: var(--v-accent); letter-spacing: .01em; }
.k-section__title { font-weight: 300; letter-spacing: .06em; font-size: clamp(1.7rem, 3vw, 2.3rem); }
.k-hero__heading { font-weight: 300; letter-spacing: .05em; font-size: clamp(2.2rem, 5vw, 3.6rem); line-height: 1.12; max-width: 16ch; }
.k-hero .k-arch { border: 1px solid var(--v-ink); padding: 14px; background: var(--v-card); box-shadow: none; aspect-ratio: 4 / 5; border-radius: 0; }
.k-hero .k-arch img { border-radius: 0; }
.k-hero::before { display: none; }
.k-hero__product { border-radius: 0; border: 1px solid var(--v-ink); box-shadow: none; }
.k-chips li { background: none; border-radius: 0; border-color: var(--v-ink); text-transform: uppercase; letter-spacing: .08em; font-size: .74rem; }
.k-grid { gap: 32px 24px; }
.k-announce { font-size: .74rem; letter-spacing: .16em; text-transform: uppercase; }
.k-tile, .k-story__media, .k-craft__media { border-radius: 0; }
.k-quote { border-radius: 0; box-shadow: none; border: 1px solid var(--v-line); background: transparent; } .k-quote__mark { border-radius: 0; }
.k-gift { border-radius: 0; border-color: var(--v-ink); }
.k-gift__label { font-weight: 300; letter-spacing: .04em; text-transform: uppercase; font-size: clamp(1.3rem, 2.4vw, 1.8rem); }
.k-step__title { text-transform: uppercase; letter-spacing: .1em; font-size: .86rem; } .k-step__num { font-family: var(--f-accent); font-style: italic; }
.k-newsletter-band__inner { border-radius: 0; }
.k-logo__name { font-weight: 300; letter-spacing: .32em; text-transform: uppercase; font-size: clamp(1.1rem, 2vw, 1.4rem); }
.k-fold { border-radius: 0; } .k-drop > summary, .k-pill { border-radius: 0; }
.k-footer__brand { font-weight: 300; letter-spacing: .28em; text-transform: uppercase; font-size: 1.4rem; }
.k-pdp--rail .k-info__title { font-weight: 300; letter-spacing: .05em; text-transform: uppercase; font-size: clamp(1.6rem, 3vw, 2.3rem); }
.k-listing__title { font-weight: 300; letter-spacing: .08em; text-transform: uppercase; }
`,
  info: {
    description: t(
      'A refined storefront for bags, shoes and accessories: a header with mega menu, framed product cards, a product page with a thumbnail rail, a sidebar of filters, craft steps and a gift guide. Camel, black and cream.',
      'Une boutique raffinée pour sacs, chaussures et accessoires : en-tête avec méga-menu, cartes produit encadrées, page produit à rail de miniatures, filtres latéraux, étapes de fabrication et guide cadeaux. Camel, noir et crème.',
    ),
    tags: ['Fashion', 'Accessories', 'Luxury'],
    industries: ['accessories', 'fashion'],
    catalogSize: 'few',
  },
  changelog: [
    t('First release of Maroquin, a refined theme for bags, shoes and leather accessories.', 'Première version de Maroquin, un thème raffiné pour les sacs, les chaussures et les accessoires en cuir.'),
    t('Header with the logo on the left, a mega menu that opens columns of links, a search panel and a slide-in bag.', 'En-tête avec le logo à gauche, méga-menu qui ouvre des colonnes de liens, panneau de recherche et panier latéral.'),
    t('Framed product cards with a second photo on hover, colour swatches and a quick add button.', 'Cartes produit encadrées avec seconde photo au survol, pastilles de couleur et bouton d’ajout rapide.'),
    t('Product page with a vertical rail of thumbnails, options, subscriptions and a low stock message.', 'Page produit avec un rail vertical de miniatures, options, abonnements et message de stock faible.'),
    t('Collection page with a sidebar of filters, sorting and pagination.', 'Page collection avec barre latérale de filtres, tri et pagination.'),
    t('New sections: craft steps, gift guide, materials and care, and a countdown timer.', 'Nouvelles sections : étapes de fabrication, guide cadeaux, matières et entretien, et compte à rebours.'),
    t('Breadcrumbs, back to top button and an optional age check.', 'Fil d’Ariane, bouton retour en haut et vérification d’âge facultative.'),
    t('Section names, settings and storefront texts are translated to English and French.', 'Les noms des sections, les réglages et les textes de la boutique sont traduits en anglais et en français.'),
  ],
  demo: {
    currency: 'EUR',
    homeImages: { hero: { image: 'hero.webp' }, craft: { image: 'ambiance.webp' } },
    menu: [
      { title: t('Bags', 'Sacs'), url: '/collections/bags', children: [
        { title: t('Everyday', 'Au quotidien'), url: '/collections/bags', children: [{ title: t('Camel leather tote', 'Sac cabas en cuir camel'), url: '/products/camel-leather-tote' }, { title: t('Black crossbody bag', 'Sac bandoulière noir'), url: '/products/black-crossbody-bag' }] },
        { title: t('Explore', 'Explorer'), url: '/collections/all', children: [{ title: t('All bags', 'Tous les sacs'), url: '/collections/bags' }, { title: t('Gifts under 100', 'Cadeaux à moins de 100'), url: '/collections/all?filter.v.price.lte=100' }] },
      ] },
      { title: t('Shoes', 'Chaussures'), url: '/collections/shoes', children: [
        { title: t('Footwear', 'Chaussures'), url: '/collections/shoes', children: [{ title: t('Leather loafers', 'Mocassins en cuir'), url: '/products/leather-loafers' }, { title: t('Minimal white sneakers', 'Baskets blanches minimalistes'), url: '/products/minimal-white-sneakers' }] },
        { title: t('Explore', 'Explorer'), url: '/collections/all', children: [{ title: t('All shoes', 'Toutes les chaussures'), url: '/collections/shoes' }, { title: t('Care guide', 'Guide d’entretien'), url: '/pages/leather-care' }] },
      ] },
      { title: t('Accessories', 'Accessoires'), url: '/collections/accessories', children: [
        { title: t('Small leather goods', 'Petite maroquinerie'), url: '/collections/accessories', children: [{ title: t('Leather wallet', 'Portefeuille en cuir'), url: '/products/leather-wallet' }, { title: t('Leather belt', 'Ceinture en cuir'), url: '/products/leather-belt' }] },
        { title: t('Explore', 'Explorer'), url: '/collections/all', children: [{ title: t('All accessories', 'Tous les accessoires'), url: '/collections/accessories' }] },
      ] },
      { title: t('Gifts', 'Cadeaux'), url: '/collections/all?filter.v.price.lte=100' },
    ],
    footerMenu: [
      { title: t('Shop all', 'Tout voir'), url: '/collections/all' },
      { title: t('Leather care', 'Entretien du cuir'), url: '/pages/leather-care' },
      { title: t('Search', 'Recherche'), url: '/search' },
    ],
    pages: [{ handle: 'leather-care', title: t('Leather care', 'Entretien du cuir'), template: 'leather-care' }],
    collections: [
      { handle: 'bags', title: t('Bags', 'Sacs'), description: t('Totes and crossbody bags in full-grain leather.', 'Cabas et sacs bandoulière en cuir pleine fleur.'), products: ['camel-leather-tote', 'black-crossbody-bag'] },
      { handle: 'shoes', title: t('Shoes', 'Chaussures'), description: t('Loafers and sneakers, made to be resoled.', 'Mocassins et baskets, faits pour être ressemelés.'), products: ['leather-loafers', 'minimal-white-sneakers'] },
      { handle: 'accessories', title: t('Accessories', 'Accessoires'), description: t('Wallets and belts that age beautifully.', 'Portefeuilles et ceintures qui vieillissent bien.'), products: ['leather-wallet', 'leather-belt'] },
    ],
    products: [
      {
        handle: 'camel-leather-tote', image: 'produit-01.webp', extraImages: ['hero.webp', 'ambiance.webp'], vendor: 'Maroquin', type: t('Bags', 'Sacs'), tags: ['bags', 'tote', 'new'],
        title: t('Camel Leather Tote', 'Sac cabas en cuir camel'),
        description: t('A roomy tote in vegetable-tanned camel leather with an unlined interior and a zipped inside pocket. It fits a laptop and a lunch.', 'Un cabas spacieux en cuir camel tanné au végétal, intérieur non doublé et poche zippée. Il accueille un ordinateur et un déjeuner.'),
        options: [{ name: t('Colour', 'Couleur'), values: [t('Camel', 'Camel'), t('Black', 'Noir')] }],
        price: 245, variants: [{ stock: 8 }, { stock: 4 }],
      },
      {
        handle: 'black-crossbody-bag', image: 'produit-02.webp', vendor: 'Maroquin', type: t('Bags', 'Sacs'), tags: ['bags', 'crossbody'],
        title: t('Black Crossbody Bag', 'Sac bandoulière noir'),
        description: t('A compact crossbody in smooth black leather with an adjustable strap and a magnetic flap. Small enough for evenings, big enough for days.', 'Un sac bandoulière compact en cuir lisse noir, bandoulière réglable et rabat aimanté. Assez petit pour le soir, assez grand pour la journée.'),
        options: [{ name: t('Colour', 'Couleur'), values: [t('Black', 'Noir'), t('Cognac', 'Cognac')] }],
        price: 195, compareAt: 225, variants: [{ stock: 10 }, { stock: 3 }],
      },
      {
        handle: 'leather-wallet', image: 'produit-03.webp', vendor: 'Maroquin', type: t('Small leather goods', 'Petite maroquinerie'), tags: ['accessories', 'wallet', 'gift'],
        title: t('Leather Wallet', 'Portefeuille en cuir'),
        description: t('A slim bifold with six card slots and a coin pocket, in leather that darkens with use. Comes in a gift box.', 'Un porte-cartes plié et fin avec six fentes à cartes et une poche monnaie, en cuir qui fonce à l’usage. Livré en coffret.'),
        options: [{ name: t('Colour', 'Couleur'), values: [t('Cognac', 'Cognac'), t('Black', 'Noir'), t('Tan', 'Fauve')] }],
        price: 69, variants: [{ stock: 30 }, { stock: 22 }, { stock: 12 }],
      },
      {
        handle: 'leather-loafers', image: 'produit-04.webp', vendor: 'Maroquin', type: t('Shoes', 'Chaussures'), tags: ['shoes', 'loafers'],
        title: t('Leather Loafers', 'Mocassins en cuir'),
        description: t('Hand-lasted loafers in soft calf leather with a leather sole and a flexible heel. Made to be resoled.', 'Mocassins montés main en cuir de veau souple, semelle cuir et talon flexible. Faits pour être ressemelés.'),
        options: [{ name: t('Size', 'Pointure'), values: ['39', '40', '41', '42', '43', '44'] }],
        price: 185, variants: [{ stock: 5 }, { stock: 8 }, { stock: 10 }, { stock: 9 }, { stock: 6 }, { stock: 2 }],
      },
      {
        handle: 'minimal-white-sneakers', image: 'produit-05.webp', vendor: 'Maroquin', type: t('Shoes', 'Chaussures'), tags: ['shoes', 'sneakers'],
        title: t('Minimal White Sneakers', 'Baskets blanches minimalistes'),
        description: t('Clean white sneakers in smooth leather with a stitched cupsole. Nothing on the side, nothing to explain.', 'Des baskets blanches épurées en cuir lisse avec semelle cousue. Rien sur le côté, rien à expliquer.'),
        options: [{ name: t('Size', 'Pointure'), values: ['39', '40', '41', '42', '43', '44'] }],
        price: 145, variants: [{ stock: 12 }, { stock: 15 }, { stock: 14 }, { stock: 11 }, { stock: 7 }, { stock: 4 }],
      },
      {
        handle: 'leather-belt', image: 'produit-06.webp', vendor: 'Maroquin', type: t('Belts', 'Ceintures'), tags: ['accessories', 'belt', 'gift'],
        title: t('Leather Belt', 'Ceinture en cuir'),
        description: t('A 3 cm belt in full-grain leather with a solid brass buckle that is easy to replace. Comes in a gift box.', 'Une ceinture de 3 cm en cuir pleine fleur avec boucle en laiton massif, facile à remplacer. Livrée en coffret.'),
        options: [{ name: t('Colour', 'Couleur'), values: [t('Cognac', 'Cognac'), t('Black', 'Noir')] }, { name: t('Size', 'Taille'), values: ['85', '90', '95', '100', '105'] }],
        price: 59, variants: [{ stock: 14 }, { stock: 12 }, { stock: 11 }, { stock: 6 }, { stock: 3 }, { stock: 15 }, { stock: 14 }, { stock: 10 }, { stock: 8 }, { stock: 5 }],
      },
    ],
  },
};
