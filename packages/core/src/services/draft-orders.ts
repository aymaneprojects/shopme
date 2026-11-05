import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { taxExtrasFor } from './settings/tax-presets';
import { customers, draftOrders, inventoryItems, markets, media, orders, productMedia, productVariants, products, taxRates, type DraftAddress, type DraftCalc, type DraftDiscount, type DraftLine } from '../db/schema';
import type { Db, Executor } from '../db/client';
import { listNotificationTemplates, moneyOf, renderNotification, senderOf, shopUrl } from '../mail/notifications';
import type { Mailer } from '../mail';
import { buildSearch, idTerm, likeCi } from './catalog/search';
import { errR, normalizeTags, okR, type Result } from './catalog/common';
import { addEvent } from './events';
import { createOrder, type CheckoutAddressInput } from './orders/create';
import { priceCheckout, type PricingDiscount, type PricingInput, type PricingResult } from './pricing';
import { randomToken } from './crypto';
import { nextSequence } from './sequences';
import type { Shop } from './shops';
import { getOrder } from './orders/orders';

export type DraftOrder = typeof draftOrders.$inferSelect;
export type { DraftAddress, DraftCalc, DraftDiscount, DraftLine };

export interface DraftLineInput {
  variantId?: number | null; title?: string | null; /** Minor units. Overrides the variant price when given. */ originalUnitPrice?: number | null; quantity: number;
  sku?: string | null; taxable?: boolean | null; requiresShipping?: boolean | null; grams?: number | null; discount?: DraftDiscount | null; properties?: Record<string, string> | null; uuid?: string | null;
}
export interface DraftInput {
  email?: string | null; phone?: string | null; note?: string | null; tags?: string[] | null; customerId?: number | null; taxExempt?: boolean | null;
  lines?: DraftLineInput[] | null; appliedDiscount?: DraftDiscount | null; shippingLine?: { title: string; price: number } | null;
  shippingAddress?: DraftAddress | null; billingAddress?: DraftAddress | null;
  poNumber?: string | null; /** Market the draft is sold in (null: none). */ marketId?: number | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_LINES = 499;
const GRAMS: Record<string, number> = { GRAMS: 1, KILOGRAMS: 1000, POUNDS: 453.59237, OUNCES: 28.349523125 };

function checkDiscount(d: DraftDiscount | null | undefined, path: string[]): Result<null> {
  if (!d) return okR(null);
  if (!(d.value >= 0) || (d.valueType === 'PERCENTAGE' && d.value > 100)) return errR(path, 'Discount value is invalid', 'INVALID');
  return okR(null);
}

/** Resolve inputs into stored lines: variants are read from the catalog (price overridable), custom items need a title. */
export async function resolveDraftLines(db: Executor, shopId: number, inputs: DraftLineInput[]): Promise<Result<DraftLine[]>> {
  if (inputs.length > MAX_LINES) return errR(['lineItems'], `Too many line items (maximum is ${MAX_LINES})`, 'INVALID');
  const ids = [...new Set(inputs.flatMap((l) => (l.variantId ? [l.variantId] : [])))];
  const vs = ids.length ? await db.select({ v: productVariants, p: products, i: inventoryItems }).from(productVariants).innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(inventoryItems, eq(inventoryItems.variantId, productVariants.id)).where(and(eq(productVariants.shopId, shopId), inArray(productVariants.id, ids))) : [];
  const imgs = vs.length ? await db.select({ productId: productMedia.productId, url: media.url }).from(productMedia).innerJoin(media, eq(media.id, productMedia.mediaId))
    .where(inArray(productMedia.productId, [...new Set(vs.map((x) => x.p.id))])).orderBy(asc(productMedia.position)) : [];
  const out: DraftLine[] = [];
  for (const [i, l] of inputs.entries()) {
    const path = ['lineItems', String(i)];
    if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 100_000) return errR([...path, 'quantity'], 'Quantity must be between 1 and 100000', 'INVALID');
    const d = checkDiscount(l.discount, [...path, 'appliedDiscount']);
    if (!d.ok) return d;
    if (l.originalUnitPrice != null && l.originalUnitPrice < 0) return errR([...path, 'originalUnitPrice'], 'Price cannot be negative', 'INVALID');
    const base = { uuid: l.uuid || randomUUID(), quantity: l.quantity, discount: l.discount ?? null, properties: l.properties ?? {} };
    if (l.variantId) {
      const x = vs.find((r) => r.v.id === l.variantId);
      if (!x) return errR([...path, 'variantId'], 'Product variant does not exist', 'NOT_FOUND');
      out.push({
        ...base, variantId: x.v.id, productId: x.p.id, title: x.p.title, variantTitle: x.v.title === 'Default Title' ? null : x.v.title, sku: x.v.sku, vendor: x.p.vendor || null,
        imageUrl: imgs.find((m) => m.productId === x.p.id)?.url ?? null, unitPrice: l.originalUnitPrice ?? x.v.price, taxable: x.v.taxable, requiresShipping: x.i?.requiresShipping ?? true,
        grams: Math.round((x.i?.weightValue ?? 0) * (GRAMS[x.i?.weightUnit ?? 'GRAMS'] ?? 1)),
      });
    } else {
      if (!l.title?.trim()) return errR([...path, 'title'], 'Custom items need a title', 'BLANK');
      if (l.originalUnitPrice == null) return errR([...path, 'originalUnitPrice'], 'Custom items need a price', 'BLANK');
      out.push({ ...base, variantId: null, productId: null, title: l.title.trim().slice(0, 255), variantTitle: null, sku: l.sku ?? null, vendor: null, imageUrl: null, unitPrice: l.originalUnitPrice, taxable: l.taxable ?? true, requiresShipping: l.requiresShipping ?? false, grams: l.grams ?? 0 });
    }
  }
  return okR(out);
}

