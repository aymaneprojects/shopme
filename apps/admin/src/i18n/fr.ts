import { frCheckout } from './fr-checkout';
import { frCatalog } from './fr-catalog';
import { frContent } from './fr-content';
import { frPublishing } from './fr-publishing';
import type { Key } from './en';
import { frOrdersUx } from './fr-orders-ux';
import { frCommerce } from './fr-commerce';
import { frExt } from './fr-ext';
import { frPlatform } from './fr-platform';
import { frShop } from './fr-shop';
import { frSettings } from './fr-settings';
import { frUx } from './fr-ux';
import { frViews } from './fr-views';
import { frEditor } from './fr-editor';
import { frTimeline } from './fr-timeline';
import { frMarkets } from './fr-markets';

export const fr: Record<Key, string> = {
  'common.back': 'Retour', 'common.cancel': 'Annuler', 'common.close': 'Fermer', 'common.delete': 'Supprimer', 'common.loading': 'Chargement…',
  'common.moreActions': 'Plus d’actions', 'common.next': 'Suivant', 'common.previous': 'Précédent', 'common.remove': 'Retirer',
  'common.selectAll': 'Tout sélectionner', 'common.selected': '{n} sélectionnés', 'common.selected.one': '{n} sélectionné', 'common.sort': 'Trier',

  'field.description': 'Description', 'field.email': 'E-mail', 'field.firstName': 'Prénom', 'field.lastName': 'Nom', 'field.password': 'Mot de passe',
  'field.productType': 'Type', 'field.status': 'Statut', 'field.tags': 'Balises', 'field.title': 'Titre', 'field.vendor': 'Fournisseur',

  'nav.home': 'Accueil', 'nav.orders': 'Commandes', 'nav.products': 'Produits', 'nav.collections': 'Collections', 'nav.inventory': 'Stock',
  'nav.customers': 'Clients', 'nav.discounts': 'Réductions', 'nav.onlineStore': 'Boutique en ligne', 'nav.settings': 'Paramètres',
  'nav.menu': 'Ouvrir le menu', 'nav.notFound': 'Page introuvable',
  'shell.search': 'Rechercher', 'shell.searchPlaceholder': 'Rechercher', 'shell.account': 'Menu du compte', 'cmd.pages': 'Pages', 'cmd.products': 'Produits', 'cmd.orders': 'Commandes', 'cmd.customers': 'Clients', 'cmd.empty': 'Aucun résultat', 'cmd.hint': 'Saisissez pour rechercher', 'cmd.dismiss': 'Fermer', 'cmd.settings': 'Paramètres', 'theme.light': 'Thème clair', 'theme.dark': 'Thème sombre', 'theme.system': 'Suivre le système', 'shell.logout': 'Se déconnecter',

  'login.title': 'Connexion', 'login.subtitle': 'Connectez-vous pour gérer votre boutique.', 'login.submit': 'Se connecter', 'login.invalid': 'E-mail ou mot de passe incorrect.',
  'setup.title': 'Configurez votre boutique', 'setup.subtitle': 'Créez le compte propriétaire et les informations de base de la boutique.', 'setup.shopName': 'Nom de la boutique',
  'setup.currency': 'Devise', 'setup.country': 'Pays', 'setup.passwordHelp': 'Au moins 8 caractères.', 'setup.submit': 'Créer la boutique',

  'soon.title': 'Disponible dans la prochaine version', 'soon.body': 'Cette section n’est pas encore disponible. Elle est prévue dans une prochaine version.',
  'home.welcome': 'Bienvenue, {name}', 'home.orders': 'Commandes', 'home.sales': 'Ventes', 'home.products': 'Produits', 'home.soon': 'Bientôt',
  'home.setupTitle': 'Pour commencer', 'home.setupBody': 'Ajoutez votre premier produit depuis la page Produits, puis organisez-le en collections.',

  'save.unsaved': 'Modifications non enregistrées', 'save.save': 'Enregistrer', 'save.discard': 'Annuler les modifications', 'save.leaveTitle': 'Quitter sans enregistrer ?',
  'save.leaveBody': 'Vous avez des modifications non enregistrées. Si vous quittez cette page, elles seront perdues.', 'save.leave': 'Quitter la page', 'save.stay': 'Rester',

  'status.ACTIVE': 'Actif', 'status.DRAFT': 'Brouillon', 'status.ARCHIVED': 'Archivé', 'status.UNLISTED': 'Non listé',
  'sort.TITLE': 'Titre', 'sort.CREATED_AT': 'Création', 'sort.UPDATED_AT': 'Mise à jour', 'sort.INVENTORY_TOTAL': 'Stock', 'sort.PRODUCT_TYPE': 'Type', 'sort.VENDOR': 'Fournisseur',

  'products.add': 'Ajouter un produit', 'products.tabAll': 'Tous', 'products.product': 'Produit', 'products.inventory': 'Stock',
  'products.inStock': '{n} en stock pour {v} variantes', 'products.inStock.one': '{n} en stock pour {v} variante', 'products.notTracked': 'Stock non suivi', 'products.search': 'Rechercher des produits',
  'products.stockIn': 'En stock', 'products.stockOut': 'En rupture', 'products.count': '{n} produits', 'products.count.one': '{n} produit',
  'products.emptyTitle': 'Ajoutez votre premier produit', 'products.emptyBody': 'Les produits que vous ajoutez apparaîtront ici. Commencez par un titre, un prix et une photo.',
  'products.noResults': 'Aucun produit trouvé', 'products.noResultsBody': 'Essayez de modifier la recherche ou les filtres.', 'products.clearFilters': 'Effacer les filtres',
  'products.setActive': 'Passer en actif', 'products.setDraft': 'Passer en brouillon', 'products.setArchived': 'Archiver',
  'products.updated': '{n} produits mis à jour', 'products.updated.one': '{n} produit mis à jour', 'products.deleted': '{n} produits supprimés', 'products.deleted.one': '{n} produit supprimé', 'products.deleteTitle': 'Supprimer {n} produits ?', 'products.deleteTitle.one': 'Supprimer {n} produit ?',
  'products.deleteBody': 'Cette action est irréversible.',

  'product.addTitle': 'Ajouter un produit', 'product.untitled': 'Produit sans titre', 'product.notFound': 'Produit introuvable.', 'product.titlePlaceholder': 'T-shirt à manches courtes',
  'product.titleRequired': 'Le titre est obligatoire.', 'product.priceInvalid': 'Saisissez un prix valide (0 ou plus).', 'product.saved': 'Produit enregistré', 'product.saveFailed': 'Enregistrement impossible',
  'product.media': 'Médias', 'product.pricing': 'Tarification', 'product.inventory': 'Stock', 'product.shipping': 'Expédition', 'product.variants': 'Variantes',
  'product.seo': 'Aperçu dans les moteurs de recherche', 'product.seoTitle': 'Titre de la page', 'product.seoDescription': 'Méta-description', 'product.seoEmpty': 'Ajoutez une description pour voir l’aperçu de ce produit dans les résultats de recherche.',
  'product.handle': 'Identifiant d’URL', 'product.chars': '{n} caractères sur {max}', 'product.organization': 'Organisation du produit', 'product.addToCollection': 'Ajouter à une collection',
  'product.template': 'Modèle de thème', 'product.templateHelp': 'Suffixe du modèle, par exemple « alternate ». Laissez vide pour le modèle par défaut.',

  'product.deleteTitle': 'Supprimer ce produit ?',
  'media.upload': 'Ajouter des images (cliquer ou déposer des fichiers)', 'media.moveLeft': 'Déplacer avant', 'media.moveRight': 'Déplacer après', 'media.featured': 'Principale', 'media.alt': 'Texte alternatif',

  'pricing.price': 'Prix', 'pricing.compareAt': 'Prix avant réduction', 'pricing.cost': 'Coût par article', 'pricing.costHelp': 'Les clients ne verront pas cette information.',
  'pricing.chargeTax': 'Facturer la taxe sur ce produit', 'pricing.margin': 'Bénéfice : {profit} (marge {pct} %)',
  'inventory.track': 'Suivre la quantité', 'inventory.available': 'Disponible', 'inventory.sku': 'UGS', 'inventory.barcode': 'Code-barres (ISBN, UPC, GTIN)',
  'inventory.continueSelling': 'Continuer à vendre en cas de rupture de stock', 'inventory.committed': 'Engagé', 'inventory.onHand': 'En stock', 'inventory.noSku': 'Pas d’UGS',
  'inventory.location': 'Emplacement', 'inventory.allLocations': 'Tous les emplacements', 'inventory.search': 'Rechercher par produit ou UGS',
  'inventory.pickLocation': 'Choisissez un emplacement pour modifier les quantités disponibles.', 'inventory.saveN': 'Enregistrer {n} modifications', 'inventory.saveN.one': 'Enregistrer {n} modification', 'inventory.saved': 'Stock mis à jour',
  'inventory.emptyTitle': 'Aucun stock suivi', 'inventory.emptyBody': 'Les produits dont la quantité est suivie seront listés ici.',
  'shipping.physical': 'Il s’agit d’un produit physique', 'shipping.weight': 'Poids', 'shipping.unit': 'Unité',
  'unit.KILOGRAMS': 'kg', 'unit.GRAMS': 'g', 'unit.POUNDS': 'lb', 'unit.OUNCES': 'oz',

  'variants.addOptions': 'Ajouter des options comme la taille ou la couleur', 'variants.addAnotherOption': 'Ajouter une autre option', 'variants.optionName': 'Nom de l’option',
  'variants.optionNamePlaceholder': 'Taille', 'variants.optionValues': 'Valeurs de l’option', 'variants.valuesPlaceholder': 'Saisissez une valeur puis appuyez sur Entrée',
  'variants.removeOption': 'Retirer l’option', 'variants.count': '{n} variantes', 'variants.count.one': '{n} variante', 'variants.variant': 'Variante', 'variants.details': 'Afficher les détails',
  'variants.default': 'Par défaut', 'variants.remove': 'Retirer la variante',

  'collections.add': 'Ajouter une collection', 'collections.search': 'Rechercher des collections', 'collections.type': 'Type', 'collections.manual': 'Manuelle', 'collections.automated': 'Automatisée',
  'collections.conditions': 'Conditions', 'collections.emptyTitle': 'Créez votre première collection', 'collections.emptyBody': 'Regroupez des produits pour que vos clients les parcourent ensemble.',
  'collections.deleted': '{n} collections supprimées', 'collections.deleted.one': '{n} collection supprimée', 'collections.deleteTitle': 'Supprimer {n} collections ?', 'collections.deleteTitle.one': 'Supprimer {n} collection ?', 'collections.deleteBody': 'Les produits ne sont pas supprimés. Cette action est irréversible.',
  'collections.notFound': 'Collection introuvable.',
  'collection.addTitle': 'Ajouter une collection', 'collection.untitled': 'Collection sans titre', 'collection.titleRequired': 'Le titre est obligatoire.',
  'collection.rulesInvalid': 'Ajoutez au moins une condition complète.', 'collection.saved': 'Collection enregistrée', 'collection.type': 'Type de collection',
  'collection.manualHelp': 'Vous choisissez les produits qui appartiennent à cette collection.', 'collection.products': 'Produits ({n})', 'collection.addProducts': 'Ajouter des produits',
  'collection.manualEmpty': 'Aucun produit pour le moment. Ajoutez-en à cette collection.', 'collection.autoEmpty': 'Les produits correspondants apparaîtront ici une fois la collection enregistrée.',
  'collection.image': 'Image', 'collection.organization': 'Organisation', 'collection.sortOrder': 'Trier les produits par',
  'sortOrder.MANUAL': 'Manuellement', 'sortOrder.BEST_SELLING': 'Meilleures ventes', 'sortOrder.ALPHA_ASC': 'Titre de A à Z', 'sortOrder.ALPHA_DESC': 'Titre de Z à A',
  'sortOrder.PRICE_DESC': 'Prix décroissant', 'sortOrder.PRICE_ASC': 'Prix croissant', 'sortOrder.CREATED_DESC': 'Plus récents d’abord', 'sortOrder.CREATED': 'Plus anciens d’abord',

  'conditions.mustMatch': 'Les produits doivent correspondre à', 'conditions.all': 'toutes les conditions', 'conditions.any': 'au moins une condition', 'conditions.rule': 'Condition {n}',
  'conditions.field': 'Champ', 'conditions.relation': 'Opérateur', 'conditions.value': 'Valeur', 'conditions.remove': 'Retirer la condition', 'conditions.add': 'Ajouter une autre condition',
  'conditions.true': 'vrai', 'conditions.false': 'faux', 'conditions.and': 'et', 'conditions.or': 'ou',
  'column.TAG': 'Balise du produit', 'column.TITLE': 'Titre du produit', 'column.TYPE': 'Type de produit', 'column.VENDOR': 'Fournisseur du produit', 'column.VARIANT_PRICE': 'Prix',
  'column.VARIANT_COMPARE_AT_PRICE': 'Prix avant réduction', 'column.VARIANT_WEIGHT': 'Poids', 'column.VARIANT_INVENTORY': 'Stock',
  'column.VARIANT_TITLE': 'Titre de la variante', 'column.IS_PRICE_REDUCED': 'Le prix est réduit',
  'relation.EQUALS': 'est égal à', 'relation.NOT_EQUALS': 'n’est pas égal à', 'relation.GREATER_THAN': 'est supérieur à', 'relation.LESS_THAN': 'est inférieur à',
  'relation.STARTS_WITH': 'commence par', 'relation.ENDS_WITH': 'se termine par', 'relation.CONTAINS': 'contient', 'relation.NOT_CONTAINS': 'ne contient pas',
  'relation.IS_SET': 'est renseigné', 'relation.IS_NOT_SET': 'n’est pas renseigné',

  'picker.products': 'Ajouter des produits', 'picker.collections': 'Ajouter à des collections', 'picker.add': 'Ajouter ({n})', 'picker.none': 'Aucun produit trouvé.', 'picker.noneCollections': 'Aucune collection manuelle disponible.',

  'rte.bold': 'Gras', 'rte.italic': 'Italique', 'rte.underline': 'Souligné', 'rte.list': 'Liste à puces', 'rte.orderedList': 'Liste numérotée', 'rte.link': 'Lien',
  'rte.source': 'Source HTML', 'rte.paragraph': 'Paragraphe', 'rte.heading': 'Titre', 'rte.subheading': 'Sous-titre', 'rte.linkPrompt': 'URL du lien',
  ...frShop,
  ...frExt,
  ...frPlatform,
  ...frCommerce,
  ...frCatalog,
  ...frOrdersUx,
  ...frSettings,
  ...frUx,
  ...frEditor,
  ...frTimeline,
  ...frContent,
  ...frPublishing,
  ...frViews,
  ...frCheckout,
  ...frMarkets,
};
