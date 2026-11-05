import type { enQaProduct } from './en-qa-product';

export const frQaProduct: Record<keyof typeof enQaProduct, string> = {
  'pv.uploadBand': 'Charger des images', 'pv.addOption': 'Ajouter une option', 'pv.editOptions': 'Modifier les options', 'pv.doneOptions': 'Terminé',
  'pv.groupBy': 'Regrouper par', 'pv.noGrouping': 'Sans regroupement', 'pv.filters': 'Filtres', 'pv.variantList': 'Variantes',
  'pv.availableShort': '{n} disponibles', 'pv.location': 'Emplacement', 'pv.quantity': 'Quantité', 'pv.noLocations': 'Aucun emplacement actif.',
  'pv.moreVariant': 'Actions de la variante', 'pv.changeImage': 'Image de la variante', 'pv.selectVariant': 'Sélectionnez une variante',
  'pv.duplicateProduct': 'Dupliquer le produit', 'pv.archiveProduct': 'Archiver le produit', 'pv.deleteProduct': 'Supprimer le produit',
  'pv.none': 'Aucun', 'pv.select': 'Sélectionner', 'pv.defaultTemplate': 'Modèle par défaut', 'pv.addCollections': 'Ajouter des collections', 'pv.addTags': 'Ajouter des balises',
  'pv.weightUnit': 'Unité de poids', 'pv.packageSize': 'Dimensions du colis', 'pv.statusLabel': 'Statut du produit',
};
