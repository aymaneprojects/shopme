import type { enUx } from './en-ux';

export const frUx: Record<keyof typeof enUx, string> = {
  'columns.edit': 'Modifier les colonnes', 'columns.title': 'Colonnes',
  'viewAs.label': 'Afficher en tant que', 'viewAs.desktop': 'Visiteur sur ordinateur', 'viewAs.mobile': 'Visiteur sur téléphone',
  'share.label': 'Partager', 'share.copyLink': 'Copier le lien', 'share.copied': 'Lien copié', 'share.copyFailed': 'Impossible de copier le lien', 'share.email': 'Envoyer par e-mail',
  'nav.previousRecord': 'Précédent', 'nav.nextRecord': 'Suivant',
  'collection.duplicate': 'Dupliquer la collection', 'collection.duplicated': 'Collection dupliquée', 'collection.view': 'Voir sur la boutique',
  'inventory.unavailable': 'Indisponible', 'inventory.incoming': 'Entrant', 'inventory.counts': 'Comptages de stock',
  'inventory.countHelp': 'Saisissez une ligne par article au format « SKU, quantité comptée ». La quantité disponible à l’emplacement choisi est remplacée par la valeur comptée.',
  'inventory.countLines': 'Quantités comptées', 'inventory.countApply': 'Appliquer les comptages', 'inventory.countDone': 'Comptages de stock appliqués',
  'inventory.countBadLine': 'Ligne non comprise : {line}', 'inventory.countUnknownSku': 'Aucun article suivi avec le SKU {sku}',
  'discounts.combines': 'Cumul avec', 'discounts.combines.yes': 'cumulable', 'discounts.combines.no': 'non cumulable',
  'discount.removeEnd': 'Supprimer la date de fin',
  'home.processOrders': 'Traiter les commandes', 'home.nextSteps': 'Prochaines étapes',
  'home.setupPayments': 'Configurer les paiements', 'home.setupPayments.body': 'Choisissez comment vos clients paient à la caisse.',
  'home.setupDomain': 'Obtenir un domaine personnalisé', 'home.setupDomain.body': 'Donnez à votre boutique sa propre adresse web.',
  'home.setupPolicies': 'Examiner les politiques de la boutique', 'home.setupPolicies.body': 'Vérifiez vos politiques de remboursement, de confidentialité et d’expédition.',
  'editor.redo': 'Rétablir', 'editor.duplicate': 'Dupliquer', 'editor.openPreview': 'Ouvrir l’aperçu dans un nouvel onglet', 'editor.allThemes': 'Tous les thèmes',
  'editor.saveFirst': 'Enregistrez vos modifications avant de publier', 'editor.deleteBlock': 'Supprimer le bloc', 'editor.deleteSection': 'Supprimer la section', 'editor.searchSections': 'Rechercher des sections',
};
