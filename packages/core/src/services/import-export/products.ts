import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import { parseMoney } from '@shopme/shopify-compat';
import { files, inventoryItems, media, productMedia, products } from '../../db/schema';
import type { Db } from '../../db/client';
import {
  availableByVariant, bulkCreateVariants, bulkUpdateVariants, createProduct, createProductMedia, defaultLocationId, getInventoryItemForVariant, getProductByHandle, getProductOptions,
  getSelectedOptions, listProductMedia, listVariants, setQuantities, updateProduct, WEIGHT_KG, type MediaInput, type ProductInput, type Result, type VariantInput,
} from '../catalog';
import { slugify } from '../handle';
import { getShop } from '../shops';
import { csvLine } from '../csv';
import { decimal, importImage, lowerKeys, parseBool, splitTags, urlFilename, type CsvRow, type ImportEnv, type Reporter } from './common';

export const PRODUCT_COLUMNS = [
  'Handle', 'Title', 'Body (HTML)', 'Vendor', 'Product Category', 'Type', 'Tags', 'Published',
  'Option1 Name', 'Option1 Value', 'Option2 Name', 'Option2 Value', 'Option3 Name', 'Option3 Value',
  'Variant SKU', 'Variant Grams', 'Variant Inventory Tracker', 'Variant Inventory Qty', 'Variant Inventory Policy', 'Variant Price', 'Variant Compare At Price',
  'Variant Requires Shipping', 'Variant Taxable', 'Variant Barcode', 'Image Src', 'Image Position', 'Image Alt Text',
  'SEO Title', 'SEO Description', 'Variant Image', 'Variant Weight Unit', 'Cost per item', 'Status',
];

const WEIGHT_UNIT_CODES: Record<string, 'GRAMS' | 'KILOGRAMS' | 'POUNDS' | 'OUNCES'> = { g: 'GRAMS', kg: 'KILOGRAMS', lb: 'POUNDS', lbs: 'POUNDS', oz: 'OUNCES' };
const UNIT_CODE_OF = { GRAMS: 'g', KILOGRAMS: 'kg', POUNDS: 'lb', OUNCES: 'oz' } as const;

export interface ParsedVariant { line: number; options: string[]; input: VariantInput; qty?: number; imageSrc?: string }
export interface ParsedProduct {
  handle: string; input: ProductInput; optionNames: string[]; variants: ParsedVariant[]; images: { src: string; alt?: string; position: number }[]; errors: { line: number; message: string }[];
}

const num = (v: string | undefined) => (v === undefined || v === '' ? undefined : Number(v));

