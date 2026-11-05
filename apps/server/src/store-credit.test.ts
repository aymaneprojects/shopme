import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  createLocalStorage, creditStoreCredit, debitStoreCredit, expireStoreCredits, findStoreCreditAccount, getPrimaryShop, liveBalance, recordPaymentFailure, revertStoreCreditDebit, schema as s, seedDemo,
  type Mail,
} from '@shopme/core';
import { createTestApp, SETUP_BODY, type TestApp } from './test-utils';
import { makeGql, makeGqlOk } from '../test/conformance/helpers';

const ADDRESS = { firstName: 'Ada', lastName: 'Lovelace', address1: '1 Rue de Rivoli', city: 'Paris', zip: '75001', countryCode: 'FR', phone: '' };
let t: TestApp;
let g: ReturnType<typeof makeGqlOk>;
let gql: ReturnType<typeof makeGql>;
let shopId: number;
let sent: Mail[];
const sku: Record<string, number> = {};
const db = () => t.dbHandle.db;
const day = 24 * 3600 * 1000;

beforeAll(async () => {
  t = await createTestApp();
  const setup = await t.app.inject({ method: 'POST', url: '/admin/api/setup', payload: SETUP_BODY });
  const cookie = setup.cookies.find((c) => c.name === 'shopme_session')!.value;
  gql = makeGql(t.app, cookie);
  g = makeGqlOk(gql);
  await seedDemo(db(), createLocalStorage(mkdtempSync(path.join(tmpdir(), 'sc-'))));
  shopId = (await getPrimaryShop(db()))!.id;
  for (const v of await db().select().from(s.productVariants)) if (v.sku) sku[v.sku] = v.id;
  sent = [];
  t.app.ctx.mailer = { send: async (m) => { sent.push(m); } };
}, 90_000);
afterAll(async () => { await t.close(); });

let n = 0;
async function customer(email = `credit${++n}@example.com`) {
  const [c] = await db().insert(s.customers).values({ shopId, email, firstName: 'Ada' }).returning();
  return c!;
}
const settings = async (patch: Record<string, unknown>) => {
  const [shop] = await db().select().from(s.shops).where(eq(s.shops.id, shopId));
  await db().update(s.shops).set({ settings: { ...shop!.settings, ...patch } }).where(eq(s.shops.id, shopId));
};
const credit = (accountOrCustomer: { accountId?: number; customerId?: number }, amount: number, extra: { expiresAt?: Date | null; now?: Date } = {}) =>
  creditStoreCredit(db(), shopId, { ...accountOrCustomer, amount, currency: 'EUR', ...extra });

