import { and, eq } from 'drizzle-orm';
import { orderDiscountApplications, orderEdits, orderLines, orderTaxLines, orders, taxRates, type StagedAddition, type StagedDiscount } from '../db/schema';
import type { Db, Executor } from '../db/client';
import { errR, okR, txResult, type Result } from './catalog/common';
import { addEvent } from './events';
import { resolveDraftLines } from './draft-orders';
import { commitStock } from './orders/create';
import { getOrder, getOrderDetail, paidAmounts, restockVariant, type Order, type OrderDetail, type OrderLine } from './orders/orders';
import { allocate, applicableTaxRates, priceCheckout, roundDiv } from './pricing';

export type OrderEdit = typeof orderEdits.$inferSelect;
export const ADDITION_ID_BASE = 900_000_000;

/** One line of the order as it would look after the edit. `orderLineId` is null for variants added by the session. */
export interface CalculatedLine {
  id: number; orderLineId: number | null; variantId: number | null; title: string; variantTitle: string | null; sku: string | null; imageUrl: string | null;
  unitPrice: number;
  /** Units on the order now (0 for additions). */
  quantityBefore: number;
  quantity: number;
  /** Units that cannot be removed (already fulfilled). */
  uneditable: number;
  /** Line total after discounts, tax excluded from the amount unless the order has tax-inclusive prices. */
  discountedTotal: number;
  tax: number;
  stagedDiscount: StagedDiscount | null;
  restock: boolean;
  /** Fields kept to write the line on commit. */
  base: { quantity: number; discountedTotal: number; totalTax: number; taxable: boolean; requiresShipping: boolean; grams: number; productId: number | null; vendor: string | null; properties: Record<string, string> } | null;
}

export interface CalculatedOrder {
  edit: OrderEdit;
  order: Order;
  lines: CalculatedLine[];
  subtotal: number;
  totalDiscounts: number;
  totalTax: number;
  total: number;
  /** Positive: payment due from the buyer. Negative: refund owed. */
  outstanding: number;
  received: number;
}

export async function getOrderEdit(db: Executor, shopId: number, id: number): Promise<OrderEdit | null> {
  const [e] = await db.select().from(orderEdits).where(and(eq(orderEdits.shopId, shopId), eq(orderEdits.id, id))).limit(1);
  return e ?? null;
}

