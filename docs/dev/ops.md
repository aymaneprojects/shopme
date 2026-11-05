# Operations: draft orders, staff, notifications, policies, webhooks

Admin GraphQL modules: `draft-orders`, `staff`, `notifications`, `policies`, `webhooks` (in `apps/server/src/admin/graphql/modules/`).
Core services: `draft-orders`, `staff`, `legal`, `webhooks`, `order-notifications` (`packages/core/src/services/`) and `mail/notifications.ts`.
REST: `apps/server/src/ops-routes.ts`. Background work: `apps/server/src/ops.ts`. Migration `0001_wave6b_ops`
(`draft_orders`, `notification_templates`, `staff_users.permissions/invite_token_hash/invite_expires_at`; webhook tables already existed).

## Domain events

`addEvent` (the `events` table) is the bus: `onEvent(listener)` is called right after the insert, which may still be inside a
transaction, so jobs wait `EVENT_SETTLE_MS` before reading the resource (and retry if it is not readable yet). Event verbs map to
webhook topics (`topicsForVerb`) and to customer emails (`ORDER_EMAIL_VERBS`, only when the action asked to notify). New domain
events: write them with `addEvent` using a verb listed in `services/webhooks.ts` (`VERB_TOPICS`).

## Draft orders

`draftOrders`, `draftOrder`, `draftOrdersCount`, `draftOrderCreate|Update|Delete|Calculate|Complete|InvoiceSend`. Lines are catalog
variants or custom items (`title` + `originalUnitPrice`); per-line `appliedDiscount`, order-level `appliedDiscount`, `shippingLine`
`{title, price}`, customer by `customerId`/`purchasingEntity` or email. Priced by `priceCheckout` (tax from the shipping country,
customer tax exemption). A fixed-amount line discount applies to the whole line. `discountCodes` are ignored. Completing runs
`createOrder` (stock, customer, tax and discount lines, timeline) with gateway `manual`: `paymentPending: false` gives a PAID
order. An email address is required to complete. Invoice: `draftOrderInvoiceSend(id, email: {to, subject, customMessage})` mails the
`draft_order_invoice` template with `/draft_orders/<token>/pay`. For variant-only drafts at current prices without custom discount or
shipping, that link fills a cart and redirects to `/checkouts/<token>`; otherwise it shows the invoice with a button that completes
the draft as payment pending (bank instructions are shown when enabled). The draft is not linked to an order placed through the cart.

## Staff and permissions

Roles `owner | admin | staff`. Areas: `products, orders, customers, discounts, online_store, settings, staff`. Owner and admin hold
everything; `staff` holds the granted areas. `scopesFor(user)` (core, `services/staff.ts`) turns that into API scopes
(`AREA_SCOPES`), set on the session in `plugins/auth.ts`, so every `requireScope` and REST scope check enforces it. A new scope
name must be added to an area there. The owner cannot be modified, deactivated or deleted, nobody can do that to themselves, and only
the owner manages admins.

`staffMember(id)`, `currentStaffMember`, `staffMembers` (extra fields `shopmeRole`, `shopmePermissions`, `shopmeInvitePending`).
Mutations `shopmeStaffInvite(email, role, permissions, firstName, lastName)` (returns `inviteUrl`; re-inviting a pending member
re-sends), `shopmeStaffUpdate(id, role, permissions, firstName, lastName, active)`, `shopmeStaffDeactivate`, `shopmeStaffDelete`.
Invite link `/admin/invite/<token>` (SPA route, valid 7 days): `GET /admin/api/staff/invite/:token` returns `{email, firstName,
shopName}`; `POST /admin/api/staff/accept-invite {token, password, firstName?, lastName?}` sets the password and signs in.

## Notification emails

Registry in `mail/notifications.ts`: `order_confirmation, staff_new_order, shipping_confirmation, shipping_update, order_cancelled,
refund, customer_account_welcome, customer_account_invite, password_reset, draft_order_invoice, contact_form, staff_invite`.
Defaults are Liquid (EN, FR by shop locale) for the inner HTML; the shop header is added around it. Values are HTML-escaped;
use `| raw` for trusted HTML. Overrides live in `notification_templates`. API: `shopmeNotificationTemplates`,
`shopmeNotificationTemplateUpdate(key, subject, body)`, `shopmeNotificationTemplateReset(key)`,
`shopmeNotificationPreview(key, subject?, body?)`, `shopmeNotificationSettings`, `shopmeNotificationSettingsUpdate(senderName,
senderEmail)` (stored in `shops.settings.notifications`, becomes the From header; customer emails get Reply-To = shop email).
Send from code with `sendNotification(db, mailer, shop, appUrl, key, to, vars)`. Hooks: fulfillment (`notifyCustomer`), tracking
update, refund (`notify`) and cancel (`notifyCustomer`). Not hooked yet (no storefront flow): customer account welcome, invite,
password reset, contact form.

## Policies, cookie banner, data export

`shop { shopPolicies { id type title body url } }` (always the five types, empty body = not served),
`shopPolicyUpdate(shopPolicy: {type, body})`. Stored in `shops.settings.policies[handle]`, which the storefront already serves at
`/policies/<handle>`. `shop { shopmeCookieBanner { enabled message } }` and `shopmeCookieBannerUpdate(enabled, message)` store
`shops.settings.cookieBanner`; the storefront does not render a banner yet. `GET /admin/api/customers/:id/export.json` (scope
`read_customers`) downloads the customer's profile, addresses, orders (lines, payments, refunds, fulfillments) and timeline.

## Outbound webhooks

`webhookSubscriptions`, `webhookSubscription`, `webhookSubscriptionCreate|Update|Delete` with Shopify's topic enum
(`PRODUCTS_*`, `ORDERS_CREATE|PAID|UPDATED|FULFILLED|CANCELLED`, `FULFILLMENTS_CREATE|UPDATE`, `REFUNDS_CREATE`, `CUSTOMERS_*`,
`DRAFT_ORDERS_*`), JSON only, `callbackUrl` (or `uri`) http(s). Scope `read|write_webhooks`. Requests carry `X-Shopify-Topic`,
`X-Shopify-Hmac-Sha256` (base64 HMAC-SHA256 of the raw body, key = the per-shop secret from `shopmeWebhookSettings { signingSecret }`,
rotate with `shopmeWebhookSecretRotate`), `X-Shopify-Shop-Domain`, `X-Shopify-Webhook-Id` (delivery id, stable across retries),
`X-Shopify-API-Version`, `X-Shopify-Triggered-At`. Any 2xx is success; otherwise retried after 10 s, 1 min, 5 min, 30 min, 2 h, 6 h,
then FAILED. A 30 s sweep re-queues due deliveries after a restart; finished deliveries are purged after 30 days. Log:
`shopmeWebhookDeliveries(first, subscriptionId, status)`. The server does not block private callback addresses.
