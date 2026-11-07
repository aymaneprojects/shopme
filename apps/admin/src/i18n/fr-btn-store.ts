import type { enBtnStore } from './en-btn-store';

export const frBtnStore: Record<keyof typeof enBtnStore, string> = {
  // top bar menu
  'bs.editCode': 'Modifier le code', 'bs.editContent': 'Modifier le contenu de thème par défaut', 'bs.docs': 'Afficher la documentation',
  // preview data
  'bs.preview.title': 'Données d’aperçu', 'bs.preview.intro': 'Choisissez ce que l’aperçu affiche. Cela ne change que votre affichage.',
  'bs.preview.product': 'Produit', 'bs.preview.collection': 'Collection', 'bs.preview.page': 'Page', 'bs.preview.article': 'Article',
  'bs.preview.language': 'Langue', 'bs.preview.country': 'Pays (marché)', 'bs.preview.countryHelp': 'Comme un visiteur qui choisit un pays : les prix et la devise suivent son marché.',
  'bs.preview.first': 'Premier de la boutique', 'bs.preview.default': 'Réglage de la boutique', 'bs.preview.unpublished': 'non publiée', 'bs.preview.reset': 'Réinitialiser les données d’aperçu',
  // setting fields
  'bs.color.reset': 'Effacer la couleur', 'bs.link.open': 'Ouvrir le lien dans un nouvel onglet', 'bs.pick.none': 'Aucun', 'bs.video.upload': 'Téléverser une vidéo',
  'bs.free.browse': 'Images libres de droits', 'bs.free.title': 'Images libres de droits', 'bs.free.intro': 'Des arrière-plans abstraits fournis avec ShopMe, libres d’utilisation. Celui que vous choisissez est copié dans vos fichiers.', 'bs.free.use': 'Utiliser l’image {n}',
  'bs.free.loadError': 'Impossible de charger cette image. Veuillez réessayer.',
  'bs.schemes.add': 'Ajouter une palette de couleurs', 'bs.schemes.duplicate': 'Dupliquer cette palette', 'bs.schemes.delete': 'Supprimer cette palette', 'bs.schemes.lastOne': 'Un thème garde au moins une palette', 'bs.schemes.inherit': 'Couleurs du thème',
  // dynamic sources
  'bs.src.connect': 'Connecter une source dynamique', 'bs.src.connected': 'Affiche des données de la page', 'bs.src.clear': 'Déconnecter la source dynamique',
  'bs.src.shopName': 'Nom de la boutique', 'bs.src.productTitle': 'Titre du produit', 'bs.src.productVendor': 'Fournisseur du produit', 'bs.src.productType': 'Type de produit', 'bs.src.productPrice': 'Prix du produit', 'bs.src.productDescription': 'Description du produit',
  'bs.src.collectionTitle': 'Titre de la collection', 'bs.src.collectionDescription': 'Description de la collection', 'bs.src.collectionCount': 'Nombre de produits de la collection',
  'bs.src.articleTitle': 'Titre de l’article', 'bs.src.articleAuthor': 'Auteur de l’article', 'bs.src.articleExcerpt': 'Extrait de l’article', 'bs.src.articleDate': 'Date de l’article', 'bs.src.blogTitle': 'Titre du blog', 'bs.src.pageTitle': 'Titre de la page',
  // code editor
  'bs.code.back': 'Retour à l’éditeur de thème', 'bs.code.files': 'Fichiers du thème', 'bs.code.search': 'Rechercher un fichier', 'bs.code.noFiles': 'Aucun fichier ne correspond.',
  'bs.code.addIn': 'Ajouter un fichier dans {dir}', 'bs.code.addTitle': 'Ajouter un fichier', 'bs.code.folder': 'Dossier', 'bs.code.fileName': 'Nom du fichier', 'bs.code.fileNameHint': 'ma-section', 'bs.code.create': 'Créer le fichier',
  'bs.code.err.dir': 'Choisissez l’un des dossiers du thème.', 'bs.code.err.name': 'Utilisez des lettres, des chiffres, des tirets, des tirets bas et des points (pas d’espaces).', 'bs.code.err.ext': 'Ce type de fichier ne peut pas être modifié ici, ou le type ne peut pas changer.', 'bs.code.err.exists': 'Un fichier portant ce nom existe déjà.',
  'bs.code.renameTitle': 'Renommer le fichier', 'bs.code.deleteTitle': 'Supprimer {name} ?', 'bs.code.deleteBody': 'Le fichier est retiré de ce thème. Vous pouvez le récupérer depuis son historique, dans la liste des fichiers supprimés.',
  'bs.code.deletedFiles': 'Fichiers supprimés', 'bs.code.restoreDeleted': 'Récupérer le fichier avec son dernier texte', 'bs.code.restoredDeleted': 'Le fichier est de retour dans l’éditeur. Enregistrez pour l’ajouter à nouveau.',
  'bs.code.closeTitle': 'Fermer sans enregistrer ?', 'bs.code.closeBody': 'Vos modifications de {name} seront perdues.', 'bs.code.closeDiscard': 'Abandonner les modifications',
  'bs.code.openFiles': 'Fichiers ouverts', 'bs.code.editor': 'Éditeur de code', 'bs.code.pick': 'Choisissez un fichier à modifier.', 'bs.code.loadFailed': 'Le fichier n’a pas pu être chargé.', 'bs.code.unsaved': 'Modifications non enregistrées',
  'bs.code.binary': 'Ceci est un fichier binaire ({size}). Il ne peut pas être modifié ici ; téléversez une nouvelle version depuis les fichiers du thème.',
  'bs.code.saved': 'Fichiers du thème enregistrés', 'bs.code.saveAll': 'Enregistrer {n} fichiers',
  'bs.code.errors': '{n} erreurs', 'bs.code.errors.one': '{n} erreur', 'bs.code.warnings': '{n} avertissements', 'bs.code.warnings.one': '{n} avertissement', 'bs.code.noProblems': 'Aucun problème', 'bs.code.problems': 'Problèmes',
  'bs.code.history': 'Historique', 'bs.code.historyOf': 'Historique de {name}', 'bs.code.noHistory': 'Aucune version antérieure pour le moment. Une version est conservée à chaque modification du fichier.',
  'bs.code.restore': 'Restaurer cette version', 'bs.code.restoreHint': 'Le texte est placé dans l’éditeur. Enregistrez pour le conserver.', 'bs.code.reverted': 'Version restaurée dans l’éditeur. Enregistrez pour la conserver.',
  // theme content
  'bs.content.back': 'Retour à l’éditeur de thème', 'bs.content.intro': 'Les textes du thème : boutons, libellés et messages affichés sur la boutique. Modifiez-les par langue ; une traduction vide revient au texte par défaut.',
  'bs.content.search': 'Rechercher un texte', 'bs.content.language': 'Langue', 'bs.content.default': 'par défaut', 'bs.content.group': 'Section', 'bs.content.allGroups': 'Toutes les sections',
  'bs.content.show': 'Afficher', 'bs.content.showAll': 'Tous les textes', 'bs.content.showEdited': 'Modifiés', 'bs.content.showMissing': 'Non traduits', 'bs.content.addLanguage': 'Ajouter une langue',
  'bs.content.count': '{n} textes sur {total}', 'bs.content.unsaved': '{n} non enregistrés', 'bs.content.key': 'Clé', 'bs.content.original': 'Texte par défaut', 'bs.content.text': 'Texte',
  'bs.content.placeholders': 'Gardez les mêmes {{ variables }} que dans le texte par défaut.', 'bs.content.edited': 'Modifié', 'bs.content.noMatch': 'Aucun texte ne correspond.', 'bs.content.more': 'Afficher {n} de plus',
  'bs.content.saved': 'Contenu du thème enregistré', 'bs.content.none': 'Ce thème n’a pas de fichier de langue par défaut (locales/en.default.json).',
};
