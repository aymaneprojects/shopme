import type { enCheckout } from './en-checkout';

export const frCheckout: Record<keyof typeof enCheckout, string> = {
  'settings.checkout': 'Paiement en ligne',
  'checkout.contact': 'Moyen de contact du client', 'checkout.contactDesc': 'Ce que les clients utilisent pour s’identifier lors du paiement.',
  'checkout.contact.email': 'E-mail', 'checkout.contact.emailOrPhone': 'E-mail ou numéro de mobile', 'checkout.contact.emailOrPhoneHelp': 'Un client qui ne donne qu’un numéro de téléphone peut tout de même commander.',
  'checkout.accounts': 'Comptes clients', 'checkout.accountsDesc': 'Les clients doivent-ils se connecter pour commander ?',
  'checkout.accounts.guest': 'Les comptes sont facultatifs', 'checkout.accounts.guestHelp': 'Les clients peuvent commander en invité ou se connecter à leur compte.',
  'checkout.accounts.required': 'Les comptes sont obligatoires', 'checkout.accounts.requiredHelp': 'Les clients sont envoyés vers la page de connexion avant de pouvoir commander.',
  'checkout.info': 'Informations du client', 'checkout.infoDesc': 'Les champs du formulaire d’adresse. Un champ masqué n’est pas demandé ; un champ obligatoire doit être rempli.',
  'checkout.info.name': 'Nom complet', 'checkout.info.nameFull': 'Exiger le prénom et le nom', 'checkout.info.nameLast': 'Exiger uniquement le nom',
  'checkout.info.company': 'Nom de la société', 'checkout.info.address2': 'Complément d’adresse (appartement, bâtiment)', 'checkout.info.phone': 'Téléphone de l’adresse de livraison',
  'checkout.rule.hidden': 'Ne pas inclure', 'checkout.rule.optional': 'Facultatif', 'checkout.rule.required': 'Obligatoire',
  'checkout.marketing': 'Options marketing', 'checkout.marketingDesc': 'La case d’inscription aux e-mails marketing sous le champ de contact.',
  'checkout.marketing.label': 'Case d’inscription marketing', 'checkout.marketing.hidden': 'Ne pas afficher', 'checkout.marketing.unchecked': 'Afficher, non cochée', 'checkout.marketing.checked': 'Afficher, cochée par défaut',
  'checkout.tipping': 'Pourboires', 'checkout.tippingDesc': 'Permettre aux clients d’ajouter un pourboire à leur commande.', 'checkout.tipping.enable': 'Proposer un pourboire au paiement',
  'checkout.tipping.presets': 'Pourboires prédéfinis (%)', 'checkout.tipping.presetsHelp': 'Jusqu’à 5 pourcentages entiers séparés par des virgules. Les clients peuvent aussi saisir un montant.',
  'checkout.notes': 'Notes de commande', 'checkout.notesDesc': 'Une zone de texte pour les instructions particulières.', 'checkout.notes.enable': 'Demander des notes de commande au paiement',

  'notif.enabled': 'Envoyer cette notification', 'notif.recipients': 'Destinataires des nouvelles commandes',
  'notif.recipientsDesc': 'Ces adresses reçoivent l’e-mail « Nouvelle commande » à chaque commande passée.', 'notif.recipientsDefault': '(e-mail de contact de la boutique)',
  'notif.recipientsAdd': 'Ajouter un destinataire', 'notif.recipientsAddBtn': 'Ajouter',

  'returns.title': 'Règles de retour', 'returns.desc': 'Appliquées à la création d’un retour et affichées sur la page de votre politique de remboursement.',
  'returns.window': 'Délai de retour (jours)', 'returns.windowHelp': 'Laissez vide pour ne pas limiter. Compté à partir de l’expédition.',
  'returns.restocking': 'Frais de remise en stock (%)', 'returns.restockingHelp': 'Part de la valeur des articles retournés conservée par la boutique.',
  'returns.shipping': 'Expédition du retour', 'returns.shipping.free': 'Gratuite pour le client', 'returns.shipping.fixed': 'Le client paie des frais forfaitaires', 'returns.shipping.customer': 'Le client paie l’expédition',
  'returns.fee': 'Frais de retour forfaitaires ({currency})', 'returns.finalSale': 'Articles en vente définitive', 'returns.finalSaleHelp': 'Produits et collections qui ne peuvent pas être retournés.',
  'returns.addProducts': 'Ajouter des produits', 'returns.addCollections': 'Ajouter des collections',

  'discount.eligibility': 'Éligibilité des clients', 'discount.eligibilityLabel': 'Disponible pour', 'discount.eligibility.all': 'Tous les clients', 'discount.eligibility.segments': 'Segments de clients spécifiques',
  'discount.eligibility.customers': 'Clients spécifiques', 'discount.eligibility.noSegments': 'Aucun segment de clients pour le moment. Créez-en un dans Clients, Segments.',
  'discount.eligibility.addCustomers': 'Ajouter des clients', 'discount.eligibility.add': 'Ajouter', 'discount.eligibility.help': 'Vérifié au paiement à partir de l’adresse e-mail saisie par le client.',
  'discount.err.segments': 'Sélectionnez au moins un segment de clients.', 'discount.err.customers': 'Sélectionnez au moins un client.',
  'discount.tags': 'Tags', 'discount.tagsLabel': 'Tags de la réduction', 'discount.tagsPlaceholder': 'Ajouter un tag', 'discount.tagsHelp': 'Les tags servent à organiser et filtrer les réductions. Les clients ne les voient pas.',
  'discounts.eligibility': 'Éligibilité', 'discounts.eligibility.customers': '{n} clients', 'discounts.tags': 'Tags', 'discounts.filterTag': 'Filtrer par tag',

  'activity.title': 'Notifications', 'activity.open': 'Notifications', 'activity.openUnread': 'Notifications, {n} non lues', 'activity.markAll': 'Tout marquer comme lu', 'activity.empty': 'Rien de nouveau.', 'activity.unread': 'Non lu',
  'activity.order': 'Nouvelle commande {name}', 'activity.lowStock': 'Stock faible : {title}', 'activity.lowStockBody': '{n} restant(s)', 'activity.webhook': 'Échec de livraison du webhook : {topic}',
  'activity.backupOk': 'Sauvegarde terminée', 'activity.backupFailed': 'Échec de la sauvegarde',
  'shell.help': 'Centre d’aide', 'shell.expand': 'Développer la barre latérale', 'shell.collapse': 'Réduire la barre latérale',
  'cmd.placeholder': 'Rechercher', 'cmd.filters': 'Rechercher dans', 'cmd.searchIn': 'Rechercher dans {shop}', 'cmd.recent': 'Recherches récentes', 'cmd.open': 'Ouvrir',
};
