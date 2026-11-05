import type { enExt } from './en-ext';

export const frExt: Record<keyof typeof enExt, string> = {
  'nav.drafts': 'Brouillons',
  'store.blogPosts': 'Articles de blog', 'store.blogs': 'Blogs', 'store.redirects': 'Redirections d’URL',
  'settings.users': 'Utilisateurs et permissions', 'settings.notifications': 'Notifications', 'settings.policies': 'Politiques', 'settings.webhooks': 'Webhooks', 'settings.shopifyImport': 'Importer depuis Shopify',

  'themes.intro': 'Le thème en ligne s’affiche sur votre boutique. Personnalisez-le, ou importez-en un autre pour l’essayer.', 'themes.upload': 'Importer un zip', 'themes.uploaded': 'Thème importé',
  'themes.rename': 'Renommer', 'themes.renamed': 'Thème renommé', 'themes.duplicate': 'Dupliquer', 'themes.duplicated': 'Thème dupliqué', 'themes.download': 'Télécharger', 'themes.deleted': 'Thème supprimé',
  'themes.name': 'Nom du thème', 'themes.copyOf': 'Copie de {name}', 'themes.deleteTitle': 'Supprimer {name} ?', 'themes.deleteBody': 'Le thème et ses fichiers sont supprimés définitivement. Le thème en ligne ne peut pas être supprimé.',
  'themes.role.MAIN': 'En ligne', 'themes.role.UNPUBLISHED': 'Non publié', 'themes.role.DEMO': 'Démo', 'themes.role.DEVELOPMENT': 'Développement', 'themes.role.ARCHIVED': 'Archivé', 'themes.role.LOCKED': 'Verrouillé',

  'editor.tabSections': 'Sections', 'editor.tabSettings': 'Paramètres du thème', 'editor.template': 'Modèle', 'editor.undo': 'Annuler', 'editor.templateMissing': 'Ce modèle n’a pas pu être lu.',
  'editor.templateSections': 'Modèle : {name}', 'editor.addSection': 'Ajouter une section', 'editor.addBlock': 'Ajouter un bloc', 'editor.addBlockTo': 'Ajouter un bloc à {name}', 'editor.maxBlocks': 'Maximum de {n} blocs atteint',
  'editor.moveUp': 'Monter', 'editor.moveDown': 'Descendre', 'editor.show': 'Afficher', 'editor.hide': 'Masquer', 'editor.static': 'fixe', 'editor.settings': 'Paramètres',
  'editor.noSettings': 'Aucun paramètre pour cet élément.', 'editor.noPresets': 'Ce thème n’a aucune section pouvant être ajoutée.',

  'blogs.addPost': 'Ajouter un article', 'blogs.searchPosts': 'Rechercher des articles', 'blogs.emptyTitle': 'Aucun article pour le moment', 'blogs.emptyBody': 'Rédigez des articles pour partager vos actualités et raconter votre histoire.',
  'blogs.blog': 'Blog', 'blogs.author': 'Auteur', 'blogs.summary': 'Extrait', 'blogs.summaryHelp': 'Un court résumé affiché dans les listes d’articles.', 'blogs.image': 'Image mise en avant', 'blogs.imageAlt': 'Description de l’image',
  'blogs.organization': 'Organisation', 'blogs.saved': 'Article enregistré', 'blogs.notFound': 'Article introuvable.', 'blogs.blogRequired': 'Choisissez d’abord un blog.',
  'blogs.deletePostTitle': 'Supprimer cet article ?', 'blogs.deletePostBody': 'Cette action est irréversible.',
  'blogs.addBlog': 'Ajouter un blog', 'blogs.editBlog': 'Modifier le blog', 'blogs.blogSaved': 'Blog enregistré', 'blogs.blogDeleted': 'Blog supprimé', 'blogs.noBlogsTitle': 'Aucun blog pour le moment', 'blogs.noBlogsBody': 'Créez un blog pour commencer à publier des articles.',
  'blogs.deleteBlogTitle': 'Supprimer {name} ?', 'blogs.deleteBlogBody': 'Tous les articles de ce blog sont supprimés avec lui.',

  'redirects.add': 'Ajouter une redirection', 'redirects.edit': 'Modifier la redirection', 'redirects.from': 'Rediriger depuis', 'redirects.to': 'Rediriger vers', 'redirects.fromHelp': 'Commence par une barre oblique, par exemple /ancienne-page.', 'redirects.toHelp': 'Un chemin ou une URL complète.',
  'redirects.search': 'Rechercher des redirections', 'redirects.saved': 'Redirection enregistrée', 'redirects.deleted': 'Redirection supprimée', 'redirects.emptyTitle': 'Aucune redirection pour le moment', 'redirects.emptyBody': 'Envoyez les visiteurs d’une ancienne adresse vers une nouvelle pour ne casser aucun lien.', 'redirects.deleteTitle': 'Supprimer cette redirection ?',

  'draft.title': 'Commandes brouillons', 'draft.create': 'Créer une commande', 'draft.draft': 'Brouillon', 'draft.date': 'Date', 'draft.customer': 'Client', 'draft.total': 'Total', 'draft.search': 'Rechercher des brouillons',
  'draft.emptyTitle': 'Aucune commande brouillon', 'draft.emptyBody': 'Créez des commandes pour les ventes par téléphone ou en personne, puis envoyez une facture ou marquez-les comme payées.', 'draft.notFound': 'Commande brouillon introuvable.',
  'draft.status.OPEN': 'Ouvert', 'draft.status.INVOICE_SENT': 'Facture envoyée', 'draft.status.COMPLETED': 'Terminé',
  'draft.products': 'Produits', 'draft.addProduct': 'Parcourir les produits', 'draft.addCustom': 'Ajouter un article personnalisé', 'draft.add': 'Ajouter', 'draft.noLines': 'Aucun article pour le moment. Ajoutez un produit ou un article personnalisé.', 'draft.custom': 'Personnalisé',
  'draft.quantity': 'Quantité', 'draft.price': 'Prix', 'draft.adjustments': 'Remise et livraison', 'draft.discount': 'Ajouter une remise', 'draft.discountType': 'Type de remise', 'draft.discountValue': 'Valeur de la remise',
  'draft.shipping': 'Ajouter la livraison', 'draft.shippingDefault': 'Livraison', 'draft.shippingName': 'Nom de la livraison', 'draft.shippingPrice': 'Prix de la livraison', 'draft.payment': 'Paiement',
  'draft.row.subtotal': 'Sous-total', 'draft.row.discount': 'Remise', 'draft.row.shipping': 'Livraison', 'draft.row.tax': 'Taxes', 'draft.row.total': 'Total', 'draft.free': 'Gratuite', 'draft.estimate': 'Total estimé. Les taxes sont calculées à l’enregistrement du brouillon.',
  'draft.note': 'Note', 'draft.searchCustomer': 'Rechercher des clients', 'draft.saveDraft': 'Enregistrer le brouillon', 'draft.saved': 'Brouillon enregistré', 'draft.needLines': 'Ajoutez au moins un article.', 'draft.saveFirst': 'Enregistrez vos modifications pour envoyer la facture ou finaliser la commande.',
  'draft.sendInvoice': 'Envoyer la facture', 'draft.send': 'Envoyer', 'draft.invoiceTo': 'Envoyer à', 'draft.invoiceSent': 'Facture envoyée', 'draft.markPaid': 'Marquer comme payée', 'draft.paymentPending': 'Créer avec paiement en attente',
  'draft.completeTitle': 'Créer la commande', 'draft.completeBody': 'Le brouillon devient une commande. Marquez-la comme payée maintenant, ou créez-la avec un paiement en attente.', 'draft.completed': 'Commande créée',
  'draft.completedBanner': 'Ce brouillon a été finalisé en commande', 'draft.deleteTitle': 'Supprimer ce brouillon ?', 'draft.deleteBody': 'Cette action est irréversible.',

  'csv.import': 'Importer', 'csv.export': 'Exporter', 'csv.chooseFile': 'Choisir un fichier CSV', 'csv.title.products': 'Importer des produits', 'csv.title.customers': 'Importer des clients', 'csv.title.inventory': 'Importer l’inventaire',
  'csv.help.products': 'Importez un fichier CSV de produits. Nous le vérifions d’abord et affichons les problèmes avant toute modification.', 'csv.help.customers': 'Importez un fichier CSV de clients. Nous le vérifions d’abord et affichons les problèmes avant toute modification.',
  'csv.help.inventory': 'Importez un fichier CSV de quantités en stock. Nous le vérifions d’abord et affichons les problèmes avant toute modification.',
  'csv.checking': 'Vérification de {name}…', 'csv.previewTitle': 'Résultat de la vérification de {name}', 'csv.confirm': 'Importer', 'csv.importing': 'Importation en cours…', 'csv.done': 'Importation terminée.', 'csv.nothing': 'Aucune ligne ne peut être importée. Corrigez le fichier et choisissez-le à nouveau.',
  'csv.chooseAnother': 'Choisir un autre fichier', 'csv.errors': '{n} lignes avec des problèmes', 'csv.row': 'Ligne {n}',
  'csv.count.created': 'Créés', 'csv.count.updated': 'Mis à jour', 'csv.count.skipped': 'Ignorés', 'csv.count.errors': 'Erreurs', 'csv.count.imported': 'Importés', 'csv.count.failed': 'Échecs',

  'users.intro': 'Invitez des personnes à gérer votre boutique et choisissez ce à quoi elles ont accès.', 'users.invite': 'Inviter un utilisateur', 'users.sendInvite': 'Envoyer l’invitation', 'users.invited': 'Invitation envoyée', 'users.edit': 'Modifier l’utilisateur', 'users.saved': 'Utilisateur mis à jour',
  'users.role.owner': 'Propriétaire', 'users.role.admin': 'Administrateur', 'users.role.staff': 'Équipe', 'users.roleLabel': 'Rôle', 'users.adminHelp': 'Les administrateurs ont accès à tout, sauf à la propriété de la boutique.', 'users.permissions': 'Permissions',
  'users.perm.products': 'Produits, collections et inventaire', 'users.perm.orders': 'Commandes', 'users.perm.customers': 'Clients', 'users.perm.discounts': 'Réductions', 'users.perm.online_store': 'Boutique en ligne', 'users.perm.settings': 'Paramètres', 'users.perm.staff': 'Utilisateurs et permissions',
  'users.areas': '{n} domaines', 'users.inactive': 'Désactivé', 'users.deactivate': 'Désactiver', 'users.deactivated': 'Utilisateur désactivé', 'users.deactivateTitle': 'Désactiver cet utilisateur ?', 'users.deactivateBody': '{email} ne pourra plus se connecter.',
  'users.deleteTitle': 'Supprimer cet utilisateur ?', 'users.deleteBody': '{email} est supprimé définitivement.', 'users.deleted': 'Utilisateur supprimé',

  'notif.intro': 'Personnalisez les e-mails reçus par vos clients.', 'notif.customized': 'Personnalisé', 'notif.notFound': 'Modèle introuvable.', 'notif.template': 'Modèle', 'notif.subject': 'Objet', 'notif.body': 'Corps de l’e-mail (HTML et Liquid)',
  'notif.help': 'Utilisez des variables Liquid comme {{ customer.first_name }} et {{ order.name }}.', 'notif.preview': 'Aperçu', 'notif.previewSaved': 'L’aperçu montre la version enregistrée', 'notif.saved': 'Modèle enregistré',
  'notif.reset': 'Rétablir par défaut', 'notif.resetTitle': 'Rétablir ce modèle ?', 'notif.resetBody': 'Vos modifications sont remplacées par le modèle par défaut.', 'notif.resetDone': 'Modèle rétabli',

  'policies.REFUND_POLICY': 'Politique de remboursement', 'policies.PRIVACY_POLICY': 'Politique de confidentialité', 'policies.TERMS_OF_SERVICE': 'Conditions d’utilisation', 'policies.SHIPPING_POLICY': 'Politique d’expédition', 'policies.CONTACT_INFORMATION': 'Coordonnées',
  'policies.view': 'Voir sur la boutique', 'policies.saved': 'Politiques enregistrées', 'policies.cookies': 'Bandeau de cookies', 'policies.cookiesHelp': 'Demandez aux visiteurs d’accepter les cookies avant le lancement des outils d’analyse.', 'policies.cookiesEnable': 'Afficher un bandeau de cookies sur la boutique',
  'policies.footer': 'Les politiques sont liées depuis le pied de page de votre boutique et le paiement.',

  'hooks.intro': 'Envoyez une requête HTTP signée à votre serveur lorsqu’un événement se produit dans la boutique.', 'hooks.add': 'Ajouter un webhook', 'hooks.create': 'Créer le webhook', 'hooks.created': 'Webhook créé', 'hooks.deleted': 'Webhook supprimé',
  'hooks.empty': 'Aucun webhook pour le moment.', 'hooks.topic': 'Événement', 'hooks.url': 'URL du point de terminaison', 'hooks.signHelp': 'Chaque requête est signée avec le secret du webhook dans l’en-tête X-Shopify-Hmac-Sha256.',
  'hooks.showSecret': 'Afficher le secret', 'hooks.hideSecret': 'Masquer le secret', 'hooks.secret': 'Secret de signature', 'hooks.deliveries': 'Livraisons', 'hooks.deliveriesTitle': 'Livraisons pour {topic}', 'hooks.noDeliveries': 'Aucune livraison pour le moment.', 'hooks.deleteTitle': 'Supprimer ce webhook ?',

  'shopify.howTitle': 'Comment connecter votre boutique Shopify', 'shopify.step1': 'Dans l’administration Shopify, ouvrez Paramètres, puis Applications et canaux de vente, puis Développer des applications.',
  'shopify.step2': 'Créez une application et configurez les autorisations de l’API Admin : read_products, read_customers, read_orders, read_content et read_inventory.', 'shopify.step3': 'Installez l’application et affichez le jeton d’accès de l’API Admin (il commence par shpat_).',
  'shopify.step4': 'Collez le domaine de votre boutique et le jeton ci-dessous, puis lancez l’importation.', 'shopify.scopes': 'N’utilisez que des autorisations en lecture seule. Le jeton sert uniquement à cette importation et n’est pas conservé.',
  'shopify.formTitle': 'Connexion', 'shopify.domain': 'Domaine de la boutique', 'shopify.token': 'Jeton d’accès de l’API Admin', 'shopify.start': 'Lancer l’importation', 'shopify.running': 'Importation en cours', 'shopify.done': 'Importation terminée',
};
