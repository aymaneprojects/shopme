import type { enOrdersUx } from './en-orders-ux';

export const frOrdersUx: Record<keyof typeof enOrdersUx, string> = {
  'picker.selected': '{n} sélectionné(s)', 'picker.addProducts': 'Ajouter des produits', 'picker.close': 'Fermer', 'picker.done': 'Terminé', 'picker.searchProducts': 'Rechercher des produits',
  'picker.product': 'Produit', 'picker.available': 'Disponible', 'picker.price': 'Prix', 'picker.alreadyIn': 'Déjà dans la commande', 'picker.notTracked': 'Non suivi',

  'draft.productBtn': 'Produit', 'draft.customBtn': 'Article personnalisé', 'draft.addToCalculate': 'Ajoutez un produit pour calculer le total.', 'draft.notePlaceholder': 'Ajouter une note',
  'draft.deleteSelected': 'Supprimer les brouillons', 'draft.deleteManyTitle': 'Supprimer {n} brouillons ?', 'draft.deleteManyTitle.one': 'Supprimer {n} brouillon ?', 'draft.deletedMany': '{n} brouillons supprimés', 'draft.deletedMany.one': '{n} brouillon supprimé',

  'orderEdit.taxNote': 'Les taxes sont estimées jusqu’à la mise à jour de la commande.', 'orderEdit.reason': 'Raison de la modification', 'orderEdit.reasonHelp': 'Visible uniquement par l’équipe.', 'orderEdit.noChanges': 'Aucune modification',

  'refund.pageTitle': 'Remboursement', 'order.refundItems': 'Articles à rembourser', 'order.nothingToRefund': 'Il n’y a plus rien à rembourser sur cette commande.', 'order.refundShippingMax': 'jusqu’à {max}',
  'order.refundReason': 'Motif du remboursement', 'order.refundReasonHelp': 'Visible uniquement par l’équipe.', 'order.noItemSelected': 'Aucun article sélectionné',
  'order.refundAmountTitle': 'Montant du remboursement', 'order.refundMethod': 'Remboursement sur le moyen de paiement initial', 'order.availableToRefund': '{amount} disponible pour remboursement',

  'abandoned.emptyTitle2': 'Les paniers abandonnés apparaîtront ici', 'abandoned.emptyBody2': 'Voyez quand des clients ajoutent un article à leur panier sans payer. Vous pouvez aussi leur envoyer par e-mail un lien vers leur panier.',

  "order.editAddress": "Modifier l’adresse",
  "order.viewCustomer": "Voir le client",
  "order.copyEmail": "Copier l’e-mail",
  "order.copyAddress": "Copier l’adresse",
  "order.newer": "Commande plus récente",
  "order.older": "Commande plus ancienne",
  "order.addr.firstName": "Prénom",
  "order.addr.lastName": "Nom",
  "order.addr.company": "Société",
  "order.addr.address1": "Adresse",
  "order.addr.address2": "Appartement, étage, etc.",
  "order.addr.city": "Ville",
  "order.addr.zip": "Code postal",
  "order.addr.province": "Code de l’État ou de la province",
  "order.addr.country": "Code pays",
  "order.addr.phone": "Téléphone",
};
