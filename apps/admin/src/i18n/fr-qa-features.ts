import type { enQaFeatures } from './en-qa-features';

export const frQaFeatures: Record<keyof typeof enQaFeatures, string> = {
  'qaf.learnMore': 'En savoir plus sur {topic}', 'qaf.learn.markets': 'les marchés', 'qaf.learn.transfers': 'les transferts', 'qaf.learn.purchaseOrders': 'les bons de commande', 'qaf.learn.metaobjects': 'les métaobjets', 'qaf.learn.customers': 'les clients', 'qaf.learn.segments': 'les segments',
  'qaf.markets.privacy': 'Confidentialité des clients', 'qaf.markets.privacyBody': 'Bannière de cookies, opposition à la vente de données', 'qaf.markets.otherFor': 'Autres paramètres pour {name}',
  'qaf.customer.lastOrder': 'Dernière commande passée', 'qaf.customer.contact': 'Coordonnées', 'qaf.customer.defaultAddress': 'Adresse par défaut', 'qaf.customer.marketing': 'Abonnements marketing',
  'qaf.customer.noChannel': 'Aucun abonnement à un canal', 'qaf.customer.language': 'Recevra les notifications en {lang}', 'qaf.customer.neverSignedIn': 'Ne s’est pas connecté', 'qaf.customer.tax': 'Détails de la taxe',
  'qaf.customer.collectTax': 'Percevoir la taxe', 'qaf.customer.taxExempt': 'Exonéré de taxe', 'qaf.customer.none': 'Aucun', 'qaf.customer.erase': 'Effacer les données personnelles', 'qaf.customer.assignCredit': 'Attribuer un crédit en magasin',
  'qaf.po.supplierSelect': 'Sélectionner un fournisseur', 'qaf.po.destinationSelect': 'Sélectionner une destination',
  'qaf.transfer.originSelect': 'Sélectionner une origine', 'qaf.transfer.destinationSelect': 'Sélectionner une destination',
  'qaf.mo.addedBy': 'Ajouté par un membre de l’équipe', 'qaf.mo.showAll': 'Afficher les {n} entrées',
};
