import { and, eq, sql } from 'drizzle-orm';
import { parseMoney } from '@shopme/shopify-compat';
import {
  addLocation, createCollection, createCustomer, createMenu, createPage, editLocation, ensureMainTheme, getCollectionByHandle, getMenu, getPage, getSelectedOptions, importImage, listLocations,
  listVariants, normalizeTags, schema, setQuantities, uniqueHandle, updateCollection, updateCustomer, updateInventoryItem, updateMenu, updatePage, upsertThemeFiles, writeProduct,
  type Db, type ImageFetcher, type MenuItemInput, type ParsedProduct, type ParsedVariant, type Reporter, type Storage, type WeightUnit,
} from '@shopme/core';
import type { ShopifyClient } from './shopify-client';

const { articles, blogs, collectionProducts, customers, importMappings, inventoryItems, media, orderAddresses, orderLines, orderShippingLines, orders, sequences, shops, urlRedirects } = schema;

export const PHASES = ['locations', 'products', 'inventory', 'collections', 'customers', 'orders', 'pages', 'blogs', 'menus', 'redirects', 'policies', 'theme'] as const;
export type Phase = (typeof PHASES)[number];

export interface PhaseSummary { created: number; updated: number; skipped: number; failed: number; errors: string[] }
export interface ImportSummary { source: string; phases: Partial<Record<Phase, PhaseSummary>>; warnings: string[] }
export interface ProgressEvent { phase: Phase; processed: number; total: number | null; summary: PhaseSummary }

export interface ShopifyImportOptions {
  db: Db; shopId: number; storage: Storage; client: ShopifyClient;
  /** Default: every phase except `theme` (theme settings are opt-in). */
  only?: Phase[];
  fetchImage?: ImageFetcher;
  onProgress?: (e: ProgressEvent) => void | Promise<void>;
}

type Money = { shopMoney: { amount: string; currencyCode: string } } | null;
const amt = (m: Money | undefined, currency: string) => (m ? parseMoney(m.shopMoney.amount, currency) : 0);
const noQuery = (u: string) => u.split('?')[0]!;
const MONEY = '{ shopMoney { amount currencyCode } }';
const PAGE = 'pageInfo { hasNextPage endCursor }';

class Mapper {
  private cache = new Map<string, number>();
  constructor(private db: Db, private shopId: number, readonly source: string) {}
  async get(type: string, sourceId: string | null | undefined): Promise<number | null> {
    if (!sourceId) return null;
    const k = `${type}|${sourceId}`;
    if (this.cache.has(k)) return this.cache.get(k)!;
    const [r] = await this.db.select({ localId: importMappings.localId }).from(importMappings)
      .where(and(eq(importMappings.shopId, this.shopId), eq(importMappings.source, this.source), eq(importMappings.resourceType, type), eq(importMappings.sourceId, sourceId)));
    if (r) this.cache.set(k, r.localId);
    return r?.localId ?? null;
  }
  async set(type: string, sourceId: string, localId: number) {
    this.cache.set(`${type}|${sourceId}`, localId);
    await this.db.insert(importMappings).values({ shopId: this.shopId, source: this.source, resourceType: type, sourceId, localId })
      .onConflictDoUpdate({ target: [importMappings.shopId, importMappings.source, importMappings.resourceType, importMappings.sourceId], set: { localId } });
  }
}

