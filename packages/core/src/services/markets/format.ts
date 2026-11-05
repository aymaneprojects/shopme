import { defaultMoneyFormats } from '@shopme/shopify-compat';

/** Money format templates for a currency: the shop's own formats for the shop currency, generated ones for any other. */
export function moneyFormatsFor(shop: { currency: string; moneyFormat: string; moneyWithCurrencyFormat: string; locale?: string }, currency: string): { format: string; withCurrency: string } {
  if (currency === shop.currency) return { format: shop.moneyFormat, withCurrency: shop.moneyWithCurrencyFormat };
  const f = defaultMoneyFormats(currency, shop.locale ?? 'en');
  return { format: f.moneyFormat, withCurrency: f.moneyWithCurrencyFormat };
}
