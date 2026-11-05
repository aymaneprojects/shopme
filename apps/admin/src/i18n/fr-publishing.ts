import type { enPublishing } from './en-publishing';

export const frPublishing: Record<keyof typeof enPublishing, string> = {
  'rte.showHtml': 'Afficher le HTML', 'rte.editor': 'Éditeur de texte enrichi', 'rte.heading1': 'Titre 1', 'rte.heading2': 'Titre 2', 'rte.heading3': 'Titre 3', 'rte.heading4': 'Titre 4', 'rte.quote': 'Citation',
  'rte.color': 'Couleur du texte', 'rte.customColor': 'Couleur personnalisée', 'rte.defaultColor': 'Par défaut', 'rte.alignLeft': 'Aligner à gauche', 'rte.alignCenter': 'Centrer', 'rte.alignRight': 'Aligner à droite', 'rte.justify': 'Justifier',
  'rte.indent': 'Augmenter le retrait', 'rte.outdent': 'Diminuer le retrait', 'rte.unlink': 'Supprimer le lien', 'rte.image': 'Insérer une image', 'rte.imageUpload': 'Importer une image', 'rte.video': 'Intégrer une vidéo',
  'rte.videoPrompt': 'URL YouTube ou Vimeo', 'rte.videoInvalid': 'Saisissez une URL YouTube ou Vimeo.', 'rte.table': 'Insérer un tableau', 'rte.tableRows': 'Lignes', 'rte.tableColumns': 'Colonnes', 'rte.clearFormat': 'Effacer la mise en forme',
  'rte.apply': 'Appliquer', 'rte.insert': 'Insérer', 'rte.cancel': 'Annuler',
  'picker.image': 'Sélectionner une image', 'picker.imageEmpty': 'Aucune image pour le moment. Importez-en une pour commencer.', 'picker.imageUpload': 'Importer une image', 'picker.imageSearch': 'Rechercher des images',

  'publish.setDate': 'Définir une date de visibilité', 'publish.date': 'Visible le', 'publish.time': 'Heure', 'publish.clearDate': 'Supprimer la date',
  'publish.scheduled': 'Programmé', 'publish.scheduledOn': 'Sera visible le {date}.', 'publish.visibleSince': 'Visible depuis le {date}.', 'publish.hiddenHelp': 'N’apparaît pas dans votre boutique en ligne.',
  'template.title': 'Modèle du thème', 'template.default': 'Modèle par défaut', 'template.help': 'Choisissez le modèle de votre thème actif qui affiche ce contenu.', 'template.missing': '{name} (absent du thème actif)',
  'seo.pageTitle': 'Titre de la page', 'seo.metaDescription': 'Méta-description', 'seo.chars': '{n} caractères utilisés sur {max}', 'seo.url': 'Identifiant d’URL', 'seo.done': 'Terminé',

  'files.newFolder': 'Nouveau dossier', 'files.folderName': 'Nom du dossier', 'files.createFolder': 'Créer le dossier', 'files.renameFolder': 'Renommer le dossier', 'files.deleteFolder': 'Supprimer le dossier', 'files.folderSaved': 'Dossier enregistré',
  'files.folderDeleted': 'Dossier supprimé', 'files.folderNotEmpty': 'Déplacez ou supprimez d’abord les fichiers de ce dossier.', 'files.deleteFolderTitle': 'Supprimer le dossier « {name} » ?', 'files.deleteFolderBody': 'Seuls les dossiers vides peuvent être supprimés.',
  'files.allFiles': 'Tous les fichiers', 'files.root': 'Aucun dossier', 'files.moveTo': 'Déplacer vers un dossier', 'files.moved': '{n} fichier(s) déplacé(s)', 'files.size': 'Taille', 'files.references': 'Références', 'files.noReferences': 'Non utilisé',
  'files.ref.PRODUCT': '{n} produits', 'files.ref.PRODUCT.one': '{n} produit', 'files.ref.COLLECTION': '{n} collections', 'files.ref.COLLECTION.one': '{n} collection',
  'files.ref.ARTICLE': '{n} articles de blog', 'files.ref.ARTICLE.one': '{n} article de blog', 'files.ref.THEME': 'Paramètres du thème', 'files.refsTitle': 'Utilisé dans',
  'files.moreActions': 'Autres actions sur les fichiers', 'files.downloadSelected': 'Télécharger la sélection', 'files.downloading': 'Téléchargement de {n} fichier(s)', 'files.selectToDownload': 'Sélectionnez des fichiers pour les télécharger.',
  'files.copyLinks': 'Copier les liens de la sélection', 'files.linksCopied': '{n} lien(s) copié(s)', 'files.folder': 'Dossier', 'files.download': 'Télécharger',
};
