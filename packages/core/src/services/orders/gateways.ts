import type { OrderTransaction } from './orders';

/**
 * What ShopMe asks a payment provider to do with money it already holds. One adapter per gateway name (`stripe`, later others); a
 * missing method means "record only". Throw to refuse: the money movement is then not recorded.
 */
export interface GatewayAdapter {
  /** Collect (part of) an authorisation; `amount` in minor units of the transaction currency. */
  capture?(parent: OrderTransaction, amount: number, idempotencyKey: string): Promise<void | { id: string | null }>;
  /** Pay back part of a SALE/CAPTURE. `charge` is the amount in minor units of the currency the buyer was charged in. Returns the provider's refund id. */
  refund?(parent: OrderTransaction, charge: { amount: number; currency: string }, idempotencyKey: string): Promise<{ id: string | null }>;
  /** Release an uncaptured authorisation. */
  void?(parent: OrderTransaction, idempotencyKey: string): Promise<void>;
}

/** The adapter of a gateway for one store, or null when ShopMe only records what happens on it (manual, gift card, store credit...). */
export type GatewayResolver = (gateway: string) => GatewayAdapter | null;

/** `collect` hook of `captureTransaction` backed by the gateway adapters. */
export function collectVia(gateways: GatewayResolver | undefined) {
  return gateways ? async (parent: OrderTransaction, amount: number) => {
    const a = parent.gateway && parent.paymentId ? gateways(parent.gateway) : null;
    if (a?.capture) { const r = await a.capture(parent, amount, `capture-${parent.id}-${amount}`); return r ? { paymentId: r.id } : undefined; }
    return undefined;
  } : undefined;
}
