import { and, eq } from 'drizzle-orm';
import { customers } from '../../db/schema';
import type { Db, Executor } from '../../db/client';
import { createCustomerToken, isCustomerTokenValid, isValidEmail } from '../accounts/accounts';
import { errR, normalizeTags, okR, type Result } from '../catalog/common';
import { addEvent } from '../events';
import type { Customer } from '../customers/customers';
import { sha256 } from '../crypto';
import { EMAIL_MARKETING_STATES, MARKETING_OPT_IN_LEVELS, emailConsentColumns, subscribedColumns, type EmailMarketingState, type MarketingOptInLevel } from './marketing-columns';
import { customerTokens } from '../../db/schema';

/** Marketing consent: states per channel (email, SMS), double opt-in confirmation and the data-sale opt-out flag. */
export { EMAIL_MARKETING_STATES, MARKETING_OPT_IN_LEVELS, emailConsentColumns, subscribedColumns, type EmailMarketingState, type MarketingOptInLevel };
export const SMS_MARKETING_STATES = ['NOT_SUBSCRIBED', 'PENDING', 'SUBSCRIBED', 'UNSUBSCRIBED', 'REDACTED'] as const;

const lc = (e: string) => e.trim().toLowerCase();

export interface EmailConsentInput { marketingState: string; marketingOptInLevel?: string | null; consentUpdatedAt?: Date | null }

export async function updateEmailMarketingConsent(db: Executor, shopId: number, customerId: number, input: EmailConsentInput): Promise<Result<Customer>> {
  const [c] = await db.select().from(customers).where(and(eq(customers.shopId, shopId), eq(customers.id, customerId))).limit(1);
  if (!c) return errR(['customerId'], 'Customer not found', 'INVALID');
  if (!c.email) return errR(['customerId'], 'An email address is needed to change email marketing consent', 'INVALID');
  if (!(EMAIL_MARKETING_STATES as readonly string[]).includes(input.marketingState)) return errR(['emailMarketingConsent', 'marketingState'], 'Marketing state is not valid', 'INCLUSION');
  const level = (input.marketingOptInLevel ?? 'UNKNOWN') as MarketingOptInLevel;
  if (!(MARKETING_OPT_IN_LEVELS as readonly string[]).includes(level)) return errR(['emailMarketingConsent', 'marketingOptInLevel'], 'Opt-in level is not valid', 'INCLUSION');
  if (input.marketingState === 'PENDING' && level === 'SINGLE_OPT_IN') return errR(['emailMarketingConsent', 'marketingOptInLevel'], 'A pending subscription needs the confirmed opt-in level', 'INVALID');
  const [row] = await db.update(customers).set({ ...emailConsentColumns(input.marketingState as EmailMarketingState, level, input.consentUpdatedAt ?? new Date()), updatedAt: new Date() }).where(eq(customers.id, customerId)).returning();
  await addEvent(db, shopId, { subjectType: 'customer', subjectId: customerId, verb: 'customers/email_marketing_consent', message: `Email marketing consent set to ${input.marketingState.toLowerCase().replace('_', ' ')}`, data: { state: input.marketingState, level } });
  return okR(row!);
}

export interface SmsConsentInput { marketingState: string; marketingOptInLevel?: string | null; consentUpdatedAt?: Date | null; consentCollectedFrom?: string | null }
export async function updateSmsMarketingConsent(db: Executor, shopId: number, customerId: number, input: SmsConsentInput): Promise<Result<Customer>> {
  const [c] = await db.select().from(customers).where(and(eq(customers.shopId, shopId), eq(customers.id, customerId))).limit(1);
  if (!c) return errR(['customerId'], 'Customer not found', 'INVALID');
  if (!c.phone) return errR(['customerId'], 'A phone number is needed to change SMS marketing consent', 'INVALID');
  if (!(SMS_MARKETING_STATES as readonly string[]).includes(input.marketingState)) return errR(['smsMarketingConsent', 'marketingState'], 'Marketing state is not valid', 'INCLUSION');
  const level = (input.marketingOptInLevel ?? 'UNKNOWN') as MarketingOptInLevel;
  if (!(MARKETING_OPT_IN_LEVELS as readonly string[]).includes(level)) return errR(['smsMarketingConsent', 'marketingOptInLevel'], 'Opt-in level is not valid', 'INCLUSION');
  const [row] = await db.update(customers).set({
    smsMarketingState: input.marketingState, smsMarketingOptInLevel: level, smsMarketingUpdatedAt: input.consentUpdatedAt ?? new Date(), smsMarketingCollectedFrom: input.consentCollectedFrom ?? 'OTHER', updatedAt: new Date(),
  }).where(eq(customers.id, customerId)).returning();
  return okR(row!);
}

export interface WhatsappConsentInput { marketingState: string; consentUpdatedAt?: Date | null }
/** WhatsApp marketing consent is only stored and exported; nothing is sent through WhatsApp. A phone number is needed to record it. */
export async function updateWhatsappMarketingConsent(db: Executor, shopId: number, customerId: number, input: WhatsappConsentInput): Promise<Result<Customer>> {
  const [c] = await db.select().from(customers).where(and(eq(customers.shopId, shopId), eq(customers.id, customerId))).limit(1);
  if (!c) return errR(['customerId'], 'Customer not found', 'INVALID');
  if (!c.phone) return errR(['customerId'], 'A phone number is needed to change WhatsApp marketing consent', 'INVALID');
  if (!(SMS_MARKETING_STATES as readonly string[]).includes(input.marketingState)) return errR(['shopmeWhatsappMarketingConsent', 'marketingState'], 'Marketing state is not valid', 'INCLUSION');
  const [row] = await db.update(customers).set({ whatsappMarketingState: input.marketingState, whatsappMarketingUpdatedAt: input.consentUpdatedAt ?? new Date(), updatedAt: new Date() }).where(eq(customers.id, customerId)).returning();
  return okR(row!);
}

