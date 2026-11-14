/** Payment method ids shown at checkout. */
export type PaymentMethodId = string;
/** `manual`: order stays pending until the merchant confirms payment. `online`: Stripe, paid from a verified webhook. `test`: sandbox gateway, nothing is charged.
 *  `redirect`: the buyer is sent to the merchant's payment page and the provider confirms through the signed payment webhook. */
export type PaymentKind = 'manual' | 'online' | 'test' | 'redirect';

/**
 * A way to pay. `manual` methods place the order as PENDING (the merchant confirms payment later);
 * `online` methods collect payment through a provider and mark the order PAID from a verified webhook.
 */
export interface PaymentProvider {
  id: PaymentMethodId;
  kind: PaymentKind;
  /** Merchant-chosen display name (custom manual methods and redirect gateways); built-in methods use the translated label. */
  name?: string;
  /** Merchant-provided text shown to the buyer (bank details). */
  instructions?: string;
}

/** Parsed payment keys of the shop settings (see docs/dev/payments.md). */
export interface PaymentSettings {
  bankTransfer: { enabled: boolean; instructions: string };
  cod: { enabled: boolean };
  stripe: { enabled: boolean };
  /** Off until the merchant switches them on (and only offered when the store has saved credentials). */
  paypal: { enabled: boolean };
  mollie: { enabled: boolean };
}
