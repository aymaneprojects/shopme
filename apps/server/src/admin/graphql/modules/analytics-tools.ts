/**
 * ShopMe analytics tools (no Shopify equivalent): pinned and recently viewed reports, goals, chart annotations, saved explorations
 * (custom reports) and the live view.
 */
import { GraphQLError } from 'graphql';
import {
  createAnnotation, deleteAnnotation, deleteExploration, deleteGoal, explorationCatalog, getExploration, goalProgress, listAnnotations, listExplorations, listReportStates, liveView, reportCurrencies, runExploration,
  saveExploration, setGoal, setReportPinned, touchReport, GOAL_METRICS, GOAL_PERIODS,
  type Annotation, type Exploration, type GoalProgress, type LiveView, type ReportState,
} from '@shopme/core';
import { parseId, toGid } from '@shopme/shopify-compat';
import { builder } from '../builder';
import { requireScope, type GraphQLContext } from '../context';
import { definePayload } from '../types/errors';
import { getShop } from '@shopme/core';

const staffOf = (ctx: GraphQLContext) => (ctx.auth.kind === 'session' ? ctx.auth.user.id : null);
const needStaff = (ctx: GraphQLContext) => { const id = staffOf(ctx); if (id == null) throw new GraphQLError('A staff session is required', { extensions: { code: 'BAD_REQUEST' } }); return id; };
const todayIn = (tz: string) => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date()); } catch { return new Date().toISOString().slice(0, 10); } };

const GoalMetric = builder.enumType('ShopmeGoalMetric', { values: GOAL_METRICS });
const GoalPeriod = builder.enumType('ShopmeGoalPeriod', { values: GOAL_PERIODS });

const ReportStateType = builder.objectRef<ReportState>('ShopmeReportState').implement({
  fields: (t) => ({ key: t.string({ resolve: (s) => s.reportKey }), pinned: t.exposeBoolean('pinned'), lastViewedAt: t.field({ type: 'DateTime', nullable: true, resolve: (s) => s.lastViewedAt }) }),
});
const GoalType = builder.objectRef<GoalProgress>('ShopmeGoal').implement({
  fields: (t) => ({
    id: t.id({ resolve: (g) => toGid('ShopmeGoal', g.goal.id) }), metric: t.field({ type: GoalMetric, resolve: (g) => g.goal.metric as 'TOTAL_SALES' }), period: t.field({ type: GoalPeriod, resolve: (g) => g.goal.period as 'MONTH' }),
    target: t.float({ resolve: (g) => g.goal.target }), actual: t.float({ resolve: (g) => g.actual }), from: t.exposeString('from'), to: t.exposeString('to'),
    elapsed: t.float({ description: 'Share of the period that has passed, 0 to 1.', resolve: (g) => g.elapsed }),
  }),
});
const AnnotationType = builder.objectRef<Annotation>('ShopmeAnnotation').implement({
  fields: (t) => ({
    id: t.id({ resolve: (a) => toGid('ShopmeAnnotation', a.id) }), day: t.exposeString('day'), text: t.exposeString('text'), reportKey: t.exposeString('reportKey', { nullable: true }),
    createdAt: t.field({ type: 'DateTime', resolve: (a) => a.createdAt }),
  }),
});
const ExplorationType = builder.objectRef<Exploration>('ShopmeExploration').implement({
  fields: (t) => ({
    id: t.id({ resolve: (e) => toGid('ShopmeExploration', e.id) }), name: t.exposeString('name'), definition: t.field({ type: 'JSON', resolve: (e) => e.definition }),
    createdByName: t.exposeString('createdByName', { nullable: true }), createdAt: t.field({ type: 'DateTime', resolve: (e) => e.createdAt }), updatedAt: t.field({ type: 'DateTime', resolve: (e) => e.updatedAt }),
  }),
});
type RunResult = Extract<Awaited<ReturnType<typeof runExploration>>, { ok: true }>['value'];
const RunColumn = builder.objectRef<{ key: string; label: string; type: string }>('ShopmeExplorationColumn').implement({ fields: (t) => ({ key: t.exposeString('key'), label: t.exposeString('label'), type: t.exposeString('type') }) });
const RunType = builder.objectRef<RunResult>('ShopmeExplorationResult').implement({
  fields: (t) => ({
    currencyCode: t.exposeString('currency'), from: t.exposeString('from'), to: t.exposeString('to'), columns: t.field({ type: [RunColumn], resolve: (r) => r.columns }),
    rows: t.field({ type: 'JSON', resolve: (r) => r.rows }), totals: t.field({ type: 'JSON', resolve: (r) => r.totals }),
  }),
});
const Currency = builder.objectRef<{ code: string; rate: number }>('ShopmeReportCurrency').implement({ fields: (t) => ({ code: t.exposeString('code'), rate: t.exposeFloat('rate') }) });