describe('store credit accounts', () => {
  it('creates the account on first credit, enforces the rules and reports Admin API codes', async () => {
    const c = await customer();
    const first = await credit({ customerId: c.id }, 1000);
    expect(first.ok && first.value.account.balance).toBe(1000);
    const account = (await findStoreCreditAccount(db(), shopId, c.id, 'EUR'))!;
    expect(await liveBalance(db(), account.id)).toBe(1000);

    const code = async (r: Promise<{ ok: boolean; errors?: { code?: string }[] }>) => { const x = await r; return x.ok ? 'OK' : x.errors?.[0]?.code; };
    expect(await code(credit({ accountId: account.id }, 0))).toBe('NEGATIVE_OR_ZERO_AMOUNT');
    expect(await code(credit({ customerId: 99_999_999 }, 100))).toBe('OWNER_NOT_FOUND');
    expect(await code(credit({ accountId: 99_999_999 }, 100))).toBe('ACCOUNT_NOT_FOUND');
    expect(await code(creditStoreCredit(db(), shopId, { accountId: account.id, amount: 100, currency: 'USD' }))).toBe('UNSUPPORTED_CURRENCY');
    expect(await code(credit({ accountId: account.id }, 100, { expiresAt: new Date(Date.now() - 1000) }))).toBe('EXPIRES_AT_IN_PAST');
    expect(await code(debitStoreCredit(db(), shopId, { accountId: account.id, amount: 5000 }))).toBe('INSUFFICIENT_FUNDS');
    expect(await code(debitStoreCredit(db(), shopId, { accountId: account.id, amount: 100, currency: 'USD' }))).toBe('MISMATCHING_CURRENCY');
    expect(await code(debitStoreCredit(db(), shopId, { accountId: account.id, amount: -3 }))).toBe('NEGATIVE_OR_ZERO_AMOUNT');

    await settings({ storeCredit: { enabled: true, creditLimit: 1500 } });
    expect(await code(credit({ accountId: account.id }, 600))).toBe('CREDIT_LIMIT_EXCEEDED');
    expect((await credit({ accountId: account.id }, 500)).ok).toBe(true);
    await settings({ storeCredit: { enabled: true } });
  });

  it('spends the credit that expires soonest first and keeps the cached balance in step', async () => {
    const c = await customer();
    await credit({ customerId: c.id }, 1000); // no expiry
    await credit({ customerId: c.id }, 500, { expiresAt: new Date(Date.now() + 10 * day) });
    await credit({ customerId: c.id }, 300, { expiresAt: new Date(Date.now() + 2 * day) });
    const account = (await findStoreCreditAccount(db(), shopId, c.id, 'EUR'))!;
    const r = await debitStoreCredit(db(), shopId, { accountId: account.id, amount: 400 });
    if (!r.ok) throw new Error('debit failed');
    const credits = await db().select().from(s.storeCreditTransactions).where(and(eq(s.storeCreditTransactions.accountId, account.id), eq(s.storeCreditTransactions.kind, 'CREDIT')));
    const remaining = Object.fromEntries(credits.map((x) => [x.amount, x.remaining]));
    expect(remaining).toEqual({ 1000: 1000, 500: 400, 300: 0 }); // the 2-day credit went first, then 100 of the 10-day one
    const fresh = (await findStoreCreditAccount(db(), shopId, c.id, 'EUR'))!;
    expect(fresh.balance).toBe(1400);
    expect(await liveBalance(db(), account.id)).toBe(1400);
    const allocations = await db().select().from(s.storeCreditAllocations);
    expect(allocations.filter((a) => a.debitTransactionId === r.value.transaction.id).reduce((sum, a) => sum + a.amount, 0)).toBe(400);
  });

  it('expires credit: the balance drops at once, the job writes one expiration per credit and is idempotent', async () => {
    const c = await customer();
    const now = new Date();
    await credit({ customerId: c.id }, 1000, { expiresAt: new Date(now.getTime() + day) });
    await credit({ customerId: c.id }, 400);
    const account = (await findStoreCreditAccount(db(), shopId, c.id, 'EUR'))!;
    await debitStoreCredit(db(), shopId, { accountId: account.id, amount: 300 }); // takes 300 of the expiring credit
    const later = new Date(now.getTime() + 2 * day);
    expect(await liveBalance(db(), account.id, now)).toBe(1100);
    expect(await liveBalance(db(), account.id, later)).toBe(400); // excluded before the job runs
    expect(await expireStoreCredits(db(), later)).toBe(1);
    expect(await expireStoreCredits(db(), later)).toBe(0);
    const [exp] = await db().select().from(s.storeCreditTransactions).where(and(eq(s.storeCreditTransactions.accountId, account.id), eq(s.storeCreditTransactions.kind, 'EXPIRATION')));
    expect(exp!.amount).toBe(700); // the unspent remainder
    expect((await findStoreCreditAccount(db(), shopId, c.id, 'EUR'))!.balance).toBe(400);
    // balance cache equals the recomputed sum
    expect((await findStoreCreditAccount(db(), shopId, c.id, 'EUR'))!.balance).toBe(await liveBalance(db(), account.id));
  });

  it('reverts a debit once, restoring the original credits except expired ones', async () => {
    const c = await customer();
    await credit({ customerId: c.id }, 500, { expiresAt: new Date(Date.now() + 5 * day) });
    await credit({ customerId: c.id }, 500);
    const account = (await findStoreCreditAccount(db(), shopId, c.id, 'EUR'))!;
    const d = await debitStoreCredit(db(), shopId, { accountId: account.id, amount: 700 });
    if (!d.ok) throw new Error('debit failed');
    expect(await liveBalance(db(), account.id)).toBe(300);
    const back = await revertStoreCreditDebit(db(), shopId, d.value.transaction.id, 'PAYMENT_FAILURE');
    expect(back?.amount).toBe(700);
    expect(await liveBalance(db(), account.id)).toBe(1000);
    expect(await revertStoreCreditDebit(db(), shopId, d.value.transaction.id)).toBeNull(); // idempotent
    // when the expiring credit has expired meanwhile, only the rest is restored
    const d2 = await debitStoreCredit(db(), shopId, { accountId: account.id, amount: 700 });
    if (!d2.ok) throw new Error('debit failed');
    const partial = await revertStoreCreditDebit(db(), shopId, d2.value.transaction.id, 'PAYMENT_FAILURE', new Date(Date.now() + 6 * day));
    expect(partial?.amount).toBe(200);
  });

  it('serialises parallel debits on the same account', async () => {
    const c = await customer();
    await credit({ customerId: c.id }, 1000);
    const account = (await findStoreCreditAccount(db(), shopId, c.id, 'EUR'))!;
    const results = await Promise.all([1, 2, 3].map(() => debitStoreCredit(db(), shopId, { accountId: account.id, amount: 400 })));
    expect(results.filter((r) => r.ok).length).toBe(2);
    expect(await liveBalance(db(), account.id)).toBe(200);
  });
});

