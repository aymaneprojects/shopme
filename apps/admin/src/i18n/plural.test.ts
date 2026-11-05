import { describe, expect, it } from 'vitest';
import { translate } from './index';

describe('plural forms', () => {
  it('uses the singular for 1 and the plural otherwise (EN)', () => {
    expect(translate('en', 'orders.count', { n: 1 })).toBe('1 order');
    expect(translate('en', 'orders.count', { n: 0 })).toBe('0 orders');
    expect(translate('en', 'orders.count', { n: 12 })).toBe('12 orders');
    expect(translate('en', 'products.deleteTitle', { n: 1 })).toBe('Delete 1 product?');
    expect(translate('en', 'products.inStock', { n: 3, v: 1, $count: 1 })).toBe('3 in stock for 1 variant');
    expect(translate('en', 'products.inStock', { n: 3, v: 4, $count: 4 })).toBe('3 in stock for 4 variants');
  });

  it('uses the singular for 0 and 1 (FR)', () => {
    expect(translate('fr', 'orders.count', { n: 0 })).toBe('0 commande');
    expect(translate('fr', 'orders.count', { n: 1 })).toBe('1 commande');
    expect(translate('fr', 'orders.count', { n: 2 })).toBe('2 commandes');
    expect(translate('fr', 'discounts.bulkDone', { n: 1 })).toBe('1 réduction mise à jour');
  });

  it('keeps keys without a singular form unchanged', () => {
    expect(translate('en', 'common.selected', { n: 1 })).toBe('1 selected');
    expect(translate('fr', 'common.selected', { n: 2 })).toBe('2 sélectionnés');
  });
});
