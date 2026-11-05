import {
  addRedeemCodes, changeDiscountTags, countRedeemCodes, deleteCodeDiscount, deleteRedeemCodes, generateRedeemCodes, getCodeBulkCreation, getCodeDiscount, getRedeemCodes, getSavedSearch, listCodeDiscounts,
  listDiscountTags, listRedeemCodes, matchingDiscountIds, setDiscountActive, MAX_GENERATED_CODES, REDEEM_CODES_PER_CALL, type CodeCharacterSet, type DiscountCodeBulkCreation, type DiscountKind,
} from '@shopme/core';
import { parseId, type UserError } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope, type GraphQLContext } from '../context';
import { ConnectionArgs, defineConnection, paginate, paginateArray } from '../types/connection';
import { Count } from '../types/money';
import { Node, registerNode } from '../types/node';
import { Job, StringConnection } from '../types/catalog';
import { AutomaticSortKeys, CodeNode, DiscountAutomaticUnion, DiscountUserError, RedeemCode, autoId, codeId, load, withCurrency } from './discounts';
import { completedJob } from './jobs';

/** Discount parity: bulk code creation, bulk edits by ids/search/saved search, counts, tags and the legacy automatic discount reads. */

const TagSortKeys = builder.enumType('DiscountTagSortKeys', { values: ['ID', 'TITLE'] as const });
const CharacterSet = builder.enumType('ShopmeDiscountCodeCharacterSet', {
  description: 'Characters used for the random part of generated discount codes.',
  values: { ALPHANUMERIC: { description: 'A-Z and 0-9' }, LETTERS: { description: 'A-Z' }, DIGITS: { description: '0-9' }, UNAMBIGUOUS: { description: 'A-Z and 2-9 without look-alike characters (0, O, 1, I, L)' } } as const,
});

type Err = UserError & { extraInfo?: string | null };
const fail = (field: string[] | null, message: string, code: string): Err[] => [{ field, message, code }];

/* ------------------------------ bulk creation ------------------------------ */

type CreationCode = DiscountCodeBulkCreation['results'][number];
const CreationCodeRef = builder.objectRef<CreationCode & { createdAt: Date; usageCount: number }>('DiscountRedeemCodeBulkCreationCode').implement({
  fields: (t) => ({
    code: t.exposeString('code'),
    discountRedeemCode: t.field({ type: RedeemCode, nullable: true, resolve: (c) => (c.codeId ? { id: c.codeId, code: c.code, usageCount: c.usageCount, createdAtIso: c.createdAt } : null) }),
    errors: t.field({ type: [DiscountUserError], resolve: (c) => c.errors }),
  }),
});
const CreationCodeConnection = defineConnection('DiscountRedeemCodeBulkCreationCode', CreationCodeRef);

const BulkCreation = builder.objectRef<DiscountCodeBulkCreation>('DiscountRedeemCodeBulkCreation');
BulkCreation.implement({
  interfaces: [Node],
  fields: (t) => ({
    codesCount: t.exposeInt('codesCount'), importedCount: t.exposeInt('importedCount'), failedCount: t.exposeInt('failedCount'), done: t.exposeBoolean('done'),
    createdAt: t.field({ type: 'DateTime', resolve: (c) => c.createdAt }),
    discountCode: t.field({
      type: CodeNode, nullable: true,
      resolve: async (c, _a, ctx) => withCurrency(ctx, await getCodeDiscount(ctx.db, ctx.shopId, c.discountId)),
    }),
    codes: t.field({
      type: CreationCodeConnection, args: ConnectionArgs,
      resolve: async (c, a, ctx) => {
        const rows = await getRedeemCodes(ctx.db, ctx.shopId, c.results.flatMap((r) => (r.codeId ? [r.codeId] : [])));
        const used = new Map(rows.map((r) => [r.id, r.usageCount]));
        const all = c.results.map((r) => ({ ...r, createdAt: c.createdAt, usageCount: (r.codeId && used.get(r.codeId)) || 0 }));
        return paginateArray(a, a.reverse ? all.reverse() : all);
      },
    }),
  }),
});
registerNode('DiscountRedeemCodeBulkCreation', (ctx, id) => getCodeBulkCreation(ctx.db, ctx.shopId, id));

