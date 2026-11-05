import { describe, expect, it } from 'vitest';
import { major, minor, newId } from './config';
import { blankCard, cardOf, cardProblem, methodInput, type ApiMethod } from './shipping';

describe('settings helpers', () => {
  it('converts decimals to minor units and back', () => {
    expect(minor('12.5')).toBe(1250);
    expect(minor('12,34')).toBe(1234);
    expect(minor('')).toBeNull();
    expect(minor('-1')).toBeNull();
    expect(major(1250)).toBe('12.50');
    expect(major(null)).toBe('');
  });
  it('makes unique slugs', () => {
    expect(newId([], 'Chèque cadeau')).toBe('cheque-cadeau');
    expect(newId(['cheque-cadeau'], 'Chèque cadeau')).toBe('cheque-cadeau-2');
    expect(newId([], '!!!')).toBe('item');
  });
});

describe('rate card options', () => {
  const method = (extra: Partial<ApiMethod>): ApiMethod => ({
    id: 'gid://shopify/DeliveryMethodDefinition/1', name: 'Standard', description: null, active: true, shopmeFreeOverAmount: null, rateProvider: { __typename: 'DeliveryRateDefinition', price: { amount: '4.90' } }, methodConditions: [],
    shopmeTransitMinDays: null, shopmeTransitMaxDays: null, shopmeCollectionIds: [], shopmeOriginLocationIds: [], shopmeRateType: 'FIXED', shopmeCarrierProvider: null, shopmeCarrierParams: {}, ...extra,
  });
  it('reads transit, collections and carrier settings from a method', () => {
    const c = cardOf(method({ shopmeTransitMinDays: 2, shopmeTransitMaxDays: 4, shopmeCollectionIds: ['gid://shopify/Collection/9'], shopmeRateType: 'CARRIER', shopmeCarrierProvider: 'demo_flat', shopmeCarrierParams: { base: 300 } }), 'KILOGRAMS');
    expect(c).toMatchObject({ transit: '2-4', collections: ['gid://shopify/Collection/9'], rateType: 'CARRIER', provider: 'demo_flat', params: { base: '300' } });
  });
  it('sends the options to the API and clears what is empty', () => {
    const input = methodInput({ name: 'Standard', description: '', active: true }, { ...blankCard(), price: '4.90', transit: '1-2' }, 'EUR', 'KILOGRAMS');
    expect(input).toMatchObject({ shopmeTransitMinDays: 1, shopmeTransitMaxDays: 2, shopmeRateType: 'FIXED', shopmeCollectionIds: [], shopmeCarrierProvider: null });
    expect(methodInput({ name: 'S', description: '', active: true }, { ...blankCard(), price: '1' }, 'EUR', 'KILOGRAMS')).toMatchObject({ shopmeClearTransit: true });
  });
  it('needs a provider for carrier-calculated rates', () => {
    expect(cardProblem({ ...blankCard(), price: '1', rateType: 'CARRIER' })).toBe('carrier');
    expect(cardProblem({ ...blankCard(), price: '1', rateType: 'CARRIER', provider: 'demo_flat' })).toBeNull();
  });
});
