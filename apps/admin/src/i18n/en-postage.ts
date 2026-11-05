// Buying shipping labels: order page dialog, label rows, Settings > Shipping (labels row, carrier accounts) and the labels page.
export const enPostage = {
  // order page
  'postage.buy': 'Buy shipping label', 'postage.title': 'Buy shipping label', 'postage.titleFor': 'Buy shipping label for {name}',
  'postage.shipTo': 'Ship to', 'postage.noAddress': 'This order has no shipping address.', 'postage.items': 'Items',
  'postage.package': 'Package', 'postage.defaultPackage': 'Default package ({name})', 'postage.customPackage': 'No saved package',
  'postage.weight': 'Total weight', 'postage.weightHelp': 'Items weigh {weight}. Add the weight of the packaging.', 'postage.weightNone': 'Enter the weight of the parcel, packaging included.',
  'postage.getRates': 'Get rates', 'postage.rates': 'Rates', 'postage.noRates': 'No carrier offered a rate for this package.',
  'postage.days': '{n} business days', 'postage.days.one': '{n} business day', 'postage.cheapest': 'Cheapest',
  'postage.testBadge': 'Test mode', 'postage.testNotice': 'The test carrier makes sample labels with fake tracking numbers. Nothing is charged and nothing can be shipped with them.',
  'postage.notify': 'Send a shipping confirmation to the customer', 'postage.buyFor': 'Buy label · {price}', 'postage.bought': 'Shipping label bought',
  'postage.print': 'Print label', 'postage.void': 'Void label', 'postage.voidTitle': 'Void this label?',
  'postage.voidBody': 'The carrier is asked to refund the postage, and the fulfillment is cancelled so the items can be shipped again.',
  'postage.keep': 'Keep label', 'postage.voided': 'Label voided', 'postage.voidedRefunded': 'Label voided, postage refunded',
  'postage.noCarrier': 'No carrier account can sell labels yet.', 'postage.setup': 'Set up carrier accounts',
  'postage.label': 'Shipping label', 'postage.cost': 'Postage', 'postage.refunded': 'Refunded', 'postage.notRefunded': 'Not refunded',
  'postage.back': 'Back',
  // Settings > Shipping
  'postage.labelsRow': 'Shipping labels', 'postage.labelsRowDesc': 'Buy and print labels from your carrier accounts',
  'postage.calculate': 'Calculate rates', 'postage.labelsHelp': 'Carrier accounts that sell labels. Labels are bought from an order, in the shipping card.',
  'postage.labelsNone': 'No carrier account sells labels yet. Add one in Carrier accounts, or add the test carrier to try it.',
  'postage.labelCarriers': '{n} carriers', 'postage.labelCarriers.one': '{n} carrier', 'postage.labelsOff': 'Not set up',
  'postage.calcTitle': 'Calculate label rates', 'postage.calcIntro': 'Rates for a parcel sent from your first location to the country you choose.',
  'postage.destination': 'Destination country', 'postage.zip': 'Postal code',
  'postage.accountsRow': 'Carrier accounts', 'postage.accountsRowDesc': 'Connect your own carrier accounts for carrier-calculated rates and labels',
  'postage.accountsNone': 'None', 'postage.accountsCount': '{n} accounts', 'postage.accountsCount.one': '{n} account',
  'postage.carrierRates': 'Carrier-calculated rates', 'postage.labelsYes': 'Labels can be purchased', 'postage.labelsNo': 'Rates only',
  'postage.addTest': 'Add test carrier', 'postage.testName': 'Test carrier', 'postage.testAdded': 'Test carrier added',
  'postage.provider': 'Type', 'postage.providerHttp': 'HTTP carrier service', 'postage.providerTest': 'Test carrier (test mode)',
  'postage.sellsLabels': 'This service also sells shipping labels',
  'postage.sellsLabelsHelp': 'It answers the label rate, purchase and void requests described in the carrier documentation.',
  'postage.testIntro': 'Built-in carrier to try rates and labels: sample prices, PDF labels marked as tests and fake tracking numbers. Remove it before you start selling.',
  // order timeline
  'postage.ev.purchased': 'Shipping label bought from {carrier} ({service}, {tracking})', 'postage.ev.purchasedTest': 'Test shipping label bought from {carrier} ({service}, {tracking})',
  'postage.ev.voided': 'Shipping label voided', 'postage.ev.voidedRefunded': 'Shipping label voided, postage refunded', 'postage.ev.recorded': 'Shipping label recorded ({carrier} {tracking})',
  // labels page
  'postage.sourcePurchased': 'Bought', 'postage.sourceManual': 'Recorded',
  'postage.labelsFooter': 'Buy labels from an order with a carrier account that sells postage, or record labels you bought elsewhere.',
} as const;
