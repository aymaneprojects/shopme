/** Column values that keep `customers.acceptsMarketing` in step with the email consent state (kept apart so accounts and customers can import it). */
export const EMAIL_MARKETING_STATES = ['NOT_SUBSCRIBED', 'PENDING', 'SUBSCRIBED', 'UNSUBSCRIBED', 'REDACTED', 'INVALID'] as const;
export const MARKETING_OPT_IN_LEVELS = ['SINGLE_OPT_IN', 'CONFIRMED_OPT_IN', 'UNKNOWN'] as const;
export type EmailMarketingState = (typeof EMAIL_MARKETING_STATES)[number];
export type MarketingOptInLevel = (typeof MARKETING_OPT_IN_LEVELS)[number];

export function emailConsentColumns(state: EmailMarketingState, level: MarketingOptInLevel, at = new Date()) {
  return { acceptsMarketing: state === 'SUBSCRIBED', emailMarketingState: state, emailMarketingOptInLevel: level, emailMarketingUpdatedAt: at };
}

/**
 * Simple boolean consent (checkboxes, imports). Subscribing is SINGLE_OPT_IN; withdrawing a subscription is UNSUBSCRIBED.
 * Nothing changes when the customer is already in the wanted situation (a confirmed opt-in stays confirmed).
 */
export function subscribedColumns(subscribed: boolean, was?: string | null, at = new Date()) {
  if (subscribed) return was === 'SUBSCRIBED' ? {} : emailConsentColumns('SUBSCRIBED', 'SINGLE_OPT_IN', at);
  if (was === 'SUBSCRIBED' || was === 'PENDING') return emailConsentColumns('UNSUBSCRIBED', 'UNKNOWN', at);
  return was ? {} : emailConsentColumns('NOT_SUBSCRIBED', 'UNKNOWN', at);
}
