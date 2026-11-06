import { beforeEach, describe, expect, it } from 'vitest';
import { THEME_GRACE_MS, TASK_IDS, countDone, dayPart, detectTasks, formatKpi, greetingPart, groupFor, hourIn, kpiRows, kpiTotal, orderTasks, readGuideHidden, themeCustomized, writeGuideHidden } from './home';
import type { TaskSignals } from './home';

const fresh: TaskSignals = {
  passwordProtected: true, payments: { bankTransfer: false, cod: false, stripe: false, stripeConfigured: false }, customDomain: false, emailDone: false,
  productCount: 0, theme: { createdAt: '2026-11-01T10:00:00Z', updatedAt: '2026-11-01T10:00:05Z' }, shippingMethods: 0, offsite: { configured: false, enabled: false },
};

describe('setup task detection', () => {
  it('has every task pending on a fresh store', () => {
    const done = detectTasks(fresh);
    expect(TASK_IDS.filter((id) => done[id])).toEqual([]);
    expect(countDone(done)).toBe(0);
  });

  it('treats data that has not loaded (or failed) as pending, never as done', () => {
    const done = detectTasks({});
    expect(countDone(done)).toBe(0);
  });

  it('marks the store launched once the password page is off', () => {
    expect(detectTasks({ ...fresh, passwordProtected: false }).launch).toBe(true);
    expect(detectTasks({ ...fresh, passwordProtected: true }).launch).toBe(false);
  });

  it('accepts bank transfer, cash on delivery or a configured Stripe account as payments', () => {
    const pay = (p: Partial<NonNullable<TaskSignals['payments']>>) => detectTasks({ ...fresh, payments: { ...fresh.payments!, ...p } }).payments;
    expect(pay({ bankTransfer: true })).toBe(true);
    expect(pay({ cod: true })).toBe(true);
    expect(pay({ stripe: true, stripeConfigured: true })).toBe(true);
    expect(pay({ stripe: true, stripeConfigured: false })).toBe(false);
    expect(pay({})).toBe(false);
  });

  it('reads the domain, e-mail, product, shipping and backup signals', () => {
    const done = detectTasks({ ...fresh, customDomain: true, emailDone: true, productCount: 3, shippingMethods: 2, offsite: { configured: true, enabled: true } });
    expect(done).toMatchObject({ domain: true, email: true, product: true, shipping: true, backup: true });
    expect(detectTasks({ ...fresh, offsite: { configured: true, enabled: false } }).backup).toBe(false);
  });

  it('counts the theme as customized only when saved well after it was installed', () => {
    const created = Date.parse('2026-11-01T10:00:00Z');
    const at = (ms: number) => new Date(created + ms).toISOString();
    expect(themeCustomized({ createdAt: at(0), updatedAt: at(THEME_GRACE_MS) })).toBe(false);
    expect(themeCustomized({ createdAt: at(0), updatedAt: at(THEME_GRACE_MS + 1) })).toBe(true);
    expect(themeCustomized(null)).toBe(false);
    expect(themeCustomized({ createdAt: 'nope', updatedAt: 'nope' })).toBe(false);
  });
});

describe('task order', () => {
  it('lists pending tasks first and drops finished ones to the end, keeping the guide order inside each group', () => {
    const done = detectTasks({ ...fresh, passwordProtected: false, productCount: 2 });
    expect(orderTasks(done)).toEqual(['payments', 'domain', 'email', 'theme', 'shipping', 'backup', 'launch', 'product']);
  });
  it('keeps the plain order when nothing (or everything) is done', () => {
    expect(orderTasks(detectTasks(fresh))).toEqual([...TASK_IDS]);
    const all = detectTasks({ passwordProtected: false, payments: { bankTransfer: true, cod: false, stripe: false, stripeConfigured: false }, customDomain: true, emailDone: true, productCount: 1, theme: { createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z' }, shippingMethods: 1, offsite: { configured: true, enabled: true } });
    expect(countDone(all)).toBe(8);
    expect(orderTasks(all)).toEqual([...TASK_IDS]);
  });
});

describe('greeting by time of day', () => {
  it('splits the day into morning, afternoon and evening', () => {
    expect([0, 4, 5, 11, 12, 17, 18, 23].map(dayPart)).toEqual(['evening', 'evening', 'morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening']);
  });
  it('follows the hour of the store time zone, not the browser one', () => {
    const at = new Date('2026-11-06T22:30:00Z');
    expect(hourIn(at, 'Europe/Paris')).toBe(23);
    expect(greetingPart(at, 'Europe/Paris')).toBe('evening');
    expect(greetingPart(at, 'Asia/Tokyo')).toBe('morning'); // 07:30 the next day
    expect(greetingPart(at, 'America/New_York')).toBe('afternoon'); // 17:30
    expect(greetingPart(new Date('2026-11-06T00:15:00Z'), 'UTC')).toBe('evening');
    expect(hourIn(new Date('2026-11-06T00:15:00Z'), 'UTC')).toBe(0);
  });
  it('falls back to the local clock for an unknown time zone', () => {
    const at = new Date('2026-11-06T10:00:00Z');
    expect(hourIn(at, 'Not/AZone')).toBe(at.getHours());
  });
});

describe('guide dismissal storage', () => {
  beforeEach(() => localStorage.clear());
  it('remembers a hidden guide per store and forgets it when restored', () => {
    expect(readGuideHidden(1)).toBe(false);
    writeGuideHidden(1, true);
    expect(readGuideHidden(1)).toBe(true);
    expect(readGuideHidden(2)).toBe(false);
    writeGuideHidden(1, false);
    expect(readGuideHidden(1)).toBe(false);
  });
});

describe('key figures', () => {
  const rep = { columns: [{ key: 'period' }, { key: 'orders' }], rows: [['2026-11-01', 2], ['2026-11-02', null]] as Array<Array<string | number | null>>, totals: { orders: 2 } };
  it('reads a column and the total of a report', () => {
    expect(kpiRows(rep, 'orders')).toEqual([['2026-11-01', 2], ['2026-11-02', 0]]);
    expect(kpiRows(rep, 'missing')).toEqual([]);
    expect(kpiTotal(rep, 'orders')).toBe(2);
    expect(kpiTotal(undefined, 'orders')).toBeUndefined();
  });
  it('formats money from minor units, counts and percentages', () => {
    expect(formatKpi('money', 3550, 'EUR', 'en')).toBe('€35.50');
    expect(formatKpi('int', 1234, 'EUR', 'en')).toBe('1,234');
    expect(formatKpi('percent', 12.5, 'EUR', 'en')).toBe('12.5 %');
    expect(formatKpi('int', undefined, 'EUR', 'en')).toBe('—');
  });
  it('groups long periods by week', () => {
    expect([7, 30, 62, 63, 90].map(groupFor)).toEqual(['DAY', 'DAY', 'DAY', 'WEEK', 'WEEK']);
  });
});