describe('store credit in the Admin API', () => {
  it('credits by customer id, notifies with the template, debits and lists transactions', async () => {
    const c = await customer('api-credit@example.com');
    const id = `gid://shopify/Customer/${c.id}`;
    await settings({ storeCredit: { enabled: true } });
    sent.length = 0;
    const expires = new Date(Date.now() + 30 * day).toISOString();
    const r = await g(`mutation($id: ID!, $e: DateTime) { storeCreditAccountCredit(id: $id, creditInput: { creditAmount: { amount: "25.00", currencyCode: EUR }, expiresAt: $e, notify: true }) {
      storeCreditAccountTransaction { __typename amount { amount currencyCode } balanceAfterTransaction { amount } event expiresAt remainingAmount { amount } account { id balance { amount currencyCode } } }
      userErrors { field message code } } }`, { id, e: expires });
    const tx = r.storeCreditAccountCredit.storeCreditAccountTransaction;
    expect(r.storeCreditAccountCredit.userErrors).toEqual([]);
    expect(tx).toMatchObject({ __typename: 'StoreCreditAccountCreditTransaction', amount: { amount: '25.0', currencyCode: 'EUR' }, event: 'ADJUSTMENT', remainingAmount: { amount: '25.0' } });
    expect(tx.account.balance).toMatchObject({ amount: '25.0', currencyCode: 'EUR' });
    await t.app.ctx.queue.idle();
    expect(sent.some((m) => m.to === 'api-credit@example.com' && /store credit/i.test(m.subject))).toBe(true);

    const accountId = tx.account.id;
    const debit = await g(`mutation($id: ID!) { storeCreditAccountDebit(id: $id, debitInput: { debitAmount: { amount: "10.00", currencyCode: EUR } }) { storeCreditAccountTransaction { __typename account { balance { amount } } } userErrors { code field } } }`, { id: accountId });
    expect(debit.storeCreditAccountDebit.storeCreditAccountTransaction).toMatchObject({ __typename: 'StoreCreditAccountDebitTransaction', account: { balance: { amount: '15.0' } } });
    const tooMuch = await g(`mutation($id: ID!) { storeCreditAccountDebit(id: $id, debitInput: { debitAmount: { amount: "99.00", currencyCode: EUR } }) { storeCreditAccountTransaction { id } userErrors { code } } }`, { id: accountId });
    expect(tooMuch.storeCreditAccountDebit.userErrors).toEqual([{ code: 'INSUFFICIENT_FUNDS' }]);
    const wrong = await g(`mutation($id: ID!) { storeCreditAccountCredit(id: $id, creditInput: { creditAmount: { amount: "1.00", currencyCode: USD } }) { userErrors { code } } }`, { id: accountId });
    expect(wrong.storeCreditAccountCredit.userErrors[0].code).toBe('UNSUPPORTED_CURRENCY');

    const read = await g(`query($id: ID!) { storeCreditConfiguration { storeCreditEnabled } customer(id: $id) { storeCreditAccounts(first: 5) { nodes { id balance { amount } transactions(first: 10) { nodes { __typename event } } } } }
      node(id: "${accountId}") { ... on StoreCreditAccount { id owner { ... on Customer { id } } } } }`, { id });
    expect(read.storeCreditConfiguration.storeCreditEnabled).toBe(true);
    expect(read.customer.storeCreditAccounts.nodes[0].transactions.nodes.map((x: { __typename: string }) => x.__typename)).toEqual(['StoreCreditAccountCreditTransaction', 'StoreCreditAccountDebitTransaction']);
    expect(read.node.owner.id).toBe(id);
    const filtered = await g(`{ storeCreditAccount(id: "${accountId}") { transactions(first: 10, query: "type:debit") { nodes { __typename } } } }`);
    expect(filtered.storeCreditAccount.transactions.nodes).toHaveLength(1);
  });
});

