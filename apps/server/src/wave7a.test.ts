import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, desc, eq } from 'drizzle-orm';
import { createFulfillment, createLocalStorage, getPrimaryShop, recoverAbandonedCheckouts, schema as s, seedDemo, type Mail } from '@shopme/core';
import { createTestApp, SETUP_BODY, type TestApp } from './test-utils';
import { makeGql, makeGqlOk } from '../test/conformance/helpers';

const ADDRESS = { email: 'Buyer@Example.com', firstName: 'Ada', lastName: 'Lovelace', address1: '1 Rue de Rivoli', city: 'Paris', zip: '75001', countryCode: 'FR', phone: '' };
let t: TestApp;
let g: ReturnType<typeof makeGqlOk>;
let gql: ReturnType<typeof makeGql>;
let sent: Mail[];
let shopId: number;
const sku: Record<string, number> = {};

beforeAll(async () => {
  t = await createTestApp();
  const setup = await t.app.inject({ method: 'POST', url: '/admin/api/setup', payload: SETUP_BODY });
  const cookie = setup.cookies.find((c) => c.name === 'shopme_session')!.value;
  gql = makeGql(t.app, cookie);
  g = makeGqlOk(gql);
  await seedDemo(t.dbHandle.db, createLocalStorage(mkdtempSync(path.join(tmpdir(), 'w7-'))));
  shopId = (await getPrimaryShop(t.dbHandle.db))!.id;
  for (const v of await t.dbHandle.db.select().from(s.productVariants)) if (v.sku) sku[v.sku] = v.id;
  sent = [];
  t.app.ctx.mailer = { send: async (m) => { sent.push(m); } };
}, 90_000);
afterAll(async () => { await t.close(); });

const db = () => t.dbHandle.db;
const stock = async (v: string) => (await db().select().from(s.inventoryLevels).innerJoin(s.inventoryItems, eq(s.inventoryItems.id, s.inventoryLevels.inventoryItemId)).where(eq(s.inventoryItems.variantId, sku[v]!)))[0]!.inventory_levels;
const until = async <T>(fn: () => Promise<T | null | undefined | false>, ms = 6000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 50)); }
};

async function startCheckout(variant: string, quantity: number, properties?: Record<string, string>) {
  const add = await t.app.inject({ method: 'POST', url: '/cart/add.js', payload: { id: sku[variant], quantity, ...(properties && { properties }) } });
  expect(add.statusCode).toBe(200);
  const cart = add.cookies.find((c) => c.name === 'cart')!.value;
  const go = await t.app.inject({ method: 'POST', url: '/checkout', cookies: { cart } });
  return { cart, token: go.headers.location!.toString().split('/').pop()! };
}
const refresh = (token: string, body: Record<string, unknown>) => t.app.inject({ method: 'POST', url: `/checkouts/${token}/refresh`, payload: body });
const complete = (token: string, method: string, extra: Record<string, string> = {}) => t.app.inject({
  method: 'POST', url: `/checkouts/${token}/complete`, payload: new URLSearchParams({ ...ADDRESS, paymentMethod: method, ...extra }).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' },
});
const orderOf = async (token: string) => (await db().select().from(s.orders).where(eq(s.orders.cartToken, token)))[0]!;
const gid = (type: string, id: number) => `gid://shopify/${type}/${id}`;

async function newOrder(variant: string, quantity: number) {
  const { token } = await startCheckout(variant, quantity);
  await refresh(token, ADDRESS);
  expect((await complete(token, 'bank_transfer')).statusCode).toBe(303);
  return orderOf(token);
}