/** Import a Shopify store through the Admin GraphQL API. Idempotent: source ids are kept in `import_mappings`, re-runs update. */
export async function importFromShopify(o: ShopifyImportOptions): Promise<ImportSummary> {
  const { db, shopId, client } = o;
  const source = `shopify:${client.domain}`;
  const map = new Mapper(db, shopId, source);
  const summary: ImportSummary = { source, phases: {}, warnings: [] };
  const env = { db, shopId, storage: o.storage, dryRun: false, fetchImage: o.fetchImage };

  const info = await client.query<{ shop: { name: string; currencyCode: string } }>('{ shop { name currencyCode } }', {}, 5);
  const currency = info.shop.currencyCode;
  const [local] = await db.select({ currency: shops.currency }).from(shops).where(eq(shops.id, shopId));
  if (local && local.currency !== currency) summary.warnings.push(`Source currency ${currency} differs from this shop's currency ${local.currency}; amounts are copied as numbers.`);

  const phaseReporter = (phase: Phase): { rep: Reporter; s: PhaseSummary; tick: (total?: number | null) => Promise<void> } => {
    const s: PhaseSummary = { created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
    summary.phases[phase] = s;
    let processed = 0; let total: number | null = null;
    const tick = async (t?: number | null) => { processed++; if (t !== undefined) total = t; await o.onProgress?.({ phase, processed, total, summary: s }); };
    const rep: Reporter = {
      count: (k, n = 1) => { s[k] += n; },
      error: (m) => { if (s.errors.length < 50) s.errors.push(m); },
      progress: async () => {},
    };
    return { rep, s, tick };
  };

  const phases = o.only ?? PHASES.filter((p) => p !== 'theme');
  const run = async (phase: Phase, fn: (p: ReturnType<typeof phaseReporter>) => Promise<void>) => {
    if (!phases.includes(phase)) return;
    const p = phaseReporter(phase);
    await o.onProgress?.({ phase, processed: 0, total: null, summary: p.s });
    try { await fn(p); } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if ((e as { code?: string }).code === 'ACCESS_DENIED') summary.warnings.push(`Skipped ${phase}: the access token lacks the required scope (${msg})`);
      else { p.s.failed++; p.s.errors.push(msg); }
    }
  };
  const count = async (q: string): Promise<number | null> => { try { return Number((await client.query(`{ ${q} { count } }`, {}, 5))[q]?.count ?? 0); } catch { return null; } };
  const upsertBy = async <T>(p: { rep: Reporter }, id: string, label: string, fn: () => Promise<T | null>) => {
    try { return await fn(); } catch (e) { p.rep.count('failed'); p.rep.error(`${label} (${id}): ${e instanceof Error ? e.message : String(e)}`); return null; }
  };
  const fail = (p: { rep: Reporter }, label: string, errors: { field: string[] | null; message: string }[]) => {
    p.rep.count('failed');
    for (const e of errors) p.rep.error(`${label}: ${e.field?.join('.') ?? ''} ${e.message}`.replace(/\s+/g, ' '));
  };

  // ---------------------------------------------------------------- locations
  await run('locations', async (p) => {
    const q = `{ locations(first: 50) { nodes { id name isPrimary fulfillsOnlineOrders address { address1 address2 city provinceCode zip countryCode phone } } } }`;
    const nodes: any[] = (await client.query(q, {}, 60)).locations.nodes;
    const local = await listLocations(db, shopId, { offset: 0, limit: 200 });
    const [only] = local.length === 1 ? local : [];
    for (const n of nodes) {
      await upsertBy(p, n.id, n.name, async () => {
        const input = { name: n.name, fulfillsOnlineOrders: n.fulfillsOnlineOrders, address: n.address ?? undefined };
        let id = await map.get('location', n.id);
        id ??= local.find((l) => l.name.toLowerCase() === n.name.toLowerCase())?.id ?? (n.isPrimary && only?.name === 'Shop location' ? only.id : null);
        const r = id ? await editLocation(db, shopId, id, input) : await addLocation(db, shopId, input);
        if (!r.ok) return fail(p, n.name, r.errors);
        await map.set('location', n.id, r.value.id);
        p.rep.count(id ? 'updated' : 'created');
      });
      await p.tick(nodes.length);
    }
  });

  // ---------------------------------------------------------------- products
  const PRODUCTS_Q = `query($after: String) { products(first: 5, after: $after) { ${PAGE} nodes {
    id handle title descriptionHtml vendor productType tags status templateSuffix seo { title description }
    options { name values }
    media(first: 20) { ${PAGE} nodes { ... on MediaImage { id alt image { url } } } }
    variants(first: 50) { ${PAGE} nodes { id title sku barcode price compareAtPrice taxable inventoryPolicy position selectedOptions { name value } image { url } } } } } }`;
  const VARIANTS_MORE = `query($id: ID!, $after: String) { node(id: $id) { ... on Product { variants(first: 50, after: $after) { ${PAGE} nodes { id title sku barcode price compareAtPrice taxable inventoryPolicy position selectedOptions { name value } image { url } } } } } }`;
  const MEDIA_MORE = `query($id: ID!, $after: String) { node(id: $id) { ... on Product { media(first: 50, after: $after) { ${PAGE} nodes { ... on MediaImage { id alt image { url } } } } } } }`;

  const rest = async (first: any, q: string, id: string, key: string): Promise<any[]> => {
    const all = [...first.nodes];
    let page = first.pageInfo;
    while (page.hasNextPage) {
      const next = (await client.query(q, { id, after: page.endCursor }, 500)).node[key];
      all.push(...next.nodes); page = next.pageInfo;
    }
    return all;
  };

  await run('products', async (p) => {
    const total = await count('productsCount');
    for await (const n of client.paginate<any>(PRODUCTS_Q, (d) => d.products, {}, 600)) {
      await upsertBy(p, n.id, n.title, async () => {
        const [variants, images] = await Promise.all([rest(n.variants, VARIANTS_MORE, n.id, 'variants'), rest(n.media, MEDIA_MORE, n.id, 'media')]);
        const mappedId = await map.get('product', n.id);
        const mapped = mappedId ? (await db.query.products.findFirst({ where: (t, { eq: e }) => e(t.id, mappedId) })) : null;
        const optionNames: string[] = n.options.map((x: any) => x.name);
        const isDefault = optionNames.length === 1 && optionNames[0] === 'Title' && n.options[0].values.length === 1 && n.options[0].values[0] === 'Default Title';
        const parsedVariants: ParsedVariant[] = [...variants].sort((a, b) => a.position - b.position).map((v) => ({
          line: 0, options: v.selectedOptions.map((s: any) => s.value),
          imageSrc: v.image?.url ? noQuery(v.image.url) : undefined,
          input: {
            optionValues: isDefault ? [] : v.selectedOptions.map((s: any) => ({ optionName: s.name, name: s.value })),
            price: parseMoney(v.price, currency), compareAtPrice: v.compareAtPrice != null ? parseMoney(v.compareAtPrice, currency) : null,
            barcode: v.barcode || null, taxable: v.taxable, inventoryPolicy: v.inventoryPolicy, inventoryItem: { sku: v.sku || null },
          },
        }));
        const parsed: ParsedProduct = {
          handle: mapped?.handle ?? n.handle, errors: [], optionNames: isDefault ? [] : optionNames, variants: isDefault ? parsedVariants.slice(0, 1) : parsedVariants,
          images: images.filter((m) => m?.image?.url).map((m, i) => ({ src: noQuery(m.image.url), alt: m.alt || undefined, position: i + 1 })),
          input: {
            title: n.title, handle: mapped?.handle ?? n.handle, descriptionHtml: n.descriptionHtml, vendor: n.vendor, productType: n.productType, tags: n.tags, status: n.status,
            templateSuffix: n.templateSuffix, seo: { title: n.seo?.title ?? null, description: n.seo?.description ?? null },
          },
        };
        const res = await writeProduct(env, parsed, 0, p.rep);
        if (!res) { p.rep.count('failed'); return; }
        p.rep.count(res.outcome);
        await map.set('product', n.id, res.productId);
        // Map each source variant to the local variant with the same option values.
        const localVariants = await listVariants(db, shopId, { productId: res.productId, offset: 0, limit: 2048 });
        const sel = await getSelectedOptions(db, shopId, localVariants.map((v) => v.id));
        const byKey = new Map(localVariants.map((v) => [(sel.get(v.id) ?? []).map((s) => s.value.toLowerCase()).join('\u0001'), v.id]));
        for (const v of variants) {
          const id = isDefault ? localVariants[0]?.id : byKey.get(v.selectedOptions.map((s: any) => s.value.toLowerCase()).join('\u0001'));
          if (id) await map.set('variant', v.id, id);
        }
      });
      await p.tick(total);
    }
  });

  // ---------------------------------------------------------------- inventory
  const INVENTORY_Q = `query($after: String) { inventoryItems(first: 30, after: $after) { ${PAGE} nodes {
    id tracked requiresShipping countryCodeOfOrigin harmonizedSystemCode unitCost { amount } measurement { weight { value unit } }
    variant { id } inventoryLevels(first: 5) { nodes { location { id } quantities(names: ["available"]) { name quantity } } } } } }`;
  await run('inventory', async (p) => {
    for await (const it of client.paginate<any>(INVENTORY_Q, (d) => d.inventoryItems, {}, 800)) {
      await upsertBy(p, it.id, 'inventory item', async () => {
        const variantId = await map.get('variant', it.variant?.id);
        if (!variantId) { p.rep.count('skipped'); return; }
        const [item] = await db.select({ id: inventoryItems.id }).from(inventoryItems).where(eq(inventoryItems.variantId, variantId));
        if (!item) { p.rep.count('skipped'); return; }
        const w = it.measurement?.weight;
        const r = await updateInventoryItem(db, shopId, item.id, {
          tracked: it.tracked, requiresShipping: it.requiresShipping, countryCodeOfOrigin: it.countryCodeOfOrigin, harmonizedSystemCode: it.harmonizedSystemCode,
          cost: it.unitCost ? parseMoney(it.unitCost.amount, currency) : null, ...(w && { weight: { value: w.value, unit: w.unit as WeightUnit } }),
        });
        if (!r.ok) return fail(p, 'inventory item', r.errors);
        for (const l of it.inventoryLevels.nodes) {
          const locationId = await map.get('location', l.location.id);
          const q = l.quantities.find((x: any) => x.name === 'available')?.quantity;
          if (locationId && q != null) await setQuantities(db, shopId, { name: 'available', reason: 'correction', referenceDocumentUri: `shopme://migrate/${source}`, quantities: [{ inventoryItemId: item.id, locationId, quantity: Math.max(0, q) }] });
        }
        p.rep.count('updated');
      });
      await p.tick();
    }
  });

  // ---------------------------------------------------------------- collections
  const COLLECTIONS_Q = `query($after: String) { collections(first: 20, after: $after) { ${PAGE} nodes {
    id handle title descriptionHtml sortOrder templateSuffix seo { title description } image { url altText }
    ruleSet { appliedDisjunctively rules { column relation condition } } } } }`;
  const COLLECTION_PRODUCTS = `query($id: ID!, $after: String) { collection(id: $id) { products(first: 250, after: $after) { ${PAGE} nodes { id } } } }`;
  await run('collections', async (p) => {
    const total = await count('collectionsCount');
    const SORTS = ['ALPHA_ASC', 'ALPHA_DESC', 'BEST_SELLING', 'CREATED', 'CREATED_DESC', 'MANUAL', 'PRICE_ASC', 'PRICE_DESC'];
    for await (const n of client.paginate<any>(COLLECTIONS_Q, (d) => d.collections, {}, 200)) {
      await upsertBy(p, n.id, n.title, async () => {
        let id = await map.get('collection', n.id);
        id ??= (await getCollectionByHandle(db, shopId, n.handle))?.id ?? null;
        const image = n.image?.url ? await importImage(env, noQuery(n.image.url), n.image.altText) : null;
        const input = {
          title: n.title, handle: n.handle, descriptionHtml: n.descriptionHtml, sortOrder: SORTS.includes(n.sortOrder) ? n.sortOrder : 'MANUAL', templateSuffix: n.templateSuffix,
          seo: { title: n.seo?.title ?? null, description: n.seo?.description ?? null }, ...(image && { image: { src: image, altText: n.image.altText } }),
          ...(n.ruleSet && { ruleSet: { appliedDisjunctively: n.ruleSet.appliedDisjunctively, rules: n.ruleSet.rules } }),
        };
        const r = id ? await updateCollection(db, shopId, id, input) : await createCollection(db, shopId, input);
        if (!r.ok) return fail(p, n.title, r.errors);
        await map.set('collection', n.id, r.value.id);
        p.rep.count(id ? 'updated' : 'created');
        if (!n.ruleSet) {
          // Manual collection: membership in source order.
          const ids: number[] = [];
          let after: string | null = null;
          for (;;) {
            const page: any = (await client.query(COLLECTION_PRODUCTS, { id: n.id, after }, 300)).collection.products;
            for (const x of page.nodes) { const lid = await map.get('product', x.id); if (lid) ids.push(lid); }
            if (!page.pageInfo.hasNextPage) break;
            after = page.pageInfo.endCursor;
          }
          await db.transaction(async (tx) => {
            await tx.delete(collectionProducts).where(eq(collectionProducts.collectionId, r.value.id));
            if (ids.length) await tx.insert(collectionProducts).values(ids.map((productId, position) => ({ shopId, collectionId: r.value.id, productId, position, source: 'manual' })));
          });
        }
      });
      await p.tick(total);
    }
  });

  // ---------------------------------------------------------------- customers
  const ADDR = 'firstName lastName company address1 address2 city provinceCode zip countryCodeV2 phone';
  const CUSTOMERS_Q = `query($after: String) { customers(first: 25, after: $after) { ${PAGE} nodes {
    id firstName lastName note tags taxExempt locale numberOfOrders amountSpent { amount }
    defaultEmailAddress { emailAddress marketingState } defaultPhoneNumber { phoneNumber } defaultAddress { id }
    addressesV2(first: 10) { nodes { id ${ADDR} } } } } }`;
  await run('customers', async (p) => {
    const total = await count('customersCount');
    for await (const n of client.paginate<any>(CUSTOMERS_Q, (d) => d.customers, {}, 700)) {
      await upsertBy(p, n.id, n.firstName ?? n.id, async () => {
        const email = n.defaultEmailAddress?.emailAddress?.toLowerCase() || null;
        let id = await map.get('customer', n.id);
        if (!id && email) id = (await db.query.customers.findFirst({ where: (t, { and: a, eq: e }) => a(e(t.shopId, shopId), e(t.email, email)) }))?.id ?? null;
        const addrs = [...n.addressesV2.nodes].sort((a: any, b: any) => Number(b.id === n.defaultAddress?.id) - Number(a.id === n.defaultAddress?.id))
          .map((a: any) => ({ firstName: a.firstName, lastName: a.lastName, company: a.company, address1: a.address1, address2: a.address2, city: a.city, provinceCode: a.provinceCode, zip: a.zip, countryCode: a.countryCodeV2, phone: a.phone }));
        const input = {
          email, firstName: n.firstName, lastName: n.lastName, phone: n.defaultPhoneNumber?.phoneNumber ?? null, note: n.note, tags: n.tags, taxExempt: n.taxExempt, locale: n.locale,
          acceptsMarketing: n.defaultEmailAddress?.marketingState === 'SUBSCRIBED', addresses: addrs,
        };
        let r = id ? await updateCustomer(db, shopId, id, input) : await createCustomer(db, shopId, input);
        // Phone numbers are optional contact data: retry without one the validator rejects.
        if (!r.ok && r.errors.some((e) => e.field?.[0] === 'phone')) r = id ? await updateCustomer(db, shopId, id, { ...input, phone: null }) : await createCustomer(db, shopId, { ...input, phone: null });
        if (!r.ok) return fail(p, n.firstName ?? n.id, r.errors);
        await map.set('customer', n.id, r.value.id);
        await db.update(customers).set({ numberOfOrders: Number(n.numberOfOrders), amountSpent: parseMoney(n.amountSpent.amount, currency), verifiedEmail: !!email }).where(eq(customers.id, r.value.id));
        p.rep.count(id ? 'updated' : 'created');
      });
      await p.tick(total);
    }
  });

  // ---------------------------------------------------------------- orders (historical: direct rows, no emails, no stock movement)
  const LINE = `id title variantTitle sku vendor quantity currentQuantity requiresShipping taxable isGiftCard originalUnitPriceSet ${MONEY} originalTotalSet ${MONEY} totalDiscountSet ${MONEY} product { id } variant { id } image { url }`;
  const ORDERS_Q = `query($after: String) { orders(first: 5, after: $after, sortKey: CREATED_AT) { ${PAGE} nodes {
    id name createdAt processedAt cancelledAt closedAt cancelReason test displayFinancialStatus displayFulfillmentStatus currencyCode presentmentCurrencyCode taxesIncluded email phone note tags sourceName
    subtotalPriceSet ${MONEY} totalPriceSet ${MONEY} totalTaxSet ${MONEY} totalShippingPriceSet ${MONEY} totalDiscountsSet ${MONEY} totalRefundedSet ${MONEY}
    customer { id }
    shippingAddress { ${ADDR} province country } billingAddress { ${ADDR} province country }
    shippingLines(first: 5) { nodes { title code originalPriceSet ${MONEY} } }
    lineItems(first: 20) { ${PAGE} nodes { ${LINE} } } } } }`;
  const LINES_MORE = `query($id: ID!, $after: String) { node(id: $id) { ... on Order { lineItems(first: 50, after: $after) { ${PAGE} nodes { ${LINE} } } } } }`;
  const FIN = ['PENDING', 'AUTHORIZED', 'PARTIALLY_PAID', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'VOIDED', 'EXPIRED'];
  const FUL = ['UNFULFILLED', 'PARTIALLY_FULFILLED', 'FULFILLED', 'RESTOCKED', 'ON_HOLD'];
  await run('orders', async (p) => {
    const total = await count('ordersCount');
    let maxNumber = 0;
    for await (const n of client.paginate<any>(ORDERS_Q, (d) => d.orders, {}, 700)) {
      await upsertBy(p, n.id, n.name, async () => {
        if (await map.get('order', n.id)) { p.rep.count('skipped'); return; }
        const cur: string = n.currencyCode;
        const number = Number(/\d+/.exec(n.name)?.[0]);
        if (!Number.isInteger(number)) return fail(p, n.name, [{ field: null, message: 'Order name has no number' }]);
        const [dup] = await db.select({ id: orders.id }).from(orders).where(and(eq(orders.shopId, shopId), eq(orders.orderNumber, number)));
        if (dup) return fail(p, n.name, [{ field: null, message: `Order number ${number} already exists locally` }]);
        const lines = await rest(n.lineItems, LINES_MORE, n.id, 'lineItems');
        const customerId = await map.get('customer', n.customer?.id);
        const addr = (kind: 'shipping' | 'billing', a: any) => a && ({ shopId, kind, firstName: a.firstName, lastName: a.lastName, company: a.company, address1: a.address1, address2: a.address2, city: a.city, province: a.province, provinceCode: a.provinceCode, zip: a.zip, country: a.country, countryCode: a.countryCodeV2, phone: a.phone });
        // Resolve ids first: PGlite runs one query at a time, so nothing may use `db` while the transaction is open.
        const lineRows = await Promise.all(lines.map(async (l: any, position: number) => ({
          shopId, position, productId: await map.get('product', l.product?.id), variantId: await map.get('variant', l.variant?.id), title: l.title, variantTitle: l.variantTitle, sku: l.sku, vendor: l.vendor,
          quantity: l.quantity, currentQuantity: l.currentQuantity, fulfilledQuantity: 0, requiresShipping: l.requiresShipping, taxable: l.taxable, isGiftCard: l.isGiftCard,
          unitPrice: amt(l.originalUnitPriceSet, cur), discountedTotal: amt(l.originalTotalSet, cur) - amt(l.totalDiscountSet, cur), imageUrl: l.image?.url ?? null,
        })));
        const orderId = await db.transaction(async (tx) => {
          const [o] = await tx.insert(orders).values({
            shopId, orderNumber: number, name: n.name, customerId, email: n.email, phone: n.phone, currency: cur, presentmentCurrency: n.presentmentCurrencyCode ?? cur, taxesIncluded: n.taxesIncluded, test: n.test,
            financialStatus: FIN.includes(n.displayFinancialStatus) ? n.displayFinancialStatus : 'PENDING', fulfillmentStatus: FUL.includes(n.displayFulfillmentStatus) ? n.displayFulfillmentStatus : 'UNFULFILLED',
            cancelReason: n.cancelReason, cancelledAt: n.cancelledAt ? new Date(n.cancelledAt) : null, closedAt: n.closedAt ? new Date(n.closedAt) : null,
            processedAt: new Date(n.processedAt ?? n.createdAt), createdAt: new Date(n.createdAt), note: n.note, tags: normalizeTags(n.tags), sourceName: n.sourceName ?? 'shopify',
            subtotal: amt(n.subtotalPriceSet, cur), totalShipping: amt(n.totalShippingPriceSet, cur), totalTax: amt(n.totalTaxSet, cur), totalDiscounts: amt(n.totalDiscountsSet, cur),
            total: amt(n.totalPriceSet, cur), totalRefunded: amt(n.totalRefundedSet, cur),
          }).returning({ id: orders.id });
          if (lineRows.length) await tx.insert(orderLines).values(lineRows.map((l) => ({ ...l, orderId: o!.id })));
          const addrs = [addr('shipping', n.shippingAddress), addr('billing', n.billingAddress)].filter(Boolean) as NonNullable<ReturnType<typeof addr>>[];
          if (addrs.length) await tx.insert(orderAddresses).values(addrs.map((a) => ({ ...a, orderId: o!.id })));
          if (n.shippingLines.nodes.length) await tx.insert(orderShippingLines).values(n.shippingLines.nodes.map((s: any) => ({ shopId, orderId: o!.id, title: s.title, code: s.code, price: amt(s.originalPriceSet, cur) })));
          return o!.id;
        });
        await map.set('order', n.id, orderId);
        maxNumber = Math.max(maxNumber, number);
        p.rep.count('created');
      });
      await p.tick(total);
    }
    // New local orders continue after the imported numbers.
    if (maxNumber) await db.insert(sequences).values({ shopId, name: 'order_number', value: maxNumber }).onConflictDoUpdate({ target: [sequences.shopId, sequences.name], set: { value: sql`greatest(${sequences.value}, ${maxNumber})` } });
  });

  // ---------------------------------------------------------------- pages
  await run('pages', async (p) => {
    for await (const n of client.paginate<any>(`query($after: String) { pages(first: 50, after: $after) { ${PAGE} nodes { id handle title body templateSuffix isPublished publishedAt } } }`, (d) => d.pages, {}, 300)) {
      await upsertBy(p, n.id, n.title, async () => {
        let id = await map.get('page', n.id);
        id ??= (await db.query.pages.findFirst({ where: (t, { and: a, eq: e }) => a(e(t.shopId, shopId), e(t.handle, n.handle)) }))?.id ?? null;
        const input = { title: n.title, handle: n.handle, body: n.body, isPublished: n.isPublished, publishDate: n.publishedAt ? new Date(n.publishedAt) : null, templateSuffix: n.templateSuffix };
        const r = id && (await getPage(db, shopId, id)) ? await updatePage(db, shopId, id, input) : await createPage(db, shopId, input);
        if (!r.ok) return fail(p, n.title, r.errors);
        await map.set('page', n.id, r.value.id);
        p.rep.count(id ? 'updated' : 'created');
      });
      await p.tick();
    }
  });

  // ---------------------------------------------------------------- blogs and articles
  await run('blogs', async (p) => {
    for await (const n of client.paginate<any>(`query($after: String) { blogs(first: 20, after: $after) { ${PAGE} nodes { id handle title templateSuffix } } }`, (d) => d.blogs, {}, 100)) {
      await upsertBy(p, n.id, n.title, async () => {
        let id = await map.get('blog', n.id);
        id ??= (await db.query.blogs.findFirst({ where: (t, { and: a, eq: e }) => a(e(t.shopId, shopId), e(t.handle, n.handle)) }))?.id ?? null;
        const values = { title: n.title, templateSuffix: n.templateSuffix, updatedAt: new Date() };
        const existed = id !== null;
        if (id) await db.update(blogs).set(values).where(eq(blogs.id, id));
        else id = (await db.insert(blogs).values({ shopId, handle: n.handle, ...values }).returning({ id: blogs.id }))[0]!.id;
        await map.set('blog', n.id, id);
        p.rep.count(existed ? 'updated' : 'created');
      });
    }
    const ARTICLES_Q = `query($after: String) { articles(first: 25, after: $after) { ${PAGE} nodes { id handle title body summary tags templateSuffix publishedAt author { name } image { url altText } blog { id } } } }`;
    for await (const a of client.paginate<any>(ARTICLES_Q, (d) => d.articles, {}, 400)) {
      await upsertBy(p, a.id, a.title, async () => {
        const blogId = await map.get('blog', a.blog.id);
        if (!blogId) { p.rep.count('skipped'); return; }
        const existing = await map.get('article', a.id);
        const url = a.image?.url ? await importImage(env, noQuery(a.image.url), a.image.altText) : null;
        let imageMediaId: number | undefined;
        if (url) imageMediaId = (await db.insert(media).values({ shopId, type: 'IMAGE', url, alt: a.image.altText ?? null }).returning({ id: media.id }))[0]!.id;
        const values = { title: a.title, author: a.author?.name ?? null, bodyHtml: a.body, summaryHtml: a.summary, tags: normalizeTags(a.tags), templateSuffix: a.templateSuffix, publishedAt: a.publishedAt ? new Date(a.publishedAt) : null, ...(imageMediaId && { imageMediaId }), updatedAt: new Date() };
        let id = existing;
        if (id) await db.update(articles).set(values).where(eq(articles.id, id));
        else {
          const handle = await uniqueHandle(a.handle, async (h) => !!(await db.query.articles.findFirst({ where: (t, { and: x, eq: e }) => x(e(t.blogId, blogId), e(t.handle, h)) })));
          id = (await db.insert(articles).values({ shopId, blogId, handle, ...values }).returning({ id: articles.id }))[0]!.id;
        }
        await map.set('article', a.id, id);
        p.rep.count(existing ? 'updated' : 'created');
      });
      await p.tick();
    }
  });

  // ---------------------------------------------------------------- menus
  await run('menus', async (p) => {
    const ITEM = 'id title type url resourceId';
    const Q = `query($after: String) { menus(first: 20, after: $after) { ${PAGE} nodes { id handle title items { ${ITEM} items { ${ITEM} items { ${ITEM} } } } } } }`;
    const TYPE_OF: Record<string, string> = { PRODUCT: 'product', COLLECTION: 'collection', PAGE: 'page', BLOG: 'blog', ARTICLE: 'article' };
    const path = (u: string | null) => (u ? u.replace(/^https?:\/\/[^/]+/, '') || '/' : null);
    const convert = async (items: any[]): Promise<MenuItemInput[]> => Promise.all(items.map(async (it) => {
      const local = TYPE_OF[it.type] ? await map.get(TYPE_OF[it.type]!, it.resourceId) : null;
      const base = { title: it.title, items: await convert(it.items ?? []) };
      if (local) return { ...base, type: it.type, resourceId: local };
      const url = path(it.url);
      if (TYPE_OF[it.type] || it.type === 'HTTP') return { ...base, type: 'HTTP', url: url ?? '/' };
      return { ...base, type: it.type, url };
    }));
    for await (const n of client.paginate<any>(Q, (d) => d.menus, {}, 300)) {
      await upsertBy(p, n.id, n.title, async () => {
        let id = await map.get('menu', n.id);
        id ??= (await db.query.menus.findFirst({ where: (t, { and: a, eq: e }) => a(e(t.shopId, shopId), e(t.handle, n.handle)) }))?.id ?? null;
        const input = { title: n.title, handle: n.handle, items: await convert(n.items) };
        const r = id && (await getMenu(db, shopId, id)) ? await updateMenu(db, shopId, id, input) : await createMenu(db, shopId, input);
        if (!r.ok) return fail(p, n.title, r.errors);
        await map.set('menu', n.id, r.value.id);
        p.rep.count(id ? 'updated' : 'created');
      });
      await p.tick();
    }
  });

  // ---------------------------------------------------------------- redirects
  await run('redirects', async (p) => {
    for await (const n of client.paginate<any>(`query($after: String) { urlRedirects(first: 100, after: $after) { ${PAGE} nodes { id path target } } }`, (d) => d.urlRedirects, {}, 200)) {
      await upsertBy(p, n.id, n.path, async () => {
        const rows = await db.insert(urlRedirects).values({ shopId, path: n.path, target: n.target }).onConflictDoUpdate({ target: [urlRedirects.shopId, urlRedirects.path], set: { target: n.target } }).returning({ id: urlRedirects.id, createdAt: urlRedirects.createdAt });
        p.rep.count(rows.length ? 'created' : 'updated');
      });
      await p.tick();
    }
  });

  // ---------------------------------------------------------------- policies (stored under shop.settings.policies)
  await run('policies', async (p) => {
    const policies: any[] = (await client.query('{ shop { shopPolicies { type title body } } }', {}, 20)).shop.shopPolicies;
    if (!policies.length) return;
    const [row] = await db.select({ settings: shops.settings }).from(shops).where(eq(shops.id, shopId));
    const current = ((row?.settings ?? {}) as { policies?: Record<string, unknown> }).policies ?? {};
    const next = { ...current, ...Object.fromEntries(policies.map((x) => [x.type, { title: x.title, body: x.body }])) };
    await db.update(shops).set({ settings: { ...(row?.settings ?? {}), policies: next } }).where(eq(shops.id, shopId));
    p.rep.count('updated', policies.length);
  });

  // ---------------------------------------------------------------- theme settings (opt-in; the theme code itself is not copied)
  await run('theme', async (p) => {
    const Q = `{ themes(first: 1, roles: [MAIN]) { nodes { files(filenames: ["config/settings_data.json"], first: 1) { nodes { body { ... on OnlineStoreThemeFileBodyText { content } } } } } } }`;
    const content: string | undefined = (await client.query(Q, {}, 50)).themes.nodes[0]?.files.nodes[0]?.body?.content;
    if (!content) { p.rep.count('skipped'); return; }
    const main = await ensureMainTheme(db, shopId);
    const r = await upsertThemeFiles(db, shopId, main.id, [{ filename: 'config/settings_data.json', body: content }]);
    if (r.ok) p.rep.count('updated'); else fail(p, 'settings_data.json', r.errors);
  });

  return summary;
}
