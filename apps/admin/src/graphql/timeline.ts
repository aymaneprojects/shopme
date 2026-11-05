// Timeline (events and staff comments) on the order and customer pages, plus fulfillment holds and cancellation.

const EVENTS = `
  events(first: 250, reverse: true, sortKey: ID) {
    nodes {
      __typename
      action message createdAt
      ... on Node { id }
      ... on BasicEvent { arguments authorEmail: author }
      ... on CommentEvent { rawMessage canDelete author { name } }
    }
  }
`;

export const ORDER_TIMELINE = /* GraphQL */ `
  query OrderTimeline($id: ID!) { order(id: $id) { id name currencyCode ${EVENTS} } }
`;
export const CUSTOMER_TIMELINE = /* GraphQL */ `
  query CustomerTimeline($id: ID!) { customer(id: $id) { id ${EVENTS} } }
`;
export const CUSTOMER_TIMELINE_COMMENT_CREATE = /* GraphQL */ `
  mutation CustomerTimelineCommentCreate($id: ID!, $message: String!) {
    customerTimelineCommentCreate(id: $id, message: $message) { event { ... on Node { id } } userErrors { field message } }
  }
`;
export const TIMELINE_COMMENT_DELETE = /* GraphQL */ `
  mutation TimelineCommentDelete($id: ID!) { timelineCommentDelete(id: $id) { deletedCommentId userErrors { field message } } }
`;

export const FULFILLMENT_CANCEL = /* GraphQL */ `
  mutation FulfillmentCancel($id: ID!) { fulfillmentCancel(id: $id) { fulfillment { id status } userErrors { field message } } }
`;
export const FULFILLMENT_TRACKING_UPDATE = /* GraphQL */ `
  mutation FulfillmentTrackingInfoUpdate($fulfillmentId: ID!, $trackingInfoInput: FulfillmentTrackingInput!, $notifyCustomer: Boolean) {
    fulfillmentTrackingInfoUpdate(fulfillmentId: $fulfillmentId, trackingInfoInput: $trackingInfoInput, notifyCustomer: $notifyCustomer) {
      fulfillment { id trackingInfo { company number url } } userErrors { field message }
    }
  }
`;
export const FULFILLMENT_ORDER_HOLD = /* GraphQL */ `
  mutation FulfillmentOrderHold($id: ID!, $fulfillmentHold: FulfillmentOrderHoldInput!) {
    fulfillmentOrderHold(id: $id, fulfillmentHold: $fulfillmentHold) { order { id } userErrors { field message } }
  }
`;
export const FULFILLMENT_ORDER_RELEASE_HOLD = /* GraphQL */ `
  mutation FulfillmentOrderReleaseHold($id: ID!) { fulfillmentOrderReleaseHold(id: $id) { order { id } userErrors { field message } } }
`;
