// ISO 3166-1 alpha-2 codes offered in country pickers; names come from Intl.DisplayNames in the UI language.
export const COUNTRY_CODES = [
  'AT', 'AU', 'BE', 'BG', 'BR', 'CA', 'CH', 'CN', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GB', 'GR', 'HR', 'HU', 'IE', 'IN', 'IS', 'IT', 'JP', 'KR', 'LI', 'LT', 'LU', 'LV', 'MA', 'MC', 'MT', 'MX', 'NL', 'NO', 'NZ', 'PL', 'PT', 'RO', 'SE', 'SG', 'SI', 'SK', 'TN', 'TR', 'US', 'ZA', 'DZ', 'SN', 'CI',
] as const;

export const countryName = (code: string, lang: string) => {
  try { return new Intl.DisplayNames([lang], { type: 'region' }).of(code) ?? code; } catch { return code; }
};

export const countryOptions = (lang: string) => COUNTRY_CODES.map((c) => ({ code: c as string, name: countryName(c, lang) })).sort((a, b) => a.name.localeCompare(b.name, lang));

export const TIMEZONES = [
  'UTC', 'Europe/Paris', 'Europe/London', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Rome', 'Europe/Brussels', 'Europe/Zurich', 'Europe/Lisbon', 'Africa/Casablanca', 'Africa/Algiers', 'Africa/Tunis',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Toronto', 'America/Montreal', 'America/Sao_Paulo', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland',
];
export const CURRENCIES = ['EUR', 'USD', 'GBP', 'CAD', 'CHF', 'AUD', 'NZD', 'JPY', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'MAD', 'TND', 'DZD', 'XOF', 'BRL', 'MXN', 'INR', 'SGD'];
