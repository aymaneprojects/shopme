// Sillage: fashion. Editorial, big imagery, olive and neutral tones.
const t = (en, fr) => ({ en, fr });

export default {
  handle: 'sillage',
  name: 'Sillage',
  version: '1.0.0',
  date: '2026-11-06',
  header: { layout: 'split', sticky: true },
  card: { style: 'minimal', ratio: 'portrait', align: 'left', quickAdd: true },
  product: {
    layout: 'stacked',
    benefits: [
      { icon: 'truck', text: t('Free delivery from 80', 'Livraison offerte dès 80') },
      { icon: 'refresh', text: t('Returns are free for 30 days', 'Retours gratuits pendant 30 jours') },
      { icon: 'scissors', text: t('Cut and finished by hand', 'Coupé et fini à la main') },
    ],
  },
  collection: { layout: 'topbar', columns: 4, perPage: 16, infiniteScroll: true },
  fonts: { heading: 'playfair-display', body: 'inter', accent: 'lora' },
  type: { h1: 400, h2: 270, headingWeight: 400, h1LineHeight: 100, lineHeight: 165, baseSize: 16 },
  colors: {
    accent: '#5c6838', background: '#f6f3ec', surface: '#ebe6d9', card: '#fbf9f4', text: '#23251d', sale: '#a4412b',
    swatchColors: 'Heather grey:#9a9a94,Gris chiné:#9a9a94,Stone:#d9d1be,Pierre:#d9d1be,Olive:#5c6838,Ecru:#efe7d3,Écru:#efe7d3,Raw denim:#3b4a63',
    schemes: [
      { name: 'Ivory', background: '#f6f3ec', text: '#23251d', surface: '#ebe6d9', card: '#fbf9f4', border: '#d9d3c3', button: '#23251d', button_label: '#f6f3ec' },
      { name: 'Olive', background: '#4a5230', text: '#f3efe2', surface: '#59623b', card: '#59623b', border: '#7a8458', button: '#f3efe2', button_label: '#4a5230' },
      { name: 'Stone', background: '#e4ddcd', text: '#23251d', surface: '#d8d0bd', card: '#efe9db', border: '#c7bea9', button: '#23251d', button_label: '#e4ddcd' },
      { name: 'Charcoal', background: '#22241d', text: '#f3efe2', surface: '#2e3126', card: '#2e3126', border: '#44483a', button: '#f3efe2', button_label: '#22241d' },
    ],
  },
  scale: { radius: 'sharp', spacing: 'airy', pageWidth: 1360 },
  buttons: { uppercase: true, height: 52, border: 1 },
  announcement: { text: t('Free delivery from 80 and 30 days to return', 'Livraison offerte dès 80 et 30 jours pour retourner'), scheme: 'scheme-4' },
  footerScheme: 'scheme-3',
  sections: ['lookbook', 'size-guide'],
  features: { breadcrumbs: true, backToTop: true, stockCounter: true, stockThreshold: 6 },
  home: [
    {
      id: 'hero', type: 'hero',
      settings: {
        layout: 'full', color_scheme: 'scheme-4',
        eyebrow: t('Autumn / Winter', 'Automne / Hiver'),
        heading: t('Dressed in quiet colours', 'Habillé de couleurs tranquilles'),
        text: t('Soft knits, washed linen and easy shapes in olive and stone. Pieces made to be worn all season and kept for years.', 'Mailles douces, lin lavé et coupes aisées en olive et en pierre. Des pièces à porter toute la saison et à garder des années.'),
        button_label: t('Shop the collection', 'Voir la collection'), button_link: '/collections/all',
        button_2_label: t('Find your size', 'Trouver ma taille'), button_2_link: '/pages/size-guide',
      },
      blocks: [
        { type: 'chip', settings: { icon: 'leaf', text: t('Natural fibres', 'Fibres naturelles') } },
        { type: 'chip', settings: { icon: 'truck', text: t('Free delivery from 80', 'Livraison offerte dès 80') } },
        { type: 'chip', settings: { icon: 'refresh', text: t('30-day returns', 'Retours sous 30 jours') } },
      ],
    },
    { id: 'new-in', type: 'featured-collection', settings: { eyebrow: t('New in', 'Nouveautés'), heading: t('The new season', 'La nouvelle saison'), text: t('Four pieces to build a wardrobe around.', 'Quatre pièces pour construire une garde-robe.'), collection: 'all', products_to_show: 4, columns: '4', show_view_all: true, color_scheme: '' } },
    {
      id: 'lookbook', type: 'lookbook',
      settings: { eyebrow: t('The edit', 'La sélection'), heading: t('Shop the look', 'Shopper le look'), color_scheme: 'scheme-3' },
      blocks: [
        { type: 'look', settings: { title: t('Weekend in wool', 'Week-end en laine'), text: t('A heather cardigan over a striped tee, olive trousers to finish.', 'Un cardigan chiné sur un t-shirt rayé, un pantalon olive pour finir.'), product: 'heather-wool-cardigan' } },
        { type: 'look', settings: { title: t('Linen, layered', 'Lin en couches'), text: t('A beige shirt under raw denim.', 'Une chemise beige sous le denim brut.'), product: 'beige-linen-shirt' } },
        { type: 'look', settings: { title: t('All black, one texture', 'Tout en noir, une seule matière'), text: t('A roll-neck, nothing else needed.', 'Un col roulé, rien d’autre.'), product: 'black-roll-neck-sweater' } },
      ],
    },
    { id: 'sale', type: 'countdown', settings: { eyebrow: t('Winter sale', 'Soldes d’hiver'), heading: t('Up to 30% off the autumn edit', 'Jusqu’à 30 % sur la sélection d’automne'), text: t('The last pieces of the season, at their best price.', 'Les dernières pièces de la saison, au meilleur prix.'), end_date: '2027-01-15T23:59', ended_text: t('The sale has ended. See you next season.', 'Les soldes sont terminés. À la saison prochaine.'), button_label: t('Shop the sale', 'Voir la vente'), button_link: '/collections/all?filter.v.availability=1', color_scheme: 'scheme-2' } },
    { id: 'categories', type: 'collection-list', settings: { eyebrow: t('Wardrobe', 'Garde-robe'), heading: t('Shop by category', 'Acheter par catégorie'), columns: '3', collections: [], color_scheme: '' } },
    {
      id: 'story', type: 'image-with-text',
      settings: {
        layout: 'left', color_scheme: 'scheme-1',
        eyebrow: t('The atelier', 'L’atelier'),
        heading: t('Made slowly, worn for years', 'Fait lentement, porté des années'),
        text: t('<p>We work with small mills that spin and weave natural fibres, and with workshops that cut and sew in short runs. Fewer pieces, better materials, and colours that go with everything you already own.</p>', '<p>Nous travaillons avec de petites filatures qui tissent des fibres naturelles, et avec des ateliers qui coupent et cousent en petites séries. Moins de pièces, de meilleures matières, et des couleurs qui vont avec tout ce que vous possédez déjà.</p>'),
        button_label: t('Read our story', 'Lire notre histoire'), button_link: '/pages/about-us',
      },
    },
    {
      id: 'reviews', type: 'testimonials',
      settings: { heading: t('Worn and loved', 'Portés et aimés'), color_scheme: '' },
      blocks: [
        { type: 'testimonial', settings: { quote: t('The cardigan is exactly the grey I was looking for, and the wool is so soft. I wear it every week.', 'Le cardigan est exactement le gris que je cherchais, et la laine est très douce. Je le porte chaque semaine.'), name: 'Camille R.', detail: t('Heather wool cardigan', 'Cardigan en laine chiné'), rating: 5 } },
        { type: 'testimonial', settings: { quote: t('Great cut on the chinos, and the olive is beautiful. They fit true to size.', 'Très belle coupe pour le chino, et l’olive est magnifique. La taille correspond bien.'), name: 'Thomas L.', detail: t('Olive chino trousers', 'Pantalon chino olive'), rating: 5 } },
        { type: 'testimonial', settings: { quote: t('Quick delivery, tidy packaging and an easy exchange when I needed a size up.', 'Livraison rapide, emballage soigné et échange facile quand il m’a fallu une taille au-dessus.'), name: 'Inès B.', detail: t('Linen shirt', 'Chemise en lin'), rating: 5 } },
      ],
    },
    { id: 'newsletter', type: 'newsletter', settings: { heading: t('Stay close to Sillage', 'Restez proche de Sillage'), text: t('New arrivals, behind the scenes and 10% off your first order.', 'Nouveautés, coulisses et 10 % sur votre première commande.'), button_label: t('Subscribe', 'S’abonner'), color_scheme: 'scheme-1' } },
  ],
  templates: {
    'page.size-guide': [{ id: 'guide', type: 'size-guide', settings: { color_scheme: '' } }],
  },
  css: `
.k-eyebrow { font: 600 .72rem/1.3 var(--f-body); letter-spacing: .24em; text-transform: uppercase; color: var(--v-ink); }
.k-section__head, .k-section__head--center { text-align: left; max-width: none; margin-inline: 0; display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: 8px 40px; }
.k-section__head > .k-eyebrow { flex-basis: 100%; margin: 0; } .k-section__title { font-weight: 400; letter-spacing: -.02em; margin: 0; }
.k-section__more { text-align: left; }
.k-announce { font-size: .78rem; letter-spacing: .14em; text-transform: uppercase; }
.k-hero__heading { font-weight: 400; letter-spacing: -.03em; max-width: 12ch; font-size: clamp(3rem, 8vw, 6.4rem); line-height: .96; }
.k-hero--full .k-hero__inner { padding-block: 160px 96px; } .k-hero--full .k-hero__text { font-size: 1.05rem; max-width: 44ch; }
.k-hero--full .k-chips { gap: 8px 22px; margin-top: 44px; } .k-hero--full .k-chips li { padding: 0; background: none; border: 0; backdrop-filter: none; text-transform: uppercase; letter-spacing: .14em; font-size: .72rem; }
.k-grid { gap: 56px 20px; }
.k-story__media { border-radius: 0; aspect-ratio: 4 / 5; } .k-story__inner { gap: 96px; }
.k-tile { aspect-ratio: 3 / 4; border-radius: 0; } .k-tile__label { left: 0; right: 0; bottom: 0; border-radius: 0; padding: 16px 18px; background: color-mix(in srgb, var(--v-bg) 94%, transparent); }
.k-tile__arrow { border-radius: 0; background: none; color: var(--v-ink); }
.k-quote { border-radius: 0; box-shadow: none; border: 1px solid var(--v-line); background: transparent; } .k-quote__mark { border-radius: 0; }
.k-newsletter-band__inner { border-radius: 0; background: var(--v-surface); }
.k-footer__brand { font-weight: 400; letter-spacing: -.02em; text-transform: none; font-size: 2.2rem; }
.k-pdp--stacked .k-info__title { font-weight: 400; letter-spacing: -.02em; }
.k-fold, .k-chips li { border-radius: 0; }
.k-look__media { border-radius: 0; }
`,
  info: {
    description: t(
      'An editorial fashion storefront: a full-bleed hero, a split header, bare product cards, a stacked product page, a lookbook with shoppable looks, a size guide and a countdown for seasonal sales. Olive and neutral tones.',
      'Une boutique de mode éditoriale : héros pleine largeur, en-tête scindé, cartes produit épurées, page produit en colonne, lookbook avec looks à shopper, guide des tailles et compte à rebours pour les soldes. Tons olive et neutres.',
    ),
    tags: ['Fashion', 'Editorial', 'Minimal'],
    industries: ['fashion'],
    catalogSize: 'many',
  },
  changelog: [
    t('First release of Sillage, an editorial theme for fashion and apparel.', 'Première version de Sillage, un thème éditorial pour la mode et le prêt-à-porter.'),
    t('Split header with half of the menu on each side of the logo, a search panel and a slide-in bag with a free shipping progress bar.', 'En-tête scindé avec la moitié du menu de chaque côté du logo, panneau de recherche et panier latéral avec barre de progression vers la livraison offerte.'),
    t('Bare product cards with a second photo on hover, colour swatches and a quick add bar.', 'Cartes produit épurées avec seconde photo au survol, pastilles de couleur et barre d’ajout rapide.'),
    t('Product page with a column of large photos beside sticky purchase details, options, subscriptions and low stock message.', 'Page produit avec une colonne de grandes photos et des informations d’achat fixes : options, abonnements et message de stock faible.'),
    t('Collection page with a filter bar, sorting and infinite scroll.', 'Page collection avec barre de filtres, tri et défilement infini.'),
    t('New sections: lookbook with shoppable looks, size guide and countdown timer.', 'Nouvelles sections : lookbook avec looks à shopper, guide des tailles et compte à rebours.'),
    t('Breadcrumbs, back to top button and an optional age check.', 'Fil d’Ariane, bouton retour en haut et vérification d’âge facultative.'),
    t('Section names, settings and storefront texts are translated to English and French.', 'Les noms des sections, les réglages et les textes de la boutique sont traduits en anglais et en français.'),
  ],
  demo: {
    currency: 'EUR',
    homeImages: { hero: { image: 'hero.webp' }, story: { image: 'ambiance.webp' } },
    menu: [
      { title: t('New in', 'Nouveautés'), url: '/collections/all' },
      { title: t('Knitwear', 'Maille'), url: '/collections/knitwear' },
      { title: t('Shirts and tees', 'Chemises et t-shirts'), url: '/collections/shirts-and-tees' },
      { title: t('Outerwear and trousers', 'Vestes et pantalons'), url: '/collections/outerwear-and-trousers' },
    ],
    footerMenu: [
      { title: t('Shop all', 'Tout voir'), url: '/collections/all' },
      { title: t('Size guide', 'Guide des tailles'), url: '/pages/size-guide' },
      { title: t('Search', 'Recherche'), url: '/search' },
    ],
    pages: [{ handle: 'size-guide', title: t('Size guide', 'Guide des tailles'), template: 'size-guide' }],
    collections: [
      { handle: 'knitwear', title: t('Knitwear', 'Maille'), description: t('Wool and cotton knits, soft and warm.', 'Mailles en laine et en coton, douces et chaudes.'), products: ['heather-wool-cardigan', 'black-roll-neck-sweater'] },
      { handle: 'shirts-and-tees', title: t('Shirts and tees', 'Chemises et t-shirts'), description: t('Linen shirts and striped cotton tees.', 'Chemises en lin et t-shirts rayés en coton.'), products: ['striped-tee-ecru-and-green', 'beige-linen-shirt'] },
      { handle: 'outerwear-and-trousers', title: t('Outerwear and trousers', 'Vestes et pantalons'), description: t('Raw denim and easy chinos.', 'Denim brut et chinos aisés.'), products: ['raw-denim-jacket', 'olive-chino-trousers'] },
    ],
    products: [
      {
        handle: 'heather-wool-cardigan', image: 'produit-01.webp', extraImages: ['ambiance.webp'], vendor: 'Sillage', type: t('Knitwear', 'Maille'), tags: ['knitwear', 'wool', 'new'],
        title: t('Heather Wool Cardigan', 'Cardigan en laine gris chiné'),
        description: t('A mid-weight cardigan in a soft heather grey wool blend, with a relaxed fit and horn-effect buttons.', 'Un cardigan de poids moyen dans un mélange de laine gris chiné, coupe décontractée et boutons effet corne.'),
        options: [{ name: t('Size', 'Taille'), values: ['S', 'M', 'L', 'XL'] }, { name: t('Colour', 'Couleur'), values: [t('Heather grey', 'Gris chiné'), t('Olive', 'Olive')] }],
        price: 129, variants: [{ stock: 14 }, { stock: 9 }, { stock: 4 }, { stock: 0 }, { stock: 12 }, { stock: 6 }, { stock: 3 }, { stock: 8 }],
      },
      {
        handle: 'black-roll-neck-sweater', image: 'produit-02.webp', vendor: 'Sillage', type: t('Knitwear', 'Maille'), tags: ['knitwear', 'new'],
        title: t('Black Roll-Neck Sweater', 'Pull col roulé noir'),
        description: t('A fine-gauge roll-neck in soft cotton and wool. It layers under everything and keeps its shape.', 'Un col roulé en jauge fine, coton et laine. Il se superpose à tout et garde sa forme.'),
        options: [{ name: t('Size', 'Taille'), values: ['S', 'M', 'L', 'XL'] }],
        price: 98, variants: [{ stock: 20 }, { stock: 15 }, { stock: 11 }, { stock: 5 }],
      },
      {
        handle: 'striped-tee-ecru-and-green', image: 'produit-03.webp', vendor: 'Sillage', type: t('T-shirts', 'T-shirts'), tags: ['tees', 'cotton'],
        title: t('Striped Tee, Ecru and Green', 'T-shirt rayé écru et vert'),
        description: t('A boxy organic cotton tee with a wide ecru and olive stripe. Heavy jersey that softens with every wash.', 'Un t-shirt carré en coton bio à larges rayures écru et olive. Un jersey épais qui s’adoucit à chaque lavage.'),
        options: [{ name: t('Size', 'Taille'), values: ['S', 'M', 'L', 'XL'] }],
        price: 45, variants: [{ stock: 30 }, { stock: 24 }, { stock: 18 }, { stock: 9 }],
      },
      {
        handle: 'raw-denim-jacket', image: 'produit-04.webp', vendor: 'Sillage', type: t('Outerwear', 'Vestes'), tags: ['outerwear', 'denim', 'sale'],
        title: t('Raw Denim Jacket', 'Veste en jean brut'),
        description: t('A structured jacket in 12 oz raw selvedge denim. It starts stiff and fades to your shape.', 'Une veste structurée en denim brut de 12 oz. Elle commence raide et se patine à votre silhouette.'),
        options: [{ name: t('Size', 'Taille'), values: ['S', 'M', 'L', 'XL'] }],
        price: 139, compareAt: 169, variants: [{ stock: 7 }, { stock: 10 }, { stock: 5 }, { stock: 2 }],
      },
      {
        handle: 'beige-linen-shirt', image: 'produit-05.webp', vendor: 'Sillage', type: t('Shirts', 'Chemises'), tags: ['shirts', 'linen'],
        title: t('Beige Linen Shirt', 'Chemise en lin beige'),
        description: t('A relaxed shirt in washed European linen. Breathable, creased in the right way, with a soft collar.', 'Une chemise décontractée en lin européen lavé. Respirante, froissée comme il faut, avec un col souple.'),
        options: [{ name: t('Size', 'Taille'), values: ['S', 'M', 'L', 'XL'] }, { name: t('Colour', 'Couleur'), values: [t('Stone', 'Pierre'), t('Ecru', 'Écru')] }],
        price: 89, variants: [{ stock: 12 }, { stock: 12 }, { stock: 9 }, { stock: 9 }, { stock: 6 }, { stock: 6 }, { stock: 3 }, { stock: 0 }],
      },
      {
        handle: 'olive-chino-trousers', image: 'produit-06.webp', vendor: 'Sillage', type: t('Trousers', 'Pantalons'), tags: ['trousers', 'cotton'],
        title: t('Olive Chino Trousers', 'Pantalon chino olive'),
        description: t('Straight-leg chinos in brushed cotton twill, with a mid rise and a clean front. Olive that goes with everything.', 'Chinos coupe droite en sergé de coton gratté, taille mi-haute et devant épuré. Un olive qui va avec tout.'),
        options: [{ name: t('Size', 'Taille'), values: ['38', '40', '42', '44'] }],
        price: 79, variants: [{ stock: 13 }, { stock: 16 }, { stock: 8 }, { stock: 5 }],
      },
    ],
  },
};
