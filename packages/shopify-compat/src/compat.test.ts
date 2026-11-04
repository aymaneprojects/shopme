import { describe, expect, it } from 'vitest';
import { defaultMoneyFormats, failed, formatDecimal, formatMoney, fromGid, parseId, parseMoney, renderMoneyFormat, toGid, userError } from './index';

describe('gid', () => {
  it('round-trips', () => {
    expect(toGid('Product', 42)).toBe('gid://shopify/Product/42');
    expect(fromGid('gid://shopify/Product/42')).toEqual({ type: 'Product', id: 42 });
  });
  it('checks expected type and rejects garbage', () => {
    expect(fromGid('gid://shopify/Product/42', 'Order')).toBeNull();
    expect(fromGid('nope')).toBeNull();
    expect(fromGid('gid://shopify/Product/abc')).toBeNull();
    expect(parseId('7', 'Product')).toBe(7);
    expect(parseId('gid://shopify/Product/7', 'Product')).toBe(7);
    expect(parseId('gid://shopify/Order/7', 'Product')).toBeNull();
  });
});

describe('money', () => {
  it('formats minor units', () => {
    expect(formatMoney(1990, 'USD')).toBe('19.90');
    expect(formatMoney(5, 'USD')).toBe('0.05');
    expect(formatMoney(-250, 'EUR')).toBe('-2.50');
    expect(formatMoney(500, 'JPY')).toBe('500');
    expect(formatDecimal(1990, 'USD')).toBe('19.9');
    expect(formatDecimal(0, 'USD')).toBe('0.0');
    expect(formatDecimal(88595, 'USD')).toBe('885.95');
  });
  it('parses', () => {
    expect(parseMoney('19.9', 'USD')).toBe(1990);
    expect(parseMoney('600', 'JPY')).toBe(600);
    expect(() => parseMoney('x', 'USD')).toThrow();
  });
  it('renders templates', () => {
    expect(renderMoneyFormat('${{amount}}', 123456, 'USD')).toBe('$1,234.56');
    expect(renderMoneyFormat('{{amount_with_comma_separator}} €', 123456, 'EUR')).toBe('1.234,56 €');
    expect(renderMoneyFormat('{{ amount_no_decimals }}', 1250, 'USD')).toBe('13');
  });
  it('default formats follow locale', () => {
    expect(defaultMoneyFormats('USD').moneyFormat).toBe('${{amount}}');
    expect(defaultMoneyFormats('EUR', 'fr').moneyFormat).toBe('{{amount_with_comma_separator}} €');
  });
});

describe('userErrors', () => {
  it('builds', () => {
    expect(userError('input.title', "can't be blank")).toEqual({ field: ['input', 'title'], message: "can't be blank" });
    expect(failed(userError(null, 'x'), ['product'])).toEqual({ userErrors: [{ field: null, message: 'x' }], product: null });
  });
});
