/** Money helpers. Amounts are integers in minor units (cents) everywhere inside ShopMe. */

const ZERO_DECIMAL = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYU', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
const THREE_DECIMAL = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

export function currencyExponent(currency: string): number {
  const c = currency.toUpperCase();
  return ZERO_DECIMAL.has(c) ? 0 : THREE_DECIMAL.has(c) ? 3 : 2;
}

/** Minor units -> decimal string with fixed decimals ("19.90"). This is the `Money` scalar format. */
export function formatMoney(minor: number, currency: string): string {
  const exp = currencyExponent(currency);
  const neg = minor < 0;
  const abs = Math.abs(Math.round(minor));
  const s = String(abs).padStart(exp + 1, '0');
  const body = exp === 0 ? s : `${s.slice(0, -exp)}.${s.slice(-exp)}`;
  return neg ? `-${body}` : body;
}

/** Minor units -> decimal string with trailing zeros trimmed ("19.9", "0.0"). This is the `Decimal` scalar format. */
export function formatDecimal(minor: number, currency: string): string {
  const s = formatMoney(minor, currency);
  if (!s.includes('.')) return `${s}.0`;
  const t = s.replace(/0+$/, '');
  return t.endsWith('.') ? `${t}0` : t;
}

/** Decimal string ("19.9") -> minor units. Throws on garbage. */
export function parseMoney(value: string | number, currency: string): number {
  const exp = currencyExponent(currency);
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) throw new Error(`Invalid money amount: ${value}`);
  return Math.round(n * 10 ** exp);
}

function group(intPart: string, sep: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

/** Render a money format template (`${{amount}}`, `{{amount_with_comma_separator}} €`, ...). */
export function renderMoneyFormat(template: string, minor: number, currency: string): string {
  const exp = currencyExponent(currency);
  const plain = formatMoney(Math.abs(minor), currency);
  const [i = '0', f = ''] = plain.split('.');
  const rounded = formatMoney(Math.round(Math.abs(minor) / 10 ** exp) * 10 ** exp, currency).split('.')[0]!;
  const variants: Record<string, string> = {
    amount: exp ? `${group(i, ',')}.${f}` : group(i, ','),
    amount_no_decimals: group(rounded, ','),
    amount_with_comma_separator: exp ? `${group(i, '.')},${f}` : group(i, '.'),
    amount_no_decimals_with_comma_separator: group(rounded, '.'),
    amount_with_apostrophe_separator: exp ? `${group(i, "'")}.${f}` : group(i, "'"),
    amount_no_decimals_with_space_separator: group(rounded, ' '),
    amount_with_space_separator: exp ? `${group(i, ' ')},${f}` : group(i, ' '),
  };
  const sign = minor < 0 ? '-' : '';
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => (k in variants ? sign + variants[k] : m));
}

const COMMA_LOCALES = ['fr', 'de', 'es', 'it', 'pt', 'nl', 'pl', 'sv', 'da', 'nb', 'fi', 'cs'];

/** Sensible default `money_format` / `money_with_currency_format` for a new shop. */
export function defaultMoneyFormats(currency: string, locale = 'en'): { moneyFormat: string; moneyWithCurrencyFormat: string } {
  const code = currency.toUpperCase();
  let symbol = code;
  try {
    symbol = new Intl.NumberFormat('en', { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' })
      .formatToParts(1)
      .find((p) => p.type === 'currency')?.value ?? code;
  } catch {
    /* unknown currency: keep the code */
  }
  const comma = COMMA_LOCALES.includes(locale.toLowerCase().split('-')[0]!);
  const moneyFormat = comma ? `{{amount_with_comma_separator}} ${symbol}` : `${symbol}{{amount}}`;
  const moneyWithCurrencyFormat = comma ? `{{amount_with_comma_separator}} ${code}` : `${symbol}{{amount}} ${code}`;
  return { moneyFormat, moneyWithCurrencyFormat };
}