type Priceable = Pick<DraftOrder, 'lines' | 'appliedDiscount' | 'shippingLine' | 'shippingAddress' | 'billingAddress' | 'taxExempt' | 'customerId'>;

/** Price a draft with the checkout engine: line discounts, then the order discount, custom shipping, taxes of the destination country. */
export async function priceDraft(db: Executor, shop: Shop, d: Priceable): Promise<{ pricing: PricingResult; calc: DraftCalc }> {
  const lines = d.lines.map((l, i) => ({ id: i + 1, unitPrice: l.unitPrice, quantity: l.quantity, taxable: l.taxable, requiresShipping: l.requiresShipping, grams: l.grams * l.quantity, productId: l.productId ?? 0, collectionIds: [] as number[] }));
  const value = (x: DraftDiscount) => (x.valueType === 'PERCENTAGE' ? Math.round(x.value * 100) : Math.round(x.value));
  const discounts: PricingDiscount[] = [];
  d.lines.forEach((l, i) => { if (l.discount) discounts.push({ id: 0, code: null, title: l.discount.title ?? l.discount.description ?? 'Custom discount', valueType: l.discount.valueType, value: value(l.discount), target: 'PRODUCTS', appliesTo: { lineIds: [i + 1] } }); });
  if (d.appliedDiscount) discounts.push({ id: 0, code: null, title: d.appliedDiscount.title ?? d.appliedDiscount.description ?? 'Custom discount', valueType: d.appliedDiscount.valueType, value: value(d.appliedDiscount), target: 'ORDER', appliesTo: {} });
  const addr = (d.shippingAddress ?? d.billingAddress ?? null) as DraftAddress | null;
  const country = addr?.countryCode?.toUpperCase() ?? null;
  const rates = country ? await db.select().from(taxRates).where(and(eq(taxRates.shopId, shop.id), eq(taxRates.active, true), eq(taxRates.countryCode, country))) : [];
  let exempt = d.taxExempt;
  if (d.customerId && !exempt) exempt = !!(await db.select({ t: customers.taxExempt }).from(customers).where(eq(customers.id, d.customerId)).limit(1))[0]?.t;
  const input: PricingInput = {
    lines, discounts, shipping: d.shippingLine ? { id: 0, name: d.shippingLine.title, price: d.shippingLine.price } : null,
    taxRates: rates.map((r) => ({ name: r.name, countryCode: r.countryCode, provinceCode: r.provinceCode, rate: r.rate, appliesToShipping: r.appliesToShipping, priority: r.priority })),
    taxesIncluded: shop.taxesIncluded, taxExempt: exempt, ...taxExtrasFor(shop, country), country, province: addr?.provinceCode ?? null,
  };
  const pricing = priceCheckout(input);
  // Applications follow the order of `discounts`: line discounts (in line order), then the order discount.
  const lineDiscounts = new Map<number, number>();
  let k = 0;
  d.lines.forEach((l, i) => { if (l.discount) lineDiscounts.set(i, pricing.discountApplications[k++]?.allocated ?? 0); });
  const calc: DraftCalc = {
    lines: pricing.lines.map((p, i) => ({ uuid: d.lines[i]!.uuid, subtotal: p.subtotal, discount: p.discount, lineDiscount: lineDiscounts.get(i) ?? 0, total: p.total, tax: p.tax })),
    orderDiscount: d.appliedDiscount ? pricing.discountApplications[k]?.allocated ?? 0 : 0,
    taxLines: pricing.taxLines.map((t) => ({ title: t.title, rate: t.rate, price: t.price })),
  };
  return { pricing, calc };
}

