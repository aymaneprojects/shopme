// Labels added during the screen-by-screen fidelity pass (orders, customers, products, shipping, markets, content, theme editor).
export const enFidelity = {
  // orders list
  'fid.orders.colPayment': 'Payment status', 'fid.orders.colFulfillment': 'Fulfillment status',
  'fid.orders.moveToBatch': 'Move to batch', 'fid.orders.move': 'Move',
  'fid.labels.blockedTitle': 'Can’t create shipping labels',
  'fid.labels.blockedBody': 'The selected orders aren’t eligible for shipping labels.', 'fid.labels.blockedBody.one': 'The selected order isn’t eligible for shipping labels.',
  'fid.labels.noItems': '{n} orders have no items that need fulfillment:', 'fid.labels.noItems.one': '{n} order has no items that need fulfillment:',
  'fid.labels.labelled': '{n} orders already have a label or are fulfilled:', 'fid.labels.labelled.one': '{n} order already has a label or is fulfilled:',
  'fid.orders.todayAt': 'Today at {time}', 'fid.orders.yesterdayAt': 'Yesterday at {time}',
  'fid.timeline.fromDraft': 'Created from draft order {name}',
  'fid.cmd.channels': 'Sales channels', 'fid.shell.language': 'Admin language', 'fid.shell.theme': 'Admin theme',
  // customers
  'fid.customers.search': 'Search customers', 'fid.customers.tagTitle': 'Tag {n} customers', 'fid.customers.tagTitle.one': 'Tag {n} customer', 'fid.customers.delete': 'Delete customer', 'fid.customers.noNote': 'None',
  // export dialog
  'fid.export.productsBody': 'This CSV file updates every product detail except stock quantities. To update quantities across several locations, use the', 'fid.export.inventoryCsv': 'inventory CSV file', 'fid.export.or': 'or', 'fid.export.bulkEditor': 'the bulk editor',
  'fid.export.learnMore': 'Learn more', 'fid.export.learnTopic': 'about CSV exports.',
  'fid.export.selected.products': '{n} products selected', 'fid.export.selected.products.one': '{n} product selected', 'fid.export.matching.products': '{n} products matching your search', 'fid.export.matching.products.one': '{n} product matching your search',
  'fid.export.selected.customers': '{n} customers selected', 'fid.export.selected.customers.one': '{n} customer selected', 'fid.export.matching.customers': '{n} customers matching your search', 'fid.export.matching.customers.one': '{n} customer matching your search',
  'fid.export.selected.orders': '{n} orders selected', 'fid.export.selected.orders.one': '{n} order selected', 'fid.export.matching.orders': '{n} orders matching your search', 'fid.export.matching.orders.one': '{n} order matching your search',
  'fid.export.selected.draft_orders': '{n} drafts selected', 'fid.export.selected.draft_orders.one': '{n} draft selected', 'fid.export.matching.draft_orders': '{n} drafts matching your search', 'fid.export.matching.draft_orders.one': '{n} draft matching your search',
  // shipping settings
  'fid.ship.options': 'Shipping options', 'fid.ship.optionsDesc': 'Manage where you ship and what it costs', 'fid.ship.marketsCount': '{n} markets', 'fid.ship.marketsCount.one': '{n} market',
  'fid.ship.market': 'Market', 'fid.ship.optionsCol': 'Options', 'fid.ship.estimates': 'Estimated delivery dates', 'fid.ship.estimatesDesc': 'Tell customers when they can expect their orders.', 'fid.ship.handlingSummary': '{n} days of handling', 'fid.ship.handlingSummary.one': '{n} day of handling',
  'fid.ship.carriers': 'Carrier accounts', 'fid.ship.carriersDesc': 'Connect a carrier account to quote its own rates at checkout', 'fid.ship.accountsCount': '{n} accounts', 'fid.ship.accountsCount.one': '{n} account', 'fid.ship.none': 'None',
  'fid.ship.routing': 'Order routing', 'fid.ship.routingDesc': 'Choose which location fulfills each new order', 'fid.ship.rulesCount': '{n} rules', 'fid.ship.rulesCount.one': '{n} rule',
  'fid.ship.docName': 'Name', 'fid.ship.docEdit': 'Edit',
  'fid.ship.customDesc': 'Customizations decide how delivery options show to buyers at checkout. You can hide, reorder and rename delivery options.', 'fid.ship.addCustomization': 'Delivery customization',
  'fid.ship.customFulfillment': 'Custom order fulfillment', 'fid.ship.customFulfillmentDesc': 'Add an email to notify anyone who fulfills orders for you', 'fid.ship.addService': 'Fulfillment service',
  'fid.rate.fixed': 'Fixed', 'fid.rate.done': 'Save', 'fid.rate.searchCollections': 'Search collections',
  'fid.priv.selfHosted': 'Your own server (self-hosted)',
  'fid.po.terms': 'Terms',
  'fid.mo.pickType': 'Select field type',
  // theme editor
  'fid.editor.preview': 'Preview', 'fid.editor.support': 'Get support', 'fid.editor.by': 'By {author}',
  // markets
  'fid.markets.activeOptions': '{n} active shipping options', 'fid.markets.activeOptions.one': '{n} active shipping option', 'fid.markets.addShippingOption': 'Add shipping option', 'fid.markets.editOption': 'Edit shipping option', 'fid.markets.policiesPublished': '{n} published', 'fid.markets.policiesPublished.one': '{n} published', 'fid.markets.freeFrom': 'Free from {amount}',
  'fid.markets.businessDay': '{n} business days', 'fid.markets.businessDay.one': '{n} business day', 'fid.markets.businessDays': '{a} to {b} business days', 'fid.markets.collectionsCount': '{n} collections', 'fid.markets.collectionsCount.one': '{n} collection',
  // inventory
  'fid.adjust.onHand': 'Adjust on hand quantity for', 'fid.adjust.resultOnHand': 'On hand: {from} → {to}', 'bp.adjust.mode': 'How to change the quantity',
  // product page
  'fid.dup.barcodes': 'Barcodes', 'fid.product.title': 'Title',
  'fid.viewer.crop': 'Crop and transform', 'fid.viewer.resize': 'Resize', 'fid.viewer.draw': 'Draw', 'fid.viewer.background': 'Background color',
} as const;
