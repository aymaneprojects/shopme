// Users and permissions, notification templates, policies, webhooks.

const STAFF = 'id email firstName lastName active isShopOwner role: shopmeRole permissions: shopmePermissions';
export const STAFF_MEMBERS = /* GraphQL */ `
  query StaffMembers { staffMembers(first: 100) { nodes { ${STAFF} } } }
`;
export const CURRENT_STAFF_MEMBER = /* GraphQL */ `
  query CurrentStaffMember { currentStaffMember { id isShopOwner role: shopmeRole permissions: shopmePermissions } }
`;
export const STAFF_INVITE = /* GraphQL */ `
  mutation StaffInvite($email: String!, $role: String!, $permissions: [String!]!) { shopmeStaffInvite(email: $email, role: $role, permissions: $permissions) { staffMember { id } userErrors { field message } } }
`;
export const STAFF_UPDATE = /* GraphQL */ `
  mutation StaffUpdate($id: ID!, $role: String, $permissions: [String!]) { shopmeStaffUpdate(id: $id, role: $role, permissions: $permissions) { staffMember { id } userErrors { field message } } }
`;
export const STAFF_DEACTIVATE = /* GraphQL */ `
  mutation StaffDeactivate($id: ID!) { shopmeStaffDeactivate(id: $id) { staffMember { id } userErrors { field message } } }
`;
export const STAFF_DELETE = /* GraphQL */ `
  mutation StaffDelete($id: ID!) { shopmeStaffDelete(id: $id) { deletedStaffMemberId userErrors { field message } } }
`;

export const NOTIFICATION_TEMPLATES = /* GraphQL */ `
  query NotificationTemplates { shopmeNotificationTemplates { key name subject body customized } }
`;
export const NOTIFICATION_TEMPLATE_UPDATE = /* GraphQL */ `
  mutation NotificationTemplateUpdate($key: String!, $subject: String!, $body: String!) { shopmeNotificationTemplateUpdate(key: $key, subject: $subject, body: $body) { template { key } userErrors { field message } } }
`;
export const NOTIFICATION_TEMPLATE_RESET = /* GraphQL */ `
  mutation NotificationTemplateReset($key: String!) { shopmeNotificationTemplateReset(key: $key) { template { key } userErrors { field message } } }
`;
// Server exposes the preview as a (side-effect free) mutation with userErrors.
export const NOTIFICATION_PREVIEW = /* GraphQL */ `
  mutation NotificationPreview($key: String!) { shopmeNotificationPreview(key: $key) { preview { subject html } userErrors { field message } } }
`;

export const SHOP_POLICIES = /* GraphQL */ `
  query ShopPolicies { shop { id shopPolicies { id type title body url } } }
`;
export const SHOP_POLICY_UPDATE = /* GraphQL */ `
  mutation ShopPolicyUpdate($shopPolicy: ShopPolicyInput!) { shopPolicyUpdate(shopPolicy: $shopPolicy) { shopPolicy { id } userErrors { field message } } }
`;
export const COOKIE_BANNER = /* GraphQL */ `
  query CookieBanner { shop { id cookieBanner: shopmeCookieBanner { enabled message } } }
`;
export const COOKIE_BANNER_UPDATE = /* GraphQL */ `
  mutation CookieBannerUpdate($input: ShopmeShopInput!) { shopmeShopUpdate(input: $input) { shop { id } userErrors { field message } } }
`;

export const WEBHOOKS = /* GraphQL */ `
  query Webhooks {
    webhookSubscriptions(first: 100) { nodes { id topic format createdAt endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } } }
    shopmeWebhookSettings { signingSecret }
  }
`;
export const WEBHOOK_CREATE = /* GraphQL */ `
  mutation WebhookCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) { webhookSubscription { id } userErrors { field message } }
  }
`;
export const WEBHOOK_UPDATE = /* GraphQL */ `
  mutation WebhookUpdate($id: ID!, $webhookSubscription: WebhookSubscriptionInput!) {
    webhookSubscriptionUpdate(id: $id, webhookSubscription: $webhookSubscription) { webhookSubscription { id } userErrors { field message } }
  }
`;
export const WEBHOOK_DELETE = /* GraphQL */ `
  mutation WebhookDelete($id: ID!) { webhookSubscriptionDelete(id: $id) { deletedWebhookSubscriptionId userErrors { field message } } }
`;
export const WEBHOOK_DELIVERIES = /* GraphQL */ `
  query WebhookDeliveries($subscriptionId: ID!) { shopmeWebhookDeliveries(subscriptionId: $subscriptionId) { nodes { id status responseCode createdAt error: lastError } } }
`;
