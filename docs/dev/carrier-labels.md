# Carrier accounts: rates and shipping labels

A carrier account (Settings > Shipping > Carrier accounts, stored in `SHIPPING.carrierAccounts`) connects ShopMe to a carrier. It can do two
things:

- **Carrier-calculated rates**: a shipping rate of type "calculated by carrier" asks the account for its price at checkout.
- **Shipping labels** (optional): from an order, the merchant compares the label rates of every account that sells labels, buys one, prints it,
  and can void it later.

Two kinds of account exist:

| `provider` | What it is | Labels |
|---|---|---|
| `http` | Any carrier fronted by a small web service at `endpoint` (your own, or one a carrier or integrator provides). | When `labels` is on. |
| `test` | The built-in **test carrier**: sample prices, PDF labels marked "TEST LABEL - NOT VALID FOR SHIPPING", tracking numbers `TEST` + 12 digits. No endpoint, nothing leaves the server. | Always. |

Code: `packages/core/src/services/shipping/carriers.ts` (provider interface, HTTP client), `test-carrier.ts` (test carrier and its PDF),
`labels.ts` (rates for an order, purchase, void, stored documents).

## The HTTP contract

Every request is a `POST` of a JSON body to the account's `endpoint`, with `Content-Type: application/json` and, when the account has a secret,
`Authorization: Bearer <secret>`. Redirects are not followed and private network addresses are refused (set `WEBHOOKS_ALLOW_PRIVATE=1` to
allow them, for a service on the same machine). Money is always an integer in minor units (cents) of `currency`.

An answer outside the 2xx range, or a body with an `"error"` string, is a failure; the error text is shown to the merchant as
`<account name>: <error>`, so write it for a person.

### Checkout rate

Sent when a cart is priced with a carrier-calculated rate (4 second timeout; the rate's fixed price is used when the service does not answer).

```json
{ "service": "express", "grams": 1200, "subtotal": 4500, "destination": { "countryCode": "FR", "provinceCode": null, "zip": "75001" } }
```

`service` is the service code typed in the rate editor. Answer with the price, or `null` when you do not serve that destination (the rate is
then not offered):

```json
{ "price": 590 }
```

### Label requests

Only sent to accounts with **"This service also sells shipping labels"** turned on. They share a `shipment` object:

```json
{
  "reference": "#1042",
  "currency": "EUR",
  "shipFrom": { "name": "Maison Exemple", "company": null, "address1": "5 avenue de l'Exemple", "address2": null, "city": "Lyon", "provinceCode": null, "zip": "69002", "countryCode": "FR", "phone": null },
  "shipTo": { "name": "Ada Lovelace", "company": null, "address1": "1 rue de Rivoli", "address2": null, "city": "Paris", "provinceCode": null, "zip": "75001", "countryCode": "FR", "phone": "+33100000000" },
  "parcel": { "weightGrams": 1200, "length": 30, "width": 20, "height": 10, "dimensionUnit": "CENTIMETERS", "packageType": "BOX" },
  "items": [{ "title": "Mug - Blue", "sku": "MUG-BLUE", "quantity": 2, "grams": 450, "price": 1500 }]
}
```

- `shipFrom` is the fulfilment's location (else the first active location, else the business address of Settings > General).
- `shipTo` is the order's shipping address. The customer's email address is never sent.
- `parcel.weightGrams` is the total weight the merchant confirmed (packaging included). The dimensions come from the chosen package of
  Settings > Shipping > Packages (else the default package); they are `null` when no package is saved.
- `items` lists what the label covers: the items still to ship, or the items of an existing fulfilment.

#### `label_rates`: list the offers (8 second timeout)

```json
{ "action": "label_rates", "shipment": { "...": "see above" } }
```

```json
{ "rates": [
  { "id": "std-2026-11-05", "service": "standard", "name": "Standard", "price": 590, "currency": "EUR", "estimatedDays": 3 },
  { "id": "exp-2026-11-05", "service": "express", "name": "Express", "price": 1290, "currency": "EUR", "estimatedDays": 1 }
] }
```

`id` is yours: it is sent back unchanged to buy that offer. `name` is shown to the merchant, `estimatedDays` (business days) is optional,
`currency` defaults to the shipment currency. Offers without an `id` or a valid `price` are ignored. ShopMe shows the offers of every account
together, cheapest first; an account that fails does not hide the others.

#### `label_purchase`: buy one (20 second timeout, answers up to 8 MB)

```json
{ "action": "label_purchase", "rateId": "std-2026-11-05", "shipment": { "...": "the same shipment" } }
```

```json
{
  "labelId": "L-88231",
  "trackingNumber": "AB123456789FR",
  "trackingUrl": "https://track.example.com/AB123456789FR",
  "service": "standard",
  "name": "Standard",
  "price": 590,
  "currency": "EUR",
  "label": { "format": "PDF", "url": "https://labels.example.com/L-88231.pdf" }
}
```

- `trackingNumber` and `price` are required: `price` is what you charged, stored as the label's cost (the price shown in the offer is not
  trusted).
- The label document is either a link (`label.url`, HTTPS only) or the file itself (`label.data`, base64). A file is stored by ShopMe and
  served to staff only, at `/admin/api/shipping-labels/<id>/label`; a link is opened as is. `format` is `PDF` (default), `PNG` or `ZPL`.
- `labelId` is your reference, used to void the label (defaults to the tracking number).

When the purchase succeeds, the tracking number, link and carrier name go on the order's fulfilment (a new fulfilment of the items still to
ship, or the existing one the label was bought for) and the customer can be notified. If ShopMe cannot fulfil the items after a purchase, it
sends `label_void` right away.

#### `label_void`: cancel a bought label (10 second timeout)

```json
{ "action": "label_void", "labelId": "L-88231", "trackingNumber": "AB123456789FR" }
```

```json
{ "voided": true, "refunded": true }
```

Answer `"voided": false` (with an optional `"reason"`) to refuse. `refunded` tells whether the postage is given back; it is shown on the label
("Refunded" / "Not refunded"). After a successful void ShopMe marks the label voided and cancels its fulfilment, so the items can be shipped
again.

## Admin API

- `shopmeLabelCarriers`: the accounts that sell labels.
- `shopmeShippingLabelRates(input: { orderId, fulfillmentId, parcel: { packageId, weightGrams } })`: the offers for an order, with
  `carrierErrors` per failing account.
- `shopmeShippingLabelEstimate(input: { countryCode, zip, parcel })`: offers without an order ("Calculate rates" in Settings > Shipping).
- `shopmeShippingLabelPurchase(input: { orderId, fulfillmentId, parcel, accountId, rateId, notifyCustomer })`: buys the label.
- `shopmeShippingLabelVoid(id)`: voids a label (bought ones at the carrier first).
- `ShopmeShippingLabel` has `source` (`MANUAL` or `PURCHASED`), `cost` and `currencyCode`, `labelUrl`, `refundStatus` and `test`.

Labels recorded by hand (bought outside ShopMe) keep using `shopmeShippingLabelCreate`.
