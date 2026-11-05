// Section editor, blogs, redirects, drafts, CSV, staff, notifications, policies, webhooks, Shopify import.
export const enExt = {
  'nav.drafts': 'Drafts',
  'store.blogPosts': 'Blog posts', 'store.blogs': 'Blogs', 'store.redirects': 'URL redirects',
  'settings.users': 'Users and permissions', 'settings.notifications': 'Notifications', 'settings.policies': 'Policies', 'settings.webhooks': 'Webhooks', 'settings.shopifyImport': 'Import from Shopify',

  'themes.intro': 'The live theme is shown on your store. Customize it, or upload and try another one.', 'themes.upload': 'Upload zip', 'themes.uploaded': 'Theme uploaded',
  'themes.rename': 'Rename', 'themes.renamed': 'Theme renamed', 'themes.duplicate': 'Duplicate', 'themes.duplicated': 'Theme duplicated', 'themes.download': 'Download', 'themes.deleted': 'Theme deleted',
  'themes.name': 'Theme name', 'themes.copyOf': 'Copy of {name}', 'themes.deleteTitle': 'Delete {name}?', 'themes.deleteBody': 'The theme and its files are removed permanently. The live theme cannot be deleted.',
  'themes.role.MAIN': 'Live', 'themes.role.UNPUBLISHED': 'Unpublished', 'themes.role.DEMO': 'Demo', 'themes.role.DEVELOPMENT': 'Development', 'themes.role.ARCHIVED': 'Archived', 'themes.role.LOCKED': 'Locked',

  'editor.tabSections': 'Sections', 'editor.tabSettings': 'Theme settings', 'editor.template': 'Template', 'editor.undo': 'Undo', 'editor.templateMissing': 'This template could not be read.',
  'editor.templateSections': 'Template: {name}', 'editor.addSection': 'Add section', 'editor.addBlock': 'Add block', 'editor.addBlockTo': 'Add a block to {name}', 'editor.maxBlocks': 'Maximum of {n} blocks reached',
  'editor.moveUp': 'Move up', 'editor.moveDown': 'Move down', 'editor.show': 'Show', 'editor.hide': 'Hide', 'editor.static': 'fixed', 'editor.settings': 'Settings',
  'editor.noSettings': 'No settings for this item.', 'editor.noPresets': 'This theme has no sections that can be added.',

  'blogs.addPost': 'Add blog post', 'blogs.searchPosts': 'Search blog posts', 'blogs.emptyTitle': 'No blog posts yet', 'blogs.emptyBody': 'Write articles to share news and tell your story.',
  'blogs.blog': 'Blog', 'blogs.author': 'Author', 'blogs.summary': 'Excerpt', 'blogs.summaryHelp': 'A short summary shown in blog listings.', 'blogs.image': 'Featured image', 'blogs.imageAlt': 'Image description',
  'blogs.organization': 'Organization', 'blogs.saved': 'Blog post saved', 'blogs.notFound': 'Blog post not found.', 'blogs.blogRequired': 'Choose a blog first.',
  'blogs.deletePostTitle': 'Delete this blog post?', 'blogs.deletePostBody': 'This cannot be undone.',
  'blogs.addBlog': 'Add blog', 'blogs.editBlog': 'Edit blog', 'blogs.blogSaved': 'Blog saved', 'blogs.blogDeleted': 'Blog deleted', 'blogs.noBlogsTitle': 'No blogs yet', 'blogs.noBlogsBody': 'Create a blog to start publishing posts.',
  'blogs.deleteBlogTitle': 'Delete {name}?', 'blogs.deleteBlogBody': 'All posts in this blog are deleted with it.',

  'redirects.add': 'Add redirect', 'redirects.edit': 'Edit redirect', 'redirects.from': 'Redirect from', 'redirects.to': 'Redirect to', 'redirects.fromHelp': 'Starts with a slash, for example /old-page.', 'redirects.toHelp': 'A path or a full URL.',
  'redirects.search': 'Search redirects', 'redirects.saved': 'Redirect saved', 'redirects.deleted': 'Redirect deleted', 'redirects.emptyTitle': 'No redirects yet', 'redirects.emptyBody': 'Send visitors from an old address to a new one so no link breaks.', 'redirects.deleteTitle': 'Delete this redirect?',

  'draft.title': 'Draft orders', 'draft.create': 'Create order', 'draft.draft': 'Draft', 'draft.date': 'Date', 'draft.customer': 'Customer', 'draft.total': 'Total', 'draft.search': 'Search drafts',
  'draft.emptyTitle': 'No draft orders', 'draft.emptyBody': 'Create orders for phone or in-person sales, then send an invoice or mark them as paid.', 'draft.notFound': 'Draft order not found.',
  'draft.status.OPEN': 'Open', 'draft.status.INVOICE_SENT': 'Invoice sent', 'draft.status.COMPLETED': 'Completed',
  'draft.products': 'Products', 'draft.addProduct': 'Browse products', 'draft.addCustom': 'Add custom item', 'draft.add': 'Add', 'draft.noLines': 'No items yet. Add a product or a custom item.', 'draft.custom': 'Custom',
  'draft.quantity': 'Quantity', 'draft.price': 'Price', 'draft.adjustments': 'Discount and shipping', 'draft.discount': 'Add a discount', 'draft.discountType': 'Discount type', 'draft.discountValue': 'Discount value',
  'draft.shipping': 'Add shipping', 'draft.shippingDefault': 'Shipping', 'draft.shippingName': 'Shipping name', 'draft.shippingPrice': 'Shipping price', 'draft.payment': 'Payment',
  'draft.row.subtotal': 'Subtotal', 'draft.row.discount': 'Discount', 'draft.row.shipping': 'Shipping', 'draft.row.tax': 'Taxes', 'draft.row.total': 'Total', 'draft.free': 'Free', 'draft.estimate': 'Estimated total. Taxes are calculated when the draft is saved.',
  'draft.note': 'Note', 'draft.searchCustomer': 'Search customers', 'draft.saveDraft': 'Save draft', 'draft.saved': 'Draft saved', 'draft.needLines': 'Add at least one item.', 'draft.saveFirst': 'Save your changes to send the invoice or complete the order.',
  'draft.sendInvoice': 'Send invoice', 'draft.send': 'Send', 'draft.invoiceTo': 'Send to', 'draft.invoiceSent': 'Invoice sent', 'draft.markPaid': 'Mark as paid', 'draft.paymentPending': 'Create with payment pending',
  'draft.completeTitle': 'Create the order', 'draft.completeBody': 'The draft becomes an order. Mark it as paid now, or create it with payment pending.', 'draft.completed': 'Order created',
  'draft.completedBanner': 'This draft was completed as order', 'draft.deleteTitle': 'Delete this draft?', 'draft.deleteBody': 'This cannot be undone.',

  'csv.import': 'Import', 'csv.export': 'Export', 'csv.chooseFile': 'Choose a CSV file', 'csv.title.products': 'Import products', 'csv.title.customers': 'Import customers', 'csv.title.inventory': 'Import inventory',
  'csv.help.products': 'Upload a CSV file of products. We check it first and show any problems before anything changes.', 'csv.help.customers': 'Upload a CSV file of customers. We check it first and show any problems before anything changes.',
  'csv.help.inventory': 'Upload a CSV file of inventory quantities. We check it first and show any problems before anything changes.',
  'csv.checking': 'Checking {name}…', 'csv.previewTitle': 'Check result for {name}', 'csv.confirm': 'Import', 'csv.importing': 'Importing…', 'csv.done': 'Import finished.', 'csv.nothing': 'No rows can be imported. Fix the file and choose it again.',
  'csv.chooseAnother': 'Choose another file', 'csv.errors': '{n} rows with problems', 'csv.errors.one': '{n} row with problems', 'csv.row': 'Row {n}',
  'csv.count.created': 'Created', 'csv.count.updated': 'Updated', 'csv.count.skipped': 'Skipped', 'csv.count.errors': 'Errors', 'csv.count.imported': 'Imported', 'csv.count.failed': 'Failed',

  'users.intro': 'Invite people to help run your store and choose what they can access.', 'users.invite': 'Invite user', 'users.sendInvite': 'Send invitation', 'users.invited': 'Invitation sent', 'users.edit': 'Edit user', 'users.saved': 'User updated',
  'users.role.owner': 'Owner', 'users.role.admin': 'Administrator', 'users.role.staff': 'Staff', 'users.roleLabel': 'Role', 'users.adminHelp': 'Administrators can access everything except ownership.', 'users.permissions': 'Permissions',
  'users.perm.products': 'Products, collections and inventory', 'users.perm.orders': 'Orders', 'users.perm.customers': 'Customers', 'users.perm.discounts': 'Discounts', 'users.perm.online_store': 'Online Store', 'users.perm.settings': 'Settings', 'users.perm.staff': 'Users and permissions',
  'users.areas': '{n} areas', 'users.areas.one': '{n} area', 'users.inactive': 'Deactivated', 'users.deactivate': 'Deactivate', 'users.deactivated': 'User deactivated', 'users.deactivateTitle': 'Deactivate this user?', 'users.deactivateBody': '{email} will no longer be able to sign in.',
  'users.deleteTitle': 'Delete this user?', 'users.deleteBody': '{email} is removed permanently.', 'users.deleted': 'User deleted',

  'notif.intro': 'Customize the emails your customers receive.', 'notif.customized': 'Customized', 'notif.notFound': 'Template not found.', 'notif.template': 'Template', 'notif.subject': 'Subject', 'notif.body': 'Email body (HTML and Liquid)',
  'notif.help': 'Use Liquid variables such as {{ customer.first_name }} and {{ order.name }}.', 'notif.preview': 'Preview', 'notif.previewSaved': 'Preview shows the saved version', 'notif.saved': 'Template saved',
  'notif.reset': 'Reset to default', 'notif.resetTitle': 'Reset this template?', 'notif.resetBody': 'Your changes are replaced by the default template.', 'notif.resetDone': 'Template reset',

  'policies.REFUND_POLICY': 'Refund policy', 'policies.PRIVACY_POLICY': 'Privacy policy', 'policies.TERMS_OF_SERVICE': 'Terms of service', 'policies.SHIPPING_POLICY': 'Shipping policy', 'policies.CONTACT_INFORMATION': 'Contact information',
  'policies.view': 'View on store', 'policies.saved': 'Policies saved', 'policies.cookies': 'Cookie banner', 'policies.cookiesHelp': 'Ask visitors to accept cookies before analytics run.', 'policies.cookiesEnable': 'Show a cookie banner on the store',
  'policies.footer': 'Policies are linked from your store footer and checkout.',

  'hooks.intro': 'Send a signed HTTP request to your server when something happens in the store.', 'hooks.add': 'Add webhook', 'hooks.create': 'Create webhook', 'hooks.created': 'Webhook created', 'hooks.deleted': 'Webhook deleted',
  'hooks.empty': 'No webhooks yet.', 'hooks.topic': 'Event', 'hooks.url': 'Endpoint URL', 'hooks.signHelp': 'Each request is signed with the webhook secret in the X-Shopify-Hmac-Sha256 header.',
  'hooks.showSecret': 'Show secret', 'hooks.hideSecret': 'Hide secret', 'hooks.secret': 'Signing secret', 'hooks.deliveries': 'Deliveries', 'hooks.deliveriesTitle': 'Deliveries for {topic}', 'hooks.noDeliveries': 'No deliveries yet.', 'hooks.deleteTitle': 'Delete this webhook?',

  'shopify.howTitle': 'How to connect your Shopify store', 'shopify.step1': 'In Shopify admin, open Settings, then Apps and sales channels, then Develop apps.',
  'shopify.step2': 'Create an app and configure Admin API scopes: read_products, read_customers, read_orders, read_content and read_inventory.', 'shopify.step3': 'Install the app and reveal the Admin API access token (it starts with shpat_).',
  'shopify.step4': 'Paste your store domain and the token below, then start the import.', 'shopify.scopes': 'Use read-only scopes only. The token is used for this import and is not stored.',
  'shopify.formTitle': 'Connection', 'shopify.domain': 'Store domain', 'shopify.token': 'Admin API access token', 'shopify.start': 'Start import', 'shopify.running': 'Import in progress', 'shopify.done': 'Import finished',
} as const;
