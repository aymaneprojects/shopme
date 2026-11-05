// Metaobject definitions and entries.

const DEFINITION_FIELDS = /* GraphQL */ `
  id type name description displayNameKey metaobjectsCount createdAt updatedAt
  access { admin storefront customerAccount }
  capabilities { publishable { enabled } translatable { enabled } renderable { enabled data { metaTitleKey metaDescriptionKey } } onlineStore { enabled data { urlHandle canCreateRedirects } } }
  fieldDefinitions { key name description required type { name } validations { name value } capabilities { adminFilterable { enabled } } }
`;

export const METAOBJECTS_SUMMARY = /* GraphQL */ `
  query MetaobjectsSummary {
    shopmeMetaobjectsSummary { activeCount draftCount webPageCount webPageEntryCount totalCount recent { id displayName definition { id name } } }
  }
`;

export const METAOBJECT_DEFINITIONS = /* GraphQL */ `
  query MetaobjectDefinitions($query: String) {
    metaobjectDefinitions(first: 100, query: $query) { nodes { id type name description metaobjectsCount updatedAt shopmeSystem capabilities { publishable { enabled } onlineStore { enabled } } fieldDefinitions { key } } }
  }
`;

export const METAOBJECT_DEFINITION = /* GraphQL */ `
  query MetaobjectDefinition($id: ID!) { metaobjectDefinition(id: $id) { ${DEFINITION_FIELDS} } }
`;

export const METAOBJECT_DEFINITION_BY_TYPE = /* GraphQL */ `
  query MetaobjectDefinitionByType($type: String!) { metaobjectDefinitionByType(type: $type) { ${DEFINITION_FIELDS} } }
`;

export const METAOBJECT_DEFINITION_CREATE = /* GraphQL */ `
  mutation MetaobjectDefinitionCreate($definition: MetaobjectDefinitionCreateInput!) {
    metaobjectDefinitionCreate(definition: $definition) { metaobjectDefinition { id type } userErrors { field message code elementKey elementIndex } }
  }
`;

export const METAOBJECT_DEFINITION_UPDATE = /* GraphQL */ `
  mutation MetaobjectDefinitionUpdate($id: ID!, $definition: MetaobjectDefinitionUpdateInput!) {
    metaobjectDefinitionUpdate(id: $id, definition: $definition) { metaobjectDefinition { id type } userErrors { field message code elementKey elementIndex } }
  }
`;

export const METAOBJECT_DEFINITION_DELETE = /* GraphQL */ `
  mutation MetaobjectDefinitionDelete($id: ID!) { metaobjectDefinitionDelete(id: $id) { deletedId userErrors { field message code } } }
`;

const ENTRY_ROW = /* GraphQL */ `id handle displayName type updatedAt createdAt capabilities { publishable { status } } fields { key type value }`;

export const METAOBJECTS = /* GraphQL */ `
  query Metaobjects($type: String!, $query: String, $sortKey: String, $reverse: Boolean, $first: Int, $after: String, $last: Int, $before: String) {
    metaobjects(type: $type, query: $query, sortKey: $sortKey, reverse: $reverse, first: $first, after: $after, last: $last, before: $before) {
      nodes { ${ENTRY_ROW} }
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    }
  }
`;

export const SHOPME_METAOBJECTS = /* GraphQL */ `
  query ShopmeMetaobjects($query: String, $sortKey: String, $reverse: Boolean, $first: Int, $after: String, $last: Int, $before: String) {
    shopmeMetaobjects(query: $query, sortKey: $sortKey, reverse: $reverse, first: $first, after: $after, last: $last, before: $before) {
      nodes { id handle displayName type updatedAt capabilities { publishable { status } } definition { id name type capabilities { publishable { enabled } } } }
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    }
  }
`;

const REFERENCE = /* GraphQL */ `
  ... on Product { id title }
  ... on ProductVariant { id title product { title } }
  ... on Collection { id title }
  ... on Page { id title }
  ... on MediaImage { id alt image { url } }
  ... on Metaobject { id displayName definition { name } }
`;

export const METAOBJECT = /* GraphQL */ `
  query Metaobject($id: ID!) {
    metaobject(id: $id) {
      id handle shopmeExternalId displayName type updatedAt createdAt
      capabilities { publishable { status } onlineStore { templateSuffix } }
      definition { ${DEFINITION_FIELDS} }
      fields { key type value reference { ${REFERENCE} } references(first: 100) { nodes { ${REFERENCE} } } }
      referencedBy(first: 20) { nodes { key name namespace referencer { __typename ... on Metaobject { id displayName } ... on Product { id title } ... on Collection { id title } ... on Page { id title } ... on ProductVariant { id title } } } }
    }
  }
`;

export const METAOBJECT_CREATE = /* GraphQL */ `
  mutation MetaobjectCreate($metaobject: MetaobjectCreateInput!) {
    metaobjectCreate(metaobject: $metaobject) { metaobject { id } userErrors { field message code elementKey elementIndex } }
  }
`;

export const METAOBJECT_UPDATE = /* GraphQL */ `
  mutation MetaobjectUpdate($id: ID!, $metaobject: MetaobjectUpdateInput!) {
    metaobjectUpdate(id: $id, metaobject: $metaobject) { metaobject { id } userErrors { field message code elementKey elementIndex } }
  }
`;

export const METAOBJECT_DELETE = /* GraphQL */ `
  mutation MetaobjectDelete($id: ID!) { metaobjectDelete(id: $id) { deletedId userErrors { field message code } } }
`;

export const METAOBJECT_BULK_DELETE = /* GraphQL */ `
  mutation MetaobjectBulkDelete($where: MetaobjectBulkDeleteWhereCondition!) { metaobjectBulkDelete(where: $where) { job { id done } userErrors { field message code } } }
`;

// Pickers for reference fields.
export const MO_PICK_PAGES = /* GraphQL */ `
  query MetaobjectPickPages($query: String) { pages(first: 30, query: $query) { nodes { id title handle } } }
`;
export const MO_PICK_FILES = /* GraphQL */ `
  query MetaobjectPickFiles($query: String) { files(first: 30, query: $query) { nodes { id alt shopmeFilename ... on MediaImage { image { url } } } } }
`;
export const MO_PICK_ENTRIES = /* GraphQL */ `
  query MetaobjectPickEntries($type: String!, $query: String) { metaobjects(type: $type, first: 30, query: $query) { nodes { id displayName handle } } }
`;
export const MO_PICK_ALL_ENTRIES = /* GraphQL */ `
  query MetaobjectPickAllEntries($query: String) { shopmeMetaobjects(first: 30, query: $query) { nodes { id displayName handle definition { name type } } } }
`;

export const MO_REF_LABELS = /* GraphQL */ `
  query MetaobjectRefLabels($ids: [ID!]!) {
    nodes(ids: $ids) { id ... on Metaobject { displayName } ... on Product { title } ... on Collection { title } ... on Page { title } ... on ProductVariant { title } ... on MediaImage { alt } }
  }
`;
