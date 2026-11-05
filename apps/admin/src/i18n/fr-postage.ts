import type { enPostage } from './en-postage';

export const frPostage: Record<keyof typeof enPostage, string> = {
  // page de commande
  'postage.buy': 'Acheter une étiquette d’expédition', 'postage.title': 'Acheter une étiquette d’expédition', 'postage.titleFor': 'Acheter une étiquette d’expédition pour {name}',
  'postage.shipTo': 'Livrer à', 'postage.noAddress': 'Cette commande n’a pas d’adresse de livraison.', 'postage.items': 'Articles',
  'postage.package': 'Colis', 'postage.defaultPackage': 'Colis par défaut ({name})', 'postage.customPackage': 'Aucun colis enregistré',
  'postage.weight': 'Poids total', 'postage.weightHelp': 'Les articles pèsent {weight}. Ajoutez le poids de l’emballage.', 'postage.weightNone': 'Saisissez le poids du colis, emballage compris.',
  'postage.getRates': 'Obtenir les tarifs', 'postage.rates': 'Tarifs', 'postage.noRates': 'Aucun transporteur ne propose de tarif pour ce colis.',
  'postage.days': '{n} jours ouvrés', 'postage.days.one': '{n} jour ouvré', 'postage.cheapest': 'Le moins cher',
  'postage.testBadge': 'Mode test', 'postage.testNotice': 'Le transporteur de test crée des étiquettes d’exemple avec de faux numéros de suivi. Rien n’est facturé et rien ne peut être expédié avec.',
  'postage.notify': 'Envoyer une confirmation d’expédition au client', 'postage.buyFor': 'Acheter l’étiquette · {price}', 'postage.bought': 'Étiquette d’expédition achetée',
  'postage.print': 'Imprimer l’étiquette', 'postage.void': 'Annuler l’étiquette', 'postage.voidTitle': 'Annuler cette étiquette ?',
  'postage.voidBody': 'Le transporteur est invité à rembourser l’affranchissement, et l’expédition est annulée pour que les articles puissent être expédiés à nouveau.',
  'postage.keep': 'Garder l’étiquette', 'postage.voided': 'Étiquette annulée', 'postage.voidedRefunded': 'Étiquette annulée, affranchissement remboursé',
  'postage.noCarrier': 'Aucun compte transporteur ne vend encore d’étiquettes.', 'postage.setup': 'Configurer les comptes transporteur',
  'postage.label': 'Étiquette d’expédition', 'postage.cost': 'Affranchissement', 'postage.refunded': 'Remboursée', 'postage.notRefunded': 'Non remboursée',
  'postage.back': 'Retour',
  // Paramètres > Expédition
  'postage.labelsRow': 'Étiquettes d’expédition', 'postage.labelsRowDesc': 'Achetez et imprimez des étiquettes auprès de vos comptes transporteur',
  'postage.calculate': 'Calculer les tarifs', 'postage.labelsHelp': 'Comptes transporteur qui vendent des étiquettes. Les étiquettes s’achètent depuis une commande, dans la carte d’expédition.',
  'postage.labelsNone': 'Aucun compte transporteur ne vend encore d’étiquettes. Ajoutez-en un dans Comptes transporteur, ou ajoutez le transporteur de test pour essayer.',
  'postage.labelCarriers': '{n} transporteurs', 'postage.labelCarriers.one': '{n} transporteur', 'postage.labelsOff': 'Non configuré',
  'postage.calcTitle': 'Calculer les tarifs d’étiquettes', 'postage.calcIntro': 'Tarifs pour un colis envoyé depuis votre premier emplacement vers le pays de votre choix.',
  'postage.destination': 'Pays de destination', 'postage.zip': 'Code postal',
  'postage.accountsRow': 'Comptes transporteur', 'postage.accountsRowDesc': 'Connectez vos propres comptes transporteur pour les tarifs calculés et les étiquettes',
  'postage.accountsNone': 'Aucun', 'postage.accountsCount': '{n} comptes', 'postage.accountsCount.one': '{n} compte',
  'postage.carrierRates': 'Tarifs calculés par le transporteur', 'postage.labelsYes': 'Achat d’étiquettes possible', 'postage.labelsNo': 'Tarifs uniquement',
  'postage.addTest': 'Ajouter le transporteur de test', 'postage.testName': 'Transporteur de test', 'postage.testAdded': 'Transporteur de test ajouté',
  'postage.provider': 'Type', 'postage.providerHttp': 'Service transporteur HTTP', 'postage.providerTest': 'Transporteur de test (mode test)',
  'postage.sellsLabels': 'Ce service vend aussi des étiquettes d’expédition',
  'postage.sellsLabelsHelp': 'Il répond aux demandes de tarifs, d’achat et d’annulation d’étiquettes décrites dans la documentation transporteur.',
  'postage.testIntro': 'Transporteur intégré pour essayer les tarifs et les étiquettes : prix d’exemple, étiquettes PDF marquées comme tests et faux numéros de suivi. Supprimez-le avant de commencer à vendre.',
  // historique de la commande
  'postage.ev.purchased': 'Étiquette d’expédition achetée auprès de {carrier} ({service}, {tracking})', 'postage.ev.purchasedTest': 'Étiquette d’expédition de test achetée auprès de {carrier} ({service}, {tracking})',
  'postage.ev.voided': 'Étiquette d’expédition annulée', 'postage.ev.voidedRefunded': 'Étiquette d’expédition annulée, affranchissement remboursé', 'postage.ev.recorded': 'Étiquette d’expédition enregistrée ({carrier} {tracking})',
  // page des étiquettes
  'postage.sourcePurchased': 'Achetée', 'postage.sourceManual': 'Enregistrée',
  'postage.labelsFooter': 'Achetez des étiquettes depuis une commande avec un compte transporteur qui vend l’affranchissement, ou enregistrez celles achetées ailleurs.',
};