const LiveMinute = builder.objectRef<LiveView['viewsPerMinute'][number]>('ShopmeLiveMinute').implement({ fields: (t) => ({ minute: t.exposeString('minute'), views: t.exposeInt('views') }) });
const LivePage = builder.objectRef<LiveView['topPages'][number]>('ShopmeLivePage').implement({ fields: (t) => ({ path: t.exposeString('path'), views: t.exposeInt('views') }) });
const LiveSource = builder.objectRef<LiveView['topSources'][number]>('ShopmeLiveSource').implement({ fields: (t) => ({ source: t.exposeString('source'), sessions: t.exposeInt('sessions') }) });
const LiveOrder = builder.objectRef<LiveView['recentOrders'][number]>('ShopmeLiveOrder').implement({
  fields: (t) => ({ id: t.id({ resolve: (o) => toGid('Order', o.id) }), name: t.exposeString('name'), total: t.float({ resolve: (o) => o.total }), createdAt: t.field({ type: 'DateTime', resolve: (o) => new Date(o.createdAt) }), country: t.exposeString('country', { nullable: true }) }),
});
const LiveCountry = builder.objectRef<LiveView['countries'][number]>('ShopmeLiveCountry').implement({
  description: 'Active visitors of one country. The country comes from the browser time zone; no IP address or precise location is stored.',
  fields: (t) => ({ countryCode: t.exposeString('countryCode'), visitors: t.exposeInt('visitors') }),
});
const LiveType = builder.objectRef<LiveView>('ShopmeLiveView').implement({
  description: 'Real-time store activity from the first-party visit log. `salesToday` is in minor units of `currencyCode`.',
  fields: (t) => ({
    at: t.field({ type: 'DateTime', resolve: (l) => new Date(l.at) }), currencyCode: t.exposeString('currency'), visitorsNow: t.exposeInt('visitorsNow'), sessionsToday: t.exposeInt('sessionsToday'),
    ordersToday: t.exposeInt('ordersToday'), salesToday: t.float({ resolve: (l) => l.salesToday }), activeCarts: t.exposeInt('activeCarts'), checkoutsNow: t.exposeInt('checkoutsNow', { description: 'Active carts whose buyer has reached the checkout (e-mail or shipping address given).' }),
    viewsPerMinute: t.field({ type: [LiveMinute], resolve: (l) => l.viewsPerMinute }), topPages: t.field({ type: [LivePage], resolve: (l) => l.topPages }),
    topSources: t.field({ type: [LiveSource], resolve: (l) => l.topSources }), recentOrders: t.field({ type: [LiveOrder], resolve: (l) => l.recentOrders }),
    countries: t.field({ type: [LiveCountry], description: 'Visitors of the last 5 minutes by country, most first.', resolve: (l) => l.countries }),
    visitorsUnlocated: t.exposeInt('visitorsUnlocated', { description: 'Visitors of the last 5 minutes whose country is unknown (no consent for analytics, no time zone, or a zone without a country).' }),
  }),
});