const money = (p: PricingResult) => ({ subtotal: p.subtotal, totalDiscounts: p.totalDiscounts, totalShipping: p.totalShipping, totalTax: p.totalTax, total: p.total });

/** Validate an input and turn it into the fields of a draft (shared by create, update and calculate). */
async function build(db: Executor, shop: Shop, input: DraftInput, cur?: DraftOrder): Promise<Result<Omit<typeof draftOrders.$inferInsert, 'shopId' | 'name' | 'token' | 'currency'>>> {
  const email = input.email !== undefined ? input.email?.trim().toLowerCase() || null : cur?.email ?? null;
  if (email && !EMAIL_RE.test(email)) return errR(['email'], 'Email is invalid', 'INVALID');
  let customerId = input.customerId !== undefined ? input.customerId : cur?.customerId ?? null;
  let resolvedEmail = email;
  if (customerId) {
    const [c] = await db.select().from(customers).where(and(eq(customers.shopId, shop.id), eq(customers.id, customerId))).limit(1);
    if (!c) return errR(['customerId'], 'Customer does not exist', 'NOT_FOUND');
    resolvedEmail = email ?? c.email;
  } else if (email) {
    customerId = (await db.select({ id: customers.id }).from(customers).where(and(eq(customers.shopId, shop.id), eq(customers.email, email))).limit(1))[0]?.id ?? null;
  }
  let lines = cur?.lines ?? [];
  if (input.lines != null) {
    const r = await resolveDraftLines(db, shop.id, input.lines);
    if (!r.ok) return r;
    lines = r.value;
  }
  const applied = input.appliedDiscount !== undefined ? input.appliedDiscount : cur?.appliedDiscount ?? null;
  const dd = checkDiscount(applied, ['appliedDiscount']);
  if (!dd.ok) return dd;
  const shippingLine = input.shippingLine !== undefined ? input.shippingLine : cur?.shippingLine ?? null;
  if (shippingLine && !(shippingLine.price >= 0)) return errR(['shippingLine', 'price'], 'Shipping price is invalid', 'INVALID');
  const marketId = input.marketId !== undefined ? input.marketId : cur?.marketId ?? null;
  let presentmentCurrency: string | null = null;
  if (marketId != null) {
    const [m] = await db.select().from(markets).where(and(eq(markets.shopId, shop.id), eq(markets.id, marketId))).limit(1);
    if (!m) return errR(['marketId'], 'Market does not exist', 'NOT_FOUND');
    presentmentCurrency = m.currencyCode ?? shop.currency;
  }
  const poNumber = input.poNumber !== undefined ? input.poNumber?.trim().slice(0, 100) || null : cur?.poNumber ?? null;
  const f = {
    marketId, presentmentCurrency, poNumber,
    email: resolvedEmail, customerId, lines, appliedDiscount: applied, shippingLine,
    phone: input.phone !== undefined ? input.phone : cur?.phone ?? null, note: input.note !== undefined ? input.note : cur?.note ?? null,
    tags: input.tags != null ? normalizeTags(input.tags) : cur?.tags ?? [], taxExempt: input.taxExempt ?? cur?.taxExempt ?? false,
    shippingAddress: input.shippingAddress !== undefined ? input.shippingAddress : cur?.shippingAddress ?? null,
    billingAddress: input.billingAddress !== undefined ? input.billingAddress : cur?.billingAddress ?? null,
  };
  const { pricing, calc } = await priceDraft(db, shop, f as Priceable);
  return okR({ ...f, ...money(pricing), calc });
}

