import { describe, expect, it } from 'vitest';
import { explorationCatalog, goalPeriodRange, rfmGroupOf, validateDefinition } from './services/analytics';

describe('RFM groups', () => {
  it('has no group for customers without an order', () => {
    expect(rfmGroupOf(null, 0)).toBe('PROSPECTS');
    expect(rfmGroupOf(10, 0)).toBe('PROSPECTS');
  });

  it('separates recent frequent buyers from lapsed ones', () => {
    expect(rfmGroupOf(5, 12)).toBe('CHAMPIONS');
    expect(rfmGroupOf(20, 1)).toBe('NEW');
    expect(rfmGroupOf(60, 2)).toBe('ACTIVE');
    expect(rfmGroupOf(120, 3)).toBe('LOYAL');
    expect(rfmGroupOf(120, 2)).toBe('PROMISING');
    expect(rfmGroupOf(150, 1)).toBe('NEEDS_ATTENTION');
    expect(rfmGroupOf(300, 6)).toBe('PREVIOUSLY_LOYAL');
    expect(rfmGroupOf(300, 2)).toBe('AT_RISK');
    expect(rfmGroupOf(300, 1)).toBe('ALMOST_LOST');
    expect(rfmGroupOf(800, 1)).toBe('DORMANT');
  });
});

describe('goal periods', () => {
  it('uses calendar periods that contain today', () => {
    expect(goalPeriodRange('WEEK', '2026-11-05')).toEqual({ from: '2026-11-02', to: '2026-11-08' }); // Thursday: week starts on Monday
    expect(goalPeriodRange('WEEK', '2026-11-08')).toEqual({ from: '2026-11-02', to: '2026-11-08' });
    expect(goalPeriodRange('MONTH', '2026-02-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(goalPeriodRange('QUARTER', '2026-11-05')).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(goalPeriodRange('YEAR', '2026-11-05')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });
});

describe('exploration definitions', () => {
  const base = { dataset: 'ORDERS', metrics: ['orders'], dimension: 'day', filters: [], period: 'LAST_30_DAYS', compare: 'NONE', visualization: 'LINE' };

  it('accepts a valid definition and fills defaults', () => {
    const r = validateDefinition({ dataset: 'PRODUCTS', metrics: ['units', 'units', 'sales'] });
    expect(r.ok && r.value).toMatchObject({ dataset: 'PRODUCTS', metrics: ['units', 'sales'], dimension: null, period: 'LAST_30_DAYS', compare: 'NONE', visualization: 'TABLE', limit: 100 });
  });

  it('refuses fields that do not belong to the dataset', () => {
    for (const bad of [
      { ...base, dataset: 'NOPE' }, { ...base, metrics: [] }, { ...base, metrics: ['sales'] }, { ...base, dimension: 'sku' }, { ...base, filters: [{ field: 'product', op: 'EQ', value: 'x' }] },
      { ...base, filters: [{ field: 'total', op: 'EQ', value: 'abc' }] }, { ...base, filters: [{ field: 'channel', op: 'LIKE', value: 'x' }] }, { ...base, sort: 'nope' }, null,
    ]) expect(validateDefinition(bad).ok, JSON.stringify(bad)).toBe(false);
  });

  it('lists every dataset with metrics, dimensions and filters', () => {
    const c = explorationCatalog();
    expect(Object.keys(c).sort()).toEqual(['CUSTOMERS', 'ORDERS', 'PRODUCTS', 'SESSIONS']);
    for (const d of Object.values(c)) { expect(d.metrics.length).toBeGreaterThan(0); expect(d.dimensions.some((x) => x.date)).toBe(true); }
  });
});
