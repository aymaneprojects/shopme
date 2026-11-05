import { describe, expect, it } from 'vitest';
import { combineProfiles, conditionsMatch, decodeOptionId, localDeliveryOptionId, matchMethods, pickupOptionId, postalCodeInArea, rateCost, resolveZone, type MethodDef, type ZoneDef } from './rates';

const zone = (id: number, countries: ZoneDef['countries']): ZoneDef => ({ id, countries, methods: [] });
const country = (countryCode: string, provinceCodes: string[] = []) => ({ countryCode, restOfWorld: false, provinceCodes });
const rest = { countryCode: null, restOfWorld: true, provinceCodes: [] };
const method = (id: number, name: string, price: number, extra: Partial<MethodDef> = {}): MethodDef => ({ id, name, price, position: id, freeOverAmount: null, conditions: [], ...extra });

describe('zone resolution', () => {
  const zones = [zone(1, [rest]), zone(2, [country('CA')]), zone(3, [country('CA', ['QC', 'ON'])]), zone(4, [country('FR')])];
  it('province zone beats country zone beats rest of world', () => {
    expect(resolveZone(zones, 'CA', 'QC')?.id).toBe(3);
    expect(resolveZone(zones, 'ca', 'bc')?.id).toBe(2);
    expect(resolveZone(zones, 'CA', null)?.id).toBe(2);
    expect(resolveZone(zones, 'FR', 'IDF')?.id).toBe(4);
    expect(resolveZone(zones, 'JP', null)?.id).toBe(1);
  });
  it('has no zone without rest of world or country', () => {
    expect(resolveZone([zone(4, [country('FR')])], 'DE', null)).toBeNull();
    expect(resolveZone(zones, null, null)).toBeNull();
  });
});

describe('conditions', () => {
  const heavy = [{ field: 'TOTAL_WEIGHT' as const, operator: 'GREATER_THAN_OR_EQUAL_TO' as const, value: 1000 }, { field: 'TOTAL_WEIGHT' as const, operator: 'LESS_THAN_OR_EQUAL_TO' as const, value: 5000 }];
  it('compares grams and minor units, bounds included', () => {
    expect(conditionsMatch([], { subtotal: 0, grams: 0 })).toBe(true);
    expect(conditionsMatch(heavy, { subtotal: 1, grams: 999 })).toBe(false);
    expect(conditionsMatch(heavy, { subtotal: 1, grams: 1000 })).toBe(true);
    expect(conditionsMatch(heavy, { subtotal: 1, grams: 5000 })).toBe(true);
    expect(conditionsMatch(heavy, { subtotal: 1, grams: 5001 })).toBe(false);
    expect(conditionsMatch([{ field: 'TOTAL_PRICE', operator: 'GREATER_THAN_OR_EQUAL_TO', value: 5000 }], { subtotal: 4999, grams: 9999 })).toBe(false);
  });
  it('free-over threshold zeroes the price', () => {
    expect(rateCost({ price: 490, freeOverAmount: 5000 }, { subtotal: 4999, grams: 0 })).toBe(490);
    expect(rateCost({ price: 490, freeOverAmount: 5000 }, { subtotal: 5000, grams: 0 })).toBe(0);
    expect(rateCost({ price: 490, freeOverAmount: null }, { subtotal: 99999, grams: 0 })).toBe(490);
  });
});

describe('matching rates of a zone', () => {
  it('keeps the highest rate per name and orders by price then merchant order', () => {
    const light = method(1, 'Standard', 300, { conditions: [{ field: 'TOTAL_WEIGHT', operator: 'LESS_THAN_OR_EQUAL_TO', value: 2000 }] });
    const heavy = method(2, 'Standard', 900, { conditions: [{ field: 'TOTAL_WEIGHT', operator: 'GREATER_THAN_OR_EQUAL_TO', value: 1000 }] });
    const express = method(3, 'Express', 1500);
    const out = matchMethods([express, heavy, light], { subtotal: 1000, grams: 1500 });
    expect(out.map((o) => [o.name, o.price, o.id])).toEqual([['Standard', 900, 2], ['Express', 1500, 3]]);
    expect(matchMethods([express, heavy, light], { subtotal: 1000, grams: 500 }).map((o) => [o.name, o.price])).toEqual([['Standard', 300], ['Express', 1500]]);
    expect(matchMethods([method(1, 'Standard', 300, { freeOverAmount: 1000 })], { subtotal: 1000, grams: 0 })[0]!.price).toBe(0);
  });
});

describe('combining profiles', () => {
  const o = (id: number, name: string, price: number) => ({ id, name, price, position: id });
  it('passes a single profile through, and blocks when one profile has no option', () => {
    expect(combineProfiles([[o(1, 'A', 100)]])).toEqual([o(1, 'A', 100)]);
    expect(combineProfiles([[o(1, 'A', 100)], []])).toEqual([]);
    expect(combineProfiles([])).toEqual([]);
  });
  it('sums options sharing a name in every profile', () => {
    const r = combineProfiles([[o(5, 'Standard', 500), o(6, 'Express', 1500)], [o(2, 'Standard', 300), o(9, 'Pickup-ish', 0)]]);
    expect(r).toEqual([{ id: 2, name: 'Standard', price: 800, position: 2 }]);
  });
  it('adds the cheapest of each profile when no name is shared', () => {
    const r = combineProfiles([[o(5, 'Light', 500), o(6, 'Fast', 900)], [o(2, 'Heavy', 1200)]]);
    expect(r).toEqual([{ id: 2, name: 'Light + Heavy', price: 1700, position: 2 }]);
  });
});

describe('option ids and local delivery area', () => {
  it('round-trips pickup and local delivery ids', () => {
    expect(decodeOptionId(12)).toEqual({ type: 'SHIPPING' });
    expect(decodeOptionId(pickupOptionId(7))).toEqual({ type: 'PICK_UP', locationId: 7 });
    expect(decodeOptionId(localDeliveryOptionId(7))).toEqual({ type: 'LOCAL', locationId: 7 });
  });
  it('matches postal code prefixes ignoring spaces and case', () => {
    expect(postalCodeInArea('75 002', ['750'])).toBe(true);
    expect(postalCodeInArea('75002', ['75*'])).toBe(true);
    expect(postalCodeInArea('92100', ['75'])).toBe(false);
    expect(postalCodeInArea('sw1a 1aa', ['SW1A'])).toBe(true);
    expect(postalCodeInArea('', ['75'])).toBe(false);
    expect(postalCodeInArea('75001', [])).toBe(false);
  });
});