export async function createDraftOrder(db: Db, shop: Shop, input: DraftInput, staffId?: number | null): Promise<Result<DraftOrder>> {
  const b = await build(db, shop, input);
  if (!b.ok) return b;
  if (!b.value.lines || (b.value.lines as DraftLine[]).length === 0) return errR(['lineItems'], 'Add at least 1 product', 'INVALID');
  const row = await db.transaction(async (tx) => {
    const n = await nextSequence(tx, shop.id, 'draft_order', 1);
    const [r] = await tx.insert(draftOrders).values({ ...b.value, shopId: shop.id, name: `#D${n}`, token: randomToken(24), currency: shop.currency }).returning();
    await addEvent(tx, shop.id, { subjectType: 'draft_order', subjectId: r!.id, verb: 'draft_orders/create', message: `Draft order ${r!.name} was created`, authorStaffUserId: staffId });
    return r!;
  });
  return okR(row);
}

export async function getDraftOrder(db: Executor, shopId: number, id: number): Promise<DraftOrder | null> {
  return (await db.select().from(draftOrders).where(and(eq(draftOrders.shopId, shopId), eq(draftOrders.id, id))).limit(1))[0] ?? null;
}
export async function getDraftOrderByToken(db: Executor, token: string): Promise<DraftOrder | null> {
  return (await db.select().from(draftOrders).where(eq(draftOrders.token, token)).limit(1))[0] ?? null;
}

export async function updateDraftOrder(db: Db, shop: Shop, id: number, input: DraftInput, staffId?: number | null): Promise<Result<DraftOrder>> {
  const cur = await getDraftOrder(db, shop.id, id);
  if (!cur) return errR(['id'], 'Draft order does not exist', 'NOT_FOUND');
  if (cur.status === 'COMPLETED') return errR(['id'], 'Completed draft orders cannot be edited', 'INVALID');
  const b = await build(db, shop, input, cur);
  if (!b.ok) return b;
  if (!(b.value.lines as DraftLine[]).length) return errR(['lineItems'], 'Add at least 1 product', 'INVALID');
  const [row] = await db.update(draftOrders).set({ ...b.value, updatedAt: new Date() }).where(eq(draftOrders.id, id)).returning();
  await addEvent(db, shop.id, { subjectType: 'draft_order', subjectId: id, verb: 'draft_orders/update', message: `Draft order ${cur.name} was updated`, authorStaffUserId: staffId });
  return okR(row!);
}

export async function deleteDraftOrder(db: Db, shopId: number, id: number, staffId?: number | null): Promise<Result<number>> {
  const cur = await getDraftOrder(db, shopId, id);
  if (!cur) return errR(['id'], 'Draft order does not exist', 'NOT_FOUND');
  await db.delete(draftOrders).where(eq(draftOrders.id, id));
  await addEvent(db, shopId, { subjectType: 'draft_order', subjectId: id, verb: 'draft_orders/delete', message: `Draft order ${cur.name} was deleted`, authorStaffUserId: staffId });
  return okR(id);
}

/** Price an input without saving it (`draftOrderCalculate`). */
export async function calculateDraftOrder(db: Executor, shop: Shop, input: DraftInput): Promise<Result<{ draft: Priceable & { email: string | null; currency: string }; pricing: PricingResult; calc: DraftCalc }>> {
  const b = await build(db, shop, input);
  if (!b.ok) return b;
  const draft = { ...b.value, currency: shop.currency } as never as Priceable & { email: string | null; currency: string };
  const { pricing, calc } = await priceDraft(db, shop, draft);
  return okR({ draft, pricing, calc });
}

