// Customers (segments, new customer), gift cards, pages, menus, blog posts, files and online store preferences.
export const enContent = {
  'field.name': 'Name', 'nav.segments': 'Segments', 'store.files': 'Files', 'store.preferences': 'Preferences',
  'content.noResults': 'No results found', 'content.noResultsBody': 'Try changing the search or the filters.',
  'content.tab.all': 'All', 'content.tab.published': 'Visible', 'content.tab.unpublished': 'Hidden',
  'content.makeVisible': 'Make visible', 'content.makeHidden': 'Make hidden', 'content.madeVisible': '{n} made visible', 'content.madeHidden': '{n} made hidden', 'content.deleted': '{n} deleted',
  'seo.title': 'Search engine listing', 'seo.edit': 'Edit listing', 'seo.empty': 'Add a title and content to see how this page could appear in search results.',

  'customers.language': 'Language', 'customers.languageHelp': 'This customer will receive notifications in this language.',
  'customers.consentNotice': 'Ask for permission before subscribing customers to your marketing emails.', 'customers.addAddress': 'Add an address',
  'customers.createOrder': 'Create order', 'customers.editContact': 'Edit contact information', 'customers.copyEmail': 'Copy email address', 'customers.copied': 'Copied to the clipboard',
  'customers.previous': 'Previous customer', 'customers.next': 'Next customer',

  'segments.create': 'Create segment', 'segments.search': 'Search segments', 'segments.share': '% of customers', 'segments.lastActivity': 'Last activity', 'segments.createdBy': 'Created by',
  'segments.edited': 'Edited {date}', 'segments.builtIn': 'Built in', 'segments.you': 'You', 'segments.sort.recent': 'Last activity', 'segments.sort.name': 'Name',
  'segments.deleted': '{n} segment(s) deleted', 'segments.deleteTitle': 'Delete {n} segment(s)?', 'segments.deleteBody': 'Customers are not deleted, only the saved filter.',
  'segments.builtin.purchased': 'Customers who have purchased at least once', 'segments.builtin.subscribers': 'Email subscribers',
  'segments.builtin.repeat': 'Customers who have purchased more than once', 'segments.builtin.never': 'Customers who have not purchased',
  'segments.builtInHelp': 'This segment is built in and always up to date. Create your own segment to save a different filter.',
  'segments.conditions': 'Conditions', 'segments.any': 'Any', 'segments.orders': 'Orders', 'segments.orders.none': 'Has not purchased', 'segments.orders.any': 'Purchased at least once', 'segments.orders.repeat': 'Purchased more than once',
  'segments.countryHelp': 'Country code or name, e.g. FR', 'segments.since': 'Customer since', 'segments.other': 'Other search terms', 'segments.otherHelp': 'Same syntax as the customer search, e.g. email:@example.com',
  'segments.allCustomers': 'All customers', 'segments.preview': 'Matching customers', 'segments.noMatch': 'No customer matches these conditions.', 'segments.details': 'Segment details',
  'segments.nameRequired': 'Give the segment a name.', 'segments.saved': 'Segment saved', 'segments.notFound': 'Segment not found.', 'segments.untitled': 'Untitled segment', 'segments.viewCustomers': 'View customers',

  'giftCards.create': 'Create gift card', 'giftCards.addProduct': 'Add gift card product', 'giftCards.viewProducts': 'View gift card products',
  'giftCards.codeEnding': 'Code ending in', 'giftCards.noRecipient': 'No recipient', 'giftCards.created': 'Created', 'giftCards.currentInitial': 'Current / initial',
  'giftCards.customerSearch': 'Search or create a customer', 'giftCards.createCustomer': 'Create a new customer', 'giftCards.noExpiry': 'Does not expire', 'giftCards.amountRequired': 'Enter an initial value greater than zero.',

  'pages.search': 'Search pages', 'pages.addTitle': 'Create page', 'pages.titlePlaceholder': 'e.g. About us, Size guide, FAQ', 'pages.viewOnStore': 'View on your store',
  'pages.deleteManyTitle': 'Delete {n} page(s)?',
  'access.restricted': 'Restricted store access', 'access.restrictedBody': 'Only visitors with the password can see your online store.', 'access.manage': 'Manage access',

  'menus.create': 'Create menu', 'menus.searchMenus': 'Search menus', 'menus.emptyList': 'No menus found', 'menus.namePlaceholder': 'e.g. Side menu', 'menus.handle': 'Handle', 'menus.notFound': 'Menu not found.',

  'blogs.manage': 'Manage blogs', 'blogs.titlePlaceholder': 'e.g. Blog post about our latest products', 'blogs.addImage': 'Add image (click or drop a file)', 'blogs.deleteManyTitle': 'Delete {n} blog post(s)?',

  'files.add': 'Upload files', 'files.name': 'File name', 'files.alt': 'Alt text', 'files.added': 'Date added', 'files.dimensions': 'Dimensions', 'files.search': 'Search files',
  'files.type': 'File type', 'files.type.all': 'All', 'files.type.image': 'Images', 'files.type.video': 'Videos', 'files.emptyTitle': 'No files yet', 'files.emptyBody': 'Upload images and videos to use them across your store.',
  'files.uploaded': '{n} file(s) uploaded', 'files.saved': 'File saved', 'files.deleted': '{n} file(s) deleted', 'files.copied': 'Link copied', 'files.copyLink': 'Copy link',
  'files.deleteTitle': 'Delete {n} file(s)?', 'files.deleteBody': 'Files that are still used by products or pages will show as missing there.',

  'prefs.access': 'Store access', 'prefs.passwordMode': 'Password protection', 'prefs.passwordModeHelp': 'Shows a password page in front of your online store until visitors enter the password.',
  'prefs.message': 'Message to your visitors', 'prefs.charsUsed': '{n} of {max} characters used', 'prefs.seo': 'Home page', 'prefs.homeDescription': 'Meta description', 'prefs.homeDescriptionHelp': 'Shown in search results for your home page.', 'prefs.saved': 'Preferences saved',
} as const;