describe('gift cards: Admin GraphQL', () => {
  const CARD = 'id enabled isRedeemable lastCharacters maskedCode note expiresOn balance { amount currencyCode } initialValue { amount }';
  it('creates, lists, filters, updates, credits, debits and deactivates', async () => {
    const created = await g(`mutation($i: GiftCardCreateInput!) { giftCardCreate(input: $i) { giftCard { ${CARD} } giftCardCode userErrors { field message code } } }`, { i: { initialValue: '25.00', code: 'WELCOME2026', note: 'for Ada' } });
    expect(created.giftCardCreate.userErrors).toEqual([]);
    expect(created.giftCardCreate.giftCardCode).toBe('welcome2026');
    const card = created.giftCardCreate.giftCard;
    expect(card).toMatchObject({ enabled: true, isRedeemable: true, lastCharacters: '2026', maskedCode: expect.stringContaining('2026'), balance: { amount: '25.0', currencyCode: 'EUR' } });

    const dup = await g(`mutation { giftCardCreate(input: { initialValue: "5", code: "welcome2026" }) { giftCard { id } userErrors { code field } } }`);
    expect(dup.giftCardCreate).toMatchObject({ giftCard: null, userErrors: [{ code: 'TAKEN', field: ['input', 'code'] }] });
    expect((await g(`mutation { giftCardCreate(input: { initialValue: "5", code: "short" }) { userErrors { code } } }`)).giftCardCreate.userErrors[0].code).toBe('TOO_SHORT');
    expect((await g(`mutation { giftCardCreate(input: { initialValue: "0" }) { userErrors { code } } }`)).giftCardCreate.userErrors[0].code).toBe('GREATER_THAN');
    const random = await g(`mutation { giftCardCreate(input: { initialAmount: { amount: "10", currencyCode: EUR } }) { giftCardCode giftCard { id } } }`);
    expect(random.giftCardCreate.giftCardCode).toMatch(/^[a-z0-9]{16}$/);

    const list = await g(`{ giftCards(first: 10, query: "last_characters:2026") { nodes { id lastCharacters } } giftCardsCount { count } }`);
    expect(list.giftCards.nodes).toEqual([{ id: card.id, lastCharacters: '2026' }]);
    expect(list.giftCardsCount.count).toBe(2);

    const upd = await g(`mutation($id: ID!) { giftCardUpdate(id: $id, input: { note: "updated", expiresOn: "2099-01-01" }) { giftCard { note expiresOn } userErrors { message } } }`, { id: card.id });
    expect(upd.giftCardUpdate.giftCard).toEqual({ note: 'updated', expiresOn: '2099-01-01' });

    const credit = await g(`mutation($id: ID!) { giftCardCredit(id: $id, creditInput: { creditAmount: { amount: "5", currencyCode: EUR }, note: "bonus" }) { giftCardCreditTransaction { id amount { amount } note giftCard { balance { amount } } } userErrors { code } } }`, { id: card.id });
    expect(credit.giftCardCredit.giftCardCreditTransaction).toMatchObject({ amount: { amount: '5.0' }, note: 'bonus', giftCard: { balance: { amount: '30.0' } } });
    const debit = await g(`mutation($id: ID!) { giftCardDebit(id: $id, debitInput: { debitAmount: { amount: "40", currencyCode: EUR } }) { giftCardDebitTransaction { id } userErrors { code } } }`, { id: card.id });
    expect(debit.giftCardDebit).toMatchObject({ giftCardDebitTransaction: null, userErrors: [{ code: 'INSUFFICIENT_FUNDS' }] });
    expect((await g(`mutation($id: ID!) { giftCardDebit(id: $id, debitInput: { debitAmount: { amount: "10", currencyCode: EUR } }) { giftCardDebitTransaction { amount { amount } } } }`, { id: card.id })).giftCardDebit.giftCardDebitTransaction.amount.amount).toBe('10.0');
    const txs = await g(`query($id: ID!) { giftCard(id: $id) { balance { amount } transactions(first: 10) { nodes { __typename amount { amount } } } } }`, { id: card.id });
    expect(txs.giftCard.balance.amount).toBe('20.0');
    expect(txs.giftCard.transactions.nodes.map((n: { __typename: string }) => n.__typename).sort()).toEqual(['GiftCardCreditTransaction', 'GiftCardCreditTransaction', 'GiftCardDebitTransaction']);

    const off = await g(`mutation($id: ID!) { giftCardDeactivate(id: $id) { giftCard { enabled isRedeemable } } }`, { id: card.id });
    expect(off.giftCardDeactivate.giftCard).toEqual({ enabled: false, isRedeemable: false });
    expect((await g(`mutation($id: ID!) { giftCardCredit(id: $id, creditInput: { creditAmount: { amount: "1", currencyCode: EUR } }) { userErrors { code } } }`, { id: card.id })).giftCardCredit.userErrors[0].code).toBe('INACTIVE_GIFT_CARD');
    expect((await g(`{ giftCards(first: 10, query: "status:disabled") { nodes { id } } }`)).giftCards.nodes).toEqual([{ id: card.id }]);
  });
});

describe('gift cards at checkout', () => {
  const mkCard = async (code: string, value: number) => (await db().insert(s.giftCards).values({ shopId, code, token: `tok-${code}`, currency: 'EUR', initialValue: value, balance: value }).returning())[0]!;

  it('pays part of the total, the rest stays due; the balance is debited with the order', async () => {
    const card = await mkCard('PARTIAL500', 500);
    const { token } = await startCheckout('HEB-250', 1);
    const before = (await refresh(token, ADDRESS)).json();
    const r = (await refresh(token, { ...ADDRESS, addGiftCardCode: 'partial-500' })).json();
    expect(r.giftError).toBe('');
    expect(r.amount).toBe(before.amount - 500);
    expect(r.summary).toContain('0500'.slice(1)); // masked card tag shows the last characters
    expect((await refresh(token, { ...ADDRESS, addGiftCardCode: 'NOSUCHCARD1' })).json().giftError).toMatch(/does not exist/);

    const done = await complete(token, 'bank_transfer');
    expect(done.statusCode).toBe(303);
    const order = await orderOf(token);
    expect(order).toMatchObject({ financialStatus: 'PENDING', total: before.amount });
    const txs = await db().select().from(s.transactions).where(eq(s.transactions.orderId, order.id));
    expect(txs.find((x) => x.gateway === 'bank_transfer')).toMatchObject({ amount: before.amount - 500, status: 'PENDING' });
    expect(txs.find((x) => x.gateway === 'gift_card')).toMatchObject({ amount: 500, status: 'SUCCESS', kind: 'SALE' });
    expect((await db().select().from(s.giftCards).where(eq(s.giftCards.id, card.id)))[0]!.balance).toBe(0);
    expect(await db().select().from(s.giftCardTransactions).where(eq(s.giftCardTransactions.giftCardId, card.id))).toMatchObject([{ amount: -500, orderId: order.id }]);

    // an emptied card cannot be applied again
    const again = await startCheckout('HEB-250', 1);
    expect((await refresh(again.token, { ...ADDRESS, addGiftCardCode: 'PARTIAL500' })).json().giftError).toMatch(/no balance/);
    const page = await t.app.inject(`/checkouts/${token}/thank-you`);
    expect(page.body).toContain('Gift card');
  });

  it('a card that covers everything makes the order paid without a payment method', async () => {
    const card = await mkCard('BIGCARD2000', 20000);
    const { token } = await startCheckout('JPG-50', 1);
    const full = (await refresh(token, { ...ADDRESS, addGiftCardCode: 'bigcard2000' })).json();
    expect(full).toMatchObject({ amount: 0, free: true, giftError: '' });
    const done = await complete(token, '');
    expect(done.statusCode).toBe(303);
    const order = await orderOf(token);
    expect(order).toMatchObject({ financialStatus: 'PAID' });
    const txs = await db().select().from(s.transactions).where(eq(s.transactions.orderId, order.id));
    expect(txs.map((x) => [x.gateway, x.status, x.amount])).toEqual([['gift_card', 'SUCCESS', order.total]]);
    expect((await db().select().from(s.giftCards).where(eq(s.giftCards.id, card.id)))[0]!.balance).toBe(20000 - order.total);
  });

  it('a gift card cannot pay for a gift card, and the page shows the balance', async () => {
    const card = await mkCard('PAYSCARD100', 10000);
    const [variant] = await db().select().from(s.productVariants).where(eq(s.productVariants.id, sku['HEB-250']!));
    await db().update(s.products).set({ isGiftCard: true }).where(eq(s.products.id, variant!.productId));
    try {
      const { token } = await startCheckout('HEB-250', 1);
      const r = (await refresh(token, { ...ADDRESS, addGiftCardCode: 'PAYSCARD100' })).json();
      expect(r.amount).toBeGreaterThan(0); // nothing of the gift card line is paid with the card
    } finally {
      await db().update(s.products).set({ isGiftCard: false }).where(eq(s.products.id, variant!.productId));
    }
    const page = await t.app.inject(`/gift_cards/${card.token}`);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('PAYS CARD 100');
    expect(page.body).toContain('€100.00');
    expect((await t.app.inject('/gift_cards/does-not-exist')).statusCode).toBe(404);
  });
});

