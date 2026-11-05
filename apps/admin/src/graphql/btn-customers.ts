// Customers, content and analytics buttons: merge, bulk edit, erasure, companies, saved views, goals, annotations, explorations, live view.

/* ------------------------------ customers ------------------------------ */

export const CUSTOMER_DETAIL_EXTRAS = /* GraphQL */ `
  query CustomerDetailExtras($id: ID!) {
    customer(id: $id) {
      id canDelete shopmeErasureScheduledAt shopmeErasedAt
      smsMarketingConsent { marketingState }
      statistics { rfmGroup }
      shopmeCompanies { id title isMainContact company { id name } }
      lastOrder {
        id name createdAt displayFinancialStatus displayFulfillmentStatus
        lineItems(first: 4) { nodes { id title quantity variant { image { url } } } }
      }
    }
  }
`;

export const CUSTOMER_MERGE_PREVIEW = /* GraphQL */ `
  query CustomerMergePreview($a: ID!, $b: ID!, $o: CustomerMergeOverrideFields) {
    shopmeCustomerMergePreview(customerOneId: $a, customerTwoId: $b, overrideFields: $o) {
      resultingCustomerId blockers
      customerOne { id displayName defaultEmailAddress { emailAddress } defaultPhoneNumber { phoneNumber } numberOfOrders }
      customerTwo { id displayName defaultEmailAddress { emailAddress } defaultPhoneNumber { phoneNumber } numberOfOrders }
      fields { firstName lastName email phone tags note defaultAddress { address1 city country } }
      moves { orders draftOrders addresses storeCreditAccounts giftCards timelineEvents companyContacts }
    }
  }
`;
export const CUSTOMER_MERGE = /* GraphQL */ `
  mutation CustomerMerge($a: ID!, $b: ID!, $o: CustomerMergeOverrideFields) {
    customerMerge(customerOneId: $a, customerTwoId: $b, overrideFields: $o) { resultingCustomerId userErrors { field message } }
  }
`;
export const CUSTOMER_BULK_UPDATE = /* GraphQL */ `
  mutation CustomerBulkUpdate($ids: [ID!]!, $input: ShopmeCustomerBulkInput!) {
    shopmeCustomerBulkUpdate(customerIds: $ids, input: $input) { updatedCount failures { customerId message } userErrors { field message } }
  }
`;
export const CUSTOMER_DATA_REQUEST = /* GraphQL */ `
  mutation CustomerDataRequest($id: ID!) { shopmeCustomerDataRequest(customerId: $id) { data userErrors { field message } } }
`;
export const CUSTOMER_REQUEST_ERASURE = /* GraphQL */ `
  mutation CustomerRequestErasure($id: ID!) { customerRequestDataErasure(customerId: $id) { customerId userErrors { field message } } }
`;
export const CUSTOMER_CANCEL_ERASURE = /* GraphQL */ `
  mutation CustomerCancelErasure($id: ID!) { customerCancelDataErasure(customerId: $id) { customerId userErrors { field message } } }
`;
export const EMAIL_EVENT_BODY = /* GraphQL */ `
  query EmailEventBody($id: ID!) { node(id: $id) { ... on BasicEvent { shopmeEmailHtml } } }
`;
export const CUSTOMER_PICKER = /* GraphQL */ `
  query CustomerPicker($query: String) {
    customers(first: 20, query: $query, sortKey: NAME) { nodes { id displayName defaultEmailAddress { emailAddress } numberOfOrders } }
  }
`;

/* ------------------------------ companies ------------------------------ */

