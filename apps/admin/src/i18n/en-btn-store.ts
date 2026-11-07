// Online store buttons: theme editor menu items, preview data, dynamic sources, color schemes, free images, theme code editor, theme content.
export const enBtnStore = {
  // top bar menu
  'bs.editCode': 'Edit code', 'bs.editContent': 'Edit default theme content', 'bs.docs': 'View documentation',
  // preview data
  'bs.preview.title': 'Preview data', 'bs.preview.intro': 'Choose what the preview shows. This only changes your view.',
  'bs.preview.product': 'Product', 'bs.preview.collection': 'Collection', 'bs.preview.page': 'Page', 'bs.preview.article': 'Article',
  'bs.preview.language': 'Language', 'bs.preview.country': 'Country (market)', 'bs.preview.countryHelp': 'Like a visitor choosing a country: prices and currency follow its market.',
  'bs.preview.first': 'First in the store', 'bs.preview.default': 'Store default', 'bs.preview.unpublished': 'not published', 'bs.preview.reset': 'Reset preview data',
  // setting fields
  'bs.color.reset': 'Clear color', 'bs.link.open': 'Open link in a new tab', 'bs.pick.none': 'None', 'bs.video.upload': 'Upload a video',
  'bs.pick.loadError': 'Could not load the available items. Try again.', 'bs.pick.retry': 'Retry {label}', 'bs.pick.retryAction': 'Retry',
  'bs.free.browse': 'Free images', 'bs.free.title': 'Free images', 'bs.free.intro': 'Abstract backgrounds that ship with ShopMe, free to use. The one you pick is copied to your files.', 'bs.free.use': 'Use image {n}',
  'bs.free.loadError': 'This image could not be loaded. Please try again.',
  'bs.schemes.add': 'Add a color scheme', 'bs.schemes.duplicate': 'Duplicate this scheme', 'bs.schemes.delete': 'Delete this scheme', 'bs.schemes.lastOne': 'A theme keeps at least one scheme', 'bs.schemes.inherit': 'Theme colors',
  // dynamic sources
  'bs.src.connect': 'Connect dynamic source', 'bs.src.connected': 'Shows data of the page', 'bs.src.clear': 'Disconnect dynamic source',
  'bs.src.shopName': 'Store name', 'bs.src.productTitle': 'Product title', 'bs.src.productVendor': 'Product vendor', 'bs.src.productType': 'Product type', 'bs.src.productPrice': 'Product price', 'bs.src.productDescription': 'Product description',
  'bs.src.collectionTitle': 'Collection title', 'bs.src.collectionDescription': 'Collection description', 'bs.src.collectionCount': 'Collection product count',
  'bs.src.articleTitle': 'Article title', 'bs.src.articleAuthor': 'Article author', 'bs.src.articleExcerpt': 'Article excerpt', 'bs.src.articleDate': 'Article date', 'bs.src.blogTitle': 'Blog title', 'bs.src.pageTitle': 'Page title',
  // code editor
  'bs.code.back': 'Back to the theme editor', 'bs.code.files': 'Theme files', 'bs.code.search': 'Search files', 'bs.code.noFiles': 'No file matches.',
  'bs.code.addIn': 'Add a file to {dir}', 'bs.code.addTitle': 'Add a file', 'bs.code.folder': 'Folder', 'bs.code.fileName': 'File name', 'bs.code.fileNameHint': 'my-section', 'bs.code.create': 'Create file',
  'bs.code.err.dir': 'Choose one of the theme folders.', 'bs.code.err.name': 'Use letters, digits, dashes, underscores and dots (no spaces).', 'bs.code.err.ext': 'This file type cannot be edited here, or the type cannot change.', 'bs.code.err.exists': 'A file with this name already exists.',
  'bs.code.renameTitle': 'Rename file', 'bs.code.deleteTitle': 'Delete {name}?', 'bs.code.deleteBody': 'The file is removed from this theme. You can bring it back from its history, in the list of deleted files.',
  'bs.code.deletedFiles': 'Deleted files', 'bs.code.restoreDeleted': 'Bring the file back with its last text', 'bs.code.restoredDeleted': 'The file is back in the editor. Save to add it again.',
  'bs.code.closeTitle': 'Close without saving?', 'bs.code.closeBody': 'Your changes to {name} will be lost.', 'bs.code.closeDiscard': 'Discard changes',
  'bs.code.openFiles': 'Open files', 'bs.code.editor': 'Code editor', 'bs.code.pick': 'Choose a file to edit.', 'bs.code.loadFailed': 'The file could not be loaded.', 'bs.code.unsaved': 'Unsaved changes',
  'bs.code.binary': 'This is a binary file ({size}). It cannot be edited here; upload a new version from the theme files.',
  'bs.code.saved': 'Theme files saved', 'bs.code.saveAll': 'Save {n} files',
  'bs.code.errors': '{n} errors', 'bs.code.errors.one': '{n} error', 'bs.code.warnings': '{n} warnings', 'bs.code.warnings.one': '{n} warning', 'bs.code.noProblems': 'No problems', 'bs.code.problems': 'Problems',
  'bs.code.history': 'History', 'bs.code.historyOf': 'History of {name}', 'bs.code.noHistory': 'No earlier version yet. A version is kept each time the file changes.',
  'bs.code.restore': 'Restore this version', 'bs.code.restoreHint': 'The text is put in the editor. Save to keep it.', 'bs.code.reverted': 'Version restored in the editor. Save to keep it.',
  // theme content
  'bs.content.back': 'Back to the theme editor', 'bs.content.intro': 'The texts of the theme: buttons, labels and messages shown on the storefront. Edit them per language; an empty translation falls back to the default text.',
  'bs.content.search': 'Search texts', 'bs.content.language': 'Language', 'bs.content.default': 'default', 'bs.content.group': 'Section', 'bs.content.allGroups': 'All sections',
  'bs.content.show': 'Show', 'bs.content.showAll': 'All texts', 'bs.content.showEdited': 'Edited', 'bs.content.showMissing': 'Not translated', 'bs.content.addLanguage': 'Add a language',
  'bs.content.count': '{n} of {total} texts', 'bs.content.unsaved': '{n} unsaved', 'bs.content.key': 'Key', 'bs.content.original': 'Default text', 'bs.content.text': 'Text',
  'bs.content.placeholders': 'Keep the same {{ placeholders }} as the default text.', 'bs.content.edited': 'Edited', 'bs.content.noMatch': 'No text matches.', 'bs.content.more': 'Show {n} more',
  'bs.content.saved': 'Theme content saved', 'bs.content.none': 'This theme has no default locale file (locales/en.default.json).',
} as const;