export async function beginOrderEdit(db: Db, shopId: number, orderId: number, staffId?: number | null): Promise<Result<OrderEdit>> {
  const order = await getOrder(db, shopId, orderId);
  if (!order) return errR(['id'], 'Order does not exist', 'NOT_FOUND');
  if (order.cancelledAt) return errR(['id'], 'Cannot edit a cancelled order', 'INVALID');
  const [open] = await db.select().from(orderEdits).where(and(eq(orderEdits.orderId, orderId), eq(orderEdits.status, 'OPEN'))).limit(1);
  if (open) return okR(open);
  const [row] = await db.insert(orderEdits).values({ shopId, orderId, staffId: staffId ?? null }).returning();
  return okR(row!);
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const staged = (e: OrderEdit, lineId: number) => e.discounts.find((d) => d.lineId === lineId) ?? null;
const cut = (d: StagedDiscount, base: number) => Math.max(0, Math.min(base, d.valueType === 'PERCENTAGE' ? roundDiv(base * Math.round(d.value * 100), 10_000) : d.value));

/**
 * The order as the session would leave it. Existing lines keep their per-unit discounted price and tax; added variants are priced
 * with the checkout engine against the order's destination and tax rates; a staged line discount reduces the line after that.
 */
export async function calculateOrderEdit(db: Executor, shopId: number, edit: OrderEdit): Promise<CalculatedOrder> {
  const order = (await getOrder(db, shopId, edit.orderId))!;
  const d = await getOrderDetail(db, shopId, edit.orderId);
  const lines: CalculatedLine[] = d.lines.map((l) => {
    const want = edit.quantities[String(l.id)];
    const quantity = Math.max(l.fulfilledQuantity, want ?? l.currentQuantity);
    const per = (n: number) => (l.quantity > 0 ? roundDiv(n * quantity, l.quantity) : 0);
    let discountedTotal = quantity === l.currentQuantity ? l.discountedTotal : per(l.discountedTotal);
    let tax = quantity === l.currentQuantity ? l.totalTax : per(l.totalTax);
    const sd = staged(edit, l.id);
    if (sd && quantity > 0) {
      const after = discountedTotal - cut(sd, discountedTotal);
      tax = discountedTotal > 0 ? roundDiv(tax * after, discountedTotal) : 0;
      discountedTotal = after;
    }
    return {
      id: l.id, orderLineId: l.id, variantId: l.variantId, title: l.title, variantTitle: l.variantTitle, sku: l.sku, imageUrl: l.imageUrl, unitPrice: l.unitPrice, quantityBefore: l.currentQuantity,
      quantity, uneditable: l.fulfilledQuantity, discountedTotal, tax, stagedDiscount: sd, restock: !edit.noRestock[String(l.id)],
      base: { quantity: l.quantity, discountedTotal: l.discountedTotal, totalTax: l.totalTax, taxable: l.taxable, requiresShipping: l.requiresShipping, grams: l.weightGrams ?? 0, productId: l.productId, vendor: l.vendor, properties: l.properties },
    };
  });

  const adds = edit.additions.filter((a) => a.quantity > 0);
  if (adds.length) {
    const resolved = await resolveDraftLines(db, shopId, adds.map((a) => ({ variantId: a.variantId, quantity: a.quantity })));
    if (resolved.ok) {
      const ship = d.shippingAddress;
      const rates = ship?.countryCode ? await db.select().from(taxRates).where(and(eq(taxRates.shopId, shopId), eq(taxRates.active, true), eq(taxRates.countryCode, ship.countryCode.toUpperCase()))) : [];
      const pl = resolved.value.map((l, i) => ({ id: adds[i]!.id, unitPrice: l.unitPrice, quantity: l.quantity, taxable: l.taxable, requiresShipping: l.requiresShipping, grams: l.grams * l.quantity, productId: l.productId ?? 0, collectionIds: [] }));
      const priced = priceCheckout({
        lines: pl, taxesIncluded: order.taxesIncluded, shipping: null, country: ship?.countryCode ?? null, province: ship?.provinceCode ?? null,
        taxRates: applicableTaxRates(rates.map((r) => ({ name: r.name, countryCode: r.countryCode, provinceCode: r.provinceCode, rate: r.rate, appliesToShipping: r.appliesToShipping, priority: r.priority })), ship?.countryCode ?? null, ship?.provinceCode ?? null),
        discounts: adds.flatMap((a) => { const sd = staged(edit, a.id); return sd ? [{ id: 0, code: null, title: sd.description ?? 'Custom discount', valueType: sd.valueType, value: sd.valueType === 'PERCENTAGE' ? Math.round(sd.value * 100) : sd.value, target: 'PRODUCTS' as const, appliesTo: { lineIds: [a.id] } }] : []; }),
      });
      resolved.value.forEach((l, i) => {
        const a = adds[i]!; const p = priced.lines.find((x) => x.id === a.id)!;
        lines.push({
          id: a.id, orderLineId: null, variantId: a.variantId, title: l.title, variantTitle: l.variantTitle, sku: l.sku, imageUrl: l.imageUrl, unitPrice: l.unitPrice, quantityBefore: 0, quantity: a.quantity, uneditable: 0,
          discountedTotal: p.total, tax: p.tax, stagedDiscount: staged(edit, a.id), restock: true,
          base: { quantity: 0, discountedTotal: 0, totalTax: 0, taxable: l.taxable, requiresShipping: l.requiresShipping, grams: l.grams, productId: l.productId, vendor: l.vendor, properties: {} },
        });
      });
    }
  }

  const lineDiscount = (l: CalculatedLine) => l.unitPrice * l.quantity - l.discountedTotal;
  const subtotal = sum(lines.map((l) => l.unitPrice * l.quantity));
  const oldLineDiscounts = sum(d.lines.map((l) => l.unitPrice * l.quantity - l.discountedTotal));
  const totalDiscounts = Math.max(0, order.totalDiscounts - oldLineDiscounts) + sum(lines.map(lineDiscount));
  const totalTax = sum(lines.map((l) => l.tax)) + sum(d.shippingLines.map((s) => s.tax));
  const total = sum(lines.map((l) => l.discountedTotal)) + order.totalShipping + (order.taxesIncluded ? 0 : totalTax);
  const { received, refunded } = paidAmounts(d.transactions);
  return { edit, order, lines, subtotal, totalDiscounts, totalTax, total, received, outstanding: total - (received - refunded) };
}

const editable = (e: OrderEdit | null): e is OrderEdit => !!e && e.status === 'OPEN';
const notOpen = () => errR(['id'], 'Order edit session is no longer open', 'INVALID');

async function save(db: Executor, e: OrderEdit, patch: Partial<Pick<OrderEdit, 'additions' | 'quantities' | 'discounts' | 'noRestock'>>) {
  const [row] = await db.update(orderEdits).set({ ...patch, updatedAt: new Date() }).where(eq(orderEdits.id, e.id)).returning();
  return row!;
}

/** Add a variant to the session (or raise the quantity of the same variant already added). Returns the staged line id. */
export async function addVariantToEdit(db: Db, shopId: number, id: number, variantId: number, quantity: number): Promise<Result<{ edit: OrderEdit; lineId: number }>> {
  const e = await getOrderEdit(db, shopId, id);
  if (!editable(e)) return notOpen();
  if (!Number.isInteger(quantity) || quantity < 1) return errR(['quantity'], 'Quantity must be greater than 0', 'INVALID');
  const resolved = await resolveDraftLines(db, shopId, [{ variantId, quantity }]);
  if (!resolved.ok) return errR(['variantId'], 'Variant does not exist', 'NOT_FOUND');
  const same = e.additions.find((a) => a.variantId === variantId && a.quantity > 0);
  const additions: StagedAddition[] = same
    ? e.additions.map((a) => (a === same ? { ...a, quantity: a.quantity + quantity } : a))
    : [...e.additions, { id: ADDITION_ID_BASE + e.additions.length + 1, variantId, quantity }];
  const edit = await save(db, e, { additions });
  return okR({ edit, lineId: (same ?? additions.at(-1)!).id });
}

export async function setEditQuantity(db: Db, shopId: number, id: number, lineId: number, quantity: number, restock = true): Promise<Result<{ edit: OrderEdit; lineId: number }>> {
  const e = await getOrderEdit(db, shopId, id);
  if (!editable(e)) return notOpen();
  if (!Number.isInteger(quantity) || quantity < 0) return errR(['quantity'], 'Quantity must be 0 or greater', 'INVALID');
  if (lineId >= ADDITION_ID_BASE) {
    if (!e.additions.some((a) => a.id === lineId)) return errR(['lineItemId'], 'Line item does not exist', 'NOT_FOUND');
    return okR({ edit: await save(db, e, { additions: e.additions.map((a) => (a.id === lineId ? { ...a, quantity } : a)) }), lineId });
  }
  const [line] = await db.select().from(orderLines).where(and(eq(orderLines.id, lineId), eq(orderLines.orderId, e.orderId))).limit(1);
  if (!line) return errR(['lineItemId'], 'Line item does not exist', 'NOT_FOUND');
  if (quantity < line.fulfilledQuantity) return errR(['quantity'], `Cannot reduce below the ${line.fulfilledQuantity} fulfilled unit(s)`, 'INVALID');
  return okR({ edit: await save(db, e, { quantities: { ...e.quantities, [lineId]: quantity }, noRestock: { ...e.noRestock, [lineId]: !restock } }), lineId });
}

export async function addEditDiscount(db: Db, shopId: number, id: number, lineId: number, d: { valueType: 'PERCENTAGE' | 'FIXED_AMOUNT'; value: number; description?: string | null }): Promise<Result<{ edit: OrderEdit; discount: StagedDiscount }>> {
  const e = await getOrderEdit(db, shopId, id);
  if (!editable(e)) return notOpen();
  if (!(d.value > 0) || (d.valueType === 'PERCENTAGE' && d.value > 100)) return errR(['discount'], 'Discount value is invalid', 'INVALID');
  const exists = lineId >= ADDITION_ID_BASE ? e.additions.some((a) => a.id === lineId) : (await db.select({ id: orderLines.id }).from(orderLines).where(and(eq(orderLines.id, lineId), eq(orderLines.orderId, e.orderId)))).length > 0;
  if (!exists) return errR(['lineItemId'], 'Line item does not exist', 'NOT_FOUND');
  const discount: StagedDiscount = { id: Math.max(0, ...e.discounts.map((x) => x.id)) + 1, lineId, valueType: d.valueType, value: d.value, description: d.description?.trim() || null };
  return okR({ edit: await save(db, e, { discounts: [...e.discounts.filter((x) => x.lineId !== lineId), discount] }), discount });
}

export interface CommitResult { order: Order; outstanding: number; messages: string[] }

/**
 * Apply the session: line quantities and totals, new lines, tax lines, a manual discount application per staged discount, stock
 * (units added are committed, units removed go back unless the session says otherwise), financial status and the timeline entry.
 * The money is not moved: a positive `outstanding` is payment due (mark as paid / collect), a negative one is a refund owed.
 */
export async function commitOrderEdit(db: Db, shopId: number, id: number, o: { staffId?: number | null; staffNote?: string | null; notifyCustomer?: boolean } = {}): Promise<Result<CommitResult>> {
  const e = await getOrderEdit(db, shopId, id);
  if (!editable(e)) return notOpen();
  return txResult(db, async (tx) => {
    const calc = await calculateOrderEdit(tx, shopId, e);
    const { order } = calc;
    const detail: OrderDetail = await getOrderDetail(tx, shopId, order.id);
    const ref = `shopme://orders/${order.name}`;
    const changes: string[] = [];
    let position = detail.lines.length;
    for (const l of calc.lines) {
      const delta = l.quantity - l.quantityBefore;
      if (l.orderLineId !== null) {
        const row = detail.lines.find((x) => x.id === l.orderLineId) as OrderLine;
        if (delta === 0 && !l.stagedDiscount) continue;
        const qty = row.quantity + delta;
        await tx.update(orderLines).set({ quantity: qty, currentQuantity: l.quantity, discountedTotal: l.discountedTotal, totalTax: l.tax }).where(eq(orderLines.id, row.id));
        const rows = detail.taxLines.filter((t) => t.orderLineId === row.id);
        const split = allocate(l.tax, rows.map((t) => t.price));
        for (const [i, t] of rows.entries()) await tx.update(orderTaxLines).set({ price: split[i]! }).where(eq(orderTaxLines.id, t.id));
        if (delta !== 0) changes.push(`${l.title} ${l.quantityBefore} -> ${l.quantity}`);
      } else {
        const b = l.base!;
        await tx.insert(orderLines).values({
          shopId, orderId: order.id, position: position++, productId: b.productId, variantId: l.variantId, title: l.title, variantTitle: l.variantTitle, sku: l.sku, vendor: b.vendor, quantity: l.quantity, currentQuantity: l.quantity,
          requiresShipping: b.requiresShipping, taxable: b.taxable, unitPrice: l.unitPrice, discountedTotal: l.discountedTotal, totalTax: l.tax, weightGrams: b.grams, imageUrl: l.imageUrl,
        });
        changes.push(`${l.title} +${l.quantity}`);
      }
      if (l.stagedDiscount) {
        const sd = l.stagedDiscount;
        await tx.insert(orderDiscountApplications).values({
          shopId, orderId: order.id, code: null, title: sd.description ?? 'Custom discount', valueType: sd.valueType, value: sd.valueType === 'PERCENTAGE' ? Math.round(sd.value * 100) : sd.value,
          allocatedAmount: l.unitPrice * l.quantity - l.discountedTotal, targetType: 'LINE_ITEM',
        });
      }
      if (l.variantId != null && delta !== 0) {
        if (delta > 0) { if (!(await commitStock(tx, shopId, l.variantId, delta, order.id))) return errR(['quantity'], `Not enough stock for ${l.title}`, 'INSUFFICIENT_INVENTORY'); }
        else if (l.restock) await restockVariant(tx, shopId, l.variantId, -delta, null, ref, -delta);
      }
    }

    const outstanding = calc.outstanding;
    const status = order.financialStatus;
    const next = calc.received > 0 && outstanding > 0 && ['PAID', 'PARTIALLY_PAID'].includes(status) ? 'PARTIALLY_PAID' : calc.received > 0 && outstanding <= 0 && status === 'PARTIALLY_PAID' ? 'PAID' : status;
    const now = new Date();
    const [updated] = await tx.update(orders).set({
      subtotal: calc.subtotal, totalDiscounts: calc.totalDiscounts, totalTax: calc.totalTax, total: calc.total, financialStatus: next, updatedAt: now,
      fulfillmentStatus: order.fulfillmentStatus === 'FULFILLED' && calc.lines.some((l) => l.quantity > l.uneditable) ? 'PARTIALLY_FULFILLED' : order.fulfillmentStatus,
    }).where(eq(orders.id, order.id)).returning();
    await tx.update(orderEdits).set({ status: 'COMMITTED', committedAt: now, updatedAt: now }).where(eq(orderEdits.id, e.id));
    const delta = calc.total - order.total;
    const messages = [delta > 0 ? `Payment due: ${outstanding} (minor units)` : outstanding < 0 ? `Refund owed: ${-outstanding} (minor units)` : 'No payment change'];
    await addEvent(tx, shopId, {
      subjectType: 'order', subjectId: order.id, verb: 'order.edited', authorStaffUserId: o.staffId,
      message: `Order was edited (${changes.join(', ') || 'discounts'})${o.staffNote ? `: ${o.staffNote}` : ''}. ${messages[0]}`,
      data: { editId: e.id, outstanding, totalBefore: order.total, totalAfter: calc.total, notify: !!o.notifyCustomer },
    });
    return okR({ order: updated!, outstanding, messages });
  });
}

/** Abandon the session without changing the order. */
export async function discardOrderEdit(db: Db, shopId: number, id: number): Promise<void> {
  await db.update(orderEdits).set({ status: 'DISCARDED', updatedAt: new Date() }).where(and(eq(orderEdits.shopId, shopId), eq(orderEdits.id, id), eq(orderEdits.status, 'OPEN')));
}