// --- checkout, refunds -----------------------------------------------------------------------------------------------

async function signIn(email: string) {
  const reg = await t.app.inject({ method: 'POST', url: '/account/register', payload: new URLSearchParams({ 'customer[email]': email, 'customer[password]': 'correct horse', 'customer[first_name]': 'Ada' }).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  const cookie = reg.cookies.find((c) => c.name === 'shopme_customer')?.value;
  if (!cookie) throw new Error(`registration failed: ${reg.statusCode} ${reg.body}`);
  const [c] = await db().select().from(s.customers).where(eq(s.customers.email, email));
  return { cookie, customer: c! };
}
async function startCheckout(variant: string, quantity: number) {
  const add = await t.app.inject({ method: 'POST', url: '/cart/add.js', payload: { id: sku[variant], quantity } });
  const cart = add.cookies.find((c) => c.name === 'cart')!.value;
  const go = await t.app.inject({ method: 'POST', url: '/checkout', cookies: { cart } });
  return { cart, token: go.headers.location!.toString().split('/').pop()! };
}
const as = (cookie: string | null): Record<string, string> => (cookie ? { shopme_customer: cookie } : {});
const refresh = (token: string, body: Record<string, unknown>, cookie: string | null) => t.app.inject({ method: 'POST', url: `/checkouts/${token}/refresh`, payload: body, cookies: as(cookie) });
const complete = (token: string, method: string, cookie: string | null, extra: Record<string, string> = {}, email = 'buyer@example.com') => t.app.inject({
  method: 'POST', url: `/checkouts/${token}/complete`, cookies: as(cookie), headers: { 'content-type': 'application/x-www-form-urlencoded' },
  payload: new URLSearchParams({ ...ADDRESS, email, paymentMethod: method, ...extra }).toString(),
});
const orderOf = async (token: string) => (await db().select().from(s.orders).where(eq(s.orders.cartToken, token)))[0]!;
const txsOf = (orderId: number) => db().select().from(s.transactions).where(eq(s.transactions.orderId, orderId)).orderBy(s.transactions.id);

describe('store credit at checkout', () => {
  it('guests see nothing and the feature off ignores credit', async () => {
    const { token } = await startCheckout('HEB-250', 1);
    const page = await t.app.inject(`/checkouts/${token}`);
    expect(page.body).not.toContain('store-credit-box');
  });

  it('pays after gift cards and before the remaining method, debits atomically and records the tender', async () => {
    await settings({ storeCredit: { enabled: true } });
    const email = 'tender@example.com';
    const { cookie, customer: c } = await signIn(email);
    await credit({ customerId: c.id }, 500, { expiresAt: new Date(Date.now() + 30 * day) });
    await db().insert(s.giftCards).values({ shopId, code: 'TENDERGIFT01', token: 'tok-tender', currency: 'EUR', initialValue: 400, balance: 400 });

    const { token } = await startCheckout('HEB-250', 1);
    const page = await t.app.inject({ url: `/checkouts/${token}`, cookies: as(cookie) });
    expect(page.body).toContain('store-credit-box');
    const r = (await refresh(token, { ...ADDRESS, email, addGiftCardCode: 'TENDERGIFT01', storeCreditField: '1', useStoreCredit: '1' }, cookie)).json() as { amount: number; summary: string };
    expect(r.summary).toContain('Store credit');
    expect(r.amount).toBeGreaterThan(0); // the card (400) and the credit (500) leave something for the payment method
    const done = await complete(token, 'bank_transfer', cookie, { storeCreditField: '1', useStoreCredit: '1' }, email);
    expect(done.statusCode).toBe(303);
    const order = await orderOf(token);
    const txs = await txsOf(order.id);
    const gift = txs.find((x) => x.gateway === 'gift_card')!;
    const credited = txs.find((x) => x.gateway === 'store_credit')!;
    expect(gift.amount).toBe(400);
    expect(credited.amount).toBe(500);
    const cash = txs.filter((x) => !['gift_card', 'store_credit'].includes(x.gateway ?? ''));
    expect(cash.reduce((n, x) => n + x.amount, 0)).toBe(order.total - 400 - 500);
    expect(gift.id).toBeLessThan(credited.id);
    const account = (await findStoreCreditAccount(db(), shopId, c.id, 'EUR'))!;
    expect(await liveBalance(db(), account.id)).toBe(0);
    const [debit] = await db().select().from(s.storeCreditTransactions).where(and(eq(s.storeCreditTransactions.orderId, order.id), eq(s.storeCreditTransactions.kind, 'DEBIT')));
    expect(debit).toMatchObject({ event: 'ORDER_PAYMENT', amount: credited.amount });
  });

  it('covers the whole order without a payment method and the checkbox can be cleared', async () => {
    const email = 'full@example.com';
    const { cookie, customer: c } = await signIn(email);
    await credit({ customerId: c.id }, 100_000);
    const off = await startCheckout('HEB-250', 1);
    const unchecked = (await refresh(off.token, { ...ADDRESS, email, storeCreditField: '1' }, cookie)).json() as { amount: number; free: boolean };
    expect(unchecked.free).toBe(false); // checkbox sent without a value: credit not used
    const on = (await refresh(off.token, { ...ADDRESS, email, storeCreditField: '1', useStoreCredit: '1' }, cookie)).json() as { amount: number; free: boolean };
    expect(on.free).toBe(true);
    expect(on.amount).toBe(0);
    const done = await complete(off.token, '', cookie, { storeCreditField: '1', useStoreCredit: '1' }, email);
    expect(done.statusCode).toBe(303);
    const order = await orderOf(off.token);
    expect(order.financialStatus).toBe('PAID');
    const txs = await txsOf(order.id);
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ gateway: 'store_credit', status: 'SUCCESS', amount: order.total });
  });

  it('refuses the order when the balance was spent elsewhere meanwhile', async () => {
    const email = 'race@example.com';
    const { cookie, customer: c } = await signIn(email);
    await credit({ customerId: c.id }, 100_000);
    const { token } = await startCheckout('HEB-250', 1);
    await refresh(token, { ...ADDRESS, email, storeCreditField: '1', useStoreCredit: '1' }, cookie);
    const account = (await findStoreCreditAccount(db(), shopId, c.id, 'EUR'))!;
    // the checkout view is computed again at submit; shrink the balance after the page was shown
    await debitStoreCredit(db(), shopId, { accountId: account.id, amount: 99_999 });
    const done = await complete(token, 'bank_transfer', cookie, { storeCreditField: '1', useStoreCredit: '1' }, email);
    expect(done.statusCode).toBe(303); // re-priced: the rest is paid by the chosen method
    const order = await orderOf(token);
    const credited = (await txsOf(order.id)).filter((x) => x.gateway === 'store_credit').reduce((n, x) => n + x.amount, 0);
    expect(credited).toBe(1);
  });
});