describe('gift card products', () => {
  it('issues a card when the order is paid, emails the recipient, and the public page works', async () => {
    const [variant] = await db().select().from(s.productVariants).where(eq(s.productVariants.id, sku['JPG-50']!));
    await db().update(s.products).set({ isGiftCard: true }).where(eq(s.products.id, variant!.productId));
    sent.length = 0;
    const { token } = await startCheckout('JPG-50', 2, { 'Recipient email': 'Friend@Example.com', 'Recipient name': 'Sam', Message: 'Enjoy!' });
    await refresh(token, ADDRESS);
    expect((await complete(token, 'bank_transfer')).statusCode).toBe(303);
    const order = await orderOf(token);
    await new Promise((r) => setTimeout(r, 800));
    expect(await db().select().from(s.giftCards).where(eq(s.giftCards.orderId, order.id))).toHaveLength(0); // not paid yet

    await g(`mutation($id: ID!) { orderMarkAsPaid(input: { id: $id }) { order { id } userErrors { message } } }`, { id: gid('Order', order.id) });
    const cards = await until(async () => { const r = await db().select().from(s.giftCards).where(eq(s.giftCards.orderId, order.id)); return r.length === 2 ? r : null; });
    expect(cards[0]).toMatchObject({ initialValue: 1100, balance: 1100, currency: 'EUR', message: 'Enjoy!', recipientName: 'Sam' });
    await until(async () => sent.filter((m) => m.to === 'friend@example.com').length === 2);
    const mail = sent.find((m) => m.to === 'friend@example.com')!;
    expect(mail.subject).toContain('gift card');
    expect(mail.html).toContain('Enjoy!');
    expect(cards.some((c) => mail.html!.includes(`/gift_cards/${c.token}`))).toBe(true);
    // paying again does not issue again
    await new Promise((r) => setTimeout(r, 500));
    expect(await db().select().from(s.giftCards).where(eq(s.giftCards.orderId, order.id))).toHaveLength(2);

    const page = await t.app.inject(`/gift_cards/${cards[0]!.token}`);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Enjoy!');
    expect(page.body).toContain('€11.00');
    expect(page.body).not.toContain('Liquid error');
    const fromAdmin = await g(`query($id: ID!) { giftCard(id: $id) { initialValue { amount } order { name } recipientAttributes { preferredName message recipient { email } } } }`, { id: gid('GiftCard', cards[0]!.id) });
    expect(fromAdmin.giftCard).toMatchObject({ initialValue: { amount: '11.0' }, order: { name: order.name }, recipientAttributes: { preferredName: 'Sam', recipient: { email: 'friend@example.com' } } });
    await db().update(s.products).set({ isGiftCard: false }).where(eq(s.products.id, variant!.productId));
  });
});

