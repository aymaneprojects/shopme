// Products, discounts and markets buttons: sales channels, catalogs, stock tools, media editor, rollouts.
export const enBtnProducts = {
  // Combobox
  'bp.combo.use': 'Use "{value}"',
  // Sales channels
  'bp.channels.title': 'Sales channels', 'bp.channels.manage': 'Manage sales channels', 'bp.channels.none': 'No sales channel',
  'bp.channels.on': 'Published', 'bp.channels.off': 'Not published', 'bp.channels.scheduled': 'Scheduled {date}',
  'bp.channels.count': 'Published on {n} channels', 'bp.channels.count.one': 'Published on {n} channel',
  'bp.channels.countShort': '{n} channels', 'bp.channels.countShort.one': '{n} channel',
  'bp.channels.help': 'Choose where this is sold. Pick a date to publish it later.', 'bp.channels.publishOn': 'Publish on',
  // Catalogs
  'bp.catalogs.title': 'Catalogs', 'bp.catalogs.manage': 'Manage catalogs', 'bp.catalogs.none': 'No catalog', 'bp.catalogs.empty': 'There is no catalog yet. Create one in Markets.',
  'bp.catalogs.products': 'Products ({n})', 'bp.catalogs.productsEmpty': 'No product in this catalog yet.',
  'bp.col.catalogs': 'Catalogs', 'bp.col.salesChannels': 'Sales channels',
  // Products list
  'bp.row.preview': 'Preview on the online store',
  'bp.filter.channel': 'Sales channel', 'bp.filter.catalog': 'Catalog', 'bp.filter.noCatalog': 'Not in a catalog',
  'bp.bulk.unpublish': 'Unlist products', 'bp.bulk.includeChannels': 'Include in sales channels', 'bp.bulk.excludeChannels': 'Exclude from sales channels',
  'bp.bulk.includeCatalogs': 'Include in catalogs', 'bp.bulk.excludeCatalogs': 'Exclude from catalogs', 'bp.bulk.include': 'Include', 'bp.bulk.exclude': 'Exclude',
  'bp.export.matching': 'All products matching your search or filters',
  'bp.export.helpFormat': 'Learn how the product CSV file is laid out', 'bp.export.helpImport': 'Learn how to import products from a CSV file',
  // Duplicate
  'bp.dup.inventory': 'Inventory quantities', 'bp.dup.translations': 'Translations', 'bp.dup.skus': 'SKUs', 'bp.dup.asUnlisted': 'Set as unlisted',
  // Metafields
  'bp.mf.add': 'Add', 'bp.mf.showAll': 'Show all ({n})', 'bp.mf.showLess': 'Show less',
  // Stock
  'bp.stock.editLocations': 'Edit locations', 'bp.stock.locationsHelp': 'Choose the locations where this variant is stocked.', 'bp.stock.noneStocked': 'Not stocked at any location.',
  'bp.stock.unavailable': 'Unavailable', 'bp.stock.committed': 'Committed', 'bp.stock.onHand': 'On hand', 'bp.stock.state': 'Quantity shown', 'bp.stock.breakdown': 'Unavailable and incoming',
  'bp.stock.reserved': 'Reserved', 'bp.stock.incoming': 'Incoming',
  'bp.stock.unavailableHelp': 'Units you hold but cannot sell, for example reserved ones.',
  'bp.stock.committedHelp': 'Units in orders that are not fulfilled yet.',
  'bp.stock.availableHelp': 'Units you can sell right now.',
  'bp.stock.onHandHelp2': 'All the units you hold: available, committed and unavailable.',
  'bp.stock.incomingHelp': 'Units on their way to this location, for example from a transfer or a purchase order.',
  'bp.stock.onHandHelp': 'On hand in total: {n}. Changing it moves the available quantity by the same amount.',
  'bp.history.title': 'Inventory history', 'bp.history.none': 'No change recorded yet.',
  'bp.qty.available': 'Available', 'bp.qty.on_hand': 'On hand', 'bp.qty.committed': 'Committed', 'bp.qty.reserved': 'Reserved', 'bp.qty.incoming': 'Incoming',
  'bp.adjust.adjustBy': 'Adjust by', 'bp.adjust.setTo': 'Set to', 'bp.adjust.amount': 'Amount to add or remove', 'bp.adjust.newQuantity': 'New quantity', 'bp.adjust.reason': 'Reason',
  'bp.adjust.result': 'Available quantity: {from} → {to}',
  'bp.reason.correction': 'Correction', 'bp.reason.received': 'Received', 'bp.reason.restock': 'Restock', 'bp.reason.cycle_count_available': 'Stock count', 'bp.reason.damaged': 'Damaged',
  'bp.reason.shrinkage': 'Shrinkage', 'bp.reason.quality_control': 'Quality control', 'bp.reason.safety_stock': 'Safety stock', 'bp.reason.promotion': 'Promotion', 'bp.reason.other': 'Other',
  'bp.reason.movement_created': 'Transfer created', 'bp.reason.movement_updated': 'Transfer updated', 'bp.reason.movement_received': 'Transfer received', 'bp.reason.movement_canceled': 'Transfer canceled',
  'bp.reason.reservation_created': 'Reserved', 'bp.reason.reservation_updated': 'Reservation changed', 'bp.reason.reservation_deleted': 'Reservation released',
  // Shipping
  'bp.ship.package': 'Package', 'bp.ship.packageHelp': 'Chosen from Settings, Shipping, Packaging.', 'bp.ship.noPackage': 'No package',
  'bp.ship.shipTo': 'Customs codes by destination', 'bp.ship.shipToHelp': 'Use another Harmonized System code when this item ships to a given country.', 'bp.ship.country': 'Country or region', 'bp.ship.addCountry': 'Add a country',
  // Media
  'bp.media.addExtra': 'Add video or 3D model', 'bp.media.extraHelp': 'MP4, WebM, GLB, GLTF or USDZ', 'bp.media.video': 'Video', 'bp.media.model': '3D model', 'bp.media.unsupported': '{name} is not a video or a 3D model.',
  'bp.editor.title': 'Edit image', 'bp.editor.edit': 'Edit image', 'bp.editor.crop': 'Crop', 'bp.editor.rotate': 'Rotate', 'bp.editor.resize': 'Resize', 'bp.editor.draw': 'Draw', 'bp.editor.background': 'Background',
  'bp.editor.undo': 'Undo', 'bp.editor.save': 'Save as new image', 'bp.editor.added': 'The edited image was added.', 'bp.editor.loadFailed': 'The image could not be loaded.', 'bp.editor.saveFailed': 'The image could not be saved.',
  'bp.editor.cropHelp': 'Drag over the image to choose the area to keep.', 'bp.editor.applyCrop': 'Crop', 'bp.editor.left': 'Rotate left', 'bp.editor.right': 'Rotate right',
  'bp.editor.flipH': 'Flip horizontally', 'bp.editor.flipV': 'Flip vertically', 'bp.editor.width': 'Width (px)', 'bp.editor.size': 'Now {w} × {h} px',
  'bp.editor.color': 'Colour', 'bp.editor.brush': 'Brush size', 'bp.editor.noBackground': 'No background', 'bp.editor.backgroundHelp': 'Fills transparent areas of the image.', 'bp.editor.canvas': 'Image being edited',
  // Collections
  'bp.collection.filter': 'Filter products', 'bp.collection.listView': 'List view', 'bp.collection.gridView': 'Grid view',
  // Gift cards
  'bp.giftCards.note': 'Note',
  // Discounts
  'bp.discount.editCombinations': 'Edit', 'bp.discount.noCombinations': 'Does not combine with other discounts.',
  'bp.discount.channels': 'Sales channels', 'bp.discount.allChannels': 'All sales channels', 'bp.discount.specificChannels': 'Specific sales channels', 'bp.discount.channelsHelp': 'Customers only get this discount when they buy through one of the selected channels.',
  // Markets
  'bp.markets.rollouts': 'Rollouts', 'bp.markets.toggleSide': 'Show or hide the summary', 'bp.markets.graphView': 'Graph view', 'bp.markets.listView': 'List view',
  'bp.markets.overview': 'Overview', 'bp.markets.statLive': 'Live markets', 'bp.markets.statDraft': 'Draft markets', 'bp.markets.statPlanned': 'Planned launches', 'bp.markets.statCountries': 'Countries covered', 'bp.markets.statCatalogs': 'Catalog links',
  'bp.markets.planRollout': 'Plan a rollout',
  'bp.markets.shipping': 'Shipping', 'bp.markets.manageShipping': 'Manage shipping', 'bp.markets.noShipping': 'No active shipping rate covers the countries of this market.', 'bp.markets.free': 'Free',
  'bp.markets.shippingInherited': 'Delivery profiles of the store', 'bp.markets.customize': 'Customize',
  'bp.rollouts.help': 'Plan when each draft market goes live. A planned market launches by itself at the chosen time.',
  'bp.rollouts.launch': 'Launch', 'bp.rollouts.plan': 'Plan launch', 'bp.rollouts.reschedule': 'Change date', 'bp.rollouts.clear': 'Clear plan', 'bp.rollouts.launchNow': 'Launch now', 'bp.rollouts.pause': 'Set to draft',
  'bp.rollouts.scheduled': 'Planned', 'bp.rollouts.planned': 'Launch planned.', 'bp.rollouts.cleared': 'Plan cleared.', 'bp.rollouts.save': 'Plan launch',
  'bp.rollouts.planTitle': 'Plan the launch of {name}', 'bp.rollouts.planHelp': 'The market goes live at this time, in your browser time zone.',
  'bp.rollouts.countries': '{n} countries', 'bp.rollouts.countries.one': '{n} country', 'bp.rollouts.emptyTitle': 'No market to roll out', 'bp.rollouts.emptyBody': 'Create a market first, then plan when it goes live.',
} as const;
