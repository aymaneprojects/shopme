import type { enContent } from './en-content';

export const frContent: Record<keyof typeof enContent, string> = {
  'field.name': 'Nom', 'nav.segments': 'Segments', 'store.files': 'Fichiers', 'store.preferences': 'Préférences',
  'content.noResults': 'Aucun résultat', 'content.noResultsBody': 'Essayez de modifier la recherche ou les filtres.',
  'content.tab.all': 'Tout', 'content.tab.published': 'Visible', 'content.tab.unpublished': 'Masqué',
  'content.makeVisible': 'Rendre visible', 'content.makeHidden': 'Masquer', 'content.madeVisible': '{n} rendu(s) visible(s)', 'content.madeHidden': '{n} masqué(s)', 'content.deleted': '{n} supprimé(s)',
  'seo.title': 'Aperçu dans les moteurs de recherche', 'seo.edit': 'Modifier l’aperçu', 'seo.empty': 'Ajoutez un titre et du contenu pour voir comment cette page pourrait apparaître dans les résultats de recherche.',

  'customers.language': 'Langue', 'customers.languageHelp': 'Ce client recevra les notifications dans cette langue.',
  'customers.consentNotice': 'Demandez l’autorisation de vos clients avant de les abonner à vos e-mails marketing.', 'customers.addAddress': 'Ajouter une adresse',
  'customers.createOrder': 'Créer une commande', 'customers.editContact': 'Modifier les coordonnées', 'customers.copyEmail': 'Copier l’adresse e-mail', 'customers.copied': 'Copié dans le presse-papiers',
  'customers.previous': 'Client précédent', 'customers.next': 'Client suivant',

  'segments.create': 'Créer un segment', 'segments.search': 'Rechercher des segments', 'segments.share': '% des clients', 'segments.lastActivity': 'Dernière activité', 'segments.createdBy': 'Créé par',
  'segments.edited': 'Modifié le {date}', 'segments.builtIn': 'Intégré', 'segments.you': 'Vous', 'segments.sort.recent': 'Dernière activité', 'segments.sort.name': 'Nom',
  'segments.deleted': '{n} segment(s) supprimé(s)', 'segments.deleteTitle': 'Supprimer {n} segment(s) ?', 'segments.deleteBody': 'Les clients ne sont pas supprimés, seulement le filtre enregistré.',
  'segments.builtin.purchased': 'Clients ayant acheté au moins une fois', 'segments.builtin.subscribers': 'Abonnés aux e-mails',
  'segments.builtin.repeat': 'Clients ayant acheté plus d’une fois', 'segments.builtin.never': 'Clients n’ayant jamais acheté',
  'segments.builtInHelp': 'Ce segment est intégré et toujours à jour. Créez votre propre segment pour enregistrer un autre filtre.',
  'segments.conditions': 'Conditions', 'segments.any': 'Peu importe', 'segments.orders': 'Commandes', 'segments.orders.none': 'N’a jamais acheté', 'segments.orders.any': 'A acheté au moins une fois', 'segments.orders.repeat': 'A acheté plus d’une fois',
  'segments.countryHelp': 'Code ou nom du pays, ex. FR', 'segments.since': 'Client depuis', 'segments.other': 'Autres termes de recherche', 'segments.otherHelp': 'Même syntaxe que la recherche de clients, ex. email:@example.com',
  'segments.allCustomers': 'Tous les clients', 'segments.preview': 'Clients correspondants', 'segments.noMatch': 'Aucun client ne correspond à ces conditions.', 'segments.details': 'Détails du segment',
  'segments.nameRequired': 'Donnez un nom au segment.', 'segments.saved': 'Segment enregistré', 'segments.notFound': 'Segment introuvable.', 'segments.untitled': 'Segment sans titre', 'segments.viewCustomers': 'Voir les clients',

  'giftCards.create': 'Créer une carte cadeau', 'giftCards.addProduct': 'Ajouter un produit carte cadeau', 'giftCards.viewProducts': 'Afficher les produits cartes cadeaux',
  'giftCards.codeEnding': 'Code se terminant par', 'giftCards.noRecipient': 'Aucun destinataire', 'giftCards.created': 'Création', 'giftCards.currentInitial': 'Courant / initial',
  'giftCards.customerSearch': 'Rechercher ou créer un client', 'giftCards.createCustomer': 'Créer un nouveau client', 'giftCards.noExpiry': 'N’expire pas', 'giftCards.amountRequired': 'Saisissez une valeur initiale supérieure à zéro.',

  'pages.search': 'Rechercher des pages', 'pages.addTitle': 'Créer une page', 'pages.titlePlaceholder': 'ex. : à propos, guide des tailles, FAQ', 'pages.viewOnStore': 'Voir dans la boutique',
  'pages.deleteManyTitle': 'Supprimer {n} page(s) ?',
  'access.restricted': 'Accès restreint à la boutique', 'access.restrictedBody': 'Seuls les visiteurs disposant du mot de passe peuvent voir votre boutique en ligne.', 'access.manage': 'Gérer l’accès',

  'menus.create': 'Créer un menu', 'menus.searchMenus': 'Rechercher des menus', 'menus.emptyList': 'Aucun menu trouvé', 'menus.namePlaceholder': 'ex. : menu latéral', 'menus.handle': 'Identifiant', 'menus.notFound': 'Menu introuvable.',

  'blogs.manage': 'Gérer les blogs', 'blogs.titlePlaceholder': 'ex. : article sur nos derniers produits', 'blogs.addImage': 'Ajouter une image (cliquer ou déposer)', 'blogs.deleteManyTitle': 'Supprimer {n} article(s) ?',

  'files.add': 'Importer des fichiers', 'files.name': 'Nom du fichier', 'files.alt': 'Texte alternatif', 'files.added': 'Date d’ajout', 'files.dimensions': 'Dimensions', 'files.search': 'Rechercher des fichiers',
  'files.type': 'Type de fichier', 'files.type.all': 'Tous', 'files.type.image': 'Images', 'files.type.video': 'Vidéos', 'files.emptyTitle': 'Aucun fichier', 'files.emptyBody': 'Importez des images et des vidéos pour les utiliser dans votre boutique.',
  'files.uploaded': '{n} fichier(s) importé(s)', 'files.saved': 'Fichier enregistré', 'files.deleted': '{n} fichier(s) supprimé(s)', 'files.copied': 'Lien copié', 'files.copyLink': 'Copier le lien',
  'files.deleteTitle': 'Supprimer {n} fichier(s) ?', 'files.deleteBody': 'Les fichiers encore utilisés par des produits ou des pages y apparaîtront comme manquants.',

  'prefs.access': 'Accès à la boutique', 'prefs.passwordMode': 'Protection par mot de passe', 'prefs.passwordModeHelp': 'Affiche une page de mot de passe devant votre boutique en ligne tant que les visiteurs ne l’ont pas saisi.',
  'prefs.message': 'Message à vos visiteurs', 'prefs.charsUsed': '{n} caractères utilisés sur {max}', 'prefs.seo': 'Page d’accueil', 'prefs.homeDescription': 'Méta-description', 'prefs.homeDescriptionHelp': 'Affichée dans les résultats de recherche pour votre page d’accueil.', 'prefs.saved': 'Préférences enregistrées',
};
