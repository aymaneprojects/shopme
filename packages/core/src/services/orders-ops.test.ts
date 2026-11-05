import { describe, expect, it } from 'vitest';
import { addressProblems, capturableOf, deliveryStatusOf, riskLevelOf, scoreRisk } from './orders-ops';

type Tx = Parameters<typeof capturableOf>[0][number];
const tx = (p: Partial<Tx>): Tx => ({ id: 1, kind: 'SALE', status: 'SUCCESS', amount: 100, parentId: null, errorCode: null, ...p }) as Tx;

describe('addressProblems', () => {
  const ok = { firstName: 'Ada', lastName: 'L', address1: '1 Main St', city: 'Paris', zip: '75001', countryCode: 'FR', phone: null };
  it('accepts a complete address', () => expect(addressProblems(ok)).toEqual([]));
  it('checks the postal code format of the country', () => {
    expect(addressProblems({ ...ok, zip: '7500' })).toEqual(['ZIP_INVALID']);
    expect(addressProblems({ ...ok, countryCode: 'US', zip: '94105-1234' })).toEqual([]);
    expect(addressProblems({ ...ok, countryCode: 'GB', zip: 'SW1A 1AA' })).toEqual([]);
  });
  it('does not ask a postal code from countries without one', () => expect(addressProblems({ ...ok, countryCode: 'AE', zip: '' })).toEqual([]));
  it('flags a missing address only when something has to ship', () => {
    expect(addressProblems(null)).toEqual(['MISSING_ADDRESS']);
    expect(addressProblems(null, false)).toEqual([]);
  });
  it('flags unknown countries and short phone numbers', () => expect(addressProblems({ ...ok, countryCode: 'ZZ', phone: '123' })).toEqual(['COUNTRY_UNKNOWN', 'PHONE_INVALID']));
});

describe('risk', () => {
  const calm = { email: 'a@b.com', billingCountry: 'FR', shippingCountry: 'FR', total: 100, averageTotal: 100, ordersLastDay: 1, addressProblems: 0, failedPayments: 0, previousFraud: 0, previousOrders: 1 };
  it('is low when nothing stands out', () => expect(scoreRisk(calm)).toEqual({ level: 'LOW', score: 0, signals: [] }));
  it('adds up the signals and caps the score at 100', () => {
    const r = scoreRisk({ ...calm, email: 'x@yopmail.com', billingCountry: 'US', total: 1000, ordersLastDay: 5, addressProblems: 2, failedPayments: 2, previousFraud: 1, previousOrders: 0 });
    expect(r.score).toBe(100);
    expect(r.level).toBe('HIGH');
  });
  it('maps scores to levels', () => {
    expect([0, 24, 25, 49, 50, 100].map(riskLevelOf)).toEqual(['LOW', 'LOW', 'MEDIUM', 'MEDIUM', 'HIGH', 'HIGH']);
  });
});

describe('capturableOf', () => {
  it('lists what is left to capture on an authorization', () => {
    const txs = [tx({ id: 1, kind: 'AUTHORIZATION', amount: 1000 }), tx({ id: 2, kind: 'CAPTURE', parentId: 1, amount: 400 })];
    expect(capturableOf(txs)).toEqual([{ id: 1, remaining: 600 }]);
  });
  it('is empty once voided or captured in full', () => {
    expect(capturableOf([tx({ id: 1, kind: 'AUTHORIZATION' }), tx({ id: 2, kind: 'VOID', parentId: 1 })])).toEqual([]);
    expect(capturableOf([tx({ id: 1, kind: 'AUTHORIZATION' }), tx({ id: 2, kind: 'CAPTURE', parentId: 1, amount: 100, errorCode: 'FINAL' })])).toEqual([]);
  });
  it('ignores payments that were taken directly', () => expect(capturableOf([tx({ kind: 'SALE' })])).toEqual([]));
});

describe('deliveryStatusOf', () => {
  const f = (p: { status?: string; deliveredAt?: Date | null }) => ({ status: 'SUCCESS', deliveredAt: null, ...p }) as never;
  it('follows the live fulfillments', () => {
    expect(deliveryStatusOf({ fulfillments: [] })).toBe('NOT_FULFILLED');
    expect(deliveryStatusOf({ fulfillments: [f({}), f({ deliveredAt: new Date() })] })).toBe('IN_TRANSIT');
    expect(deliveryStatusOf({ fulfillments: [f({ deliveredAt: new Date() }), f({ status: 'CANCELLED' })] })).toBe('DELIVERED');
    expect(deliveryStatusOf({ fulfillments: [f({ status: 'CANCELLED' })] })).toBe('NOT_FULFILLED');
  });
});
