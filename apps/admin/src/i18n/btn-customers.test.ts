import { describe, expect, it } from 'vitest';
import { en } from './en';
import { fr } from './fr';
import { REPORTS } from '../lib/analytics';

// Keys the server returns for the exploration builder (dimensions, metrics, filters) and the new report columns: each needs a label in both languages.
const METRICS = ['orders', 'gross_sales', 'discounts', 'refunds', 'shipping', 'taxes', 'total_sales', 'aov', 'customers', 'units', 'sales', 'avg_price', 'spent', 'avg_order', 'sessions', 'views'];
const DIMENSIONS = ['day', 'week', 'month', 'channel', 'financial_status', 'fulfillment_status', 'country', 'currency', 'weekday', 'hour', 'customer_type', 'product', 'variant', 'vendor', 'sku', 'customer', 'subscription', 'language', 'source', 'page'];
const FILTERS = ['channel', 'financial_status', 'fulfillment_status', 'country', 'currency', 'tag', 'total', 'product', 'vendor', 'sku', 'quantity', 'customer', 'subscription', 'language', 'source', 'page'];
const REPORT_COLUMNS = ['fulfilled', 'channel', 'gateway', 'paid', 'refunded', 'country', 'new_orders', 'returning_orders', 'new_sales', 'returning_sales', 'cost', 'profit', 'margin', 'source', 'path', 'cohort', 'm0', 'm1', 'm2', 'm3', 'm4', 'm5', 'segment', 'average', 'stock', 'sold', 'sell_through', 'share', 'cumulative', 'class'];
const has = (dict: Record<string, string>, ...keys: string[]) => keys.some((k) => typeof dict[k] === 'string' && dict[k] !== '');

describe('analytics labels', () => {
  for (const [lang, dict] of [['en', en], ['fr', fr]] as const) {
    it(`labels every metric, dimension, filter and report column in ${lang}`, () => {
      const d = dict as Record<string, string>;
      for (const m of METRICS) expect(has(d, `analytics.col.${m}`, `bc.metric.${m}`), `metric ${m}`).toBe(true);
      for (const m of REPORT_COLUMNS) expect(has(d, `analytics.col.${m}`, `bc.metric.${m}`), `column ${m}`).toBe(true);
      for (const k of DIMENSIONS) expect(has(d, `bc.dim.${k}`), `dimension ${k}`).toBe(true);
      for (const k of FILTERS) expect(has(d, `bc.filter.${k}`), `filter ${k}`).toBe(true);
      for (const r of REPORTS) expect(has(d, `analytics.report.${r}`), `report ${r}`).toBe(true);
    });
  }

  it('has the same keys in both languages and no empty text', () => {
    const enKeys = Object.keys(en).filter((k) => k.startsWith('bc.')).sort();
    expect(Object.keys(fr).filter((k) => k.startsWith('bc.')).sort()).toEqual(enKeys);
    for (const k of enKeys) { expect((en as Record<string, string>)[k], k).not.toBe(''); expect((fr as Record<string, string>)[k], k).not.toBe(''); }
  });
});
