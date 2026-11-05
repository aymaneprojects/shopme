// Rich text editor, publishing (visibility date, theme template, search engine listing) and Files library (folders, size, references).
export const enPublishing = {
  'rte.showHtml': 'Show HTML', 'rte.editor': 'Rich text editor', 'rte.heading1': 'Heading 1', 'rte.heading2': 'Heading 2', 'rte.heading3': 'Heading 3', 'rte.heading4': 'Heading 4', 'rte.quote': 'Quote',
  'rte.color': 'Text color', 'rte.customColor': 'Custom color', 'rte.defaultColor': 'Default', 'rte.alignLeft': 'Align left', 'rte.alignCenter': 'Align center', 'rte.alignRight': 'Align right', 'rte.justify': 'Justify',
  'rte.indent': 'Increase indent', 'rte.outdent': 'Decrease indent', 'rte.unlink': 'Remove link', 'rte.image': 'Insert image', 'rte.imageUpload': 'Upload image', 'rte.video': 'Embed video',
  'rte.videoPrompt': 'YouTube or Vimeo URL', 'rte.videoInvalid': 'Enter a YouTube or Vimeo URL.', 'rte.table': 'Insert table', 'rte.tableRows': 'Rows', 'rte.tableColumns': 'Columns', 'rte.clearFormat': 'Clear formatting',
  'rte.apply': 'Apply', 'rte.insert': 'Insert', 'rte.cancel': 'Cancel',
  'picker.image': 'Select an image', 'picker.imageEmpty': 'No images yet. Upload one to get started.', 'picker.imageUpload': 'Upload image', 'picker.imageSearch': 'Search images',

  'publish.setDate': 'Set a visibility date', 'publish.date': 'Visible on', 'publish.time': 'Time', 'publish.clearDate': 'Remove date',
  'publish.scheduled': 'Scheduled', 'publish.scheduledOn': 'Will become visible on {date}.', 'publish.visibleSince': 'Visible since {date}.', 'publish.hiddenHelp': 'Not shown on your online store.',
  'template.title': 'Theme template', 'template.default': 'Default template', 'template.help': 'Choose which template from your live theme displays this content.', 'template.missing': '{name} (not in the live theme)',
  'seo.pageTitle': 'Page title', 'seo.metaDescription': 'Meta description', 'seo.chars': '{n} of {max} characters used', 'seo.url': 'URL handle', 'seo.done': 'Done',

  'files.newFolder': 'New folder', 'files.folderName': 'Folder name', 'files.createFolder': 'Create folder', 'files.renameFolder': 'Rename folder', 'files.deleteFolder': 'Delete folder', 'files.folderSaved': 'Folder saved',
  'files.folderDeleted': 'Folder deleted', 'files.folderNotEmpty': 'Move or delete the files in this folder first.', 'files.deleteFolderTitle': 'Delete the folder "{name}"?', 'files.deleteFolderBody': 'Only empty folders can be deleted.',
  'files.allFiles': 'All files', 'files.root': 'No folder', 'files.moveTo': 'Move to folder', 'files.moved': '{n} file(s) moved', 'files.size': 'Size', 'files.references': 'References', 'files.noReferences': 'Not used',
  'files.ref.PRODUCT': '{n} products', 'files.ref.PRODUCT.one': '{n} product', 'files.ref.COLLECTION': '{n} collections', 'files.ref.COLLECTION.one': '{n} collection',
  'files.ref.ARTICLE': '{n} blog posts', 'files.ref.ARTICLE.one': '{n} blog post', 'files.ref.THEME': 'Theme settings', 'files.refsTitle': 'Used in',
  'files.moreActions': 'More file actions', 'files.downloadSelected': 'Download selected', 'files.downloading': 'Downloading {n} file(s)', 'files.selectToDownload': 'Select files to download them.',
  'files.copyLinks': 'Copy links of selected', 'files.linksCopied': '{n} link(s) copied', 'files.folder': 'Folder', 'files.download': 'Download',
} as const;