describe('abandoned checkouts', () => {
  it('lists idle checkouts with an email, sends the recovery email by hand and restores the cart from the link', async () => {
    const { token } = await startCheckout('HEB-250', 2);
    await refresh(token, ADDRESS);
    const fresh = await g(`{ abandonedCheckouts(first: 10) { nodes { id } } abandonedCheckoutsCount { count } }`);
    expect(fresh.abandonedCheckouts.nodes).toEqual([]); // not idle yet
    await db().update(s.carts).set({ updatedAt: new Date(Date.now() - 12 * 3_600_000) }).where(eq(s.carts.token, token));

    const q = `{ abandonedCheckouts(first: 10, query: "email:buyer@example.com") { nodes { id name abandonedCheckoutUrl completedAt discountCodes lineItemsQuantity customer { email }
      lineItems(first: 5) { nodes { title quantity sku originalTotalPriceSet { shopMoney { amount } } } } subtotalPriceSet { shopMoney { amount currencyCode } } totalPriceSet { shopMoney { amount } } shopmeRecoveryEmailsSent } } }`;
    const list = (await g(q)).abandonedCheckouts.nodes;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ lineItemsQuantity: 2, completedAt: null, shopmeRecoveryEmailsSent: 0, abandonedCheckoutUrl: expect.stringContaining(`/checkouts/${token}/recover`) });
    expect(list[0].lineItems.nodes[0]).toMatchObject({ title: 'House Espresso Blend', quantity: 2 });

    sent.length = 0;
    const send = await g(`mutation($id: ID!) { shopmeAbandonedCheckoutRecoveryEmailSend(id: $id) { abandonedCheckout { shopmeRecoveryEmailsSent } userErrors { message } } }`, { id: list[0].id });
    expect(send.shopmeAbandonedCheckoutRecoveryEmailSend).toEqual({ abandonedCheckout: { shopmeRecoveryEmailsSent: 1 }, userErrors: [] });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'buyer@example.com', subject: expect.stringContaining('cart') });
    expect(sent[0]!.html).toContain(`/checkouts/${token}/recover`);
    expect(sent[0]!.html).toContain('House Espresso Blend');

    const rec = await t.app.inject(`/checkouts/${token}/recover`);
    expect(rec.statusCode).toBe(303);
    expect(rec.headers.location).toBe(`/checkouts/${token}`);
    expect(rec.cookies.find((c) => c.name === 'cart')!.value).toBe(token);
    expect((await t.app.inject({ url: '/cart.js', cookies: { cart: token } })).json().item_count).toBe(2);
  });

  it('the scheduled sweep honours the enabled toggle and the delay, and emails each checkout once', async () => {
    const { token } = await startCheckout('JPG-50', 1);
    await refresh(token, { ...ADDRESS, email: 'sweep@example.com' });
    await db().update(s.carts).set({ updatedAt: new Date(Date.now() - 3 * 3_600_000) }).where(eq(s.carts.token, token));
    const shop = (await getPrimaryShop(db()))!;
    sent.length = 0;
    expect(await recoverAbandonedCheckouts(db(), t.app.ctx.mailer, shop, 'http://localhost')).toBe(0); // disabled by default

    const set = await g(`mutation { shopmeAbandonedCheckoutSettingsUpdate(enabled: true, delayHours: 6) { settings { enabled delayHours } userErrors { message } } }`);
    expect(set.shopmeAbandonedCheckoutSettingsUpdate.settings).toEqual({ enabled: true, delayHours: 6 });
    expect((await g(`mutation { shopmeAbandonedCheckoutSettingsUpdate(delayHours: 5) { settings { delayHours } userErrors { message } } }`)).shopmeAbandonedCheckoutSettingsUpdate.userErrors).toHaveLength(1);
    const on = (await getPrimaryShop(db()))!;
    expect(await recoverAbandonedCheckouts(db(), t.app.ctx.mailer, on, 'http://localhost')).toBe(0); // idle 3h < 6h

    await g(`mutation { shopmeAbandonedCheckoutSettingsUpdate(delayHours: 1) { settings { delayHours } } }`);
    const one = (await getPrimaryShop(db()))!;
    expect(await recoverAbandonedCheckouts(db(), t.app.ctx.mailer, one, 'http://localhost')).toBe(1);
    expect(sent.map((m) => m.to)).toEqual(['sweep@example.com']);
    expect(await recoverAbandonedCheckouts(db(), t.app.ctx.mailer, one, 'http://localhost')).toBe(0);

    // a completed checkout is no longer abandoned
    expect((await complete(token, 'bank_transfer', { email: 'sweep@example.com' })).statusCode).toBe(303);
    expect((await g(`{ abandonedCheckouts(first: 10, query: "email:sweep@example.com") { nodes { id } } }`)).abandonedCheckouts.nodes).toEqual([]);
    await g(`mutation { shopmeAbandonedCheckoutSettingsUpdate(enabled: false, delayHours: 10) { settings { enabled } } }`);
  });
});