const BulkAddPayload = builder.objectRef<{ bulkCreation: DiscountCodeBulkCreation | null; userErrors: Err[] }>('DiscountRedeemCodeBulkAddPayload').implement({
  fields: (t) => ({ bulkCreation: t.field({ type: BulkCreation, nullable: true, resolve: (p) => p.bulkCreation }), userErrors: t.field({ type: [DiscountUserError], resolve: (p) => p.userErrors }) }),
});
const GeneratePayload = builder.objectRef<{ bulkCreation: DiscountCodeBulkCreation | null; userErrors: Err[] }>('ShopmeDiscountCodesGeneratePayload').implement({
  fields: (t) => ({ bulkCreation: t.field({ type: BulkCreation, nullable: true, resolve: (p) => p.bulkCreation }), userErrors: t.field({ type: [DiscountUserError], resolve: (p) => p.userErrors }) }),
});
const RedeemCodeInput = builder.inputType('DiscountRedeemCodeInput', { fields: (t) => ({ code: t.string({ required: true }) }) });

/* ------------------------------ job payloads ------------------------------ */

const jobPayload = (name: string) => builder.objectRef<{ job: { id: string; done: boolean } | null; userErrors: Err[] }>(name).implement({
  fields: (t) => ({ job: t.field({ type: Job, nullable: true, resolve: (p) => p.job }), userErrors: t.field({ type: [DiscountUserError], resolve: (p) => p.userErrors }) }),
});
const CodeActivatePayload = jobPayload('DiscountCodeBulkActivatePayload');
const CodeDeactivatePayload = jobPayload('DiscountCodeBulkDeactivatePayload');
const CodeDeletePayload = jobPayload('DiscountCodeBulkDeletePayload');
const AutoDeletePayload = jobPayload('DiscountAutomaticBulkDeletePayload');
const TagsAddPayload = jobPayload('DiscountBulkTagsAddPayload');
const TagsRemovePayload = jobPayload('DiscountBulkTagsRemovePayload');
const RedeemDeletePayload = jobPayload('DiscountCodeRedeemCodeBulkDeletePayload');

/** Exactly one of `ids`, `search`, `savedSearchId` selects the discounts; returns their ids (all of the given kind). */
async function select(ctx: GraphQLContext, a: { ids?: (string | number)[] | null; search?: string | null; savedSearchId?: string | number | null }, kind: DiscountKind | null): Promise<{ ids: number[] } | { errors: Err[] }> {
  const given = [a.ids != null, a.search != null, a.savedSearchId != null].filter(Boolean).length;
  if (given === 0) return { errors: fail(null, 'One of IDs, search argument or saved search ID is required.', 'MISSING_ARGUMENT') };
  if (given > 1) return { errors: fail(null, 'Only one of IDs, search argument or saved search ID is allowed.', 'TOO_MANY_ARGUMENTS') };
  if (a.ids != null) {
    const parse = kind === 'AUTOMATIC' ? autoId : codeId;
    const parsed = a.ids.map(parse);
    if (parsed.some((i) => i == null)) return { errors: fail(['ids'], 'Discount does not exist', 'INVALID') };
    const found = await matchingDiscountIds(ctx.db, ctx.shopId, { ids: parsed as number[], kind });
    if (found.length !== new Set(parsed).size) return { errors: fail(['ids'], 'Discount does not exist', 'INVALID') };
    return { ids: found };
  }
  let query = a.search ?? '';
  if (a.savedSearchId != null) {
    const sid = parseId(String(a.savedSearchId), 'SavedSearch');
    const saved = sid ? await getSavedSearch(ctx.db, ctx.shopId, sid) : null;
    if (!saved) return { errors: fail(['savedSearchId'], 'Saved search does not exist', 'INVALID') };
    query = saved.query;
  }
  return { ids: await matchingDiscountIds(ctx.db, ctx.shopId, { query, kind }) };
}

type Sel = { ids?: (string | number)[] | null; search?: string | null; savedSearchId?: string | number | null };

async function bulk(ctx: GraphQLContext, a: Sel, kind: DiscountKind | null, jobType: string, work: (ids: number[]) => Promise<Err[] | void>) {
  requireScope(ctx, 'write_discounts');
  const s = await select(ctx, a, kind);
  if ('errors' in s) return { job: null, userErrors: s.errors };
  const errors = (await work(s.ids)) ?? [];
  return errors.length ? { job: null, userErrors: errors } : { job: await completedJob(ctx, jobType), userErrors: [] as Err[] };
}

/* ------------------------------ roots ------------------------------ */

