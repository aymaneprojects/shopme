import { countryName } from './countries';

/** Countries a market can include (ISO 3166-1 alpha-2). */
export const MARKET_COUNTRIES = 'AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FR GA GB GD GE GH GM GN GQ GR GT GW GY HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KI KM KN KP KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MK ML MM MN MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NR NZ OM PA PE PG PH PK PL PT PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VN VU WS YE ZA ZM ZW'.split(' ');

/** Currencies a market can sell in. */
export const MARKET_CURRENCIES = [
  'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'JPY', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'BGN', 'MXN', 'BRL', 'ARS', 'CLP', 'COP', 'PEN', 'INR', 'CNY', 'HKD', 'SGD', 'KRW', 'TWD', 'THB', 'MYR', 'IDR',
  'PHP', 'VND', 'AED', 'SAR', 'ILS', 'TRY', 'ZAR', 'EGP', 'NGN', 'KES', 'MAD', 'ISK', 'UAH', 'KWD', 'BHD', 'QAR',
];

/** Regional flag emoji of a country code. */
export const flag = (code: string): string => (/^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '');

/** "Euro (EUR €)": the currency's display name in the admin language (capitalized), its code and its symbol. */
export const currencyLabel = (code: string, lang: string): string => {
  if (!code) return '';
  try {
    const name = new Intl.DisplayNames([lang], { type: 'currency' }).of(code) ?? code;
    const symbol = new Intl.NumberFormat(lang, { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((p) => p.type === 'currency')?.value;
    return `${name.charAt(0).toLocaleUpperCase(lang) + name.slice(1)} (${code}${symbol && symbol !== code ? ` ${symbol}` : ''})`;
  } catch { return code; }
};

/** "EUR €": a currency code followed by its symbol (the code alone when the symbol is the code). */
export const currencySymbolLabel = (code: string, lang: string): string => {
  try {
    const symbol = new Intl.NumberFormat(lang, { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((p) => p.type === 'currency')?.value;
    return symbol && symbol !== code ? `${code} ${symbol}` : code;
  } catch { return code; }
};

/** Countries sorted by their name in the UI language. */
export const countriesSorted = (lang: string): { code: string; name: string }[] =>
  MARKET_COUNTRIES.map((c) => ({ code: c, name: countryName(c, lang) })).sort((a, b) => a.name.localeCompare(b.name, lang));

/** One unit of a currency written the way the shop's buyers see it (`$1.00`). */
export const oneUnit = (currency: string, lang: string): string => {
  try { return new Intl.NumberFormat(lang, { style: 'currency', currency }).format(1); } catch { return `1 ${currency}`; }
};