describe('order editing', () => {
  it('stages changes server-side, recalculates, and commits with stock, totals and payment due', async () => {
    const order = await newOrder('HEB-250', 2); // 2 x 13.00
    const heb = await stock('HEB-250'); const jpg = await stock('JPG-50');
    const begin = await g(`mutation($id: ID!) { orderEditBegin(id: $id) { calculatedOrder { id totalPriceSet { shopMoney { amount } } lineItems(first: 10) { nodes { id title quantity editableQuantity } } } orderEditSession { id } userErrors { message } } }`, { id: gid('Order', order.id) });
    const calc = begin.orderEditBegin.calculatedOrder;
    expect(begin.orderEditBegin.userErrors).toEqual([]);
    expect(calc.lineItems.nodes).toMatchObject([{ title: 'House Espresso Blend', quantity: 2, editableQuantity: 2 }]);
    const original = Number(calc.totalPriceSet.shopMoney.amount);
    expect(original).toBe(order.total / 100);

    const add = await g(`mutation($id: ID!, $v: ID!) { orderEditAddVariant(id: $id, variantId: $v, quantity: 1) { calculatedLineItem { id title quantity } calculatedOrder { totalPriceSet { shopMoney { amount } } totalOutstandingSet { shopMoney { amount } } } userErrors { message } } }`, { id: calc.id, v: gid('ProductVariant', sku['JPG-50']!) });
    expect(add.orderEditAddVariant.calculatedLineItem).toMatchObject({ title: expect.any(String), quantity: 1 });
    // JPG-50 costs 11.00 + 20% VAT (tax-exclusive prices)
    expect(Number(add.orderEditAddVariant.calculatedOrder.totalPriceSet.shopMoney.amount)).toBeCloseTo(original + 13.2, 2);

    const lineId = calc.lineItems.nodes[0].id;
    const setq = await g(`mutation($id: ID!, $l: ID!) { orderEditSetQuantity(id: $id, lineItemId: $l, quantity: 3) { calculatedOrder { totalPriceSet { shopMoney { amount } } } userErrors { message } } }`, { id: calc.id, l: lineId });
    expect(Number(setq.orderEditSetQuantity.calculatedOrder.totalPriceSet.shopMoney.amount)).toBeCloseTo(original + 13.2 + 15.6, 2);
    const disc = await g(`mutation($id: ID!, $l: ID!) { orderEditAddLineItemDiscount(id: $id, lineItemId: $l, discount: { description: "Goodwill", percentValue: 10 }) { calculatedLineItem { hasStagedLineItemDiscount } addedDiscountStagedChange { description } calculatedOrder { totalPriceSet { shopMoney { amount } } } userErrors { message } } }`, { id: calc.id, l: lineId });
    expect(disc.orderEditAddLineItemDiscount.calculatedLineItem.hasStagedLineItemDiscount).toBe(true);
    expect(disc.orderEditAddLineItemDiscount.addedDiscountStagedChange.description).toBe('Goodwill');
    const staged = Number(disc.orderEditAddLineItemDiscount.calculatedOrder.totalPriceSet.shopMoney.amount);
    expect(staged).toBeCloseTo(original + 13.2 + 3 * 13 * 1.2 * 0.9 - 2 * 13 * 1.2, 1);

    // nothing changed on the order until commit
    expect((await db().select().from(s.orders).where(eq(s.orders.id, order.id)))[0]!.total).toBe(order.total);
    expect((await stock('HEB-250')).available).toBe(heb.available);

    const commit = await g(`mutation($id: ID!) { orderEditCommit(id: $id, staffNote: "customer call") { order { id totalPriceSet { shopMoney { amount } } totalOutstandingSet { shopMoney { amount } } lineItems(first: 10) { nodes { title currentQuantity } } displayFinancialStatus } successMessages userErrors { message } } }`, { id: calc.id });
    expect(commit.orderEditCommit.userErrors).toEqual([]);
    const o = commit.orderEditCommit.order;
    expect(Number(o.totalPriceSet.shopMoney.amount)).toBeCloseTo(staged, 2);
    expect(o.lineItems.nodes.map((n: { title: string; currentQuantity: number }) => n.currentQuantity)).toEqual([3, 1]);
    expect(Number(o.totalOutstandingSet.shopMoney.amount)).toBeCloseTo(staged, 2); // pending order: everything is still due
    expect((await stock('HEB-250')).available).toBe(heb.available - 1);
    expect((await stock('HEB-250')).committed).toBe(heb.committed + 1);
    expect((await stock('JPG-50')).available).toBe(jpg.available - 1);
    const events = await db().select().from(s.events).where(and(eq(s.events.subjectId, order.id), eq(s.events.verb, 'order.edited')));
    expect(events).toHaveLength(1);
    expect(events[0]!.message).toContain('customer call');
    // a committed session cannot be reused
    expect((await g(`mutation($id: ID!) { orderEditCommit(id: $id) { userErrors { message } } }`, { id: calc.id })).orderEditCommit.userErrors).toHaveLength(1);

    // reducing a paid order leaves a refund owed and restocks when asked
    await g(`mutation($id: ID!) { orderMarkAsPaid(input: { id: $id }) { order { id } } }`, { id: gid('Order', order.id) });
    const second = (await g(`mutation($id: ID!) { orderEditBegin(id: $id) { calculatedOrder { id lineItems(first: 10) { nodes { id title } } } } }`, { id: gid('Order', order.id) })).orderEditBegin.calculatedOrder;
    await g(`mutation($id: ID!, $l: ID!) { orderEditSetQuantity(id: $id, lineItemId: $l, quantity: 1, restock: true) { userErrors { message } } }`, { id: second.id, l: second.lineItems.nodes[0].id });
    const preview = await g(`query($id: ID!) { node(id: $id) { ... on CalculatedOrder { totalOutstandingSet { shopMoney { amount } } } } }`, { id: second.id });
    expect(Number(preview.node.totalOutstandingSet.shopMoney.amount)).toBeLessThan(0); // refund owed
    const after = await g(`mutation($id: ID!) { orderEditCommit(id: $id) { order { displayFinancialStatus } successMessages userErrors { message } } }`, { id: second.id });
    expect(after.orderEditCommit.userErrors).toEqual([]);
    expect(after.orderEditCommit.successMessages[0]).toMatch(/^Refund owed/);
    expect((await stock('HEB-250')).available).toBe(heb.available + 1); // 2 units back: 3 -> 1
    expect(await db().select().from(s.orderEdits).where(eq(s.orderEdits.orderId, order.id))).toHaveLength(2);
  });

  it('refuses to reduce fulfilled units', async () => {
    const order = await newOrder('JPG-50', 1);
    await createFulfillment(db(), shopId, order.id, {});
    const calc = (await g(`mutation($id: ID!) { orderEditBegin(id: $id) { calculatedOrder { id lineItems(first: 5) { nodes { id editableQuantity } } } } }`, { id: gid('Order', order.id) })).orderEditBegin.calculatedOrder;
    expect(calc.lineItems.nodes[0].editableQuantity).toBe(0);
    const r = await g(`mutation($id: ID!, $l: ID!) { orderEditSetQuantity(id: $id, lineItemId: $l, quantity: 0) { userErrors { message } } }`, { id: calc.id, l: calc.lineItems.nodes[0].id });
    expect(r.orderEditSetQuantity.userErrors[0].message).toMatch(/fulfilled/);
  });
});