const COMPANY_ROW = 'id name externalId createdAt contactsCount { count } locationsCount { count } ordersCount { count } totalSpent { amount currencyCode } mainContact { customer { displayName } }';
export const COMPANIES = /* GraphQL */ `
  query Companies($first: Int, $after: String, $last: Int, $before: String, $query: String, $sortKey: CompanySortKeys, $reverse: Boolean) {
    companies(first: $first, after: $after, last: $last, before: $before, query: $query, sortKey: $sortKey, reverse: $reverse) {
      nodes { ${COMPANY_ROW} }
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    }
  }
`;
export const COMPANIES_COUNT = /* GraphQL */ `query CompaniesCount { companiesCount { count } }`;
export const COMPANY = /* GraphQL */ `
  query Company($id: ID!) {
    company(id: $id) {
      id name externalId note createdAt
      ordersCount { count } totalSpent { amount currencyCode } draftOrdersCount { count }
      contacts(first: 100) { nodes { id title isMainContact customer { id displayName defaultEmailAddress { emailAddress } } } }
      locations(first: 100) {
        nodes {
          id name phone externalId note taxRegistrationId taxExempt
          billingAddress { address1 address2 city zip province countryCode }
          buyerExperienceConfiguration { paymentTermsTemplate { days name } }
        }
      }
      orders(first: 10) { nodes { id name createdAt displayFinancialStatus totalPriceSet { shopMoney { amount currencyCode } } } }
    }
  }
`;
export const COMPANY_CREATE = /* GraphQL */ `
  mutation CompanyCreate($input: CompanyCreateInput!) { companyCreate(input: $input) { company { id } userErrors { field message } } }
`;
export const COMPANY_UPDATE = /* GraphQL */ `
  mutation CompanyUpdate($id: ID!, $input: CompanyInput!) { companyUpdate(companyId: $id, input: $input) { company { id } userErrors { field message } } }
`;
export const COMPANIES_DELETE = /* GraphQL */ `
  mutation CompaniesDelete($ids: [ID!]!) { companiesDelete(companyIds: $ids) { deletedCompanyIds userErrors { field message } } }
`;
export const COMPANY_LOCATION_CREATE = /* GraphQL */ `
  mutation CompanyLocationCreate($id: ID!, $input: CompanyLocationInput!) { companyLocationCreate(companyId: $id, input: $input) { companyLocation { id } userErrors { field message } } }
`;
export const COMPANY_LOCATION_UPDATE = /* GraphQL */ `
  mutation CompanyLocationUpdate($id: ID!, $input: CompanyLocationInput!) { companyLocationUpdate(companyLocationId: $id, input: $input) { companyLocation { id } userErrors { field message } } }
`;
export const COMPANY_LOCATION_DELETE = /* GraphQL */ `
  mutation CompanyLocationDelete($id: ID!) { companyLocationDelete(companyLocationId: $id) { deletedCompanyLocationId userErrors { field message } } }
`;
export const COMPANY_ASSIGN_CONTACT = /* GraphQL */ `
  mutation CompanyAssignContact($company: ID!, $customer: ID!) { companyAssignCustomerAsContact(companyId: $company, customerId: $customer) { companyContact { id } userErrors { field message } } }
`;
export const COMPANY_ADD_CUSTOMERS = /* GraphQL */ `
  mutation CompanyAddCustomers($company: ID!, $ids: [ID!]!) { shopmeCompanyAddCustomers(companyId: $company, customerIds: $ids) { addedCount failures { customerId message } userErrors { field message } } }
`;
export const COMPANY_REMOVE_CONTACT = /* GraphQL */ `
  mutation CompanyRemoveContact($id: ID!) { companyContactRemoveFromCompany(companyContactId: $id) { removedCompanyContactId userErrors { field message } } }
`;
export const COMPANY_MAIN_CONTACT = /* GraphQL */ `
  mutation CompanyMainContact($company: ID!, $contact: ID!) { companyAssignMainContact(companyId: $company, companyContactId: $contact) { company { id } userErrors { field message } } }
`;
export const COMPANY_CONTACT_UPDATE = /* GraphQL */ `
  mutation CompanyContactUpdate($id: ID!, $title: String) { companyContactUpdate(companyContactId: $id, input: { title: $title }) { companyContact { id } userErrors { field message } } }
`;
export const COMPANY_PICKER = /* GraphQL */ `
  query CompanyPicker($query: String) {
    companies(first: 20, query: $query) {
      nodes { id name contacts(first: 50) { nodes { id customer { displayName } } } locations(first: 50) { nodes { id name } } }
    }
  }
`;
export const DRAFT_SET_COMPANY = /* GraphQL */ `
  mutation DraftSetCompany($draft: ID!, $company: ID, $contact: ID, $location: ID) {
    shopmeDraftOrderSetCompany(draftOrderId: $draft, companyId: $company, companyContactId: $contact, companyLocationId: $location) { draftOrderId userErrors { field message } }
  }
`;
export const DRAFT_COMPANY = /* GraphQL */ `
  query DraftCompany($id: ID!) { draftOrder(id: $id) { id shopmePurchasingCompany { company { id name } contact { id customer { displayName } } location { id name } } } }
`;
export const ORDER_COMPANY = /* GraphQL */ `
  query OrderCompany($id: ID!) { order(id: $id) { id shopmePurchasingCompany { company { id name } contact { id customer { displayName } } location { id name buyerExperienceConfiguration { paymentTermsTemplate { name } } } } } }
`;

/* ------------------------------ content ------------------------------ */

