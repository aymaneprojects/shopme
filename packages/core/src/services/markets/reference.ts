/** Reference data for markets: countries, their usual currency and display names. */
export const COUNTRY_CODES: readonly string[] = 'AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FR GA GB GD GE GH GM GN GQ GR GT GW GY HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KI KM KN KP KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MK ML MM MN MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NR NZ OM PA PE PG PH PK PL PT PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VN VU WS YE ZA ZM ZW'.split(' ');

const COUNTRY_SET = new Set(COUNTRY_CODES);
export const isCountryCode = (code: string): boolean => COUNTRY_SET.has(code);

export function countryName(code: string, locale = 'en'): string {
  try { return new Intl.DisplayNames([locale, 'en'], { type: 'region' }).of(code) ?? code; } catch { return code; }
}

export function currencyName(code: string, locale = 'en'): string {
  try { return new Intl.DisplayNames([locale, 'en'], { type: 'currency' }).of(code) ?? code; } catch { return code; }
}

/** Regional flag emoji of a country code. */
export const flagOf = (code: string): string => (/^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '');

const EUR = 'AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SK SI AD MC SM VA ME'.split(' ');
/** Currency a country usually uses (used when a market turns on local currencies). Countries not listed use the market currency. */
export const COUNTRY_CURRENCY: Readonly<Record<string, string>> = {
  ...Object.fromEntries(EUR.map((c) => [c, 'EUR'])),
  US: 'USD', CA: 'CAD', GB: 'GBP', AU: 'AUD', NZ: 'NZD', JP: 'JPY', CH: 'CHF', LI: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', BG: 'BGN',
  MX: 'MXN', BR: 'BRL', AR: 'ARS', CL: 'CLP', CO: 'COP', PE: 'PEN', IN: 'INR', CN: 'CNY', HK: 'HKD', SG: 'SGD', KR: 'KRW', TW: 'TWD', TH: 'THB', MY: 'MYR', ID: 'IDR', PH: 'PHP', VN: 'VND',
  AE: 'AED', SA: 'SAR', IL: 'ILS', TR: 'TRY', ZA: 'ZAR', EG: 'EGP', NG: 'NGN', KE: 'KES', MA: 'MAD', IS: 'ISK', UA: 'UAH', KW: 'KWD', BH: 'BHD', QA: 'QAR',
};

/** Presentment currencies a shop may enable. */
export const SUPPORTED_CURRENCIES: readonly string[] = [
  'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'JPY', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'BGN', 'MXN', 'BRL', 'ARS', 'CLP', 'COP', 'PEN', 'INR', 'CNY', 'HKD', 'SGD', 'KRW', 'TWD', 'THB', 'MYR', 'IDR',
  'PHP', 'VND', 'AED', 'SAR', 'ILS', 'TRY', 'ZAR', 'EGP', 'NGN', 'KES', 'MAD', 'ISK', 'UAH', 'KWD', 'BHD', 'QAR',
];
