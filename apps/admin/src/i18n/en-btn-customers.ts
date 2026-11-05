// Customers, content and analytics: merge, bulk edit, erasure, companies, query bar, explorations, goals, live view.
export const enBtnCustomers = {
  // customers list and page
  'nav.contentMenus': 'Menus', 'bc.companies': 'Companies', 'bc.editInBulk': 'Edit in bulk', 'bc.grantCredit': 'Grant store credit', 'bc.merge': 'Merge customers', 'bc.mergeCustomer': 'Merge customer', 'bc.addToCompany': 'Add to company',
  'bc.help.subscription': 'Whether the customer agreed to receive marketing emails.', 'bc.help.location': 'The city and country of the default address.', 'bc.help.spent': 'What the customer paid, minus refunds. Cancelled orders do not count.',
  'bc.group': 'Customer group', 'bc.group.customer': 'Customer', 'bc.group.prospect': 'Prospect',
  'bc.rfm.CHAMPIONS': 'Champions', 'bc.rfm.LOYAL': 'Loyal', 'bc.rfm.ACTIVE': 'Active', 'bc.rfm.NEW': 'New', 'bc.rfm.PROMISING': 'Promising', 'bc.rfm.NEEDS_ATTENTION': 'Needs attention',
  'bc.rfm.ALMOST_LOST': 'Almost lost', 'bc.rfm.PREVIOUSLY_LOYAL': 'Previously loyal', 'bc.rfm.AT_RISK': 'At risk', 'bc.rfm.DORMANT': 'Dormant', 'bc.rfm.PROSPECTS': 'Prospects',
  'bc.channel.email': 'Email', 'bc.channel.sms': 'SMS',
  'bc.phone.country': 'Country code', 'bc.phone.none': 'None', 'bc.sms.consent': 'Customer agreed to receive SMS marketing', 'bc.sms.needsPhone': 'Add a phone number to collect SMS consent.',
  'segments.builtin.abandoned': 'Customers with an abandoned checkout in the last 30 days',

  // query bar
  'bc.queryBar.label': 'Filter customers with a query', 'bc.queryBar.placeholder': 'orders_count:>2 country:FR -tag:vip', 'bc.queryBar.apply': 'Apply', 'bc.queryBar.clear': 'Clear', 'bc.queryBar.save': 'Save as segment',
  'bc.queryBar.hint': 'Filter with a query such as {fields}. Example: orders_count:>2 amount_spent:>100 -tag:vip',
  'bc.queryBar.problem.unknownField': 'is not a customer field.', 'bc.queryBar.problem.badNumber': 'needs a number.', 'bc.queryBar.problem.badDate': 'needs a date such as 2026-01-31.',
  'bc.queryBar.problem.badBool': 'needs true or false.', 'bc.queryBar.problem.badValue': 'is not an accepted value.', 'bc.queryBar.problem.empty': 'has no value.',

  // bulk edit
  'bc.bulk.title': 'Edit {n} customers', 'bc.bulk.title.one': 'Edit 1 customer', 'bc.bulk.apply': 'Apply changes', 'bc.bulk.addTags': 'Add tags', 'bc.bulk.removeTags': 'Remove tags',
  'bc.bulk.email': 'Email marketing', 'bc.bulk.sms': 'SMS marketing', 'bc.bulk.noChange': 'Do not change', 'bc.bulk.subscribe': 'Subscribe', 'bc.bulk.unsubscribe': 'Unsubscribe',
  'bc.bulk.tax': 'Tax exemption', 'bc.bulk.taxHelp': 'Exempt customers are not charged tax on their orders.', 'bc.bulk.noteAppend': 'Add to the existing note', 'bc.bulk.noteReplace': 'Replace the note', 'bc.bulk.noteClear': 'Clear the note',
  'bc.bulk.done': '{n} customers updated', 'bc.bulk.done.one': '1 customer updated', 'bc.bulk.failed': 'Some customers were skipped:',
  'bc.bulk.help': 'Only the fields you change are touched. Consent changes need an email address or a phone number on the customer.',

  // merge
  'bc.merge.title': 'Merge customers', 'bc.merge.pickTitle': 'Merge with another customer', 'bc.merge.intro': 'Choose the customer to keep. The other one is merged into it and deleted.',
  'bc.merge.keep': 'Customer to keep', 'bc.merge.keptValue': 'Kept customer', 'bc.merge.otherValue': 'Merged customer', 'bc.merge.result': 'Merged customer',
  'bc.merge.confirm': 'Merge customers', 'bc.merge.done': 'Customers merged', 'bc.merge.warning': 'This cannot be undone.',
  'bc.merge.blockedErased': 'A customer whose personal data was erased cannot be merged.', 'bc.merge.blockedErasure': 'A customer with a scheduled data erasure cannot be merged. Cancel the erasure first.',
  'bc.merge.moves.orders': '{n} orders move over', 'bc.merge.moves.orders.one': '1 order moves over', 'bc.merge.moves.draftOrders': '{n} draft orders move over', 'bc.merge.moves.draftOrders.one': '1 draft order moves over',
  'bc.merge.moves.addresses': '{n} addresses move over', 'bc.merge.moves.addresses.one': '1 address moves over', 'bc.merge.moves.storeCreditAccounts': 'Store credit is combined', 'bc.merge.moves.giftCards': '{n} gift cards move over',
  'bc.merge.moves.giftCards.one': '1 gift card moves over', 'bc.merge.moves.timelineEvents': 'Timeline entries move over',

  // data request and erasure
  'bc.erase.action': 'Erase personal data', 'bc.erase.cancel': 'Cancel erasure', 'bc.erase.title': 'Erase personal data?', 'bc.erase.confirm': 'Request erasure',
  'bc.erase.body': 'The customer\'s name, contact details, addresses, notes and timeline are anonymized after 10 days. Their orders stay for your records, without personal details. You can cancel until then.',
  'bc.erase.requested': 'Erasure requested', 'bc.erase.cancelled': 'Erasure cancelled', 'bc.erase.scheduled': 'Personal data will be erased on {date}.', 'bc.erase.done': 'Personal data was erased on {date}. Orders are kept without personal details.',

  // timeline
  'bc.timeline.attach': 'Attach files', 'bc.timeline.showEmail': 'Show email', 'bc.timeline.email': 'Email', 'bc.timeline.emailTo': 'Sent to {to}', 'bc.timeline.emailGone': 'The content of this email is no longer available.',

  // companies
  'bc.company.name': 'Company', 'bc.company.add': 'Add company', 'bc.company.create': 'Create company', 'bc.company.search': 'Search companies', 'bc.company.mainContact': 'Main contact', 'bc.company.locations': 'Locations',
  'bc.company.since': 'Customer since', 'bc.company.emptyTitle': 'Sell to businesses', 'bc.company.emptyBody': 'Companies group the buyers of a business, with their locations, tax details and payment terms. Add one to place orders for it.',
  'bc.company.deleteTitle': 'Delete {n} companies?', 'bc.company.deleteTitle.one': 'Delete this company?', 'bc.company.deleteBody': 'Locations and contact links are removed. The customers and past orders stay.',
  'bc.company.deleted': '{n} companies deleted', 'bc.company.deleted.one': 'Company deleted', 'bc.company.externalId': 'External ID', 'bc.company.externalIdHelp': 'The company\'s id in your accounting or ERP system.',
  'bc.company.firstLocation': 'First location', 'bc.company.taxId': 'Tax registration ID', 'bc.company.terms': 'Payment terms', 'bc.company.termsHelp': 'When the company pays after ordering.', 'bc.company.taxExempt': 'Tax exempt',
  'bc.company.terms.none': 'Pay at checkout', 'bc.company.terms.receipt': 'Due on receipt', 'bc.company.terms.net': 'Net {n} days',
  'bc.company.addLocation': 'Add location', 'bc.company.editLocation': 'Edit location', 'bc.company.locationName': 'Location name', 'bc.company.noAddress': 'No address', 'bc.company.contacts': 'Contacts', 'bc.company.addContact': 'Add contact',
  'bc.company.noContacts': 'No contacts yet. Add a customer to let them buy for this company.', 'bc.company.main': 'Main contact', 'bc.company.makeMain': 'Make main contact', 'bc.company.editTitle': 'Edit job title',
  'bc.company.contactTitle': 'Job title', 'bc.company.removeContact': 'Remove from company', 'bc.company.details': 'Details', 'bc.company.openDrafts': 'Open draft orders', 'bc.company.saved': 'Company saved',
  'bc.company.notFound': 'This company does not exist.', 'bc.company.deleteLocationTitle': 'Delete this location?', 'bc.company.deleteLocationBody': 'A company needs at least one location, and a location with orders cannot be deleted.',
  'bc.company.addTitle': 'Add {n} customers to a company', 'bc.company.addTitle.one': 'Add 1 customer to a company', 'bc.company.none': 'No company found.', 'bc.company.noneYet': 'Not part of a company.',
  'bc.company.added': '{n} customers added to the company', 'bc.company.added.one': '1 customer added to the company', 'bc.company.addedSome': '{n} added, {failed} skipped (already contacts)',
  'bc.draft.title': 'Company for this order', 'bc.draft.change': 'Change company', 'bc.draft.remove': 'Remove company', 'bc.draft.none': 'No company. The order is for a consumer.', 'bc.draft.location': 'Location', 'bc.draft.contact': 'Contact',
  'bc.draft.contactHelp': 'Choosing a contact also sets the draft\'s customer when it has none.', 'bc.draft.noContact': 'No contact', 'bc.draft.other': 'Other company', 'bc.draft.saved': 'Company saved on the draft', 'bc.draft.loadFailed': 'The company could not be loaded.',

  // content
  'bc.template.preview': 'Preview template', 'bc.files.type.model': '3D models', 'bc.files.model': '3D model file',
  'bc.prefs.viewStore': 'View your store', 'bc.prefs.copyUrl': 'Copy store link', 'bc.prefs.copied': 'Link copied', 'bc.prefs.passwordOn': 'Turn on password protection', 'bc.prefs.passwordOff': 'Turn off password protection',
  'bc.prefs.b2bOnly': 'Restrict access to B2B customers only', 'bc.prefs.b2bOnlyHelp': 'Visitors must sign in with a customer account that belongs to a company. Account pages stay open so they can sign in.', 'bc.prefs.manageCompanies': 'Manage companies',
  'bc.prefs.shareImage': 'Social sharing image', 'bc.prefs.addShareImage': 'Add image', 'bc.prefs.shareImageHelp': 'Shown when your home page is shared on social networks. 1200 x 628 px works best.', 'bc.prefs.homeTitle': 'Home page title',
  'bc.mo.view': 'View', 'bc.mo.view.all': 'All definitions', 'bc.mo.view.web': 'With web pages', 'bc.mo.view.entries': 'With entries', 'bc.mo.view.empty': 'Without entries', 'bc.mo.showSystem': 'Show system definitions', 'bc.mo.hideSystem': 'Hide system definitions',
  'bc.mo.externalId': 'External ID', 'bc.mo.externalIdHelp': 'The entry\'s id in another system. It must be unique for this type.', 'bc.menus.drag': 'Drag to reorder',

  // analytics
  'bc.analytics.refreshed': 'Last refreshed {time}', 'bc.analytics.currency': 'Currency', 'bc.analytics.fulfilled': 'Orders fulfilled', 'bc.analytics.live': 'Live view',
  'bc.reports.lastViewed': 'Last viewed', 'bc.reports.createdBy': 'Created by', 'bc.reports.pin': 'Pin {name}', 'bc.reports.unpin': 'Unpin {name}', 'bc.reports.range': '{from}-{to} of {n}',
  'bc.explore.new': 'New exploration', 'bc.explore.category': 'Exploration', 'bc.explore.you': 'You', 'bc.explore.untitled': 'New exploration', 'bc.explore.save': 'Save', 'bc.explore.saved': 'Exploration saved', 'bc.explore.saveTitle': 'Save exploration',
  'bc.explore.rename': 'Rename', 'bc.explore.deleteTitle': 'Delete this exploration?', 'bc.explore.deleteBody': 'The saved report is removed. Your data is not affected.', 'bc.explore.notFound': 'This exploration does not exist.',
  'bc.explore.dataset': 'Data', 'bc.explore.dimension': 'Break down by', 'bc.explore.noDimension': 'Nothing (one total)', 'bc.explore.total': 'Total', 'bc.explore.pickMetric': 'Choose at least one metric.',
  'bc.explore.compareHelp': 'Comparison needs a breakdown by day, week or month.', 'bc.explore.filterHelp': 'Text filters ignore case. "~" means contains.',
  'bc.dataset.ORDERS': 'Orders', 'bc.dataset.PRODUCTS': 'Products sold', 'bc.dataset.CUSTOMERS': 'Customers', 'bc.dataset.SESSIONS': 'Online store sessions',
  'bc.viz.LINE': 'Line chart', 'bc.viz.BAR': 'Bar chart', 'bc.viz.TABLE': 'Table only',
  'bc.controls.toggle': 'Controls', 'bc.controls.title': 'Report controls', 'bc.controls.metrics': 'Metrics', 'bc.controls.dimension': 'Break down by', 'bc.controls.viz': 'Visualization', 'bc.controls.chartMetric': 'Chart metric',
  'bc.controls.cumulative': 'Cumulative', 'bc.controls.filters': 'Filters', 'bc.controls.addFilter': 'Add filter', 'bc.controls.filterField': 'Filter column', 'bc.controls.filterOp': 'Filter operator', 'bc.controls.filterValue': 'Filter value',
  'bc.controls.filterHelp': 'Filters apply to the table rows.',
  'bc.query.label': 'Report query', 'bc.query.refine': 'Refine query',
  'bc.query.error.unterminated': 'A quote is not closed: {token}', 'bc.query.error.unexpected': 'Unexpected character: {token}', 'bc.query.error.expectedKeyword': 'Expected a clause (SHOW, BY, WHERE, SINCE...) before "{token}".',
  'bc.query.error.duplicateClause': '{token} appears twice.', 'bc.query.error.expectedName': 'Expected a name, not "{token}".', 'bc.query.error.emptyClause': '{token} needs a value.', 'bc.query.error.expectedField': 'WHERE needs a column name.',
  'bc.query.error.expectedOperator': 'Add an operator (=, !=, ~, >, <) after "{token}".', 'bc.query.error.expectedValue': 'Add a value after the operator for "{token}".', 'bc.query.error.badDate': '"{token}" is not a date (use YYYY-MM-DD).',
  'bc.query.error.badCompare': '"{token}" is not a comparison. Use none, previous_period or previous_year.', 'bc.query.error.badVisualization': '"{token}" is not a visualization. Use table, line or bar.',
  'bc.query.error.badReport': '"{token}" is not a report.', 'bc.query.error.badSince': '"{token}" is not a period. Use last_7_days, last_30_days, this_month... or a date.', 'bc.query.error.badDataset': '"{token}" is not a dataset. Use orders, products, customers or sessions.',
  'bc.query.error.badMetric': '"{token}" is not a metric of this report.', 'bc.query.error.badDimension': '"{token}" cannot be used after BY here.', 'bc.query.error.badField': '"{token}" cannot be filtered here.',
  'bc.slider.start': 'Start of the zoom', 'bc.slider.end': 'End of the zoom', 'bc.slider.reset': 'Show the whole period',
  'bc.annotations.toggle': 'Annotations', 'bc.annotations.title': 'Annotations', 'bc.annotations.day': 'Date', 'bc.annotations.text': 'Note', 'bc.annotations.placeholder': 'Launched the summer sale', 'bc.annotations.onlyThis': 'Only on this report',
  'bc.annotations.add': 'Add note', 'bc.annotations.none': 'No notes in this period.', 'bc.annotations.allReports': 'All reports',
  'bc.goal.button': 'Goals', 'bc.goal.title': 'Goals', 'bc.goal.intro': 'Set a target for a metric over a calendar period. Progress shows on the overview.', 'bc.goal.metric': 'Metric', 'bc.goal.period': 'Period', 'bc.goal.target': 'Target',
  'bc.goal.add': 'Set goal', 'bc.goal.update': 'Update goal', 'bc.goal.saved': 'Goal saved',
  'bc.goal.metric.TOTAL_SALES': 'Total sales', 'bc.goal.metric.ORDERS': 'Orders', 'bc.goal.metric.AVERAGE_ORDER_VALUE': 'Average order value', 'bc.goal.metric.SESSIONS': 'Sessions',
  'bc.goal.period.WEEK': 'This week', 'bc.goal.period.MONTH': 'This month', 'bc.goal.period.QUARTER': 'This quarter', 'bc.goal.period.YEAR': 'This year',
  'bc.goal.reached': 'Goal reached ({pct} %)', 'bc.goal.onTrack': 'On track ({pct} %)', 'bc.goal.behind': 'Behind the pace ({pct} %)',
  'bc.report.profitNote': 'Profit uses the cost per item set on each variant. Items without a cost count as zero cost.',
  'bc.live.updated': 'Updated {time}', 'bc.live.visitors': 'Visitors right now', 'bc.live.visitorsHint': 'In the last 5 minutes', 'bc.live.sessions': 'Sessions today', 'bc.live.orders': 'Orders today', 'bc.live.sales': 'Sales today',
  'bc.live.carts': 'Active carts', 'bc.live.cartsHint': 'Updated in the last 30 minutes', 'bc.live.perMinute': 'Page views per minute, last 30 minutes', 'bc.live.views': 'Page views', 'bc.live.topPages': 'Top pages', 'bc.live.topSources': 'Traffic sources',
  'bc.live.recentOrders': 'Latest orders', 'bc.live.quiet': 'No visits in the last 30 minutes.', 'bc.live.noOrders': 'No orders in the last 24 hours.', 'bc.live.direct': 'Direct',

  // names of dimensions, metrics and filters
  'bc.dim.day': 'Day', 'bc.dim.week': 'Week', 'bc.dim.month': 'Month', 'bc.dim.channel': 'Sales channel', 'bc.dim.financial_status': 'Payment status', 'bc.dim.fulfillment_status': 'Fulfillment status', 'bc.dim.country': 'Shipping country',
  'bc.dim.currency': 'Currency', 'bc.dim.weekday': 'Day of week', 'bc.dim.hour': 'Hour of day', 'bc.dim.customer_type': 'Customer type', 'bc.dim.product': 'Product', 'bc.dim.variant': 'Variant', 'bc.dim.vendor': 'Vendor', 'bc.dim.sku': 'SKU',
  'bc.dim.customer': 'Customer', 'bc.dim.subscription': 'Email subscription', 'bc.dim.language': 'Language', 'bc.dim.source': 'Traffic source', 'bc.dim.page': 'Page',
  'bc.metric.gross_sales': 'Gross sales', 'bc.metric.total_sales': 'Total sales', 'bc.metric.avg_price': 'Average unit price', 'bc.metric.sales': 'Sales', 'bc.metric.avg_order': 'Average order value',
  'bc.metric.fulfilled': 'Orders fulfilled', 'bc.metric.channel': 'Sales channel', 'bc.metric.gateway': 'Payment method', 'bc.metric.paid': 'Paid', 'bc.metric.refunded': 'Refunded', 'bc.metric.country': 'Country',
  'bc.metric.new_orders': 'New customer orders', 'bc.metric.returning_orders': 'Returning customer orders', 'bc.metric.new_sales': 'New customer sales', 'bc.metric.returning_sales': 'Returning customer sales',
  'bc.metric.cost': 'Cost of goods', 'bc.metric.profit': 'Profit', 'bc.metric.margin': 'Margin', 'bc.metric.source': 'Traffic source', 'bc.metric.path': 'Page', 'bc.metric.cohort': 'First order month',
  'bc.metric.m0': 'Month 0', 'bc.metric.m1': 'Month 1', 'bc.metric.m2': 'Month 2', 'bc.metric.m3': 'Month 3', 'bc.metric.m4': 'Month 4', 'bc.metric.m5': 'Month 5',
  'bc.metric.segment': 'RFM group', 'bc.metric.average': 'Average spent', 'bc.metric.stock': 'Units in stock', 'bc.metric.sold': 'Units sold', 'bc.metric.sell_through': 'Sell-through rate', 'bc.metric.share': 'Share of sales',
  'bc.metric.cumulative': 'Cumulative share', 'bc.metric.class': 'ABC class',
  'bc.filter.channel': 'Sales channel', 'bc.filter.financial_status': 'Payment status', 'bc.filter.fulfillment_status': 'Fulfillment status', 'bc.filter.country': 'Shipping country', 'bc.filter.currency': 'Currency', 'bc.filter.tag': 'Tag',
  'bc.filter.total': 'Order total (minor units)', 'bc.filter.product': 'Product', 'bc.filter.vendor': 'Vendor', 'bc.filter.sku': 'SKU', 'bc.filter.quantity': 'Quantity', 'bc.filter.customer': 'Customer', 'bc.filter.subscription': 'Email subscription',
  'bc.filter.language': 'Language', 'bc.filter.source': 'Traffic source', 'bc.filter.page': 'Page',
  'bc.value.channel.web': 'Online store', 'bc.value.channel.draft_order': 'Draft orders', 'bc.value.channel.pos': 'Point of sale', 'bc.value.channel.manual': 'Manual',
  'bc.value.gateway.manual': 'Manual', 'bc.value.gateway.stripe': 'Card', 'bc.value.gateway.cod': 'Cash on delivery', 'bc.value.gateway.bank_transfer': 'Bank transfer', 'bc.value.gateway.gift_card': 'Gift card', 'bc.value.gateway.store_credit': 'Store credit', 'bc.value.gateway.free': 'No payment due',
  'bc.value.source.direct': 'Direct',
  'bc.value.segment.CHAMPIONS': 'Champions', 'bc.value.segment.LOYAL': 'Loyal', 'bc.value.segment.ACTIVE': 'Active', 'bc.value.segment.NEW': 'New', 'bc.value.segment.PROMISING': 'Promising', 'bc.value.segment.NEEDS_ATTENTION': 'Needs attention',
  'bc.value.segment.ALMOST_LOST': 'Almost lost', 'bc.value.segment.PREVIOUSLY_LOYAL': 'Previously loyal', 'bc.value.segment.AT_RISK': 'At risk', 'bc.value.segment.DORMANT': 'Dormant', 'bc.value.segment.PROSPECTS': 'Prospects',

  // report names and categories
  'analytics.report.SALES_BY_CHANNEL': 'Sales by channel', 'analytics.report.SALES_BY_PAYMENT_METHOD': 'Sales by payment method', 'analytics.report.SALES_BY_COUNTRY': 'Sales by country', 'analytics.report.NEW_VS_RETURNING': 'New vs returning customers',
  'analytics.report.PROFIT_BY_PRODUCT': 'Profit by product', 'analytics.report.ACQUISITION_BY_REFERRER': 'Acquisition by traffic source', 'analytics.report.TOP_PAGES': 'Top pages', 'analytics.report.CUSTOMER_COHORTS': 'Customer cohorts',
  'analytics.report.RFM_SEGMENTS': 'Customers by RFM group', 'analytics.report.SELL_THROUGH': 'Sell-through rate by product', 'analytics.report.ABC_ANALYSIS': 'ABC analysis of products', 'analytics.category.profit': 'Profit',
} as const;
