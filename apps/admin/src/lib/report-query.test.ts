import { describe, expect, it } from 'vitest';
import { cumulate, emptyQuery, formatReportQuery, matchesFilter, parseReportQuery } from './report-query';

describe('report query language', () => {
  it('parses every clause', () => {
    const r = parseReportQuery('FROM orders SHOW total_sales, orders BY week WHERE channel = web AND total > 5000 SINCE last_30_days UNTIL 2026-10-31 COMPARE previous_year VISUALIZE bar CUMULATIVE');
    expect(r).toEqual({
      ok: true, query: {
        from: 'orders', show: ['total_sales', 'orders'], by: 'week', where: [{ field: 'channel', op: 'EQ', value: 'web' }, { field: 'total', op: 'GT', value: '5000' }],
        since: 'LAST_30_DAYS', until: '2026-10-31', compare: 'PREVIOUS_YEAR', visualize: 'BAR', cumulative: true,
      },
    });
  });

  it('is case insensitive, accepts quotes and an empty text', () => {
    expect(parseReportQuery('show Orders by Day where product ~ "snow board"')).toMatchObject({ ok: true, query: { show: ['orders'], by: 'day', where: [{ field: 'product', op: 'CONTAINS', value: 'snow board' }] } });
    expect(parseReportQuery('')).toEqual({ ok: true, query: emptyQuery() });
    expect(parseReportQuery('BY none')).toMatchObject({ ok: true, query: { by: null } });
  });

  it('round-trips through format', () => {
    for (const text of ['SHOW orders', 'FROM sessions SHOW sessions, views BY page SINCE 2026-01-01 UNTIL 2026-01-31', 'SHOW total WHERE country != FR COMPARE previous_period VISUALIZE line', 'SHOW a WHERE name ~ "two words" CUMULATIVE']) {
      const parsed = parseReportQuery(text);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parseReportQuery(formatReportQuery(parsed.query))).toEqual(parsed);
    }
    expect(formatReportQuery({ ...emptyQuery(), show: ['orders'], since: 'LAST_7_DAYS' })).toBe('SHOW orders SINCE last_7_days');
  });

  it('names the problem and the token', () => {
    expect(parseReportQuery('SHOW')).toEqual({ ok: false, error: 'emptyClause', token: 'SHOW' });
    expect(parseReportQuery('orders')).toEqual({ ok: false, error: 'expectedKeyword', token: 'orders' });
    expect(parseReportQuery('SHOW a SHOW b')).toEqual({ ok: false, error: 'duplicateClause', token: 'SHOW' });
    expect(parseReportQuery('WHERE total 5')).toEqual({ ok: false, error: 'expectedOperator', token: 'total' });
    expect(parseReportQuery('WHERE total >')).toEqual({ ok: false, error: 'expectedValue', token: 'total' });
    expect(parseReportQuery('UNTIL tomorrow')).toEqual({ ok: false, error: 'badDate', token: 'tomorrow' });
    expect(parseReportQuery('COMPARE last_week')).toEqual({ ok: false, error: 'badCompare', token: 'last_week' });
    expect(parseReportQuery('VISUALIZE pie')).toEqual({ ok: false, error: 'badVisualization', token: 'pie' });
    expect(parseReportQuery('SHOW a WHERE b = "open')).toEqual({ ok: false, error: 'unterminated', token: '"open' });
    expect(parseReportQuery('SHOW a $')).toEqual({ ok: false, error: 'unexpected', token: '$' });
  });

  it('filters rows by text and number', () => {
    expect(matchesFilter('Web', { field: 'c', op: 'EQ', value: 'web' })).toBe(true);
    expect(matchesFilter(1200, { field: 'c', op: 'GT', value: '1000' })).toBe(true);
    expect(matchesFilter(900, { field: 'c', op: 'GT', value: '1000' })).toBe(false);
    expect(matchesFilter('Snow Board', { field: 'c', op: 'CONTAINS', value: 'snow' })).toBe(true);
    expect(matchesFilter('FR', { field: 'c', op: 'NEQ', value: 'fr' })).toBe(false);
    expect(matchesFilter(null, { field: 'c', op: 'LT', value: '5' })).toBe(false);
  });

  it('accumulates a series', () => {
    expect(cumulate([1, 2, 3, 0])).toEqual([1, 3, 6, 6]);
  });
});
