import { describe, expect, it } from 'vitest';
import { addDays, comparisonRange, daysIn, delta, fillSeries, presetRange, weekStart } from './analytics';

describe('analytics date ranges', () => {
  it('computes presets ending today', () => {
    expect(presetRange('TODAY', '2026-11-05')).toEqual({ from: '2026-11-05', to: '2026-11-05' });
    expect(presetRange('LAST_7_DAYS', '2026-11-05')).toEqual({ from: '2026-10-30', to: '2026-11-05' });
    expect(presetRange('LAST_30_DAYS', '2026-03-10')).toEqual({ from: '2026-02-09', to: '2026-03-10' });
    expect(presetRange('THIS_MONTH', '2026-11-05')).toEqual({ from: '2026-11-01', to: '2026-11-05' });
    expect(presetRange('LAST_MONTH', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(presetRange('THIS_YEAR', '2026-11-05')).toEqual({ from: '2026-01-01', to: '2026-11-05' });
  });
  it('builds the comparison period', () => {
    const r = { from: '2026-11-01', to: '2026-11-07' };
    expect(daysIn(r)).toBe(7);
    expect(comparisonRange(r, 'NONE')).toBeNull();
    expect(comparisonRange(r, 'PREVIOUS_PERIOD')).toEqual({ from: '2026-10-25', to: '2026-10-31' });
    expect(comparisonRange(r, 'PREVIOUS_YEAR')).toEqual({ from: '2025-11-01', to: '2025-11-07' });
    expect(comparisonRange({ from: '2024-02-29', to: '2024-02-29' }, 'PREVIOUS_YEAR')).toEqual({ from: '2023-02-28', to: '2023-02-28' });
  });
  it('computes deltas', () => {
    expect(delta(150, 100)).toBe(50);
    expect(delta(50, 100)).toBe(-50);
    expect(delta(5, 0)).toBeNull();
    expect(delta(0, 0)).toBe(0);
  });
  it('fills series with zeros per period', () => {
    const r = { from: '2026-11-01', to: '2026-11-04' };
    expect(fillSeries([['2026-11-02', 5]], r, 'DAY')).toEqual([['2026-11-01', 0], ['2026-11-02', 5], ['2026-11-03', 0], ['2026-11-04', 0]]);
    expect(fillSeries([['2026-11-01', 9]], { from: '2026-10-15', to: '2026-11-20' }, 'MONTH')).toEqual([['2026-10-01', 0], ['2026-11-01', 9]]);
    expect(weekStart('2026-11-05')).toBe('2026-11-02'); // Monday
    expect(fillSeries([], { from: '2026-11-02', to: '2026-11-16' }, 'WEEK').map((x) => x[0])).toEqual(['2026-11-02', '2026-11-09', '2026-11-16']);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('chart marks and categories', () => {
  it('places a dated note on the period that contains it', async () => {
    const { markIndex, REPORT_CATEGORY, REPORTS } = await import('./analytics');
    const weeks: Array<[string, number]> = [['2026-10-05', 1], ['2026-10-12', 2], ['2026-10-19', 3]];
    expect(markIndex(weeks, '2026-10-14')).toBe(1);
    expect(markIndex(weeks, '2026-10-12')).toBe(1);
    expect(markIndex(weeks, '2026-10-30')).toBe(2);
    expect(markIndex(weeks, '2026-10-01')).toBe(-1);
    expect(REPORTS.every((r) => REPORT_CATEGORY[r])).toBe(true);
  });
});
