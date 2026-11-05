// Saved views, variants table, shipping fields, gift card products, inventory bulk actions, products metrics.
export const enViews = {
  'views.tabs': 'Views', 'views.add': 'Save current search as a view', 'views.saveAs': 'Save view as', 'views.name': 'View name', 'views.nameRequired': 'Enter a name for the view.',
  'views.saveHelp': 'The search, filters and sort order are saved. Everyone on your team can use this view.', 'views.save': 'Save', 'views.saved': 'View saved', 'views.updated': 'View updated',
  'views.deleted': 'View deleted', 'views.saveChanges': 'Save changes', 'views.discard': 'Discard changes', 'views.rename': 'Rename view', 'views.duplicate': 'Duplicate view',
  'views.copyOf': '{name} (copy)', 'views.actions': 'Actions for the view {name}', 'views.deleteTitle': 'Delete the view "{name}"?', 'views.deleteBody': 'The view is removed for everyone. Your products, orders and customers are not affected.',

  'variants.search': 'Search variants', 'variants.filterBy': 'Filter by {name}', 'variants.noMatch': 'No variant matches your search.', 'variants.add': 'Add variant', 'variants.addConfirm': 'Add variant',
  'variants.addHelp': 'Choose a value for each option. A new value is added to the option.', 'variants.addMissing': 'Enter a value for every option.', 'variants.addExists': 'A variant with these values already exists.',
  'variants.duplicateTitle': 'Duplicate variant', 'variants.editValues': 'Edit option values', 'variants.duplicate': 'Duplicate', 'variants.actions': 'Actions for', 'variants.select': 'Select',
  'variants.bulkActions': 'Variant actions', 'variants.editPrices': 'Edit prices', 'variants.editQuantities': 'Edit quantities', 'variants.deleteSelected': 'Delete variants', 'variants.clearSelection': 'Clear selection',
  'variants.editPricesTitle': 'Edit prices of {n} variants', 'variants.editPricesTitle.one': 'Edit price of {n} variant', 'variants.leaveEmpty': 'Leave a field empty to keep the current values.',
  'variants.editQuantitiesTitle': 'Edit quantities of {n} variants', 'variants.editQuantitiesTitle.one': 'Edit quantities of {n} variant', 'variants.quantitiesHelp': 'Sets the available quantity of the variants that track inventory. Leave a location empty to keep its quantities.',
  'variants.deleteTitle': 'Delete {n} variants?', 'variants.deleteTitle.one': 'Delete {n} variant?', 'variants.deleteBody': 'The variants are removed when you save the product. A product keeps at least one variant.',

  'shipping.dimensions': 'Package dimensions', 'shipping.length': 'Length', 'shipping.width': 'Width', 'shipping.height': 'Height', 'shipping.dimensionUnit': 'Dimension unit',
  'shipping.origin': 'Country/region of origin', 'shipping.noOrigin': 'Not specified', 'shipping.hsCode': 'Harmonized System (HS) code', 'shipping.hsCodeHelp': 'Used for customs on international orders.',
  'lengthUnit.MILLIMETERS': 'mm', 'lengthUnit.CENTIMETERS': 'cm', 'lengthUnit.METERS': 'm', 'lengthUnit.INCHES': 'in', 'lengthUnit.FEET': 'ft', 'lengthUnit.YARDS': 'yd',

  'product.giftCardTitle': 'Gift card', 'product.giftCardBadge': 'Gift card product', 'product.duplicateTitle': 'Duplicate product', 'product.duplicateConfirm': 'Duplicate product',
  'product.duplicateDetails': 'Duplicate product details', 'product.duplicateMedia': 'Media', 'product.duplicateStatus': 'Product status', 'product.duplicateAsDraft': 'Set as draft', 'product.duplicateAsActive': 'Set as active',
  'order.giftCards': 'Gift cards issued', 'order.giftCardsHelp': 'Emailed to the recipient, or to the customer when there is none.',

  'inventory.tabAll': 'All', 'inventory.trackingFilter': 'Tracking', 'inventory.filterTracked': 'Tracked items', 'inventory.filterUntracked': 'Not tracked',
  'inventory.editAvailable': 'Edit available', 'inventory.editOnHand': 'Edit on hand', 'inventory.stopTracking': 'Stop tracking', 'inventory.trackQuantity': 'Track quantity',
  'inventory.editAvailableTitle': 'Edit available quantity of {n} items', 'inventory.editAvailableTitle.one': 'Edit available quantity of {n} item',
  'inventory.editOnHandTitle': 'Edit on hand quantity of {n} items', 'inventory.editOnHandTitle.one': 'Edit on hand quantity of {n} item',
  'inventory.bulkMode': 'Change', 'inventory.bulkSet': 'Set the quantity to', 'inventory.bulkAdjust': 'Add or remove', 'inventory.bulkValue': 'Quantity',
  'inventory.tracking.on': 'Tracking turned on for {n} items', 'inventory.tracking.on.one': 'Tracking turned on for {n} item',
  'inventory.tracking.off': 'Tracking turned off for {n} items', 'inventory.tracking.off.one': 'Tracking turned off for {n} item',

  'products.addTags': 'Add tags', 'products.removeTags': 'Remove tags', 'products.addToCollections': 'Add to collections', 'products.removeFromCollections': 'Remove from collections',
  'metrics.title': 'Products metrics', 'metrics.days': '{n} days', 'metrics.sellThrough': 'Average sell-through rate', 'metrics.sellThroughHelp': 'Units sold divided by units sold plus units in stock, over the period.',
  'metrics.daysLeft': 'Days of stock remaining', 'metrics.daysLeftHelp': 'Units in stock divided by the average units sold per day over the period.', 'metrics.daysValue': '{n} days',
  'metrics.abc': 'ABC analysis of products', 'metrics.abcHelp': 'Products ranked by revenue: A makes the first 80%, B the next 15%, C the rest and the products that did not sell.',
  'metrics.abcValue': 'A {a} · B {b} · C {c}', 'metrics.noData': 'No data',
} as const;
