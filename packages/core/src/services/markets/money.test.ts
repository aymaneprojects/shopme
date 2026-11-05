import { describe, expect, it } from 'vitest';
import { adjustMinor, convertMinor, resolvePrice, roundUpToWhole, unconvertMinor, type PriceRules } from './money';
import { moneyFormatsFor } from './format';
import { flagOf } from './reference';

const rules = (o: Partial<PriceRules> = {}): PriceRules => ({ shopCurrency: 'USD', currency: 'CAD', rate: 1.35, roundingEnabled: true, ...o });

describe('conversion', () => {
  it('converts at a manual rate with half-cent cases rounded away from zero', () => {
    expect(convertMinor(1000, 'USD', 'CAD', 1.35)).toBe(1350);
    expect(convertMinor(1999, 'USD', 'CAD', 1.35)).toBe(2699); // 26.9865
    expect(convertMinor(10, 'USD', 'CAD', 1.5)).toBe(15);
    expect(convertMinor(1, 'USD', 'CAD', 1.5)).toBe(2); // 1.5 -> 2
    expect(convertMinor(1005, 'USD', 'CAD', 1.1)).toBe(1106); // 1105.5 -> 1106
    expect(convertMinor(-1, 'USD', 'CAD', 1.5)).toBe(-2);
  });

  it('respects the exponent of both currencies', () => {
    expect(convertMinor(1000, 'USD', 'JPY', 150)).toBe(1500); // 10.00 USD -> 1500 JPY
    expect(convertMinor(15000, 'JPY', 'USD', 0.0067)).toBe(10050); // 100.50 USD
    expect(convertMinor(1000, 'USD', 'KWD', 0.3)).toBe(3000); // 3 decimals: 3.000 KWD
  });

  it('inverts a conversion to shop money', () => {
    expect(unconvertMinor(1350, 'USD', 'CAD', 1.35)).toBe(1000);
    expect(unconvertMinor(1500, 'USD', 'JPY', 150)).toBe(1000);
    expect(unconvertMinor(500, 'USD', 'USD', 1)).toBe(500);
  });
});

describe('rounding', () => {
  it('rounds up to the next whole unit', () => {
    expect(roundUpToWhole(2699, 'CAD')).toBe(2700);
    expect(roundUpToWhole(2700, 'CAD')).toBe(2700);
    expect(roundUpToWhole(2701, 'CAD')).toBe(2800);
    expect(roundUpToWhole(1234, 'JPY')).toBe(1234); // zero-decimal: already whole
    expect(roundUpToWhole(3001, 'KWD')).toBe(4000);
  });

  it('applies to converted prices only when enabled', () => {
    expect(resolvePrice({ price: 1999, compareAt: null }, rules()).price).toBe(2700);
    expect(resolvePrice({ price: 1999, compareAt: null }, rules({ roundingEnabled: false })).price).toBe(2699);
    expect(resolvePrice({ price: 1999, compareAt: null }, rules({ currency: 'USD', rate: 1 })).price).toBe(1999); // same currency: never rounded
  });
});

describe('adjustments and compare-at', () => {
  it('applies percentage decreases and increases', () => {
    expect(adjustMinor(1000, { type: 'PERCENTAGE_DECREASE', value: 10 })).toBe(900);
    expect(adjustMinor(1000, { type: 'PERCENTAGE_INCREASE', value: 12.5 })).toBe(1125);
    expect(adjustMinor(999, { type: 'PERCENTAGE_DECREASE', value: 100 })).toBe(0);
    expect(adjustMinor(1000, null)).toBe(1000);
  });

  it('adjusts, converts, then rounds', () => {
    const r = resolvePrice({ price: 2000, compareAt: null }, rules({ adjustment: { type: 'PERCENTAGE_DECREASE', value: 10 } }));
    expect(r.price).toBe(2500); // 20.00 - 10% = 18.00 -> 24.30 -> 25.00
  });

  it('keeps the compare-at price above the price and drops it otherwise', () => {
    expect(resolvePrice({ price: 1000, compareAt: 1500 }, rules({ roundingEnabled: false }))).toEqual({ price: 1350, compareAt: 2025 });
    expect(resolvePrice({ price: 1000, compareAt: 1000 }, rules()).compareAt).toBeNull();
    expect(resolvePrice({ price: 1000, compareAt: 1500 }, rules({ adjustment: { type: 'PERCENTAGE_DECREASE', value: 5 }, compareAtMode: 'NULLIFY' })).compareAt).toBeNull();
  });

  it('lets a fixed price win over conversion, adjustment and rounding', () => {
    const fixed = { price: 1999, compareAtPrice: 2999 };
    expect(resolvePrice({ price: 1000, compareAt: null }, rules({ adjustment: { type: 'PERCENTAGE_DECREASE', value: 50 } }), fixed)).toEqual({ price: 1999, compareAt: 2999 });
    expect(resolvePrice({ price: 1000, compareAt: null }, rules(), { price: 1999, compareAtPrice: 1500 }).compareAt).toBeNull();
  });
});

describe('formats', () => {
  it('uses the shop formats for the shop currency and generated ones otherwise', () => {
    const shop = { currency: 'USD', moneyFormat: '${{amount}}', moneyWithCurrencyFormat: '${{amount}} USD' };
    expect(moneyFormatsFor(shop, 'USD').format).toBe('${{amount}}');
    expect(moneyFormatsFor(shop, 'CAD').withCurrency).toContain('CAD');
    expect(flagOf('CA')).toBe('\u{1F1E8}\u{1F1E6}');
  });
});