// --- subscribing (newsletter form, checkout checkbox) with optional double opt-in ------------------------------------------

export interface SubscribeResult { customer: Customer; state: EmailMarketingState; confirmToken: string | null }

/**
 * Subscribe an email. Without double opt-in the customer is SUBSCRIBED at once. With it, the customer is PENDING (CONFIRMED_OPT_IN level)
 * and a confirmation token is returned for the caller to mail; the subscription only counts once the link is opened.
 */
export async function subscribeEmail(db: Db, shopId: number, input: { email?: string; tags?: string[]; firstName?: string | null; lastName?: string | null; doubleOptIn?: boolean }): Promise<Result<SubscribeResult>> {
  const email = lc(input.email ?? '');
  if (!email) return errR(['email'], "Email can't be blank", 'BLANK');
  if (!isValidEmail(email)) return errR(['email'], 'Email is invalid', 'INVALID');
  const tags = normalizeTags(input.tags ?? ['newsletter']);
  const [cur] = await db.select().from(customers).where(and(eq(customers.shopId, shopId), eq(customers.email, email))).limit(1);
  const now = new Date();
  let customer: Customer;
  if (cur) {
    if (cur.emailMarketingState === 'SUBSCRIBED') return okR({ customer: cur, state: 'SUBSCRIBED', confirmToken: null });
    customer = (await db.update(customers).set({ ...(input.doubleOptIn ? emailConsentColumns('PENDING', 'CONFIRMED_OPT_IN', now) : emailConsentColumns('SUBSCRIBED', 'SINGLE_OPT_IN', now)), tags: normalizeTags([...cur.tags, ...tags]), updatedAt: now }).where(eq(customers.id, cur.id)).returning())[0]!;
  } else {
    customer = (await db.insert(customers).values({
      shopId, email, firstName: input.firstName?.trim() || null, lastName: input.lastName?.trim() || null, tags,
      ...(input.doubleOptIn ? emailConsentColumns('PENDING', 'CONFIRMED_OPT_IN', now) : emailConsentColumns('SUBSCRIBED', 'SINGLE_OPT_IN', now)),
    }).returning())[0]!;
    await addEvent(db, shopId, { subjectType: 'customer', subjectId: customer!.id, verb: 'customers/create', message: 'Customer subscribed to the newsletter' });
  }
  const token = input.doubleOptIn ? await createCustomerToken(db, shopId, customer!.id, 'subscribe') : null;
  return okR({ customer: customer!, state: input.doubleOptIn ? 'PENDING' : 'SUBSCRIBED', confirmToken: token });
}

/** Open a confirmation link: PENDING becomes SUBSCRIBED (confirmed opt-in). Null when the link is invalid, used or expired. */
export async function confirmSubscription(db: Db, shopId: number, customerId: number, token: string): Promise<Customer | null> {
  if (!(await isCustomerTokenValid(db, shopId, customerId, 'subscribe', token))) return null;
  await db.update(customerTokens).set({ usedAt: new Date() }).where(and(eq(customerTokens.shopId, shopId), eq(customerTokens.tokenHash, sha256(token))));
  const now = new Date();
  const [row] = await db.update(customers).set({ ...emailConsentColumns('SUBSCRIBED', 'CONFIRMED_OPT_IN', now), updatedAt: now }).where(and(eq(customers.shopId, shopId), eq(customers.id, customerId))).returning();
  if (row) await addEvent(db, shopId, { subjectType: 'customer', subjectId: customerId, verb: 'customers/email_marketing_consent', message: 'Email subscription confirmed by the customer', data: { state: 'SUBSCRIBED', level: 'CONFIRMED_OPT_IN' } });
  return row ?? null;
}

// --- data sale opt-out ---------------------------------------------------------------------------------------------------

/** Mark the customer behind an email as opted out of data sale and sharing. Creates a bare customer record when there is none. */
export async function optOutOfDataSale(db: Db, shopId: number, rawEmail: string): Promise<Result<{ customerId: number }>> {
  const email = lc(rawEmail);
  if (!isValidEmail(email)) return errR(['email'], 'Email is invalid', 'FAILED');
  const [cur] = await db.select().from(customers).where(and(eq(customers.shopId, shopId), eq(customers.email, email))).limit(1);
  if (cur) {
    if (!cur.dataSaleOptOut) {
      await db.update(customers).set({ dataSaleOptOut: true, updatedAt: new Date() }).where(eq(customers.id, cur.id));
      await addEvent(db, shopId, { subjectType: 'customer', subjectId: cur.id, verb: 'customers/data_sale_opt_out', message: 'Customer opted out of the sale and sharing of their data' });
    }
    return okR({ customerId: cur.id });
  }
  const [row] = await db.insert(customers).values({ shopId, email, dataSaleOptOut: true }).returning();
  await addEvent(db, shopId, { subjectType: 'customer', subjectId: row!.id, verb: 'customers/data_sale_opt_out', message: 'Customer opted out of the sale and sharing of their data' });
  return okR({ customerId: row!.id });
}

/** Save the consent a signed-in customer gave (restored on their next sign-in). */
export async function saveCustomerConsent(db: Executor, shopId: number, customerId: number, consent: Record<string, unknown>): Promise<void> {
  await db.update(customers).set({ consent }).where(and(eq(customers.shopId, shopId), eq(customers.id, customerId)));
}
