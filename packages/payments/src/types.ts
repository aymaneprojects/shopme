/** Payment method ids shown at checkout. */
export type PaymentMethodId = 'bank_transfer' | 'cod' | 'stripe';

/**
 * A way to pay. `manual` methods place the order as PENDING (the merchant confirms payment later);
 * `online` methods collect payment through a provider and mark the order PAID from a verified webhook.
 */
export interface PaymentProvider {
  id: PaymentMethodId;
  kind: 'manual' | 'online';
  /** Merchant-provided text shown to the buyer (bank details). */
  instructions?: string;
}

/** Parsed payment keys of the shop settings (see docs/dev/payments.md). */
export interface PaymentSettings {
  bankTransfer: { enabled: boolean; instructions: string };
  cod: { enabled: boolean };
  stripe: { enabled: boolean };
}
