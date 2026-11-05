import { bigint, boolean, index, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, pk, ref, shopIdCol, timestamps, ts } from './_helpers';
import { shops } from './shop';

const shopFk = () => shopIdCol().references(() => shops.id, { onDelete: 'cascade' });

/** Per staff member: pinned reports and when each report was last opened. `reportKey` is a report name or `EXPLORATION:<id>`. */
export const analyticsReportStates = pgTable('analytics_report_states', {
  id: pk(), shopId: shopFk(),
  staffUserId: ref('staff_user_id').notNull(),
  reportKey: text('report_key').notNull(),
  pinned: boolean('pinned').notNull().default(false),
  lastViewedAt: ts('last_viewed_at'),
}, (t) => [uniqueIndex('analytics_report_states_uq').on(t.shopId, t.staffUserId, t.reportKey)]);

/** A target on a metric for a calendar period (week, month, quarter or year), for the goal progress on the analytics overview. */
export const analyticsGoals = pgTable('analytics_goals', {
  id: pk(), shopId: shopFk(),
  metric: text('metric').notNull(),
  period: text('period').notNull(),
  /** Minor units for money metrics, a plain count otherwise. */
  target: bigint('target', { mode: 'number' }).notNull(),
  createdByStaffId: ref('created_by_staff_id'),
  ...timestamps(),
}, (t) => [uniqueIndex('analytics_goals_uq').on(t.shopId, t.metric, t.period)]);

/** A dated note drawn on report charts. A null `reportKey` shows on every time report. */
export const analyticsAnnotations = pgTable('analytics_annotations', {
  id: pk(), shopId: shopFk(),
  reportKey: text('report_key'),
  day: text('day').notNull(),
  text: text('text').notNull(),
  createdByStaffId: ref('created_by_staff_id'),
  createdAt: createdAt(),
}, (t) => [index('analytics_annotations_shop_idx').on(t.shopId, t.day)]);

/** Saved custom reports ("explorations"): the dataset, metrics, dimension, filters and visualization as JSON. */
export const analyticsExplorations = pgTable('analytics_explorations', {
  id: pk(), shopId: shopFk(),
  name: text('name').notNull(),
  definition: jsonb('definition').$type<Record<string, unknown>>().notNull(),
  createdByStaffId: ref('created_by_staff_id'),
  ...timestamps(),
}, (t) => [index('analytics_explorations_shop_idx').on(t.shopId)]);
