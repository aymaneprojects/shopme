// Vues enregistrées, tableau des variantes, expédition, cartes cadeaux, actions groupées du stock, indicateurs produits.
export const frViews = {
  'views.tabs': 'Vues', 'views.add': 'Enregistrer la recherche actuelle comme vue', 'views.saveAs': 'Enregistrer la vue sous', 'views.name': 'Nom de la vue', 'views.nameRequired': 'Saisissez un nom pour la vue.',
  'views.saveHelp': 'La recherche, les filtres et le tri sont enregistrés. Toute votre équipe peut utiliser cette vue.', 'views.save': 'Enregistrer', 'views.saved': 'Vue enregistrée', 'views.updated': 'Vue mise à jour',
  'views.deleted': 'Vue supprimée', 'views.saveChanges': 'Enregistrer les modifications', 'views.discard': 'Annuler les modifications', 'views.rename': 'Renommer la vue', 'views.duplicate': 'Dupliquer la vue',
  'views.copyOf': '{name} (copie)', 'views.actions': 'Actions de la vue {name}', 'views.deleteTitle': 'Supprimer la vue « {name} » ?', 'views.deleteBody': 'La vue est supprimée pour tout le monde. Vos produits, commandes et clients ne sont pas modifiés.',

  'variants.search': 'Rechercher des variantes', 'variants.filterBy': 'Filtrer par {name}', 'variants.noMatch': 'Aucune variante ne correspond à votre recherche.', 'variants.add': 'Ajouter une variante', 'variants.addConfirm': 'Ajouter la variante',
  'variants.addHelp': 'Choisissez une valeur pour chaque option. Une nouvelle valeur est ajoutée à l’option.', 'variants.addMissing': 'Saisissez une valeur pour chaque option.', 'variants.addExists': 'Une variante avec ces valeurs existe déjà.',
  'variants.duplicateTitle': 'Dupliquer la variante', 'variants.editValues': 'Modifier les valeurs de l’option', 'variants.duplicate': 'Dupliquer', 'variants.actions': 'Actions pour', 'variants.select': 'Sélectionner',
  'variants.bulkActions': 'Actions sur les variantes', 'variants.editPrices': 'Modifier les prix', 'variants.editQuantities': 'Modifier les quantités', 'variants.deleteSelected': 'Supprimer les variantes', 'variants.clearSelection': 'Désélectionner',
  'variants.editPricesTitle': 'Modifier les prix de {n} variantes', 'variants.editPricesTitle.one': 'Modifier le prix de {n} variante', 'variants.leaveEmpty': 'Laissez un champ vide pour conserver les valeurs actuelles.',
  'variants.editQuantitiesTitle': 'Modifier les quantités de {n} variantes', 'variants.editQuantitiesTitle.one': 'Modifier les quantités de {n} variante', 'variants.quantitiesHelp': 'Définit la quantité disponible des variantes dont le stock est suivi. Laissez un emplacement vide pour conserver ses quantités.',
  'variants.deleteTitle': 'Supprimer {n} variantes ?', 'variants.deleteTitle.one': 'Supprimer {n} variante ?', 'variants.deleteBody': 'Les variantes sont supprimées à l’enregistrement du produit. Un produit conserve au moins une variante.',

  'shipping.dimensions': 'Dimensions avec emballage', 'shipping.length': 'Longueur', 'shipping.width': 'Largeur', 'shipping.height': 'Hauteur', 'shipping.dimensionUnit': 'Unité de dimension',
  'shipping.origin': 'Pays/région d’origine', 'shipping.noOrigin': 'Non précisé', 'shipping.hsCode': 'Code du Système harmonisé (SH)', 'shipping.hsCodeHelp': 'Utilisé pour la douane sur les commandes internationales.',
  'lengthUnit.MILLIMETERS': 'mm', 'lengthUnit.CENTIMETERS': 'cm', 'lengthUnit.METERS': 'm', 'lengthUnit.INCHES': 'po', 'lengthUnit.FEET': 'pi', 'lengthUnit.YARDS': 'yd',

  'product.giftCardTitle': 'Carte cadeau', 'product.giftCardBadge': 'Produit carte cadeau', 'product.duplicateTitle': 'Dupliquer le produit', 'product.duplicateConfirm': 'Dupliquer le produit',
  'product.duplicateDetails': 'Dupliquer les détails du produit', 'product.duplicateMedia': 'Supports multimédias', 'product.duplicateStatus': 'Statut du produit', 'product.duplicateAsDraft': 'Définir comme brouillon', 'product.duplicateAsActive': 'Définir comme actif',
  'order.giftCards': 'Cartes cadeaux émises', 'order.giftCardsHelp': 'Envoyées par e-mail au destinataire, ou au client s’il n’y en a pas.',

  'inventory.tabAll': 'Tous', 'inventory.trackingFilter': 'Suivi', 'inventory.filterTracked': 'Articles suivis', 'inventory.filterUntracked': 'Non suivis',
  'inventory.editAvailable': 'Modifier le disponible', 'inventory.editOnHand': 'Modifier le stock physique', 'inventory.stopTracking': 'Arrêter le suivi', 'inventory.trackQuantity': 'Suivre la quantité',
  'inventory.editAvailableTitle': 'Modifier la quantité disponible de {n} articles', 'inventory.editAvailableTitle.one': 'Modifier la quantité disponible de {n} article',
  'inventory.editOnHandTitle': 'Modifier le stock physique de {n} articles', 'inventory.editOnHandTitle.one': 'Modifier le stock physique de {n} article',
  'inventory.bulkMode': 'Modification', 'inventory.bulkSet': 'Définir la quantité à', 'inventory.bulkAdjust': 'Ajouter ou retirer', 'inventory.bulkValue': 'Quantité',
  'inventory.tracking.on': 'Suivi activé pour {n} articles', 'inventory.tracking.on.one': 'Suivi activé pour {n} article',
  'inventory.tracking.off': 'Suivi désactivé pour {n} articles', 'inventory.tracking.off.one': 'Suivi désactivé pour {n} article',

  'products.addTags': 'Ajouter des balises', 'products.removeTags': 'Supprimer des balises', 'products.addToCollections': 'Ajouter aux collections', 'products.removeFromCollections': 'Retirer des collections',
  'metrics.title': 'Indicateurs des produits', 'metrics.days': '{n} jours', 'metrics.sellThrough': 'Taux de vente moyen', 'metrics.sellThroughHelp': 'Unités vendues divisées par les unités vendues plus les unités en stock, sur la période.',
  'metrics.daysLeft': 'Produits par jours de stock restants', 'metrics.daysLeftHelp': 'Unités en stock divisées par la moyenne des unités vendues par jour sur la période.', 'metrics.daysValue': '{n} jours',
  'metrics.abc': 'Analyse ABC des produits', 'metrics.abcHelp': 'Produits classés par chiffre d’affaires : A fait les 80 % premiers, B les 15 % suivants, C le reste et les produits non vendus.',
  'metrics.abcValue': 'A {a} · B {b} · C {c}', 'metrics.noData': 'Aucune donnée',
} as const;