builder.queryFields((t) => ({
  shopmeReportStates: t.field({ type: [ReportStateType], resolve: async (_r, _a, ctx) => { requireScope(ctx, 'read_reports'); const id = staffOf(ctx); return id == null ? [] : listReportStates(ctx.db, ctx.shopId, id); } }),
  shopmeReportCurrencies: t.field({ type: [Currency], resolve: (_r, _a, ctx) => { requireScope(ctx, 'read_reports'); return reportCurrencies(ctx.db, ctx.shopId); } }),
  shopmeGoals: t.field({
    type: [GoalType], resolve: async (_r, _a, ctx) => { requireScope(ctx, 'read_reports'); const shop = await getShop(ctx.db, ctx.shopId); return goalProgress(ctx.db, ctx.shopId, todayIn(shop!.timezone)); },
  }),
  shopmeAnnotations: t.field({
    type: [AnnotationType], args: { reportKey: t.arg.string(), from: t.arg.string(), to: t.arg.string() },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_reports'); return listAnnotations(ctx.db, ctx.shopId, { reportKey: a.reportKey, from: a.from ?? undefined, to: a.to ?? undefined }); },
  }),
  shopmeExplorations: t.field({ type: [ExplorationType], resolve: (_r, _a, ctx) => { requireScope(ctx, 'read_reports'); return listExplorations(ctx.db, ctx.shopId); } }),
  shopmeExploration: t.field({
    type: ExplorationType, nullable: true, args: { id: t.arg.id({ required: true }) },
    resolve: (_r, a, ctx) => { requireScope(ctx, 'read_reports'); const id = parseId(String(a.id), 'ShopmeExploration'); return id ? getExploration(ctx.db, ctx.shopId, id) : null; },
  }),
  shopmeExplorationCatalog: t.field({ type: 'JSON', description: 'Datasets with their metrics, dimensions and filter fields.', resolve: (_r, _a, ctx) => { requireScope(ctx, 'read_reports'); return explorationCatalog(); } }),
  shopmeExplorationRun: t.field({
    type: RunType, args: { definition: t.arg({ type: 'JSON', required: true }), from: t.arg.string({ required: true }), to: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'read_reports');
      const r = await runExploration(ctx.db, ctx.shopId, a.definition, a.from, a.to);
      if (!r.ok) throw new GraphQLError(r.errors[0]!.message, { extensions: { code: 'BAD_USER_INPUT' } });
      return r.value;
    },
  }),
  shopmeLiveView: t.field({ type: LiveType, resolve: (_r, _a, ctx) => { requireScope(ctx, 'read_reports'); return liveView(ctx.db, ctx.shopId); } }),
}));

const ReportKeyPayload = definePayload<{ state: ReportState | null }>('ShopmeReportStatePayload', (t) => ({ state: t.field({ type: ReportStateType, nullable: true, resolve: (p) => p.state }) }));
const GoalPayload = definePayload<{ goalId: string | null }>('ShopmeGoalPayload', (t) => ({ goalId: t.id({ nullable: true, resolve: (p) => p.goalId }) }));
const AnnotationPayload = definePayload<{ annotation: Annotation | null }>('ShopmeAnnotationPayload', (t) => ({ annotation: t.field({ type: AnnotationType, nullable: true, resolve: (p) => p.annotation }) }));
const DeletedPayload = (name: string) => definePayload<{ deletedId: string | null }>(name, (t) => ({ deletedId: t.id({ nullable: true, resolve: (p) => p.deletedId }) }));
const ExplorationPayload = definePayload<{ exploration: Exploration | null }>('ShopmeExplorationPayload', (t) => ({ exploration: t.field({ type: ExplorationType, nullable: true, resolve: (p) => p.exploration }) }));
const GoalDeletePayload = DeletedPayload('ShopmeGoalDeletePayload'), AnnotationDeletePayload = DeletedPayload('ShopmeAnnotationDeletePayload'), ExplorationDeletePayload = DeletedPayload('ShopmeExplorationDeletePayload');
const gone = (field: string, message: string) => [{ field: [field], message, code: 'DOES_NOT_EXIST' }];

