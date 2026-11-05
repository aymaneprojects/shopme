import { describe, expect, it } from 'vitest';
import { joinPhone, splitPhone } from './dial-codes';

describe('dial codes', () => {
  it('splits a stored number into country and national part', () => {
    expect(splitPhone('+33612345678')).toEqual({ country: 'FR', national: '612345678' });
    expect(splitPhone('+1 613 555 0135')).toEqual({ country: 'US', national: '6135550135' });
    expect(splitPhone('+352 621 123 456')).toEqual({ country: 'LU', national: '621123456' });
    expect(splitPhone('0612345678')).toEqual({ country: '', national: '0612345678' });
    expect(splitPhone('+999123')).toEqual({ country: '', national: '+999123' });
    expect(splitPhone('')).toEqual({ country: '', national: '' });
  });

  it('joins them back into an international number', () => {
    expect(joinPhone('FR', '06 12 34 56 78')).toBe('+33612345678');
    expect(joinPhone('FR', '612345678')).toBe('+33612345678');
    expect(joinPhone('BE', '+32 470 12 34 56')).toBe('+32 470 12 34 56');
    expect(joinPhone('', '0612345678')).toBe('0612345678');
    expect(joinPhone('FR', '')).toBe('');
    expect(joinPhone('FR', 'abc')).toBe('');
  });
});
