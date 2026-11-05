// Customer segments (ShopMe extension), store access state and files.

const SEGMENT = 'id name query createdAt updatedAt customersCount { count }';
export const SEGMENTS = /* GraphQL */ `
  query CustomerSegments { shopmeCustomerSegments { ${SEGMENT} } }
`;
export const SEGMENT_GET = /* GraphQL */ `
  query CustomerSegment($id: ID!) { shopmeCustomerSegment(id: $id) { ${SEGMENT} } }
`;
export const SEGMENT_CREATE = /* GraphQL */ `
  mutation CustomerSegmentCreate($name: String!, $query: String!) { shopmeCustomerSegmentCreate(name: $name, query: $query) { segment { id } userErrors { field message } } }
`;
export const SEGMENT_UPDATE = /* GraphQL */ `
  mutation CustomerSegmentUpdate($id: ID!, $name: String, $query: String) { shopmeCustomerSegmentUpdate(id: $id, name: $name, query: $query) { segment { id } userErrors { field message } } }
`;
export const SEGMENT_DELETE = /* GraphQL */ `
  mutation CustomerSegmentDelete($id: ID!) { shopmeCustomerSegmentDelete(id: $id) { deletedSegmentId userErrors { field message } } }
`;

/** Password protection state, for the "restricted access" banner and the Preferences page. */
export const STORE_ACCESS = /* GraphQL */ `
  query StoreAccess { shop { id name description shopmeStorefront { passwordEnabled password passwordMessage } } }
`;
export const STORE_ACCESS_UPDATE = /* GraphQL */ `
  mutation StoreAccessUpdate($input: ShopmeShopInput!) { shopmeShopUpdate(input: $input) { shop { id } userErrors { field message } } }
`;

export const FILES = /* GraphQL */ `
  query Files($first: Int, $after: String, $last: Int, $before: String, $query: String) {
    files(first: $first, after: $after, last: $last, before: $before, query: $query) {
      nodes { id alt createdAt ... on MediaImage { mimeType image { url width height } } }
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    }
  }
`;
export const FILE_CREATE = /* GraphQL */ `
  mutation FileCreate($files: [FileCreateInput!]!) { fileCreate(files: $files) { files { id } userErrors { field message } } }
`;
export const FILE_UPDATE = /* GraphQL */ `
  mutation FileUpdate($files: [FileUpdateInput!]!) { fileUpdate(files: $files) { files { id } userErrors { field message } } }
`;
export const FILE_DELETE = /* GraphQL */ `
  mutation FileDelete($fileIds: [ID!]!) { fileDelete(fileIds: $fileIds) { deletedFileIds userErrors { field message } } }
`;
