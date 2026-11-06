// Pelage: pets. Sage and ochre, friendly and soft.
const t = (en, fr) => ({ en, fr });

export default {
  handle: 'pelage',
  name: 'Pelage',
  version: '1.0.0',
  date: '2026-11-06',
  header: { layout: 'split', sticky: true },
  card: { style: 'rounded', ratio: 'square', align: 'left', quickAdd: false },
  product: {
    layout: 'stacked', ratio: 'square',
    benefits: [
      { icon: 'heart', text: t('Tail-wag approved by our own dogs and cats', 'Approuvé par nos propres chiens et chats') },
      { icon: 'truck', text: t('Delivered in 2 to 4 days', 'Livré en 2 à 4 jours') },
      { icon: 'refresh', text: t('They do not like it? Return it within 30 days', 'Il ne l’aime pas ? Retournez-le sous 30 jours') },
    ],
  },
  collection: { layout: 'sidebar', columns: 3, perPage: 12, infiniteScroll: false },
  fonts: { heading: 'dm-sans', body: 'inter', accent: 'lora' },
  type: { h1: 360, h2: 250, headingWeight: 700, h1LineHeight: 108, lineHeight: 165, baseSize: 16 },
  colors: {
    accent: '#9a6516', background: '#f6f3ea', surface: '#e6e9d8', card: '#fffdf6', text: '#2c3327', sale: '#b23a22',
    swatchColors: 'Sage:#a7b79a,Sauge:#a7b79a,Ochre:#cf9a3c,Ocre:#cf9a3c,Oat:#e2d7bd,Avoine:#e2d7bd,Charcoal:#3b3f3a,Anthracite:#3b3f3a,Tan:#b98a5a,Fauve:#b98a5a,Cream:#efe8d5,Crème:#efe8d5',
    schemes: [
      { name: 'Oat', background: '#f6f3ea', text: '#2c3327', surface: '#e6e9d8', card: '#fffdf6', border: '#dcdcc6', button: '#2f4a2c', button_label: '#fffdf6' },
      { name: 'Sage', background: '#cdd8bf', text: '#26301f', surface: '#bfcdaf', card: '#dde6d1', border: '#a9bb97', button: '#26301f', button_label: '#eef2e4' },
      { name: 'Ochre', background: '#e8bf6e', text: '#3a2a0c', surface: '#dfb258', card: '#f0cf8d', border: '#c99a3c', button: '#3a2a0c', button_label: '#f6e6bd' },
      { name: 'Forest', background: '#34492f', text: '#f6f3ea', surface: '#3f573a', card: '#3f573a', border: '#5a7453', button: '#e8bf6e', button_label: '#2c2108' },
    ],
  },
  scale: { radius: 'round', spacing: 'regular', pageWidth: 1260 },
  buttons: { uppercase: false, height: 50, border: 0 },
  announcement: { text: t('Free delivery from 45 and 10% off every refill', 'Livraison offerte dès 45 et 10 % sur chaque réassort'), scheme: 'scheme-4' },
  footerScheme: 'scheme-4',
  sections: ['pet-tiles', 'refill-highlight'],
  features: { breadcrumbs: true, backToTop: true, stockCounter: true, stockThreshold: 8 },
  freeShipping: 45,
  home: [
    {
      id: 'hero', type: 'hero',
      settings: {
        layout: 'split', color_scheme: 'scheme-2',
        eyebrow: t('For pets and the people they own', 'Pour les animaux et leurs humains'),
        heading: t('Good things for good dogs and cats', 'De bonnes choses pour les bons chiens et chats'),
        text: t('Sturdy beds, honest food and toys that survive a Tuesday. Chosen with vets, tested by our own pets.', 'Des paniers solides, une nourriture honnête et des jouets qui survivent à un mardi. Choisis avec des vétérinaires, testés par nos propres animaux.'),
        button_label: t('Shop all', 'Tout voir'), button_link: '/collections/all',
        button_2_label: t('Shop by pet', 'Par animal'), button_2_link: '/collections',
      },
      blocks: [
        { type: 'chip', settings: { icon: 'heart', text: t('Vet approved', 'Validé par des vétérinaires') } },
        { type: 'chip', settings: { icon: 'leaf', text: t('Natural materials', 'Matières naturelles') } },
        { type: 'chip', settings: { icon: 'refresh', text: t('Refills on repeat', 'Réassort récurrent') } },
      ],
    },
    {
      id: 'pets', type: 'pet-tiles',
      settings: { eyebrow: t('Shop by pet', 'Par animal'), heading: t('Who are we shopping for?', 'Pour qui faisons-nous les courses ?'), color_scheme: '' },
      blocks: [
        { type: 'pet', settings: { title: t('For dogs', 'Pour chiens'), text: t('Beds, leads, bowls and tough toys.', 'Paniers, laisses, gamelles et jouets solides.'), link: '/collections/dogs', product: 'dog-bed' } },
        { type: 'pet', settings: { title: t('For cats', 'Pour chats'), text: t('Climb, scratch, nap, repeat.', 'Grimper, griffer, dormir, recommencer.'), link: '/collections/cats', product: 'cat-tree' } },
      ],
    },
    { id: 'favourites', type: 'featured-collection', settings: { eyebrow: t('Pet favourites', 'Les préférés'), heading: t('Treats for the whole household', 'Des gâteries pour toute la maison'), text: t('The things our customers reorder most.', 'Ce que nos clients recommandent le plus.'), collection: 'all', products_to_show: 6, columns: '3', show_view_all: true, color_scheme: 'scheme-1' } },
    {
      id: 'refill', type: 'refill-highlight',
      settings: { eyebrow: t('Never run out', 'Jamais à court'), heading: t('Dinner on repeat, delivered on time', 'Le dîner en boucle, livré à l’heure'), text: t('Pick the rhythm that matches how fast your pet eats. Change it, skip a box or stop any time.', 'Choisissez le rythme qui correspond à l’appétit de votre animal. Changez-le, sautez un colis ou arrêtez à tout moment.'), product: 'grain-free-kibble', button_label: t('Choose a delivery rhythm', 'Choisir un rythme de livraison'), color_scheme: 'scheme-3' },
      blocks: [
        { type: 'perk', settings: { icon: 'tag', text: t('Save on every delivery', 'Économisez à chaque livraison') } },
        { type: 'perk', settings: { icon: 'truck', text: t('Free delivery on refills', 'Livraison offerte sur les réassorts') } },
        { type: 'perk', settings: { icon: 'clock', text: t('Skip, pause or cancel any time', 'Sautez, suspendez ou annulez à tout moment') } },
      ],
    },
    {
      id: 'vet', type: 'image-with-text',
      settings: {
        layout: 'right', color_scheme: 'scheme-1',
        eyebrow: t('Vet approved', 'Validé par des vétérinaires'),
        heading: t('Chosen with people who know animals', 'Choisi avec ceux qui connaissent les animaux'),
        text: t('<p>Every food, bed and toy is reviewed by a vet before it joins the shop. We look at ingredients, stitching, stuffing and what happens when a puppy gets hold of it.</p>', '<p>Chaque aliment, panier et jouet est examiné par un vétérinaire avant d’entrer en boutique. Nous regardons les ingrédients, les coutures, le rembourrage et ce qui se passe quand un chiot s’en empare.</p>'),
        button_label: t('Our standards', 'Nos exigences'), button_link: '/pages/vet-approved', product: 'rope-toy',
      },
    },
    {
      id: 'reviews', type: 'testimonials',
      settings: { heading: t('Said by owners', 'Dit par les propriétaires'), color_scheme: 'scheme-2' },
      blocks: [
        { type: 'testimonial', settings: { quote: t('The bed is thick and washable and our old lab finally sleeps through the night.', 'Le panier est épais et lavable, et notre vieux labrador dort enfin toute la nuit.'), name: 'Hélène M.', detail: t('Washable dog bed', 'Panier lavable pour chien'), rating: 5 } },
        { type: 'testimonial', settings: { quote: t('The cat tree is small enough for our flat and she has claimed every level already.', 'L’arbre à chat est assez petit pour notre appartement et elle a déjà adopté tous les niveaux.'), name: 'Paul V.', detail: t('Compact cat tree', 'Arbre à chat compact'), rating: 5 } },
        { type: 'testimonial', settings: { quote: t('The kibble subscription arrives every five weeks and I have not thought about it since.', 'Les croquettes arrivent toutes les cinq semaines et je n’y ai plus pensé depuis.'), name: 'Aurélie D.', detail: t('Grain-free kibble', 'Croquettes sans céréales'), rating: 5 } },
      ],
    },
    {
      id: 'faq', type: 'collapsible-content', settings: { heading: t('Before you order', 'Avant de commander'), open_first: true, color_scheme: '' },
      blocks: [
        { type: 'row', settings: { question: t('How do I change my refill rhythm?', 'Comment changer le rythme de mon réassort ?'), answer: t('<p>Open your account, pick the subscription and choose a new rhythm. You can also skip the next delivery or stop it.</p>', '<p>Ouvrez votre compte, choisissez l’abonnement et sélectionnez un nouveau rythme. Vous pouvez aussi sauter la prochaine livraison ou l’arrêter.</p>') } },
        { type: 'row', settings: { question: t('How do I choose the right bed size?', 'Comment choisir la bonne taille de panier ?'), answer: t('<p>Measure your dog from nose to base of tail while they sleep stretched out, then add 10 cm.</p>', '<p>Mesurez votre chien du nez à la base de la queue quand il dort allongé, puis ajoutez 10 cm.</p>') } },
        { type: 'row', settings: { question: t('Can I return opened food?', 'Puis-je retourner de la nourriture ouverte ?'), answer: t('<p>If your pet will not eat it, tell us within 14 days and we refund the bag, opened or not.</p>', '<p>Si votre animal n’en veut pas, prévenez-nous sous 14 jours et nous remboursons le sachet, ouvert ou non.</p>') } },
      ],
    },
    { id: 'newsletter', type: 'newsletter', settings: { heading: t('Pet post', 'Courrier des animaux'), text: t('New arrivals, care tips and 10% off your first order.', 'Nouveautés, conseils de soin et 10 % sur votre première commande.'), button_label: t('Subscribe', 'S’abonner'), color_scheme: 'scheme-3' } },
  ],
  templates: {
    'page.vet-approved': [
      { id: 'refill', type: 'refill-highlight', settings: { eyebrow: t('Vet approved', 'Validé par des vétérinaires'), heading: t('How we choose and how we refill', 'Comment nous choisissons et réassortissons'), text: t('A vet reviews every product, and the food you use daily can arrive on repeat.', 'Un vétérinaire examine chaque produit, et la nourriture du quotidien peut arriver en boucle.'), product: 'grain-free-kibble', button_label: t('See the food', 'Voir la nourriture'), color_scheme: 'scheme-1' }, blocks: [
        { type: 'perk', settings: { icon: 'heart', text: t('Reviewed by a vet before it is listed', 'Examiné par un vétérinaire avant d’être référencé') } },
        { type: 'perk', settings: { icon: 'tag', text: t('Save on every delivery', 'Économisez à chaque livraison') } },
        { type: 'perk', settings: { icon: 'clock', text: t('Skip, pause or cancel any time', 'Sautez, suspendez ou annulez à tout moment') } },
      ] },
    ],
  },
  css: `
.k-section__title { font-weight: 700; letter-spacing: -.02em; }
.k-hero__heading { letter-spacing: -.03em; max-width: 14ch; }
.k-card__title { font-weight: 600; }
.k-grid { gap: 40px 24px; }
.k-announce { font-size: .86rem; font-weight: 600; }
.k-quote { border: 1px solid var(--v-line); box-shadow: none; }
.k-footer { border-top-left-radius: 40px; border-top-right-radius: 40px; margin-top: 32px; }
`,
  info: {
    description: t(
      'A friendly storefront for pet shops: sage and ochre colour schemes, a split header, soft rounded tiles, shop by pet, a refill highlight that puts a subscription forward and a product page with the photos in a column.',
      'Une boutique conviviale pour les animaleries : palettes sauge et ocre, en-tête scindé, tuiles arrondies douces, achat par animal, mise en avant du réassort par abonnement et page produit avec les photos en colonne.',
    ),
    tags: ['Pets', 'Friendly', 'Subscriptions'],
    industries: ['pets'],
    catalogSize: 'some',
  },
  changelog: [
    t('First release of Pelage, a friendly theme for pets in sage and ochre.', 'Première version de Pelage, un thème convivial pour les animaux de compagnie en sauge et ocre.'),
    t('Split header with the menu on both sides of the logo, a search panel and a slide-in bag with a free shipping progress bar.', 'En-tête scindé avec le menu de part et d’autre du logo, panneau de recherche et panier latéral avec barre de progression vers la livraison offerte.'),
    t('Soft rounded product tiles with a second photo and colour swatches.', 'Tuiles produit arrondies et douces avec seconde photo et pastilles de couleur.'),
    t('Product page with every photo in a column, options, subscriptions and a low stock message.', 'Page produit avec toutes les photos en colonne, options, abonnements et message de stock faible.'),
    t('Collection page with filters in a side column, sorting and pagination.', 'Page collection avec filtres en colonne latérale, tri et pagination.'),
    t('New sections: shop by pet, refill highlight that uses the purchase options, and a countdown timer.', 'Nouvelles sections : acheter par animal, réassort en vedette qui utilise les options d’achat, et compte à rebours.'),
    t('Breadcrumbs, back to top button and an optional age check.', 'Fil d’Ariane, bouton retour en haut et vérification d’âge facultative.'),
    t('Section names, settings and storefront texts are translated to English and French.', 'Les noms des sections, les réglages et les textes de la boutique sont traduits en anglais et en français.'),
  ],
  demo: {
    currency: 'EUR',
    homeImages: { hero: { image: 'hero.webp' }, 'pets.pet-2': { image: 'ambiance.webp' } },
    menu: [
      { title: t('Shop all', 'Tout voir'), url: '/collections/all' },
      { title: t('Dogs', 'Chiens'), url: '/collections/dogs' },
      { title: t('Cats', 'Chats'), url: '/collections/cats' },
      { title: t('Bowls and food', 'Gamelles et nourriture'), url: '/collections/bowls-and-food' },
    ],
    footerMenu: [
      { title: t('Shop all', 'Tout voir'), url: '/collections/all' },
      { title: t('Vet approved', 'Validé par des vétérinaires'), url: '/pages/vet-approved' },
      { title: t('Search', 'Recherche'), url: '/search' },
    ],
    pages: [{ handle: 'vet-approved', title: t('Vet approved', 'Validé par des vétérinaires'), template: 'vet-approved' }],
    collections: [
      { handle: 'dogs', title: t('Dogs', 'Chiens'), description: t('Beds, leads and toys that stand up to enthusiasm.', 'Paniers, laisses et jouets qui résistent à l’enthousiasme.'), products: ['dog-bed', 'leather-lead', 'rope-toy'] },
      { handle: 'cats', title: t('Cats', 'Chats'), description: t('Somewhere to climb, scratch and sleep.', 'Un endroit pour grimper, griffer et dormir.'), products: ['cat-tree'] },
      { handle: 'bowls-and-food', title: t('Bowls and food', 'Gamelles et nourriture'), description: t('Heavy bowls and food they will finish.', 'Des gamelles lourdes et une nourriture qu’ils finiront.'), products: ['ceramic-bowl', 'grain-free-kibble'] },
    ],
    products: [
      {
        handle: 'dog-bed', image: 'produit-01.webp', extraImages: ['ambiance.webp'], vendor: 'Pelage', type: t('Beds', 'Paniers'), tags: ['dogs', 'bed', 'new'],
        title: t('Washable Dog Bed', 'Panier lavable pour chien'),
        description: t('A deep, supportive bed with a removable cover in tough woven fabric. The cover goes in the washing machine and the base keeps its shape.', 'Un panier profond et enveloppant avec une housse amovible en tissu tissé résistant. La housse passe en machine et la base garde sa forme.'),
        options: [{ name: t('Size', 'Taille'), values: ['M', 'L'] }, { name: t('Colour', 'Couleur'), values: [t('Sage', 'Sauge'), t('Oat', 'Avoine')] }],
        price: 79, variants: [{ stock: 12 }, { stock: 7 }, { stock: 9 }, { stock: 4 }],
      },
      {
        handle: 'ceramic-bowl', image: 'produit-02.webp', vendor: 'Pelage', type: t('Bowls', 'Gamelles'), tags: ['bowl', 'dogs', 'cats'],
        title: t('Ceramic Bowl', 'Gamelle en céramique'),
        description: t('A heavy glazed bowl that does not slide across the floor. Dishwasher safe, with a wide base and a gently sloped inside.', 'Une gamelle lourde et émaillée qui ne glisse pas sur le sol. Passe au lave-vaisselle, base large et intérieur légèrement incliné.'),
        options: [{ name: t('Size', 'Taille'), values: [t('Small', 'Petit'), t('Large', 'Grand')] }, { name: t('Colour', 'Couleur'), values: [t('Ochre', 'Ocre'), t('Sage', 'Sauge')] }],
        price: 22, compareAt: 27, variants: [{ stock: 30 }, { stock: 15 }, { stock: 22 }, { stock: 6 }],
      },
      {
        handle: 'leather-lead', image: 'produit-03.webp', vendor: 'Pelage', type: t('Leads', 'Laisses'), tags: ['dogs', 'lead', 'leather'],
        title: t('Leather Lead', 'Laisse en cuir'),
        description: t('A soft vegetable-tanned leather lead that gets better with use. Solid brass clip and a comfortable loop handle.', 'Une laisse en cuir tanné végétal qui s’assouplit à l’usage. Mousqueton en laiton massif et poignée confortable.'),
        options: [{ name: t('Length', 'Longueur'), values: ['1,2 m', '1,8 m'] }, { name: t('Colour', 'Couleur'), values: [t('Tan', 'Fauve'), t('Charcoal', 'Anthracite')] }],
        price: 34, variants: [{ stock: 14 }, { stock: 9 }, { stock: 11 }, { stock: 5 }],
      },
      {
        handle: 'rope-toy', image: 'produit-04.webp', vendor: 'Pelage', type: t('Toys', 'Jouets'), tags: ['dogs', 'toy'],
        title: t('Rope Toy', 'Jouet en corde'),
        description: t('A knotted cotton rope for tugging and chewing. Strong, washable and kind to teeth and gums.', 'Une corde en coton nouée pour tirer et mâchouiller. Solide, lavable et douce pour les dents et les gencives.'),
        options: [{ name: t('Size', 'Taille'), values: [t('Small', 'Petit'), t('Large', 'Grand')] }],
        price: 12, variants: [{ stock: 40 }, { stock: 25 }],
      },
      {
        handle: 'cat-tree', image: 'produit-05.webp', vendor: 'Pelage', type: t('Cat furniture', 'Mobilier pour chats'), tags: ['cats', 'furniture'],
        title: t('Compact Cat Tree', 'Arbre à chat compact'),
        description: t('A small cat tree for small homes with two sisal posts, a cosy cave and a top perch. Stable, with a wide base.', 'Un petit arbre à chat pour les petits logements avec deux poteaux en sisal, une niche douillette et un perchoir. Stable, base large.'),
        options: [{ name: t('Colour', 'Couleur'), values: [t('Oat', 'Avoine'), t('Sage', 'Sauge')] }],
        price: 89, compareAt: 109, variants: [{ stock: 8 }, { stock: 5 }],
      },
      {
        handle: 'grain-free-kibble', image: 'produit-06.webp', vendor: 'Pelage', type: t('Food', 'Nourriture'), tags: ['food', 'dogs', 'refill'],
        title: t('Grain-Free Kibble', 'Croquettes sans céréales'),
        description: t('A complete grain-free kibble with chicken and sweet potato, made with a vet nutritionist. Available as a one-off bag or on subscription.', 'Des croquettes complètes sans céréales au poulet et à la patate douce, conçues avec un vétérinaire nutritionniste. En sachet ponctuel ou par abonnement.'),
        options: [{ name: t('Bag', 'Sachet'), values: ['2 kg', '7 kg'] }],
        price: 29, variants: [{ stock: 36 }, { stock: 18 }],
      },
    ],
  },
};