export const draftSearch = (q: string | null | undefined) => buildSearch(q, {
  fields: {
    id: (_o, v) => idTerm(draftOrders.id, v),
    name: (_o, v) => likeCi(draftOrders.name, v.replace(/^#/, '')),
    email: (_o, v) => likeCi(draftOrders.email, v, true),
    status: (_o, v) => sql`${draftOrders.status} = ${v.toUpperCase()}`,
    tag: (_o, v) => sql`exists (select 1 from unnest(${draftOrders.tags}) t where lower(t) = ${v.toLowerCase()})`,
    customer_id: (_o, v) => idTerm(draftOrders.customerId, v),
    po_number: (_o, v) => likeCi(draftOrders.poNumber, v, true),
  },
  text: (v) => sql`(${draftOrders.name} ilike ${`%${v}%`} or ${draftOrders.email} ilike ${`%${v}%`} or ${draftOrders.poNumber} ilike ${`%${v}%`})`,
});

export function listDraftOrders(db: Executor, shopId: number, o: { query?: string | null; reverse?: boolean; offset: number; limit: number }) {
  return db.select().from(draftOrders).where(and(eq(draftOrders.shopId, shopId), draftSearch(o.query))).orderBy((o.reverse ? desc : asc)(draftOrders.id)).limit(o.limit).offset(o.offset);
}
export async function countDraftOrders(db: Executor, shopId: number, query?: string | null): Promise<number> {
  return (await db.select({ n: sql<number>`count(*)::int` }).from(draftOrders).where(and(eq(draftOrders.shopId, shopId), draftSearch(query))))[0]?.n ?? 0;
}

// ---- completing -------------------------------------------------------------------------------------------------------------

export type CompleteResult = Result<{ draft: DraftOrder; orderId: number }>;

/** Turn a draft into an order through the regular order creation (stock, customer, tax lines, discount lines, timeline). */
export async function completeDraftOrder(db: Db, shop: Shop, id: number, o: { paymentPending?: boolean; sourceName?: string; staffId?: number | null; draft?: DraftOrder } = {}): Promise<CompleteResult> {
  const d = o.draft ?? (await getDraftOrder(db, shop.id, id));
  if (!d || d.shopId !== shop.id) return errR(['id'], 'Draft order does not exist', 'NOT_FOUND');
  if (d.status === 'COMPLETED') return errR(['id'], 'Draft order is already completed', 'INVALID');
  if (!d.lines.length) return errR(['id'], 'Add at least 1 product', 'INVALID');
  if (!d.email || !EMAIL_RE.test(d.email)) return errR(['email'], 'An email address is required to complete the draft order', 'INVALID');
  const { pricing } = await priceDraft(db, shop, d);
  const toAddress = (a: DraftAddress | null): CheckoutAddressInput | null => (a ? { ...a } as CheckoutAddressInput : null);
  const res = await createOrder(db, shop.id, {
    email: d.email, phone: d.phone, currency: d.currency, taxesIncluded: shop.taxesIncluded, pricing, note: d.note, sourceName: o.sourceName ?? 'draft_order',
    lines: d.lines.map((l, i) => ({
      id: i + 1, unitPrice: l.unitPrice, quantity: l.quantity, taxable: l.taxable, requiresShipping: l.requiresShipping, grams: l.grams * l.quantity, productId: l.productId ?? 0, collectionIds: [],
      variantId: l.variantId, title: l.title, variantTitle: l.variantTitle, sku: l.sku, vendor: l.vendor, imageUrl: l.imageUrl, isGiftCard: false, properties: l.properties,
    })),
    shippingAddress: toAddress(d.shippingAddress), billingAddress: toAddress(d.billingAddress ?? d.shippingAddress),
    payment: { gateway: 'manual', status: o.paymentPending ? 'PENDING' : 'PAID' },
  });
  if (!res.ok) {
    return res.error === 'out_of_stock' ? errR(['lineItems'], 'Not enough stock for one or more items', 'OUT_OF_STOCK') : errR(['id'], 'Draft order could not be completed', 'INVALID');
  }
  const now = new Date();
  await db.update(orders).set({ tags: d.tags, poNumber: d.poNumber }).where(and(eq(orders.id, res.orderId), eq(orders.shopId, shop.id)));
  await addEvent(db, shop.id, { subjectType: 'order', subjectId: res.orderId, verb: 'order.from_draft', message: `Created from draft order ${d.name}` });
  const [row] = await db.update(draftOrders).set({ status: 'COMPLETED', completedAt: now, orderId: res.orderId, updatedAt: now, subtotal: pricing.subtotal, totalDiscounts: pricing.totalDiscounts, totalShipping: pricing.totalShipping, totalTax: pricing.totalTax, total: pricing.total })
    .where(eq(draftOrders.id, id)).returning();
  await addEvent(db, shop.id, { subjectType: 'draft_order', subjectId: id, verb: 'draft_orders/update', message: `Draft order ${d.name} was completed as ${res.name}`, authorStaffUserId: o.staffId });
  return okR({ draft: row!, orderId: res.orderId });
}

/** A cart opened from a draft's pay link was checked out: the draft is completed and linked to the order it produced. */
export async function completeDraftFromCheckout(db: Executor, shopId: number, draftId: number, orderId: number): Promise<void> {
  const now = new Date();
  const [row] = await db.update(draftOrders).set({ status: 'COMPLETED', completedAt: now, orderId, updatedAt: now })
    .where(and(eq(draftOrders.id, draftId), eq(draftOrders.shopId, shopId), ne(draftOrders.status, 'COMPLETED'))).returning({ name: draftOrders.name });
  if (row) await addEvent(db, shopId, { subjectType: 'draft_order', subjectId: draftId, verb: 'draft_orders/update', message: `Draft order ${row.name} was paid through its pay link` });
}

export const draftOrderOf = async (db: Executor, shopId: number, d: DraftOrder) => (d.orderId ? getOrder(db, shopId, d.orderId) : null);

// ---- invoice ----------------------------------------------------------------------------------------------------------------

export const draftInvoiceUrl = (shop: Shop, appUrl: string, d: Pick<DraftOrder, 'token'>) => `${shopUrl(shop, appUrl)}/draft_orders/${d.token}/pay`;

export async function renderDraftInvoice(db: Executor, shop: Shop, appUrl: string, d: DraftOrder, o: { subject?: string | null; customMessage?: string | null } = {}) {
  const m = (n: number) => moneyOf(shop, n, d.currency);
  const t = (await listNotificationTemplates(db, shop)).find((x) => x.key === 'draft_order_invoice')!;
  const vars = {
    draft: { name: d.name, subtotal: m(d.subtotal), total: m(d.total), line_items: d.lines.map((l) => ({ title: [l.title, l.variantTitle].filter(Boolean).join(' - '), quantity: l.quantity })) },
    invoice_url: draftInvoiceUrl(shop, appUrl, d), custom_message: o.customMessage?.trim() || null,
  };
  return renderNotification(db, shop, appUrl, 'draft_order_invoice', vars, { subject: o.subject?.trim() || t.subject, body: t.body });
}

export async function sendDraftInvoice(db: Db, mailer: Mailer, shop: Shop, appUrl: string, id: number, o: { to?: string | null; subject?: string | null; customMessage?: string | null; staffId?: number | null } = {}): Promise<Result<DraftOrder>> {
  const d = await getDraftOrder(db, shop.id, id);
  if (!d) return errR(['id'], 'Draft order does not exist', 'NOT_FOUND');
  if (d.status === 'COMPLETED') return errR(['id'], 'The draft order is already completed', 'INVALID');
  const to = (o.to ?? d.email)?.trim();
  if (!to || !EMAIL_RE.test(to)) return errR(['email', 'to'], "To can't be blank", 'BLANK');
  const r = await renderDraftInvoice(db, shop, appUrl, d, o);
  await mailer.send({ to, subject: r.subject, html: r.html, text: r.text, from: senderOf(shop), replyTo: shop.email });
  const [row] = await db.update(draftOrders).set({ status: 'INVOICE_SENT', invoiceSentAt: new Date(), updatedAt: new Date() }).where(eq(draftOrders.id, id)).returning();
  await addEvent(db, shop.id, { subjectType: 'draft_order', subjectId: id, verb: 'draft_orders/update', message: `Invoice sent to ${to}`, authorStaffUserId: o.staffId });
  return okR(row!);
}
