import type { enFidelity } from './en-fidelity';

// Libellés ajoutés lors de la passe de fidélité écran par écran.
export const frFidelity: Record<keyof typeof enFidelity, string> = {
  // liste des commandes
  'fid.orders.colPayment': 'Statut du paiement', 'fid.orders.colFulfillment': 'Statut du traitement de la commande',
  'fid.orders.moveToBatch': 'Déplacer vers le lot', 'fid.orders.move': 'Déplacer',
  'fid.labels.blockedTitle': 'Impossible de créer des étiquettes d’expédition',
  'fid.labels.blockedBody': 'Les commandes sélectionnées ne sont pas admissibles aux étiquettes d’expédition.', 'fid.labels.blockedBody.one': 'La commande sélectionnée n’est pas admissible aux étiquettes d’expédition.',
  'fid.labels.noItems': '{n} commandes ne contiennent aucun article à traiter :', 'fid.labels.noItems.one': '{n} commande ne contient aucun article qui nécessite un traitement :',
  'fid.labels.labelled': '{n} commandes ont déjà une étiquette ou sont traitées :', 'fid.labels.labelled.one': '{n} commande a déjà une étiquette ou est traitée :',
  'fid.orders.todayAt': 'Aujourd’hui à {time}', 'fid.orders.yesterdayAt': 'Hier à {time}',
  'fid.timeline.fromDraft': 'Créée à partir de la commande provisoire {name}',
  'fid.cmd.channels': 'Canaux de vente', 'fid.shell.language': 'Langue de l’interface', 'fid.shell.theme': 'Thème de l’interface',
  // clients
  'fid.customers.search': 'Rechercher des clients', 'fid.customers.tagTitle': 'Baliser {n} clients', 'fid.customers.tagTitle.one': 'Baliser {n} client', 'fid.customers.delete': 'Supprimer le client', 'fid.customers.noNote': 'Aucune',
  // dialogue d’export
  'fid.export.productsBody': 'Ce fichier CSV met à jour toutes les informations des produits, sauf les quantités en stock. Pour mettre à jour les quantités de plusieurs emplacements, utilisez le', 'fid.export.inventoryCsv': 'fichier CSV des stocks', 'fid.export.or': 'ou', 'fid.export.bulkEditor': 'l’éditeur en bloc',
  'fid.export.learnMore': 'En savoir plus', 'fid.export.learnTopic': 'sur l’exportation au format CSV.',
  'fid.export.selected.products': '{n} produits sélectionnés', 'fid.export.selected.products.one': '{n} produit sélectionné', 'fid.export.matching.products': '{n} produits correspondant à votre recherche', 'fid.export.matching.products.one': '{n} produit correspondant à votre recherche',
  'fid.export.selected.customers': '{n} clients sélectionnés', 'fid.export.selected.customers.one': '{n} client sélectionné', 'fid.export.matching.customers': '{n} clients correspondant à votre recherche', 'fid.export.matching.customers.one': '{n} client correspondant à votre recherche',
  'fid.export.selected.orders': '{n} commandes sélectionnées', 'fid.export.selected.orders.one': '{n} commande sélectionnée', 'fid.export.matching.orders': '{n} commandes correspondant à votre recherche', 'fid.export.matching.orders.one': '{n} commande correspondant à votre recherche',
  'fid.export.selected.draft_orders': '{n} brouillons sélectionnés', 'fid.export.selected.draft_orders.one': '{n} brouillon sélectionné', 'fid.export.matching.draft_orders': '{n} brouillons correspondant à votre recherche', 'fid.export.matching.draft_orders.one': '{n} brouillon correspondant à votre recherche',
  // paramètres d’expédition
  'fid.ship.options': 'Options d’expédition', 'fid.ship.optionsDesc': 'Gérez où vous expédiez et les coûts associés', 'fid.ship.marketsCount': '{n} marchés', 'fid.ship.marketsCount.one': '{n} marché',
  'fid.ship.market': 'Marché', 'fid.ship.optionsCol': 'Options', 'fid.ship.estimates': 'Dates de livraison estimées', 'fid.ship.estimatesDesc': 'Indiquez aux clients quand ils peuvent s’attendre à recevoir leurs commandes.', 'fid.ship.handlingSummary': '{n} jours de préparation', 'fid.ship.handlingSummary.one': '{n} jour de préparation',
  'fid.ship.carriers': 'Comptes professionnels d’expédition', 'fid.ship.carriersDesc': 'Connectez votre compte transporteur existant pour utiliser vos propres tarifs', 'fid.ship.accountsCount': '{n} comptes', 'fid.ship.accountsCount.one': '{n} compte', 'fid.ship.none': 'Aucun',
  'fid.ship.routing': 'Acheminement des commandes', 'fid.ship.routingDesc': 'Gérez l’attribution des emplacements aux nouvelles commandes', 'fid.ship.rulesCount': '{n} règles', 'fid.ship.rulesCount.one': '{n} règle',
  'fid.ship.docName': 'Nom', 'fid.ship.docEdit': 'Modifier',
  'fid.ship.customDesc': 'Les personnalisations déterminent comment les options de livraison s’affichent pour les acheteurs au paiement. Vous pouvez masquer, réorganiser et renommer les options de livraison.', 'fid.ship.addCustomization': 'Personnalisation de la livraison',
  'fid.ship.customFulfillment': 'Traitement personnalisé des commandes', 'fid.ship.customFulfillmentDesc': 'Ajoutez un e-mail pour informer toute personne qui traite des commandes pour vous', 'fid.ship.addService': 'Service de traitement des commandes',
  'fid.rate.fixed': 'Fixe', 'fid.rate.done': 'Terminé', 'fid.rate.searchCollections': 'Rechercher des collections',
  'fid.priv.selfHosted': 'Votre propre serveur (auto-hébergé)',
  'fid.po.terms': 'Conditions', 'fid.transfers.linkPo': 'Lier un bon de commande', 'fid.transfers.noPo': 'Aucun bon de commande',
  'fid.mo.pickType': 'Sélectionner le type de champ',
  // éditeur de thème
  'fid.editor.preview': 'Aperçu', 'fid.editor.support': 'Obtenir de l’assistance', 'fid.editor.by': 'Développé par {author}',
  // marchés
  'fid.markets.activeOptions': '{n} options d’expédition actives', 'fid.markets.activeOptions.one': '{n} option d’expédition active', 'fid.markets.addShippingOption': 'Ajouter une option d’expédition', 'fid.markets.editOption': 'Modifier l’option d’expédition', 'fid.markets.policiesPublished': '{n} publiées', 'fid.markets.policiesPublished.one': '{n} publiée', 'fid.markets.freeFrom': 'Gratuit à partir de {amount}',
  'fid.markets.businessDay': '{n} jours ouvrables', 'fid.markets.businessDay.one': '{n} jour ouvrable', 'fid.markets.businessDays': '{a} à {b} jours ouvrables', 'fid.markets.collectionsCount': '{n} collections', 'fid.markets.collectionsCount.one': '{n} collection',
  // stock
  'fid.adjust.onHand': 'Ajuster la quantité en stock de', 'fid.adjust.resultOnHand': 'En stock : {from} → {to}', 'bp.adjust.mode': 'Mode de modification',
  // fiche produit
  'fid.dup.barcodes': 'Codes-barres', 'fid.product.title': 'Titre de produit',
  'fid.viewer.crop': 'Recadrage et transformation', 'fid.viewer.resize': 'Redimensionnement', 'fid.viewer.draw': 'Dessin', 'fid.viewer.background': 'Couleur de l’arrière-plan',
};
