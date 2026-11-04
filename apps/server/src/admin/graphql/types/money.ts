import { formatDecimal } from '@shopme/shopify-compat';
import { builder } from '../builder';

export const CurrencyCode = builder.enumType('CurrencyCode', { values: Intl.supportedValuesOf('currency') as string[] });

export interface MoneyShape { amount: string; currencyCode: string }
export interface MoneyBagShape { shopMoney: MoneyShape; presentmentMoney: MoneyShape }

/** Minor units -> MoneyV2 shape (amount is the `Decimal` format: trailing zeros trimmed). */
export const moneyV2 = (minor: number, currency: string): MoneyShape => ({ amount: formatDecimal(minor, currency), currencyCode: currency });
/** Pair of shop and presentment money. Presentment equals shop currency until multi-currency lands. */
export const moneyBag = (minor: number, currency: string, presentment?: { minor: number; currency: string }): MoneyBagShape => ({
  shopMoney: moneyV2(minor, currency),
  presentmentMoney: presentment ? moneyV2(presentment.minor, presentment.currency) : moneyV2(minor, currency),
});

export const MoneyV2 = builder.objectRef<MoneyShape>('MoneyV2').implement({
  fields: (t) => ({
    amount: t.field({ type: 'Decimal', resolve: (m) => m.amount }),
    currencyCode: t.field({ type: CurrencyCode, resolve: (m) => m.currencyCode }),
  }),
});

export const MoneyBag = builder.objectRef<MoneyBagShape>('MoneyBag').implement({
  fields: (t) => ({
    shopMoney: t.field({ type: MoneyV2, resolve: (m) => m.shopMoney }),
    presentmentMoney: t.field({ type: MoneyV2, resolve: (m) => m.presentmentMoney }),
  }),
});

export const CountPrecision = builder.enumType('CountPrecision', { values: ['EXACT', 'AT_LEAST'] as const });
export const Count = builder.objectRef<{ count: number; precision: 'EXACT' | 'AT_LEAST' }>('Count').implement({
  fields: (t) => ({ count: t.exposeInt('count'), precision: t.field({ type: CountPrecision, resolve: (c) => c.precision }) }),
});