describe('returns', () => {
  it('creates a return for fulfilled items, closes it with restocking and rejects over-returns', async () => {
    const order = await newOrder('HEB-250', 2);
    const [line] = await db().select().from(s.orderLines).where(eq(s.orderLines.orderId, order.id));
    const lineGid = gid('LineItem', line!.id);
    const none = await g(`mutation($o: ID!, $l: ID!) { returnCreate(returnInput: { orderId: $o, returnLineItems: [{ fulfillmentLineItemId: $l, quantity: 1 }] }) { return { id } userErrors { code message } } }`, { o: gid('Order', order.id), l: lineGid });
    expect(none.returnCreate.return).toBeNull(); // not fulfilled yet
    await createFulfillment(db(), shopId, order.id, {});
    const mid = (await stock('HEB-250'));

    const R = `return { id name status totalQuantity returnLineItems(first: 5) { nodes { quantity returnReason ... on ReturnLineItem { shopmeRestockType } } } order { returnStatus } } userErrors { code message field }`;
    const made = await g(`mutation($o: ID!, $l: ID!) { returnCreate(returnInput: { orderId: $o, returnLineItems: [{ fulfillmentLineItemId: $l, quantity: 1, returnReason: DEFECTIVE, shopmeRestock: true }] }) { ${R} } }`, { o: gid('Order', order.id), l: lineGid });
    expect(made.returnCreate.userErrors).toEqual([]);
    expect(made.returnCreate.return).toMatchObject({ name: `${order.name}-R1`, status: 'OPEN', totalQuantity: 1, order: { returnStatus: 'IN_PROGRESS' } });
    expect(made.returnCreate.return.returnLineItems.nodes[0]).toMatchObject({ quantity: 1, returnReason: 'DEFECTIVE', shopmeRestockType: 'RETURN' });

    const over = await g(`mutation($o: ID!, $l: ID!) { returnCreate(returnInput: { orderId: $o, returnLineItems: [{ fulfillmentLineItemId: $l, quantity: 2 }] }) { return { id } userErrors { code message } } }`, { o: gid('Order', order.id), l: lineGid });
    expect(over.returnCreate.userErrors[0].message).toMatch(/Only 1/);

    expect((await stock('HEB-250')).available).toBe(mid.available); // nothing moves before the return is closed
    const closed = await g(`mutation($id: ID!) { returnClose(id: $id) { return { status closedAt order { returnStatus } } userErrors { code } } }`, { id: made.returnCreate.return.id });
    expect(closed.returnClose.return).toMatchObject({ status: 'CLOSED', order: { returnStatus: 'RETURNED' } });
    expect((await stock('HEB-250')).available).toBe(mid.available + 1);
    expect((await g(`mutation($id: ID!) { returnClose(id: $id) { userErrors { code } } }`, { id: made.returnCreate.return.id })).returnClose.userErrors[0].code).toBe('INVALID_STATE');
  });

  it('a requested return waits for approval; restocking is a choice', async () => {
    const order = await newOrder('JPG-50', 3);
    await createFulfillment(db(), shopId, order.id, {});
    const [line] = await db().select().from(s.orderLines).where(eq(s.orderLines.orderId, order.id));
    const level = await stock('JPG-50');
    const lineGid = gid('LineItem', line!.id);
    const req = await g(`mutation($o: ID!, $l: ID!) { returnRequest(input: { orderId: $o, returnLineItems: [{ fulfillmentLineItemId: $l, quantity: 2, customerNote: "too big", returnReason: SIZE_TOO_LARGE }] }) { return { id status order { returnStatus } } userErrors { message } } }`, { o: gid('Order', order.id), l: lineGid });
    expect(req.returnRequest.return).toMatchObject({ status: 'REQUESTED', order: { returnStatus: 'RETURN_REQUESTED' } });
    const id = req.returnRequest.return.id;
    expect((await g(`mutation($id: ID!) { returnClose(id: $id) { userErrors { code } } }`, { id })).returnClose.userErrors[0].code).toBe('INVALID_STATE');
    const approved = await g(`mutation($id: ID!) { returnApproveRequest(input: { id: $id }) { return { status requestApprovedAt } userErrors { message } } }`, { id });
    expect(approved.returnApproveRequest.return.status).toBe('OPEN');
    expect((await stock('JPG-50')).available).toBe(level.available);
    await g(`mutation($id: ID!) { returnClose(id: $id) { return { status } } }`, { id });
    expect((await stock('JPG-50')).available).toBe(level.available + 2); // requests restock by default

    const keep = await g(`mutation($o: ID!, $l: ID!) { returnCreate(returnInput: { orderId: $o, returnLineItems: [{ fulfillmentLineItemId: $l, quantity: 1, shopmeRestock: false }] }) { return { id name } userErrors { message } } }`, { o: gid('Order', order.id), l: lineGid });
    expect(keep.returnCreate.return.name).toBe(`${order.name}-R2`);
    await g(`mutation($id: ID!) { returnClose(id: $id) { return { status } } }`, { id: keep.returnCreate.return.id });
    expect((await stock('JPG-50')).available).toBe(level.available + 2); // no restock requested for the second one
    const lines = await g(`query($o: ID!) { order(id: $o) { lineItems(first: 5) { nodes { shopmeReturnableQuantity } } returns(first: 5) { nodes { name } } } }`, { o: gid('Order', order.id) });
    expect(lines.order.lineItems.nodes[0].shopmeReturnableQuantity).toBe(0);
    expect(lines.order.returns.nodes).toHaveLength(2);
  });
});

