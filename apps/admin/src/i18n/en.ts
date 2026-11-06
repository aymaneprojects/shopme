import { enBtnOrders } from './en-btn-orders';
import { enBtnSettings } from './en-btn-settings';
import { enCheckout } from './en-checkout';
import { enDiscountCodes } from './en-discount-codes';
import { enPrivacy } from './en-privacy';
import { enBtnStore } from './en-btn-store';
import { enBtnCustomers } from './en-btn-customers';
import { enFidelity } from './en-fidelity';
import { enOrdersUx } from './en-orders-ux';
import { enQaOrders } from './en-qa-orders';
import { enCommerce } from './en-commerce';
import { enCatalog } from './en-catalog';
import { enContent } from './en-content';
import { enPublishing } from './en-publishing';
import { enExt } from './en-ext';
import { enPlatform } from './en-platform';
import { enShop } from './en-shop';
import { enSettings } from './en-settings';
import { enUx } from './en-ux';
import { enViews } from './en-views';
import { enQaCatalog } from './en-qa-catalog';
import { enQaProduct } from './en-qa-product';
import { enQaFeatures } from './en-qa-features';
import { enEditor } from './en-editor';
import { enTimeline } from './en-timeline';
import { enQaStore } from './en-qa-store';
import { enFinal } from './en-final';
import { enQaSettings } from './en-qa-settings';
import { enQaHome } from './en-qa-home';
import { enShipping } from './en-shipping';
import { enTransfers } from './en-transfers';
import { enMetaobjects } from './en-metaobjects';
import { enMarkets } from './en-markets';
import { enBtnProducts } from './en-btn-products';
import { enPostage } from './en-postage';
import { enLiveMap } from './en-live-map';
import { enAccountPages } from './en-account-pages';
import { enSubscriptions } from './en-subscriptions';
import { enThemeUpdate } from './en-theme-update';
import { enThemeGallery } from './en-theme-gallery';
import { enMultistore } from './en-multistore';
import { enEmail } from './en-email';
export const en = {
  'common.back': 'Back', 'common.cancel': 'Cancel', 'common.close': 'Close', 'common.delete': 'Delete', 'common.loading': 'Loading…',
  'common.moreActions': 'More actions', 'common.next': 'Next', 'common.previous': 'Previous', 'common.remove': 'Remove',
  'common.selectAll': 'Select all', 'common.selected': '{n} selected', 'common.selected.one': '{n} selected', 'common.sort': 'Sort',

  'field.description': 'Description', 'field.email': 'Email', 'field.firstName': 'First name', 'field.lastName': 'Last name', 'field.password': 'Password',
  'field.productType': 'Type', 'field.status': 'Status', 'field.tags': 'Tags', 'field.title': 'Title', 'field.vendor': 'Vendor',

  'nav.home': 'Home', 'nav.orders': 'Orders', 'nav.products': 'Products', 'nav.collections': 'Collections', 'nav.inventory': 'Inventory',
  'nav.customers': 'Customers', 'nav.discounts': 'Discounts', 'nav.onlineStore': 'Online Store', 'nav.settings': 'Settings',
  'nav.menu': 'Open menu', 'nav.notFound': 'Page not found',
  'shell.search': 'Search', 'shell.searchPlaceholder': 'Search', 'shell.account': 'Account menu', 'cmd.pages': 'Pages', 'cmd.products': 'Products', 'cmd.orders': 'Orders', 'cmd.customers': 'Customers', 'cmd.empty': 'No results', 'cmd.hint': 'Type to search', 'cmd.dismiss': 'Dismiss', 'cmd.settings': 'Settings', 'theme.light': 'Light theme', 'theme.dark': 'Dark theme', 'theme.system': 'Match system', 'shell.logout': 'Log out',

  'login.title': 'Log in', 'login.subtitle': 'Sign in to manage your store.', 'login.submit': 'Log in', 'login.invalid': 'Incorrect email or password.',
  'setup.title': 'Set up your store', 'setup.subtitle': 'Create the owner account and basic store details.', 'setup.shopName': 'Store name',
  'setup.currency': 'Currency', 'setup.country': 'Country', 'setup.passwordHelp': 'At least 8 characters.', 'setup.submit': 'Create store',

  'soon.title': 'Coming in the next version', 'soon.body': 'This area is not available yet. It is planned for an upcoming release.',
  'home.welcome': 'Welcome, {name}', 'home.orders': 'Orders', 'home.sales': 'Sales', 'home.products': 'Products', 'home.soon': 'Coming soon',
  'home.setupTitle': 'Get started', 'home.setupBody': 'Add your first product from the Products page, then organize it into collections.',

  'save.unsaved': 'Unsaved changes', 'save.save': 'Save', 'save.discard': 'Discard', 'save.leaveTitle': 'Leave without saving?',
  'save.leaveBody': 'You have unsaved changes. If you leave this page they will be lost.', 'save.leave': 'Leave page', 'save.stay': 'Stay',

  'status.ACTIVE': 'Active', 'status.DRAFT': 'Draft', 'status.ARCHIVED': 'Archived', 'status.UNLISTED': 'Unlisted',
  'sort.TITLE': 'Title', 'sort.CREATED_AT': 'Created', 'sort.UPDATED_AT': 'Updated', 'sort.INVENTORY_TOTAL': 'Inventory', 'sort.PRODUCT_TYPE': 'Type', 'sort.VENDOR': 'Vendor',

  'products.add': 'Add product', 'products.tabAll': 'All', 'products.product': 'Product', 'products.inventory': 'Inventory',
  'products.inStock': '{n} in stock for {v} variants', 'products.inStock.one': '{n} in stock for {v} variant', 'products.notTracked': 'Inventory not tracked', 'products.search': 'Search products',
  'products.stockIn': 'In stock', 'products.stockOut': 'Out of stock', 'products.count': '{n} products', 'products.count.one': '{n} product',
  'products.emptyTitle': 'Add your first product', 'products.emptyBody': 'Products you add will appear here. Start with a title, a price and a photo.',
  'products.noResults': 'No results found', 'products.noResultsBody': 'Try changing the search or the filters.', 'products.clearFilters': 'Clear filters',
  'products.setActive': 'Set as active', 'products.setDraft': 'Set as draft', 'products.setArchived': 'Archive',
  'products.updated': '{n} products updated', 'products.updated.one': '{n} product updated', 'products.deleted': '{n} products deleted', 'products.deleted.one': '{n} product deleted', 'products.deleteTitle': 'Delete {n} products?', 'products.deleteTitle.one': 'Delete {n} product?',
  'products.deleteBody': 'This cannot be undone.',

  'product.addTitle': 'Add product', 'product.untitled': 'Untitled product', 'product.notFound': 'Product not found.', 'product.titlePlaceholder': 'Short sleeve t-shirt',
  'product.titleRequired': 'Title is required.', 'product.priceInvalid': 'Enter a valid price (0 or more).', 'product.saved': 'Product saved', 'product.saveFailed': 'Could not save',
  'product.media': 'Media', 'product.pricing': 'Pricing', 'product.inventory': 'Inventory', 'product.shipping': 'Shipping', 'product.variants': 'Variants',
  'product.seo': 'Search engine listing', 'product.seoTitle': 'Page title', 'product.seoDescription': 'Meta description', 'product.seoEmpty': 'Add a description to see how this product may appear in search results.',
  'product.handle': 'URL handle', 'product.chars': '{n} of {max} characters', 'product.organization': 'Product organization', 'product.addToCollection': 'Add to collection',
  'product.template': 'Theme template', 'product.templateHelp': 'Template suffix, for example "alternate". Leave empty for the default.',

  'product.deleteTitle': 'Delete this product?',
  'media.upload': 'Add images (click or drop files)', 'media.moveLeft': 'Move earlier', 'media.moveRight': 'Move later', 'media.featured': 'Featured', 'media.alt': 'Alt text',

  'pricing.price': 'Price', 'pricing.compareAt': 'Compare-at price', 'pricing.cost': 'Cost per item', 'pricing.costHelp': 'Customers will not see this.',
  'pricing.chargeTax': 'Charge tax on this product', 'pricing.margin': 'Profit: {profit} (margin {pct}%)',
  'inventory.track': 'Track quantity', 'inventory.available': 'Available', 'inventory.sku': 'SKU', 'inventory.barcode': 'Barcode (ISBN, UPC, GTIN)',
  'inventory.continueSelling': 'Continue selling when out of stock', 'inventory.committed': 'Committed', 'inventory.onHand': 'On hand', 'inventory.noSku': 'No SKU',
  'inventory.location': 'Location', 'inventory.allLocations': 'All locations', 'inventory.search': 'Search by product or SKU',
  'inventory.pickLocation': 'Choose a location to edit available quantities.', 'inventory.saveN': 'Save {n} changes', 'inventory.saveN.one': 'Save {n} change', 'inventory.saved': 'Inventory updated',
  'inventory.emptyTitle': 'No tracked inventory', 'inventory.emptyBody': 'Products with quantity tracking will be listed here.',
  'shipping.physical': 'This is a physical product', 'shipping.weight': 'Weight', 'shipping.unit': 'Unit',
  'unit.KILOGRAMS': 'kg', 'unit.GRAMS': 'g', 'unit.POUNDS': 'lb', 'unit.OUNCES': 'oz',

  'variants.addOptions': 'Add options like size or color', 'variants.addAnotherOption': 'Add another option', 'variants.optionName': 'Option name',
  'variants.optionNamePlaceholder': 'Size', 'variants.optionValues': 'Option values', 'variants.valuesPlaceholder': 'Type a value and press Enter',
  'variants.removeOption': 'Remove option', 'variants.count': '{n} variants', 'variants.count.one': '{n} variant', 'variants.variant': 'Variant', 'variants.details': 'Show details',
  'variants.default': 'Default', 'variants.remove': 'Remove variant',

  'collections.add': 'Add collection', 'collections.search': 'Search collections', 'collections.type': 'Type', 'collections.manual': 'Manual', 'collections.automated': 'Automated',
  'collections.conditions': 'Conditions', 'collections.emptyTitle': 'Create your first collection', 'collections.emptyBody': 'Group products so customers can browse them together.',
  'collections.deleted': '{n} collections deleted', 'collections.deleted.one': '{n} collection deleted', 'collections.deleteTitle': 'Delete {n} collections?', 'collections.deleteTitle.one': 'Delete {n} collection?', 'collections.deleteBody': 'Products are not deleted. This cannot be undone.',
  'collections.notFound': 'Collection not found.',
  'collection.addTitle': 'Add collection', 'collection.untitled': 'Untitled collection', 'collection.titleRequired': 'Title is required.',
  'collection.rulesInvalid': 'Add at least one complete condition.', 'collection.saved': 'Collection saved', 'collection.type': 'Collection type',
  'collection.manualHelp': 'You choose which products belong to this collection.', 'collection.products': 'Products ({n})', 'collection.addProducts': 'Add products',
  'collection.manualEmpty': 'No products yet. Add some to this collection.', 'collection.autoEmpty': 'Matching products appear here once the collection is saved.',
  'collection.image': 'Image', 'collection.organization': 'Organization', 'collection.sortOrder': 'Sort products by',
  'sortOrder.MANUAL': 'Manually', 'sortOrder.BEST_SELLING': 'Best selling', 'sortOrder.ALPHA_ASC': 'Title A–Z', 'sortOrder.ALPHA_DESC': 'Title Z–A',
  'sortOrder.PRICE_DESC': 'Price, high to low', 'sortOrder.PRICE_ASC': 'Price, low to high', 'sortOrder.CREATED_DESC': 'Newest first', 'sortOrder.CREATED': 'Oldest first',

  'conditions.mustMatch': 'Products must match', 'conditions.all': 'all conditions', 'conditions.any': 'any condition', 'conditions.rule': 'Condition {n}',
  'conditions.field': 'Field', 'conditions.relation': 'Operator', 'conditions.value': 'Value', 'conditions.remove': 'Remove condition', 'conditions.add': 'Add another condition',
  'conditions.true': 'true', 'conditions.false': 'false', 'conditions.and': 'and', 'conditions.or': 'or',
  'column.TAG': 'Product tag', 'column.TITLE': 'Product title', 'column.TYPE': 'Product type', 'column.VENDOR': 'Product vendor', 'column.VARIANT_PRICE': 'Price',
  'column.VARIANT_COMPARE_AT_PRICE': 'Compare-at price', 'column.VARIANT_WEIGHT': 'Weight', 'column.VARIANT_INVENTORY': 'Inventory stock',
  'column.VARIANT_TITLE': 'Variant title', 'column.IS_PRICE_REDUCED': 'Price is reduced',
  'relation.EQUALS': 'is equal to', 'relation.NOT_EQUALS': 'is not equal to', 'relation.GREATER_THAN': 'is greater than', 'relation.LESS_THAN': 'is less than',
  'relation.STARTS_WITH': 'starts with', 'relation.ENDS_WITH': 'ends with', 'relation.CONTAINS': 'contains', 'relation.NOT_CONTAINS': 'does not contain',
  'relation.IS_SET': 'is set', 'relation.IS_NOT_SET': 'is not set',

  'picker.products': 'Add products', 'picker.collections': 'Add to collections', 'picker.add': 'Add ({n})', 'picker.none': 'No products found.', 'picker.noneCollections': 'No manual collections available.',

  'rte.bold': 'Bold', 'rte.italic': 'Italic', 'rte.underline': 'Underline', 'rte.list': 'Bulleted list', 'rte.orderedList': 'Numbered list', 'rte.link': 'Link',
  'rte.source': 'HTML source', 'rte.paragraph': 'Paragraph', 'rte.heading': 'Heading', 'rte.subheading': 'Subheading', 'rte.linkPrompt': 'Link URL',
  ...enShop,
  ...enExt,
  ...enPlatform,
  ...enCommerce,
  ...enCatalog,
  ...enOrdersUx,
  ...enQaOrders,
  ...enSettings,
  ...enUx,
  ...enEditor,
  ...enTimeline,
  ...enShipping,
  ...enMetaobjects,
  ...enContent,
  ...enPublishing,
  ...enViews,
  ...enQaCatalog,
  ...enQaProduct,
  ...enQaFeatures,
  ...enCheckout,
  ...enQaStore,
  ...enFinal,
  ...enQaSettings,
  ...enQaHome,
  ...enTransfers,
  ...enDiscountCodes,
  ...enMarkets,
  ...enBtnProducts,
  ...enPrivacy,
  ...enBtnOrders,
  ...enBtnStore,
  ...enBtnSettings,
  ...enBtnCustomers,
  ...enPostage,
  ...enLiveMap,
  ...enAccountPages,
  ...enSubscriptions,
  ...enThemeUpdate,
  ...enThemeGallery,
  ...enFidelity,
  ...enMultistore,
  ...enEmail,
} as const;

export type Key = keyof typeof en;