/** Turn the rows of one handle into product + variants + images, collecting row-level problems. */
export function parseProductGroup(handle: string, rows: CsvRow[], currency: string): ParsedProduct {
  const p: ParsedProduct = { handle, input: {}, optionNames: [], variants: [], images: [], errors: [] };
  const err = (line: number, message: string) => p.errors.push({ line, message });
  const first = lowerKeys(rows[0]!.row);
  const money = (line: number, label: string, v: string | undefined): number | null | undefined => {
    if (!v) return undefined;
    try { const m = parseMoney(v, currency); if (m < 0) { err(line, `${label} cannot be negative`); return undefined; } return m; } catch { err(line, `${label} "${v}" is not a number`); return undefined; }
  };

  if (first['title']) p.input.title = first['title'];
  p.input.handle = handle;
  if ('body (html)' in first) p.input.descriptionHtml = rows[0]!.row['Body (HTML)'] ?? first['body (html)'];
  if (first['vendor']) p.input.vendor = first['vendor'];
  if (first['type']) p.input.productType = first['type'];
  if ('tags' in first && first['tags']) p.input.tags = splitTags(first['tags']);
  if (first['seo title'] || first['seo description']) p.input.seo = { title: first['seo title'] || null, description: first['seo description'] || null };
  if (first['product category']) p.input.metafields = [{ ownerType: 'PRODUCT', ownerId: 0, namespace: 'shopme', key: 'product_category', type: 'single_line_text_field', value: first['product category'] }];
  const status = first['status']?.toUpperCase();
  if (status) { if (['ACTIVE', 'DRAFT', 'ARCHIVED'].includes(status)) p.input.status = status; else err(rows[0]!.line, `Status "${first['status']}" is invalid (active, draft or archived)`); }
  else { const pub = parseBool(first['published']); if (pub !== undefined) p.input.status = pub ? 'ACTIVE' : 'DRAFT'; }

  const names = [1, 2, 3].map((n) => first[`option${n} name`] ?? '').filter(Boolean);
  const isDefault = names.length === 1 && names[0]!.toLowerCase() === 'title' && first['option1 value']?.toLowerCase() === 'default title';
  p.optionNames = isDefault ? [] : names;

  const seen = new Set<string>();
  for (const [idx, { line, row }] of rows.entries()) {
    const r = lowerKeys(row);
    const src = r['image src'];
    if (src) {
      if (!/^https?:\/\//i.test(src)) err(line, `Image Src "${src}" is not an http(s) URL`);
      else if (!p.images.some((i) => i.src === src)) p.images.push({ src, alt: r['image alt text'] || undefined, position: num(r['image position']) ?? p.images.length + 1 });
    }
    const optionValues = p.optionNames.map((_, i) => r[`option${i + 1} value`] ?? '');
    const hasVariantData = idx === 0 || optionValues.some(Boolean) || ['variant sku', 'variant price', 'variant grams', 'variant inventory qty', 'variant barcode'].some((k) => r[k]);
    if (!hasVariantData) continue;
    const missing = optionValues.findIndex((v) => !v);
    if (p.optionNames.length && missing >= 0) { err(line, `Option${missing + 1} Value is blank`); continue; }
    const key = optionValues.join('\u0001').toLowerCase();
    if (seen.has(key)) { err(line, 'Duplicate variant (same option values)'); continue; }
    seen.add(key);

    const input: VariantInput = { optionValues: p.optionNames.map((n, i) => ({ optionName: n, name: optionValues[i]! })), inventoryItem: {} };
    const price = money(line, 'Variant Price', r['variant price']);
    if (price !== undefined) input.price = price;
    if ('variant compare at price' in r) input.compareAtPrice = money(line, 'Variant Compare At Price', r['variant compare at price']) ?? null;
    if (r['variant barcode'] !== undefined && 'variant barcode' in r) input.barcode = r['variant barcode'] || null;
    const taxable = parseBool(r['variant taxable']); if (taxable !== undefined) input.taxable = taxable;
    const policy = r['variant inventory policy']?.toUpperCase();
    if (policy) { if (policy === 'DENY' || policy === 'CONTINUE') input.inventoryPolicy = policy; else err(line, `Variant Inventory Policy "${r['variant inventory policy']}" must be deny or continue`); }
    const item = input.inventoryItem!;
    if (r['variant sku']) item.sku = r['variant sku'];
    const requires = parseBool(r['variant requires shipping']); if (requires !== undefined) item.requiresShipping = requires;
    const cost = money(line, 'Cost per item', r['cost per item']); if (cost !== undefined) item.cost = cost;
    const grams = num(r['variant grams']);
    if (grams !== undefined) {
      if (!Number.isFinite(grams) || grams < 0) err(line, `Variant Grams "${r['variant grams']}" is invalid`);
      else item.weight = { value: grams, unit: 'GRAMS' };
    }
    if (r['variant weight unit'] && !WEIGHT_UNIT_CODES[r['variant weight unit'].toLowerCase()]) err(line, `Variant Weight Unit "${r['variant weight unit']}" must be g, kg, lb or oz`);
    let qty: number | undefined;
    if (r['variant inventory qty']) {
      qty = Number(r['variant inventory qty']);
      if (!Number.isInteger(qty) || qty < 0) { err(line, `Variant Inventory Qty "${r['variant inventory qty']}" must be a non-negative integer`); qty = undefined; }
      else item.tracked = true;
    }
    if (r['variant inventory tracker']) item.tracked = true;
    if (!Object.keys(item).length) delete input.inventoryItem; // an empty patch is not a valid update
    p.variants.push({ line, options: optionValues, input, qty, imageSrc: r['variant image'] || undefined });
  }
  p.images.sort((a, b) => a.position - b.position);
  return p;
}

/** Existing media of a product keyed by original filename, so re-importing the same CSV does not duplicate images. */
async function mediaByFilename(db: Db, shopId: number, productId: number): Promise<Map<string, number>> {
  const rows = await db.select({ id: media.id, filename: files.filename }).from(productMedia).innerJoin(media, eq(media.id, productMedia.mediaId)).innerJoin(files, eq(files.id, media.fileId))
    .where(and(eq(productMedia.shopId, shopId), eq(productMedia.productId, productId)));
  return new Map(rows.map((r) => [r.filename, r.id]));
}

const unwrap = <T>(r: Result<T>, line: number, rep: Reporter): T | null => {
  if (r.ok) return r.value;
  for (const e of r.errors) rep.error(`${e.field?.join('.') ?? 'product'}: ${e.message}`, line);
  return null;
};

/** Create or update one product (by handle) with its variants, images and stock. Returns what happened, or null after reporting errors. */
export async function writeProduct(env: ImportEnv, p: ParsedProduct, line: number, rep: Reporter): Promise<{ outcome: 'created' | 'updated'; productId: number } | null> {
  const { db, shopId } = env;
  const existing = await getProductByHandle(db, shopId, p.handle);
  const input: ProductInput = { ...p.input, metafields: p.input.metafields?.map((m) => ({ ...m })) };
  let productId: number;
  if (existing) {
    const r = unwrap(await updateProduct(db, shopId, existing.id, input), line, rep);
    if (!r) return null;
    productId = existing.id;
  } else {
    const r = unwrap(await createProduct(db, shopId, input), line, rep);
    if (!r) return null;
    productId = r.id;
  }

  // --- images (downloaded into storage); variants may point at them via "Variant Image"
  const byName = await mediaByFilename(db, shopId, productId);
  const mediaBySrc = new Map<string, number>();
  const toAdd: { src: string; input: MediaInput }[] = [];
  for (const img of p.images) {
    const name = urlFilename(img.src);
    if (byName.has(name)) { mediaBySrc.set(img.src, byName.get(name)!); continue; }
    const local = await importImage(env, img.src, img.alt);
    if (!local) { rep.error(`Image could not be downloaded: ${img.src}`, line); continue; }
    toAdd.push({ src: img.src, input: { originalSource: local, alt: img.alt ?? null, mediaContentType: 'IMAGE' } });
  }
  if (toAdd.length) {
    const made = unwrap(await createProductMedia(db, shopId, productId, toAdd.map((a) => a.input)), line, rep);
    made?.forEach((m, i) => mediaBySrc.set(toAdd[i]!.src, m.id));
  }
  for (const v of p.variants) if (v.imageSrc && mediaBySrc.has(v.imageSrc)) v.input.mediaId = mediaBySrc.get(v.imageSrc)!;

  // --- variants
  const loc = await defaultLocationId(db, shopId);
  const standalone = async () => { const o = await getProductOptions(db, shopId, productId); return o.length === 1 && o[0]!.name === 'Title' && o[0]!.values.length === 1 && o[0]!.values[0]!.name === 'Default Title'; };
  const current = await listVariants(db, shopId, { productId, offset: 0, limit: 2048 });
  const wantsStock = (v: ParsedVariant) => v.qty !== undefined && loc !== null;
  const setStock = async (variantId: number, qty: number) => {
    const item = await getInventoryItemForVariant(db, shopId, variantId);
    if (item && loc !== null) unwrap(await setQuantities(db, shopId, { name: 'available', reason: 'correction', quantities: [{ inventoryItemId: item.id, locationId: loc, quantity: qty }] }), line, rep);
  };

  if (!p.optionNames.length) {
    const v = p.variants[0]!;
    const target = (v.input.inventoryItem?.sku && current.find((c) => c.sku === v.input.inventoryItem!.sku)) || current[0];
    if (target && (existing || current.length === 1)) {
      const { optionValues: _o, ...rest } = v.input;
      unwrap(await bulkUpdateVariants(db, shopId, productId, [{ ...rest, id: target.id }]), v.line, rep);
      if (wantsStock(v)) await setStock(target.id, v.qty!);
    }
  } else if (!existing || (await standalone())) {
    const inputs = p.variants.map((v) => ({ ...v.input, inventoryQuantities: wantsStock(v) ? [{ locationId: loc!, availableQuantity: v.qty! }] : undefined }));
    unwrap(await bulkCreateVariants(db, shopId, productId, inputs), p.variants[0]!.line, rep);
  } else {
    const opts = await getProductOptions(db, shopId, productId);
    if (opts.map((o) => o.name.toLowerCase()).join('|') !== p.optionNames.map((n) => n.toLowerCase()).join('|')) {
      rep.error(`Options (${p.optionNames.join(', ')}) differ from the existing product's options (${opts.map((o) => o.name).join(', ')})`, line);
    } else {
      const selected = await getSelectedOptions(db, shopId, current.map((c) => c.id));
      const idOf = new Map(current.map((c) => [(selected.get(c.id) ?? []).map((s) => s.value).join('\u0001').toLowerCase(), c.id]));
      for (const v of p.variants) {
        const id = idOf.get(v.options.join('\u0001').toLowerCase());
        if (id) {
          const { optionValues: _o, ...rest } = v.input;
          unwrap(await bulkUpdateVariants(db, shopId, productId, [{ ...rest, id }]), v.line, rep);
          if (wantsStock(v)) await setStock(id, v.qty!);
        } else unwrap(await bulkCreateVariants(db, shopId, productId, [{ ...v.input, inventoryQuantities: wantsStock(v) ? [{ locationId: loc!, availableQuantity: v.qty! }] : undefined }]), v.line, rep);
      }
    }
  }
  return { outcome: existing ? 'updated' : 'created', productId };
}

/** Import a Shopify-style product CSV: one product per Handle, upserted by handle; variants matched by option values (or SKU). */
export async function importProducts(env: ImportEnv, rows: AsyncIterable<CsvRow>, rep: Reporter): Promise<void> {
  const shop = await getShop(env.db, env.shopId);
  const currency = shop?.currency ?? 'USD';
  let group: CsvRow[] = [];
  let handle = '';
  let processed = 0;

  const flush = async () => {
    if (!group.length) return;
    const rowsIn = group; const h = handle; group = [];
    const parsed = parseProductGroup(h, rowsIn, currency);
    const existing = await getProductByHandle(env.db, env.shopId, h);
    if (!existing && !parsed.input.title) parsed.errors.push({ line: rowsIn[0]!.line, message: 'Title is required for a new product' });
    if (parsed.errors.length) { for (const e of parsed.errors) rep.error(e.message, e.line); rep.count('failed'); }
    else if (env.dryRun) rep.count(existing ? 'updated' : 'created');
    else {
      try {
        const out = await writeProduct(env, parsed, rowsIn[0]!.line, rep);
        rep.count(out?.outcome ?? 'failed');
      } catch (e) { rep.error(e instanceof Error ? e.message : String(e), rowsIn[0]!.line); rep.count('failed'); }
    }
    processed += rowsIn.length;
    await rep.progress(processed, null, 'products');
  };

  for await (const item of rows) {
    const r = lowerKeys(item.row);
    const h = r['handle'] || (r['title'] ? slugify(r['title']) : handle);
    if (!h) { rep.error('Handle is blank', item.line); rep.count('skipped'); continue; }
    if (h !== handle) { await flush(); handle = h; }
    group.push(item);
  }
  await flush();
}

/** Stream a product CSV (one row per variant plus extra rows for images beyond the variant count). */
export async function* exportProducts(db: Db, shopId: number, baseUrl = ''): AsyncGenerator<string> {
  const shop = await getShop(db, shopId);
  const currency = shop?.currency ?? 'USD';
  yield csvLine(PRODUCT_COLUMNS);
  const abs = (u: string | null) => (u ? (u.startsWith('/') ? baseUrl.replace(/\/$/, '') + u : u) : '');
  let after = 0;
  for (;;) {
    const batch = await db.select().from(products).where(and(eq(products.shopId, shopId), gt(products.id, after))).orderBy(asc(products.id)).limit(100);
    if (!batch.length) return;
    after = batch.at(-1)!.id;
    for (const p of batch) {
      const [options, variants, images] = await Promise.all([getProductOptions(db, shopId, p.id), listVariants(db, shopId, { productId: p.id, offset: 0, limit: 2048 }), listProductMedia(db, shopId, p.id, { offset: 0, limit: 250 })]);
      const ids = variants.map((v) => v.id);
      const [selected, stock, items, category] = await Promise.all([
        getSelectedOptions(db, shopId, ids), availableByVariant(db, shopId, ids),
        ids.length ? db.select().from(inventoryItems).where(inArray(inventoryItems.variantId, ids)) : [],
        db.query.metafields.findFirst({ where: (m, { and: a, eq: e }) => a(e(m.shopId, shopId), e(m.ownerType, 'PRODUCT'), e(m.ownerId, p.id), e(m.namespace, 'shopme'), e(m.key, 'product_category')) }),
      ]);
      const itemOf = new Map(items.map((i) => [i.variantId, i]));
      const urlOf = new Map(images.map((m) => [m.id, abs(m.url)]));
      const hasOptions = !(options.length === 1 && options[0]!.name === 'Title' && options[0]!.values.length === 1);
      const optNames = hasOptions ? options.map((o) => o.name) : ['Title'];
      for (let i = 0; i < Math.max(variants.length, images.length, 1); i++) {
        const v = variants[i]; const img = images[i]; const item = v ? itemOf.get(v.id) : undefined;
        const grams = item?.weightValue != null ? Math.round(item.weightValue * (WEIGHT_KG[item.weightUnit ?? 'KILOGRAMS'] ?? 1) * 1000) : '';
        const sel = v ? selected.get(v.id) ?? [] : [];
        const optCells = [0, 1, 2].flatMap((n) => [i === 0 ? optNames[n] ?? '' : '', v ? (hasOptions ? sel[n]?.value ?? '' : n === 0 ? 'Default Title' : '') : '']);
        yield csvLine([
          p.handle, i === 0 ? p.title : '', i === 0 ? p.descriptionHtml : '', i === 0 ? p.vendor : '', i === 0 ? category?.value ?? '' : '', i === 0 ? p.productType : '', i === 0 ? p.tags.join(', ') : '', i === 0 ? (p.status === 'ACTIVE' ? 'true' : 'false') : '',
          ...optCells,
          v ? item?.sku ?? v.sku ?? '' : '', v ? grams : '', v && item?.tracked ? 'shopify' : '', v && item?.tracked ? stock.get(v.id) ?? 0 : '', v ? v.inventoryPolicy.toLowerCase() : '',
          v ? decimal(v.price, currency) : '', v && v.compareAtPrice != null ? decimal(v.compareAtPrice, currency) : '',
          v ? String(item?.requiresShipping ?? true) : '', v ? String(v.taxable) : '', v?.barcode ?? '',
          img ? abs(img.url) : '', img ? i + 1 : '', img?.alt ?? '',
          i === 0 ? p.seoTitle ?? '' : '', i === 0 ? p.seoDescription ?? '' : '', v?.mediaId ? urlOf.get(v.mediaId) ?? '' : '',
          v ? UNIT_CODE_OF[(item?.weightUnit ?? 'KILOGRAMS') as keyof typeof UNIT_CODE_OF] : '', v && item?.unitCost != null ? decimal(item.unitCost, currency) : '',
          i === 0 ? p.status.toLowerCase() : '',
        ]);
      }
    }
  }
}
