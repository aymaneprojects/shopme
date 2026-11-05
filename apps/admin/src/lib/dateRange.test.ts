import { describe, expect, it } from 'vitest';
import { changeOf, rangeBounds } from './dateRange';

const now = new Date(2026, 10, 5, 15, 30); // 5 November 2026, local time

describe('rangeBounds', () => {
  it('covers today from local midnight to the next midnight', () => {
    const { from, to } = rangeBounds('today', now);
    expect(from).toEqual(new Date(2026, 10, 5));
    expect(to).toEqual(new Date(2026, 10, 6));
  });
  it('yesterday ends where today starts', () => {
    const y = rangeBounds('yesterday', now);
    expect(y.from).toEqual(new Date(2026, 10, 4));
    expect(y.to).toEqual(rangeBounds('today', now).from);
  });
  it('the last 7 and 30 days include today', () => {
    expect(rangeBounds('7d', now).from).toEqual(new Date(2026, 9, 30));
    const thirty = rangeBounds('30d', now);
    expect(Math.round((thirty.to.getTime() - thirty.from.getTime()) / 86_400_000)).toBe(30);
    const seven = rangeBounds('7d', now);
    expect(Math.round((seven.to.getTime() - seven.from.getTime()) / 86_400_000)).toBe(7);
    expect(seven.to).toEqual(new Date(2026, 10, 6));
  });
});

describe('changeOf', () => {
  it('is relative to the previous period', () => {
    expect(changeOf(15, 10)).toBe(0.5);
    expect(changeOf(5, 10)).toBe(-0.5);
  });
  it('has nothing to compare with when the previous period was empty', () => expect(changeOf(5, 0)).toBeNull());
});