builder.mutationFields((t) => ({
  shopmeReportPin: t.field({
    type: ReportKeyPayload, args: { key: t.arg.string({ required: true }), pinned: t.arg.boolean({ required: true }) },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'read_reports'); const r = await setReportPinned(ctx.db, ctx.shopId, needStaff(ctx), a.key, a.pinned); return r.ok ? { state: r.value, userErrors: [] } : { state: null, userErrors: r.errors }; },
  }),
  shopmeReportViewed: t.field({
    type: ReportKeyPayload, args: { key: t.arg.string({ required: true }) },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'read_reports'); const id = staffOf(ctx); if (id == null) return { state: null, userErrors: [] }; const r = await touchReport(ctx.db, ctx.shopId, id, a.key); return r.ok ? { state: r.value, userErrors: [] } : { state: null, userErrors: r.errors }; },
  }),
  shopmeGoalSet: t.field({
    type: GoalPayload, args: { metric: t.arg({ type: GoalMetric, required: true }), period: t.arg({ type: GoalPeriod, required: true }), target: t.arg.float({ required: true, description: 'Minor units for money metrics.' }) },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'write_reports'); const r = await setGoal(ctx.db, ctx.shopId, a, staffOf(ctx)); return r.ok ? { goalId: toGid('ShopmeGoal', r.value.id), userErrors: [] } : { goalId: null, userErrors: r.errors }; },
  }),
  shopmeGoalDelete: t.field({
    type: GoalDeletePayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'write_reports'); const id = parseId(String(a.id), 'ShopmeGoal'); const r = id ? await deleteGoal(ctx.db, ctx.shopId, id) : null; return r?.ok ? { deletedId: toGid('ShopmeGoal', id!), userErrors: [] } : { deletedId: null, userErrors: r && !r.ok ? r.errors : gone('id', 'Goal does not exist') }; },
  }),
  shopmeAnnotationCreate: t.field({
    type: AnnotationPayload, args: { day: t.arg.string({ required: true }), text: t.arg.string({ required: true }), reportKey: t.arg.string() },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'write_reports'); const r = await createAnnotation(ctx.db, ctx.shopId, a, staffOf(ctx)); return r.ok ? { annotation: r.value, userErrors: [] } : { annotation: null, userErrors: r.errors }; },
  }),
  shopmeAnnotationDelete: t.field({
    type: AnnotationDeletePayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'write_reports'); const id = parseId(String(a.id), 'ShopmeAnnotation'); const r = id ? await deleteAnnotation(ctx.db, ctx.shopId, id) : null; return r?.ok ? { deletedId: toGid('ShopmeAnnotation', id!), userErrors: [] } : { deletedId: null, userErrors: r && !r.ok ? r.errors : gone('id', 'Annotation does not exist') }; },
  }),
  shopmeExplorationSave: t.field({
    type: ExplorationPayload, args: { id: t.arg.id(), name: t.arg.string({ required: true }), definition: t.arg({ type: 'JSON', required: true }) },
    resolve: async (_r, a, ctx) => {
      requireScope(ctx, 'write_reports');
      const id = a.id ? parseId(String(a.id), 'ShopmeExploration') : null;
      if (a.id && !id) return { exploration: null, userErrors: gone('id', 'Exploration does not exist') };
      const r = await saveExploration(ctx.db, ctx.shopId, { id, name: a.name, definition: a.definition }, staffOf(ctx));
      return r.ok ? { exploration: r.value, userErrors: [] } : { exploration: null, userErrors: r.errors };
    },
  }),
  shopmeExplorationDelete: t.field({
    type: ExplorationDeletePayload, args: { id: t.arg.id({ required: true }) },
    resolve: async (_r, a, ctx) => { requireScope(ctx, 'write_reports'); const id = parseId(String(a.id), 'ShopmeExploration'); const r = id ? await deleteExploration(ctx.db, ctx.shopId, id) : null; return r?.ok ? { deletedId: toGid('ShopmeExploration', id!), userErrors: [] } : { deletedId: null, userErrors: r && !r.ok ? r.errors : gone('id', 'Exploration does not exist') }; },
  }),
}));