builder.queryFields((t) => ({
  discountRedeemCodeBulkCreation: t.field({
    type: BulkCreation, nullable: true, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'read_discounts'); const id = parseId(String(a.id), 'DiscountRedeemCodeBulkCreation'); return id ? getCodeBulkCreation(ctx.db, ctx.shopId, id) : null; },
  }),
  discountCodesCount: t.field({
    type: Count, nullable: true, args: { query: t.arg.string(), limit: t.arg.int({ defaultValue: 10000 }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_discounts'); return countRedeemCodes(ctx.db, ctx.shopId, { query: a.query, limit: a.limit ?? 10000 }); },
  }),
  discountTags: t.field({
    type: StringConnection, args: { ...ConnectionArgs, sortKey: t.arg({ type: TagSortKeys, defaultValue: 'ID' }), query: t.arg.string() },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'read_discounts');
      const tags = await listDiscountTags(ctx.db, ctx.shopId, a.query);
      return paginateArray(a, a.reverse ? [...tags].reverse() : tags);
    },
  }),
  automaticDiscount: t.field({
    type: DiscountAutomaticUnion, nullable: true, deprecationReason: 'Use `automaticDiscountNode` instead.', args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'read_discounts');
      const id = autoId(a.id);
      return (id ? await withCurrency(ctx, await getCodeDiscount(ctx.db, ctx.shopId, id, 'AUTOMATIC')) : null) as never;
    },
  }),
  automaticDiscounts: t.field({
    type: defineConnection('DiscountAutomatic', DiscountAutomaticUnion as never), deprecationReason: 'Use `automaticDiscountNodes` instead. This will be removed in 2027-01.',
    args: { ...ConnectionArgs, sortKey: t.arg({ type: AutomaticSortKeys, defaultValue: 'CREATED_AT' }), query: t.arg.string(), savedSearchId: t.arg.id() },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'read_discounts');
      let query = a.query;
      if (a.savedSearchId) { const sid = parseId(String(a.savedSearchId), 'SavedSearch'); query = (sid && (await getSavedSearch(ctx.db, ctx.shopId, sid))?.query) || query; }
      return paginate(a, {
        fetch: async ({ offset, limit }) => Promise.all((await listCodeDiscounts(ctx.db, ctx.shopId, { query, sortKey: a.sortKey ?? 'CREATED_AT', reverse: !!a.reverse, offset, limit, kind: 'AUTOMATIC' })).map((d) => load(ctx, d))),
        total: async () => (await matchingDiscountIds(ctx.db, ctx.shopId, { query, kind: 'AUTOMATIC' })).length,
      }) as never;
    },
  }),
}));

