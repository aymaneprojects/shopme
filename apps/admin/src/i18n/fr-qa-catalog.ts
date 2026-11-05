import type { enQaCatalog } from './en-qa-catalog';

export const frQaCatalog: Record<keyof typeof enQaCatalog, string> = {
  'nav.themes': 'Thèmes', 'nav.storePages': 'Pages', 'nav.menus': 'Navigation',
  'nav.unfulfilledBadge': 'Commandes à traiter', 'nav.salesChannels': 'Canaux de vente',
  'list.searchAndFilter': 'Rechercher et filtrer', 'list.views': 'Vues', 'list.removeFilter': 'Retirer le filtre', 'list.moreBulk': 'Plus d’actions',
  'list.selectPage': 'Sélectionner les {n} sur la page', 'list.deselectAll': 'Tout désélectionner', 'list.showSelected': 'Afficher uniquement les éléments sélectionnés',
  'export.title': 'Exporter {what}', 'export.description': 'Ce fichier CSV peut être ouvert dans un tableur et réimporté pour mettre à jour {what}.',
  'export.what': 'Exporter', 'export.current': 'Page actuelle', 'export.all': 'Tous {what}', 'export.selected': '{n} sélectionné(s)', 'export.matching': '{n} correspondant à votre recherche',
  'export.format': 'Exporter au format', 'export.formatSheet': 'CSV pour Excel, Numbers ou d’autres tableurs', 'export.formatPlain': 'Fichier CSV simple', 'export.confirm': 'Exporter {what}',
  'qty.adjust': 'Ajuster la quantité', 'qty.set': 'Définir à', 'qty.add': 'Ajouter', 'qty.apply': 'Appliquer',
  'bulk.archive': 'Archiver les produits', 'bulk.unpublish': 'Dépublier les produits', 'bulk.deleteProducts': 'Supprimer les produits',
  'viewer.info': 'Informations', 'viewer.name': 'Nom', 'viewer.alt': 'Texte alternatif', 'viewer.details': 'Détails', 'viewer.usedIn': 'Utilisé dans', 'viewer.counter': '{i} sur {n}', 'viewer.previous': 'Image précédente', 'viewer.next': 'Image suivante', 'viewer.download': 'Télécharger', 'viewer.save': 'Enregistrer', 'viewer.open': 'Voir l’image',
  'export.noun.products': 'les produits', 'export.noun.customers': 'les clients', 'export.noun.inventory': 'le stock', 'export.noun.orders': 'les commandes', 'export.noun.draft_orders': 'les brouillons',
  'tagpicker.search': 'Rechercher ou créer des balises', 'tagpicker.available': 'Disponibles', 'tagpicker.create': 'Créer « {tag} »', 'customers.deleteBulk': 'Supprimer les clients',
  'filter.vendor': 'Fournisseur', 'filter.type': 'Type de produit', 'filter.tag': 'Balise', 'filter.status': 'Statut', 'filter.stock': 'Stock',
};
