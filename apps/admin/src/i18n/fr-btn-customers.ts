import type { enBtnCustomers } from './en-btn-customers';

export const frBtnCustomers: Record<keyof typeof enBtnCustomers, string> = {
  // clients : liste et fiche
  'nav.contentMenus': 'Menus', 'bc.companies': 'Sociétés', 'bc.editInBulk': 'Modifier en masse', 'bc.grantCredit': 'Accorder du crédit en magasin', 'bc.merge': 'Fusionner les clients', 'bc.mergeCustomer': 'Fusionner le client', 'bc.addToCompany': 'Ajouter à une société',
  'bc.help.subscription': 'Indique si le client a accepté de recevoir des e-mails marketing.', 'bc.help.location': 'La ville et le pays de l’adresse par défaut.', 'bc.help.spent': 'Ce que le client a payé, remboursements déduits. Les commandes annulées ne comptent pas.',
  'bc.group': 'Groupe de clients', 'bc.group.customer': 'Client', 'bc.group.prospect': 'Prospect',
  'bc.rfm.CHAMPIONS': 'Champions', 'bc.rfm.LOYAL': 'Fidèles', 'bc.rfm.ACTIVE': 'Actifs', 'bc.rfm.NEW': 'Nouveaux', 'bc.rfm.PROMISING': 'Prometteurs', 'bc.rfm.NEEDS_ATTENTION': 'À surveiller',
  'bc.rfm.ALMOST_LOST': 'Presque perdus', 'bc.rfm.PREVIOUSLY_LOYAL': 'Anciens fidèles', 'bc.rfm.AT_RISK': 'À risque', 'bc.rfm.DORMANT': 'Inactifs', 'bc.rfm.PROSPECTS': 'Prospects',
  'bc.channel.email': 'E-mail', 'bc.channel.sms': 'SMS',
  'bc.phone.country': 'Indicatif', 'bc.phone.none': 'Aucun', 'bc.sms.consent': 'Le client accepte de recevoir des SMS marketing', 'bc.sms.needsPhone': 'Ajoutez un numéro de téléphone pour recueillir le consentement SMS.',
  'segments.builtin.abandoned': 'Clients avec un panier abandonné au cours des 30 derniers jours',

  // barre de requête
  'bc.queryBar.label': 'Filtrer les clients avec une requête', 'bc.queryBar.placeholder': 'orders_count:>2 country:FR -tag:vip', 'bc.queryBar.apply': 'Appliquer', 'bc.queryBar.clear': 'Effacer', 'bc.queryBar.save': 'Enregistrer comme segment',
  'bc.queryBar.hint': 'Filtrez avec une requête comme {fields}. Exemple : orders_count:>2 amount_spent:>100 -tag:vip',
  'bc.queryBar.problem.unknownField': 'n’est pas un champ client.', 'bc.queryBar.problem.badNumber': 'attend un nombre.', 'bc.queryBar.problem.badDate': 'attend une date comme 2026-01-31.',
  'bc.queryBar.problem.badBool': 'attend true ou false.', 'bc.queryBar.problem.badValue': 'n’est pas une valeur acceptée.', 'bc.queryBar.problem.empty': 'n’a pas de valeur.',

  // modification en masse
  'bc.bulk.title': 'Modifier {n} clients', 'bc.bulk.title.one': 'Modifier 1 client', 'bc.bulk.apply': 'Appliquer les modifications', 'bc.bulk.addTags': 'Ajouter des tags', 'bc.bulk.removeTags': 'Retirer des tags',
  'bc.bulk.email': 'Marketing par e-mail', 'bc.bulk.sms': 'Marketing par SMS', 'bc.bulk.noChange': 'Ne pas modifier', 'bc.bulk.subscribe': 'Abonner', 'bc.bulk.unsubscribe': 'Désabonner',
  'bc.bulk.tax': 'Exonération de taxe', 'bc.bulk.taxHelp': 'Les clients exonérés ne paient pas de taxe sur leurs commandes.', 'bc.bulk.noteAppend': 'Ajouter à la note existante', 'bc.bulk.noteReplace': 'Remplacer la note', 'bc.bulk.noteClear': 'Effacer la note',
  'bc.bulk.done': '{n} clients mis à jour', 'bc.bulk.done.one': '1 client mis à jour', 'bc.bulk.failed': 'Certains clients ont été ignorés :',
  'bc.bulk.help': 'Seuls les champs que vous modifiez sont touchés. Le changement de consentement exige une adresse e-mail ou un numéro de téléphone sur le client.',

  // fusion
  'bc.merge.title': 'Fusionner les clients', 'bc.merge.pickTitle': 'Fusionner avec un autre client', 'bc.merge.intro': 'Choisissez le client à conserver. L’autre est fusionné dans celui-ci puis supprimé.',
  'bc.merge.keep': 'Client à conserver', 'bc.merge.keptValue': 'Client conservé', 'bc.merge.otherValue': 'Client fusionné', 'bc.merge.result': 'Client fusionné',
  'bc.merge.confirm': 'Fusionner les clients', 'bc.merge.done': 'Clients fusionnés', 'bc.merge.warning': 'Cette action est irréversible.',
  'bc.merge.blockedErased': 'Un client dont les données personnelles ont été effacées ne peut pas être fusionné.', 'bc.merge.blockedErasure': 'Un client dont l’effacement des données est programmé ne peut pas être fusionné. Annulez d’abord l’effacement.',
  'bc.merge.moves.orders': '{n} commandes sont transférées', 'bc.merge.moves.orders.one': '1 commande est transférée', 'bc.merge.moves.draftOrders': '{n} brouillons de commande sont transférés', 'bc.merge.moves.draftOrders.one': '1 brouillon de commande est transféré',
  'bc.merge.moves.addresses': '{n} adresses sont transférées', 'bc.merge.moves.addresses.one': '1 adresse est transférée', 'bc.merge.moves.storeCreditAccounts': 'Le crédit en magasin est regroupé', 'bc.merge.moves.giftCards': '{n} cartes cadeaux sont transférées',
  'bc.merge.moves.giftCards.one': '1 carte cadeau est transférée', 'bc.merge.moves.timelineEvents': 'Les événements de l’historique sont transférés',

  // demande de données et effacement
  'bc.erase.action': 'Effacer les données personnelles', 'bc.erase.cancel': 'Annuler l’effacement', 'bc.erase.title': 'Effacer les données personnelles ?', 'bc.erase.confirm': 'Demander l’effacement',
  'bc.erase.body': 'Le nom, les coordonnées, les adresses, les notes et l’historique du client sont anonymisés au bout de 10 jours. Ses commandes sont conservées pour votre comptabilité, sans données personnelles. Vous pouvez annuler d’ici là.',
  'bc.erase.requested': 'Effacement demandé', 'bc.erase.cancelled': 'Effacement annulé', 'bc.erase.scheduled': 'Les données personnelles seront effacées le {date}.', 'bc.erase.done': 'Les données personnelles ont été effacées le {date}. Les commandes sont conservées sans données personnelles.',

  // historique
  'bc.timeline.attach': 'Joindre des fichiers', 'bc.timeline.showEmail': 'Afficher l’e-mail', 'bc.timeline.email': 'E-mail', 'bc.timeline.emailTo': 'Envoyé à {to}', 'bc.timeline.emailGone': 'Le contenu de cet e-mail n’est plus disponible.',

  // sociétés
  'bc.company.name': 'Société', 'bc.company.add': 'Ajouter une société', 'bc.company.create': 'Créer la société', 'bc.company.search': 'Rechercher des sociétés', 'bc.company.mainContact': 'Contact principal', 'bc.company.locations': 'Établissements',
  'bc.company.since': 'Cliente depuis', 'bc.company.emptyTitle': 'Vendez aux entreprises', 'bc.company.emptyBody': 'Les sociétés regroupent les acheteurs d’une entreprise, avec leurs établissements, informations fiscales et conditions de paiement. Ajoutez-en une pour passer des commandes à son nom.',
  'bc.company.deleteTitle': 'Supprimer {n} sociétés ?', 'bc.company.deleteTitle.one': 'Supprimer cette société ?', 'bc.company.deleteBody': 'Les établissements et les liens avec les contacts sont supprimés. Les clients et les commandes passées restent.',
  'bc.company.deleted': '{n} sociétés supprimées', 'bc.company.deleted.one': 'Société supprimée', 'bc.company.externalId': 'Identifiant externe', 'bc.company.externalIdHelp': 'L’identifiant de la société dans votre comptabilité ou votre ERP.',
  'bc.company.firstLocation': 'Premier établissement', 'bc.company.taxId': 'Numéro de TVA / d’immatriculation', 'bc.company.terms': 'Conditions de paiement', 'bc.company.termsHelp': 'Quand la société paie après sa commande.', 'bc.company.taxExempt': 'Exonérée de taxe',
  'bc.company.terms.none': 'Paiement à la commande', 'bc.company.terms.receipt': 'À réception', 'bc.company.terms.net': 'Net {n} jours',
  'bc.company.addLocation': 'Ajouter un établissement', 'bc.company.editLocation': 'Modifier l’établissement', 'bc.company.locationName': 'Nom de l’établissement', 'bc.company.noAddress': 'Aucune adresse', 'bc.company.contacts': 'Contacts', 'bc.company.addContact': 'Ajouter un contact',
  'bc.company.noContacts': 'Aucun contact pour l’instant. Ajoutez un client pour qu’il puisse acheter au nom de cette société.', 'bc.company.main': 'Contact principal', 'bc.company.makeMain': 'Définir comme contact principal', 'bc.company.editTitle': 'Modifier la fonction',
  'bc.company.contactTitle': 'Fonction', 'bc.company.removeContact': 'Retirer de la société', 'bc.company.details': 'Détails', 'bc.company.openDrafts': 'Brouillons ouverts', 'bc.company.saved': 'Société enregistrée',
  'bc.company.notFound': 'Cette société n’existe pas.', 'bc.company.deleteLocationTitle': 'Supprimer cet établissement ?', 'bc.company.deleteLocationBody': 'Une société doit avoir au moins un établissement, et un établissement avec des commandes ne peut pas être supprimé.',
  'bc.company.addTitle': 'Ajouter {n} clients à une société', 'bc.company.addTitle.one': 'Ajouter 1 client à une société', 'bc.company.none': 'Aucune société trouvée.', 'bc.company.noneYet': 'Ne fait partie d’aucune société.',
  'bc.company.added': '{n} clients ajoutés à la société', 'bc.company.added.one': '1 client ajouté à la société', 'bc.company.addedSome': '{n} ajoutés, {failed} ignorés (déjà contacts)',
  'bc.draft.title': 'Société de cette commande', 'bc.draft.change': 'Changer de société', 'bc.draft.remove': 'Retirer la société', 'bc.draft.none': 'Aucune société. La commande est destinée à un particulier.', 'bc.draft.location': 'Établissement', 'bc.draft.contact': 'Contact',
  'bc.draft.contactHelp': 'Choisir un contact définit aussi le client du brouillon s’il n’en a pas.', 'bc.draft.noContact': 'Aucun contact', 'bc.draft.other': 'Autre société', 'bc.draft.saved': 'Société enregistrée sur le brouillon', 'bc.draft.loadFailed': 'La société n’a pas pu être chargée.',

  // contenu
  'bc.template.preview': 'Prévisualiser le modèle', 'bc.files.type.model': 'Modèles 3D', 'bc.files.model': 'Fichier de modèle 3D',
  'bc.prefs.viewStore': 'Voir votre boutique', 'bc.prefs.copyUrl': 'Copier le lien de la boutique', 'bc.prefs.copied': 'Lien copié', 'bc.prefs.passwordOn': 'Activer la protection par mot de passe', 'bc.prefs.passwordOff': 'Désactiver la protection par mot de passe',
  'bc.prefs.b2bOnly': 'Réserver l’accès aux clients B2B', 'bc.prefs.b2bOnlyHelp': 'Les visiteurs doivent se connecter avec un compte client rattaché à une société. Les pages de compte restent ouvertes pour qu’ils puissent se connecter.', 'bc.prefs.manageCompanies': 'Gérer les sociétés',
  'bc.prefs.shareImage': 'Image de partage sur les réseaux sociaux', 'bc.prefs.addShareImage': 'Ajouter une image', 'bc.prefs.shareImageHelp': 'Affichée quand votre page d’accueil est partagée sur les réseaux sociaux. 1200 x 628 px convient le mieux.', 'bc.prefs.homeTitle': 'Titre de la page d’accueil',
  'bc.mo.view': 'Vue', 'bc.mo.view.all': 'Toutes les définitions', 'bc.mo.view.web': 'Avec pages web', 'bc.mo.view.entries': 'Avec des entrées', 'bc.mo.view.empty': 'Sans entrée', 'bc.mo.showSystem': 'Afficher les définitions système', 'bc.mo.hideSystem': 'Masquer les définitions système',
  'bc.mo.externalId': 'Identifiant externe', 'bc.mo.externalIdHelp': 'L’identifiant de l’entrée dans un autre système. Il doit être unique pour ce type.', 'bc.menus.drag': 'Glisser pour réordonner',

  // statistiques
  'bc.analytics.refreshed': 'Actualisé à {time}', 'bc.analytics.currency': 'Devise', 'bc.analytics.fulfilled': 'Commandes expédiées', 'bc.analytics.live': 'Vue en direct',
  'bc.reports.lastViewed': 'Consulté le', 'bc.reports.createdBy': 'Créé par', 'bc.reports.pin': 'Épingler {name}', 'bc.reports.unpin': 'Désépingler {name}', 'bc.reports.range': '{from}-{to} sur {n}',
  'bc.explore.new': 'Nouvelle exploration', 'bc.explore.category': 'Exploration', 'bc.explore.you': 'Vous', 'bc.explore.untitled': 'Nouvelle exploration', 'bc.explore.save': 'Enregistrer', 'bc.explore.saved': 'Exploration enregistrée', 'bc.explore.saveTitle': 'Enregistrer l’exploration',
  'bc.explore.rename': 'Renommer', 'bc.explore.deleteTitle': 'Supprimer cette exploration ?', 'bc.explore.deleteBody': 'Le rapport enregistré est supprimé. Vos données ne sont pas touchées.', 'bc.explore.notFound': 'Cette exploration n’existe pas.',
  'bc.explore.dataset': 'Données', 'bc.explore.dimension': 'Ventiler par', 'bc.explore.noDimension': 'Rien (un seul total)', 'bc.explore.total': 'Total', 'bc.explore.pickMetric': 'Choisissez au moins un indicateur.',
  'bc.explore.compareHelp': 'La comparaison exige une ventilation par jour, semaine ou mois.', 'bc.explore.filterHelp': 'Les filtres texte ignorent la casse. « ~ » signifie contient.',
  'bc.dataset.ORDERS': 'Commandes', 'bc.dataset.PRODUCTS': 'Produits vendus', 'bc.dataset.CUSTOMERS': 'Clients', 'bc.dataset.SESSIONS': 'Sessions de la boutique en ligne',
  'bc.viz.LINE': 'Courbe', 'bc.viz.BAR': 'Histogramme', 'bc.viz.TABLE': 'Tableau seul',
  'bc.controls.toggle': 'Contrôles', 'bc.controls.title': 'Contrôles du rapport', 'bc.controls.metrics': 'Indicateurs', 'bc.controls.dimension': 'Ventiler par', 'bc.controls.viz': 'Visualisation', 'bc.controls.chartMetric': 'Indicateur du graphique',
  'bc.controls.cumulative': 'Cumulé', 'bc.controls.filters': 'Filtres', 'bc.controls.addFilter': 'Ajouter un filtre', 'bc.controls.filterField': 'Colonne du filtre', 'bc.controls.filterOp': 'Opérateur du filtre', 'bc.controls.filterValue': 'Valeur du filtre',
  'bc.controls.filterHelp': 'Les filtres s’appliquent aux lignes du tableau.',
  'bc.query.label': 'Requête du rapport', 'bc.query.refine': 'Affiner la requête',
  'bc.query.error.unterminated': 'Un guillemet n’est pas fermé : {token}', 'bc.query.error.unexpected': 'Caractère inattendu : {token}', 'bc.query.error.expectedKeyword': 'Une clause (SHOW, BY, WHERE, SINCE...) est attendue avant « {token} ».',
  'bc.query.error.duplicateClause': '{token} apparaît deux fois.', 'bc.query.error.expectedName': 'Un nom est attendu, pas « {token} ».', 'bc.query.error.emptyClause': '{token} attend une valeur.', 'bc.query.error.expectedField': 'WHERE attend un nom de colonne.',
  'bc.query.error.expectedOperator': 'Ajoutez un opérateur (=, !=, ~, >, <) après « {token} ».', 'bc.query.error.expectedValue': 'Ajoutez une valeur après l’opérateur pour « {token} ».', 'bc.query.error.badDate': '« {token} » n’est pas une date (utilisez AAAA-MM-JJ).',
  'bc.query.error.badCompare': '« {token} » n’est pas une comparaison. Utilisez none, previous_period ou previous_year.', 'bc.query.error.badVisualization': '« {token} » n’est pas une visualisation. Utilisez table, line ou bar.',
  'bc.query.error.badReport': '« {token} » n’est pas un rapport.', 'bc.query.error.badSince': '« {token} » n’est pas une période. Utilisez last_7_days, last_30_days, this_month... ou une date.', 'bc.query.error.badDataset': '« {token} » n’est pas un jeu de données. Utilisez orders, products, customers ou sessions.',
  'bc.query.error.badMetric': '« {token} » n’est pas un indicateur de ce rapport.', 'bc.query.error.badDimension': '« {token} » ne peut pas suivre BY ici.', 'bc.query.error.badField': '« {token} » ne peut pas être filtré ici.',
  'bc.slider.start': 'Début du zoom', 'bc.slider.end': 'Fin du zoom', 'bc.slider.reset': 'Afficher toute la période',
  'bc.annotations.toggle': 'Annotations', 'bc.annotations.title': 'Annotations', 'bc.annotations.day': 'Date', 'bc.annotations.text': 'Note', 'bc.annotations.placeholder': 'Lancement des soldes d’été', 'bc.annotations.onlyThis': 'Sur ce rapport uniquement',
  'bc.annotations.add': 'Ajouter la note', 'bc.annotations.none': 'Aucune note sur cette période.', 'bc.annotations.allReports': 'Tous les rapports',
  'bc.goal.button': 'Objectifs', 'bc.goal.title': 'Objectifs', 'bc.goal.intro': 'Fixez une cible pour un indicateur sur une période calendaire. La progression s’affiche sur la vue d’ensemble.', 'bc.goal.metric': 'Indicateur', 'bc.goal.period': 'Période', 'bc.goal.target': 'Cible',
  'bc.goal.add': 'Définir l’objectif', 'bc.goal.update': 'Mettre à jour l’objectif', 'bc.goal.saved': 'Objectif enregistré',
  'bc.goal.metric.TOTAL_SALES': 'Ventes totales', 'bc.goal.metric.ORDERS': 'Commandes', 'bc.goal.metric.AVERAGE_ORDER_VALUE': 'Panier moyen', 'bc.goal.metric.SESSIONS': 'Sessions',
  'bc.goal.period.WEEK': 'Cette semaine', 'bc.goal.period.MONTH': 'Ce mois', 'bc.goal.period.QUARTER': 'Ce trimestre', 'bc.goal.period.YEAR': 'Cette année',
  'bc.goal.reached': 'Objectif atteint ({pct} %)', 'bc.goal.onTrack': 'Dans les temps ({pct} %)', 'bc.goal.behind': 'En retard sur le rythme ({pct} %)',
  'bc.report.profitNote': 'Le profit utilise le coût par article renseigné sur chaque variante. Les articles sans coût comptent pour un coût nul.',
  'bc.live.updated': 'Actualisé à {time}', 'bc.live.visitors': 'Visiteurs en ce moment', 'bc.live.visitorsHint': 'Au cours des 5 dernières minutes', 'bc.live.sessions': 'Sessions aujourd’hui', 'bc.live.orders': 'Commandes aujourd’hui', 'bc.live.sales': 'Ventes aujourd’hui',
  'bc.live.carts': 'Paniers actifs', 'bc.live.cartsHint': 'Mis à jour au cours des 30 dernières minutes', 'bc.live.perMinute': 'Pages vues par minute, 30 dernières minutes', 'bc.live.views': 'Pages vues', 'bc.live.topPages': 'Pages les plus vues', 'bc.live.topSources': 'Sources de trafic',
  'bc.live.recentOrders': 'Dernières commandes', 'bc.live.quiet': 'Aucune visite au cours des 30 dernières minutes.', 'bc.live.noOrders': 'Aucune commande au cours des dernières 24 heures.', 'bc.live.direct': 'Direct',
  'bc.live.mapNote': 'Il n’y a pas de carte des visiteurs : ShopMe ne conserve ni adresses IP ni localisations.',

  // noms des dimensions, indicateurs et filtres
  'bc.dim.day': 'Jour', 'bc.dim.week': 'Semaine', 'bc.dim.month': 'Mois', 'bc.dim.channel': 'Canal de vente', 'bc.dim.financial_status': 'Statut du paiement', 'bc.dim.fulfillment_status': 'Statut de préparation', 'bc.dim.country': 'Pays de livraison',
  'bc.dim.currency': 'Devise', 'bc.dim.weekday': 'Jour de la semaine', 'bc.dim.hour': 'Heure du jour', 'bc.dim.customer_type': 'Type de client', 'bc.dim.product': 'Produit', 'bc.dim.variant': 'Variante', 'bc.dim.vendor': 'Fournisseur', 'bc.dim.sku': 'UGS',
  'bc.dim.customer': 'Client', 'bc.dim.subscription': 'Abonnement e-mail', 'bc.dim.language': 'Langue', 'bc.dim.source': 'Source de trafic', 'bc.dim.page': 'Page',
  'bc.metric.gross_sales': 'Ventes brutes', 'bc.metric.total_sales': 'Ventes totales', 'bc.metric.avg_price': 'Prix unitaire moyen', 'bc.metric.sales': 'Ventes', 'bc.metric.avg_order': 'Panier moyen',
  'bc.metric.fulfilled': 'Commandes expédiées', 'bc.metric.channel': 'Canal de vente', 'bc.metric.gateway': 'Moyen de paiement', 'bc.metric.paid': 'Payé', 'bc.metric.refunded': 'Remboursé', 'bc.metric.country': 'Pays',
  'bc.metric.new_orders': 'Commandes de nouveaux clients', 'bc.metric.returning_orders': 'Commandes de clients récurrents', 'bc.metric.new_sales': 'Ventes aux nouveaux clients', 'bc.metric.returning_sales': 'Ventes aux clients récurrents',
  'bc.metric.cost': 'Coût des marchandises', 'bc.metric.profit': 'Profit', 'bc.metric.margin': 'Marge', 'bc.metric.source': 'Source de trafic', 'bc.metric.path': 'Page', 'bc.metric.cohort': 'Mois de la première commande',
  'bc.metric.m0': 'Mois 0', 'bc.metric.m1': 'Mois 1', 'bc.metric.m2': 'Mois 2', 'bc.metric.m3': 'Mois 3', 'bc.metric.m4': 'Mois 4', 'bc.metric.m5': 'Mois 5',
  'bc.metric.segment': 'Groupe RFM', 'bc.metric.average': 'Dépense moyenne', 'bc.metric.stock': 'Unités en stock', 'bc.metric.sold': 'Unités vendues', 'bc.metric.sell_through': 'Taux d’écoulement', 'bc.metric.share': 'Part des ventes',
  'bc.metric.cumulative': 'Part cumulée', 'bc.metric.class': 'Classe ABC',
  'bc.filter.channel': 'Canal de vente', 'bc.filter.financial_status': 'Statut du paiement', 'bc.filter.fulfillment_status': 'Statut de préparation', 'bc.filter.country': 'Pays de livraison', 'bc.filter.currency': 'Devise', 'bc.filter.tag': 'Tag',
  'bc.filter.total': 'Total de la commande (unités mineures)', 'bc.filter.product': 'Produit', 'bc.filter.vendor': 'Fournisseur', 'bc.filter.sku': 'UGS', 'bc.filter.quantity': 'Quantité', 'bc.filter.customer': 'Client', 'bc.filter.subscription': 'Abonnement e-mail',
  'bc.filter.language': 'Langue', 'bc.filter.source': 'Source de trafic', 'bc.filter.page': 'Page',
  'bc.value.channel.web': 'Boutique en ligne', 'bc.value.channel.draft_order': 'Brouillons de commande', 'bc.value.channel.pos': 'Point de vente', 'bc.value.channel.manual': 'Manuel',
  'bc.value.gateway.manual': 'Manuel', 'bc.value.gateway.stripe': 'Carte bancaire', 'bc.value.gateway.cod': 'Paiement à la livraison', 'bc.value.gateway.bank_transfer': 'Virement bancaire', 'bc.value.gateway.gift_card': 'Carte cadeau', 'bc.value.gateway.store_credit': 'Crédit en magasin', 'bc.value.gateway.free': 'Aucun paiement dû',
  'bc.value.source.direct': 'Direct',
  'bc.value.segment.CHAMPIONS': 'Champions', 'bc.value.segment.LOYAL': 'Fidèles', 'bc.value.segment.ACTIVE': 'Actifs', 'bc.value.segment.NEW': 'Nouveaux', 'bc.value.segment.PROMISING': 'Prometteurs', 'bc.value.segment.NEEDS_ATTENTION': 'À surveiller',
  'bc.value.segment.ALMOST_LOST': 'Presque perdus', 'bc.value.segment.PREVIOUSLY_LOYAL': 'Anciens fidèles', 'bc.value.segment.AT_RISK': 'À risque', 'bc.value.segment.DORMANT': 'Inactifs', 'bc.value.segment.PROSPECTS': 'Prospects',

  // noms et catégories des rapports
  'analytics.report.SALES_BY_CHANNEL': 'Ventes par canal', 'analytics.report.SALES_BY_PAYMENT_METHOD': 'Ventes par moyen de paiement', 'analytics.report.SALES_BY_COUNTRY': 'Ventes par pays', 'analytics.report.NEW_VS_RETURNING': 'Nouveaux clients et clients récurrents',
  'analytics.report.PROFIT_BY_PRODUCT': 'Profit par produit', 'analytics.report.ACQUISITION_BY_REFERRER': 'Acquisition par source de trafic', 'analytics.report.TOP_PAGES': 'Pages les plus vues', 'analytics.report.CUSTOMER_COHORTS': 'Cohortes de clients',
  'analytics.report.RFM_SEGMENTS': 'Clients par groupe RFM', 'analytics.report.SELL_THROUGH': 'Taux d’écoulement par produit', 'analytics.report.ABC_ANALYSIS': 'Analyse ABC des produits', 'analytics.category.profit': 'Profit',
};