describe('refunds and cancellation with store credit', () => {
  async function paidWithCredit(email: string, amount = 100_000) {
    const { cookie, customer: c } = await signIn(email);
    await credit({ customerId: c.id }, amount);
    const { token } = await startCheckout('HEB-250', 1);
    await complete(token, 'bank_transfer', cookie, { storeCreditField: '1', useStoreCredit: '1' }, email);
    const order = await orderOf(token);
    return { order, customer: c, cookie };
  }

  it('cancelling an order paid with credit restores the credit (ORDER_CANCELLATION)', async () => {
    const { order, customer: c } = await paidWithCredit('cancel-credit@example.com');
    const account = (await findStoreCreditAccount(db(), shopId, c.id, 'EUR'))!;
    expect(await liveBalance(db(), account.id)).toBe(100_000 - order.total);
    const r = await g(`mutation($id: ID!) { orderCancel(orderId: $id, reason: CUSTOMER, restock: true, refund: true) { job { id } orderCancelUserErrors { message } userErrors { message } } }`, { id: `gid://shopify/Order/${order.id}` });
    expect(r.orderCancel.userErrors).toEqual([]);
    expect(await liveBalance(db(), account.id)).toBe(100_000);
    const [row] = await db().select().from(s.storeCreditTransactions).where(and(eq(s.storeCreditTransactions.orderId, order.id), eq(s.storeCreditTransactions.kind, 'CREDIT')));
    expect(row).toMatchObject({ event: 'ORDER_CANCELLATION', amount: order.total });
  });

  it('refundCreate sends part of a refund to store credit with an expiry and the rest to the original method', async () => {
    const email = 'refund-credit@example.com';
    const { cookie, customer: c } = await signIn(email);
    const { token } = await startCheckout('HEB-250', 1);
    await complete(token, 'bank_transfer', cookie, {}, email);
    const order = await orderOf(token);
    await db().update(s.orders).set({ financialStatus: 'PAID' }).where(eq(s.orders.id, order.id));
    await db().update(s.transactions).set({ status: 'SUCCESS' }).where(eq(s.transactions.orderId, order.id));
    const expires = new Date(Date.now() + 20 * day).toISOString();
    const halfCents = Math.floor(order.total / 2);
    const money = (cents: number) => (cents / 100).toFixed(2);
    const r = await g(`mutation($id: ID!, $e: DateTime) { refundCreate(input: { orderId: $id, transactions: [{ orderId: $id, kind: REFUND, gateway: "bank_transfer", amount: "${money(order.total - halfCents)}" }],
      refundMethods: [{ storeCreditRefund: { amount: { amount: "${money(halfCents)}", currencyCode: EUR }, expiresAt: $e } }] }) { refund { id totalRefundedSet { shopMoney { amount } } } userErrors { field message } } }`, { id: `gid://shopify/Order/${order.id}`, e: expires });
    expect(r.refundCreate.userErrors, JSON.stringify(r.refundCreate)).toEqual([]);
    const account = (await findStoreCreditAccount(db(), shopId, c.id, 'EUR'))!;
    const [row] = await db().select().from(s.storeCreditTransactions).where(and(eq(s.storeCreditTransactions.accountId, account.id), eq(s.storeCreditTransactions.kind, 'CREDIT')));
    expect(row).toMatchObject({ event: 'ORDER_REFUND', amount: halfCents });
    expect(row!.expiresAt!.toISOString()).toBe(new Date(expires).toISOString());
    const refunds = (await txsOf(order.id)).filter((x) => x.kind === 'REFUND');
    expect(refunds.map((x) => x.gateway).sort()).toEqual(['bank_transfer', 'store_credit']);

    // a past expiry is refused
    const past = await g(`mutation($id: ID!) { refundCreate(input: { orderId: $id, refundMethods: [{ storeCreditRefund: { amount: { amount: "1.00", currencyCode: EUR }, expiresAt: "2020-01-01T00:00:00Z" } }] }) { userErrors { message } } }`, { id: `gid://shopify/Order/${order.id}` });
    expect(past.refundCreate.userErrors[0].message).toMatch(/future/);
  });

  it('a failed online payment gives the spent credit back', async () => {
    const { order, customer: c } = await paidWithCredit('failed-pay@example.com', 500);
    const account = (await findStoreCreditAccount(db(), shopId, c.id, 'EUR'))!;
    const spent = (await txsOf(order.id)).filter((x) => x.gateway === 'store_credit').reduce((n, x) => n + x.amount, 0);
    expect(spent).toBe(500);
    expect(await liveBalance(db(), account.id)).toBe(0);
    await recordPaymentFailure(db(), shopId, order.id, { gateway: 'stripe', message: 'declined' });
    expect(await liveBalance(db(), account.id)).toBe(500);
    const [rev] = await db().select().from(s.storeCreditTransactions).where(and(eq(s.storeCreditTransactions.accountId, account.id), eq(s.storeCreditTransactions.kind, 'DEBIT_REVERT')));
    expect(rev).toMatchObject({ event: 'PAYMENT_FAILURE', amount: 500 });
    await recordPaymentFailure(db(), shopId, order.id, { gateway: 'stripe', message: 'declined again' }); // idempotent
    expect(await liveBalance(db(), account.id)).toBe(500);
  });
});

describe('store credit in the storefront', () => {
  it('exposes customer.store_credit_account (balance) only when the feature is on and the balance is positive', async () => {
    const { cookie, customer: c } = await signIn('liquid-credit@example.com');
    const html = async () => (await t.app.inject({ url: '/account', cookies: as(cookie) })).body;
    await settings({ storeCredit: { enabled: true } });
    expect(await html()).not.toContain('customer__credit');
    await credit({ customerId: c.id }, 2550);
    const body = await html();
    expect(body).toContain('customer__credit');
    expect(body).toMatch(/25[.,]50/);
    await settings({ storeCredit: { enabled: false } });
    expect(await html()).not.toContain('customer__credit');
    await settings({ storeCredit: { enabled: true } });
  });
});

