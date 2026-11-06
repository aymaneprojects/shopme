import { isFreeMailboxDomain, sendingDomainOf } from './domain';

export type EmailMode = 'direct' | 'relay' | 'env' | 'log';
export type FromReason = 'store' | 'free_mailbox' | 'unauthenticated' | 'no_sender' | 'relay' | 'env' | 'unverified_nowhere';

export interface FromInput {
  mode: EmailMode;
  /** Sender address configured by the store (empty when none). */
  storeAddress: string | null;
  /** SPF and DKIM of the store's sending domain passed at the last check. */
  storeAuthenticated: boolean;
  /** Platform fallback address (`no-reply@<platform domain>`) and whether that domain is authenticated; null when there is no usable platform domain. */
  platform: { address: string; authenticated: boolean } | null;
  /** Installation default sender (MAIL_FROM). */
  defaultAddress: string;
}
export interface FromDecision {
  /** Address for the From header. */
  address: string;
  /** `store`: the store's own address; `platform`: the platform address on behalf of the store (Reply-To = store). */
  kind: 'store' | 'platform';
  reason: FromReason;
  /** False when nothing authenticated is available: the message is still tried but is likely to be filtered. */
  deliverable: boolean;
}

/**
 * Which address goes in From. In direct delivery a From that fails DMARC lands in spam, so a free mailbox or a domain whose
 * SPF/DKIM do not pass is replaced by the platform's authenticated address (the store stays in the display name and Reply-To).
 * A relay or the installation SMTP account authenticates for its own domains and decides itself: the store's address is kept.
 */
export function decideFrom(i: FromInput): FromDecision {
  const store = i.storeAddress?.trim() || null;
  const domain = sendingDomainOf(store);
  if (i.mode === 'relay') return { address: store ?? i.defaultAddress, kind: 'store', reason: 'relay', deliverable: true };
  if (i.mode === 'env') return { address: store ?? i.defaultAddress, kind: 'store', reason: 'env', deliverable: true };
  if (i.mode === 'log') return { address: store ?? i.defaultAddress, kind: 'store', reason: store ? 'store' : 'no_sender', deliverable: false };
  const free = isFreeMailboxDomain(domain);
  if (store && domain && !free && i.storeAuthenticated) return { address: store, kind: 'store', reason: 'store', deliverable: true };
  const reason: FromReason = !store || !domain ? 'no_sender' : free ? 'free_mailbox' : 'unauthenticated';
  if (i.platform?.authenticated) return { address: i.platform.address, kind: 'platform', reason, deliverable: true };
  // Nothing authenticated: still try as the store when its address is a real domain, else as the installation default.
  const fallback = store && domain && !free ? store : i.defaultAddress;
  return { address: fallback, kind: 'store', reason: 'unverified_nowhere', deliverable: false };
}