describe('automatic discounts, BXGY and combinations', () => {
  const cartTotals = async (variant: string, quantity: number, cookies?: Record<string, string>) => {
    const add = await t.app.inject({ method: 'POST', url: '/cart/add.js', payload: { id: sku[variant], quantity }, cookies });
    return t.app.inject({ url: '/cart.js', cookies: { cart: add.cookies.find((c) => c.name === 'cart')?.value ?? cookies!.cart! } });
  };
  const NODE = `automaticDiscount { __typename ... on DiscountAutomaticBasic { title status summary combinesWith { orderDiscounts productDiscounts shippingDiscounts } } ... on DiscountAutomaticBxgy { title summary usesPerOrderLimit customerBuys { value { __typename ... on DiscountQuantity { quantity } } } customerGets { value { __typename ... on DiscountOnQuantity { quantity { quantity } effect { __typename ... on DiscountPercentage { percentage } } } } } } ... on DiscountAutomaticFreeShipping { title } }`;
  const disableAutomatic = async () => { await db().update(s.discounts).set({ status: 'DISABLED' }).where(eq(s.discounts.kind, 'AUTOMATIC')); };

  it('automatic basic discount applies to the cart without a code, lists and updates', async () => {
    const r = await g(`mutation { discountAutomaticBasicCreate(automaticBasicDiscount: { title: "Summer 10", startsAt: "2020-01-01T00:00:00Z", customerGets: { value: { percentage: 0.1 }, items: { all: true } } }) { automaticDiscountNode { id ${NODE} } userErrors { field message } } }`);
    expect(r.discountAutomaticBasicCreate.userErrors).toEqual([]);
    const node = r.discountAutomaticBasicCreate.automaticDiscountNode;
    expect(node.automaticDiscount).toMatchObject({ __typename: 'DiscountAutomaticBasic', title: 'Summer 10', status: 'ACTIVE', summary: expect.stringContaining('10% off') });
    const c = (await cartTotals('HEB-250', 2)).json();
    expect(c).toMatchObject({ original_total_price: 2600, total_discount: 260, total_price: 2340 });
    expect(c.cart_level_discount_applications[0]).toMatchObject({ type: 'automatic', title: 'Summer 10' });

    const list = await g(`{ automaticDiscountNodes(first: 5) { nodes { id } } discountNodes(first: 20, query: "method:automatic") { nodes { id discount { __typename } } } discountNodesCount { count } }`);
    expect(list.automaticDiscountNodes.nodes).toEqual([{ id: node.id }]);
    expect(list.discountNodes.nodes).toEqual([{ id: node.id, discount: { __typename: 'DiscountAutomaticBasic' } }]);
    expect(list.discountNodesCount.count).toBeGreaterThan(1); // codes and automatic
    expect((await g(`{ codeDiscountNodes(first: 20) { nodes { id } } }`)).codeDiscountNodes.nodes.every((n: { id: string }) => n.id.includes('DiscountCodeNode'))).toBe(true);

    const up = await g(`mutation($id: ID!) { discountAutomaticBasicUpdate(id: $id, automaticBasicDiscount: { customerGets: { value: { percentage: 0.2 }, items: { all: true } }, combinesWith: { shippingDiscounts: true } }) { automaticDiscountNode { id ${NODE} } userErrors { message } } }`, { id: node.id });
    expect(up.discountAutomaticBasicUpdate.automaticDiscountNode.automaticDiscount).toMatchObject({ summary: expect.stringContaining('20% off'), combinesWith: { shippingDiscounts: true, orderDiscounts: false } });
    expect((await cartTotals('HEB-250', 2)).json().total_discount).toBe(520);

    // a code discount of the same class cannot be stacked unless combinations allow it
    await g(`mutation($id: ID!) { discountAutomaticDeactivate(id: $id) { automaticDiscountNode { automaticDiscount { ... on DiscountAutomaticBasic { status } } } } }`, { id: node.id });
    expect((await cartTotals('HEB-250', 2)).json().total_discount).toBe(0);
    const del = await g(`mutation($id: ID!) { discountAutomaticDelete(id: $id) { deletedAutomaticDiscountId userErrors { message } } }`, { id: node.id });
    expect(del.discountAutomaticDelete).toEqual({ deletedAutomaticDiscountId: node.id, userErrors: [] });
    expect((await g(`{ automaticDiscountNodes(first: 5) { nodes { id } } }`)).automaticDiscountNodes.nodes).toEqual([]);
  });

  it('automatic buy X get Y: validation, cart application, free shipping', async () => {
    const heb = (await db().select().from(s.productVariants).where(eq(s.productVariants.id, sku['HEB-250']!)))[0]!.productId;
    const bad = await g(`mutation { discountAutomaticBxgyCreate(automaticBxgyDiscount: { title: "bad", customerBuys: { value: { quantity: "0" }, items: { products: { productsToAdd: ["gid://shopify/Product/${heb}"] } } }, customerGets: { value: { discountOnQuantity: { quantity: "1", effect: { percentage: 1 } } }, items: { products: { productsToAdd: ["gid://shopify/Product/${heb}"] } } } }) { automaticDiscountNode { id } userErrors { field message code } } }`);
    expect(bad.discountAutomaticBxgyCreate.automaticDiscountNode).toBeNull();
    expect(bad.discountAutomaticBxgyCreate.userErrors[0]).toMatchObject({ code: 'GREATER_THAN' });

    const r = await g(`mutation { discountAutomaticBxgyCreate(automaticBxgyDiscount: { title: "Buy 2 get 1", startsAt: "2020-01-01T00:00:00Z", usesPerOrderLimit: "1",
      customerBuys: { value: { quantity: "2" }, items: { products: { productsToAdd: ["gid://shopify/Product/${heb}"] } } },
      customerGets: { value: { discountOnQuantity: { quantity: "1", effect: { percentage: 1 } } }, items: { products: { productsToAdd: ["gid://shopify/Product/${heb}"] } } } }) { automaticDiscountNode { id ${NODE} } userErrors { field message } } }`);
    expect(r.discountAutomaticBxgyCreate.userErrors).toEqual([]);
    expect(r.discountAutomaticBxgyCreate.automaticDiscountNode.automaticDiscount).toMatchObject({
      __typename: 'DiscountAutomaticBxgy', summary: 'Buy 2, get 1 free', usesPerOrderLimit: '1',
      customerBuys: { value: { __typename: 'DiscountQuantity', quantity: '2' } },
      customerGets: { value: { __typename: 'DiscountOnQuantity', quantity: { quantity: '1' }, effect: { __typename: 'DiscountPercentage', percentage: 1 } } },
    });
    expect((await cartTotals('HEB-250', 2)).json().total_discount).toBe(0); // buy 2 get 1 in the same product needs 3 units
    const three = (await cartTotals('HEB-250', 3)).json();
    expect(three).toMatchObject({ original_total_price: 3900, total_discount: 1300, total_price: 2600 });
    expect((await cartTotals('HEB-250', 6)).json().total_discount).toBe(1300); // one use per order
    await disableAutomatic();

    const fs = await g(`mutation { discountAutomaticFreeShippingCreate(freeShippingAutomaticDiscount: { title: "Free shipping", startsAt: "2020-01-01T00:00:00Z", minimumRequirement: { subtotal: { greaterThanOrEqualToSubtotal: "20" } } }) { automaticDiscountNode { id ${NODE} } userErrors { message } } }`);
    expect(fs.discountAutomaticFreeShippingCreate.automaticDiscountNode.automaticDiscount).toMatchObject({ __typename: 'DiscountAutomaticFreeShipping', title: 'Free shipping' });
    const { token } = await startCheckout('HEB-250', 2);
    const co = (await refresh(token, ADDRESS)).json();
    expect(co.amount).toBe(2600 + 520); // 26.00 + 20% VAT, shipping free
    await disableAutomatic();
  });

  it('code BXGY, and combination rules decide which codes stack', async () => {
    const jpg = (await db().select().from(s.productVariants).where(eq(s.productVariants.id, sku['JPG-50']!)))[0]!.productId;
    const heb = (await db().select().from(s.productVariants).where(eq(s.productVariants.id, sku['HEB-250']!)))[0]!.productId;
    const r = await g(`mutation { discountCodeBxgyCreate(bxgyCodeDiscount: { title: "BXGY", code: "BUY1GET1", startsAt: "2020-01-01T00:00:00Z",
      customerBuys: { value: { quantity: "1" }, items: { products: { productsToAdd: ["gid://shopify/Product/${heb}"] } } },
      customerGets: { value: { discountOnQuantity: { quantity: "1", effect: { percentage: 0.5 } } }, items: { products: { productsToAdd: ["gid://shopify/Product/${jpg}"] } } } }) {
      codeDiscountNode { id codeDiscount { __typename ... on DiscountCodeBxgy { summary codes(first: 1) { nodes { code } } } } } userErrors { field message } } }`);
    expect(r.discountCodeBxgyCreate.userErrors).toEqual([]);
    expect(r.discountCodeBxgyCreate.codeDiscountNode.codeDiscount).toMatchObject({ __typename: 'DiscountCodeBxgy', summary: 'Buy 1, get 1 at 50% off', codes: { nodes: [{ code: 'BUY1GET1' }] } });

    const add1 = await t.app.inject({ method: 'POST', url: '/cart/add.js', payload: { id: sku['HEB-250'], quantity: 1 } });
    const cart = add1.cookies.find((c) => c.name === 'cart')!.value;
    await t.app.inject({ method: 'POST', url: '/cart/add.js', payload: { id: sku['JPG-50'], quantity: 1 }, cookies: { cart } });
    const { token } = await (async () => { const go = await t.app.inject({ method: 'POST', url: '/checkout', cookies: { cart } }); return { token: go.headers.location!.toString().split('/').pop()! }; })();
    const on = (await refresh(token, { ...ADDRESS, addDiscountCode: 'BUY1GET1' })).json();
    expect(on.discountError).toBe('');
    expect(on.summary).toContain('-€5.50'); // half of the 11.00 product

    // WELCOME10 is an order discount: it does not combine with the BXGY code (combinations default to none)
    const second = (await refresh(token, { ...ADDRESS, addDiscountCode: 'WELCOME10' })).json();
    expect(second.discountError).toMatch(/cannot be combined/);

    // allow product + order discounts on both and the second code is accepted; the product discount applies first
    const ids = (await db().select({ id: s.discountCodes.discountId, code: s.discountCodes.code }).from(s.discountCodes)).filter((x) => ['WELCOME10', 'BUY1GET1'].includes(x.code));
    await g(`mutation($id: ID!) { discountCodeBxgyUpdate(id: $id, bxgyCodeDiscount: { combinesWith: { orderDiscounts: true } }) { userErrors { message } } }`, { id: gid('DiscountCodeNode', ids.find((x) => x.code === 'BUY1GET1')!.id) });
    const welcome = await g(`mutation($id: ID!) { discountCodeBasicUpdate(id: $id, basicCodeDiscount: { combinesWith: { productDiscounts: true } }) { userErrors { message } } }`, { id: gid('DiscountCodeNode', ids.find((x) => x.code === 'WELCOME10')!.id) });
    expect(welcome.discountCodeBasicUpdate.userErrors).toEqual([]);
    const both = (await refresh(token, { ...ADDRESS, addDiscountCode: 'WELCOME10' })).json();
    expect(both.discountError).toBe('');
    const [cartRow] = await db().select().from(s.carts).where(eq(s.carts.token, token));
    expect(cartRow!.discountCodes.map((c) => c.toUpperCase()).sort()).toEqual(['BUY1GET1', 'WELCOME10']);
    // (13.00 + 11.00 - 5.50) = 18.50, then 10% = 1.85: total = 16.65 + shipping 4.90, + 20% VAT
    expect(both.amount).toBe(Math.round((1665 + 490) * 1.2));
    const readBack = await g(`query($id: ID!) { codeDiscountNode(id: $id) { codeDiscount { ... on DiscountCodeBasic { combinesWith { productDiscounts orderDiscounts } } } } }`, { id: gid('DiscountCodeNode', ids.find((x) => x.code === 'WELCOME10')!.id) });
    expect(readBack.codeDiscountNode.codeDiscount.combinesWith).toEqual({ productDiscounts: true, orderDiscounts: false });
    const latest = await db().select().from(s.discounts).orderBy(desc(s.discounts.id)).limit(1);
    expect(latest).toHaveLength(1);
  });
});
