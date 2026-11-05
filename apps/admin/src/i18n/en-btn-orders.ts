// Orders, home and shell buttons: list columns, stats strip, bulk actions, batches, labels, order page extras, drafts, marketing, channels.
export const enBtnOrders = {
  // navigation
  'nav.shippingLabels': 'Shipping labels', 'nav.growth': 'Marketing',

  // orders stats strip
  'btn.stat.title': 'Order figures', 'btn.stat.range': 'Period', 'btn.stat.orders': 'Orders', 'btn.stat.items': 'Items ordered', 'btn.stat.sales': 'Sales', 'btn.stat.returns': 'Returns',
  'btn.stat.fulfilled': 'Orders fulfilled', 'btn.stat.delivered': 'Orders delivered', 'btn.stat.fulfillmentTime': 'Fulfillment time',
  'btn.stat.minutes': '{n} min', 'btn.stat.hours': '{n} h', 'btn.stat.days': '{n} d',
  'btn.range.today': 'Today', 'btn.range.yesterday': 'Yesterday', 'btn.range.7d': 'Last 7 days', 'btn.range.30d': 'Last 30 days',

  // orders list
  'btn.orders.allLocations': 'All locations', 'btn.orders.locationFilter': 'Filter by location', 'btn.orders.addressWarning': 'The shipping address has problems', 'btn.orders.test': 'Test',
  'btn.orders.items': '{n} items', 'btn.orders.items.one': '{n} item', 'btn.orders.itemsList': 'Items in this order',
  'btn.orders.col.fulfillBy': 'Fulfill by', 'btn.orders.col.channel': 'Channel', 'btn.orders.col.deliveryStatus': 'Delivery status', 'btn.orders.col.deliveryMethod': 'Delivery method',
  'btn.orders.col.location': 'Location', 'btn.orders.col.batch': 'Batch', 'btn.orders.col.po': 'PO number',
  'btn.delivery.NOT_FULFILLED': 'Not shipped', 'btn.delivery.IN_TRANSIT': 'In transit', 'btn.delivery.DELIVERED': 'Delivered',
  'btn.filter.delivery': 'Delivery status', 'btn.filter.channel': 'Channel', 'btn.filter.batch': 'Batch', 'btn.filter.noBatch': 'Not in a batch', 'btn.filter.from': 'Created from', 'btn.filter.to': 'Created until',
  'btn.filter.test': 'Test orders', 'btn.filter.testOnly': 'Test orders only', 'btn.filter.noTest': 'Hide test orders',

  // bulk bar
  'btn.bulk.print': 'Print', 'btn.bulk.printOrders': 'Print order pages', 'btn.bulk.printPacking': 'Print packing slips', 'btn.bulk.printInvoices': 'Print invoices',
  'btn.mark.UNFULFILLED': 'Unfulfilled', 'btn.mark.IN_PROGRESS': 'In progress', 'btn.mark.FULFILLED': 'Fulfilled', 'btn.mark.ON_HOLD': 'On hold', 'btn.mark.DELIVERED': 'Delivered',
  'btn.bulk.markedDone': '{n} orders updated', 'btn.bulk.markedDone.one': '{n} order updated', 'btn.bulk.partial': '{ok} updated, {failed} could not be: {reason}',
  'btn.bulk.capture': 'Capture payments', 'btn.bulk.capturedDone': '{n} payments captured', 'btn.bulk.capturedDone.one': '{n} payment captured',
  'btn.bulk.batch': 'Batch', 'btn.bulk.createBatch': 'Create batch', 'btn.bulk.createBatchConfirm': 'Create batch', 'btn.bulk.moveTo': 'Move to {name}', 'btn.bulk.removeFromBatch': 'Remove from batch',
  'btn.bulk.batchName': 'Batch name', 'btn.bulk.batchNamePlaceholder': 'Batch 1', 'btn.bulk.batchHelp': 'The {n} selected orders will be picked and packed together.',
  'btn.bulk.batchCreated': 'Batch {name} created', 'btn.bulk.movedDone': '{n} orders moved', 'btn.bulk.movedDone.one': '{n} order moved', 'btn.print.invoiceTitle': 'Invoice',

  // order page
  'btn.order.testBanner': 'This is a test order: the payment gateway was in test mode, no real money moved.',
  'btn.order.addressProblems': 'Check the shipping address', 'btn.order.reviewAddress': 'Review address problems',
  'btn.order.addrProblem.MISSING_ADDRESS': 'The order has no shipping address.', 'btn.order.addrProblem.NAME_MISSING': 'The recipient name is missing.',
  'btn.order.addrProblem.ADDRESS1_MISSING': 'The street address is missing.', 'btn.order.addrProblem.CITY_MISSING': 'The city is missing.', 'btn.order.addrProblem.ZIP_MISSING': 'The postal code is missing.',
  'btn.order.addrProblem.ZIP_INVALID': 'The postal code does not match the format of the country.', 'btn.order.addrProblem.COUNTRY_MISSING': 'The country is missing.',
  'btn.order.addrProblem.COUNTRY_UNKNOWN': 'The country code is not recognized.', 'btn.order.addrProblem.PHONE_INVALID': 'The phone number looks too short.',
  'btn.order.shipsFrom': 'Ships from this location', 'btn.order.capture': 'Capture payment', 'btn.order.captured': 'Payment captured', 'btn.order.captureFailed': 'The payment could not be captured',
  'btn.order.fulfilment': 'Fulfillment',
  'btn.order.conversion': 'Conversion summary', 'btn.order.learn': 'Learn more', 'btn.order.conversionNone': 'No visit was recorded before this order (the buyer declined analytics, or the order was not placed on the storefront).',
  'btn.order.firstVisit': 'First visit', 'btn.order.landing': 'Landing page', 'btn.order.referrer': 'Referrer', 'btn.order.direct': 'Direct', 'btn.order.pageViews': 'Pages viewed',
  'btn.order.risk': 'Order risk', 'btn.order.riskInfo': 'About the risk read', 'btn.order.riskHelp': 'A simple read from your own data: geography, order value, frequency, email domain and payment failures. It is a hint, not a verdict.',
  'btn.order.riskScore': 'Score {n}/100', 'btn.order.risk.LOW': 'Low risk', 'btn.order.risk.MEDIUM': 'Medium risk', 'btn.order.risk.HIGH': 'High risk',
  'btn.order.signal.BILLING_COUNTRY_DIFFERS': 'Billing and shipping countries differ', 'btn.order.signal.HIGH_VALUE': 'Much higher than a usual order', 'btn.order.signal.REPEATED_ORDERS': 'Several orders from this email in a day',
  'btn.order.signal.DISPOSABLE_EMAIL': 'Disposable email domain', 'btn.order.signal.ADDRESS_PROBLEMS': 'The shipping address has problems', 'btn.order.signal.PAYMENT_FAILED': 'A payment attempt failed',
  'btn.order.signal.PREVIOUS_FRAUD': 'An earlier order of this buyer was cancelled for fraud', 'btn.order.signal.NEW_CUSTOMER_HIGH_VALUE': 'New customer with a large order',

  // timeline
  'btn.timeline.attach': 'Attach files', 'btn.timeline.attachments': 'Attached files', 'btn.timeline.confirmation': 'Confirmation number {number} was generated for this order.',
  'btn.timeline.delivered': 'The order was marked as delivered.', 'btn.timeline.showEmail': 'Show email', 'btn.timeline.emailTitle': 'Email sent to the customer', 'btn.timeline.emailTo': 'Sent to {to}',
  'btn.timeline.paymentDetails': 'Payment details',
  'btn.timeline.tx.SALE': 'Payment', 'btn.timeline.tx.CAPTURE': 'Capture', 'btn.timeline.tx.AUTHORIZATION': 'Authorization', 'btn.timeline.tx.VOID': 'Void', 'btn.timeline.tx.REFUND': 'Refund', 'btn.timeline.tx.CHANGE': 'Change',

  // refund and edit
  'btn.refund.amount': 'Refund amount', 'btn.refund.amountHelp': 'Edit the amount to refund a different sum than the items picked.', 'btn.refund.amountLocked': 'The amount follows the items picked for this refund method.',
  'btn.edit.customItem': 'Custom item', 'btn.edit.taxable': 'Charge tax on this item', 'btn.edit.requiresShipping': 'This item needs shipping', 'btn.edit.addDiscount': 'Add custom discount',
  'btn.edit.discountType': 'Discount type', 'btn.edit.discountAmount': 'Amount', 'btn.edit.discountReason': 'Reason shown with the discount', 'btn.edit.addShipping': 'Add shipping fees',
  'btn.edit.feeName': 'Name', 'btn.edit.feeDefault': 'Shipping fee',

  // shipping labels
  'btn.labels.title': 'Shipping labels', 'btn.labels.tabAwaiting': 'Awaiting a label ({n})', 'btn.labels.tabLabels': 'Labels', 'btn.labels.tabVoided': 'Voided',
  'btn.labels.add': 'Add label', 'btn.labels.addMany': 'Add labels', 'btn.labels.destination': 'Destination', 'btn.labels.carrier': 'Carrier', 'btn.labels.service': 'Service', 'btn.labels.servicePlaceholder': 'For example Colissimo, Express',
  'btn.labels.tracking': 'Tracking number', 'btn.labels.trackingUrl': 'Tracking link', 'btn.labels.cost': 'Cost', 'btn.labels.contents': 'Contents', 'btn.labels.print': 'Print', 'btn.labels.void': 'Void',
  'btn.labels.voided': 'Label voided', 'btn.labels.save': 'Save labels', 'btn.labels.notify': 'Send the shipping confirmation to the customers',
  'btn.labels.dialogTitle': 'Add labels for {n} orders', 'btn.labels.dialogTitle.one': 'Add a label for {n} order', 'btn.labels.created': '{n} labels saved, orders fulfilled', 'btn.labels.created.one': '{n} label saved, order fulfilled',
  'btn.labels.manualHelp': 'Buy the postage from your carrier, then enter its tracking number here. The order is fulfilled with that tracking and the customer can be notified.',
  'btn.labels.noPurchase': 'ShopMe records labels you bought from a carrier; it does not buy postage for you.', 'btn.labels.noneNeeded': 'Those orders already have a label or cannot be shipped.',
  'btn.labels.emptyAwaitingTitle': 'No order is waiting for a label', 'btn.labels.emptyAwaitingBody': 'Open orders with items to ship appear here.',
  'btn.labels.emptyLabelsTitle': 'No labels yet', 'btn.labels.emptyVoidedTitle': 'No voided labels', 'btn.labels.emptyLabelsBody': 'Labels you record show up here with their tracking number.',

  // drafts
  'btn.draft.view': 'View', 'btn.draft.market': 'Market', 'btn.draft.noMarket': 'No market', 'btn.draft.marketHelp': 'Quotes the total in the market currency. The order itself is created in {currency}.',
  'btn.draft.presentment': 'In the market currency', 'btn.draft.estimatedTax': 'Estimated tax', 'btn.draft.taxHelp': 'Tax is calculated from the shipping address country. Add an address to get the exact amount.',
  'btn.draft.taxNotCalculated': 'Not calculated yet', 'btn.draft.createCustomer': 'Create a new customer', 'btn.draft.createCustomerSave': 'Create customer',
  'btn.draft.saving': 'Saving...', 'btn.draft.saved': 'All changes saved', 'btn.draft.pending': 'Saving automatically in a moment...', 'btn.draft.addToSave': 'Add a product: the draft is saved automatically.',

  // product picker, search, share
  'btn.picker.searchBy': 'Search by', 'btn.picker.by.all': 'All', 'btn.picker.by.title': 'Title', 'btn.picker.addFilter': 'Add filter', 'btn.picker.lowStock': 'Low stock', 'btn.picker.outOfStock': 'Out of stock',
  'btn.cmd.refine': 'Refine the search', 'btn.cmd.include': 'Include', 'btn.share.saveFirst': 'Save your changes before sharing',

  // home
  'btn.home.launched': 'Your store is live', 'btn.home.launchTitle': 'Launch your online store?', 'btn.home.launchBody': 'The storefront password is removed and everyone can visit your store.',
  'btn.home.growth': 'Marketing', 'btn.home.growthOpen': 'Open marketing', 'btn.home.growthBody': 'Create campaigns and see which ones bring orders.',
  'btn.home.growthSummary': '{campaigns} active campaigns, {orders} orders attributed in the last 30 days.',

  // marketing
  'btn.mkt.title': 'Marketing', 'btn.mkt.create': 'Create campaign', 'btn.mkt.createTitle': 'Create campaign', 'btn.mkt.editTitle': 'Edit campaign', 'btn.mkt.campaigns': 'Campaigns', 'btn.mkt.attribution': 'Attribution',
  'btn.mkt.name': 'Name', 'btn.mkt.channel': 'Channel', 'btn.mkt.budget': 'Budget', 'btn.mkt.starts': 'Starts', 'btn.mkt.ends': 'Ends', 'btn.mkt.notes': 'Notes', 'btn.mkt.utm': 'Campaign tags',
  'btn.mkt.utmSource': 'Source (utm_source)', 'btn.mkt.utmMedium': 'Medium (utm_medium)', 'btn.mkt.utmCampaign': 'Campaign (utm_campaign)', 'btn.mkt.utmHelp': 'Visits that arrive with these tags are credited to this campaign.',
  'btn.mkt.copyLink': 'Copy the link', 'btn.mkt.linkCopied': 'Link copied', 'btn.mkt.saved': 'Campaign saved', 'btn.mkt.created': 'Campaign created', 'btn.mkt.deleted': 'Campaign deleted',
  'btn.mkt.deleteTitle': 'Delete {name}?', 'btn.mkt.deleteBody': 'Orders keep their attribution; only the campaign entry is removed.',
  'btn.mkt.emptyTitle': 'No campaigns yet', 'btn.mkt.emptyBody': 'Create a campaign, share its tagged link and see the orders it brings.',
  'btn.mkt.activeCampaigns': 'Active campaigns', 'btn.mkt.attributedOrders': 'Orders with a known source', 'btn.mkt.attributedHelp': 'Orders placed after a tracked storefront visit.', 'btn.mkt.totalSales': 'Sales in the period',
  'btn.mkt.attributionEmpty': 'No attributed orders in this period.', 'btn.mkt.source': 'Source', 'btn.mkt.pageViews': 'Page views', 'btn.mkt.period': 'Period', 'btn.mkt.days': '{n} days',
  'btn.mkt.channel.email': 'Email', 'btn.mkt.channel.social': 'Social media', 'btn.mkt.channel.search': 'Search ads', 'btn.mkt.channel.display': 'Display ads', 'btn.mkt.channel.affiliate': 'Affiliate',
  'btn.mkt.channel.influencer': 'Influencer', 'btn.mkt.channel.other': 'Other',
  'btn.mkt.status.DRAFT': 'Draft', 'btn.mkt.status.ACTIVE': 'Active', 'btn.mkt.status.ENDED': 'Ended',

  // sales channels
  'btn.channels.active': 'Active', 'btn.channels.inactive': 'Inactive', 'btn.channels.catalog': 'Published products', 'btn.channels.catalogValue': '{published} of {total}', 'btn.channels.publishAll': 'Publish all products',
  'btn.channels.manageTheme': 'Manage themes', 'btn.channels.published': '{n} products published', 'btn.channels.published.one': '{n} product published', 'btn.channels.unpublished': '{n} products unpublished', 'btn.channels.unpublished.one': '{n} product unpublished',
  'btn.channels.online-store': 'Online store', 'btn.channels.online-store.body': 'Your storefront. Products must be published to it to be sold.',
  'btn.channels.draft-orders': 'Draft orders', 'btn.channels.draft-orders.body': 'Orders you create by hand and send to customers as an invoice.',
  'btn.channels.manual': 'Manual', 'btn.channels.manual.body': 'Orders entered by staff in person or by phone.',

  // "Learn more" topics
  'btn.learn.collections': 'collections', 'btn.learn.orders': 'orders', 'btn.learn.refunds': 'refunds', 'btn.learn.orderEdit': 'editing orders', 'btn.learn.drafts': 'draft orders', 'btn.learn.abandoned': 'abandoned checkouts',
  'btn.learn.labels': 'shipping labels', 'btn.learn.discounts': 'discounts', 'btn.learn.pages': 'pages', 'btn.learn.users': 'users and permissions', 'btn.learn.policies': 'policies', 'btn.learn.payments': 'payments',
  'btn.learn.pickup': 'local pickup', 'btn.learn.localDelivery': 'local delivery', 'btn.learn.taxes': 'taxes and duties', 'btn.learn.domains': 'domains', 'btn.learn.languages': 'languages', 'btn.learn.events': 'pixels',
  'btn.learn.marketing': 'marketing', 'btn.learn.channels': 'sales channels',
} as const;