export const SAVED_VIEWS_PAGE = /* GraphQL */ `query PageSavedViews { views: pageSavedSearches(first: 50) { nodes { id name query params resourceType } } }`;
export const SAVED_VIEWS_ARTICLE = /* GraphQL */ `query ArticleSavedViews { views: articleSavedSearches(first: 50) { nodes { id name query params resourceType } } }`;
export const STORE_PREFERENCES = /* GraphQL */ `
  query StorePreferences { shop { id name description shopmeStorefront { passwordEnabled password passwordMessage b2bOnly homepageTitle socialSharingImage } } }
`;

/* ------------------------------ analytics ------------------------------ */

export const REPORT_STATES = /* GraphQL */ `query ReportStates { shopmeReportStates { key pinned lastViewedAt } }`;
export const REPORT_PIN = /* GraphQL */ `
  mutation ReportPin($key: String!, $pinned: Boolean!) { shopmeReportPin(key: $key, pinned: $pinned) { state { key pinned } userErrors { field message } } }
`;
export const REPORT_VIEWED = /* GraphQL */ `mutation ReportViewed($key: String!) { shopmeReportViewed(key: $key) { state { key } } }`;
export const REPORT_CURRENCIES = /* GraphQL */ `query ReportCurrencies { shopmeReportCurrencies { code rate } }`;
export const SHOPME_REPORT_CURRENCY = /* GraphQL */ `
  query ShopmeReportIn($name: ShopmeReportName!, $from: String!, $to: String!, $groupBy: ShopmeReportGroupBy, $currency: String) {
    shopmeReport(name: $name, from: $from, to: $to, groupBy: $groupBy, currency: $currency) { name currencyCode from to groupBy columns { key label type } rows totals }
  }
`;
export const GOALS = /* GraphQL */ `query Goals { shopmeGoals { id metric period target actual from to elapsed } }`;
export const GOAL_SET = /* GraphQL */ `
  mutation GoalSet($metric: ShopmeGoalMetric!, $period: ShopmeGoalPeriod!, $target: Float!) { shopmeGoalSet(metric: $metric, period: $period, target: $target) { goalId userErrors { field message } } }
`;
export const GOAL_DELETE = /* GraphQL */ `mutation GoalDelete($id: ID!) { shopmeGoalDelete(id: $id) { deletedId userErrors { field message } } }`;
export const ANNOTATIONS = /* GraphQL */ `
  query Annotations($reportKey: String, $from: String, $to: String) { shopmeAnnotations(reportKey: $reportKey, from: $from, to: $to) { id day text reportKey } }
`;
export const ANNOTATION_CREATE = /* GraphQL */ `
  mutation AnnotationCreate($day: String!, $text: String!, $reportKey: String) { shopmeAnnotationCreate(day: $day, text: $text, reportKey: $reportKey) { annotation { id } userErrors { field message } } }
`;
export const ANNOTATION_DELETE = /* GraphQL */ `mutation AnnotationDelete($id: ID!) { shopmeAnnotationDelete(id: $id) { deletedId userErrors { field message } } }`;
export const EXPLORATIONS = /* GraphQL */ `query Explorations { shopmeExplorations { id name definition createdByName createdAt updatedAt } }`;
export const EXPLORATION = /* GraphQL */ `query Exploration($id: ID!) { shopmeExploration(id: $id) { id name definition createdByName } }`;
export const EXPLORATION_CATALOG = /* GraphQL */ `query ExplorationCatalog { shopmeExplorationCatalog }`;
export const EXPLORATION_RUN = /* GraphQL */ `
  query ExplorationRun($definition: JSON!, $from: String!, $to: String!) {
    shopmeExplorationRun(definition: $definition, from: $from, to: $to) { currencyCode from to columns { key label type } rows totals }
  }
`;
export const EXPLORATION_SAVE = /* GraphQL */ `
  mutation ExplorationSave($id: ID, $name: String!, $definition: JSON!) { shopmeExplorationSave(id: $id, name: $name, definition: $definition) { exploration { id name } userErrors { field message } } }
`;
export const EXPLORATION_DELETE = /* GraphQL */ `mutation ExplorationDelete($id: ID!) { shopmeExplorationDelete(id: $id) { deletedId userErrors { field message } } }`;
export const LIVE_VIEW = /* GraphQL */ `
  query LiveView {
    shopmeLiveView {
      at currencyCode visitorsNow sessionsToday ordersToday salesToday activeCarts
      viewsPerMinute { minute views } topPages { path views } topSources { source sessions } recentOrders { id name total createdAt country }
    }
  }
`;