builder.mutationFields((t) => {
  const sel = () => ({ search: t.arg.string(), savedSearchId: t.arg.id(), ids: t.arg.idList() });
  const toggle = async (ctx: GraphQLContext, ids: number[], active: boolean) => { for (const id of ids) await setDiscountActive(ctx.db, ctx.shopId, id, active); };
  return {
    discountRedeemCodeBulkAdd: t.field({
      type: BulkAddPayload, description: `Adds up to ${REDEEM_CODES_PER_CALL} redeem codes to a code discount. Per-code problems are reported on the bulk creation.`,
      args: { discountId: t.arg.id({ required: true }), codes: t.arg({ type: [RedeemCodeInput], required: true }) },
      resolve: async (_r, a, ctx) => {
        requireScope(ctx, 'write_discounts');
        const id = codeId(a.discountId);
        if (!id) return { bulkCreation: null, userErrors: fail(['discountId'], 'Discount does not exist', 'INVALID') };
        const r = await addRedeemCodes(ctx.db, ctx.shopId, id, a.codes.map((c) => c.code));
        return r.ok ? { bulkCreation: r.value, userErrors: [] } : { bulkCreation: null, userErrors: r.errors };
      },
    }),
    shopmeDiscountCodesGenerate: t.field({
      type: GeneratePayload, description: `Generates \`count\` unique codes (at most ${MAX_GENERATED_CODES}) for a code discount: prefix + random characters + suffix. ShopMe extension.`,
      args: {
        discountId: t.arg.id({ required: true }), count: t.arg.int({ required: true }), length: t.arg.int({ defaultValue: 8 }), prefix: t.arg.string(), suffix: t.arg.string(),
        characterSet: t.arg({ type: CharacterSet, defaultValue: 'ALPHANUMERIC' }),
      },
      resolve: async (_r, a, ctx) => {
        requireScope(ctx, 'write_discounts');
        const id = codeId(a.discountId);
        if (!id) return { bulkCreation: null, userErrors: fail(['discountId'], 'Discount does not exist', 'INVALID') };
        const r = await generateRedeemCodes(ctx.db, ctx.shopId, id, { count: a.count, length: a.length ?? 8, prefix: a.prefix, suffix: a.suffix, characterSet: (a.characterSet ?? 'ALPHANUMERIC') as CodeCharacterSet });
        return r.ok ? { bulkCreation: r.value, userErrors: [] } : { bulkCreation: null, userErrors: r.errors };
      },
    }),
    discountCodeBulkActivate: t.field({ type: CodeActivatePayload, args: sel(), resolve: (_r, a, ctx) => bulk(ctx, a, 'CODE', 'discount.bulk-activate', (ids) => toggle(ctx, ids, true)) }),
    discountCodeBulkDeactivate: t.field({ type: CodeDeactivatePayload, args: sel(), resolve: (_r, a, ctx) => bulk(ctx, a, 'CODE', 'discount.bulk-deactivate', (ids) => toggle(ctx, ids, false)) }),
    discountCodeBulkDelete: t.field({
      type: CodeDeletePayload, args: sel(),
      resolve: (_r, a, ctx) => bulk(ctx, a, 'CODE', 'discount.bulk-delete', async (ids) => { for (const id of ids) await deleteCodeDiscount(ctx.db, ctx.shopId, id); }),
    }),
    discountAutomaticBulkDelete: t.field({
      type: AutoDeletePayload, args: sel(),
      resolve: (_r, a, ctx) => bulk(ctx, a, 'AUTOMATIC', 'discount.bulk-delete-automatic', async (ids) => { for (const id of ids) await deleteCodeDiscount(ctx.db, ctx.shopId, id); }),
    }),
    discountBulkTagsAdd: t.field({
      type: TagsAddPayload, args: { ...sel(), tags: t.arg.stringList({ required: true }) },
      resolve: (_r, a, ctx) => tagsJob(ctx, a, 'add'),
    }),
    discountBulkTagsRemove: t.field({
      type: TagsRemovePayload, args: { ...sel(), tags: t.arg.stringList({ required: true }) },
      resolve: (_r, a, ctx) => tagsJob(ctx, a, 'remove'),
    }),
    discountCodeRedeemCodeBulkDelete: t.field({
      type: RedeemDeletePayload, args: { discountId: t.arg.id({ required: true }), ...sel() },
      resolve: async (_r, a, ctx) => {
        requireScope(ctx, 'write_discounts');
        const discountId = codeId(a.discountId);
        if (!discountId || !(await getCodeDiscount(ctx.db, ctx.shopId, discountId))) return { job: null, userErrors: fail(['discountId'], 'Discount does not exist', 'INVALID') };
        const given = [a.ids != null, a.search != null, a.savedSearchId != null].filter(Boolean).length;
        if (given === 0) return { job: null, userErrors: fail(null, 'One of IDs, search argument or saved search ID is required.', 'MISSING_ARGUMENT') };
        if (given > 1) return { job: null, userErrors: fail(null, 'Only one of IDs, search argument or saved search ID is allowed.', 'TOO_MANY_ARGUMENTS') };
        let ids: number[];
        if (a.ids != null) {
          const parsed = a.ids.map((x) => parseId(String(x), 'DiscountRedeemCode'));
          if (parsed.some((x) => x == null)) return { job: null, userErrors: fail(['ids'], 'Discount code does not exist', 'INVALID') };
          ids = parsed as number[];
        } else {
          let query = a.search ?? '';
          if (a.savedSearchId != null) { const sid = parseId(String(a.savedSearchId), 'SavedSearch'); const s = sid ? await getSavedSearch(ctx.db, ctx.shopId, sid) : null; if (!s) return { job: null, userErrors: fail(['savedSearchId'], 'Saved search does not exist', 'INVALID') }; query = s.query; }
          ids = (await listRedeemCodes(ctx.db, ctx.shopId, { discountId, query, offset: 0, limit: 100000 })).map((c) => c.id);
        }
        const r = await deleteRedeemCodes(ctx.db, ctx.shopId, discountId, ids);
        return r.ok ? { job: await completedJob(ctx, 'discount.redeem-code-bulk-delete'), userErrors: [] } : { job: null, userErrors: r.errors };
      },
    }),
  };
});

async function tagsJob(ctx: GraphQLContext, a: Sel & { tags: string[] }, mode: 'add' | 'remove') {
  if (!a.tags.some((t) => t.trim())) { requireScope(ctx, 'write_discounts'); return { job: null, userErrors: fail(['tags'], "Tags can't be blank", 'BLANK') }; }
  if (a.tags.some((t) => t.trim().length > 255)) { requireScope(ctx, 'write_discounts'); return { job: null, userErrors: fail(['tags'], 'Tags are too long (maximum is 255 characters)', 'TOO_LONG') }; }
  return bulk(ctx, a, null, `discount.bulk-tags-${mode}`, async (ids) => { await changeDiscountTags(ctx.db, ctx.shopId, ids, mode, a.tags); });
}
